import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readLogCaptures } from "../vault/captureOrigin.js";
import { listMarkdownFiles, MEANING_FOLDERS, normalizeMarkdownNotePath } from "../vault/files.js";
import { parseNote } from "../vault/frontmatter.js";
import { CITATION_RE } from "../vault/pages.js";
import { isVoiceCapture } from "../vault/recentIntent.js";
import { buildTreeIndex, readTree } from "../vault/tree.js";
import { anchorNode, REJECTED_FOR_PAGE_RE, TrackedWrites, writeProvisionalLeaf } from "./treePlacement.js";

/**
 * E12-S20: every voice note linked to the topics it talks about. S3c round 2 found 21 of the
 * person's 72 voice notes cited by no topic page and 4 half filed: filings that stopped on a
 * rejected or failed reconcile before E12-S8, receipts archived unfiled by the tree migration,
 * and early Drive and WhatsApp notes from before topic filing ran on them.
 *
 * `planNoteLinks` only reads. For each of the person's voice notes it finds the points no page
 * holds: a point of its filing receipt (Inbox/ or Archive/Inbox/) that was never written, quoted
 * in the person's own words with the page the organiser chose for it; or, for a note no page cites
 * and no receipt split, the note itself. A note its filing kept as evidence only (a test recording)
 * has nothing to link. `applyNoteLinks` writes each point as a provisional leaf citing the note,
 * on the branch of its subject page when that page is in the tree (else under the top-level branch
 * it reads most like), exactly as live filing rescues a point (E12-S8, E12-S20); it never edits an existing page's words, the Log or receipts, and
 * leaves the commit to the caller.
 */
export interface NotePoint {
  /** The organiser's name for the point, or null for a whole note no filing split. */
  topic: string | null;
  /** The person's words for the point, verbatim (a whole note: its first words). */
  text: string;
  /** The pages the organiser chose for the point, strongest first: the leaf hangs on the branch of the first in the tree (none when the reconciler rejected them as another subject). */
  anchors: string[];
  reason: string;
}

export interface NoteLinkPlan {
  evidenceRef: string;
  /** Pages that already cite the note. */
  citedBy: string[];
  receipt: string | null;
  state: "unlinked" | "partial";
  points: NotePoint[];
}

export interface NoteLinksReport {
  voiceNotes: number;
  linked: number;
  unlinked: number;
  partial: number;
  /** Notes their filing kept as evidence only (test recordings): nothing to link. */
  evidenceOnly: string[];
  notes: NoteLinkPlan[];
}

const EXCERPT_CHARS = 700;
/** Ingest lines of a voice note (file name, artifact, transcriber), not the person's words. */
const INGEST_LINE_RE = /^(?:voice note "|raw artifact|original:|media type:|source:|source timestamp:|transcribed by\b|extraction artifact:|user context:)/i;

interface ReceiptPoint { topic: string; disposition: string | null; pages: string[]; quotes: string[]; spans: Array<{ start: number; end: number }>; status: string | null; filed: string[]; reason: string | null }
export interface ParsedReceipt { path: string; points: ReceiptPoint[]; evidenceOnly: boolean }

const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && !!item) : []);
const pagePaths = (list: unknown): string[] => (Array.isArray(list) ? list : [])
  .map((page) => (typeof page === "string" ? page : page && typeof page === "object" && typeof (page as { path?: unknown }).path === "string" ? (page as { path: string }).path : ""))
  .filter(Boolean).map(normalizeMarkdownNotePath);
const spansOf = (list: unknown) => (Array.isArray(list) ? list : [])
  .filter((span): span is { start: number; end: number } => !!span && typeof span === "object" && Number.isInteger((span as { start?: unknown }).start) && Number.isInteger((span as { end?: unknown }).end));

