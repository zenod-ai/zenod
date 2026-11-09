import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "../vault/frontmatter.js";
import { basenameOf } from "../vault/files.js";
import type { FileChange } from "../vault/immutability.js";
import { CITATION_RE, WIKILINK_RE, scanVault, type VaultSnapshot } from "../vault/pages.js";
import {
  buildTreeIndex,
  formatLineage,
  formatTreeNode,
  GROUP_HEADINGS,
  isTreePage,
  MEMORY_KINDS,
  TREE_PATH,
  type MemoryKind,
  type TreeIndex,
} from "../vault/tree.js";
import type { TrackedWrites } from "./treePlacement.js";

/**
 * The memory desk (EPIC-14 S3). Some messages are jobs on the memory, not new memories: "untangle
 * Idealista and Poly-Maker", "move the boiler notes under House". A small agent on the cheap chat
 * model reads the memory through five read-only tools, step-capped, and proposes changes from a
 * closed list: move a page, make a page its own topic, rename a topic, link or unlink two memories.
 * The host applies them, never the model, and checks the result: no file under Log/ is touched, no
 * file is created or deleted, no word of a page changes except whole link lines, and front matter
 * changes only in `parent:` and `memory:`. Every job is one commit; its edits are kept so Undo
 * puts each one back exactly (and skips any line someone changed since).
 */

export const DESK_MAX_STEPS = 8;
/** A job touching more than this many memories shows its plan first and waits for a yes. */
export const DESK_MAX_TOUCHED = 50;
const DESK_MAX_CHANGES = 120;
/** Per call: the prompt is trimmed to this, oldest tool results first. */
const DESK_PROMPT_CHARS = 24_000;
/** Per job: the agent stops once its prompts add up to this (about 40k tokens, well under a cent on the chat model). */
export const DESK_MAX_INPUT_CHARS = 160_000;
const TOOL_RESULT_CHARS = 2_500;
const RELATED_HEADING = "## Related";

export type DeskChange =
  /** `confirm` (E12-S27): the person moved it in the app, so its place is no longer provisional. */
  | { op: "move"; page: string; to: string; confirm?: boolean }
  /** E12-S27: the person says the page is in the right place: it stops being provisional. */
  | { op: "confirm"; page: string }
  | { op: "root"; page: string; name: string; kind: MemoryKind; summary?: string }
  | { op: "rename"; page: string; name: string; summary?: string }
  | { op: "link"; from: string; to: string }
  | { op: "unlink"; from: string; to: string };

export interface DeskPlan {
  /** The job's name, used for the inbox item and the commit. */
  title: string;
  /** One or two sentences: what the job does. */
  summary: string;
  /** The search to show before and after. */
  search: string;
  changes: DeskChange[];
}

/** One exact text edit; Undo applies the inverse. */
export type DeskEdit =
  | { kind: "field"; file: string; key: "parent" | "memory" | "provisional"; before: string | null; after: string | null }
  | { kind: "tree_add"; line: string; group: MemoryKind }
  | { kind: "tree_remove"; line: string; group: MemoryKind }
  | { kind: "tree_replace"; before: string; after: string }
  | { kind: "line_add"; file: string; line: string }
  | { kind: "line_remove"; file: string; line: string; after: string | null };

/** What the user sees for one change: one line, with where it was and where it is now. */
export interface DeskChangeView {
  what: string;
  before?: string;
  after?: string;
}

export class DeskChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeskChangeError";
  }
}

// ---------------------------------------------------------------------------------------------
// Text edits

function splitFrontmatter(raw: string): { open: number; close: number; lines: string[] } | null {
  const lines = raw.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return null;
  const close = lines.findIndex((line, i) => i > 0 && line.replace(/\r$/, "") === "---");
  return close > 0 ? { open: 0, close, lines } : null;
}

/** The raw text after `key:` in the front matter, null when absent. Throws on a multi-line value. */
export function fieldValue(raw: string, key: string): string | null {
  const fm = splitFrontmatter(raw);
  if (!fm) throw new DeskChangeError("the page has no front matter");
  for (let i = 1; i < fm.close; i++) {
    const match = new RegExp(`^${key}:(.*)$`).exec(fm.lines[i]!.replace(/\r$/, ""));
    if (!match) continue;
    const value = match[1]!.trim();
    if (!value || /^\s/.test(fm.lines[i + 1] ?? "")) throw new DeskChangeError(`the page's ${key} spans several lines`);
    return value;
  }
  return null;
}

function setField(raw: string, key: string, value: string | null): string {
  const fm = splitFrontmatter(raw);
  if (!fm) throw new DeskChangeError("the page has no front matter");
  const lines = [...fm.lines];
  const at = lines.findIndex((line, i) => i > 0 && i < fm.close && new RegExp(`^${key}:`).test(line));
  if (value === null) {
    if (at >= 0) lines.splice(at, 1);
  } else if (at >= 0) lines[at] = `${key}: ${value}`;
  else lines.splice(fm.close, 0, `${key}: ${value}`);
  return lines.join("\n");
}

function treeSectionEnd(lines: string[], group: MemoryKind): number {
  const heading = lines.findIndex((line) => line.trim().toLowerCase() === `## ${GROUP_HEADINGS[group]}`.toLowerCase());
  if (heading < 0) throw new DeskChangeError(`Tree.md has no "${GROUP_HEADINGS[group]}" heading`);
  let last = heading;
  for (let i = heading + 1; i < lines.length && !lines[i]!.startsWith("## "); i++) if (lines[i]!.startsWith("- ")) last = i;
  return last;
}

function bodyStart(lines: string[]): number {
  const fm = splitFrontmatter(lines.join("\n"));
  return fm ? fm.close + 1 : 0;
}

