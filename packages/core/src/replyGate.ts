import { NOTHING_PENDING_TO_APPROVE_TEXT } from "./taskingPolicy.js";
import {
  hasMutationSuccessClaim,
  renderVerifiedMutationReceipt,
  validateMutationReceipt,
  type MutationReceiptEvidence,
} from "./mutationReceipt.js";
import { isApprovalRequiredResult } from "./approvalTokens.js";
import { toolKind } from "./toolKinds.js";
import type { TaskingAction } from "./types.js";

/**
 * Iteration-6 — the reply gate.
 *
 * Five prior iterations shrank outbound dishonesty but never reached zero, because the
 * honesty fix always lived one layer too shallow: a connector's raw response was reduced
 * to a verified receipt (E-1, outboundReceipt.ts), a journey composed its message from a
 * verified execution/issue object (createIssueRunJourney.ts), a persona was told to
 * "relay verbatim" and a source scan banned known bad strings (I5-1) — but the ACTUAL
 * text delivered to the user was still whatever the model wrote as its own closing turn.
 * Nothing stopped it from writing something else. A static grep over source cannot
 * constrain what a model generates at runtime (obsidian-brain iteration-5 audit: R1
 * "Approved. Posting now" dangles, R2 a "Posted" claim with zero tool calls).
 *
 * The fix is a hard interception at the reply boundary, not another layer of persona
 * guidance: detect — from the tools that ACTUALLY ran this turn, never from the model's
 * prose — whether this is an action turn (it invoked a side-effect tool, or resolved a
 * standing draft approval). On an action turn the gate selects exactly one outcome and
 * renders it from same-turn evidence: one coalesced verified receipt, one held draft
 * with its approval question, or one honest failure. The model's free text for that
 * turn never reaches the user, whatever it says — "Posting now", a fabricated URL, or
 * nothing at all.
 */

/**
 * Compatibility query for callers/tests that have not yet attached action metadata.
 * This delegates to the repository's exhaustive structural tool-kind registry; the
 * reply gate owns no narrower name list and unknown tools fail safe as mutations.
 */
export function isActionTool(tool: string): boolean {
  return toolKind(tool) === "mutate";
}

export interface ReplyGateInterceptedEvent {
  /** The side-effect tools that ran this turn, in call order. */
  tools: string[];
  /** The LLM's own drafted text for this turn — discarded, kept here for operator debugging only. */
  discardedText: string;
  /** The receipt text actually delivered to the user instead. */
  deliveredText: string;
}

export interface ReplyGateOutcome {
  /** True when this turn invoked at least one side-effect tool — the gate applied. */
  isActionTurn: boolean;
  /** The one user-visible outcome selected for this turn. */
  kind: "answer" | "clarification" | "held_draft" | "verified_receipt" | "failure";
  /** The text that must reach the user this turn. */
  text: string;
  /** True when the LLM's drafted text differed from the renderer output and was replaced. */
  intercepted: boolean;
}

/**
 * A gated action turn delivers exactly one host-selected outcome. Verified evidence is
 * coalesced into one receipt; a single held mutation gets one approval question; every
 * other unverified or ambiguous combination gets one honest failure. Never model prose.
 */
const MAX_PEER_EVIDENCE_CHARS = 4_000;
const MAX_RENDERED_READ_EVIDENCE_ITEMS = 3;
const SENSITIVE_INPUT_KEY_RE = /(?:approval|approve|authorization|authorisation|confirm|credential|password|secret|token)/i;
const SENSITIVE_URL_QUERY_KEY_RE = /(?:auth|authorization|credential|key|password|secret|signature|sig|token)/i;
const PLACEHOLDER_VALUE_RE = /(?:\{\s*[a-z0-9_-]*id\s*\}|<\s*[a-z0-9_-]*id\s*>|\bTODO\b)/i;
const UNSAFE_EVIDENCE_CONTROL_RE = /(?:[\u0000-\u001f\u007f]|\\+[nrt])/i;
const READ_SYNTHESIS_FAILURE = "I found source data, but couldn't produce a safely grounded answer. Please retry or narrow the question.";
const READ_FAILURE = "I couldn't read the connected source. Nothing was changed. Please retry.";
const PARTIAL_READ_WARNING = "Some source reads failed, so this answer may be incomplete.";

