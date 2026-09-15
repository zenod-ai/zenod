export interface SourceQuoteRun { start: number; text: string }
export interface RawSourceQuote { start: number; end: number; quote: string }

/** Collapse whitespace, retaining the raw UTF-16 extent of every unit.
 * Sentence punctuation may touch its following letter in ASR formatting. Never
 * remove word-to-word space, numeric separators, punctuation or lexical bytes.
 */
function whitespaceMap(text: string) {
  let normalized = "";
  const starts: number[] = [], ends: number[] = [];
  for (let start = 0; start < text.length;) {
    let end = start + 1;
    const whitespace = /\s/u.test(text[start]!);
    if (whitespace) while (end < text.length && /\s/u.test(text[end]!)) end++;
    // Ignore only spacing after sentence punctuation before a letter. A
    // preceding digit excludes decimal/list-number separators conservatively.
    // All other whitespace still maps to a required single space.
    if (whitespace && start > 0 && /[.!?]/u.test(text[start - 1]!)
      && !/\p{N}/u.test(text[start - 2] ?? "") && /^\p{L}/u.test(text.slice(end))) {
      start = end; continue;
    }
    normalized += whitespace ? " " : text[start]!;
    starts.push(start); ends.push(end); start = end;
  }
  return { normalized, starts, ends };
}

/** Caller supplies only validated, contiguous raw runs. Gaps stay separate.
 * Exact-match selection retains caller policy. Only a unique formatting-only
 * fallback is accepted; occurrence numbering never disambiguates that fallback.
 */
export function resolveRawSourceQuote(runs: readonly SourceQuoteRun[], quote: string, options: {
  maxRawChars: number;
  exactOccurrence?: number;
  uniqueExact?: boolean;
  overlap?: { start: number; end: number };
}): RawSourceQuote | null {
  if (!quote.trim() || quote.length > options.maxRawChars) return null;
  const overlaps = (match: RawSourceQuote) => !options.overlap
    || (match.start < options.overlap.end && match.end > options.overlap.start);
  const exact: RawSourceQuote[] = [];
  for (const run of runs) {
    for (let at = run.text.indexOf(quote); at >= 0; at = run.text.indexOf(quote, at + 1)) {
      const match = { start: run.start + at, end: run.start + at + quote.length, quote };
      if (overlaps(match)) exact.push(match);
    }
  }
  if (exact.length) return exact.length === 1 ? exact[0]!
    : options.uniqueExact ? null : exact[options.exactOccurrence ?? 0] ?? null;
  const needle = whitespaceMap(quote).normalized;
  const fallback: RawSourceQuote[] = [];
  for (const run of runs) {
    const mapped = whitespaceMap(run.text);
    for (let at = mapped.normalized.indexOf(needle); at >= 0; at = mapped.normalized.indexOf(needle, at + 1)) {
      const start = mapped.starts[at]!, end = mapped.ends[at + needle.length - 1]!;
      const match = { start: run.start + start, end: run.start + end, quote: run.text.slice(start, end) };
      // Count all normalized matches in authorized runs before overlap/length
      // checks: a model occurrence or budget cannot rescue ambiguous evidence.
      fallback.push(match);
      if (fallback.length > 1) return null;
    }
  }
  const match = fallback[0];
  return match && overlaps(match) && match.quote.length <= options.maxRawChars ? match : null;
}