function addLine(raw: string, line: string): string {
  const lines = raw.replace(/\n+$/, "").split("\n");
  const heading = lines.findIndex((text, i) => i >= bodyStart(lines) && text.trim() === RELATED_HEADING);
  if (heading < 0) return `${lines.join("\n")}\n\n${RELATED_HEADING}\n\n${line}\n`;
  let at = heading + 1;
  for (let i = heading + 1; i < lines.length && !lines[i]!.startsWith("## "); i++) if (lines[i]!.trim()) at = i + 1;
  if (at === heading + 1) { lines.splice(at, 0, "", line); } else lines.splice(at, 0, line);
  return `${lines.join("\n")}\n`;
}

function removeLine(raw: string, line: string): { raw: string; after: string | null } | null {
  const lines = raw.split("\n");
  const at = lines.findIndex((text, i) => i >= bodyStart(lines) && text.replace(/\r$/, "") === line);
  if (at < 0) return null;
  const after = at > 0 ? lines[at - 1]!.replace(/\r$/, "") : null;
  lines.splice(at, 1);
  // A Related section the desk left empty goes too.
  const heading = lines.findIndex((text, i) => i >= bodyStart(lines) && text.trim() === RELATED_HEADING);
  if (heading >= 0) {
    let end = heading + 1;
    while (end < lines.length && !lines[end]!.startsWith("## ") && !lines[end]!.trim()) end++;
    if (end >= lines.length) {
      let start = heading;
      while (start > 0 && !lines[start - 1]!.trim()) start--;
      lines.splice(start, lines.length - start);
      return { raw: `${lines.join("\n")}\n`, after };
    }
  }
  return { raw: lines.join("\n"), after };
}

function insertAfter(raw: string, line: string, after: string | null): string {
  const lines = raw.split("\n");
  const at = after === null ? -1 : lines.findIndex((text, i) => i >= bodyStart(lines) && text.replace(/\r$/, "") === after);
  if (at < 0) return addLine(raw, line);
  lines.splice(at + 1, 0, line);
  return lines.join("\n");
}

async function readText(vaultPath: string, path: string): Promise<string> {
  try {
    return await readFile(join(vaultPath, path), "utf8");
  } catch {
    throw new DeskChangeError(`${path} is not in the memory`);
  }
}

/**
 * Apply one edit. Strict (a job): the text must be exactly as the edit expects, else it throws.
 * Lenient (Undo, later): an edit whose text changed since is skipped and reported false.
 */
export async function applyDeskEdit(vaultPath: string, edit: DeskEdit, writes: TrackedWrites, strict = true): Promise<boolean> {
  const fail = (message: string) => {
    if (strict) throw new DeskChangeError(message);
    return false;
  };
  if (edit.kind === "field") {
    const raw = await readText(vaultPath, edit.file);
    if (fieldValue(raw, edit.key) !== edit.before) return fail(`${edit.file} changed since the plan (${edit.key})`);
    await writes.write(edit.file, setField(raw, edit.key, edit.after));
    return true;
  }
  if (edit.kind === "line_add" || edit.kind === "line_remove") {
    const raw = await readText(vaultPath, edit.file);
    if (edit.kind === "line_add") {
      await writes.write(edit.file, addLine(raw, edit.line));
      return true;
    }
    const removed = removeLine(raw, edit.line);
    if (!removed) return fail(`${edit.file} no longer has the line to unlink`);
    await writes.write(edit.file, removed.raw);
    return true;
  }
  const raw = await readText(vaultPath, TREE_PATH);
  const lines = raw.split("\n");
  const find = (line: string) => lines.findIndex((text) => text.trim() === line.trim());
  if (edit.kind === "tree_add") {
    if (find(edit.line) >= 0) return fail("that topic line is already in the tree");
    lines.splice(treeSectionEnd(lines, edit.group) + 1, 0, edit.line);
  } else if (edit.kind === "tree_remove") {
    const at = find(edit.line);
    if (at < 0) return fail("the topic line changed since the plan");
    lines.splice(at, 1);
  } else {
    const at = find(edit.before);
    if (at < 0) return fail("the topic line changed since the plan");
    lines[at] = edit.after;
  }
  await writes.write(TREE_PATH, lines.join("\n"));
  return true;
}

/** The edit that puts one edit back. */
export function invertDeskEdit(edit: DeskEdit): DeskEdit {
  switch (edit.kind) {
    case "field": return { ...edit, before: edit.after, after: edit.before };
    case "tree_add": return { kind: "tree_remove", line: edit.line, group: edit.group };
    case "tree_remove": return { kind: "tree_add", line: edit.line, group: edit.group };
    case "tree_replace": return { kind: "tree_replace", before: edit.after, after: edit.before };
    case "line_add": return { kind: "line_remove", file: edit.file, line: edit.line, after: null };
    case "line_remove": return { kind: "line_add", file: edit.file, line: edit.line };
  }
}

/** Undo a job: each edit's inverse, last first. A line removed by the job goes back where it was. */
export async function undoDeskEdits(vaultPath: string, edits: readonly DeskEdit[], writes: TrackedWrites): Promise<{ undone: number; skipped: number }> {
  let undone = 0;
  let skipped = 0;
  for (const edit of [...edits].reverse()) {
    let ok: boolean;
    if (edit.kind === "line_remove") {
      const raw = await readText(vaultPath, edit.file).catch(() => null);
      if (raw === null) ok = false;
      else {
        await writes.write(edit.file, insertAfter(raw, edit.line, edit.after));
        ok = true;
      }
    } else {
      ok = await applyDeskEdit(vaultPath, invertDeskEdit(edit), writes, false).catch(() => false);
    }
    if (ok) undone++;
    else skipped++;
  }
  return { undone, skipped };
}

// ---------------------------------------------------------------------------------------------
// Changes → edits

const wikiTarget = (path: string) => path.replace(/\.md$/, "");
const parentValue = (path: string) => `"[[${wikiTarget(path)}]]"`;
const nodeId = (path: string) => `n-${createHash("sha256").update(path).digest("hex").slice(0, 8)}`;