interface ReadEvidence {
  kind: "url" | "reference";
  value: string;
  /** Lower values are preferred when choosing one customer-facing item per read. */
  preference: 0 | 1 | 2 | 3 | 4 | 5;
}

const STANDING_ACTION_CLAIM_RE = /\b(?:held\s+(?:for|pending|awaiting)\s+(?:approval|confirmation|review)|(?:now\s+)?pending\s+(?:approval|confirmation)|(?:draft|action)\s+(?:is|was|has been)\s+(?:held|pending)|(?:created|prepared|saved)\s+(?:a|the|your)\s+(?:draft|pending action))\b/gi;
const LOCAL_NEGATION_RE = /\b(?:no|not|nothing|never|wasn'?t|isn'?t)\b/i;

/** A model claim that a durable approval candidate exists; prose alone can never prove this state. */
export function hasStandingActionClaim(text: string): boolean {
  for (const match of text.matchAll(STANDING_ACTION_CLAIM_RE)) {
    const lead = text.slice(Math.max(0, match.index! - 28), match.index);
    if (!LOCAL_NEGATION_RE.test(lead)) return true;
  }
  return false;
}

function parsedPeerResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function typedAnswerContentText(action: TaskingAction): string | undefined {
  if (action.peerAction !== true ||
      action.mutationAttempt === true ||
      action.verifiedMutationReceipt === true) return undefined;
  const parsed = parsedPeerResult(action.result);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.isError === true) return undefined;
  const structured = envelope.structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return undefined;
  const answer = structured as Record<string, unknown>;
  if (answer.type !== "answer_content" || typeof answer.text !== "string") return undefined;
  const status = answer.status;
  if (!status || typeof status !== "object" || Array.isArray(status)) return undefined;
  const readOnlyStatus = status as Record<string, unknown>;
  if (readOnlyStatus.type !== "read_only_status" || typeof readOnlyStatus.text !== "string") return undefined;
  if (!Array.isArray(answer.sources)) return undefined;
  const sourceLines: string[] = [];
  for (const source of answer.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
    const value = source as Record<string, unknown>;
    if (typeof value.path !== "string") return undefined;
    if (value.githubUrl !== undefined && typeof value.githubUrl !== "string") return undefined;
    sourceLines.push(`- ${value.path}${value.githubUrl ? ` (${value.githubUrl})` : ""}`);
  }
  const expected = `${sourceLines.length > 0
    ? `${answer.text}\n\nSources:\n${sourceLines.join("\n")}`
    : answer.text}\n\n${readOnlyStatus.text}`;
  if (!Array.isArray(envelope.content) || envelope.content.length !== 1) return undefined;
  const content = envelope.content[0];
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  const textContent = content as Record<string, unknown>;
  if (textContent.type !== "text" || textContent.text !== expected) return undefined;
  return expected;
}

function hasRootFailureSignal(value: Record<string, unknown>): boolean {
  if (value.isError === true || value.ok === false || value.success === false) return true;
  if (typeof value.status === "string") {
    const status = value.status.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (/^(?:error|failed|failure|blocked|timeout|timedout|unauthorized|unauthorised|forbidden|denied)$/.test(status)) {
      return true;
    }
  }
  return Object.hasOwn(value, "error") && value.error !== undefined && value.error !== null && value.error !== false;
}

