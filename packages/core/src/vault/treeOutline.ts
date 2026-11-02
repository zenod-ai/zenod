import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf } from "./files.js";
import { CITATION_RE } from "./pages.js";
import { readLogCaptures, withoutOpsRollup } from "./captureOrigin.js";
import { buildTreeIndex, GROUP_HEADINGS, MAX_TREE_DEPTH, MEMORY_KINDS, TREE_PATH, type MemoryKind } from "./tree.js";
import { pageSteering, parseKeeperNotes } from "./treeSteering.js";
import { recentChangeLines } from "../engine/treeKeeper.js";

/**
 * Whole-tree outline for the console Memory tab (EPIC-9 E9-2e). Read live from
 * the vault on every build (Tree.md + page `parent:`), so pages the librarian
 * files (E9-2b) show up on their own. Titles, paths, dates and the one-line
 * Tree.md summaries only: never a page body.
 */

export interface MemoryTreeCapture {
  /** YYYY-MM-DD: the newest citation of the person's own capture on the page, else its `updated:`/`created:` date. */
  date: string;
  title: string;
  path: string;
}

export interface MemoryTreeOutlineNode {
  /** Group: "working" | "long-term"; page: its vault path. Unique in the outline. */
  id: string;
  kind: "group" | "root" | "page";
  memory: MemoryKind;
  title: string;
  /** Vault-relative page path; null for a level-0 group. */
  path: string | null;
  /** Tree.md one-line summary (roots only). */
  summary?: string;
  /** Stable root id (roots only, E9-5b). */
  rootId?: string;
  /** The person pinned this root: never demoted or renamed (roots only, E9-5b). */
  pinned?: boolean;
  /** The person named this root; the keeper keeps the name (roots only, E9-5b). */
  nameLocked?: boolean;
  provisional?: boolean;
  /** Pages in this subtree, the node's own page included. */
  pages: number;
  /** Newest capture anywhere in the subtree. */
  latest: MemoryTreeCapture | null;
  /** Link to the page in the user's vault (GitHub/Drive), when the provider has one. */
  url: string | null;
  children: MemoryTreeOutlineNode[];
}

export interface MemoryTreeOutline {
  /** Always two groups, working first. */
  groups: MemoryTreeOutlineNode[];
  roots: number;
  /** Pages placed under a root. */
  placed: number;
  /** Tree pages whose lineage does not reach a root (shown as a count, not listed). */
  unplaced: number;
  /** Keeper notes in Tree.md (E9-5b). */
  keeperNotes: number;
  /** The memory-keeper's `## Recent changes` lines in Tree.md, newest first (E9-5c), at most 5. */
  recentChanges: string[];
}

export interface MemoryTreeOutlineOptions {
  urlFor?: (path: string) => string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function frontmatterDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && DATE_RE.test(value.trim().slice(0, 10))) return value.trim().slice(0, 10);
  return null;
}

/**
 * Newest date a page records one of the person's own captures: its Log citations
 * (outside the ops rollup, and never an agent report: E9-2g), else its frontmatter
 * dates. A page whose only citations are agent reports has no date: agent activity
 * never makes a node look fresh.
 */
export function pageCaptureDate(raw: string, isAgentCapture: (key: string) => boolean = () => false): string | null {
  const { frontmatter, body } = parseNote(raw);
  let newest: string | null = null;
  let cited = false;
  for (const match of withoutOpsRollup(body).matchAll(CITATION_RE)) {
    cited = true;
    if (isAgentCapture(`${match[1]}#^${match[2]}`)) continue;
    if (!newest || match[1]! > newest) newest = match[1]!;
  }
  if (newest || cited) return newest;
  return frontmatterDate(frontmatter?.updated) ?? frontmatterDate(frontmatter?.created);
}

const newer = (a: MemoryTreeCapture | null, b: MemoryTreeCapture | null) => (!a ? b : !b ? a : b.date > a.date ? b : a);

