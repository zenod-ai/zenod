import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { quickIndexBase } from "../src/vault/quickIndex.js";

// EPIC-14 S28: the quick index's model-free part, built from the tree, page frontmatter and the Log.
const FILES: Record<string, string> = {
  "Tree.md": `---\ntitle: Tree\n---\n# Memory tree\n\n## Working memory\n\n- Moving to Valencia | working | [[Projects/Moving to Valencia]] | Looking for a one-year rental. ^n-1a2b3c4d\n\n## Long-term memory\n\n- Family | long-term | [[Areas/Family]] | The people closest to you.\n`,
  "Projects/Moving to Valencia.md": `---\ntitle: Moving to Valencia\nparent: "[[Tree]]"\nmemory: working\nsummary: ignored for a root, Tree.md wins\naliases:\n  - The move\n  - Moving to Valencia\n---\nVisit [[2026-11-08#^e-aaaaaa]] and [[2026-10-01#^e-bbbbbb]].\n\n## Ops rollup\n\n- [[2026-11-08#^e-cccccc]]\n`,
  "Notes/Ruzafa flats.md": `---\ntitle: Ruzafa flats\nparent: "[[Moving to Valencia]]"\nsummary: Two flats seen in Ruzafa.\n---\nSeen [[2026-11-08#^e-aaaaaa]] [[2026-11-07#^e-dddddd]] [[2026-11-07#^e-eeeeee]].\n`,
  "Areas/Family.md": `---\ntitle: Family\nparent: "[[Tree]]"\nmemory: long-term\nupdated: 2026-09-01\n---\nNo citations yet.\n`,
  "Notes/Loose.md": `---\ntitle: Loose\n---\nNot in the tree [[2026-11-08#^e-aaaaaa]].\n`,
  "Log/2026-11-08.md": `# 2026-11-08\n\n## 09:00 Flat visit ^e-aaaaaa\n- source: whatsapp\n\n> We saw the flat in Ruzafa again, the flat is perfect.\n\n## 10:00 Ops report ^e-cccccc\n- source: selftest\n\n> agent run done\n`,
  "Log/2026-11-07.md": `# 2026-11-07\n\n## 09:00 Second flat ^e-dddddd\n- source: web\n\n> Second flat, smaller.\n\n## 11:00 Bot ^e-eeeeee\n- source: selftest\n\n> selftest capture\n`,
  "Log/2026-10-01.md": `# 2026-10-01\n\n## 09:00 Idea ^e-bbbbbb\n- source: telegram\n\n> Maybe Valencia next year.\n`,
};

const dirs: string[] = [];
async function vault(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-quick-index-"));
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

describe("quick index base (E14-S28)", () => {
  it("lists every tree place with the tree's summary, its aliases, own captures, this week and last touched", async () => {
    const base = (await quickIndexBase(await vault(FILES), Date.parse("2026-11-09T12:00:00Z")))!;
    expect(base.weekFrom).toBe("2026-11-03");
    expect(base.places.map((place) => place.path)).toEqual(["Projects/Moving to Valencia.md", "Notes/Ruzafa flats.md", "Areas/Family.md"]);
    const [move, ruzafa, family] = base.places;
    expect(move).toMatchObject({
      title: "Moving to Valencia",
      memory: "working",
      root: true,
      lineage: ["Moving to Valencia"],
      summary: "Looking for a one-year rental.",
      aliases: ["The move"],
      pages: 2,
      // The ops rollup and agent captures never count.
      memories: 2,
      week: 1,
      lastTouched: "2026-11-08",
      captureKeys: ["2026-11-08#^e-aaaaaa", "2026-10-01#^e-bbbbbb"],
    });
    expect(move!.captures[0]).toEqual({ key: "2026-11-08#^e-aaaaaa", date: "2026-11-08", text: "Flat visit We saw the flat in Ruzafa again, the flat is perfect." });
    expect(ruzafa).toMatchObject({ root: false, lineage: ["Moving to Valencia", "Ruzafa flats"], summary: "Two flats seen in Ruzafa.", memories: 2, week: 2, pages: 1 });
    expect(family).toMatchObject({ memory: "long-term", summary: "The people closest to you.", memories: 0, week: 0, lastTouched: "2026-09-01", captures: [] });
  });

  it("is null without a tree", async () => {
    const files = { ...FILES };
    delete files["Tree.md"];
    expect(await quickIndexBase(await vault(files))).toBeNull();
  });
});
