import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseLogCaptures } from "./captureOrigin.js";
import { basenameOf, isFilingReceiptPath, isIndexFile, listMarkdownFiles, tierOf } from "./files.js";
import { parseNote } from "./frontmatter.js";
import { idfOf, matchPercent, monotonic } from "./matchPercent.js";
import { formatMemoryLineage, loadMemoryTree } from "./lineage.js";
import { pageTreeFields, parseTree, TREE_PATH } from "./tree.js";
import { extractCitations, extractPageLinks } from "./pages.js";
import { isVoiceCapture, recentIntent, type RecentIntent } from "./recentIntent.js";
import { MemoryGraph, MEMORY_GRAPH_DEFAULT_LIMIT, type MemoryGraphRawEdge, type MemoryGraphView } from "./memoryGraph.js";

/**
 * Tier-0 memory index (EPIC-9 E9-5a): one SQLite FTS5 file per tenant, derived from the
 * vault and stored beside it (never committed into it). BM25 over pages, Log entries and
 * Tree.md roots, each row carrying its tree lineage, so "where did I say…" answers in
 * milliseconds for $0, the same way every time. Rebuildable from the vault at any time.
 */

/**
 * 2: the `edges` table (E12-S2 memory graph). 3: Log entries carry who sent them and whether
 * they are voice notes (`meta`), and the edges that tie a note to its topics: page citations
 * and filing receipts (E12-S3c). An older file is rebuilt once on open.
 */
const SCHEMA_VERSION = "3";
const MAX_HITS = 20;
/** Column weights for bm25(): title, aliases, lineage, summary, body (E9-4 §6). */
const BM25_WEIGHTS = "10.0, 10.0, 5.0, 3.0, 1.0";
const LOG_FILE_RE = /^Log\/(\d{4}-\d{2}-\d{2})\.md$/;
/** Re-check the vault on disk at least this often even when no write marked the index dirty. */
const STALE_AFTER_MS = 60_000;
/**
 * A Log entry also carries the tree path of the page it was filed on, so on a page's own
 * words it ties with that page. The page is the digested answer: rank raw entries below it
 * unless they match clearly better.
 */
const KIND_FACTOR: Record<MemoryIndexHitKind, number> = { page: 1, root: 1, log: 0.5 };
/**
 * An agent's report in the Log (deploy notes, wake reads: captureOrigin.ts) is content, not what
 * the person said: it ranks below the person's own words on the same match (E12-S3c round 2).
 */
const AGENT_LOG_FACTOR = 0.5;
/** A hit holding under this share of the best hit's question words is not shown (E12-S3c). */
const MIN_SHARE_OF_BEST = 0.25;
const factorOf = (row: { kind: MemoryIndexHitKind; meta?: string }) => KIND_FACTOR[row.kind] * (row.meta?.startsWith("agent") ? AGENT_LOG_FACTOR : 1);

const STOP_WORDS = new Set([
  // English
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "been", "before", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "get", "got", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it",
  "its", "me", "my", "of", "on", "or", "our", "please", "should", "so", "tell", "that", "the", "their", "them", "there", "these",
  "this", "those", "to", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
  // Spanish
  "al", "como", "con", "cual", "cuando", "de", "del", "donde", "el", "ella", "en", "es", "esa", "ese", "eso", "esta", "este", "esto",
  "fue", "ha", "hay", "la", "las", "le", "les", "lo", "los", "mi", "mis", "muy", "no", "nos", "o", "para", "pero", "por", "que", "qué",
  "se", "si", "sin", "sobre", "son", "su", "sus", "te", "tu", "un", "una", "uno", "unos", "y", "ya", "yo",
]);

/**
 * Words that name memory itself or a generic request, not what the question is about
 * (E12-S3c). "how does my memory work" must not rank every page under "Long-term memory ›"
 * (the tree path is indexed) at the same score. Dropped like stop words, unless the question
 * has nothing else.
 */
const GENERIC_WORDS = new Set([
  "memory", "memories", "memoria", "memorias", "remember", "remind", "recall", "note", "notes", "nota", "notas", "know", "knowledge",
  "use", "using", "used", "usar", "want", "need", "think", "say", "said", "mean", "means", "work", "works", "going", "something",
  "thing", "things", "everything", "anything", "much", "many", "let", "make", "give", "show", "find", "look",
  // The kind of capture, not its subject (E12-S3c round 2): "my voice note about the fence" is about the fence.
  "voice", "vn", "vns", "audio", "audios",
]);

export interface MemoryIndexOptions {
  /** SQLite file in the tenant's data dir, e.g. `<dataDir>/memory-index.sqlite`. */
  path: string;
  vaultPath: string;
  /**
   * The tenant this index belongs to. An index file stamped for another tenant is never
   * read or written (MemoryIndexTenantError). Omit only in single-tenant tools (the CLI),
   * which then adopt the file's own stamp.
   */
  tenantId?: string;
  /** Alias groups: any member in a query also searches the others. None built in (root L-7). */
  aliases?: readonly (readonly string[])[];
  now?: () => number;
}

export type MemoryIndexHitKind = "page" | "log" | "root";

export interface MemoryIndexHit {
  /** Page path, or `Log/YYYY-MM-DD.md#^e-xxxxxx` for a Log entry. */
  path: string;
  kind: MemoryIndexHitKind;
  title: string;
  snippet: string;
  /** Positive relevance (negated bm25), higher is better. */
  score: number;
  /** 1–100: half how much of the question it contains (rarity-weighted), half its strength vs the best hit (matchPercent.ts). */
  matchPercent: number;
  /** `Working memory › House › Visits`; "" when the page (or the page a Log entry was filed on) is unplaced. */
  treePath: string;
  /** For a Log entry: the placed page it was filed on, when known. */
  filedOn?: string;
  /**
   * Why a recent-note question shows this hit (E12-S3c): `note` the note itself, ranked by time;
   * `filed` a page the note was filed into; `linked` a page the note links to; `parent` the tree
   * parent of such a page. On other questions, `child` / `linked` a page under, or linked from, the
   * best hit (withGraphNeighbours). Absent for an ordinary word match.
   */
  relation?: MemoryIndexRelation;
  /** For a `filed`/`linked`/`parent`/`child` hit: the note or best hit it connects to. */
  via?: string;
  /** For a note: its filing never tied it to any topic page. */
  unlinked?: boolean;
  /** For a note: topics its filing planned but never wrote to a page (filing stopped half way). */
  unwritten?: number;
}

