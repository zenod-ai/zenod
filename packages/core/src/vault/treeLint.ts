import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseKeeperNotes } from "./treeSteering.js";
import { basenameOf, isFilingReceiptPath, isIndexFile, tierOf } from "./files.js";
import { scanVault, type VaultSnapshot } from "./pages.js";
import {
  buildTreeIndex,
  GROUP_HEADINGS,
  isTreeParentRef,
  MAX_TREE_DEPTH,
  TREE_PARENT,
  TREE_PATH,
  type MemoryKind,
  type TreeIndex,
} from "./tree.js";

export interface TreeLintIssue {
  path: string;
  line?: number;
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export interface TreeLintStats {
  /** Meaning pages the tree must place (Areas/Projects/Notes, minus index pages). */
  treePages: number;
  /** Pages whose lineage reaches a Tree.md root within the depth limit. */
  rooted: number;
  rootNodes: Record<MemoryKind, number>;
  withoutParent: number;
  unresolvedParent: number;
  /** Pages with `parent: [[Tree]]` that Tree.md does not list as a root. */
  parentNotInTree: number;
  cycles: number;
  tooDeep: number;
  memoryMismatch: number;
  /** Groups of tree pages sharing a title (case-insensitive). */
  duplicateTitleGroups: number;
  duplicateTitlePages: number;
  /** Inbox files Zenod wrote for failed/uncertain filing (needs-filing stubs + receipts); out of the tree's scope. */
  inboxMachineFiles: number;
  /** Markdown outside Log/, Inbox/, _attachments/ and the meaning folders (excluding Tree.md and root index/AGENTS files). */
  outsideSchema: number;
}

export interface TreeLintReport {
  ok: boolean;
  hasTree: boolean;
  issues: TreeLintIssue[];
  stats: TreeLintStats;
}

/**
 * Tree lint (EPIC-9 E9-2a): every meaning page has a resolvable `parent`, the
 * chain ends at a node listed in Tree.md, no cycles, depth ≤ MAX_TREE_DEPTH,
 * root pages agree with Tree.md on their group, and duplicate titles are
 * reported. Read-only. Shared by the CLI, the librarian (E9-2b) and the sweep (E9-2d).
 */
export async function lintTree(vaultPath: string, options: { snapshot?: VaultSnapshot; index?: TreeIndex } = {}): Promise<TreeLintReport> {
  const snapshot = options.snapshot ?? (await scanVault(vaultPath));
  const index = options.index ?? (await buildTreeIndex(vaultPath, snapshot));
  const report = lintTreeIndex(index, snapshot.files);
  // Keeper notes (E9-5b) are steering the keeper obeys: a malformed one would be silently ignored.
  const raw = index.tree ? await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => "") : "";
  for (const p of parseKeeperNotes(raw).problems) report.issues.push({ path: TREE_PATH, line: p.line, rule: p.rule, severity: "error", message: p.message });
  report.ok = !report.issues.some(i => i.severity === "error");
  return report;
}

