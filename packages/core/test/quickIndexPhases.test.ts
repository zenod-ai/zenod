import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { BrainLlm } from "../src/llm/types.js";
import type { QuickIndexPhases } from "../src/vault/quickIndex.js";

// EPIC-24 M34: the tick reports where its time went, and an unchanged remote costs no fetch and no rebuild.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("quickIndexBase reports its phases (M34)", { timeout: 30_000 }, () => {
  it("pull skipped and base cached on an idle tick; fetched and rebuilt after a remote change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-quick-phases-")); dirs.push(dir);
    const bare = join(dir, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    await cp(TREE_FIXTURE, seed, { recursive: true });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]); await git.commit("seed vault"); await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(dir, "data", "vault"), remoteUrl: bare });
    const state = new SqliteStateStore(":memory:");
    // readSyncTtlMs 0: every tick pulls, as the 5-minute clock does in production.
    const engine = createEngine({ repo, llm: {} as BrainLlm, state, readSyncTtlMs: 0 });
    // Settle the vault's file times so the racy-file rule does not hide the cache.
    const old = new Date(Date.now() - 60_000);
    const { utimes } = await import("node:fs/promises");
    for (const file of (await git.raw(["ls-files"])).split("\n").filter(Boolean)) await utimes(join(repo.path, file), old, old);

    const first: QuickIndexPhases = {};
    const base = await engine.quickIndexBase!(first);
    expect(base).not.toBeNull();
    expect(first.pull).toMatchObject({ kind: "skipped" }); // the clone already held the remote head
    expect(first).toMatchObject({ rebuilt: true });

    const second: QuickIndexPhases = {};
    expect(await engine.quickIndexBase!(second)).toBe(base);
    expect(second.pull).toMatchObject({ kind: "skipped", fetchMs: 0, mergeMs: 0 });
    expect(second).toMatchObject({ rebuilt: false, rebuildMs: 0 });
    expect(second.pullMs).toBeTypeOf("number");
    expect(second.statMs).toBeTypeOf("number");

    // A note lands on the remote: the next tick fetches it and the base sees it.
    await writeFile(join(seed, "Projects/Boat repair/Rudder.md"), "---\ntitle: Rudder\nparent: \"[[Boat repair]]\"\n---\nThe rudder is stuck.\n");
    await git.add(["-A"]); await git.commit("remote note"); await git.push("origin", "main");
    const third: QuickIndexPhases = {};
    const next = await engine.quickIndexBase!(third);
    expect(third.pull).toMatchObject({ kind: "fetched" });
    expect(next).not.toBe(base);
    expect(next!.places.some((place) => place.path === "Projects/Boat repair/Rudder.md")).toBe(true);
  });
});
