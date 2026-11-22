import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf } from "./files.js";
import { CITATION_RE, linkTargetsOf } from "./pages.js";
import { parseLogCaptures, withoutOpsRollup } from "./captureOrigin.js";
import { buildTreeIndex, MAX_TREE_DEPTH, readTree, treePageFieldsOf, type MemoryKind, type TreePageFields } from "./tree.js";
import { frontmatterDate } from "./treeOutline.js";
import { RACY_MS, vaultFingerprint, type VaultFingerprint } from "./lineage.js";
import type { VaultPullTiming } from "./repository.js";

/**
 * The quick index's model-free part (EPIC-14 S28): one entry per place in the memory tree with
 * the one-line summary the tree already keeps (the page's `summary:`, else the root's Tree.md
 * line), the page's own `aliases:` a person would say, counts, when the person last added to it, and what they added
 * to this week. The host adds nicknames found in the person's own words with a small model call
 * and keeps the result; this file reads the vault only and writes nothing.
 */

/** Words of a capture kept per place for the host's nickname pass; never shown in the app. */
const CAPTURE_CHARS = 600;
const CAPTURES_PER_PLACE = 3;
export const QUICK_INDEX_WEEK_DAYS = 7;

export interface QuickIndexCapture {
  /** `YYYY-MM-DD#^e-xxxxxx`, the Log entry's key. */
  key: string;
  date: string;
  text: string;
}

export interface QuickIndexPlace {
  path: string;
  title: string;
  memory: MemoryKind;
  /** Names from the root down to this place. */
  lineage: string[];
  root: boolean;
  /** One line from the tree: the page's `summary:`, else the root's Tree.md line; "" when none. */
  summary: string;
  /** The page's own `aliases:`. */
  aliases: string[];
  /** Pages in this place's subtree, its own included. */
  pages: number;
  /** The person's own captures cited on this page (agent reports not counted). */
  memories: number;
  /** Of those, captured in the last seven days. */
  week: number;
  /** YYYY-MM-DD the person last added to this page, else its frontmatter date. */
  lastTouched: string | null;
  /** Every own capture key cited on the page, newest first. */
  captureKeys: string[];
  /** The newest few own captures, shortened, for the nickname pass. */
  captures: QuickIndexCapture[];
}

export interface QuickIndexBase {
  places: QuickIndexPlace[];
  /** First day (YYYY-MM-DD, UTC) counted as this week. */
  weekFrom: string;
}

/** Summaries are shown on one line: the first sentence, at most this long. */
const SUMMARY_CHARS = 160;
const ALIAS_CHARS = 40;

/** One line: the first sentence when it fits, else cut at a word with an ellipsis. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_CHARS) return flat;
  const sentence = /^(.{20,}?[.!?])\s/.exec(flat)?.[1];
  if (sentence && sentence.length <= SUMMARY_CHARS) return sentence;
  return `${flat.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")}…`;
}

/** Aliases a person would say: short, and not a file name or id left by a merge (`AC23…F414.ogg`). */
export function sayableAlias(alias: string): boolean {
  if (alias.length > ALIAS_CHARS) return false;
  if (/\.(ogg|oga|opus|m4a|mp3|mp4|wav|jpe?g|png|pdf|md)\b/i.test(alias)) return false;
  return !alias.split(/\s+/).some((word) => word.length >= 12 && /\d/.test(word) && /^[A-Za-z0-9_-]+$/.test(word));
}

function frontmatterString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function frontmatterList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

const MAX_CACHED_BASES = 8;
const baseCache = new Map<string, { fingerprint: string; weekFrom: string; base: Promise<QuickIndexBase | null> }>();
const memos = new Map<string, Promise<QuickIndexMemo>>();

/** Where the persisted per-file memo lives. */
export interface QuickIndexBaseOptions {
  /** File the per-file memo is kept in across restarts (beside the memory index, never in the vault); none: in memory only. */
  memoPath?: string;
}

/**
 * `quickIndexBase`, rebuilt only when a Markdown file was added, removed or changed, or the week window moved
 * (EPIC-24 M34). The base reads and parses every page and every Log file (about 2.3 s of CPU on a 2,400-file vault,
 * 8-16 s on VPS1), and the 5-minute clock of every tenant asked for it whether or not anything had been filed: a Zenod
 * with nobody saving burned a core in 15-second bursts. The base depends only on those files and, through `now`, on
 * the first day of the week, so a hit returns the very same object a fresh build would. A file changed in the last
 * 100 ms is never trusted (the same racy rule as the memory tree); a failed build is not kept.
 *
 * Round 4: when the fingerprint did change, only the changed files are read and parsed again. What each page and each
 * Log file contributes is kept per file (keyed by its mtime and size) in a memo that is also saved to `memoPath`, so
 * a save re-reads the one page and the one Log day it touched, and a restart re-reads nothing that has not changed.
 */
