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

// Perfective mutation verbs. Offers ("want me to create…", "I'll open…") use
// other forms and don't trip the guard.
const MUTATION_VERBS = "created|filed|opened|raised|logged|placed|queued|merged|approved";
const CREATION_VERBS = "created|filed|opened|raised|logged|placed";

// A mutation verb is only a *claim about this turn* when it's active voice. A
// be-verb/modal/infinitive before it marks a description, not a receipt:
// "issues are created with status:proposed", "can be filed", "to open". An
// adverb may sit between the lead and the verb ("#76 is indeed approved",
// "is already queued") — still a state description, not a this-turn receipt —
// so allow one. Without this, listing capabilities, quoting docs, or merely
// confirming a ticket's existing status tripped a false correction.
const DESCRIPTIVE_ADVERBS = "indeed|already|now|currently|still|also|truly|certainly|definitely|clearly|recently|just|previously";
// Coordinated participles share the same descriptive subject — "is approved/queued",
// "was filed and queued" — so once the head is excused by the be-verb, excuse the
// trailing chain joined by a slash, comma, or and/or too. Otherwise only the first
// participle was treated as a description and the second still tripped a correction.
const DESCRIPTIVE_LEAD = new RegExp(
  `\\b(is|are|was|were|be|been|being|get|gets|got|can|could|will|would|to|cannot|can't|not)\\s*` +
    `(?:(?:${DESCRIPTIVE_ADVERBS})\\s+)*` +
    `(?:(?:${MUTATION_VERBS})\\s*(?:[/,]\\s*|\\s+(?:and|or)\\s+))*$`,
  "i",
);

/**
 * The model's own this-turn assertions — with markdown blockquotes and fenced
 * code removed. Quoting a past reply ("the log shows: > Created issue #62") or
 * showing an example is not a claim that the action happened now.
 */
function assertedProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

/** True when one of `verbs` appears as an active completion claim in `prose`. */
function hasActiveClaim(prose: string, verbs: string): boolean {
  const re = new RegExp(`\\b(${verbs})\\b`, "gi");
  for (const m of prose.matchAll(re)) {
    if (DESCRIPTIVE_LEAD.test(prose.slice(Math.max(0, m.index - 28), m.index))) continue;
    return true;
  }
  return false;
}

/**
 * Issue numbers presented right next to a mutation verb on the same line —
 * "Queued #99", "#51 merged", or a receipt URL. A bare status-list noun
 * ("e.g. proposed, queued, in-progress") or an unrelated number elsewhere in
 * the reply does not count, so describing the backlog never trips the guard.
 */
