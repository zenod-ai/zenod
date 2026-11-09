import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf } from "../vault/files.js";
import { buildTreeIndex } from "../vault/tree.js";
import { parentRef, tokens, TrackedWrites } from "./treePlacement.js";

/**
 * E12-S24: the weekly sweep folds a small provisional leaf into the page it is about.
 *
 * Filing rescues (E12-S20, E12-S23) leave one provisional leaf per dropped point: often a few
 * lines on the same subject as a page beside it. A leaf whose quoted captures hold at most
 * `maxWords` words, made only of capture blocks, moves into the confirmed page it names: a
 * sibling under the same parent, or its parent when that parent is not a root (a root stays a
 * hub). The page must share a name word with the leaf's title; the parent wins a tie.
 *
 * Nothing is rewritten or lost: each `## Capture` block moves byte for byte, citation included,
 * under a heading with the leaf's title; the page gains the leaf's title as an alias; the leaf
 * keeps its path, parent and title as a pointer page (`merged-into:`), so every link still lands.
 * Pointer pages leave search and topic discovery. Writes stay uncommitted (the sweep commits).
 */

/** Words of the person's own quoted lines a leaf may hold to count as small. */
export const SMALL_LEAF_MAX_WORDS = 150;
/** A leaf younger than this may still be settling (a rescue the same week); leave it alone. */
export const MERGE_MIN_AGE_DAYS = 2;
export const MERGED_INTO_FIELD = "merged-into";

export interface MergedLeaf {
  path: string;
  title: string;
  into: string;
  /** `sibling`: a page under the same parent; `parent`: the leaf's own (non-root) parent. */
  relation: "sibling" | "parent";
  captures: number;
  words: number;
  /** Name words the leaf's title shares with the page. */
  shared: string[];
}

export interface MergeLeavesOptions {
  today: string;
  maxWords?: number;
  minAgeDays?: number;
}

const CAPTURE_HEADING_RE = /^## Capture \d{4}-\d{2}-\d{2} \[\[\d{4}-\d{2}-\d{2}#\^e-[0-9a-f]+\]\]/;
const LEAF_INTRO_RE = /^A provisional leaf under \[\[[^\]]+\]\]: .*$/;

/** A provisional leaf the rescue wrote and nobody edited since: title, intro, capture blocks. */
export function leafCaptures(body: string): { title: string; blocks: string[]; words: number } | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const title = /^# (.+)$/.exec(lines[i] ?? "")?.[1]?.trim();
  if (!title) return null;
  i++;
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) {
      if (!CAPTURE_HEADING_RE.test(line)) return null;
      if (current) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current) current.push(line);
    else if (line.trim() && !LEAF_INTRO_RE.test(line)) return null;
  }
  if (current) blocks.push(current.join("\n"));
  if (!blocks.length) return null;
  const trimmed = blocks.map(block => block.replace(/\n+$/, ""));
  const words = trimmed.join("\n").split("\n").filter(line => line.startsWith(">"))
    .join(" ").replace(/^>\s?/gm, "").split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  return { title, blocks: trimmed, words };
}

/** Add `alias` to a page's `aliases:` (block list), keeping every other frontmatter line as written. */
export function withAlias(raw: string, alias: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!match) throw new Error("tree_merge_no_frontmatter");
  const lines = match[1]!.split("\n");
  const quoted = JSON.stringify(alias);
  const at = lines.findIndex(line => /^aliases:/.test(line));
  if (at < 0) {
    lines.push("aliases:", `  - ${quoted}`);
  } else {
    const inline = /^aliases:\s*(.*)$/.exec(lines[at]!)![1]!.trim();
    let existing: string[] = [];
    let end = at + 1;
    if (inline.startsWith("[")) {
      existing = inline.slice(1, -1).split(",").map(item => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (inline) {
      existing = [inline.replace(/^["']|["']$/g, "")];
    } else {
      while (end < lines.length && /^\s+-\s/.test(lines[end]!)) end++;
    }
    const listed = [...existing, ...lines.slice(at + 1, end).map(line => line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))];
    if (listed.some(item => item.toLowerCase() === alias.toLowerCase())) return raw;
    if (inline) lines.splice(at, 1, "aliases:", ...existing.map(item => `  - ${JSON.stringify(item)}`), `  - ${quoted}`);
    else lines.splice(end, 0, `  - ${quoted}`);
  }
  return `---\n${lines.join("\n")}\n---${match[2]}${raw.slice(match[0].length)}`;
}

/** The pointer a merged leaf keeps at its path: same title and parent, no longer provisional. */
export function pointerPage(raw: string, into: { path: string; title: string }, today: string): string {
  const { body } = parseNote(raw);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!match) throw new Error("tree_merge_no_frontmatter");
  const title = /^# (.+)$/m.exec(body)?.[1]?.trim() ?? "";
  const kept = match[1]!.split("\n").filter(line => !/^(?:provisional|summary|updated|merged-into):/.test(line));
  const ref = parentRef(into.path);
  kept.push(`updated: ${today}`, `summary: ${JSON.stringify(`Merged into ${into.title}: its captures are there, word for word.`)}`, `${MERGED_INTO_FIELD}: ${JSON.stringify(ref)}`);
  return `---\n${kept.join("\n")}\n---\n\n# ${title}\n\nMerged into [[${into.path.replace(/\.md$/, "")}|${into.title}]] by the weekly sweep on ${today}: its captures are there, word for word.\n`;
}

const DAY_MS = 86_400_000;
/** Content similarity (TF-IDF cosine over the vault's tree pages) two sibling leaves need to be one subject. */
export const LEAF_PAIR_MIN_SIMILARITY = 0.25;
/** A confirmed page must also read like the leaf at least this much. */
const PAGE_MIN_SIMILARITY = 0.15;
/** Title words that say what kind of point it is, not what it is about. */
const GENERIC_TITLE_WORDS = new Set("request proposal propose proposes research concept desire potential decision plan user should idea issue discussion consideration expression concern".split(" "));

/** Word counts with the tokenizer placement uses (same stopwords and stemming). */
function termCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    for (const word of tokens(raw)) out.set(word, (out.get(word) ?? 0) + 1);
  }
  return out;
}

