import { serializeNote } from "./frontmatter.js";
import { basenameOf, MEANING_FOLDERS } from "./files.js";
import { formatTreeNode, GROUP_HEADINGS, MEMORY_FIELD, MEMORY_KINDS, PARENT_FIELD, TREE_PARENT, TREE_PATH, type MemoryKind } from "./tree.js";

export interface SeedNode {
  name: string;
  kind: MemoryKind;
  /** Vault-relative page path; working roots live in Projects/, long-term domains in Areas/. */
  path: string;
  summary: string;
}

/** Render a Tree.md from seed nodes (levels 0/1 only). */
export function renderTreeFile(nodes: readonly SeedNode[], date: string): string {
  const lines = [
    "---",
    "title: Tree",
    `updated: ${date}`,
    "---",
    "",
    "# Memory tree",
    "",
    "Levels 0 and 1 of this vault's memory. One line per node: `name | working|long-term | [[page]] | one-line summary`.",
    "Deeper pages name their parent in frontmatter (`parent:`); the Log is the evidence underneath, not a branch.",
  ];
  for (const kind of MEMORY_KINDS) {
    lines.push("", `## ${GROUP_HEADINGS[kind]}`, "");
    for (const node of nodes.filter(n => n.kind === kind)) lines.push(formatTreeNode(node));
  }
  return `${lines.join("\n")}\n`;
}

/** A minimal root page that passes `zenod lint` and `zenod tree lint` for its node. */
export function renderRootPage(node: SeedNode, date: string): string {
  const type = MEANING_FOLDERS[node.path.split("/")[0]!];
  if (!type) throw new Error(`seed node ${node.name}: ${node.path} is not under Projects/, Areas/ or Notes/`);
  const frontmatter: Record<string, unknown> = {
    title: node.name,
    type,
    tags: [],
    created: date,
    updated: date,
    summary: node.summary,
    description: node.summary,
    [PARENT_FIELD]: TREE_PARENT,
    [MEMORY_FIELD]: node.kind,
  };
  const group = node.kind === "working" ? "working memory" : "long-term memory";
  return serializeNote(frontmatter, `# ${node.name}\n\n${node.summary}\n\nA level-1 node of ${group} in the [[Tree]]. Pages about this subject name it as their \`parent\`.\n`);
}

export interface SeedFile {
  path: string;
  content: string;
}

/**
 * Tree.md plus one root page per node. Zenod ships no topics of its own (EPIC-9 L-1: roots are
 * discovered from content, never hand-picked): `zenod tree seed` passes no nodes and writes an
 * empty Tree.md that `zenod tree discover --apply` then fills.
 */
export function seedTreeFiles(nodes: readonly SeedNode[], date = new Date().toISOString().slice(0, 10)): SeedFile[] {
  const names = new Set<string>();
  for (const node of nodes) {
    const key = basenameOf(node.path).toLowerCase();
    if (names.has(key)) throw new Error(`seed nodes repeat the page name ${basenameOf(node.path)}`);
    names.add(key);
  }
  return [
    { path: TREE_PATH, content: renderTreeFile(nodes, date) },
    ...nodes.map(node => ({ path: node.path, content: renderRootPage(node, date) })),
  ];
}
