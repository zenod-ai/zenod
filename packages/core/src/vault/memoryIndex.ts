import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseLogCaptures } from "./captureOrigin.js";
import { basenameOf, isFilingReceiptPath, isIndexFile, listMarkdownFiles, tierOf } from "./files.js";
import { parseNote } from "./frontmatter.js";
import { recordedPrivacy, type PrivateKind } from "./privacy.js";
import { idfOf, matchPercent, monotonic } from "./matchPercent.js";
import { formatMemoryLineage, loadMemoryTree } from "./lineage.js";
import { pageTreeFields, parseTree, TREE_PATH } from "./tree.js";
import { extractCitations, extractPageLinks } from "./pages.js";
import { isVoiceCapture, recentIntent, type RecentIntent } from "./recentIntent.js";
import { MemoryGraph, MEMORY_GRAPH_DEFAULT_LIMIT, type MemoryGraphNote, type MemoryGraphRawEdge, type MemoryGraphView } from "./memoryGraph.js";
import { buildWeightedLinks, CLOUD_DEFAULT_THRESHOLD, expandCloud, isNote, nodeIdOf, type CloudNode, type NodeTie } from "./memoryWeights.js";

/**
 * Tier-0 memory index (EPIC-9 E9-5a): one SQLite FTS5 file per tenant, derived from the
 * vault and stored beside it (never committed into it). BM25 over pages, Log entries and
 * Tree.md roots, each row carrying its tree lineage, so "where did I say…" answers in
 * milliseconds for $0, the same way every time. Rebuildable from the vault at any time.
 */

/**
 * 2: the `edges` table (E12-S2 memory graph). 3: Log entries carry who sent them and whether
 * they are voice notes (`meta`), and the edges that tie a note to its topics: page citations
 * and filing receipts (E12-S3c). 4: weighted memory graph (E18-W1): a filing's confidence on its
 * `filed` edges, each page's `zid`, and the derived `nodes` and `links` (strength 0..1) tables.
 * 5: pages under `Archive/Agent reports/` are marked `agent` and page bodies leave out their
 * `## Ops rollup` lines (E12-S15). 7: a private page's `meta` is `private:<kind>` (E15-S2). An older
 * file is rebuilt once on open.
 */
const SCHEMA_VERSION = "7";
const MAX_HITS = 20;
/** Column weights for bm25(): title, aliases, lineage, summary, body (E9-4 §6). */
const BM25_WEIGHTS = "10.0, 10.0, 5.0, 3.0, 1.0";
const LOG_FILE_RE = /^Log\/(\d{4}-\d{2}-\d{2})\.md$/;
const LOG_ENTRY_DATE_RE = /^Log\/(\d{4}-\d{2}-\d{2})\.md#/;
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
/**
 * The `## Ops rollup` section's own lines: its intro and the dated `- <date> ops (<n>): [[…]]`
 * links to agent reports (E9-2b rule 5). Only these leave a page's indexed body: topic filing
 * appended some of the person's own lines after that section, and those stay (E12-S15).
 */
const ROLLUP_LINE_RE = /^(?:- \d{4}-\d{2}-\d{2} ops \(\d+\): .*|Agent ops reports \(Watcher reads, console decisions\), one line per day; the evidence stays in the Log\.)$/gm;
/** Where moved agent report lines are kept (E12-S14): content, not the person's memories. */
const AGENT_REPORTS_DIR = "Archive/Agent reports/";
/**
 * A question about the agents' own work: agents, reports, tickets, deploys, epic or row codes
 * (`EPIC-12`, `E12-S15`), run ids. Only then do agent reports rank among the answers (E12-S15);
 * otherwise they are not the person's memories and stay out of the list.
 */
const AGENT_QUESTION_RE = /\b(?:agents?|agent_team|reports?|tickets?|deploy(?:s|ed|ment)?|console|watcher|delivery manager|agentes?|informes?|reportes?)\b|\bEPIC-\d|\b[A-Z]\d{1,3}-[A-Z]{0,3}\d|\brun_[0-9a-f]{6,}/i;
export function asksAboutAgentWork(query: string): boolean {
  return AGENT_QUESTION_RE.test(query);
}

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
  // How a question is put, not what it is about (E12-S19): "did I ever mention…", "what was that thing
  // about…", "what did I ask for…", "the tweet saying…", "from my laptop or somewhere else?".
  "ever", "once", "mention", "mentioned", "talk", "talked", "talking", "told", "says", "saying", "ask", "asked", "asking",
  "wanted", "thought", "stuff", "kind", "sort", "maybe", "else", "more", "they", "anymore",
  // A place or person left open, not a subject (E12-S35): "from my laptop or somewhere else?" is about the
  // laptop, and "somewhere" alone pulled in his pages about places to live.
  "somewhere", "anywhere", "everywhere", "nowhere", "elsewhere", "someone", "anyone", "everyone", "somebody", "anybody",
  "everybody", "nothing", "algo", "alguien", "nada", "nadie", "otro", "otra", "otros", "otras",
]);

/**
 * The same word in the person's other language (E12-S19): Jordi speaks English and Spanish, and asks
 * in English about a note he spoke in Spanish ("the tweet saying businesses have no moats" is a
 * Spanish voice note about "negocios" and "fosos"). A small fixed list, each an OR alternative of the
 * question word; no model, no translation service.
 */
const OTHER_LANGUAGE: ReadonlyArray<readonly string[]> = [
  ["business", "businesses", "negocio", "negocios", "empresa", "empresas"],
  ["moat", "moats", "foso", "fosos"],
  ["company", "companies", "empresa", "empresas", "sociedad"],
  ["accounting", "accountant", "contabilidad", "contable", "gestor", "gestoria"],
  ["partner", "partners", "socio", "socios"],
  ["house", "houses", "casa", "casas", "vivienda"],
  ["apartment", "apartments", "piso", "pisos", "apartamento", "apartamentos"],
  ["price", "prices", "precio", "precios"],
  ["rent", "renting", "alquiler", "alquilar"],
  ["money", "dinero"],
  ["decision", "decide", "decided", "decidir", "decidido"],
  ["family", "familia"],
  ["friend", "friends", "amigo", "amigos", "amiga", "amigas"],
  ["health", "salud"],
  ["doctor", "medico"],
  ["tax", "taxes", "impuesto", "impuestos", "hacienda"],
  ["bank", "banco"],
  ["school", "colegio", "escuela"],
  ["travel", "viaje", "viajar"],
    ["defense", "defence", "defensa"],
  ["copy", "copied", "copiar", "copia"],
];
/** A passage the asked-note pick reads: about this many words, overlapping by half (E12-S19). */
const PASSAGE_WORDS = 90;
/**
 * A person's note with one passage holding at least this share of the question (rarity-weighted)
 * is the note the question asks about, and joins the top of the ranked list (E12-S19).
 */