function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) return [...a].filter((ch, i) => ch !== b[i]).length <= 1;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

/** `infra` ~ `infrastructure`, `zenot` ~ `zenod`: a 5+ letter stem or one typo counts as the same word. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return a.startsWith(b) || b.startsWith(a) || oneEdit(a, b);
}

/** Title words that name the subject: not generic, not a word of the branch it already hangs on. */
function distinctTitleWords(title: string, lineageNames: string[]): Set<string> {
  const branch = tokens(lineageNames.join(" "));
  return new Set([...tokens(title)].filter(word => !GENERIC_TITLE_WORDS.has(word) && ![...branch].some(other => sameWord(word, other))));
}

function shared(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter(word => [...b].some(other => sameWord(word, other)));
}

interface Doc { vector: Map<string, number>; }

async function vectors(vaultPath: string, paths: string[]): Promise<Map<string, Doc>> {
  const counts = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const path of paths) {
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    const { frontmatter, body } = parseNote(raw);
    const title = typeof frontmatter?.title === "string" ? frontmatter.title : basenameOf(path);
    const text = `${title}\n${title}\n${title}\n${body.split("\n").filter(line => !LEAF_INTRO_RE.test(line)).join("\n")}`;
    const c = termCounts(text);
    counts.set(path, c);
    for (const word of c.keys()) df.set(word, (df.get(word) ?? 0) + 1);
  }
  const n = paths.length;
  const out = new Map<string, Doc>();
  for (const [path, c] of counts) {
    const vector = new Map<string, number>();
    let norm = 0;
    for (const [word, count] of c) {
      const weight = (1 + Math.log(count)) * Math.log(n / df.get(word)!);
      vector.set(word, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [word, weight] of vector) vector.set(word, weight / norm);
    out.set(path, { vector });
  }
  return out;
}

function cosine(a: Doc | undefined, b: Doc | undefined): number {
  if (!a || !b) return 0;
  let sum = 0;
  for (const [word, weight] of a.vector) sum += weight * (b.vector.get(word) ?? 0);
  return sum;
}

interface SmallLeaf {
  path: string;
  parent: string;
  raw: string;
  title: string;
  blocks: string[];
  words: number;
  distinct: Set<string>;
}

async function frontmatterOf(vaultPath: string, path: string): Promise<Record<string, unknown>> {
  return parseNote(await readFile(join(vaultPath, path), "utf8").catch(() => "")).frontmatter ?? {};
}

async function mergeInto(vaultPath: string, writes: TrackedWrites, leaf: SmallLeaf, into: { path: string; title: string }, today: string): Promise<void> {
  const targetRaw = await readFile(join(vaultPath, into.path), "utf8");
  const section = [`## ${leaf.title}`, "", `Merged from [[${leaf.path.replace(/\.md$/, "")}|${leaf.title}]] by the weekly sweep on ${today}: its captures, word for word.`, "", leaf.blocks.join("\n\n"), ""].join("\n");
  await writes.write(into.path, `${withAlias(targetRaw, leaf.title).replace(/\n*$/, "\n")}\n${section}`);
  await writes.write(leaf.path, pointerPage(leaf.raw, into, today));
  // Every capture block now sits in the page byte for byte, or nothing is kept.
  const written = await readFile(join(vaultPath, into.path), "utf8");
  for (const block of leaf.blocks) if (!written.includes(block)) throw new Error(`tree_merge_lost_capture: ${leaf.path}`);
}

/**
 * Plan and write the merges (see the module comment). First each small leaf whose title a
 * confirmed sibling or non-root parent names goes into that page; then small sibling leaves that
 * read alike and share a subject word in their titles become one leaf, kept on the fullest of them.
 */
