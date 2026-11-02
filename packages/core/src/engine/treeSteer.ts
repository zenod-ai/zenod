import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTreeIndex, formatTreeNode, parseTree, TREE_PATH, type TreeNode } from "../vault/tree.js";
import {
  appendKeeperNote,
  MAX_ROOT_NAME,
  pageSteering,
  UNSAFE_NAME_RE,
  withSteeringFields,
} from "../vault/treeSteering.js";
import { parseNote } from "../vault/frontmatter.js";
import type { TrackedWrites } from "./treePlacement.js";

/**
 * Pin or rename a root from the Memory tab (EPIC-9 E9-5b). Writes one Keeper note to Tree.md,
 * the root's flag to its page (`pinned: true` / `name-locked: true`) and, for a rename, the
 * root's Tree.md line. The caller commits it as one revision under the vault write lock, the
 * same path a filing takes. Never touches Log/ or any other page.
 */

export type TreeSteerAction = "pin" | "rename";

export interface TreeSteerInput {
  action: TreeSteerAction;
  /** The root: its stable id (`n-1a2b3c4d`) or its page path. */
  root: string;
  /** New name (rename only). */
  name?: string;
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

export async function steerTreeRoot(vaultPath: string, input: TreeSteerInput, writes: TrackedWrites): Promise<TreeSteerResult> {
  if (input.action !== "pin" && input.action !== "rename") throw new TreeSteerError("invalid_action", "action must be pin or rename");
  const treeRaw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => null);
  if (treeRaw === null) throw new TreeSteerError("no_tree", "this vault has no memory tree yet");
  const index = await buildTreeIndex(vaultPath);
  const tree = parseTree(treeRaw);
  const wanted = input.root.trim().replace(/^\^/, "");
  const pathOf = (node: TreeNode) => index.resolveRef(node.path) ?? node.path;
  const node = tree.nodes.find(n => n.id && n.id === wanted) ?? tree.nodes.find(n => pathOf(n).toLowerCase() === wanted.toLowerCase());
  if (!node || !index.fields.has(pathOf(node))) throw new TreeSteerError("unknown_root", "no such root in this memory tree");
  const pagePath = pathOf(node);
  const pageRaw = await readFile(join(vaultPath, pagePath), "utf8");
  const flags = pageSteering(parseNote(pageRaw).frontmatter);
  const why = input.source ?? "set in the Memory tab";
  const result = (changed: boolean, note: string | null, name: string, paths: string[]): TreeSteerResult =>
    ({ changed, note, root: { id: node.id ?? null, name, path: pagePath }, paths });

  if (input.action === "pin") {
    if (flags.pinned) return result(false, null, node.name, []);
    const { raw, id } = appendKeeperNote(treeRaw, { targets: [{ name: node.name, ...(node.id ? { id: node.id } : {}) }], rule: { kind: "pinned" }, why: `pinned ${why}`, confirmed: input.today });
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
  const { raw, id } = appendKeeperNote(renamed, { targets: [{ name: node.name, ...(node.id ? { id: node.id } : {}) }], rule: { kind: "name", name }, why: `renamed from "${node.name}" ${why}`.replace(/"/g, "'"), confirmed: input.today });
  await writes.write(TREE_PATH, raw);
  const page = withSteeringFields(pageRaw, { nameLocked: true });
  if (page !== null) await writes.write(pagePath, page);
  return result(true, id, name, page !== null ? [TREE_PATH, pagePath] : [TREE_PATH]);
}
