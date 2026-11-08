import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseLogCaptures } from "./captureOrigin.js";
import { basenameOf, isIndexFile, listMarkdownFiles, tierOf } from "./files.js";
import { parseNote } from "./frontmatter.js";
import { idfOf, matchPercent, monotonic } from "./matchPercent.js";
import { formatMemoryLineage, loadMemoryTree } from "./lineage.js";
import { pageTreeFields, parseTree, TREE_PATH, GROUP_HEADINGS } from "./tree.js";
import { extractPageLinks } from "./pages.js";
import { MemoryGraph, MEMORY_GRAPH_DEFAULT_LIMIT, type MemoryGraphRawEdge, type MemoryGraphView } from "./memoryGraph.js";

/**
 * Tier-0 memory index (EPIC-9 E9-5a): one SQLite FTS5 file per tenant, derived from the
 * vault and stored beside it (never committed into it). BM25 over pages, Log entries and
 * Tree.md roots, each row carrying its tree lineage, so "where did I say…" answers in
 * milliseconds for $0, the same way every time. Rebuildable from the vault at any time.
 */

/** 2: the `edges` table (E12-S2 memory graph); an older file is rebuilt once on open. */
const SCHEMA_VERSION = "2";
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
export function buildMatchTerms(query: string, aliasGroups: readonly (readonly string[])[]): { match: string | null; terms: string[]; generic: boolean } {
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
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
        title, aliases, lineage, summary, body,
        kind UNINDEXED, path UNINDEXED, file UNINDEXED, filed UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2"
      );
    `);
    const meta = new Map((this.db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
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
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups);
    if (!match) return [];
    const rows = this.db.prepare(`
      SELECT rowid, kind, path, title, filed, lineage, bm25(docs, ${BM25_WEIGHTS}) AS rank
      FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?
    `).all(match, Math.max(40, limit * 8)) as Array<{ rowid: number; kind: MemoryIndexHitKind; path: string; title: string; filed: string; lineage: string; rank: number }>;
    const picked: typeof rows = [];
    const seen = new Set<string>();
    const scored = rows.map((row) => ({ ...row, rank: row.rank * KIND_FACTOR[row.kind] })).sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
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
    const kept = best > 0 ? picked.filter((row) => (coverage.get(row.rowid) ?? 0) >= best * 0.25) : picked;
    kept.splice(limit);
    const topScore = -kept[0]!.rank;

    // FTS5 snippet() re-tokenizes whole bodies and was most of a query's time: a plain
    // window around the first matched word does the same job for the returned rows only.
    const texts = new Map((this.db.prepare(`SELECT rowid, summary, body FROM docs WHERE rowid IN (${kept.map(() => "?").join(", ")})`)
      .all(...kept.map((row) => row.rowid)) as Array<{ rowid: number; summary: string; body: string }>).map((row) => [row.rowid, row]));
    // A question made only of generic words ("how does my memory work") matches on nothing in
    // particular: whatever it finds reads weak.
    const percents = monotonic(kept.map((row) => matchPercent({ score: -row.rank, topScore, coverage: (coverage.get(row.rowid) ?? 0) * (generic ? 0.3 : 1) })));
    return kept.map((row, i) => ({
      path: row.path, kind: row.kind, title: row.title, snippet: snippetOf(texts.get(row.rowid), words),
      score: Math.round(-row.rank * 100) / 100,
      matchPercent: percents[i]!,
      treePath: row.lineage,
      ...(row.filed ? { filedOn: row.filed } : {}),
    }));
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
    const edges = this.db.prepare("SELECT src AS \"from\", target, kind FROM edges ORDER BY rowid").all() as unknown as MemoryGraphRawEdge[];
    const hasTree = Boolean(this.db.prepare("SELECT 1 FROM files WHERE path = ?").get(TREE_PATH));
    const graph = MemoryGraph.build(pages, edges, { hasTree });
    this.graphCache = { version: this.version, graph };
    return graph;
  }

  private async fresh(): Promise<void> {
    if (this.dirty || this.now() - this.lastCheck > STALE_AFTER_MS) await this.refresh();
  }

  /** Rarity-weighted share (0..1) of the query's words each row contains, by the same FTS5 matching as the search. */
  private coverageOf(terms: readonly string[], rowids: readonly number[]): Map<number, number> {
    const out = new Map<number, number>(rowids.map((rowid) => [rowid, 0]));
    if (terms.length === 0 || rowids.length === 0) return out;
    const total = (this.db.prepare("SELECT count(*) AS n FROM docs").get() as { n: number }).n;
    const countOf = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
    // Content columns only: the tree path (lineage) is for finding, not for what a memory says.
    const among = this.db.prepare(`SELECT rowid FROM docs WHERE docs MATCH ? AND rowid IN (${rowids.map(() => "?").join(", ")})`);
    let weightSum = 0;
    for (const term of terms) {
      const scoped = `{title aliases summary body} : ${term}`;
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

    const insert = this.db.prepare("INSERT INTO docs (title, aliases, lineage, summary, body, kind, path, file, filed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
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
        for (const row of file.rows) insert.run(row.title, row.aliases, row.lineage, row.summary, row.body, row.kind, row.path, row.file, row.filed);
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
  if (path === TREE_PATH || LOG_FILE_RE.test(path)) return true;
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

/** A file's index rows and its graph edges (links and tree parent, targets as written). */
async function rowsOf(vaultPath: string, path: string): Promise<{ rows: RowDraft[]; edges: MemoryGraphRawEdge[] }> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
  if (raw === null) return { rows: [], edges: [] };
  if (path === TREE_PATH) {
    // Root rows: RAPTOR's collapsed tree, every level in one pool. The hit points at the root's page.
    const nodes = parseTree(raw).nodes;
    return {
      rows: nodes.map((node) => ({
        title: node.name, aliases: "", summary: node.summary, body: GROUP_HEADINGS[node.kind], kind: "root", path: node.path, file: path,
      })),
      edges: nodes.map((node) => ({ from: TREE_PATH, target: node.path, kind: "tree" })),
    };
  }
  const log = LOG_FILE_RE.exec(path);
  if (log) {
    return {
      rows: parseLogCaptures(log[1]!, raw).map((entry) => ({
        title: entry.title, aliases: "", summary: [log[1], entry.source].filter(Boolean).join(" "), body: entry.content,
        kind: "log", path: `${path}#^${entry.anchor}`, file: path,
      })),
      edges: [],
    };
  }
  const { frontmatter, body } = parseNote(raw);
  const meta = frontmatter ?? {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const title = typeof meta.title === "string" && meta.title.trim() ? meta.title : body.match(/^# +([^\n]+)/m)?.[1]?.trim() || basenameOf(path);
  const parent = pageTreeFields(frontmatter).parent;
  const edges: MemoryGraphRawEdge[] = [
    ...(parent ? [{ from: path, target: parent, kind: "tree" as const }] : []),
    ...extractPageLinks(body).map((target) => ({ from: path, target, kind: "link" as const })),
  ];
  return { edges, rows: [{
    title,
    // Obsidian's own `aliases:` (a list or one string) and tags: the page's metadata, not steering.
    aliases: [...(typeof meta.aliases === "string" ? [meta.aliases] : strings(meta.aliases)), ...strings(meta.tags)].join(" · "),
    summary: [typeof meta.summary === "string" ? meta.summary : "", typeof meta.description === "string" ? meta.description : ""].filter(Boolean).join(" "),
    body,
    kind: "page", path, file: path,
  }] };
}