/** A filing receipt's points, in either form: the v1 receipt (classification + outcomes) or the older outcome list. */
export function receiptPoints(path: string, raw: string): ParsedReceipt | null {
  const body = /```json\n([\s\S]*?)\n```/.exec(raw)?.[1];
  if (!body) return null;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return null; }
  const points: ReceiptPoint[] = [];
  if (Array.isArray(value)) {
    for (const item of value as Array<Record<string, unknown>>) {
      if (!item || typeof item !== "object") continue;
      points.push({ topic: String(item.topic ?? ""), disposition: typeof item.disposition === "string" ? item.disposition : null, pages: pagePaths(item.pages),
        quotes: strings(item.evidenceQuotes), spans: spansOf(item.sourceSpans), status: typeof item.status === "string" ? item.status : null,
        filed: strings(item.filedPages).map(normalizeMarkdownNotePath), reason: typeof item.reason === "string" ? item.reason : null });
    }
    return { path, points, evidenceOnly: points.length > 0 && points.every((point) => point.disposition === "evidence_only") };
  }
  const record = value as { classification?: { disposition?: unknown; topics?: Array<Record<string, unknown>> }; outcomes?: Array<Record<string, unknown>> } | null;
  if (!record || typeof record !== "object") return null;
  const outcomes = Array.isArray(record.outcomes) ? record.outcomes : [];
  for (const topic of record.classification?.topics ?? []) {
    const outcome = outcomes.find((item) => item.ideaId && item.ideaId === topic.ideaId);
    const assignments = Array.isArray(topic.evidenceAssignments) ? topic.evidenceAssignments as Array<{ quote?: unknown }> : [];
    points.push({
      topic: String(topic.topic ?? ""), disposition: typeof topic.disposition === "string" ? topic.disposition : null,
      pages: [...new Set([...pagePaths(outcome?.reroutedFrom), ...pagePaths(topic.pages), ...pagePaths(outcome?.pages)])],
      quotes: [...strings(assignments.map((item) => item.quote)), ...strings(topic.evidenceQuotes)],
      spans: spansOf(outcome?.sourceSpans), status: typeof outcome?.status === "string" ? outcome.status : null,
      filed: [...strings(outcome?.filedPages), ...strings(outcome?.uncertainPages)].map(normalizeMarkdownNotePath),
      reason: typeof outcome?.reason === "string" ? outcome.reason : null,
    });
  }
  const evidenceOnly = record.classification?.disposition === "evidence_only"
    || (points.length > 0 && points.every((point) => point.disposition === "evidence_only"));
  return { path, points, evidenceOnly };
}

/** The person's words of a voice note, without its ingest lines. */
export function spokenText(content: string): string {
  return content.split("\n").filter((line) => !INGEST_LINE_RE.test(line.trim())).join("\n").trim();
}

/** Share of words two whole notes have in common (Jaccard) at which they are one recording. */
const SAME_RECORDING = 0.6;
const wordSet = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.max(1, a.size + b.size - shared);
}

/** The point's first words appear on the page, as its quote block or its own line. */
function quotedIn(raw: string, text: string): boolean {
  const first = text.trim().split("\n")[0]!.trim().slice(0, 80);
  if (!first) return false;
  const flat = (value: string) => value.replace(/^> ?/gm, "").replace(/\s+/g, " ");
  return flat(raw).includes(flat(first));
}

function excerpt(text: string): string {
  const flat = text.trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${stop > EXCERPT_CHARS / 2 ? cut.slice(0, stop + 1) : cut.trimEnd()} …`;
}

/** Plan the links (read only). `skip`: evidence refs to leave alone. */
export async function planNoteLinks(vaultPath: string, options: { skip?: ReadonlySet<string> } = {}): Promise<NoteLinksReport> {
  const files = await listMarkdownFiles(vaultPath);
  const captures = await readLogCaptures(vaultPath, files);
  const voice = [...captures.values()].filter((capture) => capture.origin === "user" && isVoiceCapture(capture.contentType, capture.title, capture.content));
  // Which pages cite each note (meaning pages only: receipts, the Log and the archive are not topics).
  const citedBy = new Map<string, Set<string>>();
  const receipts = new Map<string, ParsedReceipt>();
  for (const file of files) {
    const top = file.split("/")[0]!;
    if (top in MEANING_FOLDERS && top !== "Archive") {
      const raw = await readFile(join(vaultPath, file), "utf8").catch(() => "");
      for (const match of raw.matchAll(CITATION_RE)) {
        const key = `${match[1]}#^${match[2]}`;
        if (!citedBy.has(key)) citedBy.set(key, new Set());
        citedBy.get(key)!.add(file);
      }
    } else if (/^(?:Inbox|Archive\/Inbox)\/(?:needs-)?filing-/.test(file)) {
      const raw = await readFile(join(vaultPath, file), "utf8").catch(() => "");
      const evidence = parseNote(raw).frontmatter?.evidence;
      const ref = typeof evidence === "string" ? evidence : null;
      const parsed = ref ? receiptPoints(file, raw) : null;
      // The Inbox copy is the live one; an archived copy stands in only when there is none.
      if (ref && parsed && (!receipts.has(ref) || file.startsWith("Inbox/"))) receipts.set(ref, parsed);
    }
  }
  const report: NoteLinksReport = { voiceNotes: voice.length, linked: 0, unlinked: 0, partial: 0, evidenceOnly: [], notes: [] };
  for (const capture of voice.sort((a, b) => a.key.localeCompare(b.key))) {
    const evidenceRef = `Log/${capture.date}.md#^${capture.anchor}`;
    const cited = [...(citedBy.get(capture.key) ?? [])].sort();
    const receipt = receipts.get(evidenceRef) ?? null;
    if (options.skip?.has(evidenceRef)) { if (cited.length) report.linked++; continue; }
    if (!cited.length && receipt?.evidenceOnly) { report.evidenceOnly.push(evidenceRef); continue; }
    // A point whose words a citing page already holds is written (a leaf this tool or the sweep made).
    const held = await Promise.all(cited.map((file) => readFile(join(vaultPath, file), "utf8").catch(() => "")));
    const points = (receipt ? unwrittenPoints(capture.content, receipt, new Set(cited)) : [])
      .filter((point) => !held.some((raw) => quotedIn(raw, point.text)));
    if (!cited.length && !points.length) {
      const words = spokenText(capture.content);
      if (words) points.push({ topic: null, text: excerpt(words), anchors: [], reason: receipt ? "filing wrote no page" : "never filed" });
    }
    if (!points.length) { report.linked++; continue; }
    const state = cited.length ? "partial" : "unlinked";
    report[state]++;
    report.notes.push({ evidenceRef, citedBy: cited, receipt: receipt?.path ?? null, state, points });
  }
  return report;
}

