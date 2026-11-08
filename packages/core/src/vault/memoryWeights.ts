import { createHash } from "node:crypto";

/**
 * Weighted memory graph (EPIC-18 E18-1, E18-2). Every memory is a node with a stable id that
 * lives in the Markdown: a page's front matter `zid` (filing writes it), else an id derived from
 * its path; a Log entry's own block id (`^e-xxxxxx`). The weighted links between nodes live in the
 * tenant's SQLite index (memoryIndex.ts, tables `nodes` and `links`), never in the notes, and are
 * rebuilt from the vault whenever it changes: the notes stay plain Markdown the person owns.
 *
 * How strong a link is (0..1), from what the vault already says:
 * - a filing put a note on a page: the filing's own confidence (receipt), else 0.9 both ways;
 *   a page that only cites the note: 0.9; a page the filing planned but never wrote: 0.4
 * - a wikilink A → B: 0.9 from A, 0.6 back from B
 * - the tree: parent → child 0.8, child → parent 0.75 (a parent is broader than its child)
 * - two pages filed from the same note (co-mention): 0.5 per shared note, fading with the note's
 *   age (half every 180 days, never below a quarter), spread thin when a note fed many pages
 * Several reasons for one link add up as independent evidence: 1 − Π(1 − s). A node with many
 * links shares its weight (above 8 links, each × √(8 / links)), so a hub never pulls in everything.
 *
 * Retrieval (expandCloud) starts from the best matches and walks the links, multiplying strengths
 * along each path: 1.0 → 0.9 → 0.95 reaches 0.855 and is kept at a 0.8 threshold, one more 0.9 step
 * (0.77) is not. The threshold, not a fixed depth, decides how far the walk goes. A note ends a
 * path unless the walk starts from it (endsPath): a voice note about three topics ties each to it,
 * not the topics to each other; those keep their co-mention strength.
 */

export const CLOUD_DEFAULT_THRESHOLD = 0.8;
export const CLOUD_DEFAULT_MAX_NODES = 12;
export const CLOUD_MAX_NODES = 60;

export const LINK_STRENGTH = {
  filed: 0.9,
  cites: 0.9,
  planned: 0.4,
  mentions: 0.9,
  mentionsBack: 0.6,
  link: 0.9,
  backlink: 0.6,
  childToParent: 0.75,
  parentToChild: 0.8,
  coMention: 0.5,
} as const;
/** Above this many links a node's weight is shared out. */
const HUB_LINKS = 8;
const CO_MENTION_HALF_LIFE_DAYS = 180;
const CO_MENTION_MAX = 0.95;
/** A note filed into more pages than this ties each pair more loosely. */
const CO_MENTION_FAN = 4;

export type LinkReason = "filed" | "cites" | "planned" | "mentions" | "link" | "tree" | "co-mention";

export interface WeightedLink {
  src: string;
  dst: string;
  strength: number;
  /** Why the link exists, sorted: `filed,tree`. */
  reasons: string;
}

/** A resolved, directed tie as the index stores it: `from` and `to` are node paths. */
export interface NodeTie {
  from: string;
  to: string;
  kind: "link" | "tree" | "cites" | "filed" | "planned" | "mentions";
  /** For `filed`: the filing's confidence (0..1), when its receipt has one. */
  weight?: number | null;
}

/** The stable id derived from a page path (`p-` + 10 hex), used until the page carries a `zid`. */
export function derivedNodeId(path: string): string {
  return `p-${createHash("sha1").update(path.replace(/\.md$/i, "").toLowerCase()).digest("hex").slice(0, 10)}`;
}

/** A node's id: a Log entry's block id, a page's front matter `zid`, else the derived id. */
export function nodeIdOf(path: string, zid?: unknown): string {
  const anchor = /#\^([\w-]+)$/.exec(path)?.[1];
  if (anchor) return anchor;
  return typeof zid === "string" && /^[\w-]{3,40}$/.test(zid.trim()) ? zid.trim() : derivedNodeId(path);
}

