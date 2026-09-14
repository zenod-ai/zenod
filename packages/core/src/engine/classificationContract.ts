import type { Classification } from "../llm/types.js";

export const DESTINATION_CORRECTION_HINT = "Structural correction: every append_compact_note or integrate_page topic must include its own non-empty pages array with supported destinations. Top-level pages do not route topics. Keep independently justified topics separate; use needs_clarification with empty pages when the destination cannot be determined. Do not copy every aggregate page to every topic.";

export class ClassificationDestinationError extends Error {
  constructor() { super("classification_topic_destination_missing"); }
}

/** Validate raw classifier decisions before catalog safety may downgrade them.
 * The final existing retry preserves valid sibling decisions, but leaves each
 * contradictory topic explicitly pending rather than guessing a destination.
 * Legacy classifications without topics retain their existing contract.
 */
export function checkTopicDestinations(result: Classification, exhaustedRetry = false): Classification {
  const invalid = result.topics?.filter(topic =>
    (topic.disposition === "append_compact_note" || topic.disposition === "integrate_page") && topic.pages.length === 0);
  if (!invalid?.length) return result;
  if (!exhaustedRetry) throw new ClassificationDestinationError();
  return { ...result, topics: result.topics!.map(topic => invalid.includes(topic)
    ? { ...topic, confidence: 0, disposition: "needs_clarification", pages: [], classificationFailed: true,
      question: "classification_topic_destination_missing" }
    : topic) };
}
