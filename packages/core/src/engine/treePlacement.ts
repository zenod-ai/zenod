import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf, MEANING_FOLDERS, tierOf } from "../vault/files.js";
import { scanVault, type PageIndexEntry } from "../vault/pages.js";
import type { Classification, ClassifyInput } from "../llm/types.js";
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
import { isPersonSource, outsideOpsRollup, readsAsAgentReport } from "../vault/captureOrigin.js";

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
  /** The bytes a path held before this tracker first wrote it (null: it did not exist). */
  original(path: string): string | null | undefined {
    return this.originals.get(path);
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
  "por para con que los las del una uno como pero más este esta esto " +
  // E22-S5: transcribed notes open "The user says …": those words name no topic (a stray root caught 149 leaves on them).
  "user users say says said saying report reports reported ask asks asked want wants wanted think thinks mention mentions mentioned"
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
    if (options.exclude?.has(path) || fields.provisional || fields.merged) continue;
    const root = index.rootsByPath.get(path.toLowerCase());
    if (options.rootsOnly && !root) continue;
    const lineage = index.lineage(path);
    if (!lineage.ok) continue;
    // E22-S5: a root that is one note (`Notes/…`: an article, a stray capture) is no topic; nothing hangs on its branch.
    if (isNoteRoot(lineage.steps[0]?.path)) continue;
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
  const resolvedNodes = (index.tree?.nodes ?? []).map(node => ({ node, path: index.resolveRef(node.path) }))
    .filter(entry => entry.path && !isNoteRoot(entry.path));
  const fallbackEntry = resolvedNodes.find(entry => entry.node.kind === "long-term") ?? resolvedNodes[0];
  const resolved = fallbackEntry?.path ?? null;
  return resolved && index.fields.has(resolved) ? { path: resolved, score: 0, weak: true } : null;
}

/** E22-S5: a level-1 node whose page is a single note under `Notes/` rather than a topic page. */
function isNoteRoot(path: string | undefined | null): boolean {
  return !!path && path.startsWith("Notes/");
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

/**
 * E14-S42: a new page's name is whole. The first line of the title (or capture), made safe for a
 * file name, kept in full when it fits; only a very long line is shortened, at the end of a clause
 * or else between words, never mid-word, and without a dangling "a", "the" or "and" at the end.
 * The limits leave room for ` 99.md` under the 255-byte file-name limit of Drive and git checkouts.
 */
export const PAGE_TITLE_MAX_CHARS = 120;
export const PAGE_TITLE_MAX_BYTES = 200;
const TRAILING_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "of", "to", "in", "on", "at", "by", "for", "with", "from", "into",
  "as", "that", "which", "who", "if", "so", "than", "then", "my", "your", "his", "her", "our", "their", "its",
  "y", "o", "el", "la", "los", "las", "un", "una", "de", "del", "en", "con", "por", "para", "que", "al",
]);

function fitsName(text: string): boolean {
  return Array.from(text).length <= PAGE_TITLE_MAX_CHARS && Buffer.byteLength(text, "utf8") <= PAGE_TITLE_MAX_BYTES;
}

/** The longest prefix (in whole code points) that fits the name limits. */
function longestFit(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!fitsName(out + ch)) break;
    out += ch;
  }
  return out;
}

const tidyEnd = (text: string): string => text.replace(/[\s.,;!?\-–—]+$/, "").trim();

