import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchVault } from "../src/ops/search.js";
import { fileURLToPath } from "node:url";
import { formatMemoryLineage, loadMemoryTree } from "../src/vault/lineage.js";

// EPIC-9 E9-3a fixture: a small vault in the E9-2a schema (Tree.md levels 0/1 + page `parent:`),
// three levels deep, with a legacy page that has no parent and one whose parent does not resolve.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const FILES: Record<string, string> = {
  "Tree.md": `---\ntitle: Tree\n---\n# Memory tree\n\n## Working memory\n\n- Hair transplant | working | [[Projects/Hair transplant]] | Deciding on a hair transplant.\n- House decision | working | [[Projects/House decision]] | Where to buy a house.\n\n## Long-term memory\n\n- Ventures and work | long-term | [[Areas/Ventures and work]] | The businesses over time.\n`,
  "Projects/Hair transplant.md": `---\ntitle: Hair transplant\nparent: "[[Tree]]"\nmemory: working\n---\n# Hair transplant\n\nOptions dossier.\n`,
  "Projects/House decision.md": `---\ntitle: House decision\nparent: "[[Tree]]"\nmemory: working\n---\nShortlist.\n`,
  "Areas/Ventures and work.md": `---\ntitle: Ventures and work\nparent: "[[Tree]]"\nmemory: long-term\n---\nCompanies.\n`,
  "Notes/Barcelona quotes 2023.md": `---\ntitle: Barcelona quotes 2023\nparent: "[[Hair transplant]]"\n---\n# Barcelona quotes\n\nZetaword quote of 4,000 EUR [[2026-10-31#^e-c64e3b]].\n`,
  "Notes/Turkey clinics.md": `---\ntitle: Turkey clinics\nparent: "[[Hair transplant]]"\n---\nZetaword clinics in Istanbul [[2026-10-30#^e-aaaaaa]] [[2026-10-31#^e-c64e3b]].\n`,
  "Notes/Maresme.md": `---\ntitle: Maresme\nparent: "[[Projects/House decision]]"\n---\nZetaword coastal option.\n`,
  "Notes/Alpha9 tax.md": `---\ntitle: Alpha9 tax\nparent: "[[Ventures and work]]"\n---\nZetaword AEAT and gestorías.\n`,
  "Notes/AEAT filing.md": `---\ntitle: AEAT filing\nparent: "[[Alpha9 tax]]"\n---\nZetaword 2026 Q3 filing.\n`,
  "Notes/Legacy page.md": `---\ntitle: Legacy page\n---\nZetaword from before the tree.\n`,
  "Notes/Broken parent.md": `---\ntitle: Broken parent\nparent: "[[Nowhere]]"\n---\nOrphaned.\n`,
  "Log/2026-10-31.md": `# 2026-10-31\n\n## 10:00 Barcelona quote ^e-c64e3b\n- source: whatsapp\n\n> Barcelona quote 4,000 EUR\n`,
};

let vault: string;

