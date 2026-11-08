/**
 * Match percentage for ranked memory hits (EPIC-12 E12-3, row S3a).
 *
 * BM25 scores are unbounded and mean nothing to a person, so each hit also carries a
 * percentage built from two parts that can each be explained in one sentence:
 *
 * - coverage (0..1): how much of the question the memory contains. Each content word of
 *   the question counts with its BM25 rarity weight (idf), so a rare word like "Porto"
 *   counts more than a common one like "notes". 1 = every word of the question is in it.
 * - strength (0..1): the hit's BM25 score relative to the best hit for this question.
 *   1 = the best hit.
 *
 * matchPercent = round(100 × coverage × (1 + strength) / 2), between 1 and 100.
 *
 * Coverage leads (E12-S3c): strength is relative to the best hit, so on its own it makes the
 * best hit of a weak question read high, and tied hits all read the same. Here a hit never
 * reads higher than the share of the question it contains: a hit with a fifth of the
 * question reads at most 20 %, the best hit that contains every word reads 100 %, and a hit
 * with every word but half the best strength reads 75 %. It is relative to this question and
 * this vault, not a probability. Without a coverage figure (the scan fallback), strength
 * alone is used.
  * Hits keep their BM25 order, and a hit never reads higher than the hit ranked above it
 * (monotonic), so the list reads top-down.
 */

export interface MatchInput {
  /** Positive relevance, higher is better (negated BM25 or a scan score). */
  score: number;
  /** The best score among the hits for the same question. */
  topScore: number;
  /** Rarity-weighted share of the question's words the hit contains, 0..1; omit when unknown. */
  coverage?: number;
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function matchPercent({ score, topScore, coverage }: MatchInput): number {
  const strength = topScore > 0 ? clamp01(score / topScore) : 0;
  const blended = coverage === undefined ? strength : (clamp01(coverage) * (1 + strength)) / 2;
  return Math.max(1, Math.min(100, Math.round(blended * 100)));
}

/** BM25's idf for a term found in `df` of `n` rows (always > 0). */
export function idfOf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** Cap each percentage at the one ranked above it, so a ranked list never reads out of order. */
export function monotonic(percents: readonly number[]): number[] {
  const out: number[] = [];
  for (const percent of percents) out.push(out.length ? Math.min(out[out.length - 1]!, percent) : percent);
  return out;
}

/** Add `matchPercent` to ranked hits that lack one (strength vs the best hit), kept monotonic. */
export function withMatchPercent<T extends { score: number; matchPercent?: number }>(hits: readonly T[]): Array<T & { matchPercent: number }> {
  const topScore = Math.max(0, ...hits.map((hit) => hit.score));
  const percents = monotonic(hits.map((hit) => hit.matchPercent ?? matchPercent({ score: hit.score, topScore })));
  return hits.map((hit, i) => ({ ...hit, matchPercent: percents[i]! }));
}