export function pageTitle(text: string): string {
  const first = (text.trim().split("\n")[0] ?? "").replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim();
  if (fitsName(first)) return tidyEnd(first) || "Unsorted capture";
  const room = longestFit(first);
  // The next character is a space: the fitting part already ends on a whole word.
  const atWordEnd = /\s/.test(first.charAt(room.length));
  const clause = /^(.*\S)[.;:!?,]\s|^(.*\S)\s[-–—]\s/.exec(room + " ");
  let cut = room;
  const clauseEnd = clause ? (clause[1] ?? clause[2])! : "";
  if (clauseEnd && Array.from(clauseEnd).length >= PAGE_TITLE_MAX_CHARS / 2) cut = clauseEnd;
  else if (!atWordEnd && /\s/.test(room)) cut = room.slice(0, room.search(/\s\S*$/));
  let words = tidyEnd(cut).split(" ");
  while (words.length > 1 && TRAILING_SMALL_WORDS.has(words[words.length - 1]!.toLowerCase())) words = words.slice(0, -1);
  return tidyEnd(words.join(" ")) || "Unsorted capture";
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * E12-S20: the node a rescued point belongs under: the branch of the page the organiser chose for
 * its subject, the first such page in the tree. The leaf hangs under that page's parent, not the
 * page itself: a point lands here because its merge into the page was rejected or failed, and the
 * page may be a near miss on the right branch. A root page is its own branch; a provisional
 * ancestor hands over to the nearest confirmed one. Null when no chosen page is in the tree.
 */
/** A reconcile that rejected the chosen page as another subject (E12-S8): that page is no anchor for the point. */
export const REJECTED_FOR_PAGE_RE = /reconciliation_(?:needs_clarification|incompatible_decisions)/;

export function anchorNode(index: TreeIndex, anchors: readonly string[]): NodeChoice | null {
  for (const raw of anchors) {
    const path = raw.endsWith(".md") ? raw : `${raw}.md`;
    const found = movedPage(index, path);
    if (!found) continue;
    const lineage = index.lineage(found.path);
    // The page itself is gone and `found` is the folder page that held it: the leaf hangs there.
    const above = found.folder ? lineage.steps : lineage.steps.length > 1 ? lineage.steps.slice(0, -1) : lineage.steps;
    const branch = [...above].reverse().find(step => index.fields.has(step.path) && !index.fields.get(step.path)?.provisional);
    if (branch) return { path: branch.path, score: CONFIDENT_SCORE, weak: false };
  }
  return null;
}

/** Top-level vault folders: a page's folder names a subject only below these. */
const VAULT_ROOT_FOLDERS = new Set(["Projects", "Areas", "Notes", "Resources", "Archive", "Inbox", "Log"]);

/**
 * E12-S23: where a page an old filing chose sits in today's tree. Filings from before the tree
 * migration name pages that were moved since (`Projects/X/Page.md` now `Projects/Y/Page.md`) or
 * folded away: the page by its own name first, as Obsidian resolves a link, then the page of the
 * nearest folder that held it (`Projects/Idealista Data Relationship/Notas.md` → that project's page).
 * A page now only in the Archive anchors nothing: the point is placed as if no page had been chosen.
 */
function movedPage(index: TreeIndex, path: string): { path: string; folder: boolean } | null {
  const inTree = (candidate: string | null) => !!candidate && index.fields.has(candidate) && index.lineage(candidate).ok;
  if (inTree(path)) return { path, folder: false };
  const parts = path.replace(/\.md$/, "").split("/");
  const byName = index.resolveRef(parts[parts.length - 1]!);
  if (inTree(byName)) return { path: byName!, folder: false };
  // A page the person retired to the Archive says nothing about where its subject lives now.
  if (byName?.startsWith("Archive/")) return null;
  for (let end = parts.length - 1; end > 0; end--) {
    const folder = parts[end - 1]!;
    if (end === 1 && VAULT_ROOT_FOLDERS.has(folder)) break;
    for (const candidate of [`${parts.slice(0, end).join("/")}.md`, `${parts.slice(0, end).join("/")}/${folder}.md`, index.resolveRef(folder)]) {
      if (inTree(candidate)) return { path: candidate!, folder: true };
    }
  }
  return null;
}

/**
 * Rule 4: a capture that reached no page becomes a provisional leaf under the
 * closest node, quoting the capture and citing its Log entry. Returns the page path.
 * With `anchors` (E12-S20), the leaf hangs on the branch of the point's own subject page when one
 * is in the tree; else on `fallback`, a node the caller chose (E12-S23); word overlap picks it only when neither is.
 */
export async function writeProvisionalLeaf(
  vaultPath: string,
  index: TreeIndex,
  input: { content: string; evidenceRef: string; reason: string; today: string; title?: string },
  writes: TrackedWrites = new TrackedWrites(vaultPath),
  options: { rootsOnly?: boolean; anchors?: readonly string[]; fallback?: NodeChoice | null; notePages?: readonly string[] } = {},
): Promise<{ path: string; parent: string; grown?: boolean } | null> {
  // E22-S6 (alpha9 E105-S252, 11 of 19 misses): a later point of a note that already reached a page grows
  // the closest of those pages instead of starting a leaf beside them. A leaf this same note already made
  // counts too (4 notes made 16 leaves): a note makes at most one new page, its other points join it.
  const anchored = anchorNode(index, options.anchors ?? []);
  // A point the organiser gave its own subject page keeps it: a note that truly touches two topics grows both.
  if (!anchored && options.notePages?.length) {
    const own = await notePageChoice(vaultPath, index, input.title ? `${input.title}\n\n${input.content}` : input.content, options.notePages, input.evidenceRef);
    if (own) {
      const { date, anchor } = splitEvidenceRef(input.evidenceRef);
      const quoted = input.content.trimEnd().split("\n").map(line => `> ${line}`).join("\n");
      const grown = await growTopic(vaultPath, own, { citation: `[[${date}#^${anchor}]]`, date, quoted, title: input.title ?? input.content, today: input.today }, writes);
      if (grown) return { path: own, parent: index.fields.get(own)?.provisional ? (parentPathOf(index, own) ?? own) : own, grown: true };
    }
  }
  const choice = anchored ?? options.fallback ?? await chooseTreeNode(vaultPath, index, input.title ? `${input.title}\n\n${input.content}` : input.content, options.rootsOnly ? { rootsOnly: true } : {});
  if (!choice) return null;
  const { date, anchor } = splitEvidenceRef(input.evidenceRef);
  const citation = `[[${date}#^${anchor}]]`;
  const parentTitle = index.fields.get(choice.path)?.title ?? basenameOf(choice.path);
  const quoted = input.content.trimEnd().split("\n").map(line => `> ${line}`).join("\n");
  // E22-S5 (Jordi vn_8e8b0693, "growing vertically" not "spreading horizontally"): a topic within
  // reach grows a dated section instead of gaining a new leaf beside it.
  // A later point of a note whose section is already on this page joins it, even on a weaker word match.
  const holdsNote = new RegExp(`^## .*${citation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m")
    .test(await readFile(join(vaultPath, choice.path), "utf8").catch(() => ""));
  if (canGrow(index, holdsNote ? { ...choice, weak: false, score: Math.max(choice.score, CONFIDENT_SCORE) } : choice)) {
    const grown = await growTopic(vaultPath, choice.path, { citation, date, quoted, title: input.title ?? input.content, today: input.today }, writes);
    if (grown) return { path: choice.path, parent: choice.path, grown: true };
  }
  const block = [`## Capture ${date} ${citation}`, "", quoted, "", `Filing note: ${oneLine(input.reason, 200)}`, ""].join("\n");
  let title = pageTitle(input.title ?? input.content);
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
      const why = anchored ? "the filing chose a page on this branch for it but could not merge it there" : "nothing in the tree fitted this capture well";
      const body = `# ${title}\n\nA provisional leaf under [[${choice.path.replace(/\.md$/, "")}|${parentTitle}]]: ${why}, so the weekly sweep reviews where it belongs.\n\n${block}`;
      await writes.write(path, `${frontmatter}\n\n${body}`);
      return { path, parent: choice.path };
    }
    // The same note can hold two points under one name (E12-S23): the second is added, not dropped.
    if (existing.includes(citation) && existing.includes(quoted.split("\n")[0]!)) return { path, parent: choice.path };
    const fields = index.fields.get(path);
    if (fields?.provisional) {
      await writes.write(path, outsideOpsRollup(existing, head => `${head}${head.endsWith("\n") ? "\n" : "\n\n"}${block}`));
      return { path, parent: choice.path };
    }
    title = `${pageTitle(input.title ?? input.content)} ${n}`;
  }
}

