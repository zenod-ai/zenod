import { basenameOf } from "./files.js";
import { TREE_PATH } from "./tree.js";

/**
 * Memory graph (EPIC-12 E12-2, row S2): each memory page a node, its wikilinks the edges,
 * plus the EPIC-9 tree (page `parent:` and the Tree.md roots). The raw links are stored per
 * file in the tenant's tier-0 index (memoryIndex.ts, table `edges`), so a new filing only
 * re-reads its own file; targets are resolved here, Obsidian style (full path, then
 * basename), so a page created later picks up the links already pointing at it.
 *
 * A client never gets the whole graph: a view is one node's neighbourhood (or, with no
 * node, the tree's roots and the busiest pages), capped, with counts of what was left out.
 * That keeps a vault of thousands of notes fast to send and to draw.
 */

export const MEMORY_GRAPH_DEFAULT_LIMIT = 40;
export const MEMORY_GRAPH_MAX_LIMIT = 120;
/** Title of the Tree.md node: the whole memory, every root hangs off it. */
export const MEMORY_GRAPH_TREE_TITLE = "Your memory";

export interface MemoryGraphPage {
  path: string;
  title: string;
  summary: string;
  /** `Working memory › House › Visits`, "" when unplaced. */
  treePath: string;
}

/** One stored edge: `target` exactly as written in `from` (unresolved). */
export interface MemoryGraphRawEdge {
  from: string;
  target: string;
  /** link: a wikilink in the body. tree: `from` names `target` as its parent (Tree.md: `target` is a root). */
  kind: "link" | "tree";
}

export type MemoryGraphRelation = "center" | "parent" | "child" | "link" | "backlink" | "hub";

export interface MemoryGraphNode {
  path: string;
  title: string;
  summary: string;
  treePath: string;
  /** tree: Tree.md itself; root: a level-1 root of the tree; page: any other memory. */
  kind: "tree" | "root" | "page";
  /** How the node relates to the view's center (overview: roots are children of the tree, the rest hubs). */
  relation: MemoryGraphRelation;
  links: number;
  backlinks: number;
  children: number;
  /** Distinct neighbours in the whole graph. */
  degree: number;
  /** Neighbours not drawn in this view: the node can be opened to see them. */
  hidden: number;
}

export interface MemoryGraphEdge {
  /** link: the page that links. tree: the parent. */
  from: string;
  to: string;
  kind: "link" | "tree";
}

export interface MemoryGraphView {
  /** The opened node, or null for the overview. */
  center: string | null;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  /** Neighbours of the center left out by the limit, per relation. */
  more: { parent: number; child: number; link: number; backlink: number };
  total: { nodes: number; edges: number };
}

interface Adjacent {
  page: MemoryGraphPage;
  kind: MemoryGraphNode["kind"];
  out: Set<string>;
  in: Set<string>;
  parent: string | null;
  children: Set<string>;
  neighbours: Set<string>;
}

const keyOf = (value: string) => value.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\.md$/i, "").toLowerCase();
const byWeight = (graph: MemoryGraph) => (a: string, b: string) =>
  graph.degreeOf(b) - graph.degreeOf(a) || graph.titleOf(a).localeCompare(graph.titleOf(b)) || a.localeCompare(b);

export class MemoryGraph {
  private readonly nodes = new Map<string, Adjacent>();
  private readonly targets = new Map<string, string>();
  private edgeCount = 0;