interface DeskVault {
  index: TreeIndex;
  snapshot: VaultSnapshot;
  /** Lowercased link targets and page titles → path. */
  resolve(ref: string): string | null;
  title(path: string): string;
  place(path: string): string;
}

async function loadDeskVault(vaultPath: string): Promise<DeskVault> {
  const snapshot = await scanVault(vaultPath);
  const index = await buildTreeIndex(vaultPath, snapshot);
  const byTitle = new Map<string, string>();
  for (const [path, fields] of index.fields) if (!byTitle.has(fields.title.toLowerCase())) byTitle.set(fields.title.toLowerCase(), path);
  for (const node of index.tree?.nodes ?? []) {
    const path = index.resolveRef(node.path);
    if (path && !byTitle.has(node.name.toLowerCase())) byTitle.set(node.name.toLowerCase(), path);
  }
  const resolve = (ref: string): string | null => {
    const clean = ref.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
    if (!clean) return null;
    return index.resolveRef(clean) ?? byTitle.get(clean.toLowerCase()) ?? byTitle.get(basenameOf(clean).toLowerCase()) ?? null;
  };
  const title = (path: string) => index.rootsByPath.get(path.toLowerCase())?.name ?? index.fields.get(path)?.title ?? basenameOf(path);
  const place = (path: string) => {
    const lineage = index.lineage(path);
    return lineage.ok ? formatLineage(lineage) : "not placed";
  };
  return { index, snapshot, resolve, title, place };
}

function requirePage(vault: DeskVault, ref: string, role: string): string {
  const path = vault.resolve(ref);
  if (!path || !vault.index.fields.has(path)) throw new DeskChangeError(`${role} "${ref}" is not a page in the tree`);
  return path;
}

function isUnder(vault: DeskVault, path: string, ancestor: string): boolean {
  const lineage = vault.index.lineage(path);
  return lineage.steps.some((step) => step.path === ancestor);
}

/** A page line that is only a link, or a citation line of a capture: what unlink may remove. */
function linkLines(body: string, target: { page?: string; citation?: string }, vault: DeskVault): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const text = line.replace(/\r$/, "");
    if (!/^\s*[-*] /.test(text)) continue;
    if (target.citation) {
      if ([...text.matchAll(CITATION_RE)].some((m) => `${m[1]}#^${m[2]}` === target.citation)) out.push(text);
      continue;
    }
    const links = [...text.matchAll(WIKILINK_RE)];
    const rest = text.replace(WIKILINK_RE, "").replace(/^\s*[-*]\s*/, "").replace(/[\s.,;:·—-]/g, "");
    if (rest === "" && links.length === 1 && links[0]![2] === undefined && vault.resolve(links[0]![1]!) === target.page) out.push(text);
  }
  return out;
}

async function citedElsewhere(vaultPath: string, vault: DeskVault, citation: string, except: string): Promise<boolean> {
  for (const path of vault.index.fields.keys()) {
    if (path === except) continue;
    const body = parseNote(await readFile(join(vaultPath, path), "utf8").catch(() => "")).body;
    if ([...body.matchAll(CITATION_RE)].some((m) => `${m[1]}#^${m[2]}` === citation)) return true;
  }
  return false;
}

const citationOf = (ref: string): string | null => {
  const match = /(\d{4}-\d{2}-\d{2})(?:\.md)?#\^?(e-[0-9a-f]{6})/.exec(ref);
  return match ? `${match[1]}#^${match[2]}` : null;
};

/**
 * Apply a plan's changes, one at a time against the vault as it is after the previous one. Returns
 * the exact edits (for Undo) and one line per change for the user. Throws DeskChangeError on a
 * change that does not fit the memory; the caller reverts the writes.
 */
