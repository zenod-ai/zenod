import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { VaultRepo } from "../src/git/vaultRepo.js";

// EPIC-24 M34: an idle tenant's read sync asks the remote for its head (one cheap ref listing) and fetches only when it moved.
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "zenod-pull-skip-")); roots.push(root);
  const remote = join(root, "origin.git"); await mkdir(remote); await simpleGit(remote).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ remoteUrl: remote, workdir: join(root, "writer") });
  await writeFile(join(repo.path, "README.md"), "base\n"); await repo.commitAndPublish("base");
  const peer = await VaultRepo.open({ remoteUrl: remote, workdir: join(root, "peer") });
  const fetchSpy = vi.spyOn((repo as unknown as { git: { fetch: (...a: unknown[]) => unknown } }).git, "fetch");
  return { root, remote, repo, peer, fetchSpy };
}

describe("filing pull skips the fetch when the remote head is the one already held (M34)", () => {
  it("skips fetch and merge when nothing moved, and says so with its step timings", async () => {
    const { repo, fetchSpy } = await setup();
    const head = await repo.headSha();
    await repo.pullForFiling();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repo.lastPull).toMatchObject({ kind: "skipped", fetchMs: 0, mergeMs: 0 });
    expect(repo.lastPull!.totalMs).toBeGreaterThanOrEqual(repo.lastPull!.headMs);
    expect(await repo.headSha()).toBe(head);
  });

  it("fetches and fast-forwards when the remote moved, then skips again", async () => {
    const { repo, peer, fetchSpy } = await setup();
    await writeFile(join(peer.path, "From peer.md"), "new note\n");
    const advanced = await peer.commitAndPublish("peer note");
    await repo.pullForFiling();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(repo.lastPull).toMatchObject({ kind: "fetched" });
    expect(await repo.headSha()).toBe(advanced.id);
    expect(await readFile(join(repo.path, "From peer.md"), "utf8")).toBe("new note\n");
    await repo.pullForFiling();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(repo.lastPull).toMatchObject({ kind: "skipped" });
  });

  it("still advances a clone that fetched earlier but never merged", async () => {
    const { repo, peer } = await setup();
    await writeFile(join(peer.path, "Later.md"), "later\n");
    const advanced = await peer.commitAndPublish("peer later");
    await repo.currentPublishedRevision(); // a fetch from another path: tracking ref moved, working tree did not
    expect(await repo.headSha()).not.toBe(advanced.id);
    await repo.pullForFiling();
    expect(repo.lastPull).toMatchObject({ kind: "skipped" });
    expect(await repo.headSha()).toBe(advanced.id);
  });

  it("leaves a prepared local commit alone when the remote did not move", async () => {
    const { repo, fetchSpy } = await setup();
    await writeFile(join(repo.path, "Prepared.md"), "prepared\n");
    const prepared = await repo.commit("prepared");
    await repo.pullForFiling();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repo.headSha()).toBe(prepared);
  });

  it("an unreachable remote takes the full path and fails as before", async () => {
    const { root, remote, repo, fetchSpy } = await setup();
    await rm(remote, { recursive: true, force: true });
    await expect(repo.pullForFiling()).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(root).toBeTruthy();
  });
});
