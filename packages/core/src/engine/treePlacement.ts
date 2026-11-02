import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf, MEANING_FOLDERS, tierOf } from "../vault/files.js";
import { scanVault } from "../vault/pages.js";
import {
  buildTreeIndex,
  formatLineage,
  isTreePage,
  PARENT_FIELD,
  readTree,
  type TreeIndex,
} from "../vault/tree.js";
import { lintTreeIndex, type TreeLintIssue } from "../vault/treeLint.js";
import { entryHeading } from "./evidence.js";
import { isPersonSource, readsAsAgentReport } from "../vault/captureOrigin.js";

/**
 * Tree placement (EPIC-9 E9-2b; audit §5 filing rules 2–6, docs/LIBRARIAN-DOCTRINE.md
 * "Memory tree"). Runs after the librarian has filed a capture:
 *
 * - rule 2/4: every meaning page the capture touched hangs under a parent; a page
 *   without a resolvable lineage gets the best-matching node as `parent:`, marked
 *   `provisional: true` when the match is weak; a capture that reached no page
 *   becomes a provisional leaf under the closest node; a capture that reached only
 *   level-1 roots is also cited on the deepest matching page below them (E9-2f);
 * - rule 5: agent ops reports become one dated rollup line on their project node;
 * - rule 6: the Log entry gets `- filed: [[page]] (Working › Node › Page)` (or
 *   `- filed: log only (reason)`), appended so the Log stays append-only.
 *
 * Everything that changes the tree is gated on the vault having a `Tree.md`;
 * a tree-less vault only gains the `filed:` line.
 */

export const FILED_PREFIX = "- filed";

/** Records each file's bytes before its first write so a failed placement can be undone without touching the filing. */
export class TrackedWrites {
  private readonly originals = new Map<string, string | null>();
  constructor(private readonly vaultPath: string) {}
  async write(path: string, content: string): Promise<void> {
    const absolute = join(this.vaultPath, path);
    if (!this.originals.has(path)) this.originals.set(path, await readFile(absolute, "utf8").catch(() => null));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  /** Remove a file, keeping its bytes so revert() can restore it (the sweep only removes after copying to Archive/). */
  async remove(path: string): Promise<void> {
    const absolute = join(this.vaultPath, path);
    if (!this.originals.has(path)) this.originals.set(path, await readFile(absolute, "utf8").catch(() => null));
    await rm(absolute, { force: true });
  }
  get paths(): string[] {
    return [...this.originals.keys()];
  }
  async revert(): Promise<void> {
    for (const [path, original] of this.originals) {
      const absolute = join(this.vaultPath, path);
      if (original === null) await rm(absolute, { force: true });
      else await writeFile(absolute, original);
    }
    this.originals.clear();
  }
}
export const OPS_ROLLUP_HEADING = "## Ops rollup";

/** Weighted token overlap at or above this counts as a confident placement. */
const CONFIDENT_SCORE = 2;

const STOPWORDS = new Set((
  "the and for with that this from into onto about have has had was were are is be been being not but you your our " +
  "they them their its it's what when where which who will would should could can may might just also more most very " +
  "some any all one two out over under than then there here only like want need get got make made new old now today " +
  "yesterday tomorrow week month year note notes page pages memory capture log working long term ongoing things thing " +
  "por para con que los las del una uno como pero más este esta esto"
).split(" "));

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

const OPS_HEAD_RE = /^\s*(?:\[[^\]]{1,40}\]\s*)?[\w.-]{2,40}\s+(?:console\s+|watcher\s+)?(?:EPIC-[\w.]+|E\d+[\w.]*-[\w.-]+|ZAL-?\d+)\b/i;
/** A ticket, epic or run id anywhere on the first line, bare or in parentheses: `(agent_team E46-S9 …)`, `(T3)`, `Run: run_…`. */
const OPS_ID_RE = /\b(?:EPIC-\d[\w.]*|[A-Z]\d{1,3}-[A-Z]{0,3}\d[\w.-]*|ZAL-?\d+|run_[0-9a-f]{6,})\b|\(\s*T\d+(?:\.\d+)?\s*\)/;
const OPS_WORD_RE = /\b(?:watcher|console|wake|run_[0-9a-f]{6,}|report|decision|decided|dispatched|merged|deployed|health sha|ci green|agent_team|delivery manager|production[- ]proof|ready: yes)\b/i;

