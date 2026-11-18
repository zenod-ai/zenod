import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { cleanSlateVault } from "../src/vault/cleanSlate.js";
import { ensureSchemaV1, LEGACY_OKF_INDEX, OKF_INDEX } from "../src/vault/migrate.js";

/**
 * Obsidian-style link check (E25-S4): a wikilink resolves when its target
 * names a note by path or by a unique file name; a markdown link resolves
 * only when it points at a file. A link to a folder is unresolved: Obsidian
 * shows it as a missing note.
 */
async function markdownFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(root, abs)));
    else if (entry.name.endsWith(".md")) out.push(relative(root, abs));
  }
  return out;
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile()).catch(() => false);
}

async function unresolvedLinks(vault: string): Promise<{ links: number; unresolved: string[] }> {
  const files = await markdownFiles(vault);
  const byName = new Map<string, number>();
  for (const f of files) byName.set(basename(f, ".md"), (byName.get(basename(f, ".md")) ?? 0) + 1);
  let links = 0;
  const unresolved: string[] = [];
  for (const file of files) {
    const text = (await readFile(join(vault, file), "utf8")).replace(/`[^`]*`/g, "");
    for (const m of text.matchAll(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      links++;
      const target = m[1].trim().replace(/\.md$/, "");
      const ok = (await isFile(join(vault, `${target}.md`))) || byName.get(basename(target)) === 1;
      if (!ok) unresolved.push(`${file}: ${m[0]}`);
    }
    for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      links++;
      const target = decodeURIComponent(m[1].split("#")[0]);
      if (!(await isFile(join(vault, dirname(file), target)))) unresolved.push(`${file}: ${m[0]}`);
    }
  }
  return { links, unresolved };
}

describe("starter index (E25-S4)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-starter-index-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a new vault has links and every one resolves", async () => {
    await ensureSchemaV1(dir);
    const report = await unresolvedLinks(dir);
    expect(report.links).toBeGreaterThan(0);
    expect(report.unresolved).toEqual([]);
  });

  it("the old starter index had five unresolved folder links (the checker sees them)", async () => {
    await mkdir(join(dir, "Areas"), { recursive: true });
    await writeFile(join(dir, "Areas", "Areas Index.md"), "# Areas Index\n");
    await writeFile(join(dir, "index.md"), LEGACY_OKF_INDEX);
    const report = await unresolvedLinks(dir);
    expect(report.unresolved).toHaveLength(5);
  });

  it("rewrites an untouched old starter index and leaves an edited one alone", async () => {
    await writeFile(join(dir, "index.md"), LEGACY_OKF_INDEX);
    expect(await ensureSchemaV1(dir)).toContain("index.md");
    expect(await readFile(join(dir, "index.md"), "utf8")).toBe(OKF_INDEX);
    expect(await ensureSchemaV1(dir)).toEqual([]);

    const edited = `${LEGACY_OKF_INDEX}\nMy own line.\n`;
    await writeFile(join(dir, "index.md"), edited);
    expect(await ensureSchemaV1(dir)).toEqual([]);
    expect(await readFile(join(dir, "index.md"), "utf8")).toBe(edited);
  });

  it("a clean-slate vault has no unresolved link", async () => {
    const vault = join(dir, "vault");
    await simpleGit().init(["--initial-branch=main", vault]);
    const repo = await VaultRepo.open({ workdir: vault, authorName: "test", authorEmail: "test@example.com" });
    await cleanSlateVault(repo, { now: () => new Date("2026-11-18T00:00:00Z") });
    const report = await unresolvedLinks(vault);
    expect(report.links).toBeGreaterThan(0);
    expect(report.unresolved).toEqual([]);
  });
});
