import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memoryTreeOutline, pageCaptureDate } from "../src/vault/treeOutline.js";

// EPIC-9 E9-2e: the console Memory tab outline, built live from Tree.md + page `parent:`.
const FILES: Record<string, string> = {
  "Tree.md": `---\ntitle: Tree\n---\n# Memory tree\n\n## Working memory\n\n- Boat repair | working | [[Projects/Boat repair]] | Deciding on a boat repair.\n- Cabin decision | working | [[Projects/Cabin decision]] | Where to buy a house.\n\n## Long-term memory\n\n- Ventures and work | long-term | [[Areas/Ventures and work]] | The businesses over time.\n`,
  "Projects/Boat repair.md": `---\ntitle: Boat repair\nparent: "[[Tree]]"\nmemory: working\nupdated: 2026-10-01\n---\nOptions dossier with a private body line.\n`,
  "Projects/Cabin decision.md": `---\ntitle: Cabin decision\nparent: "[[Tree]]"\nmemory: working\n---\nShortlist.\n`,
  "Areas/Ventures and work.md": `---\ntitle: Ventures and work\nparent: "[[Tree]]"\nmemory: long-term\n---\nCompanies.\n`,
  "Notes/Porto quotes 2023.md": `---\ntitle: Porto quotes 2023\nparent: "[[Boat repair]]"\n---\nQuote [[2026-10-31#^e-c64e3b]].\n`,
  "Notes/Vigo yards.md": `---\ntitle: Vigo yards\nparent: "[[Boat repair]]"\nprovisional: true\n---\nClinics [[2026-10-30#^e-aaaaaa]] [[2026-11-01#^e-bbbbbb]].\n`,
  "Notes/Oakmere.md": `---\ntitle: Oakmere\nparent: "[[Projects/Cabin decision]]"\ncreated: 2026-09-15\n---\nCoastal option.\n`,
  "Notes/Kestrel tax.md": `---\ntitle: Kestrel tax\nparent: "[[Ventures and work]]"\n---\nAEAT.\n`,
  "Notes/AEAT filing.md": `---\ntitle: AEAT filing\nparent: "[[Kestrel tax]]"\n---\nQ3 filing [[2026-10-20#^e-cccccc]].\n`,
  "Notes/Legacy page.md": `---\ntitle: Legacy page\n---\nFrom before the tree [[2026-11-02#^e-dddddd]].\n`,
  "Log/2026-10-31.md": `# 2026-10-31\n\n## 10:00 Porto quote ^e-c64e3b\n`,
};

const dirs: string[] = [];
async function vault(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-tree-outline-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("memory tree outline (E9-2e)", () => {
  it("returns both groups, roots with page counts and the newest capture, deeper levels nested", async () => {
    const outline = (await memoryTreeOutline(await vault(FILES), { urlFor: (path) => `https://github.com/acme/vault/blob/main/${path}` }))!;
    expect(outline).toMatchObject({ roots: 3, placed: 8, unplaced: 1 });
    expect(outline.unplacedPages).toBeUndefined();
    // EPIC-14 S27: the loose page by title, only when asked (the Health helper).
    expect((await memoryTreeOutline(await vault(FILES), { listUnplaced: true }))!.unplacedPages).toEqual([{ title: "Legacy page", path: "Notes/Legacy page.md" }]);
    const [working, longTerm] = outline.groups;
    expect(working).toMatchObject({ id: "working", kind: "group", title: "Working memory", pages: 5, path: null, url: null });
    expect(working!.latest).toEqual({ date: "2026-11-01", title: "Vigo yards", path: "Notes/Vigo yards.md" });
    expect(longTerm).toMatchObject({ title: "Long-term memory", pages: 3, latest: { date: "2026-10-20", title: "AEAT filing" } });

    const [boat, cabin] = working!.children;
    expect(boat).toMatchObject({
      kind: "root",
      title: "Boat repair",
      summary: "Deciding on a boat repair.",
      path: "Projects/Boat repair.md",
      pages: 3,
      url: "https://github.com/acme/vault/blob/main/Projects/Boat repair.md",
    });
    // Newest capture first inside a node.
    expect(boat!.children.map((child) => [child.title, child.latest?.date, child.provisional ?? false])).toEqual([
      ["Vigo yards", "2026-11-01", true],
      ["Porto quotes 2023", "2026-10-31", false],
    ]);
    expect(cabin).toMatchObject({ pages: 2, latest: { date: "2026-09-15", title: "Oakmere" } });
    const tax = longTerm!.children[0]!.children[0]!;
    expect(tax).toMatchObject({ title: "Kestrel tax", pages: 2, children: [{ title: "AEAT filing", pages: 1, children: [] }] });
  });

  it("never carries a page body", async () => {
    const outline = await memoryTreeOutline(await vault(FILES));
    const text = JSON.stringify(outline);
    expect(text).not.toContain("private body line");
    expect(text).not.toContain("Coastal option");
    expect(text).not.toContain("Legacy page");
  });

  it("is null for a vault without Tree.md, and tolerates a root whose page is missing", async () => {
    expect(await memoryTreeOutline(await vault({ "Notes/A.md": "---\ntitle: A\n---\nx\n" }))).toBeNull();
    const outline = (await memoryTreeOutline(await vault({ "Tree.md": "## Working memory\n\n- Ghost | working | [[Projects/Ghost]] | Not written yet.\n\n## Long-term memory\n" })))!;
    expect(outline.groups.map((group) => group.pages)).toEqual([0, 0]);
    expect(outline.groups[0]!.children[0]).toMatchObject({ title: "Ghost", pages: 0, latest: null, url: null, children: [] });
    expect(outline.groups[1]!.children).toEqual([]);
  });

  it("dates a page by its newest Log citation, else its frontmatter", () => {
    expect(pageCaptureDate("x [[2026-01-02#^e-aaaaaa]] y [[2026-03-04#^e-bbbbbb|quote]]")).toBe("2026-03-04");
    expect(pageCaptureDate("---\nupdated: 2026-05-06\ncreated: 2026-01-01\n---\nbody")).toBe("2026-05-06");
    expect(pageCaptureDate("---\ncreated: \"2026-01-01\"\n---\nbody")).toBe("2026-01-01");
    expect(pageCaptureDate("no dates")).toBeNull();
  });
});
