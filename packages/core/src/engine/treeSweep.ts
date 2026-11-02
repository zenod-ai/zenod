import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf, isFilingReceiptPath, tierOf } from "../vault/files.js";
import type { FileChange } from "../vault/immutability.js";
import { CITATION_RE as LOG_CITATION_RE, scanVault } from "../vault/pages.js";
import { buildTreeIndex, readTree, type TreeIndex } from "../vault/tree.js";
import { lintTreeIndex } from "../vault/treeLint.js";
import { lintVault } from "../vault/lint.js";
import { getEvidenceEntry } from "./evidence.js";
import { applyTreeDiscovery, discoverTree, type DiscoveredRoot } from "./treeDiscover.js";
import { readLogCaptures } from "../vault/captureOrigin.js";
import {
  appendOpsRollup,
  chooseTreeNode,
  citeOnLeaf,
  FILED_PREFIX,
  isAgentOpsReport,
  OPS_ROLLUP_HEADING,
  parseFiledLines,
  TrackedWrites,
  withParent,
  writeProvisionalLeaf,
} from "./treePlacement.js";

/**
 * The weekly tree sweep (EPIC-9 E9-2d; audit §4–§5 rule 7; the "compactor" in
 * docs/LIBRARIAN-DOCTRINE.md). It keeps a vault's memory tree tidy without
 * deciding anything for the person:
 *
 * - a working-memory root with no capture in `staleDays` gets ONE proposal line
 *   (keep, close, or fold); the sweep never moves a root;
 * - a pending filing receipt (`Inbox/filing-…`, `Inbox/needs-filing-…`) is re-filed
 *   under the right node with E9-2b's placement, then moved to `Archive/Inbox/`;
 * - a provisional leaf made only of agent reports (a test-campaign or wake report the
 *   librarian's filter missed before E9-2h) becomes ops-rollup lines on its root, and
 *   the leaf itself moves to `Archive/Agent reports/` byte for byte;
 * - a Log entry cited only by a level-1 root (outside its ops rollup) is also cited
 *   on the deepest page under that root that matches it (E9-2f), so lineage reaches
 *   the leaf; the root keeps its citation;
 * - the roots are re-derived from the pages' content and the person's own recent
 *   captures (E9-2g, treeDiscover.ts): Tree.md is rewritten, `parent:`/`memory:`
 *   lines follow; topics move between working and long-term with hysteresis;
 * - pages sharing a title get a merge proposal line; nothing is merged;
 * - tree lint must not get worse.
 *
 * Safety (E9-A2, "raw data stays safe"): nothing is deleted (a receipt is copied to
 * Archive/ byte for byte before its Inbox copy is removed), Log/ and _attachments/
 * are never written, and the caller commits all changes as one revision.
 * Writes stay uncommitted; on any error the caller reverts them.
 */

export const TREE_SWEEP_REPORT_PATH = "Inbox/Tree sweep.md";
export const ARCHIVE_INBOX_DIR = "Archive/Inbox";
/** Where the sweep keeps a leaf that only ever held agent reports (E9-2h): out of the tree, never deleted. */
export const ARCHIVE_AGENT_LEAVES_DIR = "Archive/Agent reports";
export const DEFAULT_STALE_DAYS = 30;
/** A receipt younger than this may still be settling through its own retry; leave it alone. */
export const DEFAULT_RECEIPT_MIN_AGE_DAYS = 2;

export interface TreeSweepOptions {
  /** YYYY-MM-DD, the sweep's day. */
  today: string;
  staleDays?: number;
  receiptMinAgeDays?: number;
  /** Evidence refs with a filing job still queued or running: their receipts are skipped. */
  skipEvidenceRefs?: ReadonlySet<string>;
  /** Re-derive the roots (E9-2g). Default true. */
  discover?: boolean;
}

export interface StaleRoot {
  name: string;
  path: string;
  /** Latest capture date anywhere under the root (YYYY-MM-DD), or null when none was found. */
  lastCapture: string | null;
  days: number | null;
}

export interface DuplicateProposal {
  title: string;
  keep: string;
  fold: string[];
}

/** A Log entry only a root cited, now also cited on a deeper page (E9-2f). */
export interface DeepenedCitation {
  evidenceRef: string;
  root: string;
  leaf: string;
}

export type ReceiptOutcome = "refiled" | "archived" | "skipped";

