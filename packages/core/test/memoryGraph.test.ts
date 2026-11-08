import { cp, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryGraph, MEMORY_GRAPH_TREE_TITLE, type MemoryGraphView } from "../src/vault/memoryGraph.js";
import { MemoryIndex } from "../src/vault/memoryIndex.js";

// EPIC-12 E12-S2: the memory graph — pages as nodes, wikilinks and the EPIC-9 tree as edges,
// stored per tenant in the tier-0 index, served one neighbourhood at a time.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));

let dirs: string[] = [];
const open: Array<{ close(): void }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) item.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function vaultFrom(files: Record<string, string>, base?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-memory-graph-"));
  dirs.push(dir);
  const vault = join(dir, "vault");
  await mkdir(vault, { recursive: true });
  if (base) await cp(base, vault, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
  return vault;
}

function indexFor(vault: string, tenantId = "tenant-a"): MemoryIndex {
  const index = MemoryIndex.open({ path: join(dirname(vault), "memory-index.sqlite"), vaultPath: vault, tenantId });
  open.push(index);
  return index;
}

const page = (title: string, body: string, parent?: string) =>
  `---\ntitle: ${title}\ntype: note\n${parent ? `parent: "${parent}"\n` : ""}---\n\n# ${title}\n\n${body}\n`;
const paths = (view: MemoryGraphView | null) => view!.nodes.map((node) => node.path).sort();
const relationOf = (view: MemoryGraphView | null, path: string) => view!.nodes.find((node) => node.path === path)?.relation;

describe("memory graph (E12-S2)", { timeout: 30_000 }, () => {
  it("makes each page a node and resolves wikilinks by path, then by name", () => {
    const graph = MemoryGraph.build(
      [
        { path: "Areas/House.md", title: "House", summary: "", treePath: "" },
        { path: "Notes/House.md", title: "Other house", summary: "", treePath: "" },
        { path: "Notes/Roof.md", title: "Roof", summary: "", treePath: "" },
      ],
      [
        { from: "Notes/Roof.md", target: "Areas/House", kind: "link" },
        { from: "Notes/Roof.md", target: "Missing page", kind: "link" },
        { from: "Notes/House.md", target: "Roof", kind: "link" },
        { from: "Notes/House.md", target: "roof", kind: "link" },
      ],
    );
    expect(graph.size).toEqual({ nodes: 3, edges: 2 });
    expect(graph.resolve("[[Areas/House|home]]")).toBe("Areas/House.md");
    expect(graph.resolve("Roof")).toBe("Notes/Roof.md");
    expect(graph.resolve("Nowhere")).toBeNull();
    const view = graph.neighbourhood("Roof")!;
    expect(view.center).toBe("Notes/Roof.md");
    expect(view.edges).toEqual(expect.arrayContaining([
      { from: "Notes/Roof.md", to: "Areas/House.md", kind: "link" },
      { from: "Notes/House.md", to: "Notes/Roof.md", kind: "link" },
    ]));
    expect(relationOf(view, "Areas/House.md")).toBe("link");
    expect(relationOf(view, "Notes/House.md")).toBe("backlink");
  });

  it("reads the tree from the vault: Tree.md roots, page parents, links, with an overview and a neighbourhood", async () => {
    const vault = await vaultFrom({
      "Notes/Engine.md": page("Engine", "The yard quoted the engine with the [[2023 Porto quotes]] and the [[Travel insurance]] covers it.", "[[Boat repair]]"),
    }, TREE_FIXTURE);
    const index = indexFor(vault);
    const overview = await index.graph();
    expect(overview!.center).toBe("Tree.md");
    expect(overview!.nodes[0]).toMatchObject({ path: "Tree.md", title: MEMORY_GRAPH_TREE_TITLE, kind: "tree", relation: "center" });
    const roots = overview!.nodes.filter((node) => node.kind === "root");
    expect(roots.map((node) => node.title).sort()).toEqual([
      "Boat repair", "Cabin decision", "Ideas and knowledge", "Infrastructure and runbooks", "Launching Moss Lantern",
      "Launching Tide Cart", "Life admin", "People and family", "Ventures and work",
    ]);
    expect(overview!.edges).toContainEqual({ from: "Tree.md", to: "Projects/Boat repair.md", kind: "tree" });
    // "A level-1 node in the [[Tree]]" is not drawn as a second, dashed line.
    expect(overview!.edges.filter((edge) => edge.to === "Tree.md" || (edge.from === "Tree.md" && edge.kind === "link"))).toEqual([]);

    const boat = await index.graph({ center: "Projects/Boat repair.md" });
    expect(relationOf(boat, "Tree.md")).toBe("parent");
    expect(relationOf(boat, "Projects/Boat repair/2023 Porto quotes.md")).toBe("child");
    expect(relationOf(boat, "Notes/Engine.md")).toBe("child");
    const engine = await index.graph({ center: "[[Engine]]" });
    expect(engine!.center).toBe("Notes/Engine.md");
    expect(relationOf(engine, "Projects/Boat repair.md")).toBe("parent");
    expect(relationOf(engine, "Projects/Boat repair/2023 Porto quotes.md")).toBe("link");
    expect(relationOf(engine, "Notes/Travel insurance.md")).toBe("link");
    expect(engine!.nodes.find((node) => node.path === "Notes/Engine.md")!.treePath).toBe("Working memory › Boat repair › Engine");
    // Log entries and Inbox receipts are evidence, not memory nodes.
    expect(overview!.total.nodes).toBe(13);
    expect(await index.graph({ center: "Log/2026-10-31.md" })).toBeNull();
  });

  it("gives each drawn edge its weighted link's strength, in its own direction (E18-W1 round 2)", async () => {
    const vault = await vaultFrom({
      "Notes/Engine.md": page("Engine", "The yard quoted the engine with the [[2023 Porto quotes]] and the [[Travel insurance]] covers it.", "[[Boat repair]]"),
    }, TREE_FIXTURE);
    const index = indexFor(vault);
    const engine = await index.graph({ center: "Engine" });
    const edge = (from: string, to: string) => engine!.edges.find((e) => e.from === from && e.to === to);
    // A wikilink is 0.9 forward; the tree's parent → child 0.8 (memoryWeights.ts).
    expect(edge("Notes/Engine.md", "Notes/Travel insurance.md")?.strength).toBeCloseTo(0.9, 2);
    expect(edge("Projects/Boat repair.md", "Notes/Engine.md")?.strength).toBeGreaterThanOrEqual(0.5);
    for (const e of engine!.edges) expect(e.strength).toBeGreaterThan(0);
    // Tree.md ties every root to one hub and has no weighted link: its edges carry no strength.
    const overview = await index.graph();
    expect(overview!.edges.find((e) => e.from === "Tree.md")).not.toHaveProperty("strength");
  });

  it("adds a related edge between drawn pages that share notes: weak for an old note, stronger for a recent one (E18-W1 round 2)", async () => {
    const log = (date: string, id: string, text: string) => `# ${date}\n\n## 10:00 ${text} ^${id}\n- source: whatsapp\n\n> ${text}\n`;
    const vault = await vaultFrom({
      "Log/2024-01-10.md": log("2024-01-10", "e-aaa111", "Old note about the shed and the fence"),
      "Log/2026-11-07.md": log("2026-11-07", "e-bbb222", "New note about the shed and the gate"),
      "Notes/Shed.md": page("Shed", "Cedar. [[Fence]] [[Gate]] Seen in [[2024-01-10#^e-aaa111]] and [[2026-11-07#^e-bbb222]]."),
      "Notes/Fence.md": page("Fence", "Posts. [[2024-01-10#^e-aaa111]]"),
      "Notes/Gate.md": page("Gate", "Hinges. [[2026-11-07#^e-bbb222]]"),
    });
    const index = MemoryIndex.open({ path: join(dirname(vault), "memory-index.sqlite"), vaultPath: vault, tenantId: "t", now: () => Date.parse("2026-11-08T12:00:00Z") });
    open.push(index);
    const shed = await index.graph({ center: "Shed" });
    const related = shed!.edges.filter((edge) => edge.kind === "related");
    // Shed links to Fence and Gate already; only Fence and Gate share nothing, so no chord between them.
    expect(related).toEqual([]);
    const fence = await index.graph({ center: "Fence" });
    // Fence and Shed: a wikilink (drawn as a link) plus the old shared note, so no second edge.
    expect(fence!.edges.filter((edge) => edge.kind === "related")).toEqual([]);
    // Unlink them: what is left between Fence and Shed is the shared old note, weak.
    await writeFile(join(vault, "Notes/Shed.md"), page("Shed", "Cedar. [[Gate]] Seen in [[2024-01-10#^e-aaa111]] and [[2026-11-07#^e-bbb222]]."));
    index.markDirty();
    const gate = await index.graph({ center: "Gate" });
    const shedGate = gate!.edges.find((edge) => edge.kind === "link");
    expect(shedGate?.strength).toBeGreaterThan(0.8);
    const shedView = await index.graph({ center: "Shed" });
    expect(shedView!.nodes.map((node) => node.path)).not.toContain("Notes/Fence.md");
    const overview = await index.graph();
    const weak = overview!.edges.find((edge) => edge.kind === "related" && [edge.from, edge.to].sort().join() === "Notes/Fence.md,Notes/Shed.md");
    expect(weak?.strength).toBeLessThan(0.2);
    // Lit views keep their own edges: no related edges are added there.
    const lit = await index.graph({ lit: ["Notes/Fence.md", "Notes/Shed.md"] });
    expect(lit!.edges.some((edge) => edge.kind === "related")).toBe(false);
  });

  it("updates incrementally on a new filing: a new page joins, links written before it resolve, a removed page leaves", async () => {
    const vault = await vaultFrom({
      "Notes/Garden.md": page("Garden", "Order boards for the [[Shed]] before Friday."),
    });
    const index = indexFor(vault);
    expect((await index.graph({ center: "Garden" }))!.edges).toEqual([]);
    await writeFile(join(vault, "Notes/Shed.md"), page("Shed", "Cedar, see [[Garden]]."));
    index.markDirty();
    const garden = await index.graph({ center: "Garden" });
    expect(paths(garden)).toEqual(["Notes/Garden.md", "Notes/Shed.md"]);
    expect(garden!.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "Notes/Garden.md", to: "Notes/Shed.md", kind: "link" }),
      expect.objectContaining({ from: "Notes/Shed.md", to: "Notes/Garden.md", kind: "link" }),
    ]));
    await unlink(join(vault, "Notes/Shed.md"));
    index.markDirty();
    expect(paths(await index.graph({ center: "Garden" }))).toEqual(["Notes/Garden.md"]);
    expect(await index.graph({ center: "Shed" })).toBeNull();
  });

  it("caps a hub's view, keeps its parent and links ahead of a crowd of backlinks, and counts what it left out", () => {
    const pages = [{ path: "Areas/Hub.md", title: "Hub", summary: "", treePath: "" }, { path: "Areas/Top.md", title: "Top", summary: "", treePath: "" }];
    const edges: Array<{ from: string; target: string; kind: "link" | "tree" }> = [{ from: "Areas/Hub.md", target: "Top", kind: "tree" }];
    for (let i = 0; i < 300; i++) {
      pages.push({ path: `Notes/n${i}.md`, title: `n${i}`, summary: "", treePath: "" });
      edges.push({ from: `Notes/n${i}.md`, target: "Hub", kind: "link" });
    }
    pages.push({ path: "Notes/out.md", title: "out", summary: "", treePath: "" });
    edges.push({ from: "Areas/Hub.md", target: "out", kind: "link" });
    const view = MemoryGraph.build(pages, edges).neighbourhood("Hub", 20)!;
    expect(view.nodes).toHaveLength(20);
    expect(relationOf(view, "Areas/Top.md")).toBe("parent");
    expect(relationOf(view, "Notes/out.md")).toBe("link");
    expect(view.more).toEqual({ parent: 0, child: 0, link: 0, backlink: 300 - 17 });
    expect(view.nodes.find((node) => node.path === "Areas/Hub.md")!.hidden).toBe(300 - 17);
  });

  it("stays fast on a vault of several thousand notes", async () => {
    const files: Record<string, string> = {};
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const links = [(i * 7 + 1) % N, (i * 13 + 5) % N, (i * 31 + 9) % N].map((j) => `[[Note ${j}]]`).join(", ");
      files[`Notes/Note ${i}.md`] = page(`Note ${i}`, `About topic ${i % 50}. See ${links}.`, i % 100 === 0 ? undefined : `[[Note ${i - (i % 100)}]]`);
    }
    const vault = await vaultFrom(files);
    const index = indexFor(vault);
    await index.rebuild();
    let started = performance.now();
    const first = await index.graph({ center: "Note 1200" });
    const firstMs = performance.now() - started;
    started = performance.now();
    for (let i = 0; i < 20; i++) await index.graph({ center: `Note ${i * 97}` });
    const warmMs = (performance.now() - started) / 20;
    expect(first!.total.nodes).toBe(N);
    expect(first!.nodes.length).toBeLessThanOrEqual(40);
    // Cold includes building the whole graph from SQLite; warm is the cached graph.
    expect(firstMs).toBeLessThan(1500);
    expect(warmMs).toBeLessThan(50);
    console.log(`[memory-graph] ${N} notes: first view ${Math.round(firstMs)} ms, cached view ${warmMs.toFixed(1)} ms`);
  });

  it("never serves another tenant's graph from the same file", async () => {
    const vault = await vaultFrom({ "Notes/A.md": page("A", "x") });
    indexFor(vault, "tenant-a").close();
    open.pop();
    expect(() => indexFor(vault, "tenant-b")).toThrow(/belongs to tenant tenant-a/);
  });
});