/** Null when the vault has no Tree.md yet (the console shows its empty state). */
export async function memoryTreeOutline(vaultPath: string, options: MemoryTreeOutlineOptions = {}): Promise<MemoryTreeOutline | null> {
  const index = await buildTreeIndex(vaultPath);
  if (!index.tree) return null;
  const urlFor = (path: string) => {
    try {
      return options.urlFor?.(path) || null;
    } catch {
      return null;
    }
  };
  const captures = await readLogCaptures(vaultPath);
  const treeRaw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch(() => "");
  const { notes } = parseKeeperNotes(treeRaw);
  const steeringOf = new Map<string, { pinned: boolean; nameLocked: boolean }>();
  const isAgentCapture = (key: string) => captures.get(key)?.origin === "agent";
  const dates = new Map<string, string | null>();
  await Promise.all([...index.fields.keys()].map(async (path) => {
    const raw = await readFile(join(vaultPath, path), "utf8").catch(() => "");
    dates.set(path, pageCaptureDate(raw, isAgentCapture));
    if (index.rootsByPath.has(path.toLowerCase())) {
      const flags = pageSteering(parseNote(raw).frontmatter);
      steeringOf.set(path, { pinned: flags.pinned, nameLocked: flags.nameLocked });
    }
  }));
  // A root a Keeper note pins or names counts as steered even before discovery mirrors the flag onto its page.
  const noted = (node: { id?: string; name: string }, kind: "pinned" | "name") => notes.some(note => note.rule.kind === kind
    && note.targets.some(t => (t.id && t.id === node.id) || t.name.toLowerCase() === node.name.toLowerCase()
      || (note.rule.kind === "name" && note.rule.name.toLowerCase() === node.name.toLowerCase())));

  const seen = new Set<string>();
  const pageNode = (path: string, memory: MemoryKind, depth: number): MemoryTreeOutlineNode | null => {
    if (seen.has(path) || depth > MAX_TREE_DEPTH) return null;
    seen.add(path);
    const fields = index.fields.get(path);
    const title = fields?.title ?? basenameOf(path);
    const date = dates.get(path);
    const own: MemoryTreeCapture | null = fields && date ? { date, title, path } : null;
    const children = index.children(path)
      .map((child) => pageNode(child, memory, depth + 1))
      .filter((node): node is MemoryTreeOutlineNode => node !== null)
      .sort((a, b) => (b.latest?.date ?? "").localeCompare(a.latest?.date ?? "") || a.title.localeCompare(b.title));
    return {
      id: path,
      kind: "page",
      memory,
      title,
      path,
      ...(fields?.provisional ? { provisional: true } : {}),
      pages: (fields ? 1 : 0) + children.reduce((sum, child) => sum + child.pages, 0),
      latest: children.reduce((best, child) => newer(best, child.latest), own),
      url: fields ? urlFor(path) : null,
      children,
    };
  };

  const groups = MEMORY_KINDS.map((memory): MemoryTreeOutlineNode => {
    const roots: MemoryTreeOutlineNode[] = [];
    for (const node of index.tree!.nodes) {
      if (node.kind !== memory) continue;
      const page = pageNode(index.resolveRef(node.path) ?? node.path, memory, 1);
      if (!page) continue;
      const flags = steeringOf.get(page.path ?? "");
      const pinned = Boolean(flags?.pinned) || noted(node, "pinned");
      const nameLocked = pinned || Boolean(flags?.nameLocked) || noted(node, "name");
      roots.push({
        ...page, kind: "root", title: node.name, summary: node.summary,
        ...(node.id ? { rootId: node.id } : {}), ...(pinned ? { pinned } : {}), ...(nameLocked ? { nameLocked } : {}),
      });
    }
    return {
      id: memory,
      kind: "group",
      memory,
      title: GROUP_HEADINGS[memory],
      path: null,
      pages: roots.reduce((sum, root) => sum + root.pages, 0),
      latest: roots.reduce<MemoryTreeCapture | null>((best, root) => newer(best, root.latest), null),
      url: null,
      children: roots,
    };
  });
  const placed = groups.reduce((sum, group) => sum + group.pages, 0);
  return {
    groups,
    roots: groups.reduce((sum, group) => sum + group.children.length, 0),
    placed,
    unplaced: [...index.fields.keys()].filter((path) => !seen.has(path)).length,
    keeperNotes: notes.length,
    recentChanges: recentChangeLines(treeRaw).slice(0, 5).map((line) => line.replace(/^- /, "")),
  };
}
