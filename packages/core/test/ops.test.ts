import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getNote, NoteNotFoundError } from "../src/ops/get.js";
import { searchVault } from "../src/ops/search.js";
import { githubUrl } from "../src/vault/github.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/vault", import.meta.url));
const LOCATION = { repo: "zenod-ai/fixture", branch: "main" };

describe("searchVault", () => {
  it("finds the insurance area by tag, title, and body", async () => {
    const hits = await searchVault(FIXTURE, "insurance", LOCATION);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toBe("Areas/Insurance.md");
    expect(hits[0]!.githubUrl).toBe("https://github.com/zenod-ai/fixture/blob/main/Areas/Insurance.md");
  });

  it("finds body-only matches (evidence in the Log)", async () => {
    const hits = await searchVault(FIXTURE, "March 2027");
    expect(hits.map((h) => h.path)).toContain("Log/2026-06-10.md");
  });

  it("finds evidence Log files by path terms (date in the query)", async () => {
    const hits = await searchVault(FIXTURE, "2026-06-10");
    expect(hits.map((h) => h.path)).toContain("Log/2026-06-10.md");
  });

  it("finds attachment artifacts by filename", async () => {
    const hits = await searchVault(FIXTURE, "policy scan");
    const hit = hits.find((h) => h.path === "_attachments/insurance/2026-06-10 Axa policy scan.pdf");
    expect(hit).toBeDefined();
    expect(hit!.snippet).toBe("(attachment artifact)");
  });

  it("returns nothing for nonsense queries", async () => {
    expect(await searchVault(FIXTURE, "xyzzy-nonexistent-9000")).toEqual([]);
  });

  it("completes in under 500ms on the fixture vault", async () => {
    const started = performance.now();
    await searchVault(FIXTURE, "insurance");
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("getNote", () => {
  it("returns frontmatter, body, and provenance URL", async () => {
    const note = await getNote(FIXTURE, "Areas/Insurance.md", LOCATION);
    expect(note.frontmatter.title).toBe("Insurance");
    expect(note.body).toContain("Axa");
    expect(note.githubUrl).toContain("/blob/main/Areas/Insurance.md");
  });

  it("throws NoteNotFoundError for missing notes", async () => {
    await expect(getNote(FIXTURE, "Areas/Nope.md")).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("rejects path traversal", async () => {
    await expect(getNote(FIXTURE, "../../etc/passwd")).rejects.toBeInstanceOf(NoteNotFoundError);
    await expect(getNote(FIXTURE, "/etc/passwd")).rejects.toBeInstanceOf(NoteNotFoundError);
  });
});

describe("githubUrl", () => {
  it("builds blob URLs with encoded paths", () => {
    expect(githubUrl(LOCATION, "Projects/Sample Project.md")).toBe(
      "https://github.com/zenod-ai/fixture/blob/main/Projects/Sample%20Project.md",
    );
  });

  it("returns empty string when no repo is configured", () => {
    expect(githubUrl({}, "Index.md")).toBe("");
  });
});
