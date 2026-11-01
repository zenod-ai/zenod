import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { lintVault } from "../src/vault/lint.js";
import { buildTreeIndex, formatLineage, MAX_TREE_DEPTH, pagePathFromRef, pageTreeFields, parseTree } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { AUDIT_TREE_PROPOSAL, seedTreeFiles } from "../src/vault/treeSeed.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const dirs: string[] = [];

async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-tree-"));
  dirs.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

function page(title: string, fields: Record<string, string>, body = `# ${title}\n\nSee [[Tree]].\n`): string {
  const extra = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\ntitle: ${title}\ntype: note\ntags: []\ncreated: 2026-11-01\nupdated: 2026-11-01\nsummary: ${title}.\n${extra}\n---\n\n${body}`;
}

const rules = (report: Awaited<ReturnType<typeof lintTree>>) => report.issues.filter(i => i.severity === "error").map(i => `${i.rule} ${i.path}`).sort();

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("Tree.md parsing", () => {
  it("reads level-1 nodes with kind, page and summary", () => {
    const parsed = parseTree(seedTreeFiles(AUDIT_TREE_PROPOSAL, "2026-11-01")[0]!.content);
    expect(parsed.problems).toEqual([]);
    expect(parsed.nodes.map(n => [n.name, n.kind])).toEqual(AUDIT_TREE_PROPOSAL.map(n => [n.name, n.kind]));
    expect(parsed.nodes[2]).toMatchObject({ name: "Hair transplant", path: "Projects/Hair transplant.md" });
    expect(parsed.nodes[2]!.line).toBe(15); // 1-based line in the file, frontmatter included
  });

  it("rejects nested bullets, wrong groups, bad kinds and short lines", () => {
    const { problems } = parseTree([
      "## Working memory",
      "- A | long-term | [[Areas/A]] | misplaced",
      "  - child | working | [[Notes/C]] | too deep for Tree.md",
      "- B | ongoing | [[Notes/B]] | bad kind",
      "- C | working | [[Notes/C]]",
      "## Someday",
    ].join("\n"));
    expect(problems.map(p => p.rule)).toEqual(["tree/node-kind", "tree/level", "tree/node-kind", "tree/node-format", "tree/group"]);
  });

  it("normalizes parent references and frontmatter", () => {
    expect(pagePathFromRef("[[Projects/X|alias]]")).toBe("Projects/X.md");
    expect(pagePathFromRef("Notes/Y.md")).toBe("Notes/Y.md");
    // An unquoted [[X]] in YAML parses as a nested list; it still reads as the wikilink.
    expect(pageTreeFields({ parent: [["Hair transplant"]], memory: "working" })).toEqual({ parent: "[[Hair transplant]]", memory: "working" });
    expect(pageTreeFields({ parent: 3, memory: "someday" })).toMatchObject({ invalidParent: 3, invalidMemory: "someday" });
  });
});

describe("tree lint on the fixture vault", () => {
  it("passes both the vault lint and the tree lint", async () => {
    expect((await lintVault(FIXTURE)).errors).toEqual([]);
    const report = await lintTree(FIXTURE);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({ treePages: 11, rooted: 11, rootNodes: { working: 4, "long-term": 5 }, inboxMachineFiles: 1, withoutParent: 0 });
  });

  it("resolves lineage root → leaf and children", async () => {
    const index = await buildTreeIndex(FIXTURE);
    const leaf = index.lineage("Projects/Hair transplant/2023 Barcelona quotes.md");
    expect(leaf.ok && formatLineage(leaf)).toBe("Working › Hair transplant › 2023 Barcelona quotes");
    const note = index.lineage("Notes/Travel insurance.md");
    expect(note.ok && note.group).toBe("long-term");
    expect(note.ok && note.steps.map(s => s.path)).toEqual(["Areas/Life admin.md", "Notes/Travel insurance.md"]);
    expect(index.children("Projects/Hair transplant.md")).toEqual(["Projects/Hair transplant/2023 Barcelona quotes.md"]);
    expect(index.lineage("Log/2026-10-31.md")).toMatchObject({ ok: false, reason: "not-a-tree-page" });
  });
});

describe("tree lint failures", () => {
  it("reports a missing Tree.md", async () => {
    const dir = await copyFixture();
    await rm(join(dir, "Tree.md"));
    const report = await lintTree(dir);
    expect(report.hasTree).toBe(false);
    expect(rules(report)).toContain("tree/missing Tree.md");
    expect(rules(report)).toContain("page/parent-not-in-tree Projects/Hair transplant.md");
  });

  it("reports pages without parent, unresolved parents, and parents not in Tree.md", async () => {
    const dir = await copyFixture();
    await writeFile(join(dir, "Notes/Orphan.md"), page("Orphan", {}));
    await writeFile(join(dir, "Notes/Dangling.md"), page("Dangling", { parent: '"[[Nowhere]]"' }));
    await writeFile(join(dir, "Notes/Self root.md"), page("Self root", { parent: '"[[Tree]]"', memory: "working" }));
    await writeFile(join(dir, "Notes/Under orphan.md"), page("Under orphan", { parent: '"[[Orphan]]"' }));
    await writeFile(join(dir, "Notes/To log.md"), page("To log", { parent: '"[[Log/2026-10-31]]"' }));
    const report = await lintTree(dir);
    expect(rules(report)).toEqual([
      "page/parent-missing Notes/Orphan.md",
      "page/parent-not-in-tree Notes/Self root.md",
      "page/parent-unresolved Notes/Dangling.md",
      "page/parent-unresolved Notes/To log.md",
    ]);
    // Under orphan hangs under a broken ancestor: the ancestor carries the error.
    expect(report.stats).toMatchObject({ withoutParent: 1, unresolvedParent: 2, parentNotInTree: 1, rooted: 11 });
  });

  it("reports cycles and depth beyond the limit", async () => {
    const dir = await copyFixture();
    await writeFile(join(dir, "Notes/Loop A.md"), page("Loop A", { parent: '"[[Loop B]]"' }));
    await writeFile(join(dir, "Notes/Loop B.md"), page("Loop B", { parent: '"[[Loop A]]"' }));
    let parent = "Areas/Life admin";
    for (let level = 2; level <= MAX_TREE_DEPTH + 1; level++) {
      await writeFile(join(dir, `Notes/Level ${level}.md`), page(`Level ${level}`, { parent: `"[[${parent}]]"` }));
      parent = `Notes/Level ${level}`;
    }
    const report = await lintTree(dir);
    expect(rules(report)).toEqual([
      `tree/cycle Notes/Loop A.md`,
      `tree/cycle Notes/Loop B.md`,
      `tree/depth Notes/Level ${MAX_TREE_DEPTH + 1}.md`,
    ]);
    expect(report.stats).toMatchObject({ cycles: 2, tooDeep: 1 });
  });

  it("reports root pages that disagree with Tree.md, memory mismatches and missing node pages", async () => {
    const dir = await copyFixture();
    const hair = join(dir, "Projects/Hair transplant.md");
    await writeFile(hair, (await readFile(hair, "utf8")).replace("memory: working", "memory: long-term"));
    const quotes = join(dir, "Projects/Hair transplant/2023 Barcelona quotes.md");
    await writeFile(quotes, (await readFile(quotes, "utf8")).replace("memory: working", "memory: long-term"));
    await rm(join(dir, "Areas/People and family.md"));
    const report = await lintTree(dir);
    expect(rules(report)).toEqual([
      "page/memory-mismatch Projects/Hair transplant/2023 Barcelona quotes.md",
      "tree/node-page-missing Tree.md",
      "tree/root-memory Projects/Hair transplant.md",
    ]);
  });

  it("reports duplicate titles as warnings without failing", async () => {
    const dir = await copyFixture();
    await mkdir(join(dir, "Notes/Old"), { recursive: true });
    await writeFile(join(dir, "Notes/Old/Travel insurance.md"), page("Travel insurance", { parent: '"[[Areas/Life admin]]"' }));
    const report = await lintTree(dir);
    expect(report.ok).toBe(true);
    expect(report.issues.map(i => `${i.rule} ${i.severity} ${i.path}`).sort()).toEqual([
      "tree/duplicate-title warning Notes/Old/Travel insurance.md",
      "tree/duplicate-title warning Notes/Travel insurance.md",
    ]);
    expect(report.stats).toMatchObject({ duplicateTitleGroups: 1, duplicateTitlePages: 2 });
  });
});

describe("tree seed", () => {
  it("emits Tree.md and one lint-clean root page per audit node", async () => {
    const files = seedTreeFiles(AUDIT_TREE_PROPOSAL, "2026-11-01");
    expect(files.map(f => f.path)).toEqual(["Tree.md", ...AUDIT_TREE_PROPOSAL.map(n => n.path)]);
    const dir = await mkdtemp(join(tmpdir(), "zenod-tree-seed-"));
    dirs.push(dir);
    for (const f of files) {
      await mkdir(join(dir, f.path, ".."), { recursive: true });
      await writeFile(join(dir, f.path), f.content);
    }
    expect((await lintVault(dir)).errors.filter(e => e.rule !== "config")).toEqual([]);
    expect((await lintTree(dir)).issues).toEqual([]);
  });
});