/** Pure lint over an already-built index; `files` is every vault-relative markdown path. */
export function lintTreeIndex(index: TreeIndex, files: string[]): TreeLintReport {
  const issues: TreeLintIssue[] = [];
  const error = (path: string, rule: string, message: string, line?: number) =>
    issues.push({ path, rule, severity: "error", message, ...(line ? { line } : {}) });
  const stats: TreeLintStats = {
    treePages: index.fields.size, rooted: 0, rootNodes: { working: 0, "long-term": 0 },
    withoutParent: 0, unresolvedParent: 0, parentNotInTree: 0, cycles: 0, tooDeep: 0, memoryMismatch: 0,
    duplicateTitleGroups: 0, duplicateTitlePages: 0, inboxMachineFiles: 0, outsideSchema: 0,
  };

  for (const file of files) {
    if (tierOf(file) === "inbox" && (isFilingReceiptPath(file) || /^Inbox\/needs-filing-/.test(file))) stats.inboxMachineFiles++;
    if (tierOf(file) === "other" && file !== TREE_PATH && !(file.split("/").length === 1 && (isIndexFile(file) || basenameOf(file) === "AGENTS"))) stats.outsideSchema++;
  }

  const tree = index.tree;
  if (!tree) {
    error(TREE_PATH, "tree/missing", `vault has no ${TREE_PATH}; seed one with \`zenod tree seed\``);
  } else {
    for (const p of tree.problems) error(TREE_PATH, p.rule, p.message, p.line);
    const names = new Map<string, number>();
    const paths = new Map<string, number>();
    const ids = new Map<string, number>();
    for (const node of tree.nodes) {
      if (node.id && ids.has(node.id)) error(TREE_PATH, "tree/node-duplicate", `root id ^${node.id} repeats line ${ids.get(node.id)}`, node.line);
      else if (node.id) ids.set(node.id, node.line);
      stats.rootNodes[node.kind]++;
      const nameKey = node.name.toLowerCase();
      if (names.has(nameKey)) error(TREE_PATH, "tree/node-duplicate", `node name "${node.name}" repeats line ${names.get(nameKey)}`, node.line);
      else names.set(nameKey, node.line);
      const resolved = index.resolveRef(node.path);
      const pathKey = (resolved ?? node.path).toLowerCase();
      if (paths.has(pathKey)) error(TREE_PATH, "tree/node-duplicate", `page ${node.path} is already the page of line ${paths.get(pathKey)}`, node.line);
      else paths.set(pathKey, node.line);
      if (!resolved || !index.fields.has(resolved)) {
        error(TREE_PATH, "tree/node-page-missing", `node "${node.name}" points at ${node.path}, which is not a meaning page in the vault`, node.line);
        continue;
      }
      const f = index.fields.get(resolved)!;
      if (!f.parent || !isTreeParentRef(f.parent)) {
        error(resolved, "tree/root-parent", `root page of "${node.name}" must carry \`parent: "${TREE_PARENT}"\``);
      }
      if (f.memory !== node.kind) {
        error(resolved, "tree/root-memory", `root page of "${node.name}" must carry \`memory: ${node.kind}\` (Tree.md lists it under ${GROUP_HEADINGS[node.kind]})`);
      }
    }
  }

  for (const [path, f] of index.fields) {
    if (f.invalidParent !== undefined) error(path, "page/parent-invalid", "parent must be a wikilink or vault path string");
    if (f.invalidMemory !== undefined) error(path, "page/memory-invalid", `memory is "${String(f.invalidMemory)}"; use working or long-term`);
    const isRoot = index.rootsByPath.has(path.toLowerCase());
    const result = index.lineage(path);
    if (result.ok) {
      stats.rooted++;
      if (f.memory && f.memory !== result.group && !isRoot) {
        stats.memoryMismatch++;
        error(path, "page/memory-mismatch", `memory is ${f.memory} but the page hangs under ${result.root.kind} root "${result.root.name}"`);
      }
      continue;
    }
    if (result.at !== path) continue; // the broken link is reported on the page that holds it
    switch (result.reason) {
      case "no-parent":
        if (f.invalidParent !== undefined) break;
        stats.withoutParent++;
        error(path, "page/parent-missing", "meaning page has no `parent:`; every page hangs under a node in the tree");
        break;
      case "unresolved-parent":
        stats.unresolvedParent++;
        {
          const target = index.resolveRef(f.parent!);
          error(path, "page/parent-unresolved", target
            ? `parent ${f.parent} resolves to ${target}, which is not a meaning page (Areas/, Projects/, Notes/)`
            : `parent ${f.parent} does not resolve to any page in the vault`);
        }
        break;
      case "no-root":
        stats.parentNotInTree++;
        error(path, "page/parent-not-in-tree", `parent is ${TREE_PARENT} but Tree.md does not list this page as a level-1 node`);
        break;
      case "cycle":
        stats.cycles++;
        error(path, "tree/cycle", `parent chain loops back to ${path}: ${result.steps.map(s => s.path).join(" → ")}`);
        break;
      case "too-deep":
        stats.tooDeep++;
        error(path, "tree/depth", `page sits at level ${result.steps.length}; the limit is ${MAX_TREE_DEPTH} below the tree`);
        break;
      case "not-a-tree-page":
        break;
    }
  }

  // A page whose own parent is fine but that hangs under a broken ancestor is not reported:
  // the ancestor carries the error, so counts stay "pages to fix", not "pages affected".
  const titles = new Map<string, string[]>();
  for (const [path, f] of index.fields) {
    const key = f.title.toLowerCase();
    titles.set(key, [...(titles.get(key) ?? []), path]);
  }
  for (const paths of titles.values()) {
    if (paths.length < 2) continue;
    stats.duplicateTitleGroups++;
    stats.duplicateTitlePages += paths.length;
    for (const path of paths) {
      issues.push({ path, rule: "tree/duplicate-title", severity: "warning", message: `title also used by ${paths.filter(p => p !== path).join(", ")}` });
    }
  }

  return { ok: !issues.some(i => i.severity === "error"), hasTree: Boolean(tree), issues, stats };
}