export async function applyDeskChanges(vaultPath: string, changes: readonly DeskChange[], writes: TrackedWrites): Promise<{ edits: DeskEdit[]; views: DeskChangeView[] }> {
  if (changes.length > DESK_MAX_CHANGES) throw new DeskChangeError(`a job makes at most ${DESK_MAX_CHANGES} changes`);
  const edits: DeskEdit[] = [];
  const views: DeskChangeView[] = [];
  const edit = async (next: DeskEdit) => {
    await applyDeskEdit(vaultPath, next, writes, true);
    edits.push(next);
  };
  for (const change of changes) {
    const vault = await loadDeskVault(vaultPath);
    if (change.op === "move") {
      const page = requirePage(vault, change.page, "page");
      const to = requirePage(vault, change.to, "new place");
      if (page === to || isUnder(vault, to, page)) throw new DeskChangeError(`"${vault.title(page)}" cannot go under itself`);
      const raw = await readText(vaultPath, page);
      const before = vault.place(page);
      const root = vault.index.rootsByPath.get(page.toLowerCase());
      if (root) {
        const line = (await readText(vaultPath, TREE_PATH)).split("\n")[root.line - 1]?.replace(/\r$/, "");
        if (!line) throw new DeskChangeError(`the topic line of "${root.name}" was not found`);
        await edit({ kind: "tree_remove", line, group: root.kind });
      }
      const count = edits.length;
      const parent = fieldValue(raw, "parent");
      if (parent !== parentValue(to)) await edit({ kind: "field", file: page, key: "parent", before: parent, after: parentValue(to) });
      const memory = fieldValue(raw, "memory");
      const target = vault.index.lineage(to);
      if (memory !== null && target.ok && memory !== target.group) await edit({ kind: "field", file: page, key: "memory", before: memory, after: target.group });
      const provisional = change.confirm ? fieldValue(raw, "provisional") : null;
      if (provisional !== null) await edit({ kind: "field", file: page, key: "provisional", before: provisional, after: null });
      // Already there: nothing to report.
      if (edits.length === count) continue;
      const after = await loadDeskVault(vaultPath);
      views.push({ what: `${vault.title(page)} moved under ${after.title(to)}`, before, after: after.place(page) });
    } else if (change.op === "root") {
      const page = requirePage(vault, change.page, "page");
      if (vault.index.rootsByPath.has(page.toLowerCase())) throw new DeskChangeError(`"${vault.title(page)}" is already a topic`);
      const name = change.name.trim().replace(/\s*\|\s*/g, " ").slice(0, 80);
      if (!name) throw new DeskChangeError("a new topic needs a name");
      if ((vault.index.tree?.nodes ?? []).some((node) => node.name.toLowerCase() === name.toLowerCase())) throw new DeskChangeError(`there is already a topic called "${name}"`);
      if (!MEMORY_KINDS.includes(change.kind)) throw new DeskChangeError("a topic is working or long-term");
      const raw = await readText(vaultPath, page);
      const summary = (change.summary?.trim() || (typeof parseNote(raw).frontmatter?.summary === "string" ? String(parseNote(raw).frontmatter!.summary) : "") || name).replace(/\s+/g, " ").replace(/\s*\|\s*/g, ", ").slice(0, 200);
      const before = vault.place(page);
      await edit({ kind: "tree_add", line: formatTreeNode({ name, kind: change.kind, path: page, summary, id: nodeId(page) }), group: change.kind });
      const parent = fieldValue(raw, "parent");
      if (parent !== `"[[Tree]]"`) await edit({ kind: "field", file: page, key: "parent", before: parent, after: `"[[Tree]]"` });
      const memory = fieldValue(raw, "memory");
      if (memory !== change.kind) await edit({ kind: "field", file: page, key: "memory", before: memory, after: change.kind });
      views.push({ what: `${name} became its own topic`, before, after: (await loadDeskVault(vaultPath)).place(page) });
    } else if (change.op === "rename") {
      const page = requirePage(vault, change.page, "topic");
      const root = vault.index.rootsByPath.get(page.toLowerCase());
      if (!root) throw new DeskChangeError(`"${vault.title(page)}" is not a topic of the tree; only topics are renamed`);
      const name = change.name.trim().replace(/\s*\|\s*/g, " ").slice(0, 80) || root.name;
      if (name.toLowerCase() !== root.name.toLowerCase() && (vault.index.tree?.nodes ?? []).some((node) => node.name.toLowerCase() === name.toLowerCase())) {
        throw new DeskChangeError(`there is already a topic called "${name}"`);
      }
      const summary = change.summary?.trim().replace(/\s+/g, " ").replace(/\s*\|\s*/g, ", ").slice(0, 200) || root.summary;
      const lines = (await readText(vaultPath, TREE_PATH)).split("\n");
      const line = lines[root.line - 1]?.replace(/\r$/, "");
      if (!line) throw new DeskChangeError(`the topic line of "${root.name}" was not found`);
      const next = formatTreeNode({ name, kind: root.kind, path: root.path, summary, ...(root.id ? { id: root.id } : {}) });
      if (next !== line) await edit({ kind: "tree_replace", before: line, after: next });
      views.push(name !== root.name ? { what: "Topic renamed", before: root.name, after: name } : { what: `${root.name} described again`, before: root.summary, after: summary });
    } else if (change.op === "confirm") {
      const page = requirePage(vault, change.page, "page");
      const provisional = fieldValue(await readText(vaultPath, page), "provisional");
      if (provisional === null) continue;
      await edit({ kind: "field", file: page, key: "provisional", before: provisional, after: null });
      views.push({ what: `${vault.title(page)} confirmed where it is`, after: vault.place(page) });
    } else if (change.op === "link") {
      const from = requirePage(vault, change.from, "page");
      const to = requirePage(vault, change.to, "linked page");
      if (from === to) throw new DeskChangeError("a page does not link to itself");
      const body = parseNote(await readText(vaultPath, from)).body;
      if ([...body.matchAll(WIKILINK_RE)].some((m) => vault.resolve(m[1]!) === to)) continue;
      await edit({ kind: "line_add", file: from, line: `- [[${wikiTarget(to)}]]` });
      views.push({ what: `Linked ${vault.title(from)} to ${vault.title(to)}` });
    } else {
      const from = requirePage(vault, change.from, "page");
      const citation = citationOf(change.to);
      const page = citation ? undefined : requirePage(vault, change.to, "linked page");
      const body = parseNote(await readText(vaultPath, from)).body;
      const lines = linkLines(body, citation ? { citation } : { page: page! }, vault);
      if (lines.length === 0) throw new DeskChangeError(`"${vault.title(from)}" has no link line to ${change.to} that the desk may remove`);
      if (citation && !(await citedElsewhere(vaultPath, vault, citation, from))) {
        throw new DeskChangeError(`the note ${citation} is cited only on "${vault.title(from)}"; unlinking it would leave it unplaced`);
      }
      for (const line of lines) {
        const raw = await readText(vaultPath, from);
        const removed = removeLine(raw, line);
        if (!removed) continue;
        await edit({ kind: "line_remove", file: from, line, after: removed.after });
      }
      views.push({ what: citation ? `${lines.length === 1 ? "A note line" : `${lines.length} note lines`} taken off ${vault.title(from)}, still filed elsewhere` : `Unlinked ${vault.title(from)} from ${vault.title(page!)}` });
    }
  }
  return { edits, views };
}

const NAME_STOP = new Set(["and", "the", "for", "with", "notes", "note", "page", "topic", "project", "projects", "about", "from", "into", "los", "las", "del", "con", "para"]);
const nameWords = (text: string) => new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !NAME_STOP.has(word)));

/** A topic's name fits the page it sits on when they share a word (so "Idealista" never lands on the Poly-Maker page). */
export function nameFitsPage(name: string, title: string, path: string): boolean {
  const page = new Set([...nameWords(title), ...nameWords(basenameOf(path))]);
  return [...nameWords(name)].some((word) => page.has(word));
}

/**
 * Read-only check of a plan against the memory as it is, before anything is written: every page
 * exists, a move does not go under itself, a topic's name fits its
 * page and is not taken, an unlink has a line to remove. The problems are plain sentences for the
 * model to fix. The full check still runs when the plan is applied.
 */