export interface ReceiptResult {
  path: string;
  outcome: ReceiptOutcome;
  reason: string;
  /** Pages the capture now hangs on (re-filed or already filed). */
  pages?: string[];
  archivedTo?: string;
}

export interface TreeSweepCounts {
  workingRoots: number;
  staleRoots: number;
  receiptsSeen: number;
  receiptsRefiled: number;
  receiptsArchived: number;
  receiptsSkipped: number;
  /** Log entries cited only by level-1 roots before this sweep (ops rollups excluded). */
  rootOnlyCitations: number;
  /** Of those, how many are now also cited on a deeper page. */
  citationsDeepened: number;
  duplicateGroups: number;
  proposals: number;
  filesChanged: number;
  treeLintErrorsBefore: number;
  treeLintErrorsAfter: number;
  /** E9-2g: roots after re-deriving them (0 when discovery did not run). */
  discoveredWorking?: number;
  discoveredLongTerm?: number;
  /** Roots that were not in Tree.md (same name and group) before this sweep. */
  rootsNew?: number;
  /** Tree pages whose `parent:` or `memory:` changed. */
  pagesReparented?: number;
  /** Provisional leaves made only of agent reports, now ops-rollup lines (E9-2h). */
  agentLeavesRefiled?: number;
}

export interface TreeSweepReport {
  hasTree: boolean;
  today: string;
  staleDays: number;
  counts: TreeSweepCounts;
  /** Private to the user's vault/console: never copied to public evidence. */
  staleRoots: StaleRoot[];
  duplicates: DuplicateProposal[];
  receipts: ReceiptResult[];
  deepened: DeepenedCitation[];
  /** E9-2g roots after this sweep; private to the user's vault/console. */
  roots: DiscoveredRoot[];
  /** Vault paths written or removed by this sweep (uncommitted). */
  changedPaths: string[];
  /**
   * `path|rule|message` of every `zenod lint` error the vault had before this sweep
   * wrote anything: the caller rejects only errors the sweep introduced.
   */
  lintErrorsBefore: string[];
}

/** One `zenod lint` error as a comparable key. */
export const lintErrorKey = (error: { path: string; rule: string; message: string }) => `${error.path}|${error.rule}|${error.message}`;

/** Discovery runs to a fixed point (its parent edges feed the next pass); a pass that writes nothing ends it. */
const MAX_DISCOVERY_PASSES = 3;

export async function rediscoverTree(vaultPath: string, today: string, writes: TrackedWrites, fresh = false): Promise<{ roots: DiscoveredRoot[]; changed: string[]; rootsNew: number } | null> {
  const before = new Set((await readTree(vaultPath))?.nodes.map(n => `${n.name}|${n.kind}`) ?? []);
  let roots: DiscoveredRoot[] | null = null;
  const changed = new Set<string>();
  for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
    // `fresh` applies to the first pass only; later passes continue what it wrote.
    const plan = await discoverTree(vaultPath, { today, ...(fresh && pass === 0 ? { fresh: true } : {}) });
    if (!plan) return null;
    roots = plan.roots;
    const written = await applyTreeDiscovery(vaultPath, plan, writes);
    for (const path of written) changed.add(path);
    if (!written.length) break;
  }
  return roots ? { roots, changed: [...changed].sort(), rootsNew: roots.filter(r => !before.has(`${r.name}|${r.kind}`)).length } : null;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Body without the `## Ops rollup` section: ops traffic never makes a node look ongoing (rule 5). */