/**
 * An agent ops report (Watcher read, console decision, wake report, ticket or
 * test-campaign report) rather than something the person said. From a surface a
 * person speaks into (WhatsApp, Telegram, web, Drive) only a forwarded report
 * counts: its first line carries an epic/ticket/run id and the text reads as
 * telemetry. From MCP, the CLI or an unknown surface, anything the capture-origin
 * check reads as an agent report counts too (E9-2h: parenthesised ids and
 * `repo-name, date:` heads used to slip through and become provisional leaves).
 */
export function isAgentOpsReport(content: string, source?: string | null): boolean {
  const first = content.trimStart().split("\n")[0] ?? "";
  if ((OPS_HEAD_RE.test(first) || OPS_ID_RE.test(first.slice(0, 200))) && OPS_WORD_RE.test(content)) return true;
  return !isPersonSource(source) && readsAsAgentReport(content);
}

export interface NodeChoice {
  /** Vault path of the chosen parent page (a page whose lineage reaches a root). */
  path: string;
  score: number;
  /** True when the match is below CONFIDENT_SCORE: place it, but mark the new leaf provisional. */
  weak: boolean;
}

/**
 * Walk down from the roots (rule 2): score every rooted page by token overlap with
 * its name/title (weight 2) and its node/page summary or a name stem (weight 1). A
 * deeper page wins only by scoring higher than the node above it, so leaves do not
 * chain under siblings on a tie; provisional pages are never chosen. `rootsOnly` restricts the walk to level 1 (ops rollups, rule 5);
 * `under` restricts it to the pages below one node (E9-2f: the leaf a root-level capture belongs on).
 * With no signal at all, falls back to the first long-term root (never with `under`: no match there means none).
 */
export async function chooseTreeNode(
  vaultPath: string,
  index: TreeIndex,
  text: string,
  options: { exclude?: Set<string>; rootsOnly?: boolean; under?: string } = {},
): Promise<NodeChoice | null> {
  const words = tokens(text);
  // Under a root, a word the root's own summary already names ("Moss Lantern" on a root) does not single out a page below it.
  const underRoot = options.under ? index.rootsByPath.get(options.under.toLowerCase()) : undefined;
  const rootWords = underRoot ? tokens(`${underRoot.name} ${underRoot.summary}`) : new Set<string>();
  let best: { path: string; score: number; depth: number; order: number } | null = null;
  let order = 0;
  for (const [path, fields] of index.fields) {
    order++;
    // A provisional node is itself unplaced; it never adopts other pages until the sweep confirms it.
    if (options.exclude?.has(path) || fields.provisional) continue;
    const root = index.rootsByPath.get(path.toLowerCase());
    if (options.rootsOnly && !root) continue;
    const lineage = index.lineage(path);
    if (!lineage.ok) continue;
    if (options.exclude && lineage.steps.some(step => options.exclude!.has(step.path))) continue;
    if (options.under && (path === options.under || !lineage.steps.some(step => step.path === options.under))) continue;
    const summary = await pageSummary(vaultPath, path);
    const name = tokens(`${root?.name ?? fields.title} ${basenameOf(path)}`);
    const rest = tokens(`${root?.summary ?? ""} ${summary}`);
    if (!root) {
      // Below level 1 a page is only the right node when its own name (not one it shares with an ancestor) matches.
      const inherited = tokens(lineage.steps.slice(0, -1).map(step => `${step.name} ${basenameOf(step.path)}`).join(" "));
      for (const word of rootWords) inherited.add(word);
      if (![...name].some(word => !inherited.has(word) && words.has(word))) continue;
    }
    let score = 0;
    for (const word of words) score += name.has(word) ? 2 : rest.has(word) || prefixHit(word, name) ? 1 : 0;
    const depth = lineage.steps.length;
    const rootOrder = root ? (index.tree?.nodes.indexOf(root) ?? order) : order + 1000;
    if (!best || score > best.score || (score === best.score && depth < best.depth)
      || (score === best.score && depth === best.depth && rootOrder < best.order)) {
      best = { path, score, depth, order: rootOrder };
    }
  }
  if (best && best.score > 0) return { path: best.path, score: best.score, weak: best.score < CONFIDENT_SCORE };
  if (options.under) return null;
  const fallback = index.tree?.nodes.find(node => node.kind === "long-term") ?? index.tree?.nodes[0];
  const resolved = fallback ? index.resolveRef(fallback.path) : null;
  return resolved && index.fields.has(resolved) ? { path: resolved, score: 0, weak: true } : null;
}