export async function mergeSmallLeaves(vaultPath: string, writes: TrackedWrites, options: MergeLeavesOptions): Promise<MergedLeaf[]> {
  const maxWords = options.maxWords ?? SMALL_LEAF_MAX_WORDS;
  const minAgeDays = options.minAgeDays ?? MERGE_MIN_AGE_DAYS;
  const index = await buildTreeIndex(vaultPath);
  const treePaths = [...index.fields.keys()].filter(path => !index.fields.get(path)!.merged && index.lineage(path).ok).sort();
  const docs = await vectors(vaultPath, treePaths);

  const small: SmallLeaf[] = [];
  for (const path of treePaths) {
    const fields = index.fields.get(path)!;
    if (!fields.provisional || index.rootsByPath.has(path.toLowerCase()) || index.children(path).length) continue;
    const lineage = index.lineage(path);
    if (!lineage.ok || lineage.steps.length < 2) continue;
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
    if (raw === null) continue;
    const { frontmatter, body } = parseNote(raw);
    const created = String(frontmatter?.created ?? "");
    if (/^\d{4}-\d{2}-\d{2}/.test(created)
      && (Date.parse(`${options.today}T00:00:00Z`) - Date.parse(`${created.slice(0, 10)}T00:00:00Z`)) / DAY_MS < minAgeDays) continue;
    const leaf = leafCaptures(body);
    if (!leaf || leaf.words > maxWords) continue;
    const names = lineage.steps.slice(0, -1).map(step => `${step.name} ${basenameOf(step.path)}`);
    const distinct = distinctTitleWords(leaf.title, names);
    if (!distinct.size) continue;
    small.push({ path, parent: lineage.steps[lineage.steps.length - 2]!.path, raw, title: leaf.title, blocks: leaf.blocks, words: leaf.words, distinct });
  }

  const out: MergedLeaf[] = [];
  const done = new Set<string>();
  // 1. Into a confirmed page that names the leaf's subject.
  for (const leaf of small) {
    const candidates: Array<{ path: string; relation: MergedLeaf["relation"] }> = [];
    if (!index.rootsByPath.has(leaf.parent.toLowerCase()) && !index.fields.get(leaf.parent)?.provisional) candidates.push({ path: leaf.parent, relation: "parent" });
    for (const sibling of index.children(leaf.parent)) {
      const f = index.fields.get(sibling);
      if (sibling !== leaf.path && f && !f.provisional && !f.merged) candidates.push({ path: sibling, relation: "sibling" });
    }
    let best: { path: string; relation: MergedLeaf["relation"]; words: string[]; share: number; similarity: number } | null = null;
    for (const candidate of candidates) {
      const fm = await frontmatterOf(vaultPath, candidate.path);
      const aliases = Array.isArray(fm.aliases) ? fm.aliases.filter((a): a is string => typeof a === "string") : [];
      const words = shared(leaf.distinct, tokens(`${index.fields.get(candidate.path)?.title ?? ""} ${basenameOf(candidate.path)} ${aliases.join(" ")}`));
      const share = words.length / leaf.distinct.size;
      const similarity = cosine(docs.get(leaf.path), docs.get(candidate.path));
      if (share < 0.5 || similarity < PAGE_MIN_SIMILARITY) continue;
      if (!best || share > best.share || (share === best.share && similarity > best.similarity)) best = { ...candidate, words, share, similarity };
    }
    if (!best) continue;
    await mergeInto(vaultPath, writes, leaf, { path: best.path, title: index.fields.get(best.path)?.title ?? basenameOf(best.path) }, options.today);
    out.push({ path: leaf.path, title: leaf.title, into: best.path, relation: best.relation, captures: leaf.blocks.length, words: leaf.words, shared: best.words });
    done.add(leaf.path);
  }

  // 2. Sibling leaves on one subject become one leaf (union of alike pairs under the same parent).
  const rest = small.filter(leaf => !done.has(leaf.path));
  const group = new Map(rest.map(leaf => [leaf.path, leaf.path]));
  const find = (path: string): string => { let at = path; while (group.get(at) !== at) at = group.get(at)!; return at; };
  const why = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[i]!, b = rest[j]!;
      if (a.parent !== b.parent) continue;
      const words = shared(a.distinct, b.distinct);
      if (!words.length || cosine(docs.get(a.path), docs.get(b.path)) < LEAF_PAIR_MIN_SIMILARITY) continue;
      why.set(a.path, [...new Set([...(why.get(a.path) ?? []), ...words])]);
      why.set(b.path, [...new Set([...(why.get(b.path) ?? []), ...words])]);
      group.set(find(b.path), find(a.path));
    }
  }
  const groups = new Map<string, SmallLeaf[]>();
  for (const leaf of rest) groups.set(find(leaf.path), [...(groups.get(find(leaf.path)) ?? []), leaf]);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // The fullest leaf keeps the subject; ties go to path order.
    const host = [...members].sort((a, b) => b.words - a.words || a.path.localeCompare(b.path))[0]!;
    for (const leaf of members) {
      if (leaf === host) continue;
      await mergeInto(vaultPath, writes, leaf, { path: host.path, title: host.title }, options.today);
      out.push({ path: leaf.path, title: leaf.title, into: host.path, relation: "sibling", captures: leaf.blocks.length, words: leaf.words, shared: why.get(leaf.path) ?? [] });
    }
  }
  return out;
}
