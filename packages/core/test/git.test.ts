import { mkdtemp, rm, writeFile, appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WriteQueue } from "../src/git/queue.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { VaultRepository } from "../src/vault/repository.js";

describe("WriteQueue", () => {
  it("serializes concurrent runs", async () => {
    const queue = new WriteQueue();
    const order: string[] = [];
    const slow = queue.run(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const fast = queue.run(async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("keeps running after a failed turn", async () => {
    const queue = new WriteQueue();
    await expect(queue.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await queue.run(async () => 42)).toBe(42);
  });
});

describe("VaultRepo", () => {
  it("is the GitHub VaultRepository adapter and publishes a compatibility revision", async () => {
    const bare = join(dir, "adapter-origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "adapter-seed");
    await simpleGit().clone(bare, seed);
    const seedGit = simpleGit(seed);
    await seedGit.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await writeFile(join(seed, "README.md"), "# Vault\n");
    await seedGit.add(["-A"]);
    await seedGit.commit("seed");
    await seedGit.push("origin", "main");

    const githubRepository: VaultRepository = await VaultRepo.open({
      workdir: join(dir, "adapter-work"),
      remoteUrl: bare,
      repo: "zenod-ai/fixture",
    });
    await writeFile(join(githubRepository.path, "README.md"), "# Updated vault\n");

    const revision = await githubRepository.commitAndPublish("update vault");

    expect(githubRepository.provider).toBe("github");
    expect(revision).toMatchObject({
      provider: "github",
      id: revision.commitSha,
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      githubUrls: [`https://github.com/zenod-ai/fixture/blob/${revision.commitSha}/README.md`],
      urls: [`https://github.com/zenod-ai/fixture/blob/${revision.commitSha}/README.md`],
    });
    expect(Number.isNaN(Date.parse(revision.committedAt))).toBe(false);
    expect(githubRepository.urlFor("README.md", "intro")).toBe(
      "https://github.com/zenod-ai/fixture/blob/main/README.md#intro",
    );

    const verify = await VaultRepo.open({ workdir: join(dir, "adapter-verify"), remoteUrl: bare });
    expect(await readFile(join(verify.path, "README.md"), "utf8")).toBe("# Updated vault\n");
  });

  let dir: string;
  let bare: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-git-"));
    bare = join(dir, "origin.git");
    await mkdir(bare);
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    // seed an initial commit so clones have a HEAD
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await writeFile(join(seed, "Index.md"), "# Index\n");
    await git.add(["-A"]);
    await git.commit("init");
    await git.push("origin", "main");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("clones, commits, and pushes", async () => {
    const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    await writeFile(join(repo.path, "Log/2026-06-11.md"), "# 2026-06-11\n", { flag: "wx" }).catch(async () => {
      await mkdir(join(repo.path, "Log"), { recursive: true });
      await writeFile(join(repo.path, "Log/2026-06-11.md"), "# 2026-06-11\n");
    });
    const sha = await repo.commitAndPush("memory: test entry");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // a fresh clone sees the commit
    const verify = await VaultRepo.open({ workdir: join(dir, "verify"), remoteUrl: bare });
    expect(await verify.headSha()).toBe(sha);
  });

  it("recovers from a rejected push via pull --rebase", async () => {
    const a = await VaultRepo.open({ workdir: join(dir, "a"), remoteUrl: bare });
    const b = await VaultRepo.open({ workdir: join(dir, "b"), remoteUrl: bare });

    await writeFile(join(a.path, "FromA.md"), "a\n");
    await a.commitAndPush("memory: from a");

    // b is now behind; its push must get rejected, rebase, and succeed
    await writeFile(join(b.path, "FromB.md"), "b\n");
    const shaB = await b.commitAndPush("memory: from b");
    expect(shaB).toMatch(/^[0-9a-f]{40}$/);

    const verify = await VaultRepo.open({ workdir: join(dir, "v"), remoteUrl: bare });
    const log = await simpleGit(verify.path).log();
    const messages = log.all.map((c) => c.message);
    expect(messages).toContain("memory: from a");
    expect(messages).toContain("memory: from b");
  });

  it("reports pending changes with before/after for the immutability check", async () => {
    const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    await appendFile(join(repo.path, "Index.md"), "appended\n");
    await writeFile(join(repo.path, "New.md"), "new\n");

    const changes = await repo.pendingChanges();
    const byPath = new Map(changes.map((c) => [c.path, c]));
    expect(byPath.get("Index.md")?.before).toBe("# Index\n");
    expect(byPath.get("Index.md")?.after).toBe("# Index\nappended\n");
    expect(byPath.get("New.md")?.before).toBeNull();
    expect(byPath.get("New.md")?.after).toBe("new\n");
  });

  it("discards uncommitted changes cleanly", async () => {
    const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    await appendFile(join(repo.path, "Index.md"), "junk\n");
    await writeFile(join(repo.path, "Stray.md"), "stray\n");
    await repo.discardChanges();
    expect(await repo.pendingChanges()).toEqual([]);
  });

  it("reuses an existing clone", async () => {
    const work = join(dir, "work");
    const first = await VaultRepo.open({ workdir: work, remoteUrl: bare });
    const second = await VaultRepo.open({ workdir: work, remoteUrl: bare });
    expect(second.path).toBe(first.path);
    expect(await second.headSha()).toBe(await first.headSha());
  });
});
