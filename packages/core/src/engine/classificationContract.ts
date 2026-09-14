import { resolveTopicSpans, reviewedSourceSpans } from "./sourcePassages.js";
import type { ClassifyInput, Classification, ClassificationTopic } from "../llm/types.js";

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
    const resolved = resolveTopicSpans(content, withHostSource(topic, host));
    return resolved.invalid && !resolved.nonOwnedContext;
  });
  if (!invalid?.length) return result;
  if (!exhaustedRetry) throw new ClassificationSourceAddressError();
  return { ...result, topics: result.topics!.map(topic => invalid.includes(topic)
    ? { ...topic, confidence: 0, disposition: "needs_clarification", classificationFailed: true,
      question: "classification_source_address_invalid" }
    : topic) };
}

function withHostSource(topic: ClassificationTopic, host: Pick<ClassifyInput, "sourceRange" | "sourcePassages">): ClassificationTopic {
  const owned = { ...topic };
  delete owned.sourceRange;
  delete owned.sourcePassages;
  if (host.sourceRange) owned.sourceRange = host.sourceRange;
  if (host.sourcePassages) owned.sourcePassages = host.sourcePassages;
  return owned;
}

export const SOURCE_COVERAGE_CORRECTION_HINT = "Structural correction: every owned passage marked assigned must have a topic with valid quoted source support overlapping that passage. Return the independent ideas from all owned passages. A neighbor-only topic does not cover owned passages. Preserve valid topics and do not invent quotes or claim assigned coverage without supporting assignments.";

export class ClassificationSourceCoverageError extends Error {
  constructor() { super("classification_assigned_passage_unsupported"); }
}

/** Reuse the same coverage proof as filing, before the existing retry is spent.
 * Exhaustion leaves unsupported coverage untouched: filing already keeps those
 * source ranges unassigned. This checks a structural claim, not semantic recall.
 */
export function checkAssignedPassageCoverage(result: Classification, content: string,
  host: Pick<ClassifyInput, "sourceRange" | "sourcePassages">, exhaustedRetry = false): Classification {
  if (exhaustedRetry || !result.passageReviews || !host.sourceRange || !host.sourcePassages) return result;
  const ownedResult = { ...result, topics: (result.topics ?? []).map(topic => withHostSource(topic, host)) };
  const reviewed = reviewedSourceSpans(content, ownedResult, { range: host.sourceRange, passages: host.sourcePassages });
  const unsupported = host.sourcePassages.some(passage =>
    passage.start >= host.sourceRange!.start && passage.end <= host.sourceRange!.end
    && result.passageReviews!.some(review => review.passageId === passage.id && review.status === "assigned")
    && !reviewed.some(span => span.start === passage.start && span.end === passage.end));
  if (unsupported) throw new ClassificationSourceCoverageError();
  return result;
}
