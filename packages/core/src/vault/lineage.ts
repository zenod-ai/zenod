import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { basenameOf } from "./files.js";
import { CITATION_RE } from "./pages.js";
import { buildTreeIndex, GROUP_HEADINGS, type MemoryKind } from "./tree.js";

/**
 * Retrieval lineage (EPIC-9 E9-3a): where a memory sits in the tree, root → leaf,
 * plus the Log evidence it came from. Read-only and deterministic; no LLM.
 *
 * Built on the E9-2a tree schema (./tree.ts). A page whose lineage does not resolve
 * (no `parent`, a broken parent, a cycle — today's whole vault until E9-2c) is
 * "unplaced" with an empty lineage, never an error.
 */

const MAX_EVIDENCE = 5;

export interface LineageNode {
  /** Vault-relative page path, or null for a level-0 group (Working / Long-term memory). */
  path: string | null;
  title: string;
  memory: MemoryKind | null;
}

export interface MemoryLineage {
  placement: "placed" | "unplaced";
  /** Level-0 group → level-1 root → … → the memory itself. Empty when unplaced. */
  lineage: LineageNode[];
  /** Log evidence refs the page cites, e.g. `Log/2026-10-31.md#^e-c64e3b` (first 5). */
  evidence: string[];
}

export interface MemoryTreeNodeView extends MemoryLineage {
  /** The node one level up (the level-0 group for a root); null when unplaced. */
  parent: LineageNode | null;
  /** Pages whose `parent:` resolves to this page, sorted by path. */
  children: LineageNode[];
}

export interface MemoryTreeIndex {
  lineageOf(path: string): Promise<MemoryLineage>;
  nodeView(path: string): Promise<MemoryTreeNodeView>;
}

function evidenceRefs(body: string): string[] {
  const refs: string[] = [];
  for (const match of body.matchAll(CITATION_RE)) {
    const ref = `Log/${match[1]}.md#^${match[2]}`;
    if (!refs.includes(ref)) refs.push(ref);
    if (refs.length >= MAX_EVIDENCE) break;
  }
  return refs;
}

/** One tree scan per call; lineage and node queries are answered from it. */
export async function loadMemoryTree(vaultPath: string): Promise<MemoryTreeIndex> {
  const index = await buildTreeIndex(vaultPath);
  const evidence = new Map<string, Promise<string[]>>();
  const evidenceOf = (path: string) => {
    if (!evidence.has(path)) {
      evidence.set(path, readFile(join(vaultPath, path), "utf8").then(evidenceRefs, () => []));
    }
    return evidence.get(path)!;
  };
  const exact = (path: string) => (index.fields.has(path) ? path : index.resolveRef(path) ?? path);

  async function lineageOf(path: string): Promise<MemoryLineage> {
    const page = exact(path);
    const found = index.lineage(page);
    const cited = page.startsWith("Log/") ? [] : await evidenceOf(page);
    if (!found.ok) return { placement: "unplaced", lineage: [], evidence: cited };
    return {
      placement: "placed",
      lineage: [
        { path: null, title: GROUP_HEADINGS[found.group], memory: found.group },
        ...found.steps.map((step) => ({ path: step.path, title: step.name, memory: found.group })),
      ],
      evidence: cited,
    };
  }

  async function nodeView(path: string): Promise<MemoryTreeNodeView> {
    const own = await lineageOf(path);
    const group = own.lineage[0]?.memory ?? null;
    const children = index.children(exact(path)).map((child) => {
      const fields = index.fields.get(child);
      return { path: child, title: fields?.title ?? basenameOf(child), memory: group ?? fields?.memory ?? null };
    });
    return { ...own, parent: own.lineage.at(-2) ?? null, children };
  }

  return { lineageOf, nodeView };
}

/** `Working memory › Hair transplant › 2023 Barcelona quotes ← Log/2026-10-31.md#^e-c64e3b`; "" when unplaced. */
export function formatMemoryLineage(lineage: MemoryLineage): string {
  if (lineage.placement !== "placed") return "";
  const path = lineage.lineage.map((node) => node.title).join(" › ");
  return lineage.evidence[0] ? `${path} ← ${lineage.evidence[0]}` : path;
}
