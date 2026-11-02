import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTreeIndex, formatTreeNode, parseTree, TREE_PATH, type TreeNode } from "../vault/tree.js";
import {
  appendKeeperNote,
  keeperAliasGroups,
  type KeeperNote,
  MAX_ROOT_NAME,
  parseKeeperNotes,
  pageSteering,
  UNSAFE_NAME_RE,
  withSteeringFields,
} from "../vault/treeSteering.js";
import { parseNote } from "../vault/frontmatter.js";
import type { TrackedWrites } from "./treePlacement.js";

/**
 * Steer a root (EPIC-9 E9-5b Memory tab; E9-5e by message). Writes one Keeper note to Tree.md and,
 * where the rule has one, the root's flag to its page (`pinned: true` / `name-locked: true` /
 * `aliases: [...]`); for a rename, also the root's Tree.md line. A close or keep-apart is the note
 * alone: discovery moves a closed root to long-term on its next run. The caller commits it as one
 * revision under the vault write lock, the same path a filing takes. Never touches Log/ or any other page.
 */

export type TreeSteerAction = "pin" | "rename" | "alias" | "keep-apart" | "close";

export interface TreeSteerInput {
  action: TreeSteerAction;
  /** The root: its stable id (`n-1a2b3c4d`) or its page path. */
  root: string;
  /** New name (rename only). */
  name?: string;
  /** Other names for the root (alias only). */
  aliases?: string[];
  /** The other roots, by id or page path (keep-apart only). */
  others?: string[];
  /** YYYY-MM-DD for the note's confirmed date. */
  today: string;
  /** Where the steer came from, recorded as the note's "why". */
  source?: string;
}

export interface TreeSteerResult {
  /** False when the root already was pinned / already had that name. */
  changed: boolean;
  /** `K-<n>` of the note written. */
  note: string | null;
  root: { id: string | null; name: string; path: string };
  /** The other roots' names (keep-apart only). */
  others?: string[];
  paths: string[];
}

export class TreeSteerError extends Error {
  constructor(readonly code: "no_tree" | "unknown_root" | "invalid_name" | "name_taken" | "invalid_action", message: string) {
    super(message);
    this.name = "TreeSteerError";
  }
}

/** A valid root name, trimmed; throws TreeSteerError otherwise. */
export function validRootName(name: unknown): string {
  const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!clean || clean.length > MAX_ROOT_NAME || UNSAFE_NAME_RE.test(clean)) {
    throw new TreeSteerError("invalid_name", `a root name is 1–${MAX_ROOT_NAME} characters without | ^ [ ] #`);
  }
  return clean;
}

const ACTIONS: readonly TreeSteerAction[] = ["pin", "rename", "alias", "keep-apart", "close"];

/** The last pin or close note on a root, in file order (the later one wins, as in discovery). */
function lastPinOrClose(notes: readonly KeeperNote[], node: TreeNode): "pinned" | "closed" | null {
  let last: "pinned" | "closed" | null = null;
  for (const note of notes) {
    if (note.rule.kind !== "pinned" && note.rule.kind !== "closed") continue;
    if (note.targets.some(t => (t.id && t.id === node.id) || t.name.toLowerCase() === node.name.toLowerCase())) last = note.rule.kind;
  }
  return last;
}

