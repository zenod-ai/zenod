import { NotificationStore, type NotificationStatus } from "./notificationStore.js";

/**
 * The single notification authority (R2-T1). Every proactive outbound message — from
 * the execution lane, the journey monitor, the filing worker, and /api/notify — flows
 * through this one `notify(event)` ingress instead of calling notifyOwner directly.
 *
 * T1 scope: one typed ingress + a durable journal + centralized recipient ownership.
 * It composes text (today: passthrough of `event.text`) and sends. The dedup/coalesce
 * (T2), state-machine ordering (T3), and no-truncation composer (T4) are added inside
 * this same choke point without touching any call site again.
 */

export type NotificationSeverity = "info" | "action" | "error";

export interface NotificationEvent {
  /** e.g. "execution.start", "execution.blocked", "execution.terminal", "filing.receipt", "manual". */
  eventType: string;
  /** Composed message text (T1 passthrough; later tiers may recompose). */
  text?: string;
  /** Channel: "whatsapp" (default) or "telegram". */
  surface?: string;
  /** The work ticket this concerns, "owner/repo#N", when applicable. */
  targetIssue?: string;
  executionId?: string;
  runId?: string;
  severity?: NotificationSeverity;
  /** Explicit dedupe key; when absent, derived from (targetIssue|executionId, runId, eventType). */
  dedupeKey?: string;
}

export interface NotificationSendResult {
  sent: number;
  recipients: string[];
}

/** Injected channel send — wraps whatsapp/telegram notifyOwner. */
export type NotificationSender = (surface: string, text: string) => Promise<NotificationSendResult>;

/**
 * PURE: the default dedupe key for an event — the identity R2-T2 coalesces on. Keys on
 * the target (issue else execution) + run + event type, so sibling executions of one
 * run collapse and a repeated state is one fact. Explicit dedupeKey always wins.
 */
export function notificationDedupeKey(event: NotificationEvent): string {
  if (event.dedupeKey) return event.dedupeKey;
  const target = event.targetIssue || event.executionId || "-";
  const run = event.runId || "-";
  return `${target}|${run}|${event.eventType}`;
}

let counter = 0;
function nextId(now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `ntf-${now}-${counter}`;
}

/**
 * PURE (R2-T2): does this event carry a meaningful identity to dedup on? Only events
 * tied to a target/execution/run (or an explicit key) may coalesce — a plain manual
 * text notification must NEVER be suppressed by an unrelated earlier manual message.
 */
export function isCoalescible(event: NotificationEvent): boolean {
  return Boolean(event.dedupeKey || event.targetIssue || event.executionId || event.runId);
}

/** Default coalescing window: repeats of the same fact within 10 minutes collapse. */
const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/**
 * PURE (R2-T3): the state rank of an event type for a run. Ordering flows start →
 * (blocked | terminal), and `terminal` is final. A higher-ranked state must never be
 * followed by a lower-ranked one for the same run without being stale.
 */
export function eventStateRank(eventType: string): number {
  if (eventType.endsWith(".terminal") || eventType.endsWith(".done")) return 3;
  if (eventType.endsWith(".blocked") || eventType.endsWith(".failed")) return 2;
  if (eventType.endsWith(".start")) return 1;
  return 0; // untracked (e.g. manual) — never participates in ordering
}

/** Ordering-guard window: state relationships older than this are history, not a
 *  contradiction — a fresh run on an issue must not be gagged by yesterday's terminal. */
const DEFAULT_ORDERING_WINDOW_MS = 30 * 60 * 1000;

export class NotificationBus {
  constructor(
    private readonly send: NotificationSender,
    private readonly store: NotificationStore,
    private readonly now: () => number = Date.now,
    private readonly dedupeWindowMs: number = DEFAULT_DEDUPE_WINDOW_MS,
    private readonly orderingWindowMs: number = DEFAULT_ORDERING_WINDOW_MS,
  ) {}

  /**
   * Emit one proactive notification. Composes the text, sends it on the channel, and
   * journals the event with its outcome + recipients. Never throws — a send failure is
   * recorded with status "failed" and returned, so a broken channel can't crash a caller.
   */
  async notify(event: NotificationEvent): Promise<NotificationSendResult & { id: string; status: NotificationStatus }> {
    const now = this.now();
    const id = nextId(now);
    const surface = event.surface === "telegram" ? "telegram" : "whatsapp";
    const composedText = (event.text ?? "").trim();
    const dedupeKey = notificationDedupeKey(event);

    if (!composedText) {
      this.store.record(
        { id, eventType: event.eventType, surface, targetIssue: event.targetIssue, executionId: event.executionId, runId: event.runId, severity: event.severity, dedupeKey, composedText: "", recipients: [], status: "suppressed" },
        now,
      );
      return { id, status: "suppressed", sent: 0, recipients: [] };
    }

    // R2-T2: coalesce. If this fact (same target|run|eventType) was already sent within
    // the window — including from a SIBLING execution of the same run — suppress this
    // one and journal it pointing at the record that superseded it. Manual/keyless
    // notifications are never coalesced.
    if (isCoalescible(event)) {
      const prior = this.store.latestSentByDedupeKey(dedupeKey);
      if (prior && now - prior.createdAt <= this.dedupeWindowMs) {
        this.store.record(
          { id, eventType: event.eventType, surface, targetIssue: event.targetIssue, executionId: event.executionId, runId: event.runId, severity: event.severity, dedupeKey, composedText, recipients: [], status: "suppressed", suppressedBy: prior.id },
          now,
        );
        return { id, status: "suppressed", sent: 0, recipients: [] };
      }
    }

    // R2-T3: state-machine ordering per (targetIssue, runId). A terminal that follows a
    // blocked is annotated so it explains the transition (no bare ✅ after ⛔); a lower-
    // ranked event that arrives AFTER a higher-ranked one for the same run is stale and
    // suppressed (e.g. a late "blocked" after the run already completed).
    let outText = composedText;
    const rank = eventStateRank(event.eventType);
    if (event.targetIssue && rank > 0) {
      // Only a RECENT prior state participates: outside the window it is history, not
      // a contradiction — a fresh run must not be gagged by yesterday's terminal.
      const recent = this.store.latestSentForGroup(event.targetIssue, event.runId ?? null);
      const prior = recent && now - recent.createdAt <= this.orderingWindowMs ? recent : null;
      const priorRank = prior ? eventStateRank(prior.eventType) : 0;
      if (prior && priorRank > rank) {
        this.store.record(
          { id, eventType: event.eventType, surface, targetIssue: event.targetIssue, executionId: event.executionId, runId: event.runId, severity: event.severity, dedupeKey, composedText, recipients: [], status: "suppressed", suppressedBy: prior.id },
          now,
        );
        return { id, status: "suppressed", sent: 0, recipients: [] };
      }
      if (prior && priorRank === 2 && rank === 3) {
        outText = `↩️ Previously blocked — now resolved.\n${composedText}`;
      }
    }

    let result: NotificationSendResult = { sent: 0, recipients: [] };
    let status: NotificationStatus = "sent";
    try {
      result = await this.send(surface, outText);
      status = result.sent > 0 ? "sent" : "failed";
    } catch {
      status = "failed";
    }
    this.store.record(
      { id, eventType: event.eventType, surface, targetIssue: event.targetIssue, executionId: event.executionId, runId: event.runId, severity: event.severity, dedupeKey, composedText: outText, recipients: result.recipients, status },
      now,
    );
    return { id, status, ...result };
  }
}