/** Folders whose pages are never a topic a point grows on (the Log, receipts, the archive). */
const NOT_A_TOPIC_RE = /^(?:Log|Inbox|Archive)\//;

/**
 * E22-S6: of the pages this note already reached, the one closest to this point (its name weighs twice its
 * summary; a tie keeps a confirmed topic over the note's own leaf, then the caller's order). A provisional
 * page counts only when it is this note's own leaf (it holds the note's Log link). Null when none can grow.
 */
export async function notePageChoice(vaultPath: string, index: TreeIndex, text: string, pages: readonly string[], evidenceRef: string): Promise<string | null> {
  const { date, anchor } = splitEvidenceRef(evidenceRef);
  const citation = `[[${date}#^${anchor}]]`;
  const words = tokens(text);
  let best: { path: string; score: number; leaf: boolean } | null = null;
  for (const raw of new Set(pages)) {
    const path = raw.endsWith(".md") ? raw : `${raw}.md`;
    if (NOT_A_TOPIC_RE.test(path)) continue;
    const fields = index.fields.get(path);
    if (!fields || fields.merged) continue;
    const body = await readFile(join(vaultPath, path), "utf8").catch(() => null);
    if (body === null || !/^---\r?\n/.test(body)) continue;
    const leaf = !!fields.provisional;
    if (leaf && !body.includes(citation)) continue;
    const name = tokens(`${fields.title} ${basenameOf(path)}`);
    const rest = tokens(await pageSummary(vaultPath, path));
    let score = 0;
    for (const word of words) score += name.has(word) ? 2 : rest.has(word) || prefixHit(word, name) ? 1 : 0;
    if (!best || score > best.score || (score === best.score && best.leaf && !leaf)) best = { path, score, leaf };
  }
  return best?.path ?? null;
}