export async function steerTreeRoot(vaultPath: string, input: TreeSteerInput, writes: TrackedWrites): Promise<TreeSteerResult> {
  if (!ACTIONS.includes(input.action)) throw new TreeSteerError("invalid_action", `action must be one of ${ACTIONS.join(", ")}`);
  const treeRaw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => null);
  if (treeRaw === null) throw new TreeSteerError("no_tree", "this vault has no memory tree yet");
  const index = await buildTreeIndex(vaultPath);
  const tree = parseTree(treeRaw);
  const wanted = input.root.trim().replace(/^\^/, "");
  const pathOf = (node: TreeNode) => index.resolveRef(node.path) ?? node.path;
  const find = (ref: string) => {
    const want = ref.trim().replace(/^\^/, "");
    const hit = tree.nodes.find(n => n.id && n.id === want) ?? tree.nodes.find(n => pathOf(n).toLowerCase() === want.toLowerCase());
    if (!hit || !index.fields.has(pathOf(hit))) throw new TreeSteerError("unknown_root", "no such root in this memory tree");
    return hit;
  };
  const node = find(wanted);
  const pagePath = pathOf(node);
  const pageRaw = await readFile(join(vaultPath, pagePath), "utf8");
  const flags = pageSteering(parseNote(pageRaw).frontmatter);
  const why = input.source ?? "set in the Memory tab";
  const result = (changed: boolean, note: string | null, name: string, paths: string[]): TreeSteerResult =>
    ({ changed, note, root: { id: node.id ?? null, name, path: pagePath }, paths });

  const target = (n: TreeNode) => ({ name: n.name, ...(n.id ? { id: n.id } : {}) });
  const { notes } = parseKeeperNotes(treeRaw);

  if (input.action === "close") {
    if (lastPinOrClose(notes, node) === "closed") return result(false, null, node.name, []);
    const { raw, id } = appendKeeperNote(treeRaw, { targets: [target(node)], rule: { kind: "closed" }, why: `closed ${why}`, confirmed: input.today });
    await writes.write(TREE_PATH, raw);
    return result(true, id, node.name, [TREE_PATH]);
  }

  if (input.action === "keep-apart") {
    const others = (input.others ?? []).map(find).filter(n => n !== node);
    const all = [node, ...others.filter((n, i) => others.indexOf(n) === i)];
    if (all.length < 2) throw new TreeSteerError("unknown_root", "keep apart needs two different roots");
    const already = notes.some(n => n.rule.kind === "keep-apart" && all.every(a => n.targets.some(t => (t.id && t.id === a.id) || t.name.toLowerCase() === a.name.toLowerCase())));
    const names = all.slice(1).map(n => n.name);
    if (already) return { ...result(false, null, node.name, []), others: names };
    const { raw, id } = appendKeeperNote(treeRaw, { targets: all.map(target), rule: { kind: "keep-apart" }, why: `kept apart ${why}`, confirmed: input.today });
    await writes.write(TREE_PATH, raw);
    return { ...result(true, id, node.name, [TREE_PATH]), others: names };
  }

  if (input.action === "alias") {
    const known = new Set([node.name, ...flags.aliases, ...keeperAliasGroups(notes).filter(g => g.some(a => a.toLowerCase() === node.name.toLowerCase())).flat()].map(a => a.toLowerCase()));
    const fresh = [...new Set((input.aliases ?? []).map(validRootName))].filter(a => !known.has(a.toLowerCase()));
    if (!fresh.length) return result(false, null, node.name, []);
    const { raw, id } = appendKeeperNote(treeRaw, { targets: [target(node)], rule: { kind: "aliases", aliases: fresh }, why: `aliases ${why}`, confirmed: input.today });
    await writes.write(TREE_PATH, raw);
    const page = withSteeringFields(pageRaw, { aliases: fresh });
    if (page !== null) await writes.write(pagePath, page);
    return result(true, id, node.name, page !== null ? [TREE_PATH, pagePath] : [TREE_PATH]);
  }

  if (input.action === "pin") {
    if (flags.pinned && lastPinOrClose(notes, node) !== "closed") return result(false, null, node.name, []);
    const { raw, id } = appendKeeperNote(treeRaw, { targets: [target(node)], rule: { kind: "pinned" }, why: `pinned ${why}`, confirmed: input.today });
    await writes.write(TREE_PATH, raw);
    const page = withSteeringFields(pageRaw, { pinned: true, nameLocked: true });
    if (page !== null) await writes.write(pagePath, page);
    return result(true, id, node.name, page !== null ? [TREE_PATH, pagePath] : [TREE_PATH]);
  }

  const name = validRootName(input.name);
  if (name === node.name) return result(false, null, node.name, []);
  if (tree.nodes.some(n => n !== node && n.name.toLowerCase() === name.toLowerCase())) {
    throw new TreeSteerError("name_taken", `another root is already called "${name}"`);
  }
  const lines = treeRaw.split("\n");
  lines[node.line - 1] = formatTreeNode({ ...node, name });
  const renamed = lines.join("\n");
  const { raw, id } = appendKeeperNote(renamed, { targets: [target(node)], rule: { kind: "name", name }, why: `renamed from "${node.name}" ${why}`.replace(/"/g, "'"), confirmed: input.today });
  await writes.write(TREE_PATH, raw);
  const page = withSteeringFields(pageRaw, { nameLocked: true });
  if (page !== null) await writes.write(pagePath, page);
  return result(true, id, name, page !== null ? [TREE_PATH, pagePath] : [TREE_PATH]);
}

/**
 * The roots of Tree.md with their page paths and every other name (page `aliases:` and Keeper-note
 * alias groups), for steering by message (E9-5e). Empty when the vault has no tree.
 */
export async function loadSteerRoots(vaultPath: string): Promise<Array<{ node: TreeNode; path: string; aliases: string[] }>> {
  const treeRaw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => null);
  if (treeRaw === null) return [];
  const index = await buildTreeIndex(vaultPath);
  const groups = keeperAliasGroups(parseKeeperNotes(treeRaw).notes);
  const roots = [];
  for (const node of parseTree(treeRaw).nodes) {
    const path = index.resolveRef(node.path) ?? node.path;
    if (!index.fields.has(path)) continue;
    const page = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    const own = pageSteering(parseNote(page).frontmatter).aliases;
    const grouped = groups.filter(g => g.some(a => a.toLowerCase() === node.name.toLowerCase())).flat();
    const aliases = [...new Set([...own, ...grouped])].filter(a => a.toLowerCase() !== node.name.toLowerCase());
    roots.push({ node, path, aliases });
  }
  return roots;
}
