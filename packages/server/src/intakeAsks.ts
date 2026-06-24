export type IntakeAskActionType = "answer_now" | "research" | "create_backlog" | "execute" | "notify_or_escalate" | "clarify";
export type CurrentIntentStatus = "open" | "fulfilled" | "blocked" | "awaiting_user" | "delegated" | "superseded" | "failed";
export type CurrentIntentResolution =
  | "answer_now"
  | "query_prior_durable_work"
  | "new_current_intent"
  | "propose_durable_backlog"
  | "delegate_execution"
  | "notify_or_escalate"
  | "awaiting_user";

export interface IntakeAsk {
  id: string;
  actionType: IntakeAskActionType;
  summary: string;
  sourceText: string;
}

export interface CurrentIntentEntry {
  askId: string;
  actionType: IntakeAskActionType;
  summary: string;
  sourceText: string;
  status: CurrentIntentStatus;
  resolution: CurrentIntentResolution;
  reason: string;
  safeAction: string;
}

const MAX_ASKS = 8;
const MIN_MULTI_ASK_LENGTH = 500;

const START_MARKER = /\b(?:also|finally|another thing|separate point|while you(?:'| a)?re at it|and then|then|so maybe|can you|could you|i want|i need|please|the question is)\b/gi;
const EXPLICIT_ASK_SIGNAL =
  /\b(?:can you|could you|please|i want|i need|research|investigate|audit|look up|status|what happened|did this happen|create|open|file|ticket|issue|epic|backlog|run|execute|launch|start|notify|notification|phylax|escalat|priority|higher priority|blocked|handle that request)\b/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimSentence(text: string, max = 180): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, Math.max(60, lastSpace)).trim()}...`;
}

function splitCandidateSegments(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const boundaries = new Set<number>([0]);
  for (const match of normalized.matchAll(START_MARKER)) {
    if (match.index !== undefined && match.index > 80) boundaries.add(match.index);
  }
  for (const match of normalized.matchAll(/[?.!]\s+(?=[A-Z]|\b(?:Also|And|So|Can|Could|I|The)\b)/g)) {
    if (match.index !== undefined) boundaries.add(match.index + match[0].length);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i]!;
    const end = sorted[i + 1] ?? normalized.length;
    const segment = normalized.slice(start, end).trim();
    if (segment.length >= 35) segments.push(segment);
  }
  return segments;
}

function classifyAsk(text: string): IntakeAskActionType {
  const lower = text.toLowerCase();
  if (/\b(?:not sure which|which repository|which repo|which issue|which ticket|which request|ambiguous|show candidates)\b/.test(lower)) {
    return "clarify";
  }
  if (/\b(?:run|execute|launch|start)\b/.test(lower)) return "execute";
  const hasNotificationRequest = /\b(?:notify|notification|phylax|ping me|write to me|escalat|ask me)\b/.test(lower);
  const notificationIsOnlyNegatedConstraint = /\bdo not\b[^.]{0,120}\b(?:notify|ping|write to me|send)\b/.test(lower);
  if (hasNotificationRequest && !notificationIsOnlyNegatedConstraint) return "notify_or_escalate";
  if (/\b(?:codex|epaminon|runner)\b/.test(lower)) return "execute";
  if (/\b(?:what happened|did it become|existing|prior|previous|find it|look up|lookup|inspect|investigate|audit|status)\b/.test(lower)) {
    return "research";
  }
  if (/\b(?:before we decide whether to open|unless i explicitly ask|do not turn (?:this|it)?[^.]{0,40}into)\b[^.]{0,80}\b(?:tickets?|issues?|backlog)\b/.test(lower)) {
    return "answer_now";
  }
  if (
    /\b(?:create|open|file|ticket|issue|priority|higher priority|urgent|rank)\b/.test(lower) ||
    (/\b(?:backlog|epic)\b/.test(lower) && /\b(?:create|open|file|add|update|change|prioritize|higher priority)\b/.test(lower))
  ) {
    return "create_backlog";
  }
  if (
    (/\bzenod\b|\bzenot\b|\bznot\b|\bxenot\b/.test(lower) && /\b(?:memory|brain|vault|retrieval|search|contrast|compare)\b/.test(lower)) ||
    (/\b(?:direct|obsidian|github|contrast|compare)\b/.test(lower) && /\b(?:search|brain|memory|retrieval)\b/.test(lower))
  ) {
    return "research";
  }
  if (/\b(?:summarize|explain|direct explanation|concise answer|answer before)\b/.test(lower)) return "answer_now";
  if (/\b(?:screenshots?|images?|attachments?|follow-up comments?)\b/.test(lower)) return "research";
  if (/\b(?:research|compare|contrast|benchmark|diagnos|measure|token)\b/.test(lower)) return "research";
  if (/\b(?:should|which|clarify|confirm|question)\b/.test(lower) || lower.endsWith("?")) return "clarify";
  return "answer_now";
}

function isConstraintOnly(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(?:please\s+)?do not\b/.test(lower) && /\b(?:create|run|execute|store|notify|file|open|mutat|send|backlog|ticket|issue)\b/.test(lower);
}

function summarizeAsk(segment: string, actionType: IntakeAskActionType): string {
  const source = normalizeWhitespace(segment);
  const lower = source.toLowerCase();
  if (/\bvoice note\b/.test(lower) && /\b(?:managed|handled|processed|properly)\b/.test(lower)) {
    return "Audit whether the voice note was properly processed and handled.";
  }
  if (/\b(?:ui|user interface)\b/.test(lower) && /\b(?:backlog|node|request)\b/.test(lower)) {
    return "Investigate what happened to the prior backlog UI request.";
  }
  if (/\bbenchmark/.test(lower) || (/\btoken/.test(lower) && /\b(?:cost|reliability|tests?)\b/.test(lower))) {
    return "Design a Zenod retrieval benchmark with token cost and reliability checks.";
  }
  if (
    (/\bzenod\b|\bzenot\b|\bznot\b|\bxenot\b/.test(lower) &&
      /\b(?:memory|brain|vault|retrieval|search|direct|obsidian|contrast|compare|research memory)\b/.test(lower)) ||
    (/\b(?:direct|obsidian|github|contrast|compare)\b/.test(lower) && /\b(?:search|brain|memory)\b/.test(lower))
  ) {
    return "Use Zenod for memory retrieval and contrast it with direct Obsidian/GitHub search.";
  }
  if (/\bscreenshots?\b|\bimages?\b|\battachments?\b/.test(lower)) {
    return "Handle screenshots and follow-up comments as related intake evidence.";
  }
  if (/\bphylax\b/.test(lower) || /\bnotification\b/.test(lower) || /\bescalat/.test(lower)) {
    return "Test the escalation path from execution back to Console/Phylax/user.";
  }
  const prefix =
    actionType === "research"
      ? "Research"
      : actionType === "create_backlog"
        ? "Create backlog for"
        : actionType === "execute"
          ? "Execute"
          : actionType === "notify_or_escalate"
            ? "Notify/escalate"
            : actionType === "clarify"
              ? "Clarify"
              : "Answer";
  return `${prefix}: ${trimSentence(source, 120)}`;
}

function mergeSimilarAsks(asks: IntakeAsk[]): IntakeAsk[] {
  const seen = new Set<string>();
  const merged: IntakeAsk[] = [];
  for (const ask of asks) {
    const key = ask.summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...ask, id: `ask-${merged.length + 1}` });
  }
  return merged;
}

export function extractIntakeAsks(text: string): IntakeAsk[] {
  const normalized = normalizeWhitespace(text);
  if (
    normalized.length < MIN_MULTI_ASK_LENGTH &&
    !/\b(?:also|another thing|separate point|while you(?:'| a)?re at it|then|finally)\b/i.test(normalized) &&
    !EXPLICIT_ASK_SIGNAL.test(normalized)
  ) {
    return [];
  }
  const asks = splitCandidateSegments(normalized)
    .filter((segment) => !isConstraintOnly(segment))
    .map((segment) => {
      const actionType = classifyAsk(segment);
      return {
        id: "",
        actionType,
        summary: summarizeAsk(segment, actionType),
        sourceText: trimSentence(segment, 260),
      };
    })
    .filter((ask) => ask.actionType !== "answer_now" || /\b(?:can you|i want|i need|please|question)\b/i.test(ask.sourceText));
  return mergeSimilarAsks(asks).slice(0, MAX_ASKS);
}

export function formatIntakeAsks(asks: IntakeAsk[]): string {
  return asks.map((ask, index) => `${index + 1}. [${ask.actionType}] ${ask.summary}`).join("\n");
}

export function resolveCurrentIntents(asks: IntakeAsk[]): CurrentIntentEntry[] {
  return asks.map((ask) => {
    const lower = `${ask.summary} ${ask.sourceText}`.toLowerCase();
    const base = { askId: ask.id, actionType: ask.actionType, summary: ask.summary, sourceText: ask.sourceText };
    if (ask.actionType === "clarify") {
      return {
        ...base,
        status: "awaiting_user",
        resolution: "awaiting_user",
        reason: "The ask is ambiguous and needs user clarification before action.",
        safeAction: "Ask one concrete clarification; do not mutate any authority until the user answers.",
      };
    }
    if (ask.actionType === "execute") {
      const hasNotificationFollowup = /\b(?:notify|notification|phylax|ping me|write to me|whatsapp|escalat|ask me)\b/.test(lower);
      return {
        ...base,
        status: "open",
        resolution: "delegate_execution",
        reason: "Execution belongs to Epaminon after the target and approval are clear.",
        safeAction: hasNotificationFollowup
          ? "Delegate to Epaminon only with an exact target and explicit run approval; after execution evidence exists, involve Phylax with the event, urgency, and source evidence."
          : "Delegate to Epaminon only with an exact target and explicit run approval; otherwise ask for the missing target/scope.",
      };
    }
    if (ask.actionType === "notify_or_escalate") {
      return {
        ...base,
        status: "open",
        resolution: "notify_or_escalate",
        reason: "Notification or escalation belongs to Phylax/Console routing after evidence exists.",
        safeAction: "Involve Phylax only with the event, urgency, and source evidence; otherwise keep the notification step pending.",
      };
    }
    if (ask.actionType === "create_backlog") {
      return {
        ...base,
        status: "open",
        resolution: "propose_durable_backlog",
        reason: "This appears to need a durable GitHub/backlog record if not already present.",
        safeAction: "Create/propose a GitHub issue only if the user asked for durable tracking; include the issue URL before saying it was created.",
      };
    }
    if (/\b(?:what happened|prior|previous|existing|did it become|already|ever become)\b/.test(lower)) {
      return {
        ...base,
        status: "open",
        resolution: "query_prior_durable_work",
        reason: "The ask references prior work, so Console should search existing memory/issues before proposing new work.",
        safeAction: "Search existing memory/issues first and report the searched scope; do not create a duplicate unless the search misses and the user wants one.",
      };
    }
    if (ask.actionType === "research") {
      return {
        ...base,
        status: "open",
        resolution: "new_current_intent",
        reason: "This is a distinct research intent to track until answered or delegated.",
        safeAction: "Answer or research directly; create no GitHub issue unless the user asks to track it durably.",
      };
    }
    return {
      ...base,
      status: "open",
      resolution: "answer_now",
      reason: "Console can answer directly or keep it visible while other asks are handled.",
      safeAction: "Answer directly and mark the ask fulfilled only if the reply actually addresses it.",
    };
  });
}

export function formatCurrentIntentLedger(entries: CurrentIntentEntry[]): string {
  return entries
    .map((entry, index) => `${index + 1}. [${entry.status} -> ${entry.resolution}] ${entry.summary}`)
    .join("\n");
}

export function formatSafeActionPlan(entries: CurrentIntentEntry[]): string {
  return entries.map((entry, index) => `${index + 1}. ${entry.summary} — ${entry.safeAction}`).join("\n");
}

export function intakeAsksContextNote(asks: IntakeAsk[]): string {
  const intents = resolveCurrentIntents(asks);
  return [
    "Console intake decomposition detected multiple asks in the current user message.",
    "Treat them as separate asks. Do not flatten them into one vague answer. If acting on one ask, keep the others visible as open/pending unless you have receipts.",
    "",
    "Detected asks:",
    formatIntakeAsks(asks),
    "",
    "Current intent ledger decisions:",
    formatCurrentIntentLedger(intents),
    "",
    "Safe action plan:",
    formatSafeActionPlan(intents),
    "",
    "Receipt rule: never say created, filed, queued, running, stored, notified, or closed unless the same turn has the concrete authority receipt/link. If no receipt exists, say pending, searched, or needs clarification.",
    "",
    "Source snippets:",
    ...asks.map((ask) => `- ${ask.id}: ${ask.sourceText}`),
  ].join("\n");
}

export function prefixReplyWithIntakeAsks(reply: string, asks: IntakeAsk[]): string {
  if (asks.length <= 1 || /^Detected asks:/i.test(reply.trim())) return reply;
  const intents = resolveCurrentIntents(asks);
  return [
    `Detected asks:`,
    formatIntakeAsks(asks),
    "",
    "Current intent ledger:",
    formatCurrentIntentLedger(intents),
    "",
    "Safe action plan:",
    formatSafeActionPlan(intents),
    "",
    reply,
  ].join("\n");
}
