import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTreeIndex, formatLineage, type TreeIndex } from "../vault/tree.js";
import { basenameOf } from "../vault/files.js";
import { entryHeading } from "./evidence.js";
import { FILED_CONFIDENCE_RE, FILED_PREFIX, type TrackedWrites } from "./treePlacement.js";
import type { DeskEdit } from "./memoryDesk.js";
import type { VaultRevision } from "../vault/repository.js";

/**
 * E12-S27: the person checks where Zenod filed things, in the app, on the tree itself.
 *
 * - Every new filing records how sure Zenod was of the place, 0–100, at the end of its `filed:`
 *   line in the Log (`· 72% sure`, treePlacement.placementConfidence); the Log stays append-only.
 * - The review lists those filings least sure first, then the older pages Zenod marked
 *   provisional (filed before confidences existed), for the person to confirm or move.
 * - Each confirm, move and undo is one line in `.brain/tree-corrections.jsonl`, committed with
 *   the change itself, in the shape of the landing feedback dataset (EPIC-12 S6:
 *   scripts/feedback/analyse-landing-feedback.py), so the app's corrections feed the landing measure.
 */

export const CORRECTIONS_PATH = ".brain/tree-corrections.jsonl";
export const REVIEW_DEFAULT_LIMIT = 40;
/** Below this a filing is listed as one to check (it still shows, lower ones first). */
export const LOW_CONFIDENCE = 60;

export type CorrectionAction = "confirm" | "move" | "undo";

/** One line of the corrections file: an S6 landing feedback record plus what the app did. */
export interface PlacementCorrection {
  id: string;
  ts: string;
  type: "answer";
  source: "app";
  action: CorrectionAction;
  /** The Log entry the page holds, without `e-` (S6's note id), "" when unknown. */
  note_id: string;
  /** The page's vault path. */
  memory_id: string;
  memories: string[];
  /** The page's title, as S6 records the page a memory landed on. */
  zenod_page: string;
  /** The parent it had before (title), null at the root. */
  zenod_parent: string | null;
  written: true;
  /** yes: right place; no: wrong place (moved); null: an undo, the earlier answer no longer stands. */
  verdict: "yes" | "no" | null;
  correction: string;
  /** For a move: the page it now hangs under (title and path). */
  moved_to?: string;
  moved_to_path?: string;
  /** How sure Zenod had been, when the filing recorded it. */
  confidence: number | null;
  /** The exact edits, so Undo puts them back. */
  edits?: DeskEdit[];
  /** For an undo: the id of the record it undoes. */
  undoes?: string;
}

/** What the app gets back from a confirm, move or undo. */
export interface PlacementCorrectionResult {
  /** The correction record's id (Undo takes it). */
  id: string;
  action: CorrectionAction;
  page: string;
  title: string;
  /** Where it sat before and sits now (`Working › … › Page`). */
  before: string;
  after: string;
  revision: VaultRevision;
}

export interface FilingConfidence {
  evidenceRef: string;
  date: string;
  path: string;
  confidence: number;
}

export interface PlacementReviewItem {
  path: string;
  title: string;
  /** `Working › Zenod › Page`, or "not placed". */
  place: string;
  /** How sure Zenod was, 0–100; null for an older page marked provisional before confidences. */
  confidence: number | null;
  provisional: boolean;
  /** The filing that put it there, when known. */
  evidenceRef: string | null;
  date: string | null;
}

export interface PlacementReview {
  items: PlacementReviewItem[];
  /** Filings waiting for a check (scored and older provisional), before the limit. */
  total: number;
  /** Of those, filings that carry a confidence. */
  scored: number;
  /** Below LOW_CONFIDENCE. */
  low: number;
  /** The person's checks so far (confirms and moves, undone ones excluded). */
  checked: { confirmed: number; moved: number };
  /** The latest moves, newest first, for Undo. */
  recent: Array<{ id: string; ts: string; title: string; from: string | null; to: string; undone: boolean }>;
}

