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

export class NotificationBus {
  constructor(
    private readonly send: NotificationSender,
    private readonly store: NotificationStore,
    private readonly now: () => number = Date.now,
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

    let result: NotificationSendResult = { sent: 0, recipients: [] };
    let status: NotificationStatus = "sent";
    try {
      result = await this.send(surface, composedText);
      status = result.sent > 0 ? "sent" : "failed";
    } catch {
      status = "failed";
    }
    this.store.record(
      { id, eventType: event.eventType, surface, targetIssue: event.targetIssue, executionId: event.executionId, runId: event.runId, severity: event.severity, dedupeKey, composedText, recipients: result.recipients, status },
      now,
    );
    return { id, status, ...result };
  }
}
