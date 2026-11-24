// E7-S32: a tester brings an existing Obsidian vault into Zenod in one step. Unit tests on the engine's
// importNotes and one end-to-end run: the sample vault (test/fixtures/obsidian-sample) read the way the
// browser reads a picked folder, POSTed to /api/vault/import on a real app over a real git vault, then found
// by search and opened as a note with its frontmatter and [[links]] intact.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine, NOTES_IMPORT_LIMITS, SqliteStateStore, VaultRepo, type BrainEngine, type BrainLlm } from "zenod";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { hostedCapabilityViolation } from "../src/zenodUnit.js";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "obsidian-sample");

/** Every model call fails the test: an import must never spend AI credit. */
class NoLlm implements BrainLlm {
  async classify(): Promise<never> { throw new Error("no LLM in an import"); }
  async composePage(): Promise<never> { throw new Error("no LLM in an import"); }
  async answer(): Promise<never> { throw new Error("no LLM in an import"); }
  async describeImage(): Promise<string> { throw new Error("no LLM in an import"); }
  async work(): Promise<never> { throw new Error("no LLM in an import"); }
  async extractBacklog(): Promise<never> { throw new Error("no LLM in an import"); }
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-notes-import-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function vaultEngine(): Promise<{ engine: BrainEngine; repo: VaultRepo; bare: string }> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  await mkdir(join(seed, ".brain"), { recursive: true });
  await writeFile(join(seed, ".brain/config.yml"), "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n");
  await writeFile(join(seed, "Index.md"), "---\ntitle: Index\n---\n\n# Index\n");
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("vault");
  await git.push("origin", "main");
  const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
  const engine = createEngine({ repo, llm: new NoLlm(), state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-24T10:00:00Z") });
  return { engine, repo, bare };
}

/** What the browser sends for a picked folder: the .md notes, hidden folders (.obsidian) and pictures left out. */
async function sampleAsBrowserSendsIt(): Promise<Array<{ name: string; content: string }>> {
  const out: Array<{ name: string; content: string }> = [];
  async function walk(at: string): Promise<void> {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) out.push({ name: relative(SAMPLE, full), content: await readFile(full, "utf8") });
    }
  }
  await walk(SAMPLE);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

describe("importNotes (E7-S32)", { timeout: 60_000 }, () => {
  it("writes every note unchanged under Imported/<vault>/ as ONE published revision, with no model call", async () => {
    const { engine, repo, bare } = await vaultEngine();
    const work = simpleGit(repo.path);
    const before = (await work.revparse(["HEAD"])).trim();
    const files = await sampleAsBrowserSendsIt();
    const result = await engine.importNotes!({ vaultName: "My Garden", files });
    expect(result).toMatchObject({ folder: "Imported/My Garden/", written: 3, unchanged: 0 });
    const after = (await work.revparse(["HEAD"])).trim();
    expect(result.revision?.commitSha).toBe(after);
    expect((await work.raw(["rev-list", "--count", `${before}..${after}`])).trim()).toBe("1");
    expect((await work.raw(["diff", "--name-only", before, after])).trim().split("\n")).toEqual([
      "Imported/My Garden/Daily/2026-11-20.md",
      "Imported/My Garden/Projects/Garden plan.md",
      "Imported/My Garden/Welcome.md",
    ]);
    expect((await simpleGit(bare).revparse(["main"])).trim()).toBe(after);
    for (const file of files) {
      expect(await readFile(join(repo.path, "Imported/My Garden", file.name), "utf8")).toBe(file.content);
    }
  });

  it("imports again without a new revision when nothing changed, and counts a changed note", async () => {
    const { engine } = await vaultEngine();
    const files = await sampleAsBrowserSendsIt();
    await engine.importNotes!({ vaultName: "Garden", files });
    expect(await engine.importNotes!({ vaultName: "Garden", files })).toMatchObject({ written: 0, unchanged: 3, revision: null });
    const changed = files.map((file) => file.name === "Welcome.md" ? { ...file, content: `${file.content}\nOne more line.\n` } : file);
    expect(await engine.importNotes!({ vaultName: "Garden", files: changed })).toMatchObject({ written: 1, unchanged: 2 });
  });

  it("refuses paths outside the folder, non-notes and the limits, and leaves the vault clean", async () => {
    const { engine, repo } = await vaultEngine();
    const work = simpleGit(repo.path);
    const before = (await work.revparse(["HEAD"])).trim();
    const note = (name: string, content = "x") => ({ name, content });
    await expect(engine.importNotes!({ vaultName: "V", files: [note("../../Log/2026-11-24.md")] })).rejects.toThrow("notes_import_bad_path");
    await expect(engine.importNotes!({ vaultName: "V", files: [note("/etc/a.md")] })).rejects.toThrow("notes_import_bad_path");
    await expect(engine.importNotes!({ vaultName: "V", files: [note("a.txt")] })).rejects.toThrow("notes_import_bad_path");
    await expect(engine.importNotes!({ vaultName: "V", files: [note(".obsidian/x.md")] })).rejects.toThrow("notes_import_bad_path");
    await expect(engine.importNotes!({ vaultName: "V", files: [] })).rejects.toThrow("notes_import_empty");
    await expect(engine.importNotes!({ vaultName: "V", files: [note("a.md"), note("a.md")] })).rejects.toThrow("notes_import_duplicate_path");
    await expect(engine.importNotes!({ vaultName: "V", files: [note("big.md", "x".repeat(NOTES_IMPORT_LIMITS.maxFileBytes + 1))] })).rejects.toThrow("notes_import_file_too_big");
    await expect(engine.importNotes!({ vaultName: "V", files: Array.from({ length: NOTES_IMPORT_LIMITS.maxFiles + 1 }, (_, i) => note(`n${i}.md`)) })).rejects.toThrow("notes_import_too_many");
    const fat = "x".repeat(NOTES_IMPORT_LIMITS.maxFileBytes);
    const count = Math.ceil(NOTES_IMPORT_LIMITS.maxTotalBytes / NOTES_IMPORT_LIMITS.maxFileBytes) + 1;
    await expect(engine.importNotes!({ vaultName: "V", files: Array.from({ length: count }, (_, i) => note(`n${i}.md`, fat)) })).rejects.toThrow("notes_import_too_big");
    expect((await work.revparse(["HEAD"])).trim()).toBe(before);
    expect((await work.status()).files).toEqual([]);
  });

  it("cleans the vault name into one safe folder", async () => {
    const { engine } = await vaultEngine();
    expect((await engine.importNotes!({ vaultName: "../../Log", files: [{ name: "a.md", content: "a" }] })).folder).toBe("Imported/Log/");
    expect((await engine.importNotes!({ vaultName: "  ", files: [{ name: "a.md", content: "a" }] })).folder).toBe("Imported/Obsidian/");
    expect((await engine.importNotes!({ vaultName: "Notas de Marta ☀", files: [{ name: "a.md", content: "a" }] })).folder).toBe("Imported/Notas de Marta/");
  });
});

describe("POST /api/vault/import end to end (E7-S32)", { timeout: 60_000 }, () => {
  it("imports the sample vault, finds a note by its words and opens it with frontmatter and links", async () => {
    const { engine } = await vaultEngine();
    const runtime = new Runtime(join(dir, "data"));
    runtime.getEngine = async () => engine;
    const app = createApp(runtime);
    const auth = { Authorization: `Bearer ${runtime.settings.apiToken()}` };

    const res = await app.request("/api/vault/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ vaultName: "obsidian-sample", files: await sampleAsBrowserSendsIt() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; folder: string; written: number; headSha: string };
    expect(body).toMatchObject({ ok: true, folder: "Imported/obsidian-sample/", written: 3 });
    expect(body.headSha).toMatch(/^[0-9a-f]{40}$/);

    const search = await app.request(`/api/search?q=${encodeURIComponent("fennel north bed")}`, { headers: auth });
    const hits = (await search.json() as { hits: Array<{ path: string }> }).hits;
    expect(hits.map((hit) => hit.path)).toContain("Imported/obsidian-sample/Projects/Garden plan.md");

    const opened = await app.request(`/api/note?path=${encodeURIComponent("Imported/obsidian-sample/Welcome.md")}`, { headers: auth });
    const note = await opened.json() as Record<string, unknown>;
    expect(JSON.stringify(note)).toContain("[[Garden plan]]");
    expect(JSON.stringify(note)).toContain("garden");

    const bad = await app.request("/api/vault/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ vaultName: "x", files: [{ name: "a.txt", content: "x" }] }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "notes_import_bad_path", message: "One note has a path Zenod cannot keep." } });
  });

  it("is open to a signed-in hosted tester", () => {
    expect(hostedCapabilityViolation("POST", "/api/vault/import")).toBeNull();
  });
});
