import { createHash } from "node:crypto";
import type { Classification, ClassificationTopic, SourcePassage } from "../llm/types.js";
import type { StoreInput } from "../types.js";

export const LONG_MEMORY_SEGMENT_CHARS = 12_000;
const PASSAGE_CHARS = 800;

/** Preserve one raw capture while classifying long voice notes topic-sized piece by piece. */
export function segmentLongMemoryContent(
  content: string,
  maxChars = LONG_MEMORY_SEGMENT_CHARS,
): string[] {
  if (!content || content.length <= maxChars) return [content];
  const segments: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(content.length, offset + maxChars);
    if (end < content.length) {
      const window = content.slice(offset, end);
      const boundary = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
      if (boundary >= maxChars / 2) end = offset + boundary + 1;
      if (/^[\uDC00-\uDFFF]$/.test(content[end] ?? "")) end -= 1;
    }
    segments.push(content.slice(offset, end));
    offset = end;
  }
  return segments;
}

/** Host-provided bounds only; never infer boundaries from text resembling a wrapper. */
export function semanticBounds(input: Pick<StoreInput, "content" | "semanticRange">) {
  const range = input.semanticRange ?? { start: 0, end: input.content.length };
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end > input.content.length
    || /^[\uDC00-\uDFFF]$/.test(input.content[range.start] ?? "")
    || /^[\uDC00-\uDFFF]$/.test(input.content[range.end] ?? "")) throw new Error("invalid_semantic_range");
  return range;
}

/** Passage identity depends on immutable evidence and offsets, never model text or chunk number. */
export function sourceWindows(input: Pick<StoreInput, "content" | "semanticRange">) {
  const bounds = semanticBounds(input);
  const digest = createHash("sha256").update(input.content).digest("hex").slice(0, 16);
  let offset = bounds.start;
  const passages: SourcePassage[] = segmentLongMemoryContent(input.content.slice(bounds.start, bounds.end), PASSAGE_CHARS)
    .map(text => {
      const start = offset;
      offset += text.length;
      return { id: `p-${digest}-${start.toString(36)}-${offset.toString(36)}`, start, end: offset, text };
    });
  const groups: SourcePassage[][] = [];
  for (const passage of passages) {
    const last = groups.at(-1);
    if (!last || passage.end - last[0]!.start > LONG_MEMORY_SEGMENT_CHARS) groups.push([passage]);
    else last.push(passage);
  }
  return groups.map((group, i) => {
    const start = group[0]!.start;
    const end = group.at(-1)!.end;
    const neighbors = [groups[i - 1]?.at(-1), groups[i + 1]?.[0]].filter((p): p is SourcePassage => !!p);
    return { content: input.content.slice(start, end), range: { start, end },
      passages: [...group, ...neighbors].sort((a, b) => a.start - b.start), context: neighbors.map(p => p.text).join("\n") };
  });
}

/** Addresses prove exact provenance, not semantic relevance. Never deduplicate ideas by address. */
export function resolveTopicSpans(content: string, topic: ClassificationTopic) {
  const spans: Array<{ start: number; end: number; passageId?: string }> = [];
  let invalid = !(topic.evidenceAssignments?.length || topic.evidenceQuotes.length);
  for (const assignment of topic.evidenceAssignments ?? []) {
    const supplied = topic.sourcePassages ?? [];
    const addressed = supplied.filter(p => p.id === assignment.passageId);
    const passage = addressed[0];
    if (addressed.length !== 1 || !passage || !assignment.quote.trim()
      || !Number.isSafeInteger(assignment.occurrence) || assignment.occurrence < 0) {
      invalid = true; continue;
    }
    // Search only a contiguous, byte-exact run of supplied host passages. A quote
    // may cross a segmentation boundary, but its address must overlap the match.
    const ordered = [...supplied].sort((a, b) => a.start - b.start);
    const index = ordered.indexOf(passage);
    let first = index;
    let last = index;
    while (first > 0 && ordered[first - 1]!.end === ordered[first]!.start) first--;
    while (last + 1 < ordered.length && ordered[last]!.end === ordered[last + 1]!.start) last++;
    const run = ordered.slice(first, last + 1);
    if (run.some(p => !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end)
      || p.start < 0 || p.end <= p.start || p.end > content.length
      || content.slice(p.start, p.end) !== p.text)) {
      invalid = true; continue;
    }
    const start = run[0]!.start;
    const segment = content.slice(start, run.at(-1)!.end);
    const matches: number[] = [];
    for (let local = segment.indexOf(assignment.quote); local >= 0;
      local = segment.indexOf(assignment.quote, local + 1)) {
      const absolute = start + local;
      if (absolute < passage.end && absolute + assignment.quote.length > passage.start) matches.push(absolute);
    }
    // Occurrence is useful only for repeated matches. A unique exact address is
    // already unambiguous; redundant model numbering must not discard evidence.
    const absolute = matches.length === 1 ? matches[0] : matches[assignment.occurrence];
    if (absolute === undefined) { invalid = true; continue; }
    spans.push({ start: absolute, end: absolute + assignment.quote.length, passageId: passage.id });
  }
  // Legacy classifiers retain exact, unique quote resolution inside their owned chunk.
  // Addressed assignments supersede the legacy field when both are returned.
  // An invalid addressed assignment never falls back to a less precise quote.
  for (const quote of topic.evidenceAssignments?.length ? [] : topic.evidenceQuotes) {
    const range = topic.sourceRange ?? { start: 0, end: content.length };
    const segment = content.slice(range.start, range.end);
    const local = quote.trim() ? segment.indexOf(quote) : -1;
    if (local < 0 || segment.indexOf(quote, local + 1) >= 0) { invalid = true; continue; }
    spans.push({ start: range.start + local, end: range.start + local + quote.length });
  }
  // A neighboring passage can complete a proposition, but never generate a neighbor-only topic.
  if (topic.sourceRange && !spans.some(s => s.start < topic.sourceRange!.end && s.end > topic.sourceRange!.start)) invalid = true;
  return { invalid, spans: [...new Map(spans.map(s => [`${s.start}:${s.end}`, s])).values()] };
}

/** Coverage means a passage was reviewed, not that every idea was correctly understood. */
export function reviewedSourceSpans(content: string, classification: Classification,
  window: ReturnType<typeof sourceWindows>[number]): Array<{ start: number; end: number }> {
  const validSupport = (classification.topics ?? []).flatMap(topic => {
    const resolved = resolveTopicSpans(content, topic);
    return resolved.invalid ? [] : resolved.spans;
  });
  // Legacy responses remain conservative; short quotes do not imply a whole passage review.
  if (!classification.passageReviews) return validSupport;
  const reviewed: Array<{ start: number; end: number }> = [];
  for (const passage of window.passages.filter(p => p.start >= window.range.start && p.end <= window.range.end)) {
    const reviews = classification.passageReviews.filter(r => r.passageId === passage.id);
    if (reviews.length !== 1) continue;
    const review = reviews[0]!;
    if (review.status === "evidence_only" || (review.status === "assigned"
      && validSupport.some(span => span.start < passage.end && span.end > passage.start))) {
      reviewed.push({ start: passage.start, end: passage.end });
    }
  }
  return reviewed;
}
