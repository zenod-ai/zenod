import { createHash } from "node:crypto";

/**
 * Shared tree library, Zenod side (EPIC-9 E9-5b; E9-4 design §4 rule 1).
 *
 * The same contract runs in the EpicSpine skill (`scripts/spine_tree.py`, references/tree-library.md,
 * E9-5f). Nothing imports the other: the algorithm is the contract, and
 * `packages/core/test/fixtures/tree-library-parity.json` (a copy of the skill's
 * `assets/tree-library-parity.json`) holds inputs with expected outputs both sides test against.
 * Change a constant or a rule here and in the skill together, or the trees drift.
 */

export const HALF_LIFE_DAYS = 14;
/** Events older than this add nothing (0.5^(120/14) ≈ 0.003 anyway). */
export const HORIZON_DAYS = 120;
/** Jaccard overlap of member sets at which a re-derived root keeps an old id. */
export const MATCH_THRESHOLD = 0.5;

const DAY_MS = 86_400_000;

/** Python's default string order (code points), which the skill sorts by; JS `<` compares UTF-16 units. */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** Whole days from `earlier` to `later` (YYYY-MM-DD, UTC); negative when `earlier` is after `later`. */
export function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

/** A dated event: a day (weight 1) or `[day, weight]`, weight being the share of the event a node holds. */
export type HeatEvent = string | readonly [string, number];

/**
 * Sum of weight × 0.5^(age / halfLife) over dated events, rounded to 3 decimals. Future events and
 * events older than `horizon` days add nothing. One event today is 1.0; 14 days old 0.5; 28 days old 0.25.
 */
export function heat(events: Iterable<HeatEvent>, today: string, halfLife = HALF_LIFE_DAYS, horizon = HORIZON_DAYS): number {
  let total = 0;
  for (const event of events) {
    const [day, weight] = typeof event === "string" ? [event, 1] : event;
    const age = daysBetween(day, today);
    if (age >= 0 && age <= horizon && weight) total += weight * 0.5 ** (age / halfLife);
  }
  return Math.round(total * 1000) / 1000;
}

/** |a ∩ b| / |a ∪ b|; 0 for two empty sets. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  const union = left.size + right.size - shared;
  return union ? shared / union : 0;
}

/** Deterministic id for a root no old root matched: `n-` + the first 8 hex of sha1 over its sorted members joined by newlines. */
export function newRootId(members: Iterable<string>, prefix = "n-"): string {
  return prefix + createHash("sha1").update([...members].map(String).sort(byCodePoint).join("\n")).digest("hex").slice(0, 8);
}

/**
 * An id for each current member set: the old id it overlaps most (Jaccard ≥ threshold), one-to-one,
 * else a new id. Greedy best-first over every (old, new) pair at or above the threshold, highest
 * overlap first; ties by old id, then by current index. `claimed` pre-assigns ids (a steered root's
 * page anchors its id whatever the overlap); those ids and indexes skip the greedy pass. Unmatched
 * sets get `newRootId(members)`, suffixed `-2`, `-3`, … if that id is taken.
 */
export function matchRootIds(
  previous: ReadonlyMap<string, Iterable<string>> | Record<string, Iterable<string>>,
  current: ReadonlyArray<Iterable<string>>,
  threshold = MATCH_THRESHOLD,
  claimed: ReadonlyMap<number, string> = new Map(),
): string[] {
  const prev = new Map<string, Set<string>>();
  for (const [id, members] of previous instanceof Map ? previous : Object.entries(previous)) prev.set(id, new Set(members));
  const cur = current.map(members => new Set(members));
  const ids: Array<string | null> = cur.map((_, i) => claimed.get(i) ?? null);
  const taken = new Set<string>(claimed.values());
  const pairs: Array<{ score: number; id: string; i: number }> = [];
  for (const [id, members] of prev) {
    if (taken.has(id)) continue;
    cur.forEach((set, i) => {
      if (ids[i] === null) pairs.push({ score: jaccard(members, set), id, i });
    });
  }
  pairs.sort((a, b) => b.score - a.score || byCodePoint(a.id, b.id) || a.i - b.i);
  for (const { score, id, i } of pairs) {
    if (score < threshold) break;
    if (ids[i] === null && !taken.has(id)) {
      ids[i] = id;
      taken.add(id);
    }
  }
  const used = new Set<string>([...prev.keys(), ...taken]);
  return cur.map((members, i) => {
    if (ids[i] !== null) return ids[i]!;
    const base = newRootId(members);
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  });
}