  private constructor(pages: readonly MemoryGraphPage[], edges: readonly MemoryGraphRawEdge[], hasTree: boolean) {
    const sorted = [...pages].sort((a, b) => a.path.localeCompare(b.path));
    if (hasTree) sorted.unshift({ path: TREE_PATH, title: MEMORY_GRAPH_TREE_TITLE, summary: "", treePath: "" });
    for (const page of sorted) {
      if (this.nodes.has(page.path)) continue;
      this.nodes.set(page.path, {
        page, kind: page.path === TREE_PATH ? "tree" : "page",
        out: new Set(), in: new Set(), parent: null, children: new Set(), neighbours: new Set(),
      });
    }
    // Full path first, so `[[Areas/House]]` always wins over another folder's `House.md`.
    for (const path of this.nodes.keys()) if (!this.targets.has(keyOf(path))) this.targets.set(keyOf(path), path);
    for (const path of this.nodes.keys()) {
      const base = basenameOf(path).toLowerCase();
      if (!this.targets.has(base)) this.targets.set(base, path);
    }
    for (const edge of edges) {
      const from = this.nodes.get(edge.from);
      const to = this.resolve(edge.target);
      if (!from || !to || to === edge.from) continue;
      const target = this.nodes.get(to)!;
      if (edge.kind === "link") {
        // "A node in the [[Tree]]" is the tree relation again, drawn by the tree edges.
        if (to === TREE_PATH || edge.from === TREE_PATH || from.out.has(to)) continue;
        from.out.add(to);
        target.in.add(edge.from);
      } else if (edge.from === TREE_PATH) {
        // A Tree.md line: `to` is a level-1 root.
        if (target.parent) continue;
        target.parent = TREE_PATH;
        from.children.add(to);
        target.kind = "root";
      } else {
        if (from.parent) continue;
        from.parent = to;
        target.children.add(edge.from);
        if (to === TREE_PATH) from.kind = "root";
      }
      from.neighbours.add(to);
      target.neighbours.add(edge.from);
    }
    for (const node of this.nodes.values()) this.edgeCount += node.out.size + node.children.size;
    // A tree node nobody hangs off says nothing: drop it.
    const tree = this.nodes.get(TREE_PATH);
    if (tree && tree.neighbours.size === 0) this.nodes.delete(TREE_PATH);
  }

  static build(pages: readonly MemoryGraphPage[], edges: readonly MemoryGraphRawEdge[], options: { hasTree?: boolean } = {}): MemoryGraph {
    return new MemoryGraph(pages, edges, options.hasTree ?? edges.some((edge) => edge.from === TREE_PATH));
  }