/** Every `filed:` line in the Log that carries a confidence, newest first. */
export async function readFilingConfidences(vaultPath: string): Promise<FilingConfidence[]> {
  const files = (await readdir(join(vaultPath, "Log")).catch(() => [] as string[])).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().reverse();
  const out: FilingConfidence[] = [];
  for (const name of files) {
    const raw = await readFile(join(vaultPath, "Log", name), "utf8").catch(() => "");
    if (!raw.includes("% sure")) continue;
    const date = name.slice(0, 10);
    let anchor: string | null = null;
    const found: FilingConfidence[] = [];
    for (const line of raw.split("\n")) {
      const heading = entryHeading(line);
      if (heading) { anchor = heading.anchor; continue; }
      if (!line.startsWith(FILED_PREFIX)) continue;
      const addressed = /^- filed (e-[0-9a-f]+): /.exec(line);
      const target = addressed ? line.slice(addressed[0].length) : line.startsWith(`${FILED_PREFIX}: `) ? line.slice(FILED_PREFIX.length + 2) : null;
      const entry = addressed?.[1] ?? anchor;
      const sure = target ? FILED_CONFIDENCE_RE.exec(target) : null;
      const page = target ? /^\[\[([^\]|#]+)\]\]/.exec(target)?.[1] : null;
      if (!entry || !sure || !page) continue;
      found.push({ evidenceRef: `Log/${name}#^${entry}`, date, path: page.endsWith(".md") ? page : `${page}.md`, confidence: Math.min(100, Number(sure[1])) });
    }
    out.push(...found.reverse());
  }
  return out;
}

export async function readCorrections(vaultPath: string): Promise<PlacementCorrection[]> {
  const raw = await readFile(join(vaultPath, CORRECTIONS_PATH), "utf8").catch(() => "");
  const out: PlacementCorrection[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as PlacementCorrection;
      if (record && typeof record.id === "string" && typeof record.memory_id === "string") out.push(record);
    } catch { /* a damaged line is skipped, the rest still count */ }
  }
  return out;
}

/** Append one record (through the tracked writes, so a failed change takes it back too). */
export async function appendCorrection(vaultPath: string, record: PlacementCorrection, writes: TrackedWrites): Promise<void> {
  const raw = await readFile(join(vaultPath, CORRECTIONS_PATH), "utf8").catch(() => "");
  await writes.write(CORRECTIONS_PATH, `${raw}${raw && !raw.endsWith("\n") ? "\n" : ""}${JSON.stringify(record)}\n`);
}

/** The records still standing: an undone record and its undo both drop out. */
export function standingCorrections(records: readonly PlacementCorrection[]): PlacementCorrection[] {
  const undone = new Set(records.filter((record) => record.action === "undo" && record.undoes).map((record) => record.undoes!));
  return records.filter((record) => record.action !== "undo" && !undone.has(record.id));
}

const titleOf = (index: TreeIndex, path: string) => index.rootsByPath.get(path.toLowerCase())?.name ?? index.fields.get(path)?.title ?? basenameOf(path);

export function placeOf(index: TreeIndex, path: string): string {
  const lineage = index.lineage(path);
  return lineage.ok ? formatLineage(lineage) : "not placed";
}

/** The parent a page hangs under now (its title), null for a root or an unplaced page. */
export function parentTitle(index: TreeIndex, path: string): string | null {
  const lineage = index.lineage(path);
  if (!lineage.ok || lineage.steps.length < 2) return null;
  return lineage.steps[lineage.steps.length - 2]!.name;
}

export function newCorrection(input: Omit<PlacementCorrection, "id" | "ts" | "type" | "source" | "written" | "memories"> & { title: string }, now: Date): PlacementCorrection {
  const { title, ...rest } = input;
  return { id: `c-${randomUUID().slice(0, 12)}`, ts: now.toISOString(), type: "answer", source: "app", written: true, memories: [title], ...rest };
}

/** The filing Zenod is least sure of first, then older provisional pages; checked pages drop out. */
export async function placementReview(vaultPath: string, options: { limit?: number; index?: TreeIndex } = {}): Promise<PlacementReview> {
  const index = options.index ?? await buildTreeIndex(vaultPath);
  const records = await readCorrections(vaultPath);
  const standing = standingCorrections(records);
  // A page the person checked after its latest filing is done; a newer filing onto it asks again.
  const checkedAt = new Map<string, string>();
  for (const record of standing) {
    const at = record.ts.slice(0, 10);
    if ((checkedAt.get(record.memory_id) ?? "") < at) checkedAt.set(record.memory_id, at);
  }
  const live = (path: string) => index.fields.has(path) && !index.fields.get(path)?.merged && !path.startsWith("Archive/");
  const seen = new Set<string>();
  const scored: PlacementReviewItem[] = [];
  for (const filing of await readFilingConfidences(vaultPath)) {
    if (seen.has(filing.path)) continue;
    seen.add(filing.path);
    if (!live(filing.path)) continue;
    const checked = checkedAt.get(filing.path);
    if (checked && checked >= filing.date) continue;
    scored.push({ path: filing.path, title: titleOf(index, filing.path), place: placeOf(index, filing.path), confidence: filing.confidence,
      provisional: !!index.fields.get(filing.path)?.provisional, evidenceRef: filing.evidenceRef, date: filing.date });
  }
  scored.sort((a, b) => a.confidence! - b.confidence! || (b.date ?? "").localeCompare(a.date ?? ""));
  const older: PlacementReviewItem[] = [];
  for (const [path, fields] of index.fields) {
    if (!fields.provisional || seen.has(path) || !live(path) || checkedAt.has(path)) continue;
    older.push({ path, title: titleOf(index, path), place: placeOf(index, path), confidence: null, provisional: true, evidenceRef: null, date: null });
  }
  older.sort((a, b) => a.place.localeCompare(b.place) || a.title.localeCompare(b.title));
  const all = [...scored, ...older];
  const undone = new Set(records.filter((record) => record.action === "undo" && record.undoes).map((record) => record.undoes!));
  return {
    items: all.slice(0, Math.max(1, Math.min(200, options.limit ?? REVIEW_DEFAULT_LIMIT))),
    total: all.length,
    scored: scored.length,
    low: scored.filter((item) => item.confidence! < LOW_CONFIDENCE).length,
    checked: { confirmed: standing.filter((r) => r.action === "confirm").length, moved: standing.filter((r) => r.action === "move").length },
    recent: records.filter((record) => record.action === "move").reverse().slice(0, 5)
      .map((record) => ({ id: record.id, ts: record.ts, title: record.zenod_page, from: record.zenod_parent, to: record.moved_to ?? "", undone: undone.has(record.id) })),
  };
}

/** The Log entry a page was filed from, latest first: S6's note id for a correction. */
export async function latestNoteFor(vaultPath: string, path: string): Promise<{ noteId: string; confidence: number | null }> {
  const filing = (await readFilingConfidences(vaultPath)).find((item) => item.path === path);
  if (filing) return { noteId: filing.evidenceRef.split("#^e-")[1] ?? "", confidence: filing.confidence };
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
  const cited = [...raw.matchAll(/\[\[(\d{4}-\d{2}-\d{2})#\^e-([0-9a-f]+)\]\]/g)].map((match) => ({ date: match[1]!, id: match[2]! }));
  cited.sort((a, b) => b.date.localeCompare(a.date));
  return { noteId: cited[0]?.id ?? "", confidence: null };
}