function isPeerError(result: string): boolean {
  if (/^\s*(?:ERROR\b|Could not reach peer agent\b)/i.test(result)) return true;
  const parsed = parsedPeerResult(result);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const value = parsed as Record<string, unknown>;
  if (hasRootFailureSignal(value)) return true;

  const structured = value.structuredContent;
  if (structured && typeof structured === "object" && !Array.isArray(structured) &&
      hasRootFailureSignal(structured as Record<string, unknown>)) {
    return true;
  }

  // MCP's top-level content is transport output. Inspect only those direct text items:
  // recursively treating arbitrary domain records containing "error" as failed would
  // turn successful reads about incidents or error logs into false failures.
  return Array.isArray(value.content) && value.content.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const text = (item as Record<string, unknown>).text;
    return typeof text === "string" && /^\s*ERROR\b/i.test(text);
  });
}

function containsUrlTemplateToken(value: string): boolean {
  let candidate = value;
  for (let pass = 0; pass < 2; pass += 1) {
    if (/(?:\{[^{}\r\n]+\}|<[^<>\r\n]+>)/.test(candidate)) return true;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  return false;
}

function safeEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048 || PLACEHOLDER_VALUE_RE.test(value) ||
      containsUrlTemplateToken(value) || UNSAFE_EVIDENCE_CONTROL_RE.test(value)) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return undefined;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_QUERY_KEY_RE.test(key))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeEvidenceReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500 || PLACEHOLDER_VALUE_RE.test(trimmed) ||
      UNSAFE_EVIDENCE_CONTROL_RE.test(trimmed) || /`/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function normalizedEvidenceKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isStructuredUrlKey(normalized: string): boolean {
  return /^(?:url|uri|link|permalink|canonicalurl|evidenceurl|artifacturl|sourceurl|githuburl)s?$/.test(normalized);
}

function isStructuredReferenceKey(normalized: string): boolean {
  return /^(?:evidence|evidenceref|artifactref|sourceref)$/.test(normalized);
}

function structuredUrlPreference(normalized: string): ReadEvidence["preference"] {
  const singular = normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
  if (singular === "canonicalurl") return 0;
  if (/^(?:evidenceurl|permalink)$/.test(singular)) return 1;
  if (singular === "sourceurl") return 2;
  return 3;
}

function betterReadEvidence(current: ReadEvidence | undefined, candidate: ReadEvidence): ReadEvidence {
  return !current || candidate.preference < current.preference ? candidate : current;
}

function preferredStructuredReadEvidence(
  value: unknown,
  current?: ReadEvidence,
  depth = 0,
): ReadEvidence | undefined {
  if (value == null || depth > 8) return current;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) {
      current = preferredStructuredReadEvidence(item, current, depth + 1);
    }
    return current;
  }
  if (typeof value !== "object") return current;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (SENSITIVE_INPUT_KEY_RE.test(key)) continue;
    const normalized = normalizedEvidenceKey(key);
    const values = Array.isArray(nested) ? nested.slice(0, 100) : [nested];
    if (isStructuredUrlKey(normalized)) {
      for (const item of values) {
        const url = safeEvidenceUrl(item);
        if (url) {
          current = betterReadEvidence(current, {
            kind: "url",
            value: url,
            preference: structuredUrlPreference(normalized),
          });
        }
      }
    } else if (isStructuredReferenceKey(normalized)) {
      for (const item of values) {
        const reference = safeEvidenceReference(item);
        if (reference) {
          current = betterReadEvidence(current, { kind: "reference", value: reference, preference: 4 });
        }
      }
    } else {
      current = preferredStructuredReadEvidence(nested, current, depth + 1);
    }
  }
  return current;
}

function firstTextEvidenceUrl(value: string): ReadEvidence | undefined {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const nextCharacter = value[(match.index ?? 0) + match[0].length];
    // Do not turn the safe-looking prefix of `https://host/<TEMPLATE>` into a
    // clickable root URL merely because the URL tokenizer stops at "<".
    if (nextCharacter === "<" || nextCharacter === "{") continue;
    const candidate = match[0].replace(/[),.;]+$/g, "");
    const url = safeEvidenceUrl(candidate);
    if (url) return { kind: "url", value: url, preference: 5 };
  }
  return undefined;
}