export async function quickIndexBaseCached(vaultPath: string, now: number = Date.now(), phases?: QuickIndexPhases, options: QuickIndexBaseOptions = {}): Promise<QuickIndexBase | null> {
  const key = resolve(vaultPath);
  const weekFrom = weekFromOf(now);
  const statStarted = performance.now();
  const fingerprint = await vaultFingerprint(vaultPath);
  const { hash, racy } = fingerprint;
  if (phases) phases.statMs = Math.round(performance.now() - statStarted);
  const cached = baseCache.get(key);
  if (cached && !racy && cached.fingerprint === hash && cached.weekFrom === weekFrom) {
    baseCache.delete(key); baseCache.set(key, cached);
    if (phases) { phases.rebuildMs = 0; phases.rebuilt = false; }
    return cached.base;
  }
  const rebuildStarted = performance.now();
  const base = memoFor(key, options.memoPath).then((memo) => buildBase(vaultPath, now, fingerprint, memo, phases));
  baseCache.delete(key);
  if (!racy) {
    const entry = { fingerprint: hash, weekFrom, base };
    baseCache.set(key, entry);
    if (baseCache.size > MAX_CACHED_BASES) baseCache.delete(baseCache.keys().next().value!);
    base.catch(() => { if (baseCache.get(key) === entry) baseCache.delete(key); });
  }
  if (!phases) return base;
  try { return await base; } finally { phases.rebuildMs = Math.round(performance.now() - rebuildStarted); phases.rebuilt = true; }
}

/** Tests only: forget what this process kept, as a restart does. */
export function forgetQuickIndexCaches(): void {
  baseCache.clear();
  memos.clear();
}

function memoFor(key: string, memoPath: string | undefined): Promise<QuickIndexMemo> {
  const id = `${key}\0${memoPath ?? ""}`;
  let memo = memos.get(id);
  if (!memo) {
    memo = memoPath ? QuickIndexMemo.load(memoPath, key) : Promise.resolve(new QuickIndexMemo(null, key));
    memos.set(id, memo);
    if (memos.size > MAX_CACHED_BASES) memos.delete(memos.keys().next().value!);
  }
  return memo;
}

/** The memo's format and what it was derived with: bump MEMO_VERSION when what a page or Log file contributes changes. */
const MEMO_VERSION = 1;

interface Stamp { mtimeMs: number; size: number }
/** What one tree page contributes, whatever the other files say. */
interface PageMemo {
  stamp: Stamp;
  fields: TreePageFields;
  summary: string;
  aliases: string[];
  /** Every Log citation outside the ops rollup, once each (`YYYY-MM-DD#^e-xxxxxx`), in first-seen order. */
  keys: string[];
  /** The frontmatter `updated:`/`created:` date, the last-touched fallback of a page that cites nothing. */
  date: string | null;
}
/** What one Log day contributes: its entries, already cut for the nickname pass. */
interface LogMemo {
  stamp: Stamp;
  captures: Array<{ key: string; agent: boolean; text: string }>;
}

/**
 * Per-file derivations of the quick index (EPIC-24 M34 round 4), saved to disk. Everything cross-file (tree shape,
 * which citations are agent reports, the counts) is recomputed from them on every build, which is cheap; only the
 * read and the parse of a file are skipped, and only for a file whose mtime and size are unchanged and which was not
 * written within RACY_MS of the stat that stamped it.
 */
export class QuickIndexMemo {
  pages = new Map<string, PageMemo>();
  logs = new Map<string, LogMemo>();

  constructor(private readonly path: string | null, private readonly vault: string) {}

  static async load(path: string, vault: string): Promise<QuickIndexMemo> {
    const memo = new QuickIndexMemo(path, vault);
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as { version?: number; chars?: number; vault?: string; pages?: Array<[string, PageMemo]>; logs?: Array<[string, LogMemo]> };
      if (raw?.version !== MEMO_VERSION || raw.chars !== CAPTURE_CHARS || raw.vault !== vault || !Array.isArray(raw.pages) || !Array.isArray(raw.logs)) return memo;
      memo.pages = new Map(raw.pages);
      memo.logs = new Map(raw.logs);
    } catch {
      // No memo, or one we cannot read: start empty and rebuild it from the vault.
    }
    return memo;
  }

  /** Best effort: a failed write costs the next restart a rebuild, never an answer. */
  async save(): Promise<void> {
    if (!this.path) return;
    try {
      const body = JSON.stringify({ version: MEMO_VERSION, chars: CAPTURE_CHARS, vault: this.vault, pages: [...this.pages].sort(byPath), logs: [...this.logs].sort(byPath) });
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.path);
    } catch {
      // see above
    }
  }
}