export async function checkDeskPlan(vaultPath: string, plan: DeskPlan): Promise<string[]> {
  const vault = await loadDeskVault(vaultPath);
  const problems: string[] = [];
  const names = new Map((vault.index.tree?.nodes ?? []).map((node) => [node.name.toLowerCase(), vault.index.resolveRef(node.path)]));
  const roots = new Set([...vault.index.rootsByPath.keys()]);
  for (const change of plan.changes) {
    try {
      if (change.op === "move") {
        const page = requirePage(vault, change.page, "page");
        const to = requirePage(vault, change.to, "new place");
        if (page === to || isUnder(vault, to, page)) problems.push(`"${vault.title(page)}" cannot go under itself or under a page below it`);
      } else if (change.op === "confirm") {
        requirePage(vault, change.page, "page");
      } else if (change.op === "root" || change.op === "rename") {
        const page = requirePage(vault, change.page, change.op === "root" ? "page" : "topic");
        const title = vault.index.fields.get(page)?.title ?? basenameOf(page);
        if (change.op === "root" && roots.has(page.toLowerCase())) problems.push(`"${title}" is already a topic; use rename`);
        if (change.op === "rename" && !roots.has(page.toLowerCase())) problems.push(`"${title}" is not a topic; only topics are renamed (use root to make it one)`);
        const name = change.name.trim();
        if (name && !nameFitsPage(name, title, page)) problems.push(`the name "${name}" does not fit the page it sits on, "${title}"; name the topic after that page, or put the topic on another page`);
        const holder = names.get(name.toLowerCase());
        if (name && holder && holder !== page) problems.push(`there is already a topic called "${name}"`);
        if (change.op === "rename") for (const [key, value] of names) if (value === page) names.delete(key);
        if (name) names.set(name.toLowerCase(), page);
        roots.add(page.toLowerCase());
      } else if (change.op === "link") {
        requirePage(vault, change.from, "page");
        requirePage(vault, change.to, "linked page");
      } else {
        const from = requirePage(vault, change.from, "page");
        const citation = citationOf(change.to);
        const target = citation ? undefined : requirePage(vault, change.to, "linked page");
        const body = parseNote(await readText(vaultPath, from)).body;
        if (linkLines(body, citation ? { citation } : { page: target! }, vault).length === 0) problems.push(`"${vault.title(from)}" has no link line to ${change.to} that may be removed`);
        else if (citation && !(await citedElsewhere(vaultPath, vault, citation, from))) problems.push(`the note ${citation} is cited only on "${vault.title(from)}"; keep it there`);
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The guard

const LINK_LINE = /^\s*[-*] .*\[\[[^\]]+\]\]/;

function lineBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const line of text.split("\n")) {
    const key = line.replace(/\r$/, "");
    if (!key.trim()) continue;
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

/**
 * The desk's promise, checked on the files themselves before anything is committed: it never
 * rewrites the user's words and never deletes. Returns the problems (empty when the change is safe).
 * `restoring`: on Undo, the exact link lines the job took off, which may come back.
 */
export function checkDeskChanges(changes: readonly FileChange[], restoring: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [];
  for (const change of changes) {
    const path = change.path;
    if (change.before === null) { problems.push(`${path}: the desk never creates files`); continue; }
    if (change.after === null) { problems.push(`${path}: the desk never deletes`); continue; }
    if (path === TREE_PATH) continue;
    if (!isTreePage(path)) { problems.push(`${path}: the desk changes only the tree and its pages`); continue; }
    const before = parseNote(change.before);
    const after = parseNote(change.after);
    const strip = (fm: Record<string, unknown> | null) => JSON.stringify(Object.entries(fm ?? {}).filter(([key]) => key !== "parent" && key !== "memory" && key !== "provisional").sort(([a], [b]) => a.localeCompare(b)));
    if (strip(before.frontmatter) !== strip(after.frontmatter)) problems.push(`${path}: front matter changed beyond parent, memory and provisional`);
    const was = lineBag(before.body);
    const now = lineBag(after.body);
    for (const [line, count] of now) {
      const extra = count - (was.get(line) ?? 0);
      if (extra > 0 && !(line.trim() === RELATED_HEADING || /^- \[\[[^\]]+\]\]$/.test(line) || restoring.has(line))) problems.push(`${path}: a line was written that is not a link: ${line.slice(0, 80)}`);
    }
    for (const [line, count] of was) {
      const gone = count - (now.get(line) ?? 0);
      if (gone > 0 && !(line.trim() === RELATED_HEADING || LINK_LINE.test(line))) problems.push(`${path}: words were removed: ${line.slice(0, 80)}`);
    }
  }
  return problems;
}

/** Memories whose place in the tree changed, plus pages whose links changed: what "touched" counts. */
export async function deskTouched(before: TreeIndex, vaultPath: string, editedFiles: readonly string[]): Promise<number> {
  const after = await buildTreeIndex(vaultPath);
  const touched = new Set(editedFiles.filter((path) => path !== TREE_PATH));
  const place = (index: TreeIndex, path: string) => {
    const lineage = index.lineage(path);
    return lineage.ok ? formatLineage(lineage) : `!${lineage.reason}`;
  };
  for (const path of new Set([...before.fields.keys(), ...after.fields.keys()])) {
    if (place(before, path) !== place(after, path)) touched.add(path);
  }
  return touched.size;
}

// ---------------------------------------------------------------------------------------------
// The agent

export interface DeskReadTools {
  search(query: string): Promise<string>;
  read(page: string): Promise<string>;
  tree(): Promise<string>;
  children(page: string): Promise<string>;
  links(page: string): Promise<string>;
  /** What grew lately: notes saved in the last N days, and under which topics they were filed. */
  recent(days: string): Promise<string>;
}

/** The longest window the recent tool looks back. */
const RECENT_MAX_DAYS = 90;
const topicCount = (n: number) => `${n} topic${n === 1 ? "" : "s"}`;
const noteCount = (n: number) => `${n} note${n === 1 ? "" : "s"}`;

/** The desk's read-only tools over a vault working tree (search comes from the engine's index). */
export function deskReadTools(
  vaultPath: string,
  search: (query: string) => Promise<Array<{ path: string; title?: string; treePath?: string }>>,
  now: () => Date = () => new Date(),
): DeskReadTools {
  const vault = () => loadDeskVault(vaultPath);
  const count = (index: TreeIndex, path: string): number => index.children(path).reduce((sum, child) => sum + 1 + count(index, child), 0);
  return {
    async search(query) {
      const hits = (await search(query)).filter((hit) => !hit.path.startsWith("Log/")).slice(0, 8);
      return hits.length ? hits.map((hit) => `- ${hit.path} · ${hit.title ?? basenameOf(hit.path)} · ${hit.treePath || "not placed"}`).join("\n") : "no pages found";
    },
    async read(page) {
      const v = await vault();
      const path = requirePage(v, page, "page");
      const raw = await readText(vaultPath, path);
      const { frontmatter, body } = parseNote(raw);
      const citations = [...body.matchAll(CITATION_RE)].length;
      return [
        `path: ${path}`, `title: ${v.title(path)}`, `place: ${v.place(path)}`, `parent: ${fieldValue(raw, "parent") ?? "none"}`,
        `summary: ${typeof frontmatter?.summary === "string" ? frontmatter.summary : ""}`, `cites ${citations} notes`, "", body.slice(0, 1_800),
      ].join("\n");
    },
    async tree() {
      const v = await vault();
      const lines = (v.index.tree?.nodes ?? []).map((node) => {
        const path = v.index.resolveRef(node.path) ?? node.path;
        const kids = v.index.children(path);
        const shown = kids.slice(0, 6).map((child) => `${v.title(child)} (${count(v.index, child)} under it)`).join("; ");
        return `- topic "${node.name}" | ${node.kind} | sits on page ${path} titled "${v.index.fields.get(path)?.title ?? basenameOf(path)}" | ${count(v.index, path)} pages under it${shown ? ` | directly under it: ${shown}${kids.length > 6 ? `; and ${kids.length - 6} more` : ""}` : ""}`;
      });
      return lines.length ? lines.join("\n") : "the memory has no tree yet";
    },
    async children(page) {
      const v = await vault();
      const path = requirePage(v, page, "page");
      const kids = v.index.children(path);
      return kids.length ? kids.map((child) => `- ${child} · ${v.title(child)} · ${count(v.index, child)} under it`).join("\n") : `nothing under ${v.title(path)}`;
    },
    async links(page) {
      const v = await vault();
      const path = requirePage(v, page, "page");
      const body = parseNote(await readText(vaultPath, path)).body;
      const out = new Set<string>();
      for (const m of body.matchAll(WIKILINK_RE)) {
        if (/^#\^e-/.test(m[2] ?? "")) continue;
        const target = v.resolve(m[1]!);
        if (target && target !== path) out.add(`- links to ${target} · ${v.title(target)}`);
      }
      const notes = body.split("\n").filter((line) => [...line.matchAll(CITATION_RE)].length > 0).slice(0, 30);
      return [...out, ...(notes.length ? ["note lines on this page:", ...notes.map((line) => line.trim().slice(0, 200))] : [])].join("\n") || "no links";
    },
    async recent(days) {
      const v = await vault();
      const span = Math.min(RECENT_MAX_DAYS, Math.max(1, Number.parseInt(days, 10) || 7));
      const today = now();
      const since = new Date(today.getTime() - (span - 1) * 86_400_000).toISOString().slice(0, 10);
      let saved = 0;
      for (const [date, anchors] of v.snapshot.anchors) if (date >= since) saved += anchors.size;
      // Each recent note counts once per topic it was filed under, wherever under that topic.
      const byTopic = new Map<string, { notes: Set<string>; pages: Set<string> }>();
      const filed = new Set<string>();
      for (const path of v.index.fields.keys()) {
        const body = parseNote(await readText(vaultPath, path)).body;
        const notes = [...body.matchAll(CITATION_RE)].filter((m) => m[1]! >= since).map((m) => `${m[1]}#${m[2]}`);
        if (notes.length === 0) continue;
        const lineage = v.index.lineage(path);
        const topic = lineage.ok ? `root topic "${lineage.root.name}" (${lineage.group})` : "pages not placed in the tree";
        const entry = byTopic.get(topic) ?? { notes: new Set<string>(), pages: new Set<string>() };
        for (const note of notes) { entry.notes.add(note); filed.add(note); }
        entry.pages.add(v.title(path));
        byTopic.set(topic, entry);
      }
      const rows = [...byTopic].sort((a, b) => b[1].notes.size - a[1].notes.size);
      return [
        `last ${span} days (${since} to ${today.toISOString().slice(0, 10)}): ${noteCount(saved)} saved, ${filed.size} of them filed on pages; ${rows.filter(([topic]) => topic.startsWith("root topic")).length} of your ${topicCount(v.index.tree?.nodes.length ?? 0).replace("topic", "root topic")} (the top-level topics of the tree) got new notes, all listed here`,
        ...rows.slice(0, 25).map(([topic, entry]) => `- ${topic}: ${entry.notes.size} new ${entry.notes.size === 1 ? "note" : "notes"} on ${entry.pages.size} ${entry.pages.size === 1 ? "page" : "pages"} (${[...entry.pages].slice(0, 4).join("; ")}${entry.pages.size > 4 ? "; …" : ""})`),
        ...(rows.length > 25 ? [`- and ${rows.length - 25} more topics`] : []),
      ].join("\n");
    },
  };
}

const DESK_SYSTEM = [
  "You are the memory desk of a personal memory app. The person asks for a job on their memory (re-file, split, join, move, relink or rename topics) or asks a question about it (what grew lately, how many, where something is filed). You work in steps. Each step you reply with ONE line of JSON and nothing else.",
  "Read with these tools (one per step):",
  '{"tool":"tree"} the topics of the tree, with how many pages are under each',
  '{"tool":"search","query":"words"} pages that match, with their place in the tree',
  '{"tool":"read","page":"path"} one page: its place, parent, summary and text',
  '{"tool":"children","page":"path"} the pages directly under a page',
  '{"tool":"links","page":"path"} the pages it links to and the note lines it cites',
  '{"tool":"recent","days":7} notes saved in the last N days and the topics they were filed under, with counts',
  "When the person asked a question, read what you need (one or two steps is usually enough) and finish with:",
  '{"answer":"plain sentences: first the number or fact asked for, then each topic it covers by name with its count, most first (up to ten)"}',
  "When you know what to change, finish with:",
  '{"done":true,"title":"short name of the job","summary":"one or two sentences: what changes","search":"a search the person would run to see the difference","changes":[...]}',
  "Changes you may make (use page paths you have seen):",
  '{"op":"move","page":"path","to":"path"} hang a page (and everything under it) under another page',
  '{"op":"root","page":"path","name":"Topic","kind":"long-term" or "working","summary":"one sentence"} make a page its own topic at the top of the tree',
  '{"op":"rename","page":"path of a topic","name":"New name","summary":"one sentence"} rename a topic or fix its one-line summary',
  '{"op":"link","from":"path","to":"path"} add a link between two pages',
  '{"op":"unlink","from":"path","to":"path or 2026-01-31#^e-abc123"} remove a link line, or a note line cited on the wrong page (only when the note is cited on another page too)',
  "A topic's name must fit the page it sits on (share a word with that page's title).",
  "Playbook to split a topic that holds two subjects A and B: rename the topic to fit the page it sits on (say that page is about A); make B's main page its own topic with op root; move B's pages that hang elsewhere under B's page; unlink note lines about A that were copied onto B's pages when the same note is cited on an A page.",
  "Rules: you never rewrite the person's words and never delete anything; you only change where things are filed, the topics, and links. If the job asks to delete, rewrite text, or anything else outside these changes, or it is unclear, reply {\"refuse\":\"one plain sentence why\"}. Never change anything to answer a question. Make the fewest changes that do the job. Reply in the person's language for title, summary and answer.",
].join("\n");

export type DeskAgentOutcome =
  | { status: "plan"; plan: DeskPlan; steps: number; inputChars: number }
  | { status: "answer"; answer: string; steps: number; inputChars: number }
  | { status: "refused"; reason: string; steps: number; inputChars: number };

export interface DeskAgentOptions {
  request: string;
  /** Read-only check of a plan before it is returned; its problems go back to the model as a step. */
  check?(plan: DeskPlan): Promise<string[]>;
  /** One call on the chat model: system and prompt in, its whole reply out. */
  call(input: { system: string; prompt: string }): Promise<string>;
  tools: DeskReadTools;
  maxSteps?: number;
  maxInputChars?: number;
  /** The step the job is on, in plain words, for the inbox. */
  onStep?(step: string): void;
  assertActive?(): void;
}

function readJson(output: string): Record<string, unknown> | null {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Read a plan from the model's final JSON; null when it is not a usable plan. */
export function parseDeskPlan(value: Record<string, unknown>, request: string): DeskPlan | null {
  if (!Array.isArray(value.changes)) return null;
  const changes: DeskChange[] = [];
  for (const raw of value.changes as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const op = str(c.op);
    if (op === "move" && str(c.page) && str(c.to)) changes.push({ op, page: str(c.page), to: str(c.to) });
    else if (op === "root" && str(c.page) && str(c.name)) changes.push({ op, page: str(c.page), name: str(c.name), kind: str(c.kind) === "working" ? "working" : "long-term", ...(str(c.summary) ? { summary: str(c.summary) } : {}) });
    else if (op === "rename" && str(c.page) && (str(c.name) || str(c.summary))) changes.push({ op, page: str(c.page), name: str(c.name), ...(str(c.summary) ? { summary: str(c.summary) } : {}) });
    else if ((op === "link" || op === "unlink") && str(c.from) && str(c.to)) changes.push({ op, from: str(c.from), to: str(c.to) });
  }
  if (changes.length === 0) return null;
  return {
    title: (str(value.title) || request).replace(/\s+/g, " ").slice(0, 120),
    summary: str(value.summary).slice(0, 600) || `${changes.length} change${changes.length === 1 ? "" : "s"} to how your memory is filed.`,
    search: str(value.search).slice(0, 120),
    changes: changes.slice(0, DESK_MAX_CHANGES),
  };
}

function stepLabel(tool: string, arg: string): string {
  const name = basenameOf(arg || "");
  if (tool === "tree") return "Reading your topics";
  if (tool === "search") return `Searching "${arg.slice(0, 60)}"`;
  if (tool === "read") return `Reading ${name}`;
  if (tool === "children") return `Looking under ${name}`;
  if (tool === "links") return `Checking the links of ${name}`;
  if (tool === "recent") return `Looking at what you saved in the last ${Number.parseInt(arg, 10) || 7} days`;
  return "Thinking";
}

const QUESTION_START = /^(how|what|when|which|who|whom|where|why|is|are|was|were|do|does|did|have|has|can|could|should|show me|list|tell me|give me|qu[eé]|cu[aá]nt[oa]s?|cu[aá]l(es)?|c[oó]mo|d[oó]nde|cu[aá]ndo|por qu[eé])\b/i;
const CHANGE_WORDS = /\b(move|moving|split|separate|untangle|join|merge|combine|rename|re-?file|refile|file .+ under|put .+ under|hang .+ under|link|unlink|relink|tidy|clean up|reorgani[sz]e|make .+ (its own )?topic|filed wrong|mueve|mover|separa|une|junta|renombra|enlaza|archiva)\b/i;

/**
 * True when a request reads as a question about the memory rather than a change to it ("How many
 * root memories added to in last 7 days?"). Plain rules only: a question that also names a change
 * ("can you move the boiler notes under House?") is a job.
 */
export function isDeskQuestion(request: string): boolean {
  const text = request.trim();
  if (!text || CHANGE_WORDS.test(text)) return false;
  return text.endsWith("?") || text.startsWith("¿") || QUESTION_START.test(text);
}

/**
 * The desk's tool loop: at most maxSteps model calls, each one JSON line. Read tools only; the
 * changes come back as a plan the host checks and applies. Out of steps or budget, it is refused
 * with the reason, never applied half-done.
 */
export async function runDeskAgent(options: DeskAgentOptions): Promise<DeskAgentOutcome> {
  const maxSteps = Math.max(2, options.maxSteps ?? DESK_MAX_STEPS);
  const budget = options.maxInputChars ?? DESK_MAX_INPUT_CHARS;
  const transcript: string[] = [];
  const question = isDeskQuestion(options.request);
  let inputChars = 0;
  for (let step = 1; step <= maxSteps; step++) {
    options.assertActive?.();
    const last = step === maxSteps;
    // Oldest tool results go first when the prompt grows past its cap.
    let kept = transcript;
    while (kept.join("\n\n").length > DESK_PROMPT_CHARS && kept.length > 1) kept = kept.slice(1);
    const history = `${kept.length < transcript.length ? "(earlier steps trimmed)\n\n" : ""}${kept.join("\n\n")}`;
    const prompt = [
      `JOB\n${options.request}`,
      question ? 'This reads as a question about the memory, not a change: read what you need and reply with {"answer":"..."}. Change nothing.' : "",
      history ? `SO FAR\n${history}` : "",
      `Step ${step} of ${maxSteps}.${last ? ` This is your last step: reply with ${question ? "answer, from what you read so far" : "done, answer or refuse"}.` : ""} Reply with one line of JSON.`,
    ].filter(Boolean).join("\n\n");
    inputChars += DESK_SYSTEM.length + prompt.length;
    if (inputChars > budget) return { status: "refused", reason: "The job needed more reading than one job may do. Ask for a smaller part of it.", steps: step - 1, inputChars };
    const output = await options.call({ system: DESK_SYSTEM, prompt });
    const value = readJson(output);
    if (!value) {
      transcript.push(`step ${step}: your reply was not JSON. Reply with one line of JSON.`);
      continue;
    }
    if (str(value.answer)) return { status: "answer", answer: str(value.answer).slice(0, 1_500), steps: step, inputChars };
    if (str(value.refuse)) return { status: "refused", reason: str(value.refuse).slice(0, 300), steps: step, inputChars };
    if (value.done === true || Array.isArray(value.changes)) {
      const plan = parseDeskPlan(value, options.request);
      const problems = plan && options.check ? await options.check(plan) : [];
      if (plan && problems.length === 0) return { status: "plan", plan, steps: step, inputChars };
      if (plan) {
        if (last) return { status: "refused", reason: `The desk's plan did not fit your memory: ${problems[0]}`, steps: step, inputChars };
        options.onStep?.("Checking the plan again");
        transcript.push(`step ${step}: your plan was not accepted:\n${problems.slice(0, 5).map((problem) => `- ${problem}`).join("\n")}\nFix it (read more if you need to) and reply with done again.`);
        continue;
      }
      transcript.push(`step ${step}: done had no usable changes. Use the change shapes listed.`);
      continue;
    }
    const tool = str(value.tool);
    const arg = str(value.query) || str(value.page) || (typeof value.days === "number" || typeof value.days === "string" ? String(value.days).trim() : "");
    if (!["tree", "search", "read", "children", "links", "recent"].includes(tool) || (tool !== "tree" && tool !== "recent" && !arg)) {
      transcript.push(`step ${step}: unknown tool. Use tree, search, read, children, links or recent.`);
      continue;
    }
    options.onStep?.(stepLabel(tool, arg));
    let result: string;
    try {
      result = await options.tools[tool as keyof DeskReadTools](arg);
    } catch (error) {
      result = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    transcript.push(`step ${step}: ${JSON.stringify({ tool, ...(arg ? { arg } : {}) })}\n${result.slice(0, TOOL_RESULT_CHARS)}`);
  }
  return {
    status: "refused",
    reason: question
      ? `The desk read your memory ${maxSteps} times and still had no answer. Nothing changed.`
      : `The desk read your memory ${maxSteps} times without settling on a change. Nothing changed. Say exactly what to move, split, join, link or rename.`,
    steps: maxSteps,
    inputChars,
  };
}

// ---------------------------------------------------------------------------------------------
// The engine's desk job

export interface DeskJobInput {
  /** The person's request, in their words. */
  request: string;
  /** An approved plan (a big job the person said yes to): applied as is, no agent. */
  plan?: DeskPlan;
  /** Above this many touched memories the job stops before committing and returns needs_go. */
  maxTouched?: number;
  maxSteps?: number;
  onStep?(step: string): void;
  assertActive?(): void;
}

export interface DeskAgentUse {
  steps: number;
  inputChars: number;
}

export type DeskJobResult =
  | {
    status: "done";
    plan: DeskPlan;
    edits: DeskEdit[];
    changes: DeskChangeView[];
    touched: number;
    search: { query: string; before: string[]; after: string[] };
    revision: import("../vault/repository.js").VaultRevision;
    agent: DeskAgentUse;
  }
  | { status: "needs_go"; plan: DeskPlan; changes: DeskChangeView[]; touched: number; agent: DeskAgentUse }
  | { status: "answered"; answer: string; agent: DeskAgentUse }
  | { status: "refused" | "nothing"; reason: string; plan?: DeskPlan; agent: DeskAgentUse };

export interface DeskUndoResult {
  revision: import("../vault/repository.js").VaultRevision | null;
  undone: number;
  skipped: number;
}