function firstNestedTextEvidenceUrl(value: unknown, depth = 0): ReadEvidence | undefined {
  if (value == null || depth > 8) return undefined;
  if (typeof value === "string") return firstTextEvidenceUrl(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) {
      const found = firstNestedTextEvidenceUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    const normalized = normalizedEvidenceKey(key);
    const structuredEvidenceField = isStructuredUrlKey(normalized) || isStructuredReferenceKey(normalized);
    if (!SENSITIVE_INPUT_KEY_RE.test(key) && !structuredEvidenceField) {
      const found = firstNestedTextEvidenceUrl(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function preferredEvidenceForRead(action: TaskingAction): ReadEvidence | undefined {
  const parsed = parsedPeerResult(action.result);
  const structured = preferredStructuredReadEvidence(parsed);
  if (structured) return structured;
  return parsed === undefined
    ? firstTextEvidenceUrl(action.result)
    : firstNestedTextEvidenceUrl(parsed);
}

function textContainsEvidenceUrl(value: string, expected: string): boolean {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const nextCharacter = value[(match.index ?? 0) + match[0].length];
    if (nextCharacter === "<" || nextCharacter === "{") continue;
    const candidate = match[0].replace(/[),.;]+$/g, "");
    if (safeEvidenceUrl(candidate) === expected) return true;
  }
  return false;
}

function valueContainsEvidenceUrl(value: unknown, expected: string, depth = 0): boolean {
  if (value == null || depth > 8) return false;
  if (typeof value === "string") return textContainsEvidenceUrl(value, expected);
  if (Array.isArray(value)) {
    return value.slice(0, 100).some((item) => valueContainsEvidenceUrl(item, expected, depth + 1));
  }
  if (typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).slice(0, 100).some(([key, nested]) => {
    if (SENSITIVE_INPUT_KEY_RE.test(key)) return false;
    const normalized = normalizedEvidenceKey(key);
    if (isStructuredUrlKey(normalized)) {
      const values = Array.isArray(nested) ? nested.slice(0, 100) : [nested];
      return values.some((item) => safeEvidenceUrl(item) === expected);
    }
    if (isStructuredReferenceKey(normalized)) return false;
    return valueContainsEvidenceUrl(nested, expected, depth + 1);
  });
}

function actionReturnsEvidenceUrl(action: TaskingAction, expected: string): boolean {
  const parsed = parsedPeerResult(action.result);
  return parsed === undefined
    ? textContainsEvidenceUrl(action.result, expected)
    : valueContainsEvidenceUrl(parsed, expected);
}

function isSameTurnReadEvidence(action: TaskingAction): boolean {
  // Connected read tools carry peerAction because their collision-safe names are
  // discovered at runtime; Ring-owned reads use the exhaustive structural registry.
  // Mutation metadata always wins over either read signal.
  return action.mutationAttempt !== true &&
    action.verifiedMutationReceipt !== true &&
    (action.peerAction === true || toolKind(action.tool) === "read");
}

function draftedEvidenceUrls(text: string): string[] | undefined {
  const urls: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const nextCharacter = text[(match.index ?? 0) + match[0].length];
    if (nextCharacter === "<" || nextCharacter === "{") return undefined;
    const candidate = match[0].replace(/[),.;]+$/g, "");
    const sanitized = safeEvidenceUrl(candidate);
    if (!sanitized) return undefined;
    if (!urls.includes(sanitized)) urls.push(sanitized);
  }
  return urls;
}

function renderStructuredReadEvidence(actions: readonly TaskingAction[], renderedText: string): string {
  const draftedUrls = draftedEvidenceUrls(renderedText);
  if (draftedUrls?.some((url) => actions.some((action) => actionReturnsEvidenceUrl(action, url)))) return "";

  const missing: ReadEvidence[] = [];
  for (const action of actions) {
    const preferred = preferredEvidenceForRead(action);
    if (preferred && !renderedText.includes(preferred.value) &&
        !missing.some((entry) => entry.kind === preferred.kind && entry.value === preferred.value)) {
      missing.push(preferred);
    }
    if (missing.length >= MAX_RENDERED_READ_EVIDENCE_ITEMS) break;
  }
  if (missing.length === 0) return "";
  return [
    "Evidence:",
    ...missing.map((entry) => entry.kind === "url" ? `- <${entry.value}>` : `- \`${entry.value}\``),
  ].join("\n");
}

