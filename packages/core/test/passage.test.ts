import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readNotePassage } from "../src/ops/passage.js";
import { getNote } from "../src/ops/get.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function vault(body: string, path = "Log/2026-01-01.md") {
  const root = await mkdtemp(join(tmpdir(), "zmr-passage-")); roots.push(root);
  await mkdir(join(root, "Log")); await mkdir(join(root, "Notes"));
  await writeFile(join(root, path), body); return root;
}
const path = "Log/2026-01-01.md";
const entry = `## 00:00 Target  ^e-000001\n- source: drive\n- content-type: text\n- source-id: drive-original\n\n> ${"😀İ世界🧠 ".repeat(2300)}\n> access word: cobalt-seventeen\n`;
const neighbor = "\n## 00:01 Neighbor  ^e-000002\n> NEIGHBOR-SECRET\n";
const body = `# Daily log\n\n${entry}${neighbor}`;

describe("bounded memory passages", () => {
  it.each(["github", "google_drive"] as const)("traverses a huge exact entry with %s identity, no dropped Unicode or neighbors", async provider => {
    const root = await vault(body);
    const resolver = (file: string) => ({ path: file, provider, revisionId: "revision-17", url: provider === "github" ? "https://github.com/synthetic/vault/blob/revision-17/" + file : "https://drive.google.com/file/d/synthetic/view" });
    const ref = `${path}#^e-000001`;
    let cursor: string | undefined;
    let reconstructed = "";
    let count = 0;
    do {
      const page = await readNotePassage(root, ref, { cursor, maxChars: 701 }, resolver);
      expect(page.body.length).toBeLessThanOrEqual(701);
      expect(page.body.isWellFormed()).toBe(true);
      expect(page.body).not.toContain("NEIGHBOR-SECRET");
      expect(page.identity).toBe(ref);
      expect(page.source).toMatchObject({ provider, revisionId: "revision-17" });
      expect(page.extent.end - page.extent.start).toBe(page.body.length);
      expect(page.version).toMatch(/^sha256:[a-f0-9]{64}$/);
      reconstructed += page.body; cursor = page.nextCursor ?? undefined;
      expect(++count).toBeLessThan(100);
    } while (cursor);
    expect(reconstructed).toBe(entry + "\n");
    expect((await getNote(root, path)).body).toBe(body);
  });

  it("locates a late passage, reports skipped extent and resumes without conflating no match with absence", async () => {
    const root = await vault(body);
    const page = await readNotePassage(root, path, { query: "ACCESS WORD", maxChars: 500 });
    expect(page.extent.start).toBeGreaterThan(8000);
    expect(page.body).toContain("cobalt-seventeen");
    expect(page.body).not.toContain("NEIGHBOR-SECRET");
    expect(page.identity).toBe(`${path}#^e-000001`);
    expect(page.omittedBefore).toBe(true); expect(page.truncated).toBe(true);
    expect(page.queryMatched).toBe(true); expect(page.nextCursor).toBeTruthy();
    const next = await readNotePassage(root, path, { cursor: page.nextCursor! });
    expect(next.body).toContain("NEIGHBOR-SECRET");
    const miss = await readNotePassage(root, path, { query: "missing fact" });
    expect(miss.queryMatched).toBe(false); expect(miss.nextCursor).toBeTruthy();
  });

  it("traverses legacy notes and all sections without omitting bytes", async () => {
    const legacy = "Intro\n\n# First\n" + "A".repeat(9000) + "\n## Second\n終わり\n";
    const root = await vault(legacy, "Notes/Legacy");
    let reconstructed = ""; let cursor: string | undefined;
    do {
      const page = await readNotePassage(root, "Notes/Legacy", { cursor });
      expect(page.source.path).toBe("Notes/Legacy");
      reconstructed += page.body; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(reconstructed).toBe(legacy);
    expect((await readNotePassage(root, "Notes/Legacy", { query: "終わり" })).identity).toContain("#section-");
  });

  it("rejects missing anchors, invalid budgets/cursors, wrong source and stale content/revision", async () => {
    const root = await vault(body);
    await expect(readNotePassage(root, `${path}#^e-ffff00`)).rejects.toThrow("not found");
    await expect(readNotePassage(root, `${path}#anything`)).rejects.toThrow("anchor");
    await expect(readNotePassage(root, path, { maxChars: 8001 })).rejects.toThrow("maxChars");
    await expect(readNotePassage(root, path, { cursor: "nonsense" })).rejects.toThrow("cursor");
    await expect(readNotePassage(root, path, { cursor: Buffer.from("null").toString("base64url") })).rejects.toThrow("Invalid read cursor");
    const first = await readNotePassage(root, path);
    await expect(readNotePassage(root, `${path}#^e-000001`, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await expect(readNotePassage(root, path, { cursor: first.nextCursor!, query: "word" })).rejects.toThrow("omit query");
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()); cursor.offset = -10;
    await expect(readNotePassage(root, path, { cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url") })).rejects.toThrow("offset");
    const revision = (id: string) => (file: string) => ({ path: file, provider: "google_drive" as const, url: "", revisionId: id });
    const versioned = await readNotePassage(root, path, {}, revision("one"));
    await expect(readNotePassage(root, path, { cursor: versioned.nextCursor! }, revision("two"))).rejects.toThrow("revision");
    await writeFile(join(root, path), body + "changed");
    await expect(readNotePassage(root, path, { cursor: first.nextCursor! })).rejects.toThrow("Stale");
  });

  it("makes oversized frontmatter traversable separately without leaking it into an exact evidence read", async () => {
    const summary = "metadata ".repeat(1400) + "metadata-tail";
    const root = await vault(`---\nsummary: ${summary}\n---\n${body}`);
    let cursor: string | undefined; let text = "";
    do {
      const page = await readNotePassage(root, path, { part: "frontmatter", cursor });
      expect(page.part).toBe("frontmatter");
      expect(page.body.length).toBeLessThanOrEqual(8000);
      expect(page.body).not.toContain("NEIGHBOR-SECRET");
      text += page.body; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(JSON.parse(text).summary).toBe(summary);
    const first = await readNotePassage(root, path, { part: "frontmatter" });
    await expect(readNotePassage(root, path, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await expect(readNotePassage(root, `${path}#^e-000001`, { part: "frontmatter" })).rejects.toThrow("cannot access");
  });

  it("isolates legacy single-space evidence anchors and empty notes", async () => {
    const legacy = "# Log\n\n## 01:00 Old format ^e-abcdef\n> legacy fact\n\n## 02:00 Neighbor ^e-123456\n> secret\n";
    const root = await vault(legacy);
    const page = await readNotePassage(root, `${path}#^e-abcdef`);
    expect(page.body).toContain("legacy fact");
    expect(page.body).not.toContain("secret");
    expect(page.nextCursor).toBeNull();
    await writeFile(join(root, "Notes/Empty.md"), "");
    expect(await readNotePassage(root, "Notes/Empty.md")).toMatchObject({ body: "", nextCursor: null, truncated: false });
  });

  it("rejects tenant-crossing cursors and filesystem escape paths, including symlinks", async () => {
    const root = await vault(body); const other = await vault(body);
    const first = await readNotePassage(root, path);
    await expect(readNotePassage(other, path, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await symlink(join(other, path), join(root, "Notes/Escape.md"));
    await mkdir(join(root, ".brain"));
    await writeFile(join(root, ".brain/secret.md"), "internal state");
    await symlink(join(root, ".brain/secret.md"), join(root, "Notes/Internal.md"));
    for (const bad of ["../outside", "..\\outside", "/etc/passwd", "Notes/Escape.md", "Notes/Internal.md", ".git/config", "Notes/../../outside"]) {
      await expect(readNotePassage(root, bad)).rejects.toThrow();
    }
  });
});