function withoutOpsRollup(body: string): string {
  const start = body.indexOf(`\n${OPS_ROLLUP_HEADING}\n`);
  if (start < 0) return body;
  const rest = body.slice(start + OPS_ROLLUP_HEADING.length + 2);
  const next = rest.search(/^## /m);
  return body.slice(0, start) + (next < 0 ? "" : `\n${rest.slice(next)}`);
}

const CITATION_RE = /(?:\[\[|Log\/)(\d{4}-\d{2}-\d{2})(?:\.md)?#\^e-[0-9a-f]+/g;

/** Latest Log date a page cites, outside its ops rollup; falls back to `created:` when it cites nothing. */
async function pageLastCapture(vaultPath: string, path: string): Promise<string | null> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
  const { frontmatter, body } = parseNote(raw);
  let latest: string | null = null;
  for (const match of withoutOpsRollup(body).matchAll(CITATION_RE)) latest = maxDate(latest, match[1]!);
  if (latest) return latest;
  const created = frontmatter?.created;
  return typeof created === "string" && DATE_RE.test(created.trim()) ? created.trim() : null;
}

/** Latest `filed:` date per page across the Log (rule 6 lines), ops rollups excluded. */
async function filedDates(vaultPath: string, files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of files) {
    const match = /^Log\/(\d{4}-\d{2}-\d{2})\.md$/.exec(file);
    if (!match) continue;
    const raw = await readFile(join(vaultPath, file), "utf8").catch(() => "");
    if (!raw.includes(FILED_PREFIX)) continue;
    for (const line of raw.split("\n")) {
      if (!line.startsWith(FILED_PREFIX) || line.includes("· ops rollup")) continue;
      const link = /\[\[([^\]|#]+)/.exec(line)?.[1];
      if (!link) continue;
      const page = `${link.replace(/\.md$/, "")}.md`;
      out.set(page, maxDate(out.get(page) ?? null, match[1]!)!);
    }
  }
  return out;
}

function subtree(index: TreeIndex, root: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    queue.push(...index.children(path));
  }
  return out;
}

/** Working roots whose whole subtree has had no capture for `staleDays`. */
export async function findStaleRoots(vaultPath: string, index: TreeIndex, files: string[], today: string, staleDays: number): Promise<{ working: number; stale: StaleRoot[] }> {
  const filed = await filedDates(vaultPath, files);
  const stale: StaleRoot[] = [];
  let working = 0;
  for (const node of index.tree?.nodes ?? []) {
    if (node.kind !== "working") continue;
    working++;
    const rootPath = index.resolveRef(node.path);
    if (!rootPath || !index.fields.has(rootPath)) continue;
    let last: string | null = null;
    for (const path of subtree(index, rootPath)) {
      last = maxDate(last, await pageLastCapture(vaultPath, path));
      last = maxDate(last, filed.get(path) ?? null);
    }
    const days = last ? daysBetween(last, today) : null;
    if (days === null || days >= staleDays) stale.push({ name: node.name, path: rootPath, lastCapture: last, days });
  }
  return { working, stale };
}

function normalizedTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Groups of tree pages sharing a title; keeps the placed, shallowest page and proposes folding the rest into it. */
export function findDuplicateTitles(index: TreeIndex): DuplicateProposal[] {
  const groups = new Map<string, string[]>();
  for (const [path, fields] of index.fields) {
    const key = normalizedTitle(fields.title);
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  const out: DuplicateProposal[] = [];
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    const rank = (path: string) => {
      const lineage = index.lineage(path);
      return [index.rootsByPath.has(path.toLowerCase()) ? 0 : 1, lineage.ok ? 0 : 1, path.split("/").length, path.length] as const;
    };
    const sorted = [...paths].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
      return a.localeCompare(b);
    });
    out.push({ title: index.fields.get(sorted[0]!)!.title, keep: sorted[0]!, fold: sorted.slice(1) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

const isPendingReceiptPath = (path: string) => isFilingReceiptPath(path) || /^Inbox\/needs-filing-[^/]+\.md$/.test(path);

interface ParsedReceipt {
  evidenceRef: string | null;
  pages: string[];
  pending: boolean;
  prepared: boolean;
  reason: string;
}

function parseReceipt(path: string, raw: string): ParsedReceipt {
  const { frontmatter } = parseNote(raw);
  let evidenceRef = typeof frontmatter?.evidence === "string" ? frontmatter.evidence : null;
  if (!evidenceRef) {
    const match = /^Inbox\/filing-(\d{4}-\d{2}-\d{2})-(e-[0-9a-f]+)\.md$/.exec(path);
    if (match) evidenceRef = `Log/${match[1]}.md#^${match[2]}`;
  }
  const pages = new Set<string>();
  let pending = false;
  let prepared = false;
  let reason = typeof frontmatter?.question === "string" ? `needs filing: ${frontmatter.question}` : "filing uncertain";
  const json = /```json\n([\s\S]*?)\n```/.exec(raw)?.[1];
  if (json) {
    try {
      const value = JSON.parse(json) as unknown;
      const record = value && typeof value === "object" && !Array.isArray(value) ? value as { phase?: unknown; outcomes?: unknown } : null;
      if (record?.phase === "prepared") prepared = true;
      const outcomes = Array.isArray(value) ? value : Array.isArray(record?.outcomes) ? record!.outcomes as unknown[] : [];
      for (const outcome of outcomes) {
        if (!outcome || typeof outcome !== "object") continue;
        const o = outcome as { status?: unknown; reason?: unknown; filedPages?: unknown; uncertainPages?: unknown };
        if (o.status === "pending") pending = true;
        if (typeof o.reason === "string" && o.reason) reason = o.reason;
        for (const list of [o.filedPages, o.uncertainPages]) {
          if (Array.isArray(list)) for (const page of list) if (typeof page === "string") pages.add(page);
        }
      }
    } catch { /* an unreadable record is re-filed from its Log entry */ }
  }
  return { evidenceRef, pages: [...pages], pending, prepared, reason };
}

/** Free Archive path for a file: same name, or `-2`, `-3`… when another file already holds it. */
async function archivePath(vaultPath: string, path: string, dir = ARCHIVE_INBOX_DIR): Promise<string> {
  const base = basenameOf(path);
  for (let n = 1; ; n++) {
    const candidate = `${dir}/${n === 1 ? base : `${base}-${n}`}.md`;
    if ((await readFile(join(vaultPath, candidate), "utf8").catch(() => null)) === null) return candidate;
  }
}

/** Move a file to Archive/: copy byte for byte first, then remove the original. Never a bare delete. */
async function archiveReceipt(vaultPath: string, path: string, raw: string, writes: TrackedWrites, dir = ARCHIVE_INBOX_DIR): Promise<string> {
  const target = await archivePath(vaultPath, path, dir);
  await writes.write(target, raw);
  if ((await readFile(join(vaultPath, target), "utf8")) !== raw) throw new Error(`tree_sweep_archive_mismatch: ${path}`);
  await writes.remove(path);
  return target;
}

async function sweepReceipt(
  vaultPath: string,
  path: string,
  options: Required<Pick<TreeSweepOptions, "today" | "receiptMinAgeDays">> & { skip: ReadonlySet<string> },
  writes: TrackedWrites,
): Promise<ReceiptResult> {
  const raw = await readFile(join(vaultPath, path), "utf8");
  const receipt = parseReceipt(path, raw);
  const ref = receipt.evidenceRef;
  const refMatch = ref ? /^Log\/(\d{4}-\d{2}-\d{2})\.md#\^(e-[0-9a-f]+)$/.exec(ref) : null;
  if (!ref || !refMatch) return { path, outcome: "skipped", reason: "no evidence ref" };
  if (options.skip.has(ref)) return { path, outcome: "skipped", reason: "filing job still queued or running" };
  if (receipt.prepared) return { path, outcome: "skipped", reason: "prepared filing awaiting recovery" };
  if (daysBetween(refMatch[1]!, options.today) < options.receiptMinAgeDays) return { path, outcome: "skipped", reason: "too recent" };

  const logRaw = await readFile(join(vaultPath, `Log/${refMatch[1]}.md`), "utf8").catch(() => null);
  const filed = logRaw ? parseFiledLines(logRaw, refMatch[2]!) : [];
  const filedPages = filed.map(line => /^\[\[([^\]|#]+)/.exec(line)?.[1]).filter((p): p is string => !!p).map(p => `${p.replace(/\.md$/, "")}.md`);

  let index = await buildTreeIndex(vaultPath);
  const existing = [...new Set([...filedPages, ...receipt.pages])].filter(page => index.fields.has(page));
  if (existing.length) {
    // Already on a page: make sure each page hangs under the tree, then archive the receipt.
    let placed = 0;
    for (const page of existing) {
      if (index.lineage(page).ok) continue;
      const choice = await chooseTreeNode(vaultPath, index, `${index.fields.get(page)!.title} ${basenameOf(page)}`, { exclude: new Set([page]) });
      if (!choice) continue;
      const pageRaw = await readFile(join(vaultPath, page), "utf8");
      await writes.write(page, withParent(pageRaw, choice.path, choice.weak));
      placed++;
      index = await buildTreeIndex(vaultPath);
    }
    const archivedTo = await archiveReceipt(vaultPath, path, raw, writes);
    return placed
      ? { path, outcome: "refiled", reason: "page placed under the tree", pages: existing, archivedTo }
      : { path, outcome: "archived", reason: "capture already on a placed page", pages: existing, archivedTo };
  }

  if (receipt.pending && daysBetween(refMatch[1]!, options.today) < 7) {
    return { path, outcome: "skipped", reason: "filing still pending" };
  }
  const entry = logRaw ? await getEvidenceEntry(vaultPath, ref).catch(() => null) : null;
  if (!entry) {
    const archivedTo = await archiveReceipt(vaultPath, path, raw, writes);
    return { path, outcome: "archived", reason: "Log entry not found; receipt kept in Archive", archivedTo };
  }
  const leaf = await writeProvisionalLeaf(vaultPath, index, { content: entry.content, evidenceRef: ref, reason: receipt.reason, today: options.today }, writes);
  if (!leaf) return { path, outcome: "skipped", reason: "no node to place under" };
  const archivedTo = await archiveReceipt(vaultPath, path, raw, writes);
  return { path, outcome: "refiled", reason: "provisional leaf under the closest node", pages: [leaf.path], archivedTo };
}

export interface RefiledAgentLeaf {
  path: string;
  archivedTo: string;
  /** Pages that now carry the leaf's reports as ops-rollup lines. */
  rollups: string[];
}

/**
 * E9-2h: a provisional leaf whose every citation is an agent report (captureOrigin
 * "agent") was a filing the librarian's ops filter missed. Each report becomes a dated
 * ops-rollup line on the root it reads most like (rule 5), and the leaf moves to
 * `Archive/Agent reports/` byte for byte. Leaves with children, roots and any page
 * citing one of the person's own captures stay where they are. The Log is untouched.
 */
export async function refileAgentLeaves(vaultPath: string, writes: TrackedWrites): Promise<RefiledAgentLeaf[]> {
  const snapshot = await scanVault(vaultPath);
  let index = await buildTreeIndex(vaultPath, snapshot);
  const captures = await readLogCaptures(vaultPath, snapshot.files);
  const out: RefiledAgentLeaf[] = [];
  for (const [path, fields] of [...index.fields].sort(([a], [b]) => a.localeCompare(b))) {
    if (!fields.provisional || index.rootsByPath.has(path.toLowerCase()) || index.children(path).length) continue;
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
    if (raw === null) continue;
    const refs = [...new Set([...parseNote(raw).body.matchAll(LOG_CITATION_RE)].map(m => `${m[1]}#^${m[2]}`))];
    if (!refs.length || !refs.every(ref => captures.get(ref)?.origin === "agent")) continue;
    const rollups = new Set<string>();
    for (const ref of refs) {
      const capture = captures.get(ref)!;
      const page = await appendOpsRollup(vaultPath, index, { content: capture.content, evidenceRef: `Log/${capture.date}.md#^${capture.anchor}` }, writes);
      if (page) rollups.add(page);
    }
    if (!rollups.size) continue;
    const archivedTo = await archiveReceipt(vaultPath, path, raw, writes, ARCHIVE_AGENT_LEAVES_DIR);
    out.push({ path, archivedTo, rollups: [...rollups] });
    index = await buildTreeIndex(vaultPath);
  }
  return out;
}

/**
 * E9-2f: Log entries that only level-1 roots cite (the E9-2c clean-up's re-filed
 * lines, or a filing that reached only a root) are also cited on the deepest page
 * under that root that matches them, with E9-2b's placement walk. Ops rollups stay
 * on the root (rule 5); no citation is removed; entries no deeper page fits stay as they are.
 */
export async function deepenRootCitations(vaultPath: string, writes: TrackedWrites): Promise<{ rootOnly: number; deepened: DeepenedCitation[] }> {
  const index = await buildTreeIndex(vaultPath);
  const belowRoot = new Set<string>();
  const atRoot = new Map<string, Array<{ root: string; line: string }>>();
  for (const path of index.fields.keys()) {
    if (!index.lineage(path).ok) continue;
    const isRoot = index.rootsByPath.has(path.toLowerCase());
    const { body } = parseNote(await readFile(join(vaultPath, path), "utf8").catch(() => ""));
    for (const line of (isRoot ? withoutOpsRollup(body) : body).split("\n")) {
      for (const match of line.matchAll(LOG_CITATION_RE)) {
        const ref = `Log/${match[1]}.md#^${match[2]}`;
        if (!isRoot) { belowRoot.add(ref); continue; }
        const sites = atRoot.get(ref) ?? [];
        if (!sites.some(site => site.root === path)) sites.push({ root: path, line });
        atRoot.set(ref, sites);
      }
    }
  }
  let rootOnly = 0;
  const deepened: DeepenedCitation[] = [];
  for (const [ref, sites] of atRoot) {
    if (belowRoot.has(ref)) continue;
    rootOnly++;
    const entry = await getEvidenceEntry(vaultPath, ref).catch(() => null);
    // Agent ops reports belong on the root (rule 5), however they got there.
    if (entry && isAgentOpsReport(entry.content, entry.source)) continue;
    for (const site of sites) {
      // `- 2026-06-12 · Some capture… [[2026-06-12#^e-…]]` → `Some capture…`
      const summary = site.line.replace(LOG_CITATION_RE, "").replace(/\(\s*\)/g, "").replace(/^\s*[-*]\s*(?:\d{4}-\d{2}-\d{2}\s*·\s*)?/, "").trim()
        || (entry?.content ?? "");
      const leaf = await citeOnLeaf(vaultPath, index, { rootPath: site.root, evidenceRef: ref, text: summary, summary }, writes);
      if (leaf) { deepened.push({ evidenceRef: ref, root: site.root, leaf }); break; }
    }
  }
  return { rootOnly, deepened };
}

/** The vault page that carries the sweep's proposals; null when there is nothing to propose and no page yet. */
export function renderSweepReport(report: Pick<TreeSweepReport, "staleRoots" | "duplicates" | "staleDays">): string {
  const lines = [
    "---",
    "title: Tree sweep",
    "status: tree-sweep",
    "---",
    "",
    "# Tree sweep",
    "",
    "Proposals from Zenod's weekly memory sweep. Nothing here has been moved or merged: each line waits for your call. Say it in chat (for example \"close House decision\") or edit the tree yourself.",
    "",
    `## Working roots with no capture in ${report.staleDays} days`,
    "",
  ];
  if (!report.staleRoots.length) lines.push("None.");
  for (const root of report.staleRoots) {
    const since = root.lastCapture ? `no capture since ${root.lastCapture}` : "no capture found";
    lines.push(`- Close "${root.name}"? ${since}. Keep it, close it (one Outcome line, then it moves under Long-term memory), or fold it into another root. [[${root.path.replace(/\.md$/, "")}]]`);
  }
  lines.push("", "## Pages with the same title", "");
  if (!report.duplicates.length) lines.push("None.");
  for (const dup of report.duplicates) {
    lines.push(`- Merge "${dup.title}"? Keep [[${dup.keep.replace(/\.md$/, "")}]] and fold in ${dup.fold.map(p => `[[${p.replace(/\.md$/, "")}]]`).join(", ")}.`);
  }
  // Static on purpose: a sweep with nothing new to say leaves this page (and the vault) unchanged.
  lines.push("", "## Filing receipts", "", `Leftover filing receipts are re-filed under the tree, then kept under ${ARCHIVE_INBOX_DIR}/ (never deleted). Each sweep's counts are in its vault commit message.`, "");
  return lines.join("\n");
}

/**
 * Run one sweep over a vault working tree. Writes go through `writes` and stay
 * uncommitted; throws (after which the caller reverts) when the sweep would leave
 * tree lint worse than it found it.
 */
export async function runTreeSweep(vaultPath: string, options: TreeSweepOptions, writes: TrackedWrites = new TrackedWrites(vaultPath)): Promise<TreeSweepReport> {
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;
  const receiptMinAgeDays = options.receiptMinAgeDays ?? DEFAULT_RECEIPT_MIN_AGE_DAYS;
  const empty: TreeSweepCounts = {
    workingRoots: 0, staleRoots: 0, receiptsSeen: 0, receiptsRefiled: 0, receiptsArchived: 0, receiptsSkipped: 0,
    rootOnlyCitations: 0, citationsDeepened: 0, duplicateGroups: 0, proposals: 0, filesChanged: 0, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0,
  };
  if (!(await readTree(vaultPath))) {
    return { hasTree: false, today: options.today, staleDays, counts: empty, staleRoots: [], duplicates: [], receipts: [], deepened: [], roots: [], changedPaths: [], lintErrorsBefore: [] };
  }
  const lintErrorsBefore = (await lintVault(vaultPath)).errors.map(lintErrorKey);

  const before = await scanVault(vaultPath);
  const lintBefore = lintTreeIndex(await buildTreeIndex(vaultPath, before), before.files);
  const errorsBefore = lintBefore.issues.filter(issue => issue.severity === "error").length;

  const receipts: ReceiptResult[] = [];
  for (const path of before.files.filter(isPendingReceiptPath)) {
    receipts.push(await sweepReceipt(vaultPath, path, { today: options.today, receiptMinAgeDays, skip: options.skipEvidenceRefs ?? new Set() }, writes));
  }

  const agentLeaves = await refileAgentLeaves(vaultPath, writes);
  const { rootOnly, deepened } = await deepenRootCitations(vaultPath, writes);
  const discovery = options.discover === false ? null : await rediscoverTree(vaultPath, options.today, writes);

  const snapshot = await scanVault(vaultPath);
  const index = await buildTreeIndex(vaultPath, snapshot);
  const { working, stale } = await findStaleRoots(vaultPath, index, snapshot.files, options.today, staleDays);
  const duplicates = findDuplicateTitles(index);
  const refiled = receipts.filter(r => r.outcome === "refiled").length;
  const archived = receipts.filter(r => r.outcome === "archived").length;

  const existingReport = await readFile(join(vaultPath, TREE_SWEEP_REPORT_PATH), "utf8").catch(() => null);
  const nextReport = renderSweepReport({ staleRoots: stale, duplicates, staleDays });
  // Write the proposals page when there is something to propose, or to update one that exists.
  if ((existingReport !== null || stale.length || duplicates.length) && existingReport !== nextReport) {
    await writes.write(TREE_SWEEP_REPORT_PATH, nextReport);
  }

  const after = await scanVault(vaultPath);
  const lintAfter = lintTreeIndex(await buildTreeIndex(vaultPath, after), after.files);
  const errorsAfter = lintAfter.issues.filter(issue => issue.severity === "error").length;
  const changedPaths = writes.paths;
  const touchedErrors = lintAfter.issues.filter(issue => issue.severity === "error" && changedPaths.includes(issue.path));
  if (errorsAfter > errorsBefore || touchedErrors.length) {
    throw new Error(`tree_sweep_lint_regression: ${errorsBefore} → ${errorsAfter} tree lint errors; ${touchedErrors.map(i => `${i.path} [${i.rule}]`).join("; ")}`);
  }

  return {
    hasTree: true,
    today: options.today,
    staleDays,
    counts: {
      workingRoots: working,
      staleRoots: stale.length,
      receiptsSeen: receipts.length,
      receiptsRefiled: refiled,
      receiptsArchived: archived,
      receiptsSkipped: receipts.filter(r => r.outcome === "skipped").length,
      rootOnlyCitations: rootOnly,
      citationsDeepened: deepened.length,
      duplicateGroups: duplicates.length,
      proposals: stale.length + duplicates.length,
      filesChanged: changedPaths.length,
      treeLintErrorsBefore: errorsBefore,
      treeLintErrorsAfter: errorsAfter,
      ...(discovery ? {
        discoveredWorking: discovery.roots.filter(r => r.kind === "working").length,
        discoveredLongTerm: discovery.roots.filter(r => r.kind === "long-term").length,
        rootsNew: discovery.rootsNew,
        pagesReparented: discovery.changed.filter(p => p !== "Tree.md").length,
      } : {}),
      agentLeavesRefiled: agentLeaves.length,
    },
    staleRoots: stale,
    duplicates,
    receipts,
    deepened,
    roots: discovery?.roots ?? [],
    changedPaths,
    lintErrorsBefore,
  };
}

/**
 * The sweep's raw-data guard over the pending changes it is about to commit:
 * no write under Log/ or _attachments/, and every removed file is an Inbox
 * receipt whose exact bytes now sit under Archive/Inbox/, or an agent-report leaf
 * (a meaning page) whose exact bytes now sit under Archive/Agent reports/.
 */
export function assertSweepChangesSafe(changes: FileChange[]): void {
  for (const change of changes) {
    if (tierOf(change.path) === "evidence") throw new Error(`tree_sweep_touched_evidence: ${change.path}`);
    if (change.after !== null) continue;
    const copiedTo = (dir: string) => changes.some(other => other.path.startsWith(`${dir}/`) && other.after === change.before);
    const receipt = isPendingReceiptPath(change.path) && copiedTo(ARCHIVE_INBOX_DIR);
    const agentLeaf = tierOf(change.path) === "meaning" && copiedTo(ARCHIVE_AGENT_LEAVES_DIR);
    if (!receipt && !agentLeaf) throw new Error(`tree_sweep_delete_refused: ${change.path}`);
  }
}
