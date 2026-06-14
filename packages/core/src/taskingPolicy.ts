export const OWNER_AGENT = "owner:agent";
export const STATUS_PROPOSED = "status:proposed";
export const STATUS_QUEUED = "status:queued";
export const STATUS_NEEDS_REVIEW = "status:needs-review";
export const STATUS_APPROVED_MERGE = "status:approved-merge";
export const STATUS_MERGED = "status:merged";

// Privileged statuses an agent can never set through the generic create/label
// tools — each has a dedicated, human-gated approval tool (approve_queue,
// approve_merge). Attempts via create/label are rewritten to proposed.
const GATED_STATUSES = new Set([STATUS_QUEUED, STATUS_APPROVED_MERGE]);

export function normalizeCreateIssueLabels(labels?: string[]): string[] {
  return ensureProposedStatus(normalizeAgentMutableLabels(labels ?? []));
}

export function normalizeLabelIssueLabels(labels: string[]): string[] {
  return normalizeAgentMutableLabels(labels);
}

function normalizeAgentMutableLabels(labels: string[]): string[] {
  const normalized = labels.map((label) => (GATED_STATUSES.has(label) ? STATUS_PROPOSED : label));
  return [...new Set(normalized)];
}

function ensureProposedStatus(labels: string[]): string[] {
  return labels.includes(STATUS_PROPOSED) ? labels : [...labels, STATUS_PROPOSED];
}

// --- Reply grounding -------------------------------------------------------
// A weaker model will happily narrate "Created issue #58: <url>" without ever
// (successfully) calling create_issue — it lifts a plausible number from earlier
// context. The user then opens #58 and finds an unrelated, pre-existing ticket.
// We can't trust the prose, but we DO have the real tool results for this turn,
// so reconcile the two: every concrete issue number the reply presents in a
// mutation claim must be backed by a tool result from this same turn.

/** A recorded tasking tool call. Structurally compatible with TaskingAction. */
export interface RecordedAction {
  tool: string;
  result: string;
}

// Verbs that assert a state change already happened (perfective forms only, so
// offers like "want me to create…" / "I'll open…" don't trip the guard).
const MUTATION_CLAIM = /\b(created|filed|opened|raised|logged|queued|merged|approved)\b/i;
const CREATION_CLAIM = /\b(created|filed|opened|raised|logged)\b/i;

function issueNumbersIn(text: string): Set<number> {
  const nums = new Set<number>();
  for (const m of text.matchAll(/#(\d+)\b/g)) nums.add(Number(m[1]));
  for (const m of text.matchAll(/\/issues\/(\d+)\b/g)) nums.add(Number(m[1]));
  return nums;
}

/** Issue numbers any successful tool result surfaced or affected this turn. */
function provenNumbers(actions: ReadonlyArray<RecordedAction>): Set<number> {
  const nums = new Set<number>();
  for (const action of actions) {
    if (/^ERROR:/.test(action.result)) continue;
    for (const m of action.result.matchAll(/#(\d+)\b/g)) nums.add(Number(m[1]));
    for (const m of action.result.matchAll(/\/issues\/(\d+)\b/g)) nums.add(Number(m[1]));
  }
  return nums;
}

/** Full success receipts from create_issue calls (carry the real number + url). */
function createReceipts(actions: ReadonlyArray<RecordedAction>): string[] {
  return actions
    .filter((action) => action.tool === "createIssue" && /^Created issue #\d+:/.test(action.result))
    .map((action) => action.result);
}

function createError(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const failed = [...actions].reverse().find((action) => action.tool === "createIssue" && /^ERROR:/.test(action.result));
  return failed?.result.replace(/^ERROR:\s*/, "");
}

const fmt = (nums: number[]): string => nums.map((n) => `#${n}`).join(", ");

/**
 * Build a user-facing reply from the tool results when the model produced no
 * final text (e.g. it exhausted its step budget mid-tool-call, leaving
 * generateText with an empty string). Returns null when there's nothing useful
 * to say, so the caller can fall back to a generic notice. Without this a
 * WhatsApp turn that ran tools but never wrote a closing sentence is silently
 * dropped by the gateway's empty-text guard.
 */
export function summarizeActionsForReply(actions: ReadonlyArray<RecordedAction>): string | null {
  const lines = actions.map((action) => action.result.trim()).filter((result) => result.length > 0 && !/^ERROR:/.test(result));
  if (lines.length === 0) return null;
  return lines.join("\n\n");
}

/**
 * Reconcile a tasking reply against the tools that actually ran this turn.
 * Returns the reply unchanged when its mutation claims check out, or prepends a
 * correction when it asserts a creation/mutation that no tool result backs.
 * Pure and deterministic so it can be unit-tested against real transcripts.
 */
export function reconcileTaskingReply(text: string, actions: ReadonlyArray<RecordedAction>): string {
  // Only police replies that claim a state change. Read-only mentions of an
  // issue number (answering "what's the status of #44") are left alone.
  if (!MUTATION_CLAIM.test(text)) return text;

  const presented = issueNumbersIn(text);
  const receipts = createReceipts(actions);
  const createdNums = new Set(receipts.map((r) => Number(/^Created issue #(\d+):/.exec(r)![1])));

  const claimsCreation = CREATION_CLAIM.test(text) && (presented.size > 0 || /\b(issue|ticket)\b/i.test(text));

  // The demonstrated bug: a creation is claimed but nothing was created.
  if (claimsCreation && createdNums.size === 0) {
    const lines = [
      presented.size > 0
        ? `⚠️ Correction — no GitHub issue was created. ${fmt([...presented])} ${presented.size > 1 ? "were" : "was"} not filed by this request (ignore the issue details below).`
        : "⚠️ Correction — no GitHub issue was created by this request (ignore any claim below that one was filed).",
    ];
    const err = createError(actions);
    if (err) lines.push(`The create step failed: ${err}`);
    lines.push("Nothing was filed — want me to create it now?");
    return `${lines.join("\n")}\n\n${text}`;
  }

  // A creation did happen, but the reply points at a different number than the
  // one actually created (e.g. said #58, really created #61).
  if (claimsCreation && presented.size > 0 && ![...createdNums].some((n) => presented.has(n))) {
    return `⚠️ Correction — the issue I actually created is below; the number cited in the text is wrong:\n${receipts.join("\n")}\n\n${text}`;
  }

  // Any other mutation claim that cites an issue number no tool produced or
  // touched this turn (fabricated queue/merge/label receipts).
  const proven = provenNumbers(actions);
  const unproven = [...presented].filter((n) => !proven.has(n));
  if (unproven.length > 0) {
    return `⚠️ Correction — I couldn't confirm ${fmt(unproven)} against the backlog this turn, so don't rely on ${unproven.length > 1 ? "those references" : "that reference"}.\n\n${text}`;
  }

  return text;
}