/** Noisy-OR: independent reasons for one link make it stronger, never above 1. */
export function combineStrengths(values: readonly number[]): number {
  return 1 - values.reduce((rest, value) => rest * (1 - Math.max(0, Math.min(1, value))), 1);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
export const isNote = (path: string) => path.includes("#^");

/**
 * Every weighted, directed link between nodes (paths), from the resolved ties. `noteTime` gives a
 * note's capture time (ms) for the co-mention fade; `now` is the clock.
 */
export function buildWeightedLinks(ties: readonly NodeTie[], options: { now: number; noteTime: (note: string) => number | null }): WeightedLink[] {
  const parts = new Map<string, { values: number[]; reasons: Set<string> }>();
  const add = (src: string, dst: string, value: number, reason: LinkReason) => {
    if (src === dst || value <= 0) return;
    const key = `${src}\n${dst}`;
    const part = parts.get(key) ?? { values: [], reasons: new Set<string>() };
    part.values.push(value);
    part.reasons.add(reason);
    parts.set(key, part);
  };
  // note → the pages it was filed into, cited by or links to (for co-mention).
  const notePages = new Map<string, Set<string>>();
  const tieNote = (note: string, page: string) => {
    if (!notePages.has(note)) notePages.set(note, new Set());
    notePages.get(note)!.add(page);
  };
  for (const tie of ties) {
    switch (tie.kind) {
      case "filed": {
        const value = typeof tie.weight === "number" && tie.weight > 0 ? Math.min(1, tie.weight) : LINK_STRENGTH.filed;
        add(tie.from, tie.to, value, "filed");
        add(tie.to, tie.from, value, "filed");
        tieNote(tie.from, tie.to);
        break;
      }
      case "cites":
        add(tie.from, tie.to, LINK_STRENGTH.cites, "cites");
        add(tie.to, tie.from, LINK_STRENGTH.cites, "cites");
        tieNote(tie.to, tie.from);
        break;
      case "planned":
        add(tie.from, tie.to, LINK_STRENGTH.planned, "planned");
        add(tie.to, tie.from, LINK_STRENGTH.planned, "planned");
        break;
      case "mentions":
        add(tie.from, tie.to, LINK_STRENGTH.mentions, "mentions");
        add(tie.to, tie.from, LINK_STRENGTH.mentionsBack, "mentions");
        break;
      case "link":
        add(tie.from, tie.to, LINK_STRENGTH.link, "link");
        add(tie.to, tie.from, LINK_STRENGTH.backlink, "link");
        break;
      case "tree":
        add(tie.from, tie.to, LINK_STRENGTH.childToParent, "tree");
        add(tie.to, tie.from, LINK_STRENGTH.parentToChild, "tree");
        break;
    }
  }
  const day = 86_400_000;
  for (const [note, pageSet] of notePages) {
    const pages = [...pageSet].filter((page) => !isNote(page)).sort();
    if (pages.length < 2) continue;
    const at = options.noteTime(note);
    const age = at === null ? 0 : Math.max(0, (options.now - at) / day);
    const fade = Math.max(0.25, 0.5 ** (age / CO_MENTION_HALF_LIFE_DAYS));
    const spread = Math.min(1, CO_MENTION_FAN / (pages.length - 1));
    const value = LINK_STRENGTH.coMention * fade * spread;
    for (const a of pages) for (const b of pages) if (a !== b) add(a, b, value, "co-mention");
  }
  const outDegree = new Map<string, number>();
  for (const key of parts.keys()) {
    const src = key.slice(0, key.indexOf("\n"));
    outDegree.set(src, (outDegree.get(src) ?? 0) + 1);
  }
  const links: WeightedLink[] = [];
  for (const [key, part] of parts) {
    const [src, dst] = key.split("\n") as [string, string];
    const reasons = [...part.reasons].sort();
    let strength = combineStrengths(part.values);
    if (reasons.length === 1 && reasons[0] === "co-mention") strength = Math.min(CO_MENTION_MAX, strength);
    const degree = outDegree.get(src)!;
    if (degree > HUB_LINKS) strength *= (HUB_LINKS / degree) ** 0.25;
    links.push({ src, dst, strength: round(strength), reasons: reasons.join(",") });
  }
  return links.sort((a, b) => a.src.localeCompare(b.src) || b.strength - a.strength || a.dst.localeCompare(b.dst));
}

export interface CloudSeed {
  path: string;
  /** 0..1: how well the seed matches (the best match is 1). */
  strength: number;
}

export interface CloudNode {
  path: string;
  /** Product of the strengths along the best path from a seed (a seed's own strength times each link). */
  strength: number;
  /** Links walked from the seed (0 for a seed). */
  hops: number;
  /** The seed this node was reached from. */
  seed: string;
  /** The node before this one on the path (null for a seed). */
  via: string | null;
  /** The path from the seed, seed first. */
  trail: string[];
}

/**
 * The cloud around the seeds: every node whose best path strength (seed strength × each link's
 * strength along the path) stays at or above `threshold`, strongest first, at most `maxNodes`
 * (seeds included). Best-first search: multiplying by strengths ≤ 1 only ever lowers a path, so
 * the first time a node is taken its path is its strongest.
 */
export function expandCloud(
  seeds: readonly CloudSeed[],
  linksOf: (path: string) => ReadonlyArray<{ dst: string; strength: number }>,
  options: { threshold?: number; maxNodes?: number; skip?: (path: string) => boolean; endsPath?: (path: string) => boolean } = {},
): CloudNode[] {
  const threshold = Math.max(0, Math.min(1, options.threshold ?? CLOUD_DEFAULT_THRESHOLD));
  const maxNodes = Math.max(1, Math.min(CLOUD_MAX_NODES, Math.trunc(options.maxNodes ?? CLOUD_DEFAULT_MAX_NODES)));
  const best = new Map<string, CloudNode>();
  const frontier: CloudNode[] = [];
  for (const seed of seeds) {
    if (seed.strength < threshold || options.skip?.(seed.path)) continue;
    const prior = best.get(seed.path);
    if (prior && prior.strength >= seed.strength) continue;
    const node = { path: seed.path, strength: seed.strength, hops: 0, seed: seed.path, via: null, trail: [seed.path] };
    best.set(seed.path, node);
    frontier.push(node);
  }
  const taken = new Map<string, CloudNode>();
  while (frontier.length > 0 && taken.size < maxNodes) {
    let top = 0;
    for (let i = 1; i < frontier.length; i++) {
      const a = frontier[i]!;
      const b = frontier[top]!;
      if (a.strength > b.strength || (a.strength === b.strength && a.path < b.path)) top = i;
    }
    const node = frontier.splice(top, 1)[0]!;
    if (taken.has(node.path) || best.get(node.path) !== node) continue;
    taken.set(node.path, node);
    if (node.hops > 0 && options.endsPath?.(node.path)) continue;
    for (const link of linksOf(node.path)) {
      if (taken.has(link.dst) || options.skip?.(link.dst)) continue;
      const strength = node.strength * link.strength;
      if (strength < threshold - 1e-9) continue;
      const prior = best.get(link.dst);
      if (prior && prior.strength >= strength) continue;
      const next = { path: link.dst, strength, hops: node.hops + 1, seed: node.seed, via: node.path, trail: [...node.trail, link.dst] };
      best.set(link.dst, next);
      frontier.push(next);
    }
  }
  return [...taken.values()].map((node) => ({ ...node, strength: round(node.strength) }));
}
