import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNote } from "./frontmatter.js";
import { basenameOf, isIndexFile, tierOf } from "./files.js";
import { scanVault, type VaultSnapshot } from "./pages.js";

/**
 * Memory tree schema (EPIC-9 E9-2a; docs/LIBRARIAN-DOCTRINE.md "Memory tree").
 *
 * Level 0 is fixed: two groups, working memory (ongoing now) and long-term
 * memory (what lasts). Level 1 is the list of root nodes in the vault-root
 * `Tree.md`, one line per node. Every deeper level lives in page frontmatter:
 * each meaning page names its `parent:`, so the path root → leaf is the
 * context a retrieval hit carries. `memory:` is the page's group; it is
 * required on root pages and, when present on a descendant, must match the
 * root it hangs under (a page inherits its root's group).
 */

export const TREE_PATH = "Tree.md";
/** Frontmatter keys — E9-3a and the librarian read these exact names. */
export const PARENT_FIELD = "parent";
export const MEMORY_FIELD = "memory";
/** `parent:` value a level-1 root page carries: it hangs directly off the tree. */
export const TREE_PARENT = "[[Tree]]";
/** Deepest page level allowed below a level-1 root (root = 1, its child = 2, ...). */
export const MAX_TREE_DEPTH = 6;

export type MemoryKind = "working" | "long-term";
export const MEMORY_KINDS: readonly MemoryKind[] = ["working", "long-term"];

/** Level-0 group headings in Tree.md, in file order. */
export const GROUP_HEADINGS: Record<MemoryKind, string> = {
  working: "Working memory",
  "long-term": "Long-term memory",
};

export interface TreeNode {
  /** Display name, unique in the tree (case-insensitive). */
  name: string;
  /**
   * Stable root id (E9-5b): `^n-1a2b3c4d` at the end of the line, an Obsidian block id (hidden when
   * reading). Discovery keeps it across re-derivations while the root keeps half its pages.
   */
  id?: string;
  kind: MemoryKind;
  /** Vault-relative path of the node's page, with `.md`. */
  path: string;
  /** One sentence; keeps levels 0-1 readable without opening pages. */
  summary: string;
  /** 1-based line in Tree.md. */
  line: number;
}

export interface TreeParseProblem {
  line: number;
  rule: string;
  message: string;
}

export interface ParsedTree {
  nodes: TreeNode[];
  problems: TreeParseProblem[];
}

const NODE_LINE_RE = /^- (.+)$/;
const NESTED_LINE_RE = /^\s+[-*+] /;
const HEADING_RE = /^## (.+?)\s*$/;
/** Trailing Obsidian block id that carries a root's stable id. */
const NODE_ID_RE = /\s+\^([A-Za-z0-9][A-Za-z0-9-]*)$/;

/**
 * Parse a Tree.md file. Node line format (one line per level-1 node):
 *
 *   - <name> | <working|long-term> | [[<page path without .md>]] | <one-line summary>
 *
 * under a `## Working memory` or `## Long-term memory` heading. The page may
 * also be written as a plain path (`Projects/X.md`). Anything else between
 * headings (prose, blank lines, frontmatter) is ignored; nested bullets are
 * rejected because Tree.md holds levels 0 and 1 only. A trailing ` ^id` is the
 * root's stable id.
 */
export function parseTree(raw: string): ParsedTree {
  const nodes: TreeNode[] = [];
  const problems: TreeParseProblem[] = [];
  const { body } = parseNote(raw);
  const offset = raw.length > body.length ? raw.slice(0, raw.length - body.length).split("\n").length - 1 : 0;
  const lines = body.split("\n");
  let group: MemoryKind | null = null;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.replace(/\r$/, "");
    const line = i + 1 + offset;
    const heading = HEADING_RE.exec(text);
    if (heading) {
      const title = heading[1]!.toLowerCase();
      group = (Object.entries(GROUP_HEADINGS).find(([, h]) => h.toLowerCase() === title)?.[0] as MemoryKind | undefined) ?? null;
      if (!group) problems.push({ line, rule: "tree/group", message: `unknown level-0 group "${heading[1]}"; use "${GROUP_HEADINGS.working}" or "${GROUP_HEADINGS["long-term"]}"` });
      continue;
    }
    if (NESTED_LINE_RE.test(text)) {
      problems.push({ line, rule: "tree/level", message: "Tree.md holds levels 0 and 1 only; deeper nodes name their parent in page frontmatter" });
      continue;
    }
    const m = NODE_LINE_RE.exec(text);
    if (!m) continue;
    const fields = m[1]!.split(" | ");
    if (fields.length < 4) {
      problems.push({ line, rule: "tree/node-format", message: "node line must be `- name | working|long-term | [[page]] | summary`" });
      continue;
    }
    const [name, kindRaw, pageRaw, ...rest] = fields.map(f => f.trim());
    const kind = kindRaw as MemoryKind;
    const path = pagePathFromRef(pageRaw!);
    let summary = rest.join(" | ").trim();
    const idMatch = NODE_ID_RE.exec(summary);
    const id = idMatch?.[1];
    if (idMatch) summary = summary.slice(0, idMatch.index).trim();
    if (!MEMORY_KINDS.includes(kind)) {
      problems.push({ line, rule: "tree/node-kind", message: `kind "${kindRaw}" must be working or long-term` });
      continue;
    }
    if (!name || !path || !summary) {
      problems.push({ line, rule: "tree/node-format", message: "node needs a name, a page and a one-line summary" });
      continue;
    }
    if (!group) {
      problems.push({ line, rule: "tree/group", message: "node line sits outside a level-0 group heading" });
    } else if (group !== kind) {
      problems.push({ line, rule: "tree/node-kind", message: `node "${name}" is ${kind} but sits under "${GROUP_HEADINGS[group]}"` });
    }
    nodes.push({ name, kind, path, summary, line, ...(id ? { id } : {}) });
  }
  return { nodes, problems };
}