function parentPathOf(index: TreeIndex, path: string): string | null {
  const lineage = index.lineage(path);
  return lineage.ok && lineage.steps.length > 1 ? lineage.steps[lineage.steps.length - 2]!.path : null;
}

/** E22-S6: how many page titles under a root describe it to the root-topic pick. */
const ROOT_PICK_PAGE_TITLES = 12;
/** Tree.md and digest summaries that only count ("12 pages, incl.", "329 of your captures in the last 30 days, latest …"). */
const COUNT_ONLY_RE = /\b\d+ pages?,?(?: incl\.)?|(?:Your own captures that name [^:]+: )?\d+ (?:of your captures )?in the last 30 days(?:, on \d+ days)?(?:, latest \d{4}-\d{2}-\d{2})?\.?|no recent capture of yours\.?/gi;

/** E22-S6: what the root-topic pick tells the classifier. */
export const ROOT_PICK_HINT = "Root-topic pick: the memory below matched no topic by its words. The page index lists only the person's top-level topics. "
  + "If the memory is about one of them (the same product, project, person or place, or work done inside it), choose that page with disposition "
  + "integrate_page, action update and your confidence. Never create a page. If none of them is clearly its subject, use needs_clarification with no page.";

/**
 * E22-S6 (alpha9 E105-S252 cause 3): when the word match is weak, the classifier picks among the root topics
 * before a leaf is made ("the debriefer call cut off" is Epic Team, not the Poly-Maker campaign it shared a word
 * with). Only a confident pick of a listed root counts; anything else (or a failed call) is null.
 */
