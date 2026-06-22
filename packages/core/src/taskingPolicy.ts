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
  input?: Record<string, unknown>;
  result: string;
}

const READ_ONLY_REQUEST_RE =
  /\b(read[- ]only|do not mutate|don't mutate|do not change|don't change|do not edit|don't edit|do not close|don't close|no mutation|no mutations|just (?:check|read|search|find|list|show|tell)|what (?:is|are)|status of|what's the status|show me|tell me about)\b/i;
const EXECUTION_STATUS_REQUEST_RE =
  /(?:^\s*(?:did|was|is|has|have|what(?:'s| is))\b[\s\S]{0,80}\b(?:run|ran|running|execut(?:e|ed|ion)|queued|picked up|pickup|started|launched|dispatched|blocked|completed|finished|status)\b|\b(?:execution|run|runner|queue)\s+status\b|\bstatus\b[\s\S]{0,80}\b(?:run|ran|running|execut(?:e|ed|ion)|queued|picked up|pickup|started|launched|dispatched|blocked|completed|finished)\b)/i;

function normalizedToolName(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPeerMutationTool(tool: string): boolean {
  const normalized = normalizedToolName(tool);
  return (
    normalized === "askarchus" ||
    normalized === "openissue" ||
    normalized === "editissue" ||
    normalized === "closeissue" ||
    normalized === "archusrequestbacklogaction" ||
    normalized === "archusrunissue" ||
    normalized === "queueexecution" ||
    normalized === "approveexecution" ||
    normalized === "posttweet" ||
    normalized === "postreddit" ||
    normalized === "sendemail" ||
    normalized === "delivertoprincipal" ||
    normalized === "raiseevent"
  );
}

function hasAnyArchusWriteIntent(request: string): boolean {
  return (
    /\b(create|open|file|log|raise|add)\b[\s\S]{0,80}\b(issue|ticket|bug|backlog)\b/i.test(request) ||
    /\b(edit|update|change|comment|label|rename|patch|close)\b[\s\S]{0,100}\b(issue|ticket|#\d+|github)\b/i.test(request) ||
    /\b(run|execute|start|queue|launch|dispatch|approve)\b[\s\S]{0,100}\b(issue|ticket|#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\b/i.test(
      request,
    )
  );
}

function hasExplicitMutationIntent(tool: string, request: string): boolean {
  const normalized = normalizedToolName(tool);
  if (normalized === "askarchus") return false;
  if (normalized === "closeissue") {
    return (
      /\b(close|archive)\b[\s\S]{0,80}\b(issue|ticket|#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\b/i.test(request) ||
      /\bmark\s+(?:it|issue|ticket|#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)?\s*(?:as\s+)?(?:done|complete|completed|closed)\b/i.test(
        request,
      )
    );
  }
  if (normalized === "openissue") {
    return /\b(create|open|file|log|raise|add)\b[\s\S]{0,80}\b(issue|ticket|bug|backlog)\b/i.test(request);
  }
  if (normalized === "editissue") {
    return /\b(edit|update|change|comment|label|rename|patch)\b[\s\S]{0,100}\b(issue|ticket|#\d+|github)\b/i.test(request);
  }
  if (normalized === "archusrequestbacklogaction") {
    return (
      /\b(create|open|file|log|raise|add)\b[\s\S]{0,80}\b(issue|ticket|bug|backlog)\b/i.test(request) ||
      /\b(edit|update|change|comment|label|rename|patch|close)\b[\s\S]{0,100}\b(issue|ticket|#\d+|github)\b/i.test(request)
    );
  }
  if (normalized === "archusrunissue" || normalized === "queueexecution" || normalized === "approveexecution") {
    return (
      !EXECUTION_STATUS_REQUEST_RE.test(request) &&
      /\b(run|execute|start|queue|launch|dispatch|approve)\b[\s\S]{0,100}\b(issue|ticket|#\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\b/i.test(
        request,
      )
    );
  }
  if (normalized === "posttweet" || normalized === "postreddit") {
    return /\b(post|publish|send)\b/i.test(request);
  }
  if (normalized === "sendemail") {
    return /\b(send|email|mail)\b/i.test(request);
  }
  if (normalized === "delivertoprincipal" || normalized === "raiseevent") {
    return /\b(notify|alert|send|raise|tell\s+Jordi)\b/i.test(request);
  }
  return false;
}

/**
 * Peer write tools are real side effects routed through other agents. The model
 * may invent a write subtask during a read-only/status turn; block that before
 * it reaches the peer. Prose reconciliation can correct claims, but it cannot
 * undo a closed issue or sent message.
 */
export function peerMutationGuardFailure(tool: string, userRequest: string): string | null {
  if (!isPeerMutationTool(tool)) return null;
  const normalized = normalizedToolName(tool);
  if (normalized === "askarchus" && hasAnyArchusWriteIntent(userRequest)) {
    return `Blocked ${tool}: explicit backlog writes/runs must use the dedicated Archus write/run tool, not ask_archus.`;
  }
  const explicitMutation = hasExplicitMutationIntent(tool, userRequest);
  if (READ_ONLY_REQUEST_RE.test(userRequest) && !explicitMutation) {
    return `Blocked ${tool}: the user's current request is read-only/status-oriented, so mutating peer tools are not allowed this turn.`;
  }
  if (!explicitMutation) {
    return `Blocked ${tool}: mutating peer tools require an explicit write/run/send instruction from the user's current message.`;
  }
  return null;
}

export function coerceEditIssueLabelsForUserRequest(
  userRequest: string,
  labelsAdd: string[] | null | undefined,
  labelsSet: string[] | null | undefined,
): { labelsAdd: string[] | null | undefined; labelsSet: string[] | null | undefined } {
  if (!labelsSet?.length || labelsAdd?.length) return { labelsAdd, labelsSet };
  const asksToAddLabels = /\badd\b[\s\S]{0,40}\blabels?\b|\blabels?\b[\s\S]{0,40}\badd\b/i.test(userRequest);
  const asksToReplaceLabels = /\b(set|replace)\b[\s\S]{0,40}\blabels?\b|\blabels?\b[\s\S]{0,40}\b(exactly|only)\b/i.test(userRequest);
  if (!asksToAddLabels || asksToReplaceLabels) return { labelsAdd, labelsSet };
  return { labelsAdd: labelsSet, labelsSet: null };
}

// Perfective mutation verbs. Offers ("want me to create…", "I'll open…") use
// other forms and don't trip the guard.
const MUTATION_VERBS = "created|filed|opened|raised|logged|placed|queued|merged|approved|closed|edited|updated|commented|labeled|labelled";
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

function isCreateReceiptTool(tool: string): boolean {
  const normalized = tool.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "createissue" || normalized === "openissue" || normalized === "archusrequestbacklogaction";
}

function normalizedCreateReceipt(action: RecordedAction): string | null {
  if (!isCreateReceiptTool(action.tool)) return null;
  if (/^ERROR:/.test(action.result)) return null;
  const legacy = /^Created issue #(\d+):\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(action.result);
  if (legacy) return action.result;
  if (!/^\s*(?:Created|Issue created)\b/i.test(action.result)) return null;
  const urlMatch = /https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/(\d+)\b/.exec(action.result);
  if (!urlMatch) return null;
  return `Created issue #${urlMatch[1]}: ${urlMatch[0]}`;
}

/** Full success receipts from issue-create calls (carry the real number + url). */
function createReceipts(actions: ReadonlyArray<RecordedAction>): string[] {
  return actions.map(normalizedCreateReceipt).filter((receipt): receipt is string => Boolean(receipt));
}

interface IssueWriteReceipt {
  verb: "created" | "edited" | "closed" | "labeled";
  issueNumber: number;
  url: string;
}

interface ExecutionWriteReceipt {
  verb: "queued" | "approved";
  target: string;
  issueNumber: number;
  url: string;
}

function issueWriteReceipt(action: RecordedAction): IssueWriteReceipt | null {
  if (/^ERROR:/.test(action.result)) return null;
  const created = normalizedCreateReceipt(action);
  if (created) {
    const match = /^Created issue #(\d+):\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(created);
    return match ? { verb: "created", issueNumber: Number(match[1]), url: match[2]! } : null;
  }
  const edited = /^Edited #(\d+)(?:\s+\([^)]+\))?:\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(action.result);
  if (edited) return { verb: "edited", issueNumber: Number(edited[1]), url: edited[2]! };
  const closed = /^Closed #(\d+):\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(action.result);
  if (closed) return { verb: "closed", issueNumber: Number(closed[1]), url: closed[2]! };
  const labeled = /^Labeled issue #(\d+):\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(action.result);
  if (labeled) return { verb: "labeled", issueNumber: Number(labeled[1]), url: labeled[2]! };
  return null;
}

function issueWriteReceipts(actions: ReadonlyArray<RecordedAction>): IssueWriteReceipt[] {
  return actions.map(issueWriteReceipt).filter((receipt): receipt is IssueWriteReceipt => Boolean(receipt));
}

function executionWriteReceipt(action: RecordedAction): ExecutionWriteReceipt | null {
  if (/^ERROR:/.test(action.result)) return null;
  const queued = /^Minted execution ticket\s+([^#\s]+\/[^#\s]+)#(\d+)\b[\s\S]*?:\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(
    action.result,
  );
  if (queued) return { verb: "queued", target: `${queued[1]}#${queued[2]}`, issueNumber: Number(queued[2]), url: queued[3]! };
  const approved = /^Approved execution\s+([^#\s]+\/[^#\s]+)#(\d+)\b[\s\S]*?:\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(
    action.result,
  );
  if (approved) return { verb: "approved", target: `${approved[1]}#${approved[2]}`, issueNumber: Number(approved[2]), url: approved[3]! };
  return null;
}

function executionWriteReceipts(actions: ReadonlyArray<RecordedAction>): ExecutionWriteReceipt[] {
  return actions.map(executionWriteReceipt).filter((receipt): receipt is ExecutionWriteReceipt => Boolean(receipt));
}

function hasIssueUrl(text: string, issueNumber: number): boolean {
  return new RegExp(`https://github\\.com/[^\\s)]+/[^\\s)]+/issues/${issueNumber}\\b`).test(text);
}

function markdownIssueReceipt(receipt: string): string {
  const match = /^Created issue #(\d+):\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/.exec(receipt);
  if (!match) return receipt;
  return `Created issue [#${match[1]}](${match[2]})`;
}

function markdownWriteReceipt(receipt: IssueWriteReceipt): string {
  const label = {
    created: "Created issue",
    edited: "Edited issue",
    closed: "Closed issue",
    labeled: "Labeled issue",
  }[receipt.verb];
  return `${label} [#${receipt.issueNumber}](${receipt.url})`;
}

function markdownExecutionReceipt(receipt: ExecutionWriteReceipt): string {
  const label = receipt.verb === "queued" ? "Queued execution" : "Approved execution";
  return `${label} [${receipt.target}](${receipt.url})`;
}

function createError(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const failed = [...actions].reverse().find((action) => isCreateReceiptTool(action.tool) && /^ERROR:/.test(action.result));
  return failed?.result.replace(/^ERROR:\s*/, "");
}

function queueExecutionError(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const failed = [...actions]
    .reverse()
    .find((action) => {
      const normalized = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (normalized === "queueexecution" || normalized === "archusrunissue") && /^ERROR:/.test(action.result);
    });
  return failed?.result.replace(/^ERROR:\s*/, "");
}

const fmt = (nums: number[]): string => nums.map((n) => `#${n}`).join(", ");

const EXECUTION_STATUS_WORDS =
  "queued|running|needs-review|approved|blocked|done|failed|picked up|started|launched|dispatched|ran|executed";
const EXECUTION_STATE_RE = new RegExp(
  [
    String.raw`\b(exec:(?:queued|running|needs-review|approved|blocked|done)|queued for execution|runner\s+(?:picked up|started|launched|reported|blocked)|running|picked up|dispatched|launched|started|ran|did(?: not|n't) run)\b`,
    String.raw`\b(?:execution ticket|execution)[^\n.]{0,80}\b(?:${EXECUTION_STATUS_WORDS})\b`,
    String.raw`\b(?:${EXECUTION_STATUS_WORDS})[^\n.]{0,80}\b(?:execution ticket|execution)\b`,
  ].join("|"),
  "i",
);
const NEGATIVE_QUEUE_RE =
  /\b(?:no|never|did(?: not|n't))\b[\s\S]{0,80}\b(?:run|ran|running|picked up|dispatched|launched|started)\b|\bnot\b[\s\S]{0,80}\b(?:running|picked up|dispatched|launched|started)\b/i;
const NEGATIVE_CREATED_QUEUED_RE = /\b(?:no|not|never)\b[\s\S]{0,80}\bcreated\b[\s\S]{0,80}\bqueued\b/i;

function claimsExecutionState(prose: string): boolean {
  if (!EXECUTION_STATE_RE.test(prose) && !NEGATIVE_QUEUE_RE.test(prose) && !NEGATIVE_CREATED_QUEUED_RE.test(prose)) return false;
  return issueNumbersIn(prose).size > 0 || /\b(issue|ticket|execution|epaminon|runner)\b/i.test(prose);
}

function hasExecutionGrounding(actions: ReadonlyArray<RecordedAction>): boolean {
  return actions.some((action) => {
    if (/^ERROR:/.test(action.result)) return false;
    const tool = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      tool === "queueexecution" ||
      tool === "executionstatus" ||
      tool === "epaminonreadissueexecutionstatus" ||
      tool === "approveexecution"
    ) return true;
    return /\b(exec:(?:queued|running|needs-review|approved|blocked|done)|Minted execution ticket|Execution \d+|Epaminon)\b/i.test(
      action.result,
    );
  });
}

function executionStatusToolName(tool: string): boolean {
  const normalized = tool.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "executionstatus" || normalized === "epaminonreadissueexecutionstatus";
}

function actionInputText(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  return Object.values(input)
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join("\n");
}

function noExecutionNumbers(actions: ReadonlyArray<RecordedAction>): Set<number> {
  const nums = new Set<number>();
  for (const action of actions) {
    if (!executionStatusToolName(action.tool)) continue;
    if (!/\bNo execution tickets\b/i.test(action.result)) continue;
    for (const n of issueNumbersIn(actionInputText(action.input))) nums.add(n);
  }
  return nums;
}

const POSITIVE_EXECUTION_RE =
  /\b(?:ran|executed|completed|finished|done|succeeded|opened\s+PR|pull request|files?\s+changed|changed\s+files?|merged|needs-review|awaiting review)\b/i;
const NEGATIVE_EXECUTION_LINE_RE = /\b(?:no|not|never|without|none|does(?: not|n't)|did(?: not|n't))\b/i;

function claimsPositiveExecutionForNoExecutionTarget(prose: string, noExecNums: ReadonlySet<number>): number[] {
  const contradicted = new Set<number>();
  for (const line of prose.split("\n")) {
    if (!POSITIVE_EXECUTION_RE.test(line)) continue;
    if (NEGATIVE_EXECUTION_LINE_RE.test(line)) continue;
    const lineNums = issueNumbersIn(line);
    for (const n of noExecNums) {
      if (lineNums.has(n)) contradicted.add(n);
    }
  }
  return [...contradicted];
}

function isSameTurnCreateWithoutExecutionReceipt(prose: string, presented: ReadonlySet<number>, createdNums: ReadonlySet<number>): boolean {
  if (createdNums.size === 0) return false;
  if (!hasActiveClaim(prose, CREATION_VERBS)) return false;
  if (!NEGATIVE_QUEUE_RE.test(prose) && !NEGATIVE_CREATED_QUEUED_RE.test(prose)) return false;
  if (presented.size === 0) return true;
  return [...createdNums].some((n) => presented.has(n));
}

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
  const writeReceipts = issueWriteReceipts(actions);
  const executionReceipts = executionWriteReceipts(actions);
  const createdNums = new Set(receipts.map((r) => Number(/^Created issue #(\d+):/.exec(r)![1])));
  const executionGrounded = hasExecutionGrounding(actions);
  const noExecNums = noExecutionNumbers(actions);
  const contradictedNoExecution = claimsPositiveExecutionForNoExecutionTarget(prose, noExecNums);

  if (contradictedNoExecution.length > 0) {
    return [
      `⚠️ Correction — Epaminon's live execution read found no execution ticket for ${fmt(contradictedNoExecution)} this turn.`,
      "Do not treat issue-body comments, child-ticket notes, PR references, or narrative history as proof that this specific issue ran.",
      "",
      text,
    ].join("\n");
  }

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

  // Execution state is not ordinary backlog state. A reply like "No, #108/#109
  // were not created or queued" must be grounded in Epaminon's live execution
  // read, not stale chat memory or an Archus paraphrase.
  if (claimsExecutionState(prose) && !executionGrounded && !isSameTurnCreateWithoutExecutionReceipt(prose, presented, createdNums)) {
    const nums = [...presented];
    const lines = [
      `⚠️ Correction — I couldn't confirm execution state${nums.length ? ` for ${fmt(nums)}` : ""} this turn, so don't rely on the run/pickup claim below.`,
      "Execution status answers need a same-turn queue_execution receipt or live execution_status result.",
    ];
    const queueErr = queueExecutionError(actions);
    if (queueErr) lines.push(`The queue step failed: ${queueErr}`);
    return [...lines, "", text].join("\n");
  }

  if (claimsExecutionState(prose) && executionReceipts.length > 0) {
    const missingExecutionReceipts = executionReceipts.filter((receipt) => !hasIssueUrl(prose, receipt.issueNumber));
    if (missingExecutionReceipts.length > 0) return `${missingExecutionReceipts.map(markdownExecutionReceipt).join("\n")}\n\n${text}`;
  }

  // Only police active claims the model makes about THIS turn. Read-only
  // mentions ("what's the status of #44"), capability descriptions ("issues are
  // created with status:proposed"), and quoted history (a blockquoted past
  // receipt) are left alone — they don't assert a mutation just happened.
  if (!hasActiveClaim(prose, MUTATION_VERBS)) return text;

  const claimsCreation =
    hasActiveClaim(prose, CREATION_VERBS) &&
    (presented.size > 0 || /\b(issue|ticket)\b/i.test(prose)) &&
    !(executionGrounded && /\bexecution ticket\b/i.test(prose));

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
    return `⚠️ Correction — the issue I actually created is below; the number cited in the text is wrong:\n${receipts.map(markdownIssueReceipt).join("\n")}\n\n${text}`;
  }

  // A creation did happen and the number is right (or omitted), but the model's
  // prose dropped the direct URL. Preserve the reply while making the durable
  // GitHub receipt impossible to miss in WhatsApp and other plain-text channels.
  if (claimsCreation && receipts.length > 0) {
    const missingReceipts = receipts.filter((receipt) => {
      const issueNumber = Number(/^Created issue #(\d+):/.exec(receipt)![1]);
      return !hasIssueUrl(prose, issueNumber);
    });
    if (missingReceipts.length > 0) return `${missingReceipts.map(markdownIssueReceipt).join("\n")}\n\n${text}`;
  }

  const missingWriteReceipts = writeReceipts.filter((receipt) => !hasIssueUrl(prose, receipt.issueNumber));
  if (missingWriteReceipts.length > 0) return `${missingWriteReceipts.map(markdownWriteReceipt).join("\n")}\n\n${text}`;

  // Any other mutation claim that cites an issue number no tool produced or
  // touched this turn (fabricated queue/merge/label receipts) — but only a
  // number presented right next to the verb, not one merely mentioned nearby.
  const unproven = [...numbersClaimedAdjacent(prose, MUTATION_VERBS)].filter(
    (n) => !proven.has(n) && !(executionGrounded && noExecNums.has(n) && NEGATIVE_QUEUE_RE.test(prose)),
  );
  if (unproven.length > 0) {
    return `⚠️ Correction — I couldn't confirm ${fmt(unproven)} against the backlog this turn, so don't rely on ${unproven.length > 1 ? "those references" : "that reference"}.\n\n${text}`;
  }

  return text;
}