export const ASKED_NOTE_LIFT = 0.7;

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
  /**
   * Path retrieval in the ranked list (E18-W1): a clear best page brings in the memories its strong
   * paths reach (multiplied strength at or above `threshold`), at most `joins` of them.
   */
  cloud?: { threshold?: number; joins?: number };
  /**
   * Re-read the vault in the background as soon as it is marked dirty, and rebuild the derived
   * caches, so the next search does not pay for the filing that changed it (E24-M7).
   */
  eagerRefresh?: boolean;
}

/** Commits of one filing land within moments of each other: one background refresh covers them. */
const EAGER_REFRESH_DELAY_MS = 250;

export const CLOUD_DEFAULT_JOINS = 4;
/** The best word matches the ranked list's paths start from, and the least a seed must match (E18-W1). */
const CLOUD_SEEDS = 3;
const CLOUD_SEED_FLOOR = 60;

export interface MemoryCloudRequest {
  /** A question: the cloud grows from its best matches. */
  query?: string;
  /** Or one memory (a page path, link target or Log evidence reference). */
  center?: string;
  /** 0..1, default 0.8: keep a memory while its path's multiplied strength stays at or above it. */
  threshold?: number;
  /** At most this many memories, seeds included (default 12, max 60). */
  maxNodes?: number;
}

export interface MemoryCloudNode {
  /** The node id kept in the Markdown: a page's `zid` (or its derived id), a Log entry's block id. */
  id: string;
  path: string;
  title: string;
  kind: "page" | "log";
  /** Multiplied strength from the seed (0..1). */
  strength: number;
  hops: number;
  seed: string;
  via: string | null;
  /** The path walked, seed first. */
  trail: string[];
}

export interface MemoryCloud {
  threshold: number;
  seeds: Array<{ path: string; strength: number }>;
  nodes: MemoryCloudNode[];
  /** Links between the cloud's nodes, with their strength and why they exist. */
  links: Array<{ from: string; to: string; strength: number; reasons: string }>;
  total: { nodes: number; links: number };
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
  /** For a memory reached along the graph (E18-W1): its path's multiplied strength from the best hit (0..1). */
  pathStrength?: number;
  /**
   * A private memory (E15-S2): the page's `private:` flag set at filing, or for a Log entry the flag of
   * a page it was filed on or that cites it.
   */
  private?: PrivateKind;
}

/** Most `related` (shared-note) edges one graph view adds (E18-W1 round 2). */
const RELATED_MAX = 24;

type WeightedLinkIndex = { out: Map<string, Array<{ dst: string; strength: number; reasons: string }>>; total: { nodes: number; links: number } };

export type MemoryIndexRelation = "note" | "filed" | "linked" | "parent" | "child";

/** Voice notes and whether each is tied to a topic page (E12-S3c, the gap S8 fixes). */
export interface MemoryNoteLinks {
  /** Voice notes from the person (agent reports excluded). */
  voiceNotes: number;
  /** Of those, notes no page cites, no receipt files and that link to nothing. */
  unlinked: number;
  /** Of those, notes whose filing planned topics it never wrote (a point rescued onto a leaf counts as written, E12-S20). */
  partial: number;
  /** Notes no page cites whose filing kept them as evidence only (a test recording): nothing to link, not counted as unlinked (E12-S20). */
  evidenceOnly?: number;
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

/** The alternatives of one MATCH clause (`"word"*`, `("word"* OR "two words")`): words, and whether the last is a prefix. */
function clauseAlternatives(clause: string): Array<{ words: string[]; prefix: boolean }> {
  return [...clause.matchAll(/"((?:[^"]|"")+)"(\*?)/g)].map((m) => ({ words: fold(m[1]!.replace(/""/g, '"')).split(" ").filter(Boolean), prefix: m[2] === "*" }));
}