/** Render one node line (inverse of parseTree for a single node). */
export function formatTreeNode(node: Pick<TreeNode, "name" | "kind" | "path" | "summary" | "id">): string {
  return `- ${node.name} | ${node.kind} | [[${node.path.replace(/\.md$/, "")}]] | ${node.summary.replace(/\s*\n\s*/g, " ")}${node.id ? ` ^${node.id}` : ""}`;
}

/** Read and parse `<vault>/Tree.md`; null when the vault has no tree yet. */
export async function readTree(vaultPath: string): Promise<ParsedTree | null> {
  const raw = await readFile(join(vaultPath, TREE_PATH), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  return raw === null ? null : parseTree(raw);
}

/** `[[Projects/X|alias]]`, `[[X]]`, `Projects/X.md`, `"Projects/X"` → `Projects/X.md` (unresolved, as written). */
export function pagePathFromRef(ref: string): string {
  let clean = ref.trim().replace(/^["']|["']$/g, "");
  const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(clean);
  if (wiki) clean = wiki[1]!.trim();
  clean = clean.replaceAll("\\", "/").replace(/^\.?\//, "");
  if (!clean) return "";
  return clean.endsWith(".md") ? clean : `${clean}.md`;
}

/** The tree-related frontmatter of one page. Absent fields are undefined; wrong types are reported as raw. */
export interface PageTreeFields {
  /** Raw `parent:` reference as written (wikilink or path), or undefined. */
  parent?: string;
  memory?: MemoryKind;
  /** Set when `memory:` is present but not working|long-term. */
  invalidMemory?: unknown;
  /** Set when `parent:` is present but not a non-empty string. */
  invalidParent?: unknown;
  /** Rule 4 of the audit: a node created because nothing fitted; reviewed by the sweep. */
  provisional?: boolean;
}

export function pageTreeFields(frontmatter: Record<string, unknown> | null): PageTreeFields {
  const out: PageTreeFields = {};
  if (!frontmatter) return out;
  const parent = frontmatter[PARENT_FIELD];
  if (parent !== undefined && parent !== null) {
    // YAML reads an unquoted [[X]] as a nested list [["X"]]; accept it as the wikilink it was meant to be.
    const flat = Array.isArray(parent) && parent.length === 1 && Array.isArray(parent[0]) && parent[0].length === 1 && typeof parent[0][0] === "string"
      ? `[[${parent[0][0]}]]` : parent;
    if (typeof flat === "string" && flat.trim()) out.parent = flat.trim();
    else out.invalidParent = parent;
  }
  const memory = frontmatter[MEMORY_FIELD];
  if (memory !== undefined && memory !== null) {
    if (MEMORY_KINDS.includes(memory as MemoryKind)) out.memory = memory as MemoryKind;
    else out.invalidMemory = memory;
  }
  if (frontmatter.provisional === true) out.provisional = true;
  return out;
}

/** True for a `parent:` value that points at the tree itself (level-1 root pages). */
export function isTreeParentRef(ref: string): boolean {
  return pagePathFromRef(ref).toLowerCase() === TREE_PATH.toLowerCase();
}

/** Pages the tree must place: meaning pages, minus index pages. Log, Inbox and other files are out of scope. */
export function isTreePage(path: string): boolean {
  return tierOf(path) === "meaning" && !isIndexFile(path) && path.endsWith(".md");
}

export interface LineageStep {
  name: string;
  path: string;
}

export type LineageResult =
  | { ok: true; group: MemoryKind; root: TreeNode; steps: LineageStep[] }
  | { ok: false; reason: "not-a-tree-page" | "no-parent" | "unresolved-parent" | "cycle" | "too-deep" | "no-root"; at: string; steps: LineageStep[] };

/**
 * In-memory view of the whole tree: Tree.md roots plus every page's parent.
 * Built once per scan; `lineage()` and `children()` are what retrieval (E9-3a),
 * the librarian (E9-2b) and the sweep (E9-2d) consume.
 */
export interface TreeIndex {
  tree: ParsedTree | null;
  /** Lowercased page path → root node. */
  rootsByPath: Map<string, TreeNode>;
  /** Tree page path → its tree fields. */
  fields: Map<string, PageTreeFields & { title: string }>;
  /** Resolve a `parent:` reference to a vault path, as Obsidian would (full path, then basename). */
  resolveRef(ref: string): string | null;
  /** Root → leaf path for a page; see LineageResult. */
  lineage(path: string): LineageResult;
  /** Direct children of a page (pages whose parent resolves to it), sorted by path. */
  children(path: string): string[];
}

export async function buildTreeIndex(vaultPath: string, snapshot?: VaultSnapshot): Promise<TreeIndex> {
  const snap = snapshot ?? (await scanVault(vaultPath));
  const tree = await readTree(vaultPath);
  const fields = new Map<string, PageTreeFields & { title: string }>();
  for (const file of snap.files) {
    if (!isTreePage(file)) continue;
    const raw = await readFile(join(vaultPath, file), "utf8");
    const { frontmatter } = parseNote(raw);
    const title = typeof frontmatter?.title === "string" && frontmatter.title.trim() ? frontmatter.title.trim() : basenameOf(file);
    fields.set(file, { ...pageTreeFields(frontmatter), title });
  }
  return createTreeIndex(tree, fields, snap.linkTargets);
}

/** Pure constructor (no I/O); exported for tests and callers that already hold the data. */
export function createTreeIndex(
  tree: ParsedTree | null,
  fields: Map<string, PageTreeFields & { title: string }>,
  linkTargets: Map<string, string>,
): TreeIndex {
  const rootsByPath = new Map<string, TreeNode>();
  for (const node of tree?.nodes ?? []) {
    const resolved = linkTargets.get(node.path.replace(/\.md$/, "").toLowerCase()) ?? node.path;
    if (!rootsByPath.has(resolved.toLowerCase())) rootsByPath.set(resolved.toLowerCase(), node);
  }

  const resolveRef = (ref: string): string | null => {
    const path = pagePathFromRef(ref);
    if (!path) return null;
    const key = path.replace(/\.md$/, "").toLowerCase();
    return linkTargets.get(key) ?? linkTargets.get(basenameOf(path).toLowerCase()) ?? null;
  };

  const childMap = new Map<string, string[]>();
  for (const [path, f] of fields) {
    if (!f.parent || isTreeParentRef(f.parent)) continue;
    const parent = resolveRef(f.parent);
    if (!parent) continue;
    const list = childMap.get(parent) ?? [];
    list.push(path);
    childMap.set(parent, list);
  }
  for (const list of childMap.values()) list.sort();

  const titleOf = (path: string) => fields.get(path)?.title ?? basenameOf(path);

  const lineage = (start: string): LineageResult => {
    const steps: LineageStep[] = [];
    if (!fields.has(start)) return { ok: false, reason: "not-a-tree-page", at: start, steps };
    const seen = new Set<string>();
    let current = start;
    for (;;) {
      if (seen.has(current)) return { ok: false, reason: "cycle", at: current, steps: steps.reverse() };
      seen.add(current);
      const root = rootsByPath.get(current.toLowerCase());
      steps.push({ name: root?.name ?? titleOf(current), path: current });
      if (root) {
        steps.reverse();
        if (steps.length > MAX_TREE_DEPTH) return { ok: false, reason: "too-deep", at: start, steps };
        return { ok: true, group: root.kind, root, steps };
      }
      const f = fields.get(current);
      if (!f?.parent) return { ok: false, reason: "no-parent", at: current, steps: steps.reverse() };
      if (isTreeParentRef(f.parent)) return { ok: false, reason: "no-root", at: current, steps: steps.reverse() };
      const next = resolveRef(f.parent);
      if (!next || !fields.has(next)) return { ok: false, reason: "unresolved-parent", at: current, steps: steps.reverse() };
      current = next;
    }
  };

  return {
    tree,
    rootsByPath,
    fields,
    resolveRef,
    lineage,
    children: (path: string) => childMap.get(path) ?? [],
  };
}

/** `Working › Hair transplant › 2023 Barcelona quotes` — the display form retrieval returns. */
export function formatLineage(result: Extract<LineageResult, { ok: true }>): string {
  const group = result.group === "working" ? "Working" : "Long-term";
  return [group, ...result.steps.map(s => s.name)].join(" › ");
}
