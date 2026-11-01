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

/**
 * Level-1 tree proposed by the E9-1 audit (docs/epic9/E9-1-memory-structure-audit.md §5),
 * approved as default by Jordi in E9-A1 (2026-11-01). Working roots are the four
 * live topics he named; long-term are the five domains.
 */
export const AUDIT_TREE_PROPOSAL: readonly SeedNode[] = [
  { name: "Launching Epic Social", kind: "working", path: "Projects/Launching Epic Social.md",
    summary: "Getting Epic Social out: the idea→draft→approved→posted pipeline, post topics, Agent Team, the EpicSpine/Epic Team/Epic Social brand, the Reddit and X launch and testers." },
  { name: "Launching Zenod", kind: "working", path: "Projects/Launching Zenod.md",
    summary: "Getting Zenod to paying users: the alpha launch, memory as a tree, production health and positioning." },
  { name: "Hair transplant", kind: "working", path: "Projects/Hair transplant.md",
    summary: "Deciding on a hair transplant: the options dossier and 2023 Barcelona quotes; open on budget, destination and timing." },
  { name: "House decision", kind: "working", path: "Projects/House decision.md",
    summary: "Choosing where to buy a house: Maresme vs Cerdanya vs Sardinia, legal exposure, yield and financing, and the Idealista/IdeaScraper data." },
  { name: "Ventures and work", kind: "long-term", path: "Areas/Ventures and work.md",
    summary: "The businesses and projects over time: Alpha9 (tax, gestorías), trading (Poly-Maker, Polymarket), Altamira2050/PatronBTC, RepoMiningFunding, OpenProp legal and Zenod's history." },
  { name: "Ideas and knowledge", kind: "long-term", path: "Areas/Ideas and knowledge.md",
    summary: "Reusable thinking: markets and finance research, AI and agents (EpicSpine doctrine), story and positioning." },
  { name: "Infrastructure and runbooks", kind: "long-term", path: "Areas/Infrastructure and runbooks.md",
    summary: "How the machines and accounts work: the VPS fleet and incident lessons, accounts and access (GitHub, Gmail, browser)." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md",
    summary: "Running life: housing in general, insurance, hardware, health and travel." },
  { name: "People and family", kind: "long-term", path: "Areas/People and family.md",
    summary: "The people in Jordi's life; private, detail stays in the notes." },
];

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

/** Tree.md plus one root page per node: what a fresh vault gets, or what a reviewed migration proposes. */
export function seedTreeFiles(nodes: readonly SeedNode[] = AUDIT_TREE_PROPOSAL, date = new Date().toISOString().slice(0, 10)): SeedFile[] {
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
