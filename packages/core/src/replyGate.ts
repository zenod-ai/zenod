import { normalizedToolName } from "./taskingPolicy.js";
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
 * Side-effect tools whose result text is ALREADY a receipt — a pure function of a
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
 * work, not this fix.
 */
const ACTION_TOOL_NAMES = new Set(
  [
    // Outbound sends + the standing-draft approval verb (a bare "approve"/"yes" IS a
    // write verb — I4-R1/I5-1).
    "post_tweet",
    "post_reddit",
    "send_email",
    "approve_send",
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
 * The ONLY reply an action turn may deliver: the concatenation of the receipt text each
 * side-effect tool call already returned, in call order. Never the model's own prose.
 */
function renderActionTurnReply(actionResults: readonly TaskingAction[]): string {
  return actionResults
    .map((action) => action.result.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/**
 * The runtime gate: detects an action turn deterministically from the tools that
 * ACTUALLY ran this turn (never from the model's prose), and when one did, replaces the
 * delivered text with the pure-function renderer output regardless of what the model
 * drafted. Non-action turns pass `draftedText` through untouched.
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
  const actionResults = actions.filter((action) => isActionTool(action.tool));
  if (actionResults.length === 0) {
    return { isActionTurn: false, text: draftedText, intercepted: false };
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
