import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { publicationContentHash } from "../src/vault/publicationGuard.js";
import type { VaultPublicationGuard } from "../src/vault/repository.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "zenod-filing-publication-")); roots.push(root);
  const remote = join(root, "origin.git"); await mkdir(remote); await simpleGit(remote).init(true, { "--initial-branch": "main" });
  const repo = await VaultRepo.open({ remoteUrl: remote, workdir: join(root, "writer") });
  await writeFile(join(repo.path, "README.md"), "base\n"); await repo.commitAndPublish("base");
  const base = await repo.currentPublishedRevision();
  await mkdir(join(repo.path, "Inbox")); await mkdir(join(repo.path, "Notes"));
  const receiptPath = "Inbox/filing-fixture.md";
  const receipt = "---\nstatus: filing-record\n---\n\nfixture filing revision\n";
  const note = "A cited idea.\r\n";
  await writeFile(join(repo.path, receiptPath), receipt); await writeFile(join(repo.path, "Notes/Idea.md"), note);
  const guard: VaultPublicationGuard = { expectedRevision: base, receiptPath,
    expectedFiles: { [receiptPath]: publicationContentHash(receipt), "Notes/Idea.md": publicationContentHash(note) } };
  return { root, remote, repo, base, guard, receiptPath };
}

describe("guarded filing publication", () => {
  it("recovers a prepared commit without calling it durable before push, and replays a published ancestor", async () => {
    const { root, remote, repo, base, guard } = await setup();
    const prepared = await repo.commit("prepared fixture");
    expect((await repo.currentRevision()).id).toBe(prepared);
    expect((await repo.currentPublishedRevision()).id).toBe(base.id);
    await repo.pullForFiling(); // Must not rebase the prepared transaction.
    expect(await repo.headSha()).toBe(prepared);
    const published = await repo.commitAndPublish("recover prepared", guard);
    expect(published.id).toBe(prepared);
    const peer = await VaultRepo.open({ remoteUrl: remote, workdir: join(root, "peer") });
    await writeFile(join(peer.path, "Unrelated.md"), "later change\n"); await peer.commitAndPublish("advance remote");
    const replay = await repo.commitAndPublish("lost response replay", guard);
    expect(replay.id).toBe(prepared);
    expect((await simpleGit(remote).log(["main"])).all.filter(commit => commit.hash === prepared)).toHaveLength(1);
  });

  it("rejects unrelated edits/commits and stale remote context without rebase or overwrite", async () => {
    const { root, remote, repo, base, guard } = await setup();
    await writeFile(join(repo.path, "Unexpected.md"), "must never promote this\n");
    await expect(repo.commitAndPublish("invalid extra path", guard)).rejects.toMatchObject({ failure: { code: "conflict" } });
    expect(await repo.headSha()).toBe(base.id);
    await rm(join(repo.path, "Unexpected.md"));
    const prepared = await repo.commit("prepared fixture");
    const peer = await VaultRepo.open({ remoteUrl: remote, workdir: join(root, "peer") });
    await writeFile(join(peer.path, "Remote.md"), "new context\n"); const advanced = await peer.commitAndPublish("advance before publication");
    await expect(repo.commitAndPublish("stale plan", guard)).rejects.toMatchObject({ failure: { code: "conflict" } });
    expect(await repo.headSha()).toBe(prepared);
    expect((await repo.currentPublishedRevision()).id).toBe(advanced.id);
    await expect(repo.pullForFiling()).rejects.toThrow();
    expect(await repo.headSha()).toBe(prepared);
  });

  it("checks the execution fence before committing and before publishing prepared work", async () => {
    const { repo, base, guard } = await setup();
    const expired = { ...guard, assertActive: () => { throw new Error("claim expired"); } };
    await expect(repo.commitAndPublish("stale before commit", expired)).rejects.toThrow("claim expired");
    expect(await repo.headSha()).toBe(base.id);
    await repo.commit("prepared before claim lost");
    await expect(repo.commitAndPublish("stale before push", expired)).rejects.toThrow("claim expired");
    expect((await repo.currentPublishedRevision()).id).toBe(base.id);
  });
});
