import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseLogCaptures } from "./captureOrigin.js";
import { basenameOf, isIndexFile, listMarkdownFiles, tierOf } from "./files.js";
import { parseNote } from "./frontmatter.js";
import { formatMemoryLineage, loadMemoryTree } from "./lineage.js";
import { parseTree, TREE_PATH, GROUP_HEADINGS } from "./tree.js";
import { keeperAliasGroups, parseKeeperNotes } from "./treeSteering.js";

/**
 * Tier-0 memory index (EPIC-9 E9-5a): one SQLite FTS5 file per tenant, derived from the
 * vault and stored beside it (never committed into it). BM25 over pages, Log entries and
 * Tree.md roots, each row carrying its tree lineage, so "where did I say…" answers in
 * milliseconds for $0, the same way every time. Rebuildable from the vault at any time.
 */

const SCHEMA_VERSION = "1";
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
 * Built-in alias groups: any member in a query also searches the others. Keeper notes in
 * Tree.md add tenant aliases (E9-5b); this list only seeds names that recur across vaults.
 */
export const BUILT_IN_ALIASES: readonly (readonly string[])[] = [
  ["agentine", "agent team", "agent_team"],
];

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
  /** Extra alias groups on top of the built-ins and Tree.md Keeper notes. */
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

/**
 * Alias groups from Tree.md `## Keeper notes`: E9-5b notes (`- K-1 | Agent Team | aliases: agentine, agent_team | …`,
 * treeSteering.ts) plus the bare `- alias: A = B = C` form.
 */
export function keeperAliases(treeRaw: string): string[][] {
  const groups: string[][] = keeperAliasGroups(parseKeeperNotes(treeRaw).notes);
  let inNotes = false;
  for (const line of treeRaw.split("\n")) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) { inNotes = heading[1]!.toLowerCase() === "keeper notes"; continue; }
    if (!inNotes) continue;
    const alias = /^\s*[-*]\s*alias(?:es)?:\s*(.+)$/i.exec(line);
    if (!alias) continue;
    const names = alias[1]!.split(/\s*(?:=|↔|,)\s*/).map((name) => name.trim()).filter(Boolean);
    if (names.length >= 2) groups.push(names);
  }
  return groups;
}

/** FTS5 MATCH expression: content words OR'd (prefix for longer words), plus alias phrases. */
export function buildMatch(query: string, aliasGroups: readonly (readonly string[])[]): string | null {
  const normalized = normalize(query);
  const words = normalized.split(" ").filter(Boolean);
  let terms = [...new Set(words.filter((word) => !STOP_WORDS.has(word) && word.length >= 2))];
  if (terms.length === 0) terms = [...new Set(words)];
  const clauses = new Set<string>();
  for (const term of terms) {
    // Light, language-neutral stemming: "visits"/"quotes" → visit*/quote*. No Porter (English-only).
    const stem = term.length >= 5 && term.endsWith("s") ? term.slice(0, -1) : term;
    clauses.add(stem.length >= 4 ? `${quote(stem)}*` : quote(stem));
  }
  const padded = ` ${normalized} `;
  for (const group of aliasGroups) {
    const members = group.map(normalize).filter(Boolean);
    if (!members.some((member) => padded.includes(` ${member} `))) continue;
    for (const member of members) if (!terms.includes(member)) clauses.add(quote(member));
  }
  return clauses.size ? [...clauses].join(" OR ") : null;
}