function numbersClaimedAdjacent(prose: string, verbs: string): Set<number> {
  const verbRe = new RegExp(`\\b(${verbs})\\b`, "gi");
  const nums = new Set<number>();
  for (const line of prose.split("\n")) {
    // Only active-voice verbs count — a verb in descriptive position ("#76 is
    // already queued") names the existing state, not a receipt for this turn.
    const activeAt = [...line.matchAll(verbRe)]
      .filter((vm) => !DESCRIPTIVE_LEAD.test(line.slice(Math.max(0, vm.index - 28), vm.index)))
      .map((vm) => vm.index);
    if (activeAt.length === 0) continue;
    for (const m of line.matchAll(/#(\d+)\b/g)) {
      if (activeAt.some((v) => Math.abs(v - m.index) <= 24)) nums.add(Number(m[1]));
    }
    for (const m of line.matchAll(/\/issues\/(\d+)\b/g)) nums.add(Number(m[1]));
  }
  return nums;
}

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

function hasIssueUrl(text: string, issueNumber: number): boolean {
  return new RegExp(`https://github\\.com/[^\\s)]+/[^\\s)]+/issues/${issueNumber}\\b`).test(text);
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
  const prose = assertedProse(text);
  const presented = issueNumbersIn(prose);
  const proven = provenNumbers(actions);
  const receipts = createReceipts(actions);
  const createdNums = new Set(receipts.map((r) => Number(/^Created issue #(\d+):/.exec(r)![1])));

  // Ground truth beats verb-matching: when a create_issue tool actually RAN and
  // FAILED this turn, any reply that then presents issue numbers no successful
  // tool produced is fabricating a result — however it's phrased. The completion-
  // verb list below can't enumerate every wording ("placed in zenod/zenod", "set
  // up", "cross-linked"), but a recorded create failure can. This catches the
  // "All five tickets placed in zenod/zenod → #1..#5" bug, where create_issue
  // 404'd on a non-existent repo yet the model still narrated success with
  // invented numbers and cross-link confirmations.
  const createFailed = createError(actions);
  if (createFailed && createdNums.size === 0) {
    const unbacked = [...presented].filter((n) => !proven.has(n));
    if (unbacked.length > 0) {
      return [
        `⚠️ Correction — no GitHub issue was created. ${fmt(unbacked)} ${unbacked.length > 1 ? "were" : "was"} not filed by this request (ignore the issue details below).`,
        `The create step failed: ${createFailed}`,
        "Nothing was filed — want me to create it now?",
        "",
        text,
      ].join("\n");
    }
  }

  // Only police active claims the model makes about THIS turn. Read-only
  // mentions ("what's the status of #44"), capability descriptions ("issues are
  // created with status:proposed"), and quoted history (a blockquoted past
  // receipt) are left alone — they don't assert a mutation just happened.
  if (!hasActiveClaim(prose, MUTATION_VERBS)) return text;

  const claimsCreation = hasActiveClaim(prose, CREATION_VERBS) && (presented.size > 0 || /\b(issue|ticket)\b/i.test(prose));

  // The demonstrated bug: a creation is claimed but nothing was created. A status
  // summary grounded in real tool data is NOT that — a query_backlog table whose
  // cell reads "Just created & queued" describes an issue's history, and every
  // number it cites is backed by the query result. Only flag a fabricated
  // creation when a cited number is unbacked by any tool this turn, or when a
  // creation is claimed with no number at all.
  const unprovenPresented = [...presented].filter((n) => !proven.has(n));
  const fabricatedCreation = presented.size === 0 || unprovenPresented.length > 0;
  if (claimsCreation && createdNums.size === 0 && fabricatedCreation) {
    const lines = [
      unprovenPresented.length > 0
        ? `⚠️ Correction — no GitHub issue was created. ${fmt(unprovenPresented)} ${unprovenPresented.length > 1 ? "were" : "was"} not filed by this request (ignore the issue details below).`
        : "⚠️ Correction — no GitHub issue was created by this request (ignore any claim below that one was filed).",
    ];
    const err = createError(actions);
    if (err) lines.push(`The create step failed: ${err}`);
    lines.push("Nothing was filed — want me to create it now?");
    return `${lines.join("\n")}\n\n${text}`;
  }

  // A creation did happen, but the reply points at a different number than the
  // one actually created (e.g. said #58, really created #61).
  if (claimsCreation && createdNums.size > 0 && presented.size > 0 && ![...createdNums].some((n) => presented.has(n))) {
    return `⚠️ Correction — the issue I actually created is below; the number cited in the text is wrong:\n${receipts.join("\n")}\n\n${text}`;
  }

  // A creation did happen and the number is right (or omitted), but the model's
  // prose dropped the direct URL. Preserve the reply while making the durable
  // GitHub receipt impossible to miss in WhatsApp and other plain-text channels.
  if (claimsCreation && receipts.length > 0) {
    const missingReceipts = receipts.filter((receipt) => {
      const issueNumber = Number(/^Created issue #(\d+):/.exec(receipt)![1]);
      return !hasIssueUrl(prose, issueNumber);
    });
    if (missingReceipts.length > 0) return `${missingReceipts.join("\n")}\n\n${text}`;
  }

  // Any other mutation claim that cites an issue number no tool produced or
  // touched this turn (fabricated queue/merge/label receipts) — but only a
  // number presented right next to the verb, not one merely mentioned nearby.
  const unproven = [...numbersClaimedAdjacent(prose, MUTATION_VERBS)].filter((n) => !proven.has(n));
  if (unproven.length > 0) {
    return `⚠️ Correction — I couldn't confirm ${fmt(unproven)} against the backlog this turn, so don't rely on ${unproven.length > 1 ? "those references" : "that reference"}.\n\n${text}`;
  }

  return text;
}
