import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidatePages, relevantLinks, classifyCandidates, composeFocusedPage, SUMMARY_MAX_CHARS, boundExistingSummary, appendAliasEvidence } from "../src/engine/meaningNotes.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import { scanVault } from "../src/vault/pages.js";
import type { BrainLlm, ComposePageInput } from "../src/llm/types.js";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const fm = { title: "Insurance", type: "area", tags: ["insurance"], created: "2026-06-10", updated: "2026-06-10", summary: "Insurance policies." };
const citation = "[[2026-06-11#^e-abc123]]";
const input = (currentContent: string | null): ComposePageInput => ({ currentContent, path: "Areas/Insurance.md", template: "", evidenceEntry: "Travel cover renews in April.", citation,
  classification: { confidence: 1, tags: [], summary: "Travel", pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: currentContent ? "update" : "create" }] }, tagVocabulary: ["insurance"], today: "2026-06-11", requiredType: "area", linkHints: ["[[Notes/Axa]]"] });
const llm = (compose: BrainLlm["composePage"]) => ({ composePage: compose } as BrainLlm);
describe("focused meaning notes", () => {
  it("repeats bounded section updates without losing unrelated claims, citations or metadata", async () => {
    const unrelated = `## Mortgage\n\n${"Unrelated mortgage detail. ".repeat(1500)} [[2026-06-10#^e-7f3a2c]]\n`;
    let current = serializeNote({ ...fm, custom: { retained: true } }, `# Insurance\n\n## Travel\n\nOld policy remains.\n\n${unrelated}`);
    const composer = vi.fn(async (value: ComposePageInput) => {
      expect(value.currentContent!.length).toBeLessThan(6500);
      expect(value.currentContent).not.toContain("Mortgage");
      const parsed = parseNote(value.currentContent!);
      return serializeNote({ ...parsed.frontmatter, summary: "Insurance policies and renewals." }, parsed.body + `\nNew renewal (${value.citation}).\n`);
    });
    for (let n = 0; n < 5; n++) current = await composeFocusedPage(llm(composer), input(current));
    const parsed = parseNote(current);
    expect(parsed.body).toContain(unrelated);
    expect(parsed.body).toContain("Old policy remains.");
    expect(parsed.frontmatter!.custom).toEqual({ retained: true });
    expect(String(parsed.frontmatter!.summary).length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
  });
  it("rejects destructive section edits, malformed output, unbounded summary and missing new evidence", async () => {
    const current = serializeNote(fm, "## Travel\n\nOriginal claim [[2026-06-10#^e-7f3a2c]].\n");
    for (const generated of ["broken", serializeNote(fm, `## Travel\nReplacement ${citation}`),
      serializeNote({ ...fm, summary: "x".repeat(481) }, `## Travel\nOriginal claim [[2026-06-10#^e-7f3a2c]].\n${citation}`), serializeNote(fm, "## Travel\nOriginal claim [[2026-06-10#^e-7f3a2c]].\n")]) {
      expect(parseNote(await composeFocusedPage(llm(async () => generated), input(current))).frontmatter).toBeNull();
    }
  });
  it("retains oversized old summary as history while keeping model input and output bounded", async () => {
    const summary = "Historical insurance fact. ".repeat(600);
    const current = serializeNote({ ...fm, summary, custom: "x".repeat(30000) }, "## Other\n\nKeep this.\n");
    const result = await composeFocusedPage(llm(async (value) => {
      expect(value.currentContent!.length).toBeLessThan(1200);
      return serializeNote(fm, `## Travel\n\nApril renewal ${citation}.\n`);
    }), input(current));
    expect(parseNote(result).body).toContain(summary);
    expect(parseNote(result).body).toContain("Keep this.");
    expect(String(parseNote(boundExistingSummary(current)).frontmatter!.summary).length).toBe(480);
  });
  it("records only exact evidence-backed aliases without changing raw source spelling", async () => {
    const value = input(null);
    value.evidenceEntry = "Insurance is also called Insurence. Keep that spelling.";
    value.classification.pages[0]!.aliases = [{ name: "Insurence", evidenceQuote: "Insurance is also called Insurence." }, { name: "Insuranz", evidenceQuote: "invented" }];
    const result = await composeFocusedPage(llm(async () => serializeNote(fm, `## Names\n\nInsurence ${citation}\n[[Notes/Axa]]`)), value);
    expect(parseNote(result).frontmatter!.aliasEvidence).toEqual([{ name: "Insurence", quote: "Insurance is also called Insurence.", citation }]);
    expect(value.evidenceEntry).toContain("Insurence");
    expect(parseNote(appendAliasEvidence(serializeNote(fm, "Original claim."), value.classification.pages[0]!, value.evidenceEntry, citation)).frontmatter!.aliasEvidence)
      .toEqual(parseNote(result).frontmatter!.aliasEvidence);
    const forged = await composeFocusedPage(llm(async () => serializeNote({ ...fm, aliasEvidence: [{ name: "Unproven" }] }, `Fact ${citation}`)), input(null));
    expect(parseNote(forged).frontmatter).not.toHaveProperty("aliasEvidence");
  });
  it("retrieves explicit hints and body matches from a large catalog with bounded metadata and a fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zmr6-candidates-")); dirs.push(dir);
    await cp(new URL("./fixtures/vault", import.meta.url), dir, { recursive: true });
    for (let n = 0; n < 60; n++) await writeFile(join(dir, `Notes/Page${n}.md`), serializeNote({ ...fm, title: `Page${n}`, type: "note", summary: "x".repeat(14000) }, n === 59 ? "secret orchard topic" : "filler"));
    for (const name of ["A-B", "AB"]) await writeFile(join(dir, `Notes/${name}.md`), serializeNote({ ...fm, title: name, type: "note" }, "content"));
    const snapshot = await scanVault(dir);
    expect(await relevantLinks(dir, snapshot, "Notes/New.md", "quasar-no-match")).toEqual(["[[Index]]"]);
    const candidates = await candidatePages(dir, snapshot, "secret orchard", ["Notes/Page58"]);
    expect(candidates.length).toBe(24);
    expect(candidates[0]!.path).toBe("Notes/Page58.md");
    expect(candidates.some((page) => page.path === "Notes/Page59.md")).toBe(true);
    expect(Math.max(...candidates.map((page) => page.summary.length))).toBeLessThanOrEqual(480);
    const classify = vi.fn(async () => ({ confidence: 0.95, summary: "new page", tags: [], pages: [{ path: "Notes/insurance.md", title: "Insurance", action: "create" as const }] }));
    const result = await classifyCandidates({ classify } as unknown as BrainLlm, dir, snapshot, { content: "secret orchard", hints: [], pageIndex: snapshot.pages, tagVocabulary: [] });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(result.pages[0]).toMatchObject({ path: "Areas/Insurance.md", action: "update" });
    const calls = vi.mocked(classify).mock.calls as unknown as Array<[import("../src/llm/types.js").ClassifyInput]>;
    expect(calls.every(([value]) => value.pageIndex.length <= 24)).toBe(true);
    const before = snapshot.pages.reduce((n, page) => n + page.summary.length, 0);
    const after = calls.reduce((n, [value]) => n + value.pageIndex.reduce((sum, page) => sum + page.summary.length, 0), 0);
    expect(after).toBeLessThan(before / 10);
    const exact = await classifyCandidates({ classify: async () => ({ confidence: 1, summary: "AB", tags: [], pages: [{ path: "Notes/AB.md", title: "AB", action: "update" }] }) },
      dir, snapshot, { content: "AB", hints: [], pageIndex: [], tagVocabulary: [] });
    expect(exact.pages[0]!.path).toBe("Notes/AB.md"); // character-derived token estimate; no real model cost measurement
  });
});