export async function pickRootTopic(
  vaultPath: string,
  index: TreeIndex,
  input: { content: string; title?: string },
  classify: (input: ClassifyInput) => Promise<Classification>,
  options: { threshold: number; tags?: string[] },
): Promise<NodeChoice | null> {
  // A root's own summary is often only a count ("329 captures in the last 30 days"): the titles of the pages
  // already under it say what it is about.
  const below = new Map<string, string[]>();
  for (const [path, fields] of index.fields) {
    if (fields.merged) continue;
    const lineage = index.lineage(path);
    if (!lineage.ok || lineage.steps.length < 2) continue;
    const root = lineage.steps[0]!.path;
    const titles = below.get(root) ?? [];
    if (titles.length < ROOT_PICK_PAGE_TITLES) titles.push(oneLine(fields.title, 90));
    below.set(root, titles);
  }
  const roots: PageIndexEntry[] = [];
  for (const node of index.tree?.nodes ?? []) {
    const path = index.resolveRef(node.path);
    if (!path || isNoteRoot(path) || roots.some(root => root.path === path)) continue;
    const fields = index.fields.get(path);
    if (!fields || fields.provisional || fields.merged) continue;
    const said = `${node.summary} ${await pageSummary(vaultPath, path)}`.replace(COUNT_ONLY_RE, " ");
    const titles = below.get(path) ?? [];
    roots.push({ path, title: node.name || fields.title, type: "project", tags: [],
      summary: oneLine(`${said}${titles.length ? ` Pages under it: ${titles.join("; ")}.` : ""}`, 900) });
  }
  if (!roots.length) return null;
  let result: Classification;
  try {
    result = await classify({ content: input.title ? `${input.title}\n\n${input.content}` : input.content, hints: [ROOT_PICK_HINT], pageIndex: roots, tagVocabulary: options.tags ?? [] });
  } catch {
    return null;
  }
  const allowed = new Set(roots.map(root => root.path.toLowerCase()));
  for (const topic of result.topics ?? [result]) {
    if (!Number.isFinite(topic.confidence) || topic.confidence < options.threshold) continue;
    if (topic.disposition !== "integrate_page" && topic.disposition !== "append_compact_note") continue;
    for (const page of topic.pages) {
      const path = page.path.endsWith(".md") ? page.path : `${page.path}.md`;
      if (allowed.has(path.toLowerCase())) return { path: roots.find(root => root.path.toLowerCase() === path.toLowerCase())!.path, score: CONFIDENT_SCORE, weak: false };
    }
  }
  return null;
}