export type MemoryIndexRelation = "note" | "filed" | "linked" | "parent" | "child";

/** Voice notes and whether each is tied to a topic page (E12-S3c, the gap S8 fixes). */
export interface MemoryNoteLinks {
  /** Voice notes from the person (agent reports excluded). */
  voiceNotes: number;
  /** Of those, notes no page cites, no receipt files and that link to nothing. */
  unlinked: number;
  /** Of those, notes whose filing planned topics it never wrote. */
  partial: number;
  /** The newest unlinked notes, newest first (paths), at most 20. */
  unlinkedPaths: string[];
}

export interface MemoryIndexStats {
  rows: number;
  files: number;
  bytes: number;
  ms: number;
}

export class MemoryIndexTenantError extends Error {
  constructor(expected: string, found: string) {
    super(`memory index belongs to tenant ${found}, not ${expected}; refusing to open it`);
    this.name = "MemoryIndexTenantError";
  }
}

interface Row {
  title: string;
  aliases: string;
  lineage: string;
  summary: string;
  body: string;
  kind: MemoryIndexHitKind;
  path: string;
  file: string;
  filed: string;
  /** Log rows: `user`/`agent`, plus ` voice` for a voice note. "" otherwise. */
  meta: string;
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** FTS5 MATCH expression: content words OR'd (prefix for longer words), plus alias phrases. */
export function buildMatch(query: string, aliasGroups: readonly (readonly string[])[]): string | null {
  return buildMatchTerms(query, aliasGroups).match;
}

/**
 * The MATCH expression and, separately, one clause per content word of the query (aliases
 * excluded): the words a hit's coverage is measured against.
 */
export function buildMatchTerms(
  query: string,
  aliasGroups: readonly (readonly string[])[],
  /** Other spellings of a query word, each an OR alternative credited as that word (E12-S1b round 2). */
  variants?: ReadonlyMap<string, readonly string[]>,
): { match: string | null; terms: string[]; generic: boolean } {
  const normalized = normalize(query);
  const words = normalized.split(" ").filter(Boolean);
  const content = words.filter((word) => !STOP_WORDS.has(word) && word.length >= 2);
  let terms = [...new Set(content.filter((word) => !GENERIC_WORDS.has(word)))];
  const generic = terms.length === 0;
  if (terms.length === 0) terms = [...new Set(content)];
  if (terms.length === 0) terms = [...new Set(words)];
  // Joined and split spellings (E12-S3d): "Epic Spine" finds "EpicSpine" (adjacent words joined),
  // "EpicSpine" finds "Epic Spine" / "epic-spine" (camel-case split into a phrase). Each is an OR
  // alternative of the word it belongs to, so coverage credits the joined match for both words.
  const alts = new Map<string, Set<string>>();
  const addAlt = (term: string, clause: string) => {
    if (!alts.has(term)) alts.set(term, new Set());
    alts.get(term)!.add(clause);
  };
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i]!, words[i + 1]!];
    if (!terms.includes(a) || !terms.includes(b) || a === b) continue;
    addAlt(a, quote(a + b));
    addAlt(b, quote(a + b));
  }
  for (const raw of query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []) {
    const split = normalize(raw.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2"));
    const joined = normalize(raw);
    if (split !== joined && split.includes(" ") && terms.includes(joined)) addAlt(joined, quote(split));
  }
  for (const term of terms) for (const variant of variants?.get(term) ?? []) addAlt(term, quote(variant));
  const clauses = new Set<string>();
  const termClauses: string[] = [];
  for (const term of terms) {
    // Light, language-neutral stemming: "visits"/"quotes" → visit*/quote*. No Porter (English-only).
    const stem = term.length >= 5 && term.endsWith("s") ? term.slice(0, -1) : term;
    const clause = stem.length >= 4 ? `${quote(stem)}*` : quote(stem);
    const own = [clause, ...(alts.get(term) ?? [])];
    for (const c of own) clauses.add(c);
    termClauses.push(own.length > 1 ? `(${own.join(" OR ")})` : clause);
  }
  const padded = ` ${normalized} `;
  for (const group of aliasGroups) {
    const members = group.map(normalize).filter(Boolean);
    if (!members.some((member) => padded.includes(` ${member} `))) continue;
    for (const member of members) if (!terms.includes(member)) clauses.add(quote(member));
  }
  return { match: clauses.size ? [...clauses].join(" OR ") : null, terms: termClauses, generic };
}

/**
 * How strongly a page is tied to a note (E12-S3c), before how much of the note it holds is added
 * (recentSearch, up to +0.12): cited by the page 0.8, written by its filing 0.78, linked from the
 * note 0.72; each further tie of the same page +0.03, and a deeper (more specific) page +0.01 per
 * level up to three. Never above 0.97: a page is never the note itself.
 */
export function connectionWeight(kinds: ReadonlySet<string>, depth: number): number {
  const base = Math.max(kinds.has("cites") ? 0.8 : 0, kinds.has("filed") ? 0.78 : 0, kinds.has("mentions") ? 0.72 : 0);
  return Math.min(0.97, base + 0.03 * Math.max(0, kinds.size - 1) + 0.01 * Math.min(3, Math.max(0, depth - 1)));
}