export class MemoryIndex {
  private readonly db: DatabaseSync;
  private dirty = true;
  private lastCheck = Number.NEGATIVE_INFINITY;
  private inflight: Promise<unknown> | null = null;
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
      this.db.exec("DELETE FROM docs; DELETE FROM files;");
    }
    setMeta.run("tenant", this.tenantId);
    setMeta.run("schema", SCHEMA_VERSION);
    setMeta.run("vault", options.vaultPath);
    this.aliasGroups = [...BUILT_IN_ALIASES, ...(options.aliases ?? [])];
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
    if (this.dirty || this.now() - this.lastCheck > STALE_AFTER_MS) await this.refresh();
    const match = buildMatch(query, this.aliasGroups);
    if (!match) return [];
    const rows = this.db.prepare(`
      SELECT kind, path, title, filed, lineage, bm25(docs, ${BM25_WEIGHTS}) AS rank,
             snippet(docs, -1, '', '', '…', 24) AS snippet
      FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?
    `).all(match, limit * 3) as Array<{ kind: MemoryIndexHitKind; path: string; title: string; filed: string; lineage: string; rank: number; snippet: string }>;
    const out: MemoryIndexHit[] = [];
    const seen = new Set<string>();
    const scored = rows.map((row) => ({ ...row, rank: row.rank * KIND_FACTOR[row.kind] })).sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
    for (const row of scored) {
      if (seen.has(row.path)) continue; // a root row and its page share a path: keep the best
      seen.add(row.path);
      out.push({
        path: row.path, kind: row.kind, title: row.title, snippet: row.snippet.replace(/\s+/g, " ").trim(),
        score: Math.round(-row.rank * 100) / 100, treePath: row.lineage,
        ...(row.filed ? { filedOn: row.filed } : {}),
      });
      if (out.length >= limit) break;
    }
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
    for (const path of files) {
      const info = await stat(join(vaultPath, path)).catch(() => null);
      if (!info) continue;
      const prior = known.get(path);
      if (full || !prior || prior.mtime_ms !== info.mtimeMs || prior.size !== info.size) changed.push({ path, mtimeMs: info.mtimeMs, size: info.size });
    }
    const present = new Set(files);
    const removed = full ? [...known.keys()] : [...known.keys()].filter((path) => !present.has(path));
    this.lastCheck = this.now();
    this.dirty = false;
    if (!full && changed.length === 0 && removed.length === 0) return { changed: 0, removed: 0 };

    const parsed = await Promise.all(changed.map(async (file) => ({ ...file, rows: await rowsOf(vaultPath, file.path) })));
    // Lineage depends on other pages' parents, so any change re-derives it for every row.
    const lineage = await lineageResolver(vaultPath);
    const treeRaw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => "");
    this.aliasGroups = [...BUILT_IN_ALIASES, ...(this.options.aliases ?? []), ...keeperAliases(treeRaw)];

    const insert = this.db.prepare("INSERT INTO docs (title, aliases, lineage, summary, body, kind, path, file, filed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const upsertFile = this.db.prepare("INSERT INTO files (path, mtime_ms, size) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size");
    const deleteRows = this.db.prepare("DELETE FROM docs WHERE file = ?");
    const deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
    const resolved = await Promise.all(parsed.map(async (file) => ({
      ...file,
      rows: await Promise.all(file.rows.map(async (row) => ({ ...row, ...(await lineage(row)) }))),
    })));
    const stale = full ? [] : await this.relineage(lineage, new Set(changed.map((file) => file.path)));

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (full) this.db.exec("DELETE FROM docs; DELETE FROM files;");
      for (const path of removed) { deleteRows.run(path); deleteFile.run(path); }
      for (const file of resolved) {
        deleteRows.run(file.path);
        for (const row of file.rows) insert.run(row.title, row.aliases, row.lineage, row.summary, row.body, row.kind, row.path, row.file, row.filed);
        upsertFile.run(file.path, file.mtimeMs, file.size);
      }
      const update = this.db.prepare("UPDATE docs SET lineage = ?, filed = ? WHERE rowid = ?");
      for (const row of stale) update.run(row.lineage, row.filed, row.rowid);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

async function rowsOf(vaultPath: string, path: string): Promise<RowDraft[]> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
  if (raw === null) return [];
  if (path === TREE_PATH) {
    // Root rows: RAPTOR's collapsed tree, every level in one pool. The hit points at the root's page.
    return parseTree(raw).nodes.map((node) => ({
      title: node.name, aliases: "", summary: node.summary, body: GROUP_HEADINGS[node.kind], kind: "root", path: node.path, file: path,
    }));
  }
  const log = LOG_FILE_RE.exec(path);
  if (log) {
    return parseLogCaptures(log[1]!, raw).map((entry) => ({
      title: entry.title, aliases: "", summary: [log[1], entry.source].filter(Boolean).join(" "), body: entry.content,
      kind: "log", path: `${path}#^${entry.anchor}`, file: path,
    }));
  }
  const { frontmatter, body } = parseNote(raw);
  const meta = frontmatter ?? {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const title = typeof meta.title === "string" && meta.title.trim() ? meta.title : body.match(/^# +([^\n]+)/m)?.[1]?.trim() || basenameOf(path);
  return [{
    title,
    aliases: [...strings(meta.aliases), ...strings(meta.tags)].join(" · "),
    summary: [typeof meta.summary === "string" ? meta.summary : "", typeof meta.description === "string" ? meta.description : ""].filter(Boolean).join(" "),
    body,
    kind: "page", path, file: path,
  }];
}