describe("lit answers in the graph (E12-S13)", { timeout: 30_000 }, () => {
  const node = (path: string) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), summary: "", treePath: "" });
  const graph = () => MemoryGraph.build(
    ["Areas/House.md", "Notes/Roof.md", "Notes/Gutter.md", "Notes/Plumber.md", "Notes/Far.md", "Notes/Shared.md"].map(node),
    [
      { from: "Notes/Roof.md", target: "House", kind: "tree" },
      { from: "Notes/Gutter.md", target: "House", kind: "tree" },
      { from: "Notes/Roof.md", target: "Shared", kind: "link" },
      { from: "Notes/Plumber.md", target: "Shared", kind: "link" },
      { from: "Notes/Far.md", target: "Plumber", kind: "link" },
    ],
  );

  it("lights the asked memories best first, adds the pages between them and marks those links lit", () => {
    const view = graph().litView(["Roof", "Gutter", "Plumber", "Nowhere"]);
    expect(view.center).toBe("Notes/Roof.md");
    expect(view.lit).toEqual([
      { ref: "Roof", path: "Notes/Roof.md" },
      { ref: "Gutter", path: "Notes/Gutter.md" },
      { ref: "Plumber", path: "Notes/Plumber.md" },
      { ref: "Nowhere", path: null },
    ]);
    expect(view.nodes.slice(0, 3).map((n) => [n.path, n.relation])).toEqual([
      ["Notes/Roof.md", "lit"], ["Notes/Gutter.md", "lit"], ["Notes/Plumber.md", "lit"],
    ]);
    // House is the parent of two lit memories, Shared is linked from two: both bridge them.
    expect(relationOf(view, "Areas/House.md")).toBe("bridge");
    expect(relationOf(view, "Notes/Shared.md")).toBe("bridge");
    // Far touches one lit memory only: not drawn.
    expect(relationOf(view, "Notes/Far.md")).toBeUndefined();
    expect(view.edges.filter((e) => e.lit).map((e) => `${e.from}>${e.to}`).sort()).toEqual([
      "Areas/House.md>Notes/Gutter.md", "Areas/House.md>Notes/Roof.md", "Notes/Plumber.md>Notes/Shared.md", "Notes/Roof.md>Notes/Shared.md",
    ]);
  });

  it("shows a lone memory's parent unlit, and takes path retrieval's walks and strengths when given (EPIC-18)", () => {
    const lone = graph().litView(["Gutter"]);
    expect(relationOf(lone, "Areas/House.md")).toBe("parent");
    expect(lone.edges).toEqual([{ from: "Areas/House.md", to: "Notes/Gutter.md", kind: "tree" }]);
    const walked = graph().litView(["Gutter", "Far"], {
      paths: [["Gutter", "House", "Roof", "Shared", "Plumber", "Far"]],
      strengths: new Map([["Notes/Roof.md\nNotes/Shared.md", 0.9]]),
    });
    for (const path of ["Areas/House.md", "Notes/Roof.md", "Notes/Shared.md", "Notes/Plumber.md"]) expect(relationOf(walked, path)).toBe("bridge");
    expect(walked.edges.find((e) => e.from === "Notes/Roof.md" && e.to === "Notes/Shared.md")).toMatchObject({ lit: true, strength: 0.9 });
    expect(walked.edges.every((e) => e.lit)).toBe(true);
  });

  it("lights a voice note from the vault with the page it was filed into", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = indexFor(vault);
    const entry = "Log/2026-10-31.md#^e-c64e3b";
    const view = await index.graph({ lit: [entry, "Projects/Boat repair.md"] });
    const note = view!.nodes.find((n) => n.path === entry)!;
    expect(note).toMatchObject({ kind: "note", relation: "lit" });
    expect(relationOf(view, "Projects/Boat repair.md")).toBe("lit");
    expect(relationOf(view, "Projects/Boat repair/2023 Porto quotes.md")).toBe("bridge");
    expect(view!.edges).toContainEqual({ from: entry, to: "Projects/Boat repair/2023 Porto quotes.md", kind: "filed", lit: true, strength: 0.9 });
  });

  it("stays a neighbourhood on a large vault", () => {
    const pages = [node("Areas/Hub.md")];
    const edges: Array<{ from: string; target: string; kind: "link" | "tree" }> = [];
    for (let i = 0; i < 5000; i++) {
      pages.push(node(`Notes/n${i}.md`));
      edges.push({ from: `Notes/n${i}.md`, target: "Hub", kind: "tree" }, { from: `Notes/n${i}.md`, target: `n${(i + 1) % 5000}`, kind: "link" });
    }
    const big = MemoryGraph.build(pages, edges);
    const started = performance.now();
    const view = big.litView(["n1", "n2", "n3", "n4", "n5"], { limit: 24 });
    expect(performance.now() - started).toBeLessThan(200);
    expect(view.nodes.length).toBeLessThanOrEqual(24);
    expect(relationOf(view, "Areas/Hub.md")).toBe("bridge");
  });
});
