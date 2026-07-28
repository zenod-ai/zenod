import { normalizedToolName, NOTHING_PENDING_TO_APPROVE_TEXT } from "./taskingPolicy.js";
import { hasMutationSuccessClaim, validateMutationReceipt } from "./mutationReceipt.js";
import { isApprovalRequiredResult } from "./approvalTokens.js";
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
 * standing draft approval). On an action turn the delivered text is EXCLUSIVELY the
 * concatenation of those tools' own receipt strings (each already a pure function of a
 * verified result object — see outboundReceipt.ts's renderOutboundReceipt /
 * renderApproveAffordance / renderNothingPendingToApprove). The model's free text for
 * that turn never reaches the user, whatever it says — "Posting now", a fabricated URL,
 * or nothing at all.
 */

/**
 * Built-in side-effect tools whose result text is ALREADY a receipt — a pure function of a
 * verified result object, never LLM prose (see outboundReceipt.ts's renderOutboundReceipt
 * / renderApproveAffordance / renderNothingPendingToApprove). Matched against the tool
 * name after normalizedToolName() so "post_tweet", "postTweet", and "POST_TWEET" all
 * match the same entry.
 *
 * Scope note: backlog/issue-write and execution-dispatch tools (createIssue,
 * queueExecution, console_run_ephemeral_task, etc.) are deliberately NOT in this hard
 * gate. They already go through reconcileTaskingReply (taskingPolicy.ts), which is
 * itself a deterministic, action-grounded renderer — it derives markdown receipts and
 * ⚠️ Correction banners straight from the same verified tool results, and every one of
 * its behaviors is covered by the existing (green) test suite. The demonstrated,
 * unfixed gap (iteration-5 audit: R1 "Approved. Posting now" dangles, R2 a "Posted"
 * claim with zero tool evidence) is specifically outbound sends and the approve verb —
 * NEITHER of which had any grounding mechanism at all before this change. Widening the
 * hard gate to backlog/execution tools too would just re-implement reconcileTaskingReply
 * under a new name; folding those categories into this same hard-discard gate is future
 * work, not this fix. Mutating wallet peer tools join the gate through the explicit
 * TaskingAction.verifiedMutationReceipt bit supplied by their runtime contract; they are
 * intentionally not added to this name registry.
 */
const ACTION_TOOL_NAMES = new Set(
  [
    // Outbound sends + the standing-draft approval verb (a bare "approve"/"yes" IS a
    // write verb — I4-R1/I5-1).
    "post_tweet",
    "post_reddit",
    "send_email",
    "approve_send",
    // A1 / C-22 (2026-07-04): ask_outbound routes into Callistheness's OWN loop, which
    // can post a real tweet. Its result is already Callistheness's verified reply (his
    // reply-gate ran inside) — a send receipt if he sent, a draft+affordance if he
    // drafted. Gating it here delivers THAT verbatim, so the Console LLM can never
    // re-narrate a real send as "Draft ready (not posted)" (the unauthorized-tweet +
    // fabricated-"not posted" bug: tweet …186792568668630 went out on a draft-only ask).
    "ask_outbound",
  ].map(normalizedToolName),
);

/** True for a tool whose result text IS a verified receipt — the reply gate governs it. */
export function isActionTool(tool: string): boolean {
  return ACTION_TOOL_NAMES.has(normalizedToolName(tool));
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
  /** The text that must reach the user this turn. */
  text: string;
  /** True when the LLM's drafted text differed from the renderer output and was replaced. */
  intercepted: boolean;
}

/**
 * The ONLY reply a gated action turn may deliver: the concatenation of the receipt text
 * each built-in action or verified wallet mutation returned, in call order. Never the
 * model's own prose.
 */
