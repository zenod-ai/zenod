// The ask loop's two non-answer texts and how to recognise them (E12-S1). No imports, no I/O:
// the customer layer reads it, and that layer is bundled into Phylax (scripts/assert-phylax-bundle.mjs).

export const ANSWER_PROTOCOL_FAILURE_TEXT = "The model did not submit a valid memory-answer selection. Repeat the question; the source evidence was not rejected as invalid.";

/** Kept in step with ASK_UNVERIFIED_PREFIX in engine/engine.ts. */
const ASK_UNVERIFIED_PREFIX = "I couldn't verify";

/**
 * Whether an ask() text is one of the engine's two non-answers: the model slipped on the answer
 * protocol ("retry": asking again may answer), or nothing read supports an answer ("unverified").
 * Null for an answer.
 */
export function askNonAnswer(text: string): "retry" | "unverified" | null {
  if (text === ANSWER_PROTOCOL_FAILURE_TEXT) return "retry";
  if (text.startsWith(ASK_UNVERIFIED_PREFIX)) return "unverified";
  return null;
}
