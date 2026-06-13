import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvidence } from "../src/engine/evidence.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { cleanSlateVault } from "../src/vault/cleanSlate.js";
import { lintVault } from "../src/vault/lint.js";

describe("cleanSlateVault", () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-clean-slate-"));
    vault = join(dir, "vault");
    await simpleGit().init(["--initial-branch=main", vault]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function openRepo(): Promise<VaultRepo> {
    return VaultRepo.open({ workdir: vault, authorName: "test", authorEmail: "test@example.com" });
  }

  it("creates an inspectable two-commit clean-slate vault", async () => {
    const repo = await openRepo();
    const result = await cleanSlateVault(repo, { now: () => new Date("2026-06-13T00:00:00Z") });

    expect(result.initialCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.setupCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.initialCommitSha).not.toBe(result.setupCommitSha);
    expect(result.initialPaths).toContain("README.md");
    expect(result.initialPaths).toContain("AGENTS.md");
    expect(result.setupPaths).toEqual([".brain/config.yml", "Areas/Areas Index.md", "_templates/Area.md"]);
    expect(result.topLevelPaths).toContain("Inbox/");
    expect(result.topLevelPaths).toContain("Log/");
    expect(result.lint.ok).toBe(true);

    const git = simpleGit(vault);
    const log = await git.log();
    expect(log.all.map((entry) => entry.message)).toEqual([
      "clean-slate: initialize Zenod schema",
      "clean-slate: initial vault",
    ]);
    expect(await git.show([`${result.initialCommitSha}:README.md`])).toContain("clean slate");
    expect(await git.show([`${result.setupCommitSha}:.brain/config.yml`])).toContain("schema_version: 1");
  });

  it("can accept the first evidence append after setup", async () => {
    const repo = await openRepo();
    await cleanSlateVault(repo, { now: () => new Date("2026-06-13T00:00:00Z") });

    const evidence = await appendEvidence(
      vault,
      "First clean-slate capture",
      "cli",
      false,
      new Date("2026-06-13T12:00:00Z"),
    );

    expect(evidence.logPath).toBe("Log/2026-06-13.md");
    expect(evidence.anchor).toMatch(/^e-[0-9a-f]{6}$/);
    expect((await lintVault(vault)).ok).toBe(true);
  });

  it("can push the two clean-slate commits to an empty remote", async () => {
    const bare = join(dir, "origin.git");
    const work = join(dir, "remote-work");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    await simpleGit().clone(bare, work);

    const repo = await VaultRepo.open({ workdir: work, remoteUrl: bare });
    const result = await cleanSlateVault(repo, { push: true });

    const verify = join(dir, "verify");
    await simpleGit().clone(bare, verify);
    const log = await simpleGit(verify).log();
    expect(log.all.map((entry) => entry.message)).toEqual([
      "clean-slate: initialize Zenod schema",
      "clean-slate: initial vault",
    ]);
    expect(log.latest?.hash).toBe(result.setupCommitSha);
  });

  it("refuses tracked content instead of overwriting an existing vault", async () => {
    const git = simpleGit(vault);
    await git.addConfig("user.name", "test");
    await git.addConfig("user.email", "test@example.com");
    await writeFile(join(vault, "Existing.md"), "# Existing\n");
    await git.add(["-A"]);
    await git.commit("existing vault");

    await expect(cleanSlateVault(await openRepo())).rejects.toThrow(/tracked files: Existing\.md/);
  });

  it("refuses untracked content instead of absorbing user files", async () => {
    await writeFile(join(vault, "Loose.md"), "# Loose\n");
    await expect(cleanSlateVault(await openRepo())).rejects.toThrow(/empty working tree.*Loose\.md/);
  });
});
