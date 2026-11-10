import { cp, mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { AnswerInput, AnswerResult, BrainLlm, VaultReadTools } from "../src/llm/types.js";
import { asksAboutAgentWork, buildMatch, MemoryIndex, MemoryIndexTenantError } from "../src/vault/memoryIndex.js";

// EPIC-9 E9-5a: the tier-0 index — per-tenant SQLite FTS5 beside the vault, BM25 over pages,
// Log entries and Tree.md roots, every hit carrying its tree path.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const QUOTES = "Projects/Boat repair/2023 Porto quotes.md";

let dirs: string[] = [];
const open: Array<{ close(): void }> = [];
afterEach(async () => {
  for (const item of open.splice(0)) item.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-memory-index-"));
  dirs.push(dir);
  return dir;
}

async function vaultFrom(files: Record<string, string>, base?: string): Promise<string> {
  const vault = join(await tempDir(), "vault");
  if (base) await cp(base, vault, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
  return vault;
}

function indexFor(vaultPath: string, path: string, tenantId = "tenant-a"): MemoryIndex {
  const index = MemoryIndex.open({ path, vaultPath, tenantId });
  open.push(index);
  return index;
}

describe("tier-0 memory index (E9-5a)", { timeout: 20_000 }, () => {
  it("lives beside the vault, not inside it, and ranks the right page first with its tree path", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const path = join(dirname(vault), "memory-index.sqlite");
    const index = indexFor(vault, path);
    const hits = await index.search("Porto quotes");
    expect(hits[0]).toMatchObject({ path: QUOTES, kind: "page", treePath: "Working memory › Boat repair › 2023 Porto quotes" });
    // The snippet is a window around a matched word, accent-insensitive.
    expect(hits[0]!.snippet.toLowerCase()).toMatch(/porto|quote/);
    // A Log entry hit is its exact evidence ref and carries the path of the page it was filed on.
    const log = hits.find((hit) => hit.kind === "log");
    expect(log).toMatchObject({ path: "Log/2026-10-31.md#^e-c64e3b", filedOn: QUOTES, treePath: "Working memory › Boat repair › 2023 Porto quotes" });
    // Nothing was written into the vault.
    expect((await simpleGit(vault).raw(["ls-files", "--others", "--exclude-standard"]).catch(() => ""))).not.toContain("sqlite");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(vault)).some((name) => name.includes("sqlite"))).toBe(false);
  });

  it("returns root rows (collapsed tree) pointing at the root page", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    const stats = await index.rebuild();
    expect(stats.rows).toBeGreaterThan(0);
    const hits = await index.search("boat repair");
    expect(hits.map((hit) => hit.path)).toContain("Projects/Boat repair.md");
    // A root row and its page share a path: one hit per path.
    expect(new Set(hits.map((hit) => hit.path)).size).toBe(hits.length);
  });

  it("has no built-in aliases and reads no Keeper notes (E9-5i, E9-5k)", async () => {
    const vault = await vaultFrom({
      "Projects/Crew.md": "---\ntitle: Crew\n---\nThe blue heron ships the weekly digest.\n",
      "Projects/Casa.md": "---\ntitle: Casa\n---\nNotes about the flat in Gràcia.\n",
      "Tree.md": "---\ntitle: Tree\n---\n## Working memory\n\n## Keeper notes\n\n- K-1 | Casa ^n-1a2b3c4d | aliases: home, mi piso | the person's words | confirmed 2026-11-02\n",
    });
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    // No hand-made spelling list in product code (root L-7): a variant the vault never writes finds nothing.
    expect(await index.search("blueheronry")).toEqual([]);
    expect((await index.search("blue heron"))[0]?.path).toBe("Projects/Crew.md");
    // A leftover Keeper-notes alias is not search help: nobody steers the index.
    expect((await index.search("mi piso"))[0]?.path).not.toBe("Projects/Casa.md");
    // Accent-insensitive (remove_diacritics 2): "gracia" finds "Gràcia".
    expect((await index.search("gracia"))[0]).toMatchObject({ path: "Projects/Casa.md", snippet: expect.stringContaining("Gràcia") });
    // Alias groups a caller passes still expand.
    expect(buildMatch("what about the heronry?", [["heronry", "blue heron"]])).toBe('"heronry"* OR "blue heron"');
  });

  it("finds a page by its aliases: frontmatter, as a list or a single string", async () => {
    const vault = await vaultFrom({
      "Projects/Northwind.md": "---\ntitle: Northwind\naliases: [\"nw crew\", \"vento\"]\n---\nShips the digest.\n",
      "Projects/Solano.md": "---\ntitle: Solano\naliases: sunny side\n---\nShips the digest too.\n",
    });
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    expect((await index.search("vento"))[0]?.path).toBe("Projects/Northwind.md");
    expect((await index.search("sunny side"))[0]?.path).toBe("Projects/Solano.md");
  });

  it("updates incrementally: only changed files are re-read; edits, additions and deletions show up", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    await index.rebuild();
    expect(await index.refresh()).toEqual({ changed: 0, removed: 0 });
    expect(await index.search("quokkaword")).toEqual([]);

    await writeFile(join(vault, "Notes/Quokka.md"), "---\ntitle: Quokka\nparent: \"[[Boat repair]]\"\n---\nThe quokkaword note.\n");
    index.markDirty();
    expect(await index.refresh()).toEqual({ changed: 1, removed: 0 });
    // Not marked dirty: search still answers from the index without re-reading anything.
    const added = await index.search("quokkaword");
    expect(added[0]).toMatchObject({ path: "Notes/Quokka.md", treePath: "Working memory › Boat repair › Quokka" });

    await unlink(join(vault, "Notes/Quokka.md"));
    index.markDirty();
    expect(await index.search("quokkaword")).toEqual([]);
  });

  it("re-derives lineage of unchanged rows when a parent moves", async () => {
    const vault = await vaultFrom({
      "Tree.md": "---\ntitle: Tree\n---\n## Working memory\n\n- House | working | [[Projects/House]] | Where to live.\n\n## Long-term memory\n\n- Family | long-term | [[Areas/Family]] | People.\n",
      "Projects/House.md": "---\ntitle: House\nparent: \"[[Tree]]\"\nmemory: working\n---\nHouse.\n",
      "Areas/Family.md": "---\ntitle: Family\nparent: \"[[Tree]]\"\nmemory: long-term\n---\nFamily.\n",
      "Notes/Visits.md": "---\ntitle: Visits\nparent: \"[[Projects/House]]\"\n---\nSaturday viewings.\n",
      "Notes/Grandma.md": "---\ntitle: Grandma\nparent: \"[[Notes/Visits]]\"\n---\nGrandma came to the viewings.\n",
    });
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    expect((await index.search("grandma"))[0]?.treePath).toBe("Working memory › House › Visits › Grandma");
    await writeFile(join(vault, "Notes/Visits.md"), "---\ntitle: Visits\nparent: \"[[Areas/Family]]\"\n---\nSaturday viewings.\n");
    index.markDirty();
    expect(await index.refresh()).toEqual({ changed: 1, removed: 0 });
    expect((await index.search("grandma"))[0]?.treePath).toBe("Long-term memory › Family › Visits › Grandma");
  });

  it("rebuild is idempotent: same vault → identical rows, and nothing left to refresh", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    const first = await index.rebuild();
    const dump = index.dump();
    const second = await index.rebuild();
    expect(index.dump()).toBe(dump);
    expect(second.rows).toBe(first.rows);
    expect(second.files).toBe(first.files);
    expect(await index.refresh()).toEqual({ changed: 0, removed: 0 });
    // An incremental index converges to the same rows as a fresh rebuild.
    await writeFile(join(vault, "Notes/Extra.md"), "---\ntitle: Extra\n---\nExtra body.\n");
    index.markDirty();
    await index.refresh();
    const incremental = index.dump();
    await index.rebuild();
    expect(index.dump()).toBe(incremental);
  });

  it("isolates tenants: another tenant's file is refused, and each index only sees its own vault", async () => {
    const vaultA = await vaultFrom({ "Notes/A.md": "---\ntitle: A\n---\nalphasecret lives here.\n" });
    const vaultB = await vaultFrom({ "Notes/B.md": "---\ntitle: B\n---\nbetasecret lives here.\n" });
    const pathA = join(dirname(vaultA), "memory-index.sqlite");
    const pathB = join(dirname(vaultB), "memory-index.sqlite");
    const a = indexFor(vaultA, pathA, "tenant-a");
    const b = indexFor(vaultB, pathB, "tenant-b");
    expect((await a.search("alphasecret")).map((hit) => hit.path)).toEqual(["Notes/A.md"]);
    expect(await a.search("betasecret")).toEqual([]);
    expect(await b.search("alphasecret")).toEqual([]);
    // Tenant B can never open (and so never query) tenant A's index file.
    expect(() => MemoryIndex.open({ path: pathA, vaultPath: vaultB, tenantId: "tenant-b" })).toThrow(MemoryIndexTenantError);
    expect(() => MemoryIndex.open({ path: pathA, vaultPath: vaultA, tenantId: "tenant-b" })).toThrow(MemoryIndexTenantError);
    // The refusal changed nothing: A still answers from its own rows.
    expect((await a.search("alphasecret")).map((hit) => hit.path)).toEqual(["Notes/A.md"]);
  });
});

