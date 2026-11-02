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
import { buildMatch, keeperAliases, MemoryIndex, MemoryIndexTenantError } from "../src/vault/memoryIndex.js";

// EPIC-9 E9-5a: the tier-0 index — per-tenant SQLite FTS5 beside the vault, BM25 over pages,
// Log entries and Tree.md roots, every hit carrying its tree path.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const QUOTES = "Projects/Hair transplant/2023 Barcelona quotes.md";

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
    const hits = await index.search("Barcelona quotes");
    expect(hits[0]).toMatchObject({ path: QUOTES, kind: "page", treePath: "Working memory › Hair transplant › 2023 Barcelona quotes" });
    // The snippet is a window around a matched word, accent-insensitive.
    expect(hits[0]!.snippet.toLowerCase()).toMatch(/barcelona|quote/);
    // A Log entry hit is its exact evidence ref and carries the path of the page it was filed on.
    const log = hits.find((hit) => hit.kind === "log");
    expect(log).toMatchObject({ path: "Log/2026-10-31.md#^e-c64e3b", filedOn: QUOTES, treePath: "Working memory › Hair transplant › 2023 Barcelona quotes" });
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
    const hits = await index.search("hair transplant");
    expect(hits.map((hit) => hit.path)).toContain("Projects/Hair transplant.md");
    // A root row and its page share a path: one hit per path.
    expect(new Set(hits.map((hit) => hit.path)).size).toBe(hits.length);
  });

  it("expands aliases: built-in (agentine ↔ agent team) and Tree.md Keeper notes", async () => {
    const vault = await vaultFrom({
      "Projects/Crew.md": "---\ntitle: Crew\n---\nThe agent team ships the weekly digest.\n",
      "Projects/Casa.md": "---\ntitle: Casa\n---\nNotes about the flat in Gràcia.\n",
      "Tree.md": "---\ntitle: Tree\n---\n## Working memory\n\n## Keeper notes\n\n- K-1 | Casa ^n-1a2b3c4d | aliases: home, mi piso | Jordi's words | confirmed 2026-11-02\n",
    });
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    expect((await index.search("agentine"))[0]?.path).toBe("Projects/Crew.md");
    expect((await index.search("home"))[0]?.path).toBe("Projects/Casa.md");
    expect((await index.search("mi piso"))[0]?.path).toBe("Projects/Casa.md");
    // Accent-insensitive (remove_diacritics 2): "gracia" finds "Gràcia".
    expect((await index.search("gracia"))[0]).toMatchObject({ path: "Projects/Casa.md", snippet: expect.stringContaining("Gràcia") });
    expect(buildMatch("what about the agentine?", [["agentine", "agent team"]])).toBe('"agentine"* OR "agent team"');
  });

  // E9-5g: the index reads aliases in the formats E9-5b writes, never a second format.
  it("reads Keeper-note aliases as E9-5b writes them (treeSteering.ts), and only that form", () => {
    const tree = [
      "## Keeper notes", "",
      "- K-1 | Agent Team ^n-0f1e2d3c | aliases: agentine, agent team, agent_team | Jordi's words | confirmed 2026-11-02",
      "- K-2 | Agent Team, EpicSpine | keep apart | different things | confirmed 2026-11-02",
      "- alias: A = B",
    ].join("\n");
    expect(keeperAliases(tree)).toEqual([["Agent Team", "agentine", "agent team", "agent_team"]]);
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

  it("loads Keeper-note aliases after a restart with an up-to-date index, and re-reads them when Tree.md changes", async () => {
    const tree = (notes: string) => `---\ntitle: Tree\n---\n## Working memory\n\n## Keeper notes\n\n${notes}`;
    const vault = await vaultFrom({
      "Projects/Casa.md": "---\ntitle: Casa\n---\nNotes about the flat.\n",
      "Projects/Huerto.md": "---\ntitle: Huerto\n---\nTomatoes and basil.\n",
      "Tree.md": tree("- K-1 | Casa | aliases: home | words | confirmed 2026-11-02\n"),
    });
    const path = join(dirname(vault), "idx.sqlite");
    const first = indexFor(vault, path);
    expect((await first.search("home"))[0]?.path).toBe("Projects/Casa.md");
    first.close();
    open.splice(open.indexOf(first), 1);

    // A new process: the file is current, so no row changes, but the aliases must still load.
    const second = indexFor(vault, path);
    expect((await second.search("home"))[0]?.path).toBe("Projects/Casa.md");

    // A steer appends a note (through the write queue, which marks the index dirty).
    await writeFile(join(vault, "Tree.md"), tree("- K-1 | Casa | aliases: home | words | confirmed 2026-11-02\n- K-2 | Huerto | aliases: allotment | words | confirmed 2026-11-02\n"));
    second.markDirty();
    expect((await second.search("allotment"))[0]?.path).toBe("Projects/Huerto.md");
  });

  it("updates incrementally: only changed files are re-read; edits, additions and deletions show up", async () => {
    const vault = await vaultFrom({}, TREE_FIXTURE);
    const index = indexFor(vault, join(dirname(vault), "idx.sqlite"));
    await index.rebuild();
    expect(await index.refresh()).toEqual({ changed: 0, removed: 0 });
    expect(await index.search("quokkaword")).toEqual([]);

    await writeFile(join(vault, "Notes/Quokka.md"), "---\ntitle: Quokka\nparent: \"[[Hair transplant]]\"\n---\nThe quokkaword note.\n");
    index.markDirty();
    expect(await index.refresh()).toEqual({ changed: 1, removed: 0 });
    // Not marked dirty: search still answers from the index without re-reading anything.
    const added = await index.search("quokkaword");
    expect(added[0]).toMatchObject({ path: "Notes/Quokka.md", treePath: "Working memory › Hair transplant › Quokka" });

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
    const hits = await engine.search("Barcelona quotes");
    expect(hits[0]).toMatchObject({ path: QUOTES, treePath: "Working memory › Hair transplant › 2023 Barcelona quotes" });
    // Substring match inside a word: FTS5 has no such token, the scan search still finds it.
    const fallback = await engine.search("arcelon");
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback[0]!.treePath).toBeUndefined();
    const stats = await engine.rebuildMemoryIndex!();
    expect(stats!.rows).toBeGreaterThan(0);
  });

  it("ask_brain's search goes through the index: Log entry hits name the page they were filed on", async () => {
    let searchText = "";
    const llm = { answer: async (_input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult> => {
      searchText = await tools.searchVault!("Barcelona quote");
      await tools.readNote!(QUOTES);
      return { text: "About 4,000 euros.", readPaths: [QUOTES] };
    } } as unknown as BrainLlm;
    const { engine } = await engineWithIndex("t1", {}, llm);
    await engine.ask("What were the Barcelona quotes?");
    expect(searchText.split("\n")[0]).toMatch(new RegExp(`^${QUOTES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(score `));
    expect(searchText).toContain("Log/2026-10-31.md#^e-c64e3b (score");
    expect(searchText).toMatch(/^Log\/2026-10-31\.md#\^e-c64e3b .*· tree: Working memory › Hair transplant › 2023 Barcelona quotes$/m);
  });

  it("refuses to serve another tenant's index file", async () => {
    const { engine, indexPath, vault } = await engineWithIndex("t1", {});
    await engine.search("Barcelona");
    const intruder = createEngine({ repo: await VaultRepo.open({ workdir: vault }), llm: {} as BrainLlm, state: new SqliteStateStore(":memory:"), memoryIndex: { path: indexPath, tenantId: "t2" } });
    await expect(intruder.search("Barcelona")).rejects.toThrow(MemoryIndexTenantError);
  });
});