/** Edit distance with adjacent swaps (Damerau, optimal string alignment), for short words. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** A voice note's words without the ingest lines (file name, raw artifact, transcriber). */
function spokenWords(body: string): string {
  return body.split("\n").filter((line) => !/^(?:voice note "|raw artifact:|transcribed by\b|\s*$)/i.test(line.trim())).join("\n") || body;
}

/** The lines of a page that cite a Log entry (what the filing wrote there), without the citation. */
function citingLines(body: string, notePath: string): string[] {
  const match = /^Log\/(\d{4}-\d{2}-\d{2})\.md#\^(e-[0-9a-f]{6})$/.exec(notePath);
  if (!match) return [];
  return body.split("\n")
    .filter((text) => text.includes(`[[${match[1]}#^${match[2]}`))
    .map((line) => line.replace(/\[\[\d{4}-\d{2}-\d{2}#\^e-[0-9a-f]{6}(?:\|[^\]]*)?\]\]/g, "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function citingSnippet(lines: readonly string[]): string | null {
  const text = lines.join(" ");
  if (!text) return null;
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS).trim()}…` : text;
}

/** Distinct words of four letters or more that say something (stop and generic words left out). */
function contentWords(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !GENERIC_WORDS.has(word)));
}

const SNIPPET_CHARS = 200;
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** The quoted words of a MATCH expression, accent-folded: what a snippet should show. */
function matchWords(match: string): string[] {
  return [...match.matchAll(/"((?:[^"]|"")+)"/g)].map((m) => fold(m[1]!.replace(/""/g, '"'))).filter(Boolean);
}

/** ~200 characters around the first matched word in the body, else the summary, else the body's start. */
function snippetOf(row: { summary: string; body: string } | undefined, words: readonly string[]): string {
  if (!row) return "";
  for (const text of [row.body, row.summary]) {
    const flat = text.replace(/\s+/g, " ").trim();
    // Folding can change length for some scripts; only trust positions when it does not.
    const folded = fold(flat);
    if (folded.length !== flat.length) continue;
    let at = -1;
    for (const word of words) {
      const found = folded.indexOf(word);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
    if (at < 0) continue;
    const start = Math.max(0, at - 60);
    return `${start > 0 ? "…" : ""}${flat.slice(start, start + SNIPPET_CHARS).trim()}${start + SNIPPET_CHARS < flat.length ? "…" : ""}`;
  }
  const flat = (row.summary || row.body).replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS).trim()}…` : flat;
}

export class MemoryIndex {
  private readonly db: DatabaseSync;
  private dirty = true;
  private lastCheck = Number.NEGATIVE_INFINITY;
  private inflight: Promise<unknown> | null = null;
  /** Bumped by every sync that changed rows: the cached graph is rebuilt on the next read. */
  private version = 0;
  private graphCache: { version: number; graph: MemoryGraph } | null = null;
  private spokenCache: { version: number; words: Map<string, number> } | null = null;
  private aliasGroups: readonly (readonly string[])[];
  readonly tenantId: string;
  private readonly now: () => number;

  private constructor(private readonly options: MemoryIndexOptions) {
    this.now = options.now ?? Date.now;
    if (options.path !== ":memory:") mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime_ms REAL NOT NULL, size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS edges (file TEXT NOT NULL, src TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edges_file ON edges (file);
    `);
    const meta = new Map((this.db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
    // The docs columns changed with the schema: an older table is dropped, not just emptied.
    if (meta.get("schema") !== SCHEMA_VERSION) this.db.exec("DROP TABLE IF EXISTS docs;");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS edges_src ON edges (src);
      CREATE INDEX IF NOT EXISTS edges_target ON edges (target);
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        title, aliases, lineage, summary, body,
        kind UNINDEXED, path UNINDEXED, file UNINDEXED, filed UNINDEXED, meta UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2"
      );
    `);
    const stamped = meta.get("tenant");
    if (stamped && options.tenantId && stamped !== options.tenantId) {
      this.db.close();
      throw new MemoryIndexTenantError(options.tenantId, stamped);
    }
    this.tenantId = options.tenantId ?? stamped ?? "standalone";
    const setMeta = this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    // A different vault location or schema invalidates every row: start clean.
    if (meta.get("schema") !== SCHEMA_VERSION || meta.get("vault") !== options.vaultPath) {
      this.db.exec("DELETE FROM docs; DELETE FROM files; DELETE FROM edges;");
    }
    setMeta.run("tenant", this.tenantId);
    setMeta.run("schema", SCHEMA_VERSION);
    setMeta.run("vault", options.vaultPath);
    this.aliasGroups = options.aliases ?? [];
  }

  /** Open (or create) a tenant's index. Throws MemoryIndexTenantError for another tenant's file. */
  static open(options: MemoryIndexOptions): MemoryIndex {
    return new MemoryIndex(options);
  }

  /** The vault changed (a filing committed, a pull landed): the next search re-checks it. */
  markDirty(): void {
    this.dirty = true;
  }

  close(): void {
    this.db.close();
  }

  /** Bring the index in line with the vault, re-reading only files whose mtime/size changed. */
  refresh(): Promise<{ changed: number; removed: number }> {
    return this.serialize(() => this.sync(false));
  }

  /** Drop every row and index the whole vault again. Idempotent: same vault → same rows. */
  async rebuild(): Promise<MemoryIndexStats> {
    const started = performance.now();
    await this.serialize(() => this.sync(true));
    return { ...this.stats(), ms: Math.round(performance.now() - started) };
  }

  stats(): MemoryIndexStats {
    const rows = (this.db.prepare("SELECT count(*) AS n FROM docs").get() as { n: number }).n;
    const files = (this.db.prepare("SELECT count(*) AS n FROM files").get() as { n: number }).n;
    const page = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const size = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    return { rows, files, bytes: page.page_count * size.page_size, ms: 0 };
  }

  /** Every row as plain text, sorted: rebuild idempotency checks compare two dumps. */
  dump(): string {
    const rows = this.db.prepare("SELECT kind, path, file, filed, title, aliases, lineage, summary, body FROM docs ORDER BY path, kind, title").all();
    return JSON.stringify(rows);
  }

  /** BM25-ranked hits, one per path, freshest index first. Empty when nothing matches. */
  async search(query: string, limit = MAX_HITS): Promise<MemoryIndexHit[]> {
    await this.fresh();
    // "What was in my last voice note?" is answered by time and the graph, not by its words (E12-S3c).
    const intent = recentIntent(query, this.now());
    if (intent) {
      const recent = this.recentSearch(intent, limit);
      if (recent.length > 0) return recent;
    }
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups);
    if (!match) return [];
    const rows = this.db.prepare(`
      SELECT rowid, kind, path, title, filed, lineage, meta, bm25(docs, ${BM25_WEIGHTS}) AS rank
      FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?
    `).all(match, Math.max(40, limit * 8)) as Array<{ rowid: number; kind: MemoryIndexHitKind; path: string; title: string; filed: string; lineage: string; meta: string; rank: number }>;
    const picked: typeof rows = [];
    const seen = new Set<string>();
    const scored = rows.map((row) => ({ ...row, rank: row.rank * factorOf(row) })).sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
    for (const row of scored) {
      if (seen.has(row.path)) continue; // a root row and its page share a path: keep the best
      seen.add(row.path);
      picked.push(row);
      if (picked.length >= Math.max(40, limit * 8)) break;
    }
    if (picked.length === 0) return [];
    const words = matchWords(match);
    const coverage = this.coverageOf(terms, picked.map((row) => row.rowid));
    // A page that only matches on its tree path (or on nothing a person wrote) is not an answer:
    // drop it, and drop hits holding under a quarter of what the best one does. Never drop to empty.
    const best = Math.max(0, ...picked.map((row) => coverage.get(row.rowid) ?? 0));
    const kept = best > 0 ? picked.filter((row) => (coverage.get(row.rowid) ?? 0) >= best * MIN_SHARE_OF_BEST) : picked;
    kept.splice(limit);
    const topScore = -kept[0]!.rank;

    // FTS5 snippet() re-tokenizes whole bodies and was most of a query's time: a plain
    // window around the first matched word does the same job for the returned rows only.
    const texts = new Map((this.db.prepare(`SELECT rowid, summary, body FROM docs WHERE rowid IN (${kept.map(() => "?").join(", ")})`)
      .all(...kept.map((row) => row.rowid)) as Array<{ rowid: number; summary: string; body: string }>).map((row) => [row.rowid, row]));
    // A question made only of generic words ("how does my memory work") matches on nothing in
    // particular: whatever it finds reads weak.
    const percents = monotonic(kept.map((row) => matchPercent({ score: -row.rank, topScore, coverage: (coverage.get(row.rowid) ?? 0) * (generic ? 0.3 : 1) })));
    return this.withGraphNeighbours(kept.map((row, i): MemoryIndexHit => ({
      path: row.path, kind: row.kind, title: row.title, snippet: snippetOf(texts.get(row.rowid), words),
      score: Math.round(-row.rank * 100) / 100,
      matchPercent: percents[i]!,
      treePath: row.lineage,
      ...(row.filed ? { filedOn: row.filed } : {}),
    })), limit);
  }

  /**
   * The top memories follow the graph (E12-S3c round 2): when the best hit is a page that clearly
   * answers (60 % or more), up to two of the pages under it or linked from it join the list at
   * the best hit's percent times their tie (0.5 for a page under it, 0.45 for a link, +0.02 per
   * note filed into it, up to five), so its own topic outranks pages that share only a word.
   */
  private withGraphNeighbours(hits: MemoryIndexHit[], limit: number): MemoryIndexHit[] {
    const top = hits[0];
    if (!top || top.kind === "log" || top.matchPercent < 60 || hits.length === 0) return hits;
    const graph = this.memoryGraph();
    if (!graph.has(top.path)) return hits;
    const shown = new Set(hits.map((hit) => hit.path));
    const cites = this.db.prepare("SELECT count(*) AS n FROM edges WHERE kind = 'cites' AND src = ?");
    const near = [
      ...graph.childrenOf(top.path).map((path) => ({ path, relation: "child" as const, base: 0.5 })),
      ...graph.linksOf(top.path).map((path) => ({ path, relation: "linked" as const, base: 0.45 })),
    ].filter((item, i, all) => !shown.has(item.path) && item.path !== TREE_PATH && all.findIndex((other) => other.path === item.path) === i)
      .map((item) => ({ ...item, weight: item.base + 0.02 * Math.min(5, (cites.get(item.path) as { n: number }).n) }))
      .sort((a, b) => b.weight - a.weight || graph.titleOf(a.path).localeCompare(graph.titleOf(b.path)))
      .slice(0, 2);
    if (near.length === 0) return hits;
    const added: MemoryIndexHit[] = [];
    for (const item of near) {
      const page = this.db.prepare("SELECT title, summary, body, lineage FROM docs WHERE path = ? AND kind IN ('page', 'root') ORDER BY kind = 'page' DESC LIMIT 1")
        .get(item.path) as { title: string; summary: string; body: string; lineage: string } | undefined;
      if (!page) continue;
      added.push({
        path: item.path, kind: "page", title: page.title, snippet: snippetOf(page, []), score: 0,
        matchPercent: Math.max(1, Math.round(top.matchPercent * item.weight)), treePath: page.lineage, relation: item.relation, via: top.path,
      });
    }
    return [...hits, ...added].map((hit, i) => ({ hit, i })).sort((a, b) => b.hit.matchPercent - a.hit.matchPercent || a.i - b.i).map(({ hit }) => hit).slice(0, limit);
  }

  /**
   * A recent-note question (recentIntent.ts): the person's latest notes (voice notes when it
   * asks for one), newest first, then the pages the latest one was filed into or links to and
   * their tree parents. A note's percent is its fit (1 without a topic, else how much of the
   * topic it holds) halved per newer note before it; a page's is the note's times how strongly
   * the graph ties them (connectionWeight). Empty when no note fits, so the word search answers.
   */
  private recentSearch(intent: RecentIntent, limit: number): MemoryIndexHit[] {
    const rows = this.db.prepare("SELECT rowid, path, title, file, meta, summary, body, lineage, filed FROM docs WHERE kind = 'log'").all() as Array<{
      rowid: number; path: string; title: string; file: string; meta: string; summary: string; body: string; lineage: string; filed: string;
    }>;
    const person = rows.filter((row) => row.meta.startsWith("user"));
    const voice = person.filter((row) => row.meta.endsWith(" voice"));
    let pool = intent.voice && voice.length > 0 ? voice : person;
    if (pool.length === 0) return [];
    // Newest first: a Log file is named by its day and its entries are appended in time order.
    pool.sort((a, b) => b.file.localeCompare(a.file) || b.rowid - a.rowid);
    if (intent.window.kind === "day") {
      const day = `Log/${intent.window.date}.md`;
      pool = pool.filter((row) => row.file === day);
      if (pool.length === 0) return [];
    } else if (intent.window.kind === "range") {
      // A period (E12-S1b round 2): every note from its first day to its last, newest first.
      const [from, to] = [`Log/${intent.window.from}.md`, `Log/${intent.window.to}.md`];
      pool = pool.filter((row) => row.file >= from && row.file <= to);
      if (pool.length === 0) return [];
    }
    pool = pool.slice(0, 200);
    let fit = new Map(pool.map((row) => [row.rowid, 1]));
    let words: string[] = [];
    let topicTerms: string[] = [];
    if (intent.topic) {
      const { match, terms, generic } = buildMatchTerms(intent.topic, this.aliasGroups);
      if (match && !generic) {
        const coverage = this.coverageOf(terms, pool.map((row) => row.rowid));
        const best = Math.max(0, ...coverage.values());
        if (best === 0) return [];
        pool = pool.filter((row) => (coverage.get(row.rowid) ?? 0) >= best * 0.5);
        fit = coverage;
        words = matchWords(match);
        topicTerms = terms;
      }
    }
    const percentOf = (value: number) => Math.max(1, Math.min(100, Math.round(value * 100)));
    const hits: MemoryIndexHit[] = [];
    // The latest note halves each older one; in a period every note counts, so they fall gently.
    const decay = intent.window.kind === "range" ? 0.95 : 0.5;
    pool.slice(0, limit).forEach((note, k) => {
      const notePercent = percentOf((fit.get(note.rowid) ?? 0) * decay ** k);
      const links = this.connectionsOf(note.path);
      hits.push({
        path: note.path, kind: "log", title: note.title, snippet: snippetOf({ summary: "", body: spokenWords(note.body) }, words),
        score: 0, matchPercent: notePercent, treePath: note.lineage, ...(note.filed ? { filedOn: note.filed } : {}),
        relation: "note",
        ...(links.pages.length === 0 ? { unlinked: true } : {}),
        ...(links.unwritten > 0 ? { unwritten: links.unwritten } : {}),
      });
      // The pages it was filed into follow the latest note only: older notes stay one line each.
      // A period lists its notes alone: the period is the answer, not one note's topics.
      if (k > 0 || intent.window.kind === "range") return;
      const said = contentWords(note.body);
      // A question with a topic ("what did I say about explainer videos today") keeps only the
      // note's pages that are about it: the others were filed from other parts of the note.
      const onTopic = topicTerms.length ? this.pagesMatching(topicTerms, links.pages.map((link) => link.path)) : null;
      for (const link of links.pages) {
        if (onTopic && !onTopic.has(link.path)) continue;
        const page = this.db.prepare("SELECT title, summary, body, lineage FROM docs WHERE path = ? AND kind IN ('page', 'root') ORDER BY kind = 'page' DESC LIMIT 1")
          .get(link.path) as { title: string; summary: string; body: string; lineage: string } | undefined;
        if (!page) continue;
        // How much of the note this page holds: the share of the note's words in the lines that cite it.
        const lines = citingLines(page.body, note.path);
        const held = said.size ? [...contentWords(lines.join(" "))].filter((word) => said.has(word)).length / said.size : 0;
        const weight = link.relation === "parent" ? link.weight : Math.min(0.97, link.weight + Math.min(0.12, 0.4 * held));
        hits.push({
          path: link.path, kind: "page", title: page.title,
          snippet: citingSnippet(lines) ?? snippetOf(page, words),
          score: 0, matchPercent: percentOf((notePercent / 100) * weight), treePath: page.lineage,
          relation: link.relation, via: note.path,
        });
      }
    });
    // Highest first; a tie keeps the order above (stronger tie, deeper page, then title).
    return hits.map((hit, i) => ({ hit, i })).sort((a, b) => b.hit.matchPercent - a.hit.matchPercent || a.i - b.i).map(({ hit }) => hit).slice(0, limit);
  }

  /**
   * The person's own notes that best match a question (E12-S1b round 2): Log entries they sent,
   * never agent reports, by how much of the question's words each holds, then BM25. The chat
   * answer reads them beside the ranked memories: BM25 ranks a long voice note low, so the ranked
   * list often misses the one note that says it. Empty for a question with no telling word.
   */
  async ownNotes(query: string, limit = 6): Promise<string[]> {
    await this.fresh();
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups, this.spellingVariants(query));
    if (!match || generic) return [];
    const rows = this.db.prepare(`
      SELECT rowid, path, bm25(docs, ${BM25_WEIGHTS}) AS rank FROM docs
      WHERE docs MATCH ? AND kind = 'log' AND meta LIKE 'user%' ORDER BY rank LIMIT 80
    `).all(match) as Array<{ rowid: number; path: string; rank: number }>;
    if (rows.length === 0) return [];
    const coverage = this.coverageOf(terms, rows.map((row) => row.rowid));
    const best = Math.max(0, ...coverage.values());
    if (best === 0) return [];
    return rows
      .filter((row) => (coverage.get(row.rowid) ?? 0) >= best * 0.6)
      .sort((a, b) => (coverage.get(b.rowid) ?? 0) - (coverage.get(a.rowid) ?? 0) || a.rank - b.rank)
      .slice(0, limit)
      .map((row) => row.path);
  }

  /**
   * How a speech-to-text model keeps spelling a word the person writes (E12-S1b round 2): Jordi says
   * "Zenod" and his transcripts say "Zenot", "Znot", "Zinot". For a question word of five letters or
   * more that the vault knows (3+ rows) but that is (almost) never in what the person said, the
   * words of their voice notes that start with the same letter, are at most one letter longer or
   * shorter, two edits away or less, and recur in 2+ notes. At most four per word.
   */
  private spellingVariants(query: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const words = [...new Set(normalize(query).split(" ").filter((word) => word.length >= 5 && !STOP_WORDS.has(word) && !GENERIC_WORDS.has(word) && !/\d/.test(word)))];
    if (words.length === 0) return out;
    const spoken = this.spokenVocabulary();
    const rows = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
    for (const word of words) {
      if ((spoken.get(word) ?? 0) > 1) continue;
      if ((rows.get(`{title aliases summary body} : ${quote(word)}`) as { n: number }).n < 3) continue;
      const found = [...spoken]
        .filter(([other, notes]) => notes >= 2 && other !== word && other[0] === word[0] && Math.abs(other.length - word.length) <= 1 && editDistance(word, other) <= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([other]) => other);
      if (found.length) out.set(word, found);
    }
    return out;
  }

  /** Words of four letters or more in the person's voice notes (spoken words only), by how many notes hold each. */
  private spokenVocabulary(): Map<string, number> {
    if (this.spokenCache?.version === this.version) return this.spokenCache.words;
    const words = new Map<string, number>();
    for (const row of this.db.prepare("SELECT body FROM docs WHERE kind = 'log' AND meta = 'user voice'").all() as Array<{ body: string }>) {
      for (const word of new Set(normalize(spokenWords(row.body).split("\n").filter((line) => !/^(?:media type|source|source timestamp|extraction artifact|user context|raw artifact[^:]*):/i.test(line.trim())).join(" ")).split(" "))) {
        if (word.length >= 4) words.set(word, (words.get(word) ?? 0) + 1);
      }
    }
    this.spokenCache = { version: this.version, words };
    return words;
  }

  /** Of `paths`, the pages whose words or tree place hold at least half the topic (rarity-weighted). */
  private pagesMatching(terms: readonly string[], paths: readonly string[]): Set<string> {
    if (paths.length === 0) return new Set();
    const rows = this.db.prepare(`SELECT rowid, path FROM docs WHERE kind IN ('page', 'root') AND path IN (${paths.map(() => "?").join(", ")})`).all(...paths) as Array<{ rowid: number; path: string }>;
    const coverage = this.coverageOf(terms, rows.map((row) => row.rowid), "{title aliases lineage summary body}");
    return new Set(rows.filter((row) => (coverage.get(row.rowid) ?? 0) >= 0.5).map((row) => row.path));
  }

  /**
   * The pages a Log entry is tied to in the graph, strongest first: pages that cite it, pages its
   * filing receipt wrote, pages it links to, then those pages' tree parents. `unwritten` counts
   * the pages its filing planned but no page shows (filing stopped half way, S6/S8).
   */
  private connectionsOf(notePath: string): { pages: Array<{ path: string; relation: MemoryIndexRelation; weight: number }>; unwritten: number } {
    const graph = this.memoryGraph();
    const signals = new Map<string, Set<string>>();
    const add = (ref: string, kind: string) => {
      const path = graph.has(ref) ? ref : graph.resolve(ref);
      if (!path || path === TREE_PATH) return null;
      if (!signals.has(path)) signals.set(path, new Set());
      signals.get(path)!.add(kind);
      return path;
    };
    for (const edge of this.db.prepare("SELECT src FROM edges WHERE kind = 'cites' AND target = ?").all(notePath) as Array<{ src: string }>) add(edge.src, "cites");
    const planned: string[] = [];
    for (const edge of this.db.prepare("SELECT target, kind FROM edges WHERE src = ? AND kind IN ('filed', 'mentions', 'planned')").all(notePath) as Array<{ target: string; kind: string }>) {
      if (edge.kind === "planned") planned.push(edge.target);
      else add(edge.target, edge.kind);
    }
    const unwritten = planned.filter((target) => {
      const path = graph.has(target) ? target : graph.resolve(target);
      return !path || !signals.has(path);
    }).length;
    const pages = [...signals].map(([path, kinds]) => ({
      path,
      relation: (kinds.has("cites") || kinds.has("filed") ? "filed" : "linked") as MemoryIndexRelation,
      weight: connectionWeight(kinds, graph.depthOf(path)),
    }));
    // Each parent once, stronger when several of the note's pages hang off it.
    const parents = new Map<string, number>();
    for (const page of pages) {
      const parent = graph.parentOf(page.path);
      if (parent && parent !== TREE_PATH && !signals.has(parent)) parents.set(parent, (parents.get(parent) ?? 0) + 1);
    }
    const byStrength = (a: { path: string; weight: number }, b: { path: string; weight: number }) =>
      b.weight - a.weight || graph.depthOf(b.path) - graph.depthOf(a.path) || graph.titleOf(a.path).localeCompare(graph.titleOf(b.path)) || a.path.localeCompare(b.path);
    // A parent is a step further from the note: 0.6, +0.05 per further page of the note under it.
    const tied = [...parents].map(([path, children]) => ({ path, relation: "parent" as const, weight: Math.min(0.75, 0.6 + 0.05 * (children - 1)) }));
    return { pages: [...pages.sort(byStrength), ...tied.sort(byStrength)], unwritten };
  }

  /**
   * Percentages for memories a caller already has (E12-S3c): an answer's cited sources that the
   * ranked list did not reach, so every cited memory shows a number. A recent-note question uses
   * its own ranking; otherwise a memory's share of the question's words and its strength against
   * the best hit (matchPercent), at least 1. A Log file path without an anchor scores its best
   * entry. Paths that are not memories are left out.
   */
  async matchFor(query: string, paths: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (paths.length === 0) return out;
    await this.fresh();
    const intent = recentIntent(query, this.now());
    if (intent) {
      for (const hit of this.recentSearch(intent, MAX_HITS)) {
        for (const path of paths) if (!out.has(path) && (hit.path === path || hit.path.split("#")[0] === path)) out.set(path, hit.matchPercent);
      }
    }
    const rest = paths.filter((path) => !out.has(path));
    if (rest.length === 0) return out;
    const rows = this.db.prepare(`SELECT rowid, path, file FROM docs WHERE path IN (${rest.map(() => "?").join(", ")}) OR (kind = 'log' AND file IN (${rest.map(() => "?").join(", ")}))`)
      .all(...rest, ...rest) as Array<{ rowid: number; path: string; file: string }>;
    if (rows.length === 0) return out;
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups);
    const coverage = match ? this.coverageOf(terms, rows.map((row) => row.rowid)) : new Map<number, number>();
    const scores = new Map<number, number>();
    if (match) {
      const matched = this.db.prepare(`SELECT rowid, kind, meta, bm25(docs, ${BM25_WEIGHTS}) AS rank FROM docs WHERE docs MATCH ? AND rowid IN (${rows.map(() => "?").join(", ")})`)
        .all(match, ...rows.map((row) => row.rowid)) as Array<{ rowid: number; kind: MemoryIndexHitKind; meta: string; rank: number }>;
      for (const row of matched) scores.set(row.rowid, -row.rank * factorOf(row));
    }
    const topScore = Math.max(0, ...(await this.search(query, 1)).map((hit) => hit.score), ...scores.values());
    for (const path of rest) {
      const own = rows.filter((row) => row.path === path || row.file === path);
      if (own.length === 0) continue;
      const best = Math.max(...own.map((row) => matchPercent({
        score: scores.get(row.rowid) ?? 0, topScore, coverage: (coverage.get(row.rowid) ?? 0) * (generic ? 0.3 : 1),
      })));
      out.set(path, best);
    }
    return out;
  }

  /** How many of the person's voice notes are tied to a topic page (E12-S3c; the gap S8 closes). */
  async noteLinks(): Promise<MemoryNoteLinks> {
    await this.fresh();
    const notes = (this.db.prepare("SELECT path, file, rowid FROM docs WHERE kind = 'log' AND meta = 'user voice'").all() as Array<{ path: string; file: string; rowid: number }>)
      .sort((a, b) => b.file.localeCompare(a.file) || b.rowid - a.rowid);
    let unlinked = 0;
    let partial = 0;
    const unlinkedPaths: string[] = [];
    for (const note of notes) {
      const links = this.connectionsOf(note.path);
      if (links.pages.length === 0) {
        unlinked++;
        if (unlinkedPaths.length < 20) unlinkedPaths.push(note.path);
      } else if (links.unwritten > 0) partial++;
    }
    return { voiceNotes: notes.length, unlinked, partial, unlinkedPaths };
  }

  /**
   * The memory graph (E12-S2): `center` (a path or link target) with its neighbourhood, or the
   * overview when omitted; null when `center` is not a memory. Built from stored rows, cached
   * until the next sync changes something, so a view of a large vault costs milliseconds.
   */
  async graph(options: { center?: string | null; limit?: number } = {}): Promise<MemoryGraphView | null> {
    await this.fresh();
    const graph = this.memoryGraph();
    const limit = options.limit ?? MEMORY_GRAPH_DEFAULT_LIMIT;
    return options.center ? graph.neighbourhood(options.center, limit) : graph.overview(limit);
  }

  private memoryGraph(): MemoryGraph {
    if (this.graphCache?.version === this.version) return this.graphCache.graph;
    const pages = this.db.prepare("SELECT path, title, summary, lineage AS treePath FROM docs WHERE kind = 'page'").all() as Array<{ path: string; title: string; summary: string; treePath: string }>;
    const edges = this.db.prepare("SELECT src AS \"from\", target, kind FROM edges WHERE kind IN ('link', 'tree') ORDER BY rowid").all() as unknown as MemoryGraphRawEdge[];
    const hasTree = Boolean(this.db.prepare("SELECT 1 FROM files WHERE path = ?").get(TREE_PATH));
    const graph = MemoryGraph.build(pages, edges, { hasTree });
    this.graphCache = { version: this.version, graph };
    return graph;
  }

  private async fresh(): Promise<void> {
    if (this.dirty || this.now() - this.lastCheck > STALE_AFTER_MS) await this.refresh();
  }

  /** Rarity-weighted share (0..1) of the query's words each row contains, by the same FTS5 matching as the search. */
  private coverageOf(terms: readonly string[], rowids: readonly number[], columns = "{title aliases summary body}"): Map<number, number> {
    const out = new Map<number, number>(rowids.map((rowid) => [rowid, 0]));
    if (terms.length === 0 || rowids.length === 0) return out;
    const total = (this.db.prepare("SELECT count(*) AS n FROM docs").get() as { n: number }).n;
    const countOf = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
    // Content columns only: the tree path (lineage) is for finding, not for what a memory says.
    const among = this.db.prepare(`SELECT rowid FROM docs WHERE docs MATCH ? AND rowid IN (${rowids.map(() => "?").join(", ")})`);
    let weightSum = 0;
    for (const term of terms) {
      const scoped = `${columns} : ${term}`;
      const df = (countOf.get(scoped) as { n: number }).n;
      const weight = idfOf(total, df);
      weightSum += weight;
      for (const row of among.all(scoped, ...rowids) as Array<{ rowid: number }>) out.set(row.rowid, out.get(row.rowid)! + weight);
    }
    if (weightSum > 0) for (const [rowid, sum] of out) out.set(rowid, sum / weightSum);
    return out;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = (this.inflight ?? Promise.resolve()).catch(() => {}).then(fn);
    this.inflight = next;
    return next;
  }

  private async sync(full: boolean): Promise<{ changed: number; removed: number }> {
    const { vaultPath } = this.options;
    const files = (await listMarkdownFiles(vaultPath)).filter(indexable);
    const known = new Map((this.db.prepare("SELECT path, mtime_ms, size FROM files").all() as Array<{ path: string; mtime_ms: number; size: number }>)
      .map((row) => [row.path, row]));
    const changed: Array<{ path: string; mtimeMs: number; size: number }> = [];
    const infos = await Promise.all(files.map((path) => stat(join(vaultPath, path)).catch(() => null)));
    files.forEach((path, i) => {
      const info = infos[i];
      if (!info) return;
      const prior = known.get(path);
      if (full || !prior || prior.mtime_ms !== info.mtimeMs || prior.size !== info.size) changed.push({ path, mtimeMs: info.mtimeMs, size: info.size });
    });
    const present = new Set(files);
    const removed = full ? [...known.keys()] : [...known.keys()].filter((path) => !present.has(path));
    this.lastCheck = this.now();
    this.dirty = false;
    if (!full && changed.length === 0 && removed.length === 0) return { changed: 0, removed: 0 };

    const parsed = await Promise.all(changed.map(async (file) => ({ ...file, ...(await rowsOf(vaultPath, file.path)) })));
    // Lineage depends on other pages' parents, so any change re-derives it for every row.
    const lineage = await lineageResolver(vaultPath);

    const insert = this.db.prepare("INSERT INTO docs (title, aliases, lineage, summary, body, kind, path, file, filed, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const upsertFile = this.db.prepare("INSERT INTO files (path, mtime_ms, size) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size");
    const deleteRows = this.db.prepare("DELETE FROM docs WHERE file = ?");
    const deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
    const insertEdge = this.db.prepare("INSERT INTO edges (file, src, kind, target) VALUES (?, ?, ?, ?)");
    const deleteEdges = this.db.prepare("DELETE FROM edges WHERE file = ?");
    const resolved = await Promise.all(parsed.map(async (file) => ({
      ...file,
      rows: await Promise.all(file.rows.map(async (row) => ({ ...row, ...(await lineage(row)) }))),
    })));
    const stale = full ? [] : await this.relineage(lineage, new Set(changed.map((file) => file.path)));

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (full) this.db.exec("DELETE FROM docs; DELETE FROM files; DELETE FROM edges;");
      for (const path of removed) { deleteRows.run(path); deleteEdges.run(path); deleteFile.run(path); }
      for (const file of resolved) {
        deleteRows.run(file.path);
        deleteEdges.run(file.path);
        for (const row of file.rows) insert.run(row.title, row.aliases, row.lineage, row.summary, row.body, row.kind, row.path, row.file, row.filed, row.meta);
        for (const edge of file.edges) insertEdge.run(file.path, edge.from, edge.kind, edge.target);
        upsertFile.run(file.path, file.mtimeMs, file.size);
      }
      const update = this.db.prepare("UPDATE docs SET lineage = ?, filed = ? WHERE rowid = ?");
      for (const row of stale) update.run(row.lineage, row.filed, row.rowid);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.version++;
    return { changed: changed.length, removed: removed.length };
  }

  /** Rows outside the changed files whose lineage moved (a parent renamed, a page re-parented). */
  private async relineage(lineage: LineageResolver, skip: Set<string>): Promise<Array<{ rowid: number; lineage: string; filed: string }>> {
    const rows = this.db.prepare("SELECT rowid, kind, path, file, lineage, filed FROM docs").all() as Array<{ rowid: number; kind: MemoryIndexHitKind; path: string; file: string; lineage: string; filed: string }>;
    const out: Array<{ rowid: number; lineage: string; filed: string }> = [];
    for (const row of rows) {
      if (skip.has(row.file)) continue;
      const next = await lineage(row);
      if (next.lineage !== row.lineage || next.filed !== row.filed) out.push({ rowid: row.rowid, ...next });
    }
    return out;
  }
}

function indexable(path: string): boolean {
  if (path === TREE_PATH || LOG_FILE_RE.test(path) || isFilingReceiptPath(path)) return true;
  return tierOf(path) === "meaning" && !isIndexFile(path);
}

type RowDraft = Omit<Row, "lineage" | "filed">;
type LineageResolver = (row: Pick<Row, "kind" | "path">) => Promise<{ lineage: string; filed: string }>;

/** Tree path text for a row: the page's own lineage, or (Log) the deepest placed page citing it. */
async function lineageResolver(vaultPath: string): Promise<LineageResolver> {
  const tree = await loadMemoryTree(vaultPath).catch(() => null);
  const cache = new Map<string, string>();
  const pathOf = async (page: string) => {
    if (!cache.has(page)) {
      const found = tree ? await tree.lineageOf(page).catch(() => null) : null;
      cache.set(page, found ? formatMemoryLineage({ ...found, evidence: [] }) : "");
    }
    return cache.get(page)!;
  };
  return async (row) => {
    if (!tree) return { lineage: "", filed: "" };
    if (row.kind === "log") {
      const filed = (await tree.placedCitersOf(row.path).catch(() => []))[0] ?? "";
      return { lineage: filed ? await pathOf(filed) : "", filed };
    }
    return { lineage: await pathOf(row.path), filed: "" };
  };
}

/**
 * Stored edges: the graph's own (`link`, `tree`, MemoryGraphRawEdge) and the ones that tie a Log
 * entry to its topics (E12-S3c): `cites` page → entry (the page quotes it), `filed` / `planned`
 * entry → page (its filing receipt wrote, or only planned, that page), `mentions` entry → page.
 */
type StoredEdge = { from: string; target: string; kind: MemoryGraphRawEdge["kind"] | "cites" | "filed" | "planned" | "mentions" };

/** The note → page edges of a filing receipt (`Inbox/filing-<date>-e-xxxxxx.md`); none when it does not parse. */
function receiptEdges(raw: string): StoredEdge[] {
  const body = /\n```json\n([\s\S]*)\n```\n?$/.exec(raw)?.[1];
  if (!body) return [];
  try {
    const value = JSON.parse(body) as {
      evidenceRef?: unknown;
      outcomes?: Array<{ filedPages?: unknown; uncertainPages?: unknown; pages?: unknown }>;
      classification?: { topics?: Array<{ pages?: Array<{ path?: unknown } | string> }> };
    };
    if (typeof value.evidenceRef !== "string") return [];
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
    const filed = new Set<string>();
    const planned = new Set<string>();
    for (const outcome of value.outcomes ?? []) {
      for (const page of [...strings(outcome.filedPages), ...strings(outcome.uncertainPages)]) filed.add(page);
      for (const page of strings(outcome.pages)) planned.add(page);
    }
    for (const topic of value.classification?.topics ?? []) {
      for (const page of topic.pages ?? []) {
        const path = typeof page === "string" ? page : typeof page?.path === "string" ? page.path : null;
        if (path) planned.add(path);
      }
    }
    const from = value.evidenceRef;
    return [
      ...[...filed].map((target) => ({ from, target, kind: "filed" as const })),
      ...[...planned].filter((page) => !filed.has(page)).map((target) => ({ from, target, kind: "planned" as const })),
    ];
  } catch {
    return [];
  }
}

/** A file's index rows and its graph edges (links and tree parent, targets as written). */
async function rowsOf(vaultPath: string, path: string): Promise<{ rows: RowDraft[]; edges: StoredEdge[] }> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
  if (raw === null) return { rows: [], edges: [] };
  if (isFilingReceiptPath(path)) return { rows: [], edges: receiptEdges(raw) };
  if (path === TREE_PATH) {
    // Root rows: RAPTOR's collapsed tree, every level in one pool. The hit points at the root's page.
    // The group heading ("Long-term memory") is in the lineage, not the body: a root must not match
    // a question only by being a root (E12-S3c).
    const nodes = parseTree(raw).nodes;
    return {
      rows: nodes.map((node) => ({
        title: node.name, aliases: "", summary: node.summary, body: "", kind: "root", path: node.path, file: path, meta: "",
      })),
      edges: nodes.map((node) => ({ from: TREE_PATH, target: node.path, kind: "tree" })),
    };
  }
  const log = LOG_FILE_RE.exec(path);
  if (log) {
    const entries = parseLogCaptures(log[1]!, raw);
    return {
      rows: entries.map((entry) => ({
        title: entry.title, aliases: "", summary: [log[1], entry.source].filter(Boolean).join(" "), body: entry.content,
        kind: "log", path: `${path}#^${entry.anchor}`, file: path,
        meta: `${entry.origin}${isVoiceCapture(entry.contentType, entry.title, entry.content) ? " voice" : ""}`,
      })),
      edges: entries.flatMap((entry) => extractPageLinks(entry.content).map((target) => ({ from: `${path}#^${entry.anchor}`, target, kind: "mentions" as const }))),
    };
  }
  const { frontmatter, body } = parseNote(raw);
  const meta = frontmatter ?? {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const title = typeof meta.title === "string" && meta.title.trim() ? meta.title : body.match(/^# +([^\n]+)/m)?.[1]?.trim() || basenameOf(path);
  const parent = pageTreeFields(frontmatter).parent;
  const edges: StoredEdge[] = [
    ...(parent ? [{ from: path, target: parent, kind: "tree" as const }] : []),
    ...extractPageLinks(body).map((target) => ({ from: path, target, kind: "link" as const })),
    ...[...new Set(extractCitations(body).map((cite) => `Log/${cite.date}.md#^${cite.anchor}`))].map((target) => ({ from: path, target, kind: "cites" as const })),
  ];
  return { edges, rows: [{
    title,
    // Obsidian's own `aliases:` (a list or one string) and tags: the page's metadata, not steering.
    aliases: [...(typeof meta.aliases === "string" ? [meta.aliases] : strings(meta.aliases)), ...strings(meta.tags)].join(" · "),
    summary: [typeof meta.summary === "string" ? meta.summary : "", typeof meta.description === "string" ? meta.description : ""].filter(Boolean).join(" "),
    body,
    kind: "page", path, file: path, meta: "",
  }] };
}