function draftedUrlsAreGrounded(draftedText: string, actions: readonly TaskingAction[]): boolean {
  const draftedUrls = draftedEvidenceUrls(draftedText);
  return draftedUrls !== undefined &&
    draftedUrls.every((url) => actions.some((action) => actionReturnsEvidenceUrl(action, url)));
}

function hasRawReadEnvelopeFragment(text: string): boolean {
  // Reject only JSON-shaped transport/validation fragments, including prefixed or
  // fenced variants. Plain prose that happens to mention "content" or "errors" is not
  // an envelope and remains eligible as a synthesis.
  const rawMcpEnvelope = /[\[{][\s\S]{0,4000}"(?:content|structuredContent|isError)"\s*:/i;
  const rawValidationEnvelope =
    /[\[{][\s\S]{0,4000}"(?:issues|errors)"\s*:\s*\[[\s\S]{0,2000}"(?:code|path|expected|received)"\s*:/i;
  return rawMcpEnvelope.test(text) || rawValidationEnvelope.test(text);
}

function isSafeReadSynthesis(draftedText: string, actions: readonly TaskingAction[]): boolean {
  const text = draftedText.trim();
  if (text.length < 3 || !/[\p{L}\p{N}]/u.test(text)) return false;
  if (hasMutationSuccessClaim(text) || hasStandingActionClaim(text)) return false;
  if (parsedPeerResult(text) !== undefined) return false;
  if (hasRawReadEnvelopeFragment(text)) return false;
  if (/(?:Connected MCP (?:read )?result|untrusted data|truncated by Ring)/i.test(text)) return false;
  if (/"?(?:structuredContent|isError)"?\s*:/i.test(text)) return false;
  if (actions.some((action) =>
    (action.tool.trim() && text.toLowerCase().includes(action.tool.trim().toLowerCase())) ||
    (action.result.trim() && text === action.result.trim())
  )) return false;
  return draftedUrlsAreGrounded(text, actions);
}

function publicMutationInput(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[nested value omitted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => publicMutationInput(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_INPUT_KEY_RE.test(key))
        .slice(0, 100)
        .map(([key, item]) => [key, publicMutationInput(item, depth + 1)]),
    );
  }
  if (typeof value === "string" && value.length > MAX_PEER_EVIDENCE_CHARS) {
    return `${value.slice(0, MAX_PEER_EVIDENCE_CHARS)}… [truncated by Ring]`;
  }
  return value;
}

function approvalRequiredReply(action: TaskingAction): string {
  const publicInput = JSON.stringify(publicMutationInput(action.input), null, 2);
  const proposed = publicInput && publicInput !== "{}"
    ? `\n\nProposed non-sensitive arguments:\n\`\`\`json\n${publicInput}\n\`\`\``
    : "";
  return `Held for approval; nothing was sent or changed.${proposed}\n\nApprove this exact draft?`;
}

type ActionOutcome = Pick<ReplyGateOutcome, "kind" | "text">;

function renderActionTurnReply(actionResults: readonly TaskingAction[]): ActionOutcome {
  const verifiedEvidence: MutationReceiptEvidence[] = [];
  const approvalRequired: TaskingAction[] = [];
  let nothingPendingCount = 0;
  let verifiedCount = 0;
  let unverifiedCount = 0;

  for (const action of actionResults) {
    if (action.result.trim() === NOTHING_PENDING_TO_APPROVE_TEXT) {
      nothingPendingCount += 1;
      continue;
    }
    // A held/approval-required result is explicitly nonterminal. Classify it before
    // generic receipt parsing so an opaque draft/receipt id can never masquerade as
    // proof that the mutation completed.
    if (action.peerAction && isApprovalRequiredResult(action.result)) {
      approvalRequired.push(action);
      continue;
    }
    const receipt = validateMutationReceipt(action.tool, action.result);
    if (receipt.verified) {
      verifiedCount += 1;
      for (const evidence of receipt.evidence) {
        if (!verifiedEvidence.some((entry) => entry.kind === evidence.kind && entry.value === evidence.value)) {
          verifiedEvidence.push(evidence);
        }
      }
    } else {
      unverifiedCount += 1;
    }
  }

  if (verifiedEvidence.length > 0) {
    if (verifiedCount !== actionResults.length) {
      return {
        kind: "failure",
        text: "I couldn't verify one complete mutation outcome. Please check before retrying.",
      };
    }
    return {
      kind: "verified_receipt",
      text: renderVerifiedMutationReceipt("", verifiedEvidence),
    };
  }
  if (approvalRequired.length === 1 && unverifiedCount === 0 && nothingPendingCount === 0) {
    return {
      kind: "held_draft",
      text: approvalRequiredReply(approvalRequired[0]!),
    };
  }
  if (nothingPendingCount === 1 && actionResults.length === 1) {
    return { kind: "failure", text: NOTHING_PENDING_TO_APPROVE_TEXT };
  }
  if (approvalRequired.length > 0 || nothingPendingCount > 0) {
    return {
      kind: "failure",
      text: "I couldn't verify one complete mutation outcome. Please check before retrying.",
    };
  }
  return {
    kind: "failure",
    text: "Nothing was changed: no verified same-turn mutation receipt was returned.",
  };
}

const MUTATION_PERMALINK_CLAIM_RE =
  /\b(?:(?:live|receipt|evidence|artifact|canonical|published|posted)\s+(?:url|link)|permalink)\s*:/i;

function isMutationPermalinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;
    if ((host === "x.com" || host === "twitter.com") && /^\/[^/]+\/status\/\d+(?:\/|$)/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

function hasMutationPermalinkClaim(text: string): boolean {
  if (MUTATION_PERMALINK_CLAIM_RE.test(text)) return true;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const candidate = match[0].replace(/[),.;]+$/g, "");
    if (isMutationPermalinkUrl(candidate)) return true;
  }
  return false;
}

function hasGroundedMutationPermalinkRead(
  draftedText: string,
  actions: readonly TaskingAction[],
): boolean {
  // The permalink shape alone resembles a mutation receipt. It is nevertheless
  // legitimate read evidence when the same normalized URL came back from an exact
  // successful read this turn. The normal read-synthesis gate still rejects raw
  // envelopes, ungrounded companion URLs, and mutation-success prose.
  const statusUrls = (draftedEvidenceUrls(draftedText) ?? []).filter(isMutationPermalinkUrl);
  if (statusUrls.length === 0) return false;
  const reads = actions.filter(isSameTurnReadEvidence).filter((action) => !isPeerError(action.result));
  return isSafeReadSynthesis(draftedText, reads) &&
    statusUrls.every((url) => reads.some((action) => actionReturnsEvidenceUrl(action, url)));
}

function naturalOutcomeKind(text: string): ReplyGateOutcome["kind"] {
  const trimmed = text.trim();
  const questionMarks = trimmed.match(/\?/g)?.length ?? 0;
  return questionMarks === 1 && trimmed.endsWith("?") ? "clarification" : "answer";
}

function renderReadEvidence(actions: readonly TaskingAction[], unsupportedClaim: boolean, draftedText: string): string {
  const reads = actions.filter((action) =>
    action.peerAction &&
    action.mutationAttempt !== true &&
    action.verifiedMutationReceipt !== true,
  );
  if (reads.length === 0) return "";
  const failed = reads.filter((action) => isPeerError(action.result));
  const successful = reads.filter((action) => !isPeerError(action.result));
  if (successful.length === 0) return READ_FAILURE;

  const safeDraft = !unsupportedClaim && isSafeReadSynthesis(draftedText, successful);
  const answer = unsupportedClaim
    ? ""
    : safeDraft
      ? draftedText.trim()
      : READ_SYNTHESIS_FAILURE;
  const evidence = renderStructuredReadEvidence(successful, answer);
  return [
    answer,
    evidence,
    failed.length > 0 ? PARTIAL_READ_WARNING : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * The runtime gate: detects an action turn deterministically from the tools that
 * ACTUALLY ran this turn (never from the model's prose), or from explicit verified wallet
 * receipt metadata, and replaces the delivered text with the pure-function renderer
 * output regardless of what the model drafted. Non-action turns pass `draftedText`
 * through untouched.
 *
 * When the model's drafted text differs from the renderer output, `onIntercepted` fires
 * with the discarded text — live evidence of how often the model still tries to narrate
 * ahead of/instead of the receipt. The discarded text is for operator debugging only; it
 * is never sent to the user.
 */
export function applyReplyGate(
  draftedText: string,
  actions: readonly TaskingAction[],
  onIntercepted?: (event: ReplyGateInterceptedEvent) => void,
): ReplyGateOutcome {
  const actionResults = actions.filter((action) =>
    action.mutationAttempt === true || action.verifiedMutationReceipt === true,
  );
  if (actionResults.length === 0) {
    const typedAnswers = actions
      .map(typedAnswerContentText)
      .filter((text): text is string => text !== undefined);
    if (typedAnswers.length === 1) {
      const deliveredText = typedAnswers[0]!;
      const intercepted = deliveredText.trim() !== draftedText.trim();
      if (intercepted) {
        onIntercepted?.({
          tools: actions.filter((action) => action.peerAction).map((action) => action.tool),
          discardedText: draftedText,
          deliveredText,
        });
      }
      return {
        isActionTurn: false,
        kind: naturalOutcomeKind(deliveredText),
        text: deliveredText,
        intercepted,
      };
    }
    const groundedMutationPermalinkRead =
      hasGroundedMutationPermalinkRead(draftedText, actions);
    const unsupportedMutationClaim =
      (hasMutationPermalinkClaim(draftedText) && !groundedMutationPermalinkRead) ||
      (hasMutationSuccessClaim(draftedText) &&
        (actions.length === 0 || actions.every((action) => action.peerAction === true)));
    const unsupportedStandingClaim = hasStandingActionClaim(draftedText);
    const base = unsupportedMutationClaim
      ? "Nothing was changed: no verified same-turn mutation receipt was returned."
      : unsupportedStandingClaim
        ? "Nothing was held or changed: no same-turn tool result created a standing action."
        : draftedText;
    const evidence = unsupportedStandingClaim ? "" : renderReadEvidence(actions, unsupportedMutationClaim, draftedText);
    const deliveredText = evidence
      ? unsupportedMutationClaim ? `${base.trim()}\n\n${evidence}`.trim() : evidence
      : base;
    const intercepted = deliveredText.trim() !== draftedText.trim();
    if (intercepted) {
      onIntercepted?.({
        tools: actions.filter((action) => action.peerAction).map((action) => action.tool),
        discardedText: draftedText,
        deliveredText,
      });
    }
    const kind = unsupportedMutationClaim || unsupportedStandingClaim ||
      deliveredText === READ_FAILURE || deliveredText.startsWith(READ_SYNTHESIS_FAILURE)
      ? "failure"
      : naturalOutcomeKind(deliveredText);
    return { isActionTurn: false, kind, text: deliveredText, intercepted };
  }

  const outcome = renderActionTurnReply(actionResults);
  const deliveredText = outcome.text;
  const intercepted = draftedText.trim() !== deliveredText.trim();
  if (intercepted) {
    onIntercepted?.({
      tools: actionResults.map((action) => action.tool),
      discardedText: draftedText,
      deliveredText,
    });
  }
  return { isActionTurn: true, kind: outcome.kind, text: deliveredText, intercepted };
}