/** Points of a receipt no page holds: not filed, not kept as evidence, with the person's words to quote. */
export function unwrittenPoints(content: string, receipt: ParsedReceipt, cited: ReadonlySet<string> = new Set()): NotePoint[] {
  const out: NotePoint[] = [];
  for (const point of receipt.points) {
    if (point.disposition === "evidence_only" || point.status === "filed") continue;
    if (point.filed.some((page) => cited.has(page))) continue;
    const text = point.quotes.length ? point.quotes.join("\n\n")
      : point.spans.map((span) => content.slice(span.start, span.end)).filter((part) => part.trim()).join("\n\n");
    if (!text.trim()) continue;
    const reason = point.reason ?? point.status ?? "not written";
    // A page the reconciler rejected as another subject is no anchor (the same rule as live filing).
    out.push({ topic: point.topic || null, text: text.trim(), anchors: REJECTED_FOR_PAGE_RE.test(reason) ? [] : point.pages, reason });
  }
  return out;
}

export interface AppliedNoteLink { evidenceRef: string; topic: string | null; leaf: string; parent: string; anchored: boolean }

/**
 * Write the planned points as provisional leaves (uncommitted). Needs a Tree.md. Notes no page cites
 * only, unless `partial`: a half-filed note is already linked to its topics, and its dropped points
 * can be many (an old filing split a long note into a dozen), so linking them is a separate choice.
 */
export async function applyNoteLinks(vaultPath: string, report: NoteLinksReport, today: string,
  options: { partial?: boolean; writes?: TrackedWrites } = {}): Promise<AppliedNoteLink[]> {
  if (!(await readTree(vaultPath))) throw new Error("note_links_need_tree");
  const writes = options.writes ?? new TrackedWrites(vaultPath);
  const out: AppliedNoteLink[] = [];
  // The same recording ingested twice (a Drive re-upload, transcribed a little differently) shares one leaf.
  const wholeNotes: Array<{ words: Set<string>; title: string }> = [];
  for (const note of report.notes) {
    if (note.state === "partial" && !options.partial) continue;
    for (const point of note.points) {
      const index = await buildTreeIndex(vaultPath);
      const anchored = anchorNode(index, point.anchors) !== null;
      let title = point.topic;
      if (!title) {
        const words = wordSet(point.text);
        title = wholeNotes.find((seen) => overlap(seen.words, words) >= SAME_RECORDING)?.title ?? point.text;
        if (title === point.text) wholeNotes.push({ words, title });
      }
      const leaf = await writeProvisionalLeaf(vaultPath, index, {
        title, content: point.text, evidenceRef: note.evidenceRef,
        reason: `linked when its filing was repaired (${point.reason})`, today,
      }, writes, { anchors: point.anchors, rootsOnly: true });
      if (!leaf) continue;
      out.push({ evidenceRef: note.evidenceRef, topic: point.topic, leaf: leaf.path, parent: leaf.parent, anchored });
    }
  }
  return out;
}