  get size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edgeCount };
  }

  has(path: string): boolean {
    return this.nodes.has(path);
  }

  /** A link target or path as written (`[[House]]`, `Areas/House`, `Areas/House.md`) → the node's path, or null. */
  resolve(ref: string): string | null {
    const clean = ref.trim().replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").split("#")[0]!.split("|")[0]!.trim();
    if (this.nodes.has(clean)) return clean;
    const key = keyOf(clean);
    if (!key) return null;
    return this.targets.get(key) ?? this.targets.get(key.split("/").at(-1)!) ?? null;
  }

  /** Pages that name this node as their tree parent, sorted by path. */
  childrenOf(path: string): string[] {
    return [...(this.nodes.get(path)?.children ?? [])].sort();
  }

  /** Pages this node links to, sorted by path. */
  linksOf(path: string): string[] {
    return [...(this.nodes.get(path)?.out ?? [])].sort();
  }

  /** The tree parent of a node (a root's is Tree.md), or null. */
  parentOf(path: string): string | null {
    return this.nodes.get(path)?.parent ?? null;
  }

  /** Steps from Tree.md down to the node (a root is 1), 0 when unplaced. */
  depthOf(path: string): number {
    let depth = 0;
    const seen = new Set<string>();
    for (let at = this.nodes.get(path)?.parent ?? null; at && !seen.has(at); at = this.nodes.get(at)?.parent ?? null) {
      seen.add(at);
      depth++;
      if (at === TREE_PATH) return depth;
    }
    return 0;
  }

  degreeOf(path: string): number {
    return this.nodes.get(path)?.neighbours.size ?? 0;
  }

  titleOf(path: string): string {
    return this.nodes.get(path)?.page.title ?? path;
  }

  /** The node at `ref` with its parent, children, links and backlinks, at most `limit` nodes in all. */
  neighbourhood(ref: string, limit = MEMORY_GRAPH_DEFAULT_LIMIT): MemoryGraphView | null {
    const center = this.resolve(ref);
    if (!center) return null;
    const node = this.nodes.get(center)!;
    const sort = byWeight(this);
    const groups: Array<{ relation: Exclude<MemoryGraphRelation, "center" | "hub">; paths: string[] }> = [
      { relation: "parent", paths: node.parent ? [node.parent] : [] },
      // Disjoint groups: a neighbour is named by its closest relation (tree first, then links).
      { relation: "link", paths: [...node.out].filter((path) => path !== node.parent && !node.children.has(path)).sort(sort) },
      { relation: "child", paths: [...node.children].sort(sort) },
      { relation: "backlink", paths: [...node.in].filter((path) => path !== node.parent && !node.children.has(path) && !node.out.has(path)).sort(sort) },
    ];
    const relation = new Map<string, MemoryGraphRelation>([[center, "center"]]);
    const budget = capOf(limit) - 1;
    const taken = new Map(groups.map((group) => [group.relation, 0]));
    // Round-robin over the groups, so a hub's hundred backlinks never crowd out its parent and links.
    for (let round = 0; relation.size - 1 < budget; round++) {
      let added = false;
      for (const group of groups) {
        if (relation.size - 1 >= budget) break;
        const path = group.paths[round];
        if (path === undefined) continue;
        added = true;
        taken.set(group.relation, taken.get(group.relation)! + 1);
        if (!relation.has(path)) relation.set(path, group.relation);
      }
      if (!added) break;
    }
    const more = { parent: 0, child: 0, link: 0, backlink: 0 };
    for (const group of groups) more[group.relation] = group.paths.length - taken.get(group.relation)!;
    return this.view(center, relation, more);
  }

  /** No node opened: the tree and its roots, then the busiest pages, at most `limit` nodes. */
  overview(limit = MEMORY_GRAPH_DEFAULT_LIMIT): MemoryGraphView {
    const cap = capOf(limit);
    const relation = new Map<string, MemoryGraphRelation>();
    const tree = this.nodes.get(TREE_PATH);
    if (tree) {
      relation.set(TREE_PATH, "center");
      for (const root of [...tree.children].sort(byWeight(this))) {
        if (relation.size >= cap) break;
        relation.set(root, "child");
      }
    }
    const hubs = [...this.nodes.keys()].filter((path) => !relation.has(path) && this.degreeOf(path) > 0).sort(byWeight(this));
    for (const path of hubs) {
      if (relation.size >= cap) break;
      relation.set(path, "hub");
    }
    // A vault with no links yet still shows its pages.
    if (relation.size < cap) {
      for (const path of [...this.nodes.keys()].sort()) {
        if (relation.size >= cap) break;
        if (!relation.has(path)) relation.set(path, "hub");
      }
    }
    return this.view(tree ? TREE_PATH : null, relation, { parent: 0, child: 0, link: 0, backlink: 0 });
  }

  private view(center: string | null, relation: Map<string, MemoryGraphRelation>, more: MemoryGraphView["more"]): MemoryGraphView {
    const edges: MemoryGraphEdge[] = [];
    const visible = new Map<string, number>([...relation.keys()].map((path) => [path, 0]));
    const seen = new Set<string>();
    for (const path of relation.keys()) {
      const node = this.nodes.get(path)!;
      for (const to of node.out) {
        // A link that repeats a parent/child relation is drawn once, as the tree edge.
        if (!relation.has(to) || node.parent === to || node.children.has(to)) continue;
        edges.push({ from: path, to, kind: "link" });
        const pair = path < to ? `${path}\n${to}` : `${to}\n${path}`;
        if (!seen.has(pair)) { seen.add(pair); visible.set(path, visible.get(path)! + 1); visible.set(to, visible.get(to)! + 1); }
      }
      for (const child of node.children) {
        if (!relation.has(child)) continue;
        edges.push({ from: path, to: child, kind: "tree" });
        const pair = path < child ? `${path}\n${child}` : `${child}\n${path}`;
        if (!seen.has(pair)) { seen.add(pair); visible.set(path, visible.get(path)! + 1); visible.set(child, visible.get(child)! + 1); }
      }
    }
    const nodes = [...relation].map(([path, rel]): MemoryGraphNode => {
      const node = this.nodes.get(path)!;
      return {
        path, title: node.page.title, summary: node.page.summary, treePath: node.page.treePath, kind: node.kind, relation: rel,
        links: node.out.size, backlinks: node.in.size, children: node.children.size,
        degree: node.neighbours.size, hidden: Math.max(0, node.neighbours.size - visible.get(path)!),
      };
    });
    return { center, nodes, edges, more, total: this.size };
  }
}

function capOf(limit: number): number {
  return Math.max(2, Math.min(MEMORY_GRAPH_MAX_LIMIT, Math.trunc(limit) || MEMORY_GRAPH_DEFAULT_LIMIT));
}