const byPath = (a: [string, unknown], b: [string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const sameStamp = (a: Stamp | undefined, b: Stamp | null | undefined): boolean => Boolean(a && b && a.mtimeMs === b.mtimeMs && a.size === b.size);
const MEMO_READ_CONCURRENCY = 16;

async function inParallel<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { for (let i = next++; i < items.length; i = next++) await work(items[i]!); };
  await Promise.all(Array.from({ length: Math.min(MEMO_READ_CONCURRENCY, items.length) }, worker));
}

function derivePage(path: string, raw: string, stamp: Stamp): PageMemo {
  const { frontmatter, body } = parseNote(raw);
  const keys = new Set<string>();
  for (const match of withoutOpsRollup(body).matchAll(CITATION_RE)) keys.add(`${match[1]}#^${match[2]}`);
  return {
    stamp,
    fields: treePageFieldsOf(path, frontmatter),
    summary: frontmatterString(frontmatter?.summary),
    aliases: frontmatterList(frontmatter?.aliases),
    keys: [...keys],
    date: frontmatterDate(frontmatter?.updated) ?? frontmatterDate(frontmatter?.created),
  };
}

function deriveLog(date: string, raw: string, stamp: Stamp): LogMemo {
  return {
    stamp,
    captures: parseLogCaptures(date, raw).map((capture) => ({
      key: capture.key,
      agent: capture.origin === "agent",
      text: `${capture.title}\n${capture.content}`.replace(/\s+/g, " ").trim().slice(0, CAPTURE_CHARS),
    })),
  };
}

/**
 * EPIC-24 M34: where one quick-index tick spent its wall time, in ms (filled in by the engine and the cache): `pull`
 * (the vault sync before a read, null when it was inside its freshness window or skipped by a busy write), `statMs`
 * (the fingerprint of every Markdown file), `rebuildMs` (the base rebuild, 0 on a cache hit). No file name, no text.
 */
export interface QuickIndexPhases {
  pull?: VaultPullTiming | { kind: "recent" | "busy" } | undefined;
  pullMs?: number;
  statMs?: number;
  rebuildMs?: number;
  rebuilt?: boolean;
  /** Round 4: files read and parsed again, and files whose kept result was reused, in the rebuild. */
  parsedFiles?: number;
  reusedFiles?: number;
  /** `no-tree`: the vault has no Tree.md, so there is nothing to index: no pull, no scan (round 3). */
  skipped?: "no-tree";
}

function weekFromOf(now: number): string {
  return new Date(now - (QUICK_INDEX_WEEK_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** Null when the vault has no Tree.md yet. Reads every file: the per-file memo only helps `quickIndexBaseCached`. */
export async function quickIndexBase(vaultPath: string, now: number = Date.now()): Promise<QuickIndexBase | null> {
  return buildBase(vaultPath, now, await vaultFingerprint(vaultPath), new QuickIndexMemo(null, resolve(vaultPath)));
}

async function buildBase(vaultPath: string, now: number, fingerprint: VaultFingerprint, memo: QuickIndexMemo, phases?: QuickIndexPhases): Promise<QuickIndexBase | null> {
  if (!(await readTree(vaultPath))) return null;
  const { files, stamps, takenAt } = fingerprint;
  const stampOf = new Map(files.map((file, i) => [file, stamps[i] ?? null] as const));
  // A file written within RACY_MS of its stat could be rewritten with the same size inside one timestamp tick.
  const keepable = (stamp: Stamp | null): stamp is Stamp => stamp !== null && stamp.mtimeMs < takenAt - RACY_MS;
  const pagesNow = new Map<string, PageMemo>();
  const logsNow = new Map<string, LogMemo>();
  let parsed = 0;
  let reused = 0;

  const derived = new Map<string, PageMemo>();
  const index = await buildTreeIndex(vaultPath, { files, linkTargets: linkTargetsOf(files) }, async (path) => {
    const stamp = stampOf.get(path) ?? null;
    const kept = memo.pages.get(path);
    let page: PageMemo;
    if (kept && sameStamp(kept.stamp, stamp)) {
      reused++; pagesNow.set(path, kept); page = kept;
    } else {
      page = derivePage(path, await readFile(join(vaultPath, path), "utf8"), stamp ?? { mtimeMs: -1, size: -1 });
      parsed++;
      if (keepable(stamp)) pagesNow.set(path, page);
    }
    derived.set(path, page);
    return page.fields;
  });
  if (!index.tree) return null;
  const weekFrom = weekFromOf(now);

  const logFiles = files.filter((file) => /^Log\/\d{4}-\d{2}-\d{2}\.md$/.test(file));
  const logs = new Map<string, LogMemo>();
  await inParallel(logFiles, async (file) => {
    const stamp = stampOf.get(file) ?? null;
    const kept = memo.logs.get(file);
    if (kept && sameStamp(kept.stamp, stamp)) { reused++; logsNow.set(file, kept); logs.set(file, kept); return; }
    const raw = await readFile(join(vaultPath, file), "utf8").catch(() => "");
    const log = deriveLog(/^Log\/(\d{4}-\d{2}-\d{2})\.md$/.exec(file)![1]!, raw, stamp ?? { mtimeMs: -1, size: -1 });
    parsed++;
    if (keepable(stamp)) logsNow.set(file, log);
    logs.set(file, log);
  });
  // Later days win a key two Log files both hold, as when the files were read in order.
  const captures = new Map<string, { agent: boolean; text: string }>();
  for (const file of logFiles) for (const capture of logs.get(file)!.captures) captures.set(capture.key, capture);
  const isAgentCapture = (key: string) => captures.get(key)?.agent === true;

  const changed = parsed > 0 || pagesNow.size !== memo.pages.size || logsNow.size !== memo.logs.size;
  memo.pages = pagesNow;
  memo.logs = logsNow;
  if (phases) { phases.parsedFiles = parsed; phases.reusedFiles = reused; }

  const pages = new Map<string, { summary: string; aliases: string[]; keys: string[]; lastTouched: string | null }>();
  for (const path of index.fields.keys()) {
    const page = derived.get(path)!;
    const own = page.keys.filter((key) => !isAgentCapture(key));
    let newest: string | null = null;
    for (const key of own) if (!newest || key.slice(0, 10) > newest) newest = key.slice(0, 10);
    pages.set(path, {
      summary: page.summary,
      aliases: page.aliases,
      keys: [...own].sort().reverse(),
      // A page whose only citations are agent reports has no date; one that cites nothing falls back to its frontmatter.
      lastTouched: page.keys.length > 0 ? newest : page.date,
    });
  }
  if (changed) await memo.save();

  const places: QuickIndexPlace[] = [];
  const seen = new Set<string>();
  const visit = (path: string, memory: MemoryKind, lineage: string[], root: { name: string; summary: string } | null): number => {
    if (seen.has(path) || lineage.length >= MAX_TREE_DEPTH) return 0;
    seen.add(path);
    const page = pages.get(path);
    const fields = index.fields.get(path);
    const title = root?.name ?? fields?.title ?? basenameOf(path);
    const names = [...lineage, title];
    const place: QuickIndexPlace = {
      path,
      title,
      memory,
      lineage: names,
      root: root !== null,
      // The page's own summary first: a root's Tree.md line is often only counts ("1 page; 6 of your captures…").
      summary: oneLine(page?.summary || root?.summary || ""),
      aliases: (page?.aliases ?? []).filter((alias) => alias.toLowerCase() !== title.toLowerCase() && sayableAlias(alias)),
      pages: page ? 1 : 0,
      memories: page?.keys.length ?? 0,
      week: (page?.keys ?? []).filter((key) => key.slice(0, 10) >= weekFrom).length,
      lastTouched: page?.lastTouched ?? null,
      captureKeys: page?.keys ?? [],
      captures: (page?.keys ?? []).flatMap((key) => {
        const text = captures.get(key)?.text ?? "";
        return text ? [{ key, date: key.slice(0, 10), text }] : [];
      }).slice(0, CAPTURES_PER_PLACE),
    };
    places.push(place);
    for (const child of index.children(path)) place.pages += visit(child, memory, names, null);
    return place.pages;
  };
  for (const node of index.tree.nodes) {
    visit(index.resolveRef(node.path) ?? node.path, node.kind, [], { name: node.name, summary: node.summary });
  }
  return { places, weekFrom };
}