describe("engine search uses the tier-0 index, scan as fallback (E9-5a)", { timeout: 30_000 }, () => {
  async function engineWithIndex(tenantId: string, files: Record<string, string>, llm: BrainLlm = {} as BrainLlm) {
    const dir = await tempDir();
    const bare = join(dir, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    await cp(TREE_FIXTURE, seed, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(seed, path)), { recursive: true });
      await writeFile(join(seed, path), content);
    }
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(dir, "data", "vault"), remoteUrl: bare });
    const state = new SqliteStateStore(":memory:");
    open.push(state);
    const indexPath = join(dir, "data", "memory-index.sqlite");
    const engine = createEngine({ repo, llm, state, memoryIndex: { path: indexPath, tenantId } });
    return { engine, indexPath, vault: repo.path };
  }

  it("serves hits with tree paths from the index and falls back to the scan when the index finds nothing", async () => {
    const { engine } = await engineWithIndex("t1", {});
    const hits = await engine.search("Porto quotes");
    expect(hits[0]).toMatchObject({ path: QUOTES, treePath: "Working memory › Boat repair › 2023 Porto quotes" });
    // Substring match inside a word: FTS5 has no such token, the scan search still finds it.
    const fallback = await engine.search("orto");
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback[0]!.treePath).toBeUndefined();
    const stats = await engine.rebuildMemoryIndex!();
    expect(stats!.rows).toBeGreaterThan(0);
  });

  it("ask_brain's search goes through the index", async () => {
    let searchText = "";
    const llm = { answer: async (_input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult> => {
      searchText = await tools.searchVault!("Porto quote");
      await tools.readNote!(QUOTES);
      return { text: "About 4,000 euros.", readPaths: [QUOTES] };
    } } as unknown as BrainLlm;
    const { engine } = await engineWithIndex("t1", {}, llm);
    await engine.ask("What were the Porto quotes?");
    expect(searchText.split("\n")[0]).toMatch(new RegExp(`^${QUOTES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(score `));
    expect(searchText).toContain("Log/2026-10-31.md#^e-c64e3b (score");
    expect(searchText).not.toContain("· tree:"); // E9-5j: lineage is structured output only
  });

  it("warms the index before the first search, which then finds the same hits with nothing left to refresh (E24-M7)", async () => {
    const { engine } = await engineWithIndex("t1", {});
    const warmed = await engine.warmMemorySearch!();
    expect(warmed!.rows).toBeGreaterThan(0);
    const timed = await engine.searchTimed!("Porto quotes");
    expect(timed.tier).toBe("index");
    expect(timed.hits[0]).toMatchObject({ path: QUOTES, treePath: "Working memory › Boat repair › 2023 Porto quotes" });
    expect(timed.index!.rows).toBe(warmed!.rows);
    const { engine: cold } = await engineWithIndex("t1", {});
    expect((await cold.searchTimed!("Porto quotes")).hits.map((hit) => hit.path)).toEqual(timed.hits.map((hit) => hit.path));
  });

  it("refuses to serve another tenant's index file", async () => {
    const { engine, indexPath, vault } = await engineWithIndex("t1", {});
    await engine.search("Porto");
    const intruder = createEngine({ repo: await VaultRepo.open({ workdir: vault }), llm: {} as BrainLlm, state: new SqliteStateStore(":memory:"), memoryIndex: { path: indexPath, tenantId: "t2" } });
    await expect(intruder.search("Porto")).rejects.toThrow(MemoryIndexTenantError);
  });
});