/** E22-S5: a capture under this many content words, in at most this many words, has no lasting point. */
export const ONE_OFF_MAX_CONTENT_WORDS = 2;
export const ONE_OFF_MAX_WORDS = 12;
const INGEST_LINE_RE = /^(?:voice note "|raw artifact|original:|media type:|source(?: app| id| timestamp)?:|transcribed by\b|extraction artifact:|user context:|captured-at:)/i;

/** E22-S5: a short acknowledgement or aside ("Amen, it was painful to get here.") that stays in the Log only. */
export function isOneOff(content: string): boolean {
  const spoken = content.split("\n").filter(line => !INGEST_LINE_RE.test(line.trim().replace(/^-\s*/, ""))).join(" ").trim();
  if (!spoken) return false;
  if (spoken.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length > ONE_OFF_MAX_WORDS) return false;
  // E22-S6: a fragment cut off mid-sentence ("Okay, so I'm gonna open the-") says no more than an aside.
  const fragment = /(?:[\p{L}\p{N}][-–—]|\.\.\.|…)\s*$/u.test(spoken);
  return tokens(spoken).size <= (fragment ? ONE_OFF_MAX_FRAGMENT_WORDS : ONE_OFF_MAX_CONTENT_WORDS);
}
/** E22-S6: a cut-off fragment with at most this many content words stays in the Log only. */
export const ONE_OFF_MAX_FRAGMENT_WORDS = 4;

/** E22-S5: the chosen node is a confirmed topic page close enough to grow (not a weak guess, not a pointer or a single note). */
function canGrow(index: TreeIndex, choice: NodeChoice): boolean {
  if (choice.weak || choice.score < CONFIDENT_SCORE || isNoteRoot(choice.path)) return false;
  const fields = index.fields.get(choice.path);
  if (!fields || fields.provisional || fields.merged) return false;
  const lineage = index.lineage(choice.path);
  return lineage.ok && !isNoteRoot(lineage.steps[0]?.path);
}

/** Heading of the dated section a capture grows on its topic page. */
export function grownHeading(date: string, title: string, citation: string): string {
  const short = pageTitle(title).slice(0, 90).trim();
  return `## ${date} · ${short} ${citation}`;
}

/**
 * E22-S5: append the capture to its topic page as a dated section, quoting the person's words with
 * the Log citation. A second point of the same note joins the section the first one opened (a note
 * is one section per topic, never one per sentence). `updated:` moves to today. Null when the page
 * is unreadable or has no frontmatter.
 */
export async function growTopic(
  vaultPath: string,
  path: string,
  input: { citation: string; date: string; quoted: string; title: string; today: string },
  writes: TrackedWrites,
): Promise<string | null> {
  const raw = await readFile(join(vaultPath, path), "utf8").catch(() => null);
  if (raw === null || !/^---\r?\n[\s\S]*?\r?\n---/.test(raw)) return null;
  const firstQuoted = input.quoted.split("\n")[0]!;
  const lines = raw.split("\n");
  const at = lines.findIndex(line => line.startsWith("## ") && line.includes(input.citation));
  let next: string;
  if (at >= 0) {
    let end = lines.findIndex((line, i) => i > at && line.startsWith("## "));
    if (end < 0) end = lines.length;
    const section = lines.slice(at, end).join("\n");
    if (section.includes(firstQuoted)) return path;
    let last = end;
    while (last > at + 1 && !lines[last - 1]!.trim()) last--;
    next = [...lines.slice(0, last), "", input.quoted, ...(end < lines.length ? [""] : []), ...lines.slice(end)].join("\n");
    if (end === lines.length && !next.endsWith("\n")) next += "\n";
  } else {
    if (raw.includes(input.citation) && raw.includes(firstQuoted)) return path;
    const block = `${grownHeading(input.date, input.title, input.citation)}\n\n${input.quoted}\n`;
    next = outsideOpsRollup(raw, head => `${head}${head.endsWith("\n") ? "\n" : "\n\n"}${block}`);
  }
  next = next.replace(/^---\r?\n[\s\S]*?\r?\n---/, front => front.replace(/^updated: .*$/m, `updated: ${input.today}`));
  await writes.write(path, next);
  return path;
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
  if (at < 0) {
    const add = (head: string) => `${head}${head.endsWith("\n") ? "\n" : "\n\n"}${heading}\n\n${intro}\n\n${line}\n`;
    return heading === OPS_ROLLUP_HEADING ? add(raw) : outsideOpsRollup(raw, add);
  }
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
  /** E12-S27: how sure Zenod was of this place, 0–100 (see placementConfidence). */
  confidence?: number;
}

/** `· 72% sure` at the end of a `filed:` line (E12-S27): how sure Zenod was of the place. */
export const FILED_CONFIDENCE_RE = /· (\d{1,3})% sure\s*$/;

/**
 * E12-S27: how sure Zenod is of the place a filing chose, 0–100, from what the filing already
 * knows (no extra model call): the classifier's own confidence in the page (0–1, from the call
 * that filed it; 0.75 when the path had none) times how the page reached the tree: already in it
 * (×1), hung on a branch that matched by name (×0.85), hung on a weak match and marked
 * provisional (×0.5), or a provisional leaf because no page fitted (×0.3).
 */
export type PlacementHow = "in_tree" | "hung" | "hung_weak" | "leaf";
const PLACEMENT_FACTOR: Record<PlacementHow, number> = { in_tree: 1, hung: 0.85, hung_weak: 0.5, leaf: 0.3 };
export function placementConfidence(classifier: number | null | undefined, how: PlacementHow): number {
  const base = typeof classifier === "number" && Number.isFinite(classifier) ? Math.max(0, Math.min(1, classifier)) : 0.75;
  return Math.round(100 * base * PLACEMENT_FACTOR[how]);
}

/** The text after `- filed: ` for one destination (or `log only (reason)`). */
export function filedTarget(page: PlacedPage | { logOnly: string }): string {
  if ("logOnly" in page) return `log only (${oneLine(page.logOnly, 160)})`;
  const link = parentRef(page.path);
  const extras = [page.rollup ? "ops rollup" : "", page.provisional ? "provisional" : "",
    typeof page.confidence === "number" && !page.rollup ? `${page.confidence}% sure` : ""].filter(Boolean);
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
  /** E12-S27: the classifier's confidence (0–1), for the whole filing or per page it chose. */
  confidence?: number | Record<string, number>;
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
  const how = new Map<string, PlacementHow>();
  for (const path of pages) {
    if (!isTreePage(path) || !index.fields.has(path)) continue;
    if (index.lineage(path).ok) continue;
    const choice = await chooseTreeNode(vaultPath, index, `${index.fields.get(path)!.title} ${await pageSummary(vaultPath, path)} ${input.content}`,
      { exclude: new Set([path]) });
    if (!choice) continue;
    const raw = await readFile(join(vaultPath, path), "utf8");
    await writes.write(path, withParent(raw, choice.path, choice.weak));
    if (choice.weak) provisional.add(path);
    how.set(path, choice.weak ? "hung_weak" : "hung");
    touched.add(path);
  }
  let finalPages = pages;
  let logOnly = plan.reason ?? "no page written";
  // E22-S5: a one-off note ("And the reply now done.") has no lasting point: it stays in the Log and makes no file.
  if (!pages.length && plan.leafAllowed && isOneOff(input.content)) logOnly = "one-off: no lasting point";
  else if (!pages.length && plan.leafAllowed) {
    const leaf = await writeProvisionalLeaf(vaultPath, index, { ...input, reason: plan.reason ?? "nothing fitted" }, writes);
    if (leaf?.grown) { finalPages = [leaf.path]; touched.add(leaf.path); how.set(leaf.path, "hung"); }
    else if (leaf) { finalPages = [leaf.path]; touched.add(leaf.path); provisional.add(leaf.path); how.set(leaf.path, "leaf"); }
  }
  if (touched.size) index = await buildTreeIndex(vaultPath);
  // E9-2f: a capture that reached only level-1 roots is also cited on the deepest page below them that fits (rule 2), so lineage reaches the leaf.
  if (!plan.rollup && finalPages.length && finalPages.every(path => index.rootsByPath.has(path.toLowerCase()))) {
    const leaves: string[] = [];
    for (const rootPath of finalPages) {
      const leaf = await citeOnLeaf(vaultPath, index, { rootPath, evidenceRef: input.evidenceRef, text: oneLine(input.content, 200), summary: input.content }, writes);
      if (leaf && !leaves.includes(leaf)) leaves.push(leaf);
    }
    for (const leaf of leaves) { touched.add(leaf); how.set(leaf, "hung"); }
    finalPages = [...finalPages, ...leaves];
  }

  const snapshot = await scanVault(vaultPath);
  const report = lintTreeIndex(index, snapshot.files);
  const treeIssues = report.issues.filter(issue => issue.severity === "error" && finalPages.includes(issue.path));
  // A page the classifier did not name itself (a leaf, a deeper page citing it) takes the filing's best topic.
  const perPage = typeof plan.confidence === "object" ? Object.values(plan.confidence) : [];
  const classifier = (path: string) => typeof plan.confidence === "number" ? plan.confidence
    : plan.confidence?.[path] ?? (perPage.length ? Math.max(...perPage) : undefined);
  const placed: PlacedPage[] = finalPages.map(path => {
    const lineage = index.lineage(path);
    const placedHow = how.get(path) ?? (index.fields.get(path)?.provisional ? "hung_weak" : "in_tree");
    return {
      path,
      ...(lineage.ok ? { lineage: formatLineage(lineage) } : {}),
      ...(provisional.has(path) || index.fields.get(path)?.provisional ? { provisional: true } : {}),
      ...(plan.rollup ? { rollup: true } : { confidence: placementConfidence(classifier(path), placedHow) }),
    };
  });
  const targets = placed.length ? placed.map(filedTarget) : [filedTarget({ logOnly })];
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
