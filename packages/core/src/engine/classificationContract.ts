import { resolveTopicSpans } from "./sourcePassages.js";
import type { ClassifyInput, Classification } from "../llm/types.js";

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

export const SOURCE_ADDRESS_CORRECTION_HINT = "Structural correction: each evidence assignment must use a supplied passage ID whose raw text overlaps the quoted evidence. Copy quotes from the supplied passages; only whitespace differences are allowed. Preserve valid independent topics. Do not invent addresses, paraphrase quotes, or point a quote at an unrelated passage.";

export class ClassificationSourceAddressError extends Error {
  constructor() { super("classification_source_address_invalid"); }
}

/** Reuse filing's address proof before the existing classifier retry is spent.
 * Host ranges/passages override any model-provided fields. Neighbor-only support
 * remains the owning window's responsibility; legacy quote-only results retain
 * their existing filing validation. Never search outside the supplied addresses.
 */
export function checkTopicSourceAddresses(result: Classification, content: string,
  host: Pick<ClassifyInput, "sourceRange" | "sourcePassages">, exhaustedRetry = false): Classification {
  const invalid = result.topics?.filter(topic => {
    if (!topic.evidenceAssignments?.length) return false;
    const owned = { ...topic };
    delete owned.sourceRange;
    delete owned.sourcePassages;
    if (host.sourceRange) owned.sourceRange = host.sourceRange;
    if (host.sourcePassages) owned.sourcePassages = host.sourcePassages;
    const resolved = resolveTopicSpans(content, owned);
    return resolved.invalid && !resolved.nonOwnedContext;
  });
  if (!invalid?.length) return result;
  if (!exhaustedRetry) throw new ClassificationSourceAddressError();
  return { ...result, topics: result.topics!.map(topic => invalid.includes(topic)
    ? { ...topic, confidence: 0, disposition: "needs_clarification", classificationFailed: true,
      question: "classification_source_address_invalid" }
    : topic) };
}