/** `infra` ~ `infrastructure`: a 5+ letter stem of a name word counts once. */
function prefixHit(word: string, name: Set<string>): boolean {
  if (word.length < 5) return false;
  for (const candidate of name) {
    if (candidate.length >= 5 && (candidate.startsWith(word) || word.startsWith(candidate))) return true;
  }
  return false;
}

async function pageSummary(vaultPath: string, path: string): Promise<string> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
  const summary = parseNote(raw).frontmatter?.summary;
  return typeof summary === "string" ? summary : "";
}

/** `parent: "[[Projects/X]]"` for a page path (path form, so basename collisions cannot misresolve). */
export function parentRef(path: string): string {
  return `[[${path.replace(/\.md$/, "")}]]`;
}

/** Set `parent:` (and `provisional:`) in a page's frontmatter, preserving every other line. */
export function withParent(raw: string, parentPath: string, provisional: boolean): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw);
  if (!match) throw new Error("tree_placement_no_frontmatter");
  const kept = match[1]!.split("\n").filter(line => !/^(?:parent|provisional):/.test(line));
  kept.push(`${PARENT_FIELD}: ${JSON.stringify(parentRef(parentPath))}`);
  if (provisional) kept.push("provisional: true");
  return `---\n${kept.join("\n")}\n---${match[2]}${raw.slice(match[0].length)}`;
}