/** Where in a note's words one of the alternatives starts: the words in a row, the last as a prefix when it is one. */
function wordPositions(words: readonly string[], alternatives: ReadonlyArray<{ words: string[]; prefix: boolean }>): number[] {
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const hit = alternatives.some((alt) => {
      const n = alt.words.length;
      if (n === 0 || i + n > words.length) return false;
      for (let k = 0; k < n; k++) {
        const want = alt.words[k]!;
        const have = words[i + k]!;
        if (k === n - 1 && alt.prefix ? !have.startsWith(want) : have !== want) return false;
      }
      return true;
    });
    if (hit) out.push(i);
  }
  return out;
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
  /** Bumped by every markDirty: a sync clears `dirty` only if none came in while it read the vault. */
  private dirtyGen = 0;
  /** Time the last search spent bringing the index up to date first (E24-M7: logged per search). */
  lastFreshMs = 0;
  private eagerTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private lastCheck = Number.NEGATIVE_INFINITY;
  private inflight: Promise<unknown> | null = null;
  /** Bumped by every sync that changed rows: the cached graph is rebuilt on the next read. */
  private version = 0;
  private graphCache: { version: number; graph: MemoryGraph } | null = null;
  private privacyCache: { version: number; map: Map<string, PrivateKind> } | null = null;
  private spokenCache: { version: number; words: Map<string, number> } | null = null;
  /** The person's notes as plain words, for the asked-note pick (E12-S19). */
  private noteWordsCache: { version: number; words: Map<number, string[]> } | null = null;
  private linkCache: { version: number; links: WeightedLinkIndex } | null = null;
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
    `);
    const meta = new Map((this.db.prepare("SELECT key, value FROM meta").all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
    // The docs columns changed with the schema: an older table is dropped, not just emptied.
    if (meta.get("schema") !== SCHEMA_VERSION) this.db.exec("DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS zids;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS edges (file TEXT NOT NULL, src TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, weight REAL);
      CREATE INDEX IF NOT EXISTS edges_file ON edges (file);
      CREATE TABLE IF NOT EXISTS zids (file TEXT PRIMARY KEY, zid TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, strength REAL NOT NULL, reasons TEXT NOT NULL, PRIMARY KEY (src, dst)) WITHOUT ROWID;
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
      this.db.exec("DELETE FROM docs; DELETE FROM files; DELETE FROM edges; DELETE FROM zids; DELETE FROM nodes; DELETE FROM links;");
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
    this.dirtyGen++;
    if (!this.options.eagerRefresh || this.eagerTimer || this.closed) return;
    this.eagerTimer = setTimeout(() => {
      this.eagerTimer = null;
      if (this.closed) return;
      this.refresh().then(() => this.warm()).catch((error: unknown) => {
        if (!this.closed) console.warn(`[memory-index] background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, EAGER_REFRESH_DELAY_MS);
    this.eagerTimer.unref?.();
  }

  /** Build the per-version caches a search reads (privacy, graph, links, spoken words) ahead of it. */
  warm(): void {
    if (this.closed) return;
    this.privacy();
    this.memoryGraph();
    this.weightedLinks();
    this.spokenVocabulary();
    // search_memory reads the tree for each hit's place: build it now too (cached per vault state).
    void loadMemoryTree(this.options.vaultPath).catch(() => {});
  }

  close(): void {
    this.closed = true;
    if (this.eagerTimer) clearTimeout(this.eagerTimer);
    this.eagerTimer = null;
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
    const hits = await this.searchHits(query, limit);
    const privacy = this.privacy();
    return privacy.size === 0 ? hits : hits.map((hit) => {
      const kind = privacy.get(hit.path);
      return kind ? { ...hit, private: kind } : hit;
    });
  }

  /**
   * Private memories by path (E15-S2): pages flagged at filing, and the Log entries filed on one or
   * cited by one. Derived once per index version.
   */
  private privacy(): Map<string, PrivateKind> {
    if (this.privacyCache?.version === this.version) return this.privacyCache.map;
    const map = new Map<string, PrivateKind>();
    const pages = this.db.prepare("SELECT path, meta FROM docs WHERE kind = 'page' AND meta LIKE 'private:%'").all() as Array<{ path: string; meta: string }>;
    for (const page of pages) map.set(page.path, page.meta.slice("private:".length) as PrivateKind);
    if (map.size > 0) {
      const ties = this.db.prepare(`
        SELECT src AS entry, target AS page FROM edges WHERE kind = 'filed'
        UNION ALL SELECT target AS entry, src AS page FROM edges WHERE kind = 'cites'
        UNION ALL SELECT path AS entry, filed AS page FROM docs WHERE kind = 'log' AND filed != ''
      `).all() as Array<{ entry: string; page: string }>;
      for (const tie of ties) {
        const kind = map.get(tie.page);
        if (kind && tie.entry.includes("#^") && !map.has(tie.entry)) map.set(tie.entry, kind);
      }
    }
    this.privacyCache = { version: this.version, map };
    return map;
  }

  private async searchHits(query: string, limit: number): Promise<MemoryIndexHit[]> {
    await this.fresh();
    // "What was in my last voice note?" is answered by time and the graph, not by its words (E12-S3c).
    const intent = recentIntent(query, this.now());
    if (intent) {
      const recent = this.recentSearch(intent, limit);
      if (recent.length > 0) return recent;
    }
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups, this.queryVariants(query));
    if (!match) return [];
    const rows = this.db.prepare(`
      SELECT rowid, kind, path, title, filed, lineage, meta, bm25(docs, ${BM25_WEIGHTS}) AS rank
      FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?
    `).all(match, Math.max(40, limit * 8)) as Array<{ rowid: number; kind: MemoryIndexHitKind; path: string; title: string; filed: string; lineage: string; meta: string; rank: number }>;
    const picked: typeof rows = [];
    const seen = new Set<string>();
    const aboutAgents = asksAboutAgentWork(query);
    const scored = rows.filter((row) => aboutAgents || !row.meta.startsWith("agent"))
      .map((row) => ({ ...row, rank: row.rank * factorOf(row) })).sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
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
    const hits = kept.map((row, i): MemoryIndexHit => ({
      path: row.path, kind: row.kind, title: row.title, snippet: snippetOf(texts.get(row.rowid), words),
      score: Math.round(-row.rank * 100) / 100,
      matchPercent: percents[i]!,
      treePath: row.lineage,
      ...(row.filed ? { filedOn: row.filed } : {}),
    }));
    const walked = this.withGraphNeighbours(hits, limit, aboutAgents);
    return generic ? walked : this.withAskedNotes(walked, query, limit);
  }

  /**
   * The note the question asks about joins the top of the list (E12-S19). BM25 ranks a long voice note
   * low, and a note scores its words over the whole text, so a ten-minute note that mentions everything
   * ties with the one that says it. A person's note with one passage holding most of the question
   * (asked notes) reads the best hit's percent times that share, and is placed by it: a note holding
   * the whole question sits next to the best hit. At most two join or move up.
   */
  private withAskedNotes(hits: MemoryIndexHit[], query: string, limit: number): MemoryIndexHit[] {
    if (hits.length === 0) return hits;
    const asked = this.askedNotesNow(query, 2).filter((note) => note.share >= ASKED_NOTE_LIFT);
    if (asked.length === 0) return hits;
    const top = hits[0]!.matchPercent;
    const out = [...hits];
    for (const note of asked) {
      const percent = Math.max(1, Math.round(top * note.share));
      const at = out.findIndex((hit) => hit.path === note.path);
      if (at >= 0) {
        if (out[at]!.matchPercent < percent) out[at] = { ...out[at]!, matchPercent: percent };
        continue;
      }
      const row = this.db.prepare("SELECT title, body, lineage, filed FROM docs WHERE path = ? AND kind = 'log' LIMIT 1")
        .get(note.path) as { title: string; body: string; lineage: string; filed: string } | undefined;
      if (!row) continue;
      out.push({
        path: note.path, kind: "log", title: row.title, snippet: snippetOf({ summary: "", body: spokenWords(row.body) }, note.words),
        score: 0, matchPercent: percent, treePath: row.lineage, ...(row.filed ? { filedOn: row.filed } : {}),
      });
    }
    // Stable: a word match keeps its place before an asked note at the same percent.
    return out.map((hit, i) => ({ hit, i })).sort((a, b) => b.hit.matchPercent - a.hit.matchPercent || a.i - b.i).map(({ hit }) => hit).slice(0, limit);
  }

  /**
   * The ranked list follows the graph's strong paths (E18-W1; E12-S3c round 3). The best word
   * matches that clearly answer (60 % or more, at most three) are the seeds; the best starts at 1, the
   * others at their percent against the best. From each seed the walk follows weighted links and
   * multiplies their strengths; a memory is reached while the product stays at or above the threshold
   * (0.8). Its percent is the best match's percent times that product, so with a 90 % best match a
   * page its note was filed into with strength 0.95 reads 86 %. A word match also reached along
   * a path keeps the higher of the two. At most four memories join; nothing weaker ever does.
   * An agent report joins only when the question is about the agents' work (E12-S15).
   */
  private withGraphNeighbours(hits: MemoryIndexHit[], limit: number, aboutAgents = false): MemoryIndexHit[] {
    const joins = Math.max(0, Math.trunc(this.options.cloud?.joins ?? CLOUD_DEFAULT_JOINS));
    const seeds = hits.slice(0, CLOUD_SEEDS).filter((hit) => hit.matchPercent >= CLOUD_SEED_FLOOR);
    if (joins === 0 || seeds.length === 0) return hits;
    const graph = this.memoryGraph();
    const links = this.weightedLinks().out;
    const threshold = this.options.cloud?.threshold ?? CLOUD_DEFAULT_THRESHOLD;
    // Best path to each memory over all seeds, in percent.
    const reached = new Map<string, { percent: number; strength: number; via: string }>();
    const best = seeds[0]!.matchPercent;
    for (const seed of seeds) {
      // A seed starts as strong as its match against the best one: the threshold is relative to the best.
      const cloud = expandCloud([{ path: seed.path, strength: seed.matchPercent / best }], (path) => links.get(path) ?? [], {
        threshold, maxNodes: 1 + joins + hits.length, skip: (path) => path === TREE_PATH, endsPath: isNote,
      });
      for (const node of cloud) {
        if (node.hops === 0) continue;
        const percent = Math.max(1, Math.round(best * node.strength));
        const prior = reached.get(node.path);
        if (!prior || percent > prior.percent) reached.set(node.path, { percent, strength: node.strength, via: node.via! });
      }
    }
    if (reached.size === 0) return hits;
    const relationOf = (path: string, via: string): MemoryIndexRelation =>
      graph.parentOf(path) === via ? "child" : graph.parentOf(via) === path ? "parent" : "linked";
    // A word match a stronger path reaches reads the path's percent.
    const raised = hits.map((hit) => {
      const path = reached.get(hit.path);
      return path && path.percent > hit.matchPercent && hit.relation === undefined
        ? { ...hit, matchPercent: path.percent, relation: relationOf(hit.path, path.via), via: path.via, pathStrength: path.strength }
        : hit;
    });
    const shown = new Set(hits.map((hit) => hit.path));
    const added: MemoryIndexHit[] = [];
    const candidates = [...reached].filter(([path]) => !shown.has(path)).sort((a, b) => b[1].percent - a[1].percent || a[0].localeCompare(b[0]));
    for (const [path, best] of candidates) {
      if (added.length >= joins) break;
      const row = this.db.prepare("SELECT kind, title, summary, body, lineage, filed, meta FROM docs WHERE path = ? AND kind IN ('page', 'root', 'log') ORDER BY kind = 'root' LIMIT 1")
        .get(path) as { kind: MemoryIndexHitKind; title: string; summary: string; body: string; lineage: string; filed: string; meta: string } | undefined;
      if (!row || (!aboutAgents && row.meta.startsWith("agent"))) continue;
      added.push({
        path, kind: row.kind === "log" ? "log" : "page", title: row.title,
        snippet: snippetOf(row.kind === "log" ? { summary: "", body: spokenWords(row.body) } : row, []), score: 0,
        matchPercent: best.percent, treePath: row.lineage,
        ...(row.kind === "log" && row.filed ? { filedOn: row.filed } : {}),
        relation: relationOf(path, best.via), via: best.via, pathStrength: best.strength,
      });
    }
    return [...raised, ...added].map((hit, i) => ({ hit, i })).sort((a, b) => b.hit.matchPercent - a.hit.matchPercent || a.i - b.i).map(({ hit }) => hit).slice(0, limit);
  }

  /**
   * The weighted cloud around a question's best matches or one memory (E18-W1): every memory whose
   * best path keeps a multiplied strength at or above the threshold, strongest first, with the links
   * between them. Null when `center` is not a memory; empty when the question matches nothing.
   */
  async cloud(request: MemoryCloudRequest): Promise<MemoryCloud | null> {
    await this.fresh();
    const threshold = Math.max(0, Math.min(1, request.threshold ?? CLOUD_DEFAULT_THRESHOLD));
    let seeds: Array<{ path: string; strength: number }> = [];
    if (request.center?.trim()) {
      const center = request.center.trim();
      const note = center.includes("#^") && this.db.prepare("SELECT 1 FROM docs WHERE path = ? AND kind = 'log'").get(center) ? center : null;
      const path = note ?? this.memoryGraph().resolve(center);
      if (!path || path === TREE_PATH) return null;
      seeds = [{ path, strength: 1 }];
    } else if (request.query?.trim()) {
      // The word matches seed the cloud; a seed is as strong as its match against the best one.
      const hits = (await this.search(request.query, MAX_HITS)).filter((hit) => !hit.relation || hit.relation === "note");
      const best = hits[0]?.matchPercent ?? 0;
      seeds = hits.map((hit) => ({ path: hit.path, strength: Math.round((hit.matchPercent / Math.max(1, best)) * 1000) / 1000 }))
        .filter((seed) => seed.strength >= threshold).slice(0, 5);
    }
    const links = this.weightedLinks();
    const nodes = expandCloud(seeds, (path) => links.out.get(path) ?? [], {
      threshold, ...(request.maxNodes ? { maxNodes: request.maxNodes } : {}), skip: (path) => path === TREE_PATH, endsPath: isNote,
    });
    const rows = new Map<string, { kind: MemoryIndexHitKind; title: string }>();
    const ids = new Map<string, string>();
    if (nodes.length) {
      const paths = nodes.map((node) => node.path);
      const marks = paths.map(() => "?").join(", ");
      for (const row of this.db.prepare(`SELECT path, kind, title FROM docs WHERE path IN (${marks}) ORDER BY kind = 'root'`).all(...paths) as Array<{ path: string; kind: MemoryIndexHitKind; title: string }>) {
        if (!rows.has(row.path)) rows.set(row.path, row);
      }
      for (const row of this.db.prepare(`SELECT path, id FROM nodes WHERE path IN (${marks})`).all(...paths) as Array<{ path: string; id: string }>) ids.set(row.path, row.id);
    }
    const inCloud = new Set(nodes.map((node) => node.path));
    return {
      threshold,
      seeds: seeds.filter((seed) => inCloud.has(seed.path)),
      nodes: nodes.map((node: CloudNode): MemoryCloudNode => ({
        id: ids.get(node.path) ?? nodeIdOf(node.path), path: node.path, title: rows.get(node.path)?.title ?? node.path,
        kind: rows.get(node.path)?.kind === "log" ? "log" : "page", strength: node.strength, hops: node.hops, seed: node.seed, via: node.via, trail: node.trail,
      })),
      links: nodes.flatMap((node) => (links.out.get(node.path) ?? []).filter((link) => inCloud.has(link.dst))
        .map((link) => ({ from: node.path, to: link.dst, strength: link.strength, reasons: link.reasons }))),
      total: links.total,
    };
  }

  /** Weighted links by source path, strongest first; cached until the next sync changes something. */
  private weightedLinks(): WeightedLinkIndex {
    if (this.linkCache?.version === this.version) return this.linkCache.links;
    const out: WeightedLinkIndex["out"] = new Map();
    const rows = this.db.prepare(`
      SELECT s.path AS src, d.path AS dst, l.strength, l.reasons FROM links l
      JOIN nodes s ON s.id = l.src JOIN nodes d ON d.id = l.dst ORDER BY s.path, l.strength DESC, d.path
    `).all() as Array<{ src: string; dst: string; strength: number; reasons: string }>;
    for (const row of rows) {
      if (!out.has(row.src)) out.set(row.src, []);
      out.get(row.src)!.push({ dst: row.dst, strength: row.strength, reasons: row.reasons });
    }
    const nodes = (this.db.prepare("SELECT count(*) AS n FROM nodes").get() as { n: number }).n;
    const links = { out, total: { nodes, links: rows.length } };
    this.linkCache = { version: this.version, links };
    return links;
  }

  /**
   * Derive `nodes` and `links` from the stored edges (E18-W1): ids from the Markdown, link targets
   * resolved like the graph's, strengths by memoryWeights.ts. Runs inside the sync's transaction, so
   * a search never sees a filing's rows without its links.
   */
  private rebuildLinks(): void {
    const pages = this.db.prepare("SELECT path, title FROM docs WHERE kind = 'page'").all() as Array<{ path: string; title: string }>;
    const notes = new Set((this.db.prepare("SELECT path FROM docs WHERE kind = 'log'").all() as Array<{ path: string }>).map((row) => row.path));
    const zids = new Map((this.db.prepare("SELECT file, zid FROM zids").all() as Array<{ file: string; zid: string }>).map((row) => [row.file, row.zid]));
    const resolver = MemoryGraph.build(pages.map((page) => ({ path: page.path, title: page.title, summary: "", treePath: "" })), [], { hasTree: false });
    const pageOf = (target: string) => {
      const path = resolver.resolve(target);
      return path && path !== TREE_PATH ? path : null;
    };
    const ties: NodeTie[] = [];
    const edges = this.db.prepare("SELECT src, kind, target, weight FROM edges ORDER BY rowid").all() as Array<{ src: string; kind: NodeTie["kind"]; target: string; weight: number | null }>;
    for (const edge of edges) {
      if (edge.src === TREE_PATH) continue; // Tree.md ties every root to one hub: no meaning as a link
      if (edge.kind === "cites") {
        if (resolver.has(edge.src) && notes.has(edge.target)) ties.push({ from: edge.src, to: edge.target, kind: "cites" });
        continue;
      }
      const to = pageOf(edge.target);
      if (!to || to === edge.src) continue;
      if (edge.kind === "link" || edge.kind === "tree") {
        if (resolver.has(edge.src)) ties.push({ from: edge.src, to, kind: edge.kind });
      } else if (notes.has(edge.src)) {
        ties.push({ from: edge.src, to, kind: edge.kind, weight: edge.weight });
      }
    }
    const noteTime = (note: string) => {
      const date = LOG_ENTRY_DATE_RE.exec(note)?.[1];
      return date ? Date.parse(`${date}T12:00:00Z`) : null;
    };
    const links = buildWeightedLinks(ties, { now: this.now(), noteTime });
    const ids = new Map<string, string>();
    const used = new Set<string>();
    for (const path of [...pages.map((row) => row.path), ...notes].sort()) {
      if (ids.has(path)) continue;
      const own = nodeIdOf(path, zids.get(path));
      let id = own;
      // Two memories that claim one id (a copied page, a rare block id clash) stay apart.
      for (let n = 2; used.has(id); n++) id = `${own}-${n}`;
      used.add(id);
      ids.set(path, id);
    }
    this.db.exec("DELETE FROM nodes; DELETE FROM links;");
    const insertNode = this.db.prepare("INSERT INTO nodes (id, path) VALUES (?, ?)");
    for (const [path, id] of ids) insertNode.run(id, path);
    const insertLink = this.db.prepare("INSERT INTO links (src, dst, strength, reasons) VALUES (?, ?, ?, ?)");
    for (const link of links) {
      const src = ids.get(link.src);
      const dst = ids.get(link.dst);
      if (src && dst) insertLink.run(src, dst, link.strength, link.reasons);
    }
  }

  /**
   * A recent-note question (recentIntent.ts): the person's latest notes (voice notes when it
   * asks for one), newest first, then the pages the latest one was filed into or links to and
   * their tree parents. A note's percent is its fit (1 without a topic, else how much of the
   * topic it holds) halved per newer note before it; a page's is the note's times the strength of
   * the path from the note to it in the weighted graph (E18-W1): the note → page link, times the
   * page → parent link for a parent. Equal strengths keep the page that holds more of the note
   * first. Empty when no note fits, so the word search answers.
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
    // A day asked as a whole ("what did I send on November 6?", E12-S35) is a period of one day: with
    // several notes it lists them, not the newest one and the pages it was filed into. A day with one
    // note, or a question for one note ("yesterday's vn"), keeps the note and its pages.
    const period = intent.window.kind === "range" || (intent.window.kind === "day" && !intent.one && pool.length > 1);
    if (intent.window.kind === "day" && period) {
      // The notes that say the most first: a quick test message tells less about the day than a long note.
      const said = new Map(pool.map((row) => [row.rowid, spokenWords(row.body).split(/\s+/).length]));
      pool = [...pool].sort((a, b) => (fit.get(b.rowid) ?? 0) - (fit.get(a.rowid) ?? 0) || said.get(b.rowid)! - said.get(a.rowid)!);
    }
    const percentOf = (value: number) => Math.max(1, Math.min(100, Math.round(value * 100)));
    const hits: MemoryIndexHit[] = [];
    // The latest note halves each older one; in a period every note counts, so they fall gently.
    const decay = period ? 0.95 : 0.5;
    const held = new Map<string, number>();
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
      if (k > 0 || period) return;
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
        held.set(link.path, said.size ? [...contentWords(lines.join(" "))].filter((word) => said.has(word)).length / said.size : 0);
        hits.push({
          path: link.path, kind: "page", title: page.title,
          snippet: citingSnippet(lines) ?? snippetOf(page, words),
          score: 0, matchPercent: percentOf((notePercent / 100) * link.weight), treePath: page.lineage,
          relation: link.relation, via: note.path, pathStrength: link.weight,
        });
      }
    });
    // Highest first; equal strengths: the page holding more of the note, then the order above.
    return hits.map((hit, i) => ({ hit, i }))
      .sort((a, b) => b.hit.matchPercent - a.hit.matchPercent || (held.get(b.hit.path) ?? 0) - (held.get(a.hit.path) ?? 0) || a.i - b.i)
      .map(({ hit }) => hit).slice(0, limit);
  }

  /**
   * The person's own notes that best match a question (E12-S1b round 2): Log entries they sent,
   * never agent reports, by how much of the question's words each holds, then BM25. The chat
   * answer reads them beside the ranked memories: BM25 ranks a long voice note low, so the ranked
   * list often misses the one note that says it. Empty for a question with no telling word.
   */
  async ownNotes(query: string, limit = 6): Promise<string[]> {
    await this.fresh();
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups, this.queryVariants(query));
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
   * The person's own notes (never agent reports) that hold the question in one passage (E12-S19),
   * best first: each note's best ~90-word passage, by the rarity-weighted share of the question's
   * words it holds (other spellings and the other language count), then recency. Empty for a question
   * with no telling word. The ranked list lifts those at ASKED_NOTE_LIFT or more; the chat reads them whole.
   */
  async askedNotes(query: string, limit = 2): Promise<Array<{ path: string; share: number }>> {
    await this.fresh();
    return this.askedNotesNow(query, limit).map(({ path, share }) => ({ path, share }));
  }

  private askedNotesNow(query: string, limit: number): Array<{ path: string; share: number; words: string[] }> {
    const { match, terms, generic } = buildMatchTerms(query, this.aliasGroups, this.queryVariants(query));
    if (!match || generic || terms.length === 0) return [];
    // Which of the person's notes hold each question word anywhere; a passage never holds more of the
    // question than its whole note, so only notes that could reach the lift are read word by word.
    const total = (this.db.prepare("SELECT count(*) AS n FROM docs").get() as { n: number }).n;
    const countOf = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
    const ownWith = this.db.prepare("SELECT rowid FROM docs WHERE docs MATCH ? AND kind = 'log' AND meta LIKE 'user%'");
    const clauses = terms.map((term) => {
      const scoped = `{title aliases summary body} : ${term}`;
      return { alternatives: clauseAlternatives(term), weight: idfOf(total, (countOf.get(scoped) as { n: number }).n), rows: new Set((ownWith.all(scoped) as Array<{ rowid: number }>).map((row) => row.rowid)) };
    });
    const weightSum = clauses.reduce((sum, clause) => sum + clause.weight, 0);
    if (weightSum <= 0) return [];
    const whole = new Map<number, number>();
    for (const clause of clauses) for (const rowid of clause.rows) whole.set(rowid, (whole.get(rowid) ?? 0) + clause.weight / weightSum);
    if (whole.size === 0) return [];
    const floor = Math.min(ASKED_NOTE_LIFT, Math.max(...whole.values())) * 0.999;
    const ids = [...whole].filter(([, share]) => share >= floor).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 120).map(([rowid]) => rowid);
    // BM25 among them breaks ties (how often and how densely the note says it).
    // FTS5 does not hold a MATCH query to a rowid list: the candidates are kept here.
    const candidates = new Set(ids);
    const rows = (this.db.prepare(`SELECT rowid, path FROM docs WHERE docs MATCH ? AND kind = 'log' AND meta LIKE 'user%' ORDER BY bm25(docs, ${BM25_WEIGHTS})`)
      .all(match) as Array<{ rowid: number; path: string }>).filter((row) => candidates.has(row.rowid));
    if (rows.length === 0) return [];
    if (this.noteWordsCache?.version !== this.version) this.noteWordsCache = { version: this.version, words: new Map() };
    const cache = this.noteWordsCache.words;
    const wordsOf = (rowid: number): string[] => {
      let words = cache.get(rowid);
      if (!words) {
        const row = this.db.prepare("SELECT body, meta FROM docs WHERE rowid = ?").get(rowid) as { body: string; meta: string };
        words = normalize(fold(row.meta.endsWith("voice") ? spokenWords(row.body) : row.body)).split(" ").filter(Boolean);
        cache.set(rowid, words);
      }
      return words;
    };
    const scored = rows.map((row, order) => {
      const words = wordsOf(row.rowid);
      // Where each question word is said, then the ~90-word passage holding the most of them.
      const at = clauses.map((clause) => wordPositions(words, clause.alternatives));
      let share = 0;
      const step = PASSAGE_WORDS / 2;
      for (let start = 0; start === 0 || start + step < words.length; start += step) {
        const held = clauses.reduce((sum, clause, k) => sum + (at[k]!.some((i) => i >= start && i < start + PASSAGE_WORDS) ? clause.weight : 0), 0);
        share = Math.max(share, held / weightSum);
        if (share >= 1) break;
      }
      return { path: row.path, share: Math.round(share * 1000) / 1000, order };
    }).filter((note) => note.share > 0);
    const words = matchWords(match);
    // Equal shares: BM25 decides (how often and how densely the note says it).
    return scored.sort((a, b) => b.share - a.share || a.order - b.order)
      .slice(0, limit).map(({ path, share }) => ({ path, share, words }));
  }

  /** Other spellings of the question's words: the transcriber's and the other language's (E12-S19). */
  private queryVariants(query: string): Map<string, string[]> {
    const out = this.spellingVariants(query);
    for (const word of new Set(normalize(query).split(" "))) {
      const group = OTHER_LANGUAGE.find((members) => members.includes(fold(word)));
      if (!group) continue;
      const others = group.filter((member) => member !== fold(word));
      out.set(word, [...new Set([...(out.get(word) ?? []), ...others])]);
    }
    return out;
  }

  /**
   * How a speech-to-text model keeps spelling a word the person writes (E12-S1b round 2): Jordi says
   * "Zenod" and his transcripts say "Zenot", "Znot", "Zinot". For a question word of five letters or
   * more that the vault knows (3+ rows) but that is (almost) never in what the person said, the
   * words of their voice notes that start with the same letter, are at most one letter longer or
   * shorter, two edits away or less, and recur in 2+ notes. At most four per word.
   * A word the person does say keeps the transcriber's other spelling when that spelling is said in
   * at least as many notes, is one edit away and is written on under half as many pages (E12-S33: once some of his
   * transcripts spelt "Zenod" right, the 17 notes saying "Zenot" fell out of every Zenod question).
   */
  private spellingVariants(query: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const words = [...new Set(normalize(query).split(" ").filter((word) => word.length >= 5 && !STOP_WORDS.has(word) && !GENERIC_WORDS.has(word) && !/\d/.test(word)))];
    if (words.length === 0) return out;
    const spoken = this.spokenVocabulary();
    const rows = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ?");
    const pages = this.db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH ? AND kind IN ('page', 'root')");
    const written = (term: string) => (pages.get(`{title aliases summary body} : ${quote(term)}`) as { n: number }).n;
    for (const word of words) {
      const said = spoken.get(word) ?? 0;
      if ((rows.get(`{title aliases summary body} : ${quote(word)}`) as { n: number }).n < 3) continue;
      const writtenWord = said > 1 ? written(word) : 0;
      const found = [...spoken]
        .filter(([other, notes]) => notes >= 2 && other !== word && other[0] === word[0] && Math.abs(other.length - word.length) <= 1 && editDistance(word, other) <= 2)
        .filter(([other, notes]) => said <= 1 || (notes >= said && editDistance(word, other) <= 1 && written(other) * 2 <= writtenWord))
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
   * The pages a Log entry is tied to in the weighted graph (E18-W1), strongest first: pages that
   * cite it, that its filing wrote or that it links to, each with the link's strength, then those
   * pages' tree parents with the path's (note → page × page → parent). `unwritten` counts the pages
   * its filing planned but no page shows (filing stopped half way, S6/S8).
   */
  private connectionsOf(notePath: string): { pages: Array<{ path: string; relation: MemoryIndexRelation; weight: number }>; unwritten: number } {
    const graph = this.memoryGraph();
    const links = this.weightedLinks().out;
    const pages = (links.get(notePath) ?? [])
      .filter((link) => link.dst !== TREE_PATH && /\b(?:cites|filed|mentions)\b/.test(link.reasons) && graph.has(link.dst))
      .map((link) => ({ path: link.dst, relation: (/\b(?:cites|filed)\b/.test(link.reasons) ? "filed" : "linked") as MemoryIndexRelation, weight: link.strength }));
    const tied = new Set(pages.map((page) => page.path));
    const unwritten = (this.db.prepare("SELECT target FROM edges WHERE src = ? AND kind = 'dropped'").all(notePath) as Array<{ target: string }>).filter((edge) => {
      const path = graph.has(edge.target) ? edge.target : graph.resolve(edge.target);
      return !path || !tied.has(path);
    }).length;
    // Each parent once, at its strongest path from the note.
    const parents = new Map<string, number>();
    for (const page of pages) {
      const parent = graph.parentOf(page.path);
      if (!parent || parent === TREE_PATH || tied.has(parent)) continue;
      const step = (links.get(page.path) ?? []).find((link) => link.dst === parent)?.strength ?? 0;
      parents.set(parent, Math.max(parents.get(parent) ?? 0, Math.round(page.weight * step * 1000) / 1000));
    }
    const byStrength = (a: { path: string; weight: number }, b: { path: string; weight: number }) =>
      b.weight - a.weight || graph.depthOf(b.path) - graph.depthOf(a.path) || graph.titleOf(a.path).localeCompare(graph.titleOf(b.path)) || a.path.localeCompare(b.path);
    const up = [...parents].filter(([, weight]) => weight > 0).map(([path, weight]) => ({ path, relation: "parent" as const, weight }));
    return { pages: [...pages.sort(byStrength), ...up.sort(byStrength)], unwritten };
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
    let evidenceOnly = 0;
    const unlinkedPaths: string[] = [];
    const kept = new Set((this.db.prepare("SELECT src FROM edges WHERE kind = 'kept'").all() as Array<{ src: string }>).map((row) => row.src));
    for (const note of notes) {
      const links = this.connectionsOf(note.path);
      if (links.pages.length === 0 && kept.has(note.path)) evidenceOnly++;
      else if (links.pages.length === 0) {
        unlinked++;
        if (unlinkedPaths.length < 20) unlinkedPaths.push(note.path);
      } else if (links.unwritten > 0) partial++;
    }
    return { voiceNotes: notes.length, unlinked, partial, evidenceOnly, unlinkedPaths };
  }

  /**
   * The memory graph (E12-S2): `center` (a path or link target) with its neighbourhood, or the
   * overview when omitted; null when `center` is not a memory. Built from stored rows, cached
   * until the next sync changes something, so a view of a large vault costs milliseconds.
   * Each drawn edge carries its weighted link's strength (E18-W1 round 2), so the view can show it.
   */
  async graph(options: { center?: string | null; limit?: number; lit?: readonly string[] | null } = {}): Promise<MemoryGraphView | null> {
    await this.fresh();
    const graph = this.memoryGraph();
    const limit = options.limit ?? MEMORY_GRAPH_DEFAULT_LIMIT;
    const view = options.lit?.length
      ? graph.litView(options.lit, { limit, notes: this.litNotes(graph, options.lit) })
      : options.center ? graph.neighbourhood(options.center, limit) : graph.overview(limit);
    if (view) this.withStrengths(view, { related: !options.lit?.length });
    return view;
  }

  /**
   * Each edge's strength: the weighted link in its own direction (a wikilink's 0.9, a parent's 0.8
   * to its child), else the link back. Edges with no weighted link (Tree.md to its roots) keep none.
   * With `related`, two drawn pages that only share notes (co-mention, often weak) get a `related`
   * edge too, strongest first and at most RELATED_MAX, so the view shows its weak ties.
   */
  private withStrengths(view: MemoryGraphView, options: { related?: boolean } = {}): void {
    const out = this.weightedLinks().out;
    const linkOf = (from: string, to: string) => out.get(from)?.find((link) => link.dst === to);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    for (const edge of view.edges) {
      if (edge.strength !== undefined) continue;
      const strength = (linkOf(edge.from, edge.to) ?? linkOf(edge.to, edge.from))?.strength;
      if (strength !== undefined) edge.strength = round(strength);
    }
    if (!options.related) return;
    const drawn = new Set(view.nodes.map((node) => node.path));
    const pair = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
    const seen = new Set(view.edges.map((edge) => pair(edge.from, edge.to)));
    const related: MemoryGraphView["edges"] = [];
    for (const from of drawn) {
      for (const link of out.get(from) ?? []) {
        if (!drawn.has(link.dst) || seen.has(pair(from, link.dst)) || !link.reasons.includes("co-mention")) continue;
        seen.add(pair(from, link.dst));
        const back = linkOf(link.dst, from)?.strength ?? 0;
        related.push({ from, to: link.dst, kind: "related", strength: round(Math.max(link.strength, back)) });
      }
    }
    related.sort((a, b) => b.strength! - a.strength! || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    view.edges.push(...related.slice(0, RELATED_MAX));
  }

  /** Of an answer's memories (E12-S13), the Log entries: each with the pages it is tied to, so it can join the lit graph. */
  private litNotes(graph: MemoryGraph, refs: readonly string[]): MemoryGraphNote[] {
    const entries = refs.filter((ref) => ref.includes("#") && !graph.has(ref) && !graph.resolve(ref));
    if (entries.length === 0) return [];
    const rows = this.db.prepare(`SELECT path, title, summary FROM docs WHERE kind = 'log' AND path IN (${entries.map(() => "?").join(", ")})`)
      .all(...entries) as Array<{ path: string; title: string; summary: string }>;
    return rows.map((row) => ({ ...row, ties: this.connectionsOf(row.path).pages.slice(0, 4).map((page) => page.path) }));
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
    const started = performance.now();
    try { await this.freshNow(); } finally { this.lastFreshMs = Math.round(performance.now() - started); }
  }

  private async freshNow(): Promise<void> {
    if (this.dirty || this.now() - this.lastCheck > STALE_AFTER_MS) await this.refresh();
    // A sync already under way (a background refresh) clears `dirty` before it commits: wait for
    // it, so a search reads the same rows it would have after running the sync itself.
    else if (this.inflight) await this.inflight.catch(() => {});
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
    const gen = this.dirtyGen;
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
    this.dirty = this.dirtyGen !== gen;
    if (!full && changed.length === 0 && removed.length === 0) return { changed: 0, removed: 0 };

    const parsed = await Promise.all(changed.map(async (file) => ({ ...file, ...(await rowsOf(vaultPath, file.path)) })));
    // Lineage depends on other pages' parents, so any change re-derives it for every row.
    const lineage = await lineageResolver(vaultPath);

    const insert = this.db.prepare("INSERT INTO docs (title, aliases, lineage, summary, body, kind, path, file, filed, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const upsertFile = this.db.prepare("INSERT INTO files (path, mtime_ms, size) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size");
    const deleteRows = this.db.prepare("DELETE FROM docs WHERE file = ?");
    const deleteFile = this.db.prepare("DELETE FROM files WHERE path = ?");
    const insertEdge = this.db.prepare("INSERT INTO edges (file, src, kind, target, weight) VALUES (?, ?, ?, ?, ?)");
    const deleteEdges = this.db.prepare("DELETE FROM edges WHERE file = ?");
    const upsertZid = this.db.prepare("INSERT INTO zids (file, zid) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET zid = excluded.zid");
    const deleteZid = this.db.prepare("DELETE FROM zids WHERE file = ?");
    const resolved = await Promise.all(parsed.map(async (file) => ({
      ...file,
      rows: await Promise.all(file.rows.map(async (row) => ({ ...row, ...(await lineage(row)) }))),
    })));
    const stale = full ? [] : await this.relineage(lineage, new Set(changed.map((file) => file.path)));

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (full) this.db.exec("DELETE FROM docs; DELETE FROM files; DELETE FROM edges; DELETE FROM zids;");
      for (const path of removed) { deleteRows.run(path); deleteEdges.run(path); deleteZid.run(path); deleteFile.run(path); }
      for (const file of resolved) {
        deleteRows.run(file.path);
        deleteEdges.run(file.path);
        deleteZid.run(file.path);
        for (const row of file.rows) insert.run(row.title, row.aliases, row.lineage, row.summary, row.body, row.kind, row.path, row.file, row.filed, row.meta);
        for (const edge of file.edges) insertEdge.run(file.path, edge.from, edge.kind, edge.target, edge.weight ?? null);
        if (file.zid) upsertZid.run(file.path, file.zid);
        upsertFile.run(file.path, file.mtimeMs, file.size);
      }
      const update = this.db.prepare("UPDATE docs SET lineage = ?, filed = ? WHERE rowid = ?");
      for (const row of stale) update.run(row.lineage, row.filed, row.rowid);
      // Every filing changes the vault: the weighted links are derived again in the same commit (E18-W1).
      this.rebuildLinks();
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
type StoredEdge = { from: string; target: string; kind: MemoryGraphRawEdge["kind"] | "cites" | "filed" | "planned" | "dropped" | "kept" | "mentions"; weight?: number | null };

/** The note → page edges of a filing receipt (`Inbox/filing-<date>-e-xxxxxx.md`); none when it does not parse. */
function receiptEdges(raw: string): StoredEdge[] {
  const body = /\n```json\n([\s\S]*)\n```\n?$/.exec(raw)?.[1];
  if (!body) return [];
  try {
    const value = JSON.parse(body) as {
      evidenceRef?: unknown;
      outcomes?: Array<{ filedPages?: unknown; uncertainPages?: unknown; pages?: unknown; confidence?: unknown; ideaId?: unknown; status?: unknown; disposition?: unknown }>;
      classification?: { disposition?: unknown; topics?: Array<{ pages?: Array<{ path?: unknown } | string>; ideaId?: unknown; disposition?: unknown }> };
    };
    if (typeof value.evidenceRef !== "string") return [];
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
    // A page's tie is the filing's own confidence (E18-W1): the best outcome that wrote it, an uncertain one at most 0.6.
    const filed = new Map<string, number | null>();
    const planned = new Set<string>();
    const better = (page: string, value: number | null) => {
      const prior = filed.get(page);
      filed.set(page, prior === undefined ? value : value === null ? prior : prior === null ? value : Math.max(prior, value));
    };
    for (const outcome of value.outcomes ?? []) {
      const confidence = typeof outcome.confidence === "number" && outcome.confidence > 0 && outcome.confidence <= 1 ? outcome.confidence : null;
      for (const page of strings(outcome.filedPages)) better(page, confidence);
      for (const page of strings(outcome.uncertainPages)) better(page, Math.min(0.6, confidence ?? 0.6));
      for (const page of strings(outcome.pages)) planned.add(page);
    }
    for (const topic of value.classification?.topics ?? []) {
      for (const page of topic.pages ?? []) {
        const path = typeof page === "string" ? page : typeof page?.path === "string" ? page.path : null;
        if (path) planned.add(path);
      }
    }
    // E12-S20: `dropped` pages are those of points that reached no page at all (a point rescued onto a
    // leaf is written); `kept` marks a filing that kept the note as evidence only, so it is not "unlinked".
    const dropped = new Set<string>();
    const topics = value.classification?.topics ?? [];
    const outcomeOf = (ideaId: unknown) => (value.outcomes ?? []).find((outcome) => typeof ideaId === "string" && outcome.ideaId === ideaId);
    for (const topic of topics) {
      const outcome = outcomeOf(topic.ideaId);
      if (topic.disposition === "evidence_only" || outcome?.status === "filed" || strings(outcome?.filedPages).length || strings(outcome?.uncertainPages).length) continue;
      for (const page of topic.pages ?? []) {
        const path = typeof page === "string" ? page : typeof page?.path === "string" ? page.path : null;
        if (path && !filed.has(path)) dropped.add(path);
      }
    }
    if (!topics.length) {
      for (const outcome of value.outcomes ?? []) {
        if (outcome.status === "filed" || outcome.disposition === "evidence_only" || strings(outcome.filedPages).length || strings(outcome.uncertainPages).length) continue;
        for (const page of strings(outcome.pages)) if (!filed.has(page)) dropped.add(page);
      }
    }
    const evidenceOnly = value.classification?.disposition === "evidence_only"
      || (topics.length > 0 && topics.every((topic) => topic.disposition === "evidence_only"));
    const from = value.evidenceRef;
    return [
      ...[...filed].map(([target, weight]) => ({ from, target, kind: "filed" as const, weight })),
      ...[...planned].filter((page) => !filed.has(page)).map((target) => ({ from, target, kind: "planned" as const })),
      ...[...dropped].map((target) => ({ from, target, kind: "dropped" as const })),
      ...(evidenceOnly && filed.size === 0 ? [{ from, target: from, kind: "kept" as const }] : []),
    ];
  } catch {
    return [];
  }
}

/** A private page's `meta` (E15-S2): `private:<kind>`, "" otherwise. */
const privateMeta = (kind: PrivateKind | false | null) => (kind ? `private:${kind}` : "");

/** A file's index rows and its graph edges (links and tree parent, targets as written). */
async function rowsOf(vaultPath: string, path: string): Promise<{ rows: RowDraft[]; edges: StoredEdge[]; zid?: string }> {
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
  // A merged leaf's pointer page (E12-S24): its words live on the page it points to; only the link stays.
  if (pageTreeFields(frontmatter).merged) {
    return { rows: [], edges: [{ from: path, target: String(meta["merged-into"]).replace(/^\[\[|\]\]$/g, ""), kind: "link" }] };
  }
  const edges: StoredEdge[] = [
    ...(parent ? [{ from: path, target: parent, kind: "tree" as const }] : []),
    ...extractPageLinks(body).map((target) => ({ from: path, target, kind: "link" as const })),
    ...[...new Set(extractCitations(body).map((cite) => `Log/${cite.date}.md#^${cite.anchor}`))].map((target) => ({ from: path, target, kind: "cites" as const })),
  ];
  return { edges, ...(typeof meta.zid === "string" && meta.zid.trim() ? { zid: meta.zid.trim() } : {}), rows: [{
    title,
    // Obsidian's own `aliases:` (a list or one string) and tags: the page's metadata, not steering.
    aliases: [...(typeof meta.aliases === "string" ? [meta.aliases] : strings(meta.aliases)), ...strings(meta.tags)].join(" · "),
    summary: [typeof meta.summary === "string" ? meta.summary : "", typeof meta.description === "string" ? meta.description : ""].filter(Boolean).join(" "),
    // Rollup lines link agent reports: not what the page is about (E12-S15).
    body: body.replace(ROLLUP_LINE_RE, ""),
    kind: "page", path, file: path, meta: path.startsWith(AGENT_REPORTS_DIR) ? "agent" : privateMeta(recordedPrivacy(frontmatter)),
  }] };
}
