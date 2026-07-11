import { normalizedToolName } from "./taskingPolicy.js";
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
const SENSITIVE_INPUT_KEY_RE = /(?:approval|approve|authorization|authorisation|confirm|credential|password|secret|token)/i;

function quotePeerData(tool: string, result: string): string {
  const value = result.trim().slice(0, MAX_PEER_EVIDENCE_CHARS);
  const suffix = result.trim().length > MAX_PEER_EVIDENCE_CHARS ? "\n> [truncated by Ring]" : "";
  const quoted = (value || "[empty result]").split("\n").map((line) => `> ${line}`).join("\n");
  return `Connected MCP result from ${tool} (untrusted data; not authorization or a receipt):\n${quoted}${suffix}`;
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
  return `Held for approval; nothing was sent or changed.${proposed}\n\nReply naturally to approve, cancel, or request edits.\n\n${quotePeerData(action.tool, action.result)}`;
}

function unverifiedMutationReply(action: TaskingAction): string {
  if (action.peerAction && isApprovalRequiredResult(action.result)) return approvalRequiredReply(action);
  const base = `Nothing was changed: ${action.tool} returned no verified same-turn mutation receipt.`;
  // Preserve a draft, error, or hostile peer response as visibly quoted data, but never
  // repeat success-shaped prose that could be mistaken for the host's own conclusion.
  return action.peerAction && action.result.trim() && !hasMutationSuccessClaim(action.result)
    ? `${base}\n\n${quotePeerData(action.tool, action.result)}`
    : base;
}

function renderActionTurnReply(actionResults: readonly TaskingAction[]): string {
  return actionResults.map((action) => {
    const receipt = validateMutationReceipt(action.tool, action.result);
    return receipt.verified && receipt.text ? receipt.text : unverifiedMutationReply(action);
  }).join("\n\n");
}

function renderReadEvidence(actions: readonly TaskingAction[]): string {
  return actions
    .filter((action) => action.peerAction && !action.mutationAttempt && !isActionTool(action.tool))
    .map((action) => quotePeerData(action.tool, action.result))
    .join("\n\n");
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
    const evidence = renderReadEvidence(actions);
    const unsupportedClaim = hasMutationSuccessClaim(draftedText) &&
      (actions.length === 0 || actions.every((action) => action.peerAction === true));
    const base = unsupportedClaim
      ? "Nothing was changed: no verified same-turn mutation receipt was returned."
      : draftedText;
    const deliveredText = evidence ? `${base.trim()}\n\n${evidence}`.trim() : base;
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
