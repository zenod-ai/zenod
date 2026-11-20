import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { simpleGit } from "simple-git";
import { VaultRepo, gitAuthEnv, stripUrlCredentials } from "../src/git/vaultRepo.js";

// M29 (infra-vps E2-F7): a GitHub key must never sit in a git argument (readable in `ps`) or in .git/config.
// A wrapper `git` on PATH logs every argument list and whether the key arrived through the environment; a global
// url.insteadOf sends https://github.com/ to a local bare repo so clone, pull and push run for real.
const KEY = "ghp_M29TESTKEYnotarealkey0123456789";
const KEY_B64 = Buffer.from(`x-access-token:${KEY}`).toString("base64");

describe("vault git credential travels in the environment only", () => {
  let dir: string;
  let log: string;
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => { saved[k] = process.env[k]; process.env[k] = v; };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "m29-"));
    const realGit = (await import("node:child_process")).execFileSync("which", ["git"]).toString().trim();
    log = join(dir, "git-calls.log");
    const bin = join(dir, "bin");
    await (await import("node:fs/promises")).mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\n' "ARGV: $*" >> "${log}"\nif [ -n "$GIT_CONFIG_VALUE_0" ]; then printf '%s\\n' "ENV: $GIT_CONFIG_VALUE_0" >> "${log}"; fi\nexec "${realGit}" "$@"\n`,
    );
    await chmod(join(bin, "git"), 0o755);
    const bare = join(dir, "remote.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    const sg = simpleGit(seed);
    await sg.addConfig("user.name", "t");
    await sg.addConfig("user.email", "t@t");
    await writeFile(join(seed, "a.md"), "one\n");
    await sg.add("-A");
    await sg.commit("one");
    await sg.push("origin", "HEAD:main");
    const gitconfig = join(dir, "gitconfig");
    await writeFile(gitconfig, `[url "${bare}"]\n\tinsteadOf = https://github.com/owner/vault.git\n`);
    await writeFile(join(dir, ".gitconfig"), await readFile(gitconfig, "utf8"));
    setEnv("HOME", dir);
    setEnv("XDG_CONFIG_HOME", join(dir, "xdg"));
    setEnv("PATH", `${bin}:${process.env.PATH}`);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("clones, pulls and pushes with the key in the environment, never in argv or .git/config", async () => {
    let calls = 0;
    const repo = await VaultRepo.open({
      workdir: join(dir, "work"),
      repo: "owner/vault",
      tokenProvider: async () => { calls += 1; return KEY; },
    });
    await repo.pull();
    await writeFile(join(dir, "work", "b.md"), "two\n");
    await repo.commitAndPush("two");
    expect(calls).toBeGreaterThan(0);

    const calls_log = await readFile(log, "utf8");
    expect(calls_log).not.toContain(KEY);
    expect(calls_log).not.toContain("x-access-token");
    expect(calls_log).toContain(`ENV: AUTHORIZATION: basic ${KEY_B64}`);
    expect(await readFile(join(dir, "work", ".git", "config"), "utf8")).not.toContain(KEY);
    expect(await readFile(join(dir, "work", ".git", "config"), "utf8")).toContain("https://github.com/owner/vault.git");
    const bare = simpleGit(join(dir, "remote.git"));
    expect((await bare.raw(["ls-tree", "--name-only", "main"])).split("\n")).toContain("b.md");
  });

  it("a static token takes the same route", async () => {
    const repo = await VaultRepo.open({ workdir: join(dir, "work2"), repo: "owner/vault", token: KEY });
    await writeFile(join(dir, "work2", "c.md"), "three\n");
    await repo.commitAndPush("three");
    expect(await readFile(log, "utf8")).not.toContain(KEY);
    expect(await readFile(join(dir, "work2", ".git", "config"), "utf8")).not.toContain(KEY);
  });

  it("rewrites an origin an older build left with a key in it back to the plain URL", async () => {
    const work = join(dir, "old");
    await simpleGit().clone(join(dir, "remote.git"), work);
    await simpleGit(work).remote(["set-url", "origin", `https://x-access-token:${KEY}@github.com/owner/vault.git`]);
    expect(await readFile(join(work, ".git", "config"), "utf8")).toContain(KEY);

    await VaultRepo.open({ workdir: work, repo: "owner/vault", token: KEY });
    const config = await readFile(join(work, ".git", "config"), "utf8");
    expect(config).not.toContain(KEY);
    expect(config).toContain("url = https://github.com/owner/vault.git");
  });

  it("cleans a keyed origin even when only a remoteUrl-less open is made", async () => {
    const work = join(dir, "old2");
    await simpleGit().clone(join(dir, "remote.git"), work);
    await simpleGit(work).remote(["set-url", "origin", `https://x-access-token:${KEY}@github.com/owner/vault.git`]);
    await VaultRepo.open({ workdir: work });
    expect(await readFile(join(work, ".git", "config"), "utf8")).not.toContain(KEY);
  });

  it("helpers", () => {
    expect(stripUrlCredentials(`https://x-access-token:${KEY}@github.com/o/r.git`)).toBe("https://github.com/o/r.git");
    expect(stripUrlCredentials("https://github.com/o/r.git")).toBeUndefined();
    expect(stripUrlCredentials("/tmp/bare.git")).toBeUndefined();
    expect(gitAuthEnv(KEY).GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${KEY_B64}`);
  });
});