describe("agent reports are not the person's memories (E12-S15)", { timeout: 20_000 }, () => {
  const LOG = [
    "# 2026-11-08", "",
    "## 09:00 Voice note about the greenhouse  ^e-a10001", "- source: whatsapp", "- content-type: voice_note", "",
    "> The greenhouse heater keeps tripping, ask the electrician about a separate circuit for the greenhouse.", "",
    "## 10:00 agent_team E41-S2 greenhouse sensor  ^e-b10001", "- source: mcp", "",
    "> agent_team E41-S2 (2026-11-08, run_1a2b3c4d): greenhouse heater sensor dashboard deployed, live 1a2b3c4, greenhouse heater alerts merged.", "",
  ].join("\n");
  const PAGE = (title: string, body: string) => `---\ntitle: ${title}\ntype: project\ntags: []\ncreated: 2026-11-01\nupdated: 2026-11-08\nsummary: ${title}.\n---\n\n# ${title}\n\n${body}\n`;

  it("leaves agent reports and the moved-report archive out unless the question is about them", async () => {
    const vault = await vaultFrom({
      "Log/2026-11-08.md": LOG,
      "Projects/Garden.md": PAGE("Garden", "Beds and compost. See [[Index]].\n\n## Ops rollup\n\nAgent ops reports.\n\n- 2026-11-08 ops (1): [[2026-11-08#^e-b10001]] greenhouse heater sensor\n- Tomato watering every two days [[2026-11-08#^e-a10001]]"),
      "Archive/Agent reports/Moved report lines.md": PAGE("Moved report lines", "## 2026-11-08 from [[Projects/Garden]] line 9\n\n- greenhouse heater sensor dashboard deployed [[2026-11-08#^e-b10001]]"),
      "Index.md": "---\ntitle: Index\n---\n# Index\n",
    });
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    const mine = (await index.search("greenhouse heater")).map((hit) => hit.path);
    expect(mine).toContain("Log/2026-11-08.md#^e-a10001");
    expect(mine).not.toContain("Log/2026-11-08.md#^e-b10001");
    expect(mine).not.toContain("Archive/Agent reports/Moved report lines.md");
    // The rollup lines are not what the Garden page is about: it shows only through the person's note it cites.
    expect((await index.search("greenhouse heater")).find((hit) => hit.path === "Projects/Garden.md")?.via ?? "Log/2026-11-08.md#^e-a10001").toBe("Log/2026-11-08.md#^e-a10001");
    expect((await index.search("greenhouse sensor dashboard")).map((hit) => hit.path)).not.toContain("Projects/Garden.md");
    expect((await index.search("tomato watering")).map((hit) => hit.path)).toContain("Projects/Garden.md");
    const theirs = (await index.search("what did the agents report about the greenhouse heater")).map((hit) => hit.path);
    expect(theirs).toContain("Log/2026-11-08.md#^e-b10001");
    expect((await index.search("E41-S2 greenhouse")).map((hit) => hit.path)).toContain("Log/2026-11-08.md#^e-b10001");
  });

  it("reads a question as about the agents' work only when it names them", () => {
    for (const q of ["what did the agents report today", "what was deployed on Friday", "status of E12-S15", "EPIC-12 progress", "qué informes hay del agente", "run_51db2710"]) {
      expect(asksAboutAgentWork(q), q).toBe(true);
    }
    for (const q of ["what was in my last vn?", "why is Epic Social stuck", "the boat repair quotes", "how does my memory work", "what did I say about the greenhouse"]) {
      expect(asksAboutAgentWork(q), q).toBe(false);
    }
  });
});

