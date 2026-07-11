import {
  consumeApprovalToken,
  hasValidApprovalToken,
  registerApprovalToken,
  registerOutboundComposeApprovalToken,
} from "./approvalTokens.js";
import { toolKind } from "./toolKinds.js";

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
  /\b(read[- ]only|do not mutate|don't mutate|do not change|don't change|do not create|don't create|do not open|don't open|do not file|don't file|do not edit|don't edit|do not close|don't close|no mutation|no mutations|just (?:check|read|search|find|list|show|tell)|what (?:is|are|would)|what would|status of|what's the status|show me|tell me about|need(?:s|ed)?\s+(?:context|info|information|details|background)|(?:context|(?:more\s+)?(?:info|information|details|background))\s+on)\b/i;
const EXECUTION_STATUS_REQUEST_RE =
  /(?:^\s*(?:did|was|is|has|have|what(?:'s| is))\b[\s\S]{0,80}\b(?:run|ran|running|execut(?:e|ed|ion)|queued|picked up|pickup|started|launched|dispatched|blocked|completed|finished|status)\b|\b(?:execution|run|runner|queue)\s+status\b|\bstatus\b[\s\S]{0,80}\b(?:run|ran|running|execut(?:e|ed|ion)|queued|picked up|pickup|started|launched|dispatched|blocked|completed|finished)\b)/i;
const QUALIFIED_ISSUE_REF_RE = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+\b/;

export function normalizedToolName(tool: string): string {
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

// A negation anywhere near a verb ("don't send it", "no, cancel that post") must
// never read as an explicit instruction to mutate, even though the bare verb
// ("send", "post") appears in the message. Shared by hasExplicitMutationIntent's
// outbound-send checks and isAffirmativeApproval below.
const NEGATION_RE = /\b(?:no|not|don'?t|won'?t|never|cancel|stop|abort|nvm|nevermind|hold on|wait)\b/i;

/** True when `verbs` (a global regex) matches somewhere in `request` with no negation word in the ~20 chars before it. */
function hasUnnegatedVerb(request: string, verbs: RegExp): boolean {
  for (const m of request.matchAll(verbs)) {
    const lead = request.slice(Math.max(0, m.index! - 20), m.index);
    if (!NEGATION_RE.test(lead)) return true;
  }
  return false;
}

const POST_VERB_RE = /\b(?:post|publish|send)\b/gi;
const EMAIL_VERB_RE = /\b(?:send|email|mail)\b/gi;
const DYNAMIC_MUTATION_VERB_RE = /\b(?:run|execute|write|create|update|delete|send|post|publish)\b/gi;
const INTENT_CLAUSE_BOUNDARY_RE = /[.;!?]|\b(?:but|however|instead|then)\b/gi;

/** A positive dynamic-tool verb whose current clause has not entered a negated scope. */
function hasExplicitDynamicMutationVerb(request: string): boolean {
  for (const match of request.matchAll(DYNAMIC_MUTATION_VERB_RE)) {
    const beforeVerb = request.slice(0, match.index!);
    let clauseStart = 0;
    for (const boundary of beforeVerb.matchAll(INTENT_CLAUSE_BOUNDARY_RE)) {
      clauseStart = boundary.index! + boundary[0].length;
    }
    if (!NEGATION_RE.test(beforeVerb.slice(clauseStart))) return true;
  }
  return false;
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
    return hasUnnegatedVerb(request, POST_VERB_RE);
  }
  if (normalized === "sendemail") {
    return hasUnnegatedVerb(request, EMAIL_VERB_RE);
  }
  if (normalized === "delivertoprincipal" || normalized === "raiseevent") {
    return /\b(notify|alert|send|raise|tell\s+Jordi)\b/i.test(request);
  }
  return false;
}

// M-1 — outbound sends accept a standing-draft approval token in place of an
// explicit write verb (see approvalTokens.ts). Scoped to the outbound send tools
// only: these are the tools whose result text is delivered to the user VERBATIM
// (replyGate.ts's ACTION_TOOL_NAMES), so a blocked call here either renders as a
// friendly draft-approval prompt or resolves to a real send — never a raw error.
const OUTBOUND_SEND_TOOL_NAMES = new Set(["posttweet", "postreddit", "sendemail"]);

const AFFIRMATIVE_APPROVAL_RE =
  /^\s*(?:[\w'-]+\s+){0,3}?(?:approved?|confirmed?|go\s*ahead|do\s+it|send\s+it|post\s+it|ship\s+it|yes|yep|yeah|ok(?:ay)?|sounds?\s+good|looks?\s+good)[.!]*\s*$/i;

/** True for a short natural-language affirmative ("approved", "Tweet approved", "send it") — never a full sentence, never a negation. */
export function isAffirmativeApproval(userRequest: string): boolean {
  const trimmed = userRequest.trim();
  if (NEGATION_RE.test(trimmed)) return false;
  return AFFIRMATIVE_APPROVAL_RE.test(trimmed);
}

/** True when a call to an outbound send tool carries an actual draft (not an empty/bare call). */
function hasSubstantiveDraftContent(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  return Object.values(args).some((value) => typeof value === "string" && value.trim().length > 0);
}

/**
 * peerMutationGuardFailure's sentinel result for "an affirmative resolved no standing
 * draft" (no token, or a token for different content/tool). The caller renders this as
 * the honest zero-state ("Nothing pending to approve.") rather than the generic block —
 * distinct from the ordinary "no explicit verb" block, which doubles as issuing a new
 * draft-approval prompt (registers a token) when the call carries real content.
 */
export const NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL = "__nothing_pending_to_approve__";

/** The single canonical zero-state reply text — shared so it can never drift between the guard, the reply-gate fallback, and the outbound receipt renderer. */
export const NOTHING_PENDING_TO_APPROVE_TEXT = "Nothing pending to approve.";

export interface PeerMutationGuardContext {
  /** Conversation this call belongs to — required for the standing-draft token to apply. */
  conversationId?: string | undefined;
  /** The tool-call arguments this attempt carries (the draft content, for outbound sends). */
  args?: Record<string, unknown> | undefined;
  /** Dynamic MCP tools are classified by their advertised annotations. */
  forceMutation?: boolean | undefined;
}

/**
 * Peer write tools are real side effects routed through other agents. The model
 * may invent a write subtask during a read-only/status turn; block that before
 * it reaches the peer. Prose reconciliation can correct claims, but it cannot
 * undo a closed issue or sent message.
 */
export function peerMutationGuardFailure(tool: string, userRequest: string, context?: PeerMutationGuardContext): string | null {
  const legacyMutationTool = isPeerMutationTool(tool);
  if (!context?.forceMutation && !legacyMutationTool) return null;
  const normalized = normalizedToolName(tool);
  if (normalized === "askarchus" && hasAnyArchusWriteIntent(userRequest) && !READ_ONLY_REQUEST_RE.test(userRequest)) {
    return `Blocked ${tool}: explicit backlog writes/runs must use the dedicated Archus write/run tool, not ask_archus.`;
  }
  if (normalized === "askarchus") return null;
  if (normalized === "archusrunissue" && !QUALIFIED_ISSUE_REF_RE.test(userRequest)) {
    return `Blocked ${tool}: running requires an exact work issue already named by the user as owner/repo#N. For create-and-run requests, send the full natural-language request to Archus instead of inventing a target.`;
  }
  const explicitDynamicMutation = Boolean(
    context?.forceMutation &&
      !legacyMutationTool &&
      !READ_ONLY_REQUEST_RE.test(userRequest) &&
      !EXECUTION_STATUS_REQUEST_RE.test(userRequest) &&
      hasExplicitDynamicMutationVerb(userRequest),
  );
  const explicitMutation = hasExplicitMutationIntent(tool, userRequest) || explicitDynamicMutation;
  if (READ_ONLY_REQUEST_RE.test(userRequest) && !explicitMutation) {
    return `Blocked ${tool}: the user's current request is read-only/status-oriented, so mutating peer tools are not allowed this turn.`;
  }
  if (explicitMutation) return null;

  if (OUTBOUND_SEND_TOOL_NAMES.has(normalized) && context?.conversationId) {
    const { conversationId, args } = context;
    if (isAffirmativeApproval(userRequest)) {
      if (hasValidApprovalToken(conversationId, normalized, args)) {
        consumeApprovalToken(conversationId);
        return null;
      }
      return NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL;
    }
    if (hasSubstantiveDraftContent(args)) {
      // Issuing this block IS the draft-approval prompt — register the token so a
      // later affirmative on this exact draft resolves without needing a write verb.
      registerApprovalToken(conversationId, normalized, args);
    }
  }

  // #256 · C-19 · doctrine rule 7 — backlog peer writes (open_issue, edit_issue,
  // close_issue, archus_request_backlog_action) carry semantic mutation intent even
  // without a canonical write verb ("jot a note on #253", "log this on #12"). The
  // read-only guard above already blocks pure status turns, and outbound sends stay
  // approval-gated in their own branch; there is no magic word to require here. Allow
  // the write — reconcileTaskingReply (#257) makes a blocked/failed result impossible
  // to render as a fabricated success, so honesty is structural, not keyword-gated.
  if (
    normalized === "openissue" ||
    normalized === "editissue" ||
    normalized === "closeissue" ||
    normalized === "archusrequestbacklogaction"
  ) {
    return null;
  }

  return `Blocked ${tool}: mutating peer tools require an explicit write/run/send instruction from the user's current message.`;
}

/**
 * P-1 — ask_outbound composes a draft through Callistheness (the outbound peer) but
 * never sends, so it is not a peer-mutation tool and peerMutationGuardFailure never
 * runs for it: no token was ever registered, and a later "Tweet approved" that resolves
 * to a direct post_tweet/post_reddit/send_email call found nothing pending — the token
 * and the standing draft lived in different places. Any substantive ask_outbound call
 * now registers a standing compose-approval on the SAME conversation-scoped store the
 * direct-ask path uses, so a following natural-language affirmative for ANY outbound
 * send tool resolves it (see approvalTokens.ts's anyOutboundSend).
 */
export function registerOutboundComposeApproval(
  conversationId: string | undefined,
  tool: string,
  args: Record<string, unknown> | undefined,
): void {
  if (!conversationId) return;
  if (normalizedToolName(tool) !== "askoutbound") return;
  if (!hasSubstantiveDraftContent(args)) return;
  registerOutboundComposeApprovalToken(conversationId);
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
const NON_CREATION_MUTATION_VERBS = "queued|merged|approved|closed|edited|updated|commented|labeled|labelled";

// A mutation verb is only a *claim about this turn* when it's active voice. A
// be-verb/modal/infinitive before it marks a description, not a receipt:
// "issues are created with status:proposed", "can be filed", "to open". An
// adverb may sit between the lead and the verb ("#76 is indeed approved",
// "is already queued") — still a state description, not a this-turn receipt —
// so allow one. Without this, listing capabilities, quoting docs, or merely
// confirming a ticket's existing status tripped a false correction.
const DESCRIPTIVE_ADVERBS =
  "indeed|already|now|currently|still|also|truly|certainly|definitely|clearly|recently|just|previously|never";
// Coordinated participles share the same descriptive subject — "is approved/queued",
// "was filed and queued" — so once the head is excused by the be-verb, excuse the
// trailing chain joined by a slash, comma, or and/or too. Otherwise only the first
// participle was treated as a description and the second still tripped a correction.
const DESCRIPTIVE_LEAD = new RegExp(
  `\\b(is|are|was|were|be|been|being|get|gets|got|can|could|will|would|to|cannot|can't|not|never)\\s*` +
    `(?:(?:${DESCRIPTIVE_ADVERBS})\\s+)*` +
    `(?:(?:${MUTATION_VERBS})\\s*(?:[/,]\\s*|\\s+(?:and|or)\\s+))*$`,
  "i",
);
const NEGATED_MUTATION_LEAD = /\b(?:no|not|never|nothing|none|without|did(?: not|n't)|does(?: not|n't)|was(?: not|n't)|were(?: not|n't))\b(?!\s+only\b)[\s\S]{0,48}$/i;

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
    .filter((line) => !TOOL_DESCRIPTION_LIST_ITEM_RE.test(line.trim()))
    .join("\n");
}

/** True when one of `verbs` appears as an active completion claim in `prose`. */
function hasActiveClaim(prose: string, verbs: string): boolean {
  const re = new RegExp(`\\b(${verbs})\\b`, "gi");
  for (const m of prose.matchAll(re)) {
    const lead = prose.slice(Math.max(0, m.index - 48), m.index);
    if (DESCRIPTIVE_LEAD.test(lead) || NEGATED_MUTATION_LEAD.test(lead)) continue;
    return true;
  }
  return false;
}

function hasActiveIssueCreationClaim(prose: string): boolean {
  const noun = "(?:issue|ticket|bug|backlog)";
  const re = new RegExp(`(?:\\b(${CREATION_VERBS})\\b[\\s\\S]{0,80}\\b${noun}\\b|\\b${noun}\\b[\\s\\S]{0,80}\\b(${CREATION_VERBS})\\b)`, "gi");
  for (const m of prose.matchAll(re)) {
    const verbIndex = m.index + m[0].search(new RegExp(`\\b(${CREATION_VERBS})\\b`, "i"));
    const lead = prose.slice(Math.max(0, verbIndex - 48), verbIndex);
    if (DESCRIPTIVE_LEAD.test(lead) || NEGATED_MUTATION_LEAD.test(lead)) continue;
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
      .filter((vm) => {
        const lead = line.slice(Math.max(0, vm.index - 48), vm.index);
        return !DESCRIPTIVE_LEAD.test(lead) && !NEGATED_MUTATION_LEAD.test(lead);
      })
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

interface IssueReadReceipt {
  target: string;
  title: string;
  state: string;
  labels: string;
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

function ranNonCreateIssueWrite(actions: ReadonlyArray<RecordedAction>): boolean {
  return actions.some((action) => {
    const normalized = normalizedToolName(action.tool);
    return normalized === "editissue" || normalized === "closeissue" || normalized === "labelissue";
  });
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

function issueNotFoundReceipts(actions: ReadonlyArray<RecordedAction>): string[] {
  const targets: string[] = [];
  for (const action of actions) {
    if (/^ERROR:/.test(action.result)) continue;
    const match = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\s+was not found in GitHub\b/i.exec(action.result);
    if (match) targets.push(match[1]!);
  }
  return [...new Set(targets)];
}

function issueReadReceipts(actions: ReadonlyArray<RecordedAction>): IssueReadReceipt[] {
  const receipts: IssueReadReceipt[] = [];
  for (const action of actions) {
    if (/^ERROR:/.test(action.result)) continue;
    const match =
      /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\s+-\s+(.+?)\s+-\s+state:\s*([^;]+);\s*labels:\s*([^;]+);\s*updated:\s*.*?\s+-\s*(https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+)\b/i.exec(
        action.result,
      );
    if (match) {
      receipts.push({
        target: match[1]!,
        title: match[2]!,
        state: match[3]!.trim(),
        labels: match[4]!.trim(),
        url: match[5]!,
      });
    }
  }
  return receipts;
}

function isTerseNegativeAnswer(text: string): boolean {
  const normalized = text
    .replace(/\*\*/g, "")
    .replace(/[.!?\s]+$/g, "")
    .trim()
    .toLowerCase();
  return /^(?:no|not found|does not exist|doesn't exist|it does not exist|it doesn't exist)$/.test(normalized);
}

function isOnlyIssueUrl(text: string): boolean {
  return /^https:\/\/github\.com\/[^\s)]+\/[^\s)]+\/issues\/\d+\.?$/i.test(text.trim());
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

// C-15 · #257 — the last ERROR from a NON-create backlog write (edit, comment, close,
// label). open_issue / archus_request_backlog_action are creates (createError owns
// them); this covers the edit/comment/close lanes whose failure otherwise slips past
// the number-adjacency check because the fabricated success often carries no number
// ("Note added", "Done — jotted that down").
function nonCreateWriteError(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const failed = [...actions].reverse().find((action) => {
    const normalized = normalizedToolName(action.tool);
    return (
      (normalized === "editissue" ||
        normalized === "closeissue" ||
        normalized === "labelissue" ||
        normalized === "backlogcomment" ||
        normalized === "backlogedit" ||
        normalized === "backlogclose") &&
      /^ERROR:/.test(action.result)
    );
  });
  return failed?.result.replace(/^ERROR:\s*/, "");
}
// Active-voice success claims for an edit/comment/close write, including the number-less
// phrasings ("Note added", "jotted that down") that NON_CREATION_MUTATION_VERBS misses.
const NON_CREATE_WRITE_CLAIM_VERBS = "added|noted|jotted|logged|commented|updated|edited|closed|labeled|labelled|applied";

function queueExecutionError(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const failed = [...actions]
    .reverse()
    .find((action) => {
      const normalized = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (normalized === "queueexecution" || normalized === "archusrunissue") && /^ERROR:/.test(action.result);
    });
  return failed?.result.replace(/^ERROR:\s*/, "");
}

function blockedConsoleJourney(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const blocked = [...actions].reverse().find((action) => {
    const tool = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
    return tool.startsWith("console") && /\bJourney [^\n]+: blocked\b|\bExecution: [^\n]+ \(blocked\)/i.test(action.result);
  });
  return blocked?.result;
}

function runningEphemeralJourney(actions: ReadonlyArray<RecordedAction>): string | undefined {
  const running = [...actions].reverse().find((action) => {
    const tool = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
    return tool === "consolerunephemeraltask" && /\bQueued ephemeral execution\b[\s\S]+\brunning\b|\bExecution: [^\n]+ \(running\)/i.test(action.result);
  });
  return running?.result;
}

function acknowledgesBlockedJourney(prose: string): boolean {
  return /\b(?:blocked|failed|could(?: not|n't)|unable|did(?: not|n't)|has(?: not|n't)|not completed|not done)\b/i.test(prose);
}

function acknowledgesRunningEphemeral(prose: string): boolean {
  return /\b(?:queued|running|started|execution|epaminon|in progress|not complete|not done)\b/i.test(prose);
}

/**
 * E1-T6 / #234 — the reply already OWNS the honesty gap ("I couldn't read the
 * execution status", "couldn't confirm", "wasn't able to check"). In that case the
 * deterministic ⚠️ Correction banner would only stack a second, redundant hedge on top
 * of an answer that is already honest — the exact spurious-correction-on-read-only
 * symptom. When the model has said it couldn't verify/read, leave its text alone.
 */
function acknowledgesUnreadExecution(prose: string): boolean {
  return (
    /\b(?:couldn['’]?t|could not|can['’]?t|cannot|was(?:n['’]?t| not) able to|unable to)\s+(?:confirm|verify|read|check|tell|determine|access)\b/i.test(
      prose,
    ) ||
    // #581 — honest "the dispatch happened but I can't read terminal status yet" phrasings.
    // When the reply already owns that status is pending, a hedge would just double-hedge a
    // confirmed dispatch.
    /\bno\s+(?:read|status(?:\s+read)?)\s+(?:available|yet)\b|\bstatus\s+(?:is\s+)?(?:pending|not\s+(?:yet\s+)?available)\b|\bnot\s+(?:yet\s+)?confirmed\b|\bawaiting\s+(?:the\s+)?(?:status|read|execution)\b/i.test(
      prose,
    )
  );
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
const GENERIC_NO_SIDE_EFFECT_RE =
  /\bno issues? (?:were |was )?(?:edited|changed|created|closed)(?:[, ]+(?:or|and)?\s*(?:run|queued|edited|changed|created|closed))*\b/i;
const READ_ONLY_CONSTRAINT_LINE_RE = /\b(?:read[- ]only|per (?:your )?(?:explicit )?instruction|no mutations?|no actions?|no side effects?)\b/i;
const GITHUB_ISSUE_LIST_ITEM_RE = /^[-*]\s+.*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+\b/i;
const TOOL_DESCRIPTION_LIST_ITEM_RE = /^[-*]\s+`[a-z0-9_.-]+`\s*:/i;
const DIRECT_EXECUTION_ASSERTION_RE =
  /\b(?:ran via|was run|has run|did run|is running|was running|execution status|no execution|queued for execution|picked up|runner (?:picked up|started|launched|reported|blocked))\b/i;

function executionClaimLines(prose: string): string[] {
  return prose
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !GENERIC_NO_SIDE_EFFECT_RE.test(line))
    .filter((line) => !READ_ONLY_CONSTRAINT_LINE_RE.test(line))
    .filter((line) => !TOOL_DESCRIPTION_LIST_ITEM_RE.test(line))
    .filter((line) => !(GITHUB_ISSUE_LIST_ITEM_RE.test(line) && !DIRECT_EXECUTION_ASSERTION_RE.test(line)))
    .filter((line) => EXECUTION_STATE_RE.test(line) || NEGATIVE_QUEUE_RE.test(line) || NEGATIVE_CREATED_QUEUED_RE.test(line));
}

function claimsExecutionState(prose: string): boolean {
  return executionClaimLines(prose).some((line) => issueNumbersIn(line).size > 0 || /\b(issue|ticket|execution|epaminon|runner)\b/i.test(line));
}

function hasExecutionGrounding(actions: ReadonlyArray<RecordedAction>): boolean {
  return actions.some((action) => {
    if (/^ERROR:/.test(action.result)) return false;
    const tool = action.tool.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      tool === "queueexecution" ||
      tool === "executionstatus" ||
      tool === "epaminonreadissueexecutionstatus" ||
      tool === "epaminonrunexistingissue" ||
      tool === "epaminonrunephemeraltask" ||
      tool === "consolerunephemeraltask" ||
      tool === "consolecreateissuethenrun" ||
      tool === "consolecreateissuesthenrun" ||
      tool === "runephemeraltask" ||
      tool === "approveexecution"
    ) return true;
    // #581 — a CONFIRMED DISPATCH grounds the run/pickup claim (a dispatch receipt is real
    // evidence the run was queued/dispatched). Recognizes the create-and-run / ephemeral
    // dispatch receipts ("dispatched execution direct-…", "Dispatched Epaminon worker …
    // (execution …)") so the hedge never DISCLAIMS a real dispatch — it may still hedge an
    // ungrounded TERMINAL claim (done/failed) via hasTerminalExecutionGrounding.
    return /\b(exec:(?:queued|running|needs-review|approved|blocked|done)|Minted execution ticket|Execution \d+|Epaminon|dispatched execution|execution\s+(?:direct|ephemeral)-|Dispatched\b[\s\S]{0,60}\bexecution\b|run_ephemeral_task)\b/i.test(
      action.result,
    );
  });
}

const TERMINAL_EXECUTION_RE = new RegExp(
  [
    String.raw`\bexecution\s+(?:complete|completed|done|finished|succeeded|failed)\b`,
    String.raw`\b(?:run|execution|executed)[^\n.]{0,80}\b(?:complete|completed|done|finished|succeeded|failed)\b`,
    String.raw`\b(?:complete|completed|done|finished|succeeded|failed)[^\n.]{0,80}\b(?:run|execution|executed)\b`,
    String.raw`\bcreated\s*\+\s*executed\b`,
  ].join("|"),
  "i",
);

function claimsTerminalExecutionState(prose: string): boolean {
  return prose
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !GENERIC_NO_SIDE_EFFECT_RE.test(line))
    .filter((line) => !(GITHUB_ISSUE_LIST_ITEM_RE.test(line) && !DIRECT_EXECUTION_ASSERTION_RE.test(line)))
    .some((line) => TERMINAL_EXECUTION_RE.test(line) && (issueNumbersIn(line).size > 0 || /\b(issue|ticket|execution|epaminon|runner)\b/i.test(line)));
}

function hasTerminalExecutionGrounding(actions: ReadonlyArray<RecordedAction>): boolean {
  return actions.some((action) => {
    if (/^ERROR:/.test(action.result) || !executionStatusToolName(action.tool)) return false;
    return /\b(?:exec:)?(?:done|failed)\b|—\s*(?:done|failed)\b|"state"\s*:\s*"(?:done|failed)"/i.test(action.result);
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

// M-6/#234/R17 — read-path honesty. execution_status itself already refuses to say
// "no work ran" when a FILTER emptied a non-empty queue: its own result text carries
// this exact warning (see mcp.ts) telling the caller to broaden the query rather than
// assert an empty world. The demonstrated gap (R17) is that nothing stopped the model
// from ignoring that warning and asserting the negative claim anyway ("no work ran
// this week", "no basis for that"). This is the read-side counterpart to
// claimsPositiveExecutionForNoExecutionTarget above — that catches a false POSITIVE
// against a genuinely empty queue; this catches a false NEGATIVE against a queue the
// tool itself said was non-empty behind the filter.
const FILTERED_EMPTY_WITH_BROADEN_HINT_RE = /Do NOT tell the user nothing ran[\s\S]*broaden the query/i;

function hasUnbroadenedFilteredEmptyExecutionRead(actions: ReadonlyArray<RecordedAction>): boolean {
  return actions.some((action) => {
    if (/^ERROR:/.test(action.result)) return false;
    if (!executionStatusToolName(action.tool)) return false;
    return FILTERED_EMPTY_WITH_BROADEN_HINT_RE.test(action.result);
  });
}

const CLAIMS_EMPTY_EXECUTION_WORLD_RE =
  /\bno\s+(?:work|execution|executions?|runs?|tickets?)\s+(?:ran|has\s+run|have\s+run|happened|occurred)\b|\bnothing\s+(?:has\s+)?ran\b|\bno\s+basis\b/i;

function claimsEmptyExecutionWorld(prose: string): boolean {
  return CLAIMS_EMPTY_EXECUTION_WORLD_RE.test(prose);
}

// P-3 — the status composer must count its own sends. execution_status only knows
// about execution TICKETS; a task that was a direct outbound send (a Phylax/WhatsApp
// message, a tweet) has no ticket at all, so a status summary that only grounds on
// execution_status treats it as unaccounted-for and reports "unexecuted" even though
// the send is right there in the conversation transcript's outbound log (this turn's
// get_recent_conversation_transcript read). Same receipt principle as M-6 applied to
// outbound sends: a read must consult every authoritative source before asserting a
// negative — the transcript log is as authoritative for "was it sent" as execution_status
// is for "did it run".
const OUTBOUND_TRANSCRIPT_LINE_RE = /^\[([^\]]+)\]\s+outbound\b[^\n]*$/im;
const NEGATIVE_TASK_EXECUTION_RE =
  /\b(?:un-?executed|not\s+executed|did(?:n['’]?t| not)\s+(?:run|execute|happen|send|go\s+out)|has(?:n['’]?t| not)\s+(?:run|executed|happened|been\s+sent|sent)|was(?:n['’]?t| not)\s+(?:sent|executed|completed|done|delivered))\b/i;

function claimsUnexecutedTask(prose: string): boolean {
  return NEGATIVE_TASK_EXECUTION_RE.test(prose);
}

interface OutboundSendEvidence {
  at: string;
  messageId?: string;
}

function outboundSendEvidence(actions: ReadonlyArray<RecordedAction>): OutboundSendEvidence[] {
  const evidence: OutboundSendEvidence[] = [];
  for (const action of actions) {
    if (/^ERROR:/.test(action.result)) continue;
    if (normalizedToolName(action.tool) !== "getrecentconversationtranscript") continue;
    for (const line of action.result.split("\n")) {
      const match = OUTBOUND_TRANSCRIPT_LINE_RE.exec(line.trim());
      if (!match) continue;
      const idMatch = /message=([^\s;]+)/.exec(line);
      evidence.push({ at: match[1]!, ...(idMatch ? { messageId: idMatch[1]! } : {}) });
    }
  }
  return evidence;
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

const INTERNAL_TASKING_SECTION_RE = /^\s*(Detected asks|Current intent ledger|Safe action plan):\s*$/i;

function stripInternalTaskingScaffold(text: string): string {
  const lines = text.split("\n");
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent < 0 || !INTERNAL_TASKING_SECTION_RE.test(lines[firstContent]!)) return text;

  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (INTERNAL_TASKING_SECTION_RE.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!line.trim()) continue;
      if (/^\s*\d+\.\s+/.test(line)) continue;
      skipping = false;
    }
    kept.push(line);
  }
  return kept.join("\n").trimStart();
}

/**
 * Reconcile a tasking reply against the tools that actually ran this turn.
 * Returns the reply unchanged when its mutation claims check out, or prepends a
 * correction when it asserts a creation/mutation that no tool result backs.
 * Pure and deterministic so it can be unit-tested against real transcripts.
 */
export function reconcileTaskingReply(text: string, actions: ReadonlyArray<RecordedAction>): string {
  text = stripInternalTaskingScaffold(text);
  const prose = assertedProse(text);
  const presented = issueNumbersIn(prose);
  const proven = provenNumbers(actions);
  const receipts = createReceipts(actions);
  const writeReceipts = issueWriteReceipts(actions);
  // #548 · C-23 hard route — "corrections only correct". A create/mutate correction banner
  // may render only when THIS turn actually attempted a mutation, or when NO tool ran at
  // all (a pure prose hallucination — the WhatsApp #58 bug, empty actions). When a READ
  // tool ran and no mutation was attempted, the reply is a grounded read/summary answer:
  // enumerated issue numbers ("what did I work on this week → #473, #486…") are
  // retrospective, NOT this-turn creates, so the banner must NEVER fire and tell the user
  // to "ignore the details below". The composer-layer grounding leaked this twice (summary
  // numbers sourced from the briefing, not the turn's tool text, read as fabricated
  // creates); this is the structural gate that supersedes it.
  // FP4 · #548 — THE single correction-banner gate. An ungrounded composer correction may
  // render only when THIS turn attempted a mutation (a mutate-kind tool ran, per the
  // toolKinds registry) OR no tool ran at all (a pure prose hallucination — the #58 case,
  // decided by the prose-claim checks below). When every tool this turn was a READ, the
  // reply is a grounded read/summary and NO ungrounded correction may fire on it. Registry-
  // driven, not a name-regex allowlist: an unknown kind fails safe to `mutate`, so an
  // unclassified tool can never hide a real fabrication (C-15). Supersedes the deleted
  // isReadOnlyTaskingTool. This gate governs the UNGROUNDED corrections (create-fabrication,
  // unproven-mutation, and the execution-state HEDGES). It deliberately does NOT gate the
  // grounded-CONTRADICTION banners below (a live read that positively contradicts a claim,
  // the outbound-send log, a blocked/running journey) — those fire on positive evidence,
  // which C-23 permits, and gating them would regress C-06/P-3.
  const mutationAttempted = actions.some((a) => toolKind(a.tool) === "mutate");
  const bannerPermitted = actions.length === 0 || mutationAttempted;
  const executionReceipts = executionWriteReceipts(actions);
  const notFoundReceipts = issueNotFoundReceipts(actions);
  const readReceipts = issueReadReceipts(actions);
  const createdNums = new Set(receipts.map((r) => Number(/^Created issue #(\d+):/.exec(r)![1])));
  const executionGrounded = hasExecutionGrounding(actions);
  const noExecNums = noExecutionNumbers(actions);
  const contradictedNoExecution = claimsPositiveExecutionForNoExecutionTarget(prose, noExecNums);
  const blockedJourney = blockedConsoleJourney(actions);
  const runningEphemeral = runningEphemeralJourney(actions);

  if (blockedJourney && !acknowledgesBlockedJourney(prose)) {
    return [
      "⚠️ Correction — the Console journey blocked; the requested work did not complete.",
      blockedJourney,
    ].join("\n");
  }

  if (runningEphemeral && !acknowledgesRunningEphemeral(prose)) {
    return [
      "⚠️ Correction — the one-off execution is running, not complete yet.",
      "Do not treat the requested output text as the result until Epaminon reports a terminal execution state.",
      runningEphemeral,
    ].join("\n");
  }

  if (contradictedNoExecution.length > 0) {
    return [
      `⚠️ Correction — Epaminon's live execution read found no execution ticket for ${fmt(contradictedNoExecution)} this turn.`,
      "Do not treat issue-body comments, child-ticket notes, PR references, or narrative history as proof that this specific issue ran.",
      "",
      text,
    ].join("\n");
  }

  // M-6/#234/R17 — a filtered-empty execution_status read (the tool's own result says
  // the queue is non-empty behind the filter and warns not to say nothing ran) must
  // never be reported as "no work ran" / "nothing ran" / "no basis". The only honest
  // replies are a grounded broadened answer or an explicit couldn't-get-a-reliable-read
  // — reconcileTaskingReply can't re-query live, so it forces the latter.
  if (hasUnbroadenedFilteredEmptyExecutionRead(actions) && claimsEmptyExecutionWorld(prose) && !acknowledgesUnreadExecution(prose)) {
    return [
      "⚠️ Correction — I couldn't get a reliable read: the execution-status query was filtered and excluded tickets that exist on the executor, so I cannot say nothing ran.",
      "Broaden the query (drop the filter, or list all) and answer from that — never assert an empty result set from a filtered-empty read.",
      "",
      text,
    ].join("\n");
  }

  // P-3 — a task's outbound send already sits in this turn's conversation-transcript
  // read (the authoritative outbound message log), yet the reply still calls some task
  // "unexecuted"/"not sent"/"didn't run". The log is real evidence a status summary
  // must consult, same as execution_status is for a ticket — never assert a negative
  // against a source that already shows the positive.
  const outboundEvidence = outboundSendEvidence(actions);
  if (outboundEvidence.length > 0 && claimsUnexecutedTask(prose)) {
    return [
      "⚠️ Correction — the outbound message log shows this was actually sent this turn; do not report it as unexecuted.",
      ...outboundEvidence.map((e) => `Sent at ${e.at}${e.messageId ? ` (message ${e.messageId})` : ""}.`),
      "",
      text,
    ].join("\n");
  }

  if (bannerPermitted && claimsTerminalExecutionState(prose) && !hasTerminalExecutionGrounding(actions) && !acknowledgesUnreadExecution(prose)) {
    return [
      "⚠️ Correction — I could not confirm a terminal execution state this turn, so do not rely on any claim below that execution is complete/done/failed.",
      "A queue or dispatch receipt only proves the run was queued/dispatched. Terminal claims need a live execution_status result showing done or failed.",
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

  // C-15 · #257 — the same ground-truth rule for NON-create writes (edit, comment,
  // close, label). A blocked or failed edit_issue / close_issue / backlog_comment
  // whose prose still says "Note added" / "Updated #253" / "Closed it" is a fabricated
  // success — and unlike a create, the claim frequently carries no issue number
  // ("Done, jotted that down"), so the number-adjacency check far below can't catch
  // it. A recorded write failure with zero successful write receipt this turn can: on
  // any mutating lane, no success text may render without a real receipt object.
  const writeFailed = nonCreateWriteError(actions);
  if (writeFailed && !writeReceipts.some((r) => r.verb !== "created") && hasActiveClaim(prose, NON_CREATE_WRITE_CLAIM_VERBS)) {
    return [
      "⚠️ Correction — that change was not applied (the write was blocked or failed); ignore any claim below that it went through.",
      `The write step failed: ${writeFailed}`,
      "Nothing changed — want me to try that again?",
      "",
      text,
    ].join("\n");
  }

  // Execution state is not ordinary backlog state. A reply like "No, #108/#109
  // were not created or queued" must be grounded in Epaminon's live execution
  // read, not stale chat memory or an Archus paraphrase.
  if (bannerPermitted && claimsExecutionState(prose) && !executionGrounded && !isSameTurnCreateWithoutExecutionReceipt(prose, presented, createdNums) && !acknowledgesUnreadExecution(prose)) {
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

  if (notFoundReceipts.length > 0 && isTerseNegativeAnswer(prose)) {
    return notFoundReceipts.map((target) => `${target} was not found in GitHub.`).join("\n");
  }

  if (readReceipts.length === 1 && isOnlyIssueUrl(prose)) {
    const receipt = readReceipts[0]!;
    return `${receipt.target} is ${receipt.state}. ${receipt.title}. Labels: ${receipt.labels}. ${receipt.url}`;
  }

  // Only police active claims the model makes about THIS turn. Read-only
  // mentions ("what's the status of #44"), capability descriptions ("issues are
  // created with status:proposed"), and quoted history (a blockquoted past
  // receipt) are left alone — they don't assert a mutation just happened.
  if (!hasActiveClaim(prose, MUTATION_VERBS)) return text;

  const claimsCreation =
    hasActiveClaim(prose, CREATION_VERBS) &&
    (presented.size > 0 || hasActiveIssueCreationClaim(prose)) &&
    !(executionGrounded && /\bexecution ticket\b/i.test(prose)) &&
    !ranNonCreateIssueWrite(actions);

  // The demonstrated bug: a creation is claimed but nothing was created. A status
  // summary grounded in real tool data is NOT that — a query_backlog table whose
  // cell reads "Just created & queued" describes an issue's history, and every
  // number it cites is backed by the query result. Only flag a fabricated
  // creation when a cited number is unbacked by any tool this turn, or when a
  // creation is claimed with no number at all.
  // FB-1 / #258 / C-23 — "grounded" = a number surfaced by ANY tool THIS turn (READ
  // results included), not only create/write receipts. A read-only summary reports
  // existing issues ("PRs opened this week: #498, #499…") whose numbers came straight
  // from the read results — those are grounded, NOT a fabricated creation, so no banner
  // (the C-11 defect: the old code flagged true content and told the user to ignore it).
  // A number no tool surfaced at all (the #58 bug) stays unproven → still corrected.
  const groundedThisTurn = new Set<number>([...proven, ...actions.flatMap((a) => [...issueNumbersIn(a.result ?? "")])]);
  const unprovenPresented = [...presented].filter((n) => !groundedThisTurn.has(n));
  const fabricatedCreation = presented.size === 0 || unprovenPresented.length > 0;
  if (claimsCreation && createdNums.size === 0 && fabricatedCreation && bannerPermitted) {
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
  const mutationVerbsToPolice = ranNonCreateIssueWrite(actions) ? NON_CREATION_MUTATION_VERBS : MUTATION_VERBS;
  const unproven = [...numbersClaimedAdjacent(prose, mutationVerbsToPolice)].filter(
    (n) => !proven.has(n) && !(executionGrounded && noExecNums.has(n) && NEGATIVE_QUEUE_RE.test(prose)),
  );
  if (unproven.length > 0 && bannerPermitted) {
    return `⚠️ Correction — I couldn't confirm ${fmt(unproven)} against the backlog this turn, so don't rely on ${unproven.length > 1 ? "those references" : "that reference"}.\n\n${text}`;
  }

  return text;
}