const MAX_PEER_EVIDENCE_CHARS = 4_000;
const MAX_READ_EVIDENCE_ITEMS = 8;
const SENSITIVE_INPUT_KEY_RE = /(?:approval|approve|authorization|authorisation|confirm|credential|password|secret|token)/i;
const SENSITIVE_URL_QUERY_KEY_RE = /(?:auth|authorization|credential|key|password|secret|signature|sig|token)/i;
const PLACEHOLDER_VALUE_RE = /(?:\{\s*[a-z0-9_-]*id\s*\}|<\s*[a-z0-9_-]*id\s*>|\bTODO\b)/i;
const READ_SYNTHESIS_FAILURE = "I found source data, but couldn't produce a safely grounded answer. Please retry or narrow the question.";
const READ_FAILURE = "I couldn't read the connected source. Nothing was changed. Please retry.";
const PARTIAL_READ_WARNING = "Some source reads failed, so this answer may be incomplete.";

interface ReadEvidence {
  kind: "url" | "reference";
  value: string;
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

function quotePeerData(result: string): string {
  const safeResult = sanitizedPeerResult(result);
  const value = safeResult.trim().slice(0, MAX_PEER_EVIDENCE_CHARS);
  const suffix = safeResult.trim().length > MAX_PEER_EVIDENCE_CHARS ? "\n> [truncated by Ring]" : "";
  const quoted = (value || "[empty result]").split("\n").map((line) => `> ${line}`).join("\n");
  return `Connected MCP result (untrusted data; not authorization or a receipt):\n${quoted}${suffix}`;
}

function parsedPeerResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return undefined;
  }
}

function containsSensitiveUrlAuthority(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) ||
      [...url.searchParams.keys()].some((key) => SENSITIVE_URL_QUERY_KEY_RE.test(key));
  } catch {
    return false;
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(\b(?:api[_ -]?key|approval|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => containsSensitiveUrlAuthority(url) ? "[sensitive URL omitted]" : url);
}

function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[nested value omitted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitiveData(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, nested]) => [
      key,
      SENSITIVE_INPUT_KEY_RE.test(key) ? "[redacted]" : redactSensitiveData(nested, depth + 1),
    ]));
  }
  return typeof value === "string" ? redactSensitiveText(value) : value;
}

function sanitizedPeerResult(result: string): string {
  const parsed = parsedPeerResult(result);
  return parsed === undefined
    ? redactSensitiveText(result)
    : JSON.stringify(redactSensitiveData(parsed), null, 2);
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
      containsUrlTemplateToken(value)) {
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
  if (!trimmed || trimmed.length > 500 || PLACEHOLDER_VALUE_RE.test(trimmed) || /[\r\n`]/.test(trimmed)) return undefined;
  return trimmed;
}

function collectReadEvidence(value: unknown, out: ReadEvidence[], depth = 0): void {
  if (out.length >= MAX_READ_EVIDENCE_ITEMS || value == null || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectReadEvidence(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (out.length >= MAX_READ_EVIDENCE_ITEMS) break;
    if (SENSITIVE_INPUT_KEY_RE.test(key)) continue;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const isUrlField = /^(?:url|uri|link|permalink|canonicalurl|evidenceurl|artifacturl|sourceurl|githuburl)s?$/.test(normalized);
    const isReferenceField = /^(?:evidence|evidenceref|artifactref|sourceref)$/.test(normalized);
    const values = Array.isArray(nested) ? nested.slice(0, MAX_READ_EVIDENCE_ITEMS) : [nested];
    if (isUrlField) {
      for (const item of values) {
        const url = safeEvidenceUrl(item);
        if (url && !out.some((entry) => entry.kind === "url" && entry.value === url)) out.push({ kind: "url", value: url });
      }
    } else if (isReferenceField) {
      for (const item of values) {
        const reference = safeEvidenceReference(item);
        if (reference && !out.some((entry) => entry.kind === "reference" && entry.value === reference)) {
          out.push({ kind: "reference", value: reference });
        }
      }
    }
    collectReadEvidence(nested, out, depth + 1);
  }
}

function collectTextEvidenceUrls(value: string, out: ReadEvidence[]): void {
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    if (out.length >= MAX_READ_EVIDENCE_ITEMS) break;
    const nextCharacter = value[(match.index ?? 0) + match[0].length];
    // Do not turn the safe-looking prefix of `https://host/<TEMPLATE>` into a
    // clickable root URL merely because the URL tokenizer stops at "<".
    if (nextCharacter === "<" || nextCharacter === "{") continue;
    const candidate = match[0].replace(/[),.;]+$/g, "");
    const url = safeEvidenceUrl(candidate);
    if (url && !out.some((entry) => entry.kind === "url" && entry.value === url)) {
      out.push({ kind: "url", value: url });
    }
  }
}