beforeAll(async () => {
  vault = await mkdtemp(join(tmpdir(), "zenod-lineage-"));
  for (const [path, content] of Object.entries(FILES)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
});
afterAll(async () => { await rm(vault, { recursive: true, force: true }); });

const titles = (nodes: Array<{ title: string }>) => nodes.map((node) => node.title);

describe("memory tree lineage (E9-3a)", () => {
  it("returns the root → leaf path and evidence anchor for 5 search hits; ranking unchanged", async () => {
    const hits = await searchVault(vault, "zetaword");
    const tree = await loadMemoryTree(vault);
    const byPath = new Map(await Promise.all(hits.map(async (hit) => [hit.path, await tree.lineageOf(hit.path)] as const)));
    expect(byPath.size).toBe(6);

    const barcelona = byPath.get("Notes/Barcelona quotes 2023.md")!;
    expect(barcelona.placement).toBe("placed");
    expect(barcelona.lineage).toEqual([
      { path: null, title: "Working memory", memory: "working" },
      { path: "Projects/Hair transplant.md", title: "Hair transplant", memory: "working" },
      { path: "Notes/Barcelona quotes 2023.md", title: "Barcelona quotes 2023", memory: "working" },
    ]);
    expect(barcelona.evidence).toEqual(["Log/2026-10-31.md#^e-c64e3b"]);
    expect(formatMemoryLineage(barcelona)).toBe("Working memory › Hair transplant › Barcelona quotes 2023 ← Log/2026-10-31.md#^e-c64e3b");

    expect(titles(byPath.get("Notes/Turkey clinics.md")!.lineage)).toEqual(["Working memory", "Hair transplant", "Turkey clinics"]);
    expect(byPath.get("Notes/Turkey clinics.md")!.evidence).toEqual(["Log/2026-10-30.md#^e-aaaaaa", "Log/2026-10-31.md#^e-c64e3b"]);
    expect(titles(byPath.get("Notes/Maresme.md")!.lineage)).toEqual(["Working memory", "House decision", "Maresme"]);
    expect(byPath.get("Notes/Maresme.md")!.lineage[0]!.path).toBeNull();
    expect(titles(byPath.get("Notes/Alpha9 tax.md")!.lineage)).toEqual(["Long-term memory", "Ventures and work", "Alpha9 tax"]);
    const aeat = byPath.get("Notes/AEAT filing.md")!;
    expect(titles(aeat.lineage)).toEqual(["Long-term memory", "Ventures and work", "Alpha9 tax", "AEAT filing"]);
    expect(aeat.lineage.every((node) => node.memory === "long-term")).toBe(true);
  });

  it("returns parent and children for a tree node", async () => {
    const tree = await loadMemoryTree(vault);
    const node = await tree.nodeView("Projects/Hair transplant.md");
    expect(node.placement).toBe("placed");
    expect(titles(node.lineage)).toEqual(["Working memory", "Hair transplant"]);
    expect(node.parent).toEqual({ path: null, title: "Working memory", memory: "working" });
    expect(node.children).toEqual([
      { path: "Notes/Barcelona quotes 2023.md", title: "Barcelona quotes 2023", memory: "working" },
      { path: "Notes/Turkey clinics.md", title: "Turkey clinics", memory: "working" },
    ]);
    expect(titles((await tree.nodeView("Notes/Alpha9 tax.md")).children)).toEqual(["AEAT filing"]);
    expect((await tree.nodeView("Notes/AEAT filing.md")).children).toEqual([]);
  });

  it("an unplaced page returns empty lineage, never an error", async () => {
    const tree = await loadMemoryTree(vault);
    expect(await tree.lineageOf("Notes/Legacy page.md")).toEqual({ placement: "unplaced", lineage: [], evidence: [] });
    expect(await tree.lineageOf("Log/2026-10-31.md")).toMatchObject({ placement: "unplaced", lineage: [] });
    expect(await tree.lineageOf("Notes/Missing.md")).toEqual({ placement: "unplaced", lineage: [], evidence: [] });
    expect(await tree.lineageOf("Notes/Broken parent.md")).toEqual({ placement: "unplaced", lineage: [], evidence: [] });
    expect(await tree.nodeView("Notes/Legacy page.md")).toMatchObject({ placement: "unplaced", lineage: [], parent: null, children: [] });
    expect(formatMemoryLineage(await tree.lineageOf("Notes/Legacy page.md"))).toBe("");
  });

  it("a vault with no Tree.md and no parents (today's vaults) is entirely unplaced", async () => {
    const bare = await mkdtemp(join(tmpdir(), "zenod-lineage-bare-"));
    try {
      await mkdir(join(bare, "Notes"));
      await writeFile(join(bare, "Notes/A.md"), "---\ntitle: A\n---\nBody [[2026-01-01#^e-abcdef]]\n");
      const tree = await loadMemoryTree(bare);
      expect(await tree.lineageOf("Notes/A.md")).toEqual({ placement: "unplaced", lineage: [], evidence: ["Log/2026-01-01.md#^e-abcdef"] });
    } finally { await rm(bare, { recursive: true, force: true }); }
  });

  it("a parent cycle is unplaced, not a hang or an error", async () => {
    const cyc = await mkdtemp(join(tmpdir(), "zenod-lineage-cycle-"));
    try {
      await mkdir(join(cyc, "Notes"));
      await writeFile(join(cyc, "Notes/A.md"), "---\nparent: \"[[B]]\"\n---\nA\n");
      await writeFile(join(cyc, "Notes/B.md"), "---\nparent: \"[[A]]\"\n---\nB\n");
      const tree = await loadMemoryTree(cyc);
      expect(await tree.lineageOf("Notes/A.md")).toEqual({ placement: "unplaced", lineage: [], evidence: [] });
    } finally { await rm(cyc, { recursive: true, force: true }); }
  });

  it("reads E9-2a's tree fixture vault", async () => {
    const tree = await loadMemoryTree(TREE_FIXTURE);
    const barcelona = await tree.lineageOf("Projects/Hair transplant/2023 Barcelona quotes.md");
    expect(formatMemoryLineage(barcelona)).toBe("Working memory › Hair transplant › 2023 Barcelona quotes ← Log/2026-10-31.md#^e-c64e3b");
    expect(formatMemoryLineage(await tree.lineageOf("Notes/Travel insurance.md"))).toBe("Long-term memory › Life admin › Travel insurance");
    const root = await tree.nodeView("Projects/Hair transplant.md");
    expect(root.parent).toEqual({ path: null, title: "Working memory", memory: "working" });
    expect(root.children.map((child) => child.path)).toEqual(["Projects/Hair transplant/2023 Barcelona quotes.md"]);
  });
});