describe("the index refreshes in the background after a write (E24-M7)", { timeout: 20_000 }, () => {
  it("re-reads a changed vault before the next search asks, with the same hits as a search-time refresh", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const eager = MemoryIndex.open({ path: join(dirname(vault), "eager.sqlite"), vaultPath: vault, tenantId: "tenant-a", eagerRefresh: true });
    open.push(eager);
    const lazy = indexFor(vault, join(dirname(vault), "lazy.sqlite"));
    await eager.search("porto");
    await lazy.search("porto");
    await writeFile(join(vault, "Notes/Quokka.md"), "---\ntitle: Quokka plan\n---\n# Quokka plan\n\nQuokkaword trip in March.\n");
    eager.markDirty();
    lazy.markDirty();
    // The background refresh lands on its own: the row is there before any search runs.
    await expect.poll(() => eager.stats().rows, { timeout: 5_000 }).toBeGreaterThan(lazy.stats().rows);
    const strip = (hits: Awaited<ReturnType<MemoryIndex["search"]>>) => hits.map(({ path, score, matchPercent, treePath }) => ({ path, score, matchPercent, treePath }));
    expect(strip(await eager.search("quokkaword"))).toEqual(strip(await lazy.search("quokkaword")));
    expect((await eager.search("quokkaword"))[0]?.path).toBe("Notes/Quokka.md");
  });

  it("a search during a background refresh waits for it instead of reading the rows before it", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = MemoryIndex.open({ path: join(dirname(vault), "eager.sqlite"), vaultPath: vault, tenantId: "tenant-a", eagerRefresh: true });
    open.push(index);
    await index.search("porto");
    await writeFile(join(vault, "Notes/Wombat.md"), "---\ntitle: Wombat\n---\nWombatword notes.\n");
    index.markDirty();
    let landed = false;
    const background = index.refresh().then(() => { landed = true; }); // as the timer would
    // Wait until the refresh has read the vault (dirty cleared) but not yet written its rows.
    while ((index as unknown as { dirty: boolean }).dirty) await new Promise((resolve) => setImmediate(resolve));
    expect(landed).toBe(false);
    const hits = await index.search("wombatword");
    await background;
    expect(hits[0]?.path).toBe("Notes/Wombat.md");
  });
});