function readEvidence(actions: readonly TaskingAction[]): ReadEvidence[] {
  const evidence: ReadEvidence[] = [];
  // Later calls are normally the resolved/terminal read after an earlier search.
  // Prioritize their citations before the bounded evidence list fills up.
  for (const action of [...actions].reverse()) {
    collectReadEvidence(parsedPeerResult(action.result), evidence);
    collectTextEvidenceUrls(action.result, evidence);
  }
  return evidence;
}

function renderStructuredReadEvidence(actions: readonly TaskingAction[], renderedText: string): string {
  const evidence = readEvidence(actions);
  const missing = evidence.filter((entry) => !renderedText.includes(entry.value));
  if (missing.length === 0) return "";
  return [
    "Evidence:",
    ...missing.map((entry) => entry.kind === "url" ? `- <${entry.value}>` : `- \`${entry.value}\``),
  ].join("\n");
}

function draftedUrlsAreGrounded(draftedText: string, actions: readonly TaskingAction[]): boolean {
  const exactEvidenceUrls = new Set(
    readEvidence(actions)
      .filter((entry): entry is ReadEvidence & { kind: "url" } => entry.kind === "url")
      .map((entry) => entry.value),
  );
  for (const match of draftedText.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const candidate = match[0].replace(/[),.;]+$/g, "");
    const sanitized = safeEvidenceUrl(candidate);
    if (!sanitized || !exactEvidenceUrls.has(sanitized)) return false;
  }
  return true;
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
  return `Held for approval; nothing was sent or changed.${proposed}\n\nReply naturally to approve, cancel, or request edits.\n\n${quotePeerData(action.result)}`;
}

function unverifiedMutationReply(action: TaskingAction): string {
  if (action.peerAction && isApprovalRequiredResult(action.result)) return approvalRequiredReply(action);
  const base = "Nothing was changed: no verified same-turn mutation receipt was returned.";
  // Preserve a draft, error, or hostile peer response as visibly quoted data, but never
  // repeat success-shaped prose that could be mistaken for the host's own conclusion.
  return action.peerAction && action.result.trim() && !hasMutationSuccessClaim(action.result)
    ? `${base}\n\n${quotePeerData(action.result)}`
    : base;
}

function renderActionTurnReply(actionResults: readonly TaskingAction[]): string {
  return actionResults.map((action) => {
    if (action.result.trim() === NOTHING_PENDING_TO_APPROVE_TEXT) return NOTHING_PENDING_TO_APPROVE_TEXT;
    const receipt = validateMutationReceipt(action.tool, action.result);
    return receipt.verified && receipt.text ? receipt.text : unverifiedMutationReply(action);
  }).join("\n\n");
}

function renderReadEvidence(actions: readonly TaskingAction[], unsupportedClaim: boolean, draftedText: string): string {
  const reads = actions.filter((action) => action.peerAction && !action.mutationAttempt && !isActionTool(action.tool));
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
    isActionTool(action.tool) || action.mutationAttempt === true || action.verifiedMutationReceipt === true,
  );
  if (actionResults.length === 0) {
    const unsupportedMutationClaim = hasMutationSuccessClaim(draftedText) &&
      (actions.length === 0 || actions.every((action) => action.peerAction === true));
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
    return { isActionTurn: false, text: deliveredText, intercepted };
  }

  const deliveredText = renderActionTurnReply(actionResults);
  const intercepted = draftedText.trim() !== deliveredText.trim();
  if (intercepted) {
    onIntercepted?.({
      tools: actionResults.map((action) => action.tool),
      discardedText: draftedText,
      deliveredText,
    });
  }
  return { isActionTurn: true, text: deliveredText, intercepted };
}