function safeTitle(text: string): string {
  const first = (text.trim().split("\n")[0] ?? "").replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const words = first.split(" ").slice(0, 8).join(" ");
  return (words.length > 60 ? words.slice(0, 60) : words).replace(/[\s.,;!?]+$/, "").trim() || "Unsorted capture";
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Rule 4: a capture that reached no page becomes a provisional leaf under the
 * closest node, quoting the capture and citing its Log entry. Returns the page path.
 */
export async function writeProvisionalLeaf(
  vaultPath: string,
  index: TreeIndex,
  input: { content: string; evidenceRef: string; reason: string; today: string },
  writes: TrackedWrites = new TrackedWrites(vaultPath),
): Promise<{ path: string; parent: string } | null> {
  const choice = await chooseTreeNode(vaultPath, index, input.content);
  if (!choice) return null;
  const { date, anchor } = splitEvidenceRef(input.evidenceRef);
  const citation = `[[${date}#^${anchor}]]`;
  const parentTitle = index.fields.get(choice.path)?.title ?? basenameOf(choice.path);
  const quoted = input.content.trimEnd().split("\n").map(line => `> ${line}`).join("\n");
  const block = [`## Capture ${date} ${citation}`, "", quoted, "", `Filing note: ${oneLine(input.reason, 200)}`, ""].join("\n");
  let title = safeTitle(input.content);
  for (let n = 2; ; n++) {
    const path = `Notes/${title}.md`;
    const existing = await readFile(join(vaultPath, path), "utf8").catch(() => null);
    if (existing === null) {
      const summary = oneLine(`Provisional: ${input.content}`, 160);
      const frontmatter = [
        "---",
        `title: ${JSON.stringify(title)}`,
        "type: note",
        "tags: []",
        `created: ${input.today}`,
        `updated: ${input.today}`,
        `summary: ${JSON.stringify(summary)}`,
        `${PARENT_FIELD}: ${JSON.stringify(parentRef(choice.path))}`,
        "provisional: true",
        "---",
      ].join("\n");
      const body = `# ${title}\n\nA provisional leaf under [[${choice.path.replace(/\.md$/, "")}|${parentTitle}]]: nothing in the tree fitted this capture well, so the weekly sweep reviews where it belongs.\n\n${block}`;
      await writes.write(path, `${frontmatter}\n\n${body}`);
      return { path, parent: choice.path };
    }
    if (existing.includes(citation)) return { path, parent: choice.path };
    const fields = index.fields.get(path);
    if (fields?.provisional) {
      await writes.write(path, `${existing}${existing.endsWith("\n") ? "\n" : "\n\n"}${block}`);
      return { path, parent: choice.path };
    }
    title = `${safeTitle(input.content)} ${n}`;
  }
}

/**
 * Rule 5: one dated rollup line per project node. The node page's `## Ops rollup`
 * section gets `- <date> ops (<n>): [[date#^e-a]], [[date#^e-b]]`; the page's
 * `updated:` is left alone so ops traffic never makes a node look ongoing.
 */
export async function appendOpsRollup(
  vaultPath: string,
  index: TreeIndex,
  input: { content: string; evidenceRef: string },
  writes: TrackedWrites = new TrackedWrites(vaultPath),
): Promise<string | null> {
  // Epic/ticket ids (`EPIC-15`, `E6-S36`) say nothing about the project; drop them before matching.
  const head = input.content.split("\n").slice(0, 3).join(" ").replace(/\b(?:EPIC-[\w.]+|E\d+[\w.]*-[\w.-]+|ZAL-?\d+)/gi, " ");
  const choice = await chooseTreeNode(vaultPath, index, head, { rootsOnly: true });
  if (!choice) return null;
  const { date, anchor } = splitEvidenceRef(input.evidenceRef);
  const citation = `[[${date}#^${anchor}]]`;
  const raw = await readFile(join(vaultPath, choice.path), "utf8");
  if (raw.includes(citation)) return choice.path;
  const lineRe = new RegExp(`^- ${date} ops \\((\\d+)\\): (.*)$`, "m");
  const existing = lineRe.exec(raw);
  let next: string;
  if (existing) {
    next = raw.replace(lineRe, `- ${date} ops (${Number(existing[1]) + 1}): ${existing[2]}, ${citation}`);
  } else {
    next = appendToSection(raw, OPS_ROLLUP_HEADING, "Agent ops reports (Watcher reads, console decisions), one line per day; the evidence stays in the Log.", `- ${date} ops (1): ${citation}`);
  }
  await writes.write(choice.path, next);
  return choice.path;
}

/**
 * Append a line at the end of a `## ` section (newest last, section stays
 * contiguous), creating the section with its intro at the end of the page when absent.
 */
function appendToSection(raw: string, heading: string, intro: string, line: string): string {
  const at = raw.indexOf(`\n${heading}\n`);
  if (at < 0) return `${raw}${raw.endsWith("\n") ? "\n" : "\n\n"}${heading}\n\n${intro}\n\n${line}\n`;
  const start = at + heading.length + 2;
  const nextHeading = raw.slice(start).search(/^## /m);
  const end = nextHeading < 0 ? raw.length : start + nextHeading;
  const section = raw.slice(start, end).replace(/\s+$/, "");
  const after = raw.slice(end);
  return `${raw.slice(0, start)}${section}${section ? "\n" : ""}${line}\n${after ? `\n${after}` : ""}`;
}

/** E9-2f: a single shared name word (score 2) is not enough to cite a capture on a deeper page. */
const LEAF_CITATION_SCORE = CONFIDENT_SCORE + 1;

/** Section on a deeper page holding captures that first landed on its level-1 root (E9-2f). */
export const LEAF_CAPTURES_HEADING = "## Captures";

/**
 * E9-2f: a capture cited only by a level-1 root also belongs on the deepest page
 * under that root that matches it (E9-2b's walk, restricted to the root's
 * subtree; a name word the root's summary does not already carry, plus one more
 * matching word). Appends `- <date> · <summary> [[date#^e-…]]`
 * to that page's `## Captures` section; the root keeps its citation, nothing is
 * removed. Returns the page now citing the capture, or null when no page below
 * the root fits.
 */
export async function citeOnLeaf(
  vaultPath: string,
  index: TreeIndex,
  input: { rootPath: string; evidenceRef: string; text: string; summary: string },
  writes: TrackedWrites = new TrackedWrites(vaultPath),
): Promise<string | null> {
  const choice = await chooseTreeNode(vaultPath, index, input.text, { under: input.rootPath });
  // Stricter than placing a new page: a name word plus at least one more matching word.
  if (!choice || choice.score < LEAF_CITATION_SCORE) return null;
  const { date, anchor } = splitEvidenceRef(input.evidenceRef);
  const raw = await readFile(join(vaultPath, choice.path), "utf8");
  if (raw.includes(`${date}#^${anchor}`)) return choice.path;
  const line = `- ${date} · ${oneLine(input.summary, 140) || "capture"} [[${date}#^${anchor}]]`;
  await writes.write(choice.path, appendToSection(raw, LEAF_CAPTURES_HEADING, "Captures that first landed on the parent page; the Log entry is the evidence.", line));
  return choice.path;
}

export function splitEvidenceRef(evidenceRef: string): { logPath: string; date: string; anchor: string } {
  const match = /^(Log\/(\d{4}-\d{2}-\d{2})\.md)#\^(e-[0-9a-f]+)$/.exec(evidenceRef);
  if (!match) throw new Error(`invalid evidence ref: ${evidenceRef}`);
  return { logPath: match[1]!, date: match[2]!, anchor: match[3]! };
}

export interface PlacedPage {
  path: string;
  /** `Working › Boat repair › 2023 Porto quotes`, when the vault has a tree. */
  lineage?: string;
  provisional?: boolean;
  /** Set for rule-5 ops rollups. */
  rollup?: boolean;
}

/** The text after `- filed: ` for one destination (or `log only (reason)`). */
export function filedTarget(page: PlacedPage | { logOnly: string }): string {
  if ("logOnly" in page) return `log only (${oneLine(page.logOnly, 160)})`;
  const link = parentRef(page.path);
  const extras = [page.rollup ? "ops rollup" : "", page.provisional ? "provisional" : ""].filter(Boolean);
  return `${link}${page.lineage ? ` (${page.lineage})` : ""}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

/**
 * Rule 6: append `- filed:` lines for an entry. The Log is append-only, so the
 * lines land at the end of the file: directly under the entry when it is the last
 * one (`- filed: …`), otherwise addressed to it (`- filed e-1a2b3c: …`, no caret so
 * the anchor stays unique). A page already recorded for the entry is not repeated.
 * Returns the lines appended.
 */
export async function appendFiledLines(vaultPath: string, evidenceRef: string, targets: string[],
  writes: TrackedWrites = new TrackedWrites(vaultPath)): Promise<string[]> {
  const { logPath, anchor } = splitEvidenceRef(evidenceRef);
  const absolute = join(vaultPath, logPath);
  const raw = await readFile(absolute, "utf8");
  // One line per destination page; a log-only line is only written while the entry has no line at all.
  const recorded = parseFiledLines(raw, anchor);
  const known = new Set(recorded.map(filedKey));
  const fresh = [...new Set(targets)].filter(target => {
    const key = filedKey(target);
    if (known.has(key) || (key === "log only" && recorded.length > 0)) return false;
    known.add(key);
    return true;
  });
  if (!fresh.length) return [];
  const lines = raw.split("\n");
  const headingIndex = lines.findIndex(line => entryHeading(line)?.anchor === anchor);
  if (headingIndex < 0) throw new Error(`evidence entry not found: ${evidenceRef}`);
  const isLast = !lines.slice(headingIndex + 1).some(line => entryHeading(line) !== null);
  const prefix = isLast ? `${FILED_PREFIX}: ` : `${FILED_PREFIX} ${anchor}: `;
  const added = fresh.map(target => `${prefix}${target}`);
  const base = raw.endsWith("\n") ? raw : `${raw}\n`;
  await writes.write(logPath, `${base}${added.join("\n")}\n`);
  return added;
}

/** `[[Notes/A]] (Working › …)` → `[[Notes/A]]`; `log only (…)` → `log only`. */
function filedKey(target: string): string {
  return /^\[\[[^\]]+\]\]/.exec(target)?.[0] ?? (target.startsWith("log only") ? "log only" : target);
}

/** Every `filed:` target recorded for an entry in one Log file (both forms). */
export function parseFiledLines(logText: string, anchor: string): string[] {
  const lines = logText.split("\n");
  const out: string[] = [];
  let inEntry = false;
  for (const line of lines) {
    const heading = entryHeading(line);
    if (heading) inEntry = heading.anchor === anchor;
    if (inEntry && line.startsWith(`${FILED_PREFIX}: `)) out.push(line.slice(FILED_PREFIX.length + 2));
    if (line.startsWith(`${FILED_PREFIX} ${anchor}: `)) out.push(line.slice(FILED_PREFIX.length + anchor.length + 3));
  }
  return out;
}

export interface PlacementPlan {
  /** Meaning pages the librarian wrote for this capture. */
  pages: string[];
  /** Why no page was written, when `pages` is empty. */
  reason?: string;
  /** False when the capture must not become a provisional leaf (e.g. filing still pending, retried later). */
  leafAllowed: boolean;
  /** Pages that carry this capture as a rule-5 ops rollup line. */
  rollup?: boolean;
}

export interface PlacementResult {
  hasTree: boolean;
  pagesTouched: string[];
  placed: PlacedPage[];
  filedLines: string[];
  /** Tree lint errors on the touched pages after placement (empty when clean). */
  treeIssues: TreeLintIssue[];
}

/**
 * Place the pages a filing touched and write the `filed:` lines. Leaves the
 * changes uncommitted; the caller validates and commits (or discards).
 */
export async function placeCapture(
  vaultPath: string,
  input: { content: string; evidenceRef: string; today: string },
  plan: PlacementPlan,
  writes: TrackedWrites = new TrackedWrites(vaultPath),
): Promise<PlacementResult> {
  const hasTree = (await readTree(vaultPath)) !== null;
  const pages = [...new Set(plan.pages.filter(path => tierOf(path) === "meaning" && MEANING_FOLDERS[path.split("/")[0]!]))];
  if (!hasTree) {
    const targets = pages.length ? pages.map(path => filedTarget({ path })) : [filedTarget({ logOnly: plan.reason ?? "no page written" })];
    const filedLines = await appendFiledLines(vaultPath, input.evidenceRef, targets, writes);
    return { hasTree, pagesTouched: [], placed: pages.map(path => ({ path })), filedLines, treeIssues: [] };
  }

  let index = await buildTreeIndex(vaultPath);
  const touched = new Set<string>();
  const provisional = new Set<string>();
  for (const path of pages) {
    if (!isTreePage(path) || !index.fields.has(path)) continue;
    if (index.lineage(path).ok) continue;
    const choice = await chooseTreeNode(vaultPath, index, `${index.fields.get(path)!.title} ${await pageSummary(vaultPath, path)} ${input.content}`,
      { exclude: new Set([path]) });
    if (!choice) continue;
    const raw = await readFile(join(vaultPath, path), "utf8");
    await writes.write(path, withParent(raw, choice.path, choice.weak));
    if (choice.weak) provisional.add(path);
    touched.add(path);
  }
  let finalPages = pages;
  if (!pages.length && plan.leafAllowed) {
    const leaf = await writeProvisionalLeaf(vaultPath, index, { ...input, reason: plan.reason ?? "nothing fitted" }, writes);
    if (leaf) { finalPages = [leaf.path]; touched.add(leaf.path); provisional.add(leaf.path); }
  }
  if (touched.size) index = await buildTreeIndex(vaultPath);
  // E9-2f: a capture that reached only level-1 roots is also cited on the deepest page below them that fits (rule 2), so lineage reaches the leaf.
  if (!plan.rollup && finalPages.length && finalPages.every(path => index.rootsByPath.has(path.toLowerCase()))) {
    const leaves: string[] = [];
    for (const rootPath of finalPages) {
      const leaf = await citeOnLeaf(vaultPath, index, { rootPath, evidenceRef: input.evidenceRef, text: oneLine(input.content, 200), summary: input.content }, writes);
      if (leaf && !leaves.includes(leaf)) leaves.push(leaf);
    }
    for (const leaf of leaves) touched.add(leaf);
    finalPages = [...finalPages, ...leaves];
  }

  const snapshot = await scanVault(vaultPath);
  const report = lintTreeIndex(index, snapshot.files);
  const treeIssues = report.issues.filter(issue => issue.severity === "error" && finalPages.includes(issue.path));
  const placed: PlacedPage[] = finalPages.map(path => {
    const lineage = index.lineage(path);
    return {
      path,
      ...(lineage.ok ? { lineage: formatLineage(lineage) } : {}),
      ...(provisional.has(path) || index.fields.get(path)?.provisional ? { provisional: true } : {}),
      ...(plan.rollup ? { rollup: true } : {}),
    };
  });
  const targets = placed.length ? placed.map(filedTarget) : [filedTarget({ logOnly: plan.reason ?? "no page written" })];
  const filedLines = await appendFiledLines(vaultPath, input.evidenceRef, targets, writes);
  return { hasTree, pagesTouched: [...touched], placed, filedLines, treeIssues };
}

/**
 * Derive the placement plan of an uncommitted, unguarded filing from its pending
 * changes: the meaning pages it wrote, or the Inbox stub/record it fell back to.
 * Returns null when the filing is still pending (retried later; it records
 * `filed:` once it settles).
 */
export function planFromChanges(changes: Array<{ path: string; after: string | null }>, rollup = false): PlacementPlan | null {
  const written = changes.filter(change => change.after !== null);
  const pages = written.filter(change => !!MEANING_FOLDERS[change.path.split("/")[0] ?? ""] && change.path.endsWith(".md")).map(change => change.path);
  if (pages.length) return { pages, leafAllowed: false, rollup };
  const stub = written.find(change => /^Inbox\/needs-filing-/.test(change.path));
  if (stub) {
    const question = /^question: (.*)$/m.exec(stub.after!)?.[1];
    let reason = "needs filing";
    try { if (question) reason = `needs filing: ${JSON.parse(question) as string}`; } catch { /* keep the generic reason */ }
    return { pages: [], reason, leafAllowed: true };
  }
  const record = written.find(change => /^Inbox\/filing-/.test(change.path));
  if (record) {
    if (/"status": "pending"/.test(record.after!)) return null;
    const reason = /"reason": "([^"]+)"/.exec(record.after!)?.[1] ?? "filing uncertain";
    return { pages: [], reason, leafAllowed: true };
  }
  return { pages: [], reason: "evidence only: nothing new for a page", leafAllowed: false };
}
