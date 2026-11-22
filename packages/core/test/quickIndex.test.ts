import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { oneLine, quickIndexBase, quickIndexBaseCached, sayableAlias } from "../src/vault/quickIndex.js";

// EPIC-14 S28: the quick index's model-free part, built from the tree, page frontmatter and the Log.
const FILES: Record<string, string> = {
  "Tree.md": `---\ntitle: Tree\n---\n# Memory tree\n\n## Working memory\n\n- Moving to Valencia | working | [[Projects/Moving to Valencia]] | Looking for a one-year rental. ^n-1a2b3c4d\n\n## Long-term memory\n\n- Family | long-term | [[Areas/Family]] | The people closest to you.\n`,
  "Projects/Moving to Valencia.md": `---\ntitle: Moving to Valencia\nparent: "[[Tree]]"\nmemory: working\naliases:\n  - The move\n  - Moving to Valencia\n  - Voice note AC2334D9F38222011F8FFB0DB80CC414.ogg ingested thr\n---\nVisit [[2026-11-08#^e-aaaaaa]] and [[2026-10-01#^e-bbbbbb]].\n\n## Ops rollup\n\n- [[2026-11-08#^e-cccccc]]\n`,
  "Notes/Ruzafa flats.md": `---\ntitle: Ruzafa flats\nparent: "[[Moving to Valencia]]"\nsummary: Two flats seen in Ruzafa. The second one has a balcony, a long lease and a landlord who answers quickly, which is more than the first one could say about itself in any of the visits.\n---\nSeen [[2026-11-08#^e-aaaaaa]] [[2026-11-07#^e-dddddd]] [[2026-11-07#^e-eeeeee]].\n`,
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
    // A long summary becomes its first sentence.
    expect(ruzafa).toMatchObject({ root: false, lineage: ["Moving to Valencia", "Ruzafa flats"], summary: "Two flats seen in Ruzafa.", memories: 2, week: 2, pages: 1 });
    expect(family).toMatchObject({ memory: "long-term", summary: "The people closest to you.", memories: 0, week: 0, lastTouched: "2026-09-01", captures: [] });
  });

  it("cuts a summary with no early sentence at a word, and drops aliases that are file ids", () => {
    const long = "word ".repeat(60).trim();
    expect(oneLine(long).endsWith("…")).toBe(true);
    expect(oneLine(long).length).toBeLessThanOrEqual(161);
    expect(oneLine("Short and sweet")).toBe("Short and sweet");
    expect(sayableAlias("the flat")).toBe(true);
    expect(sayableAlias("Zenot")).toBe(true);
    expect(sayableAlias("Voice note 3B22F688808BB657ECE7C.ogg")).toBe(false);
    expect(sayableAlias("draft AC2334D9F38222011F8FFB")).toBe(false);
  });

  it("is null without a tree", async () => {
    const files = { ...FILES };
    delete files["Tree.md"];
    expect(await quickIndexBase(await vault(files))).toBeNull();
  });
});

// EPIC-24 M34: the 5-minute clock asked for the whole base each tick; an unchanged vault now answers from memory.
describe("quick index base, cached by vault state (EPIC-24 M34)", () => {
  async function settled(files: Record<string, string>): Promise<string> {
    const dir = await vault(files);
    const old = new Date(Date.now() - 60_000);
    const walk = async (rel: string): Promise<void> => {
      for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
        const path = join(rel, entry.name);
        if (entry.isDirectory()) await walk(path); else await utimes(join(dir, path), old, old);
      }
    };
    await walk(".");
    return dir;
  }
  const NOW = Date.parse("2026-11-09T12:00:00Z");

  it("returns the same base while no Markdown file changed, and what a fresh build returns", async () => {
    const dir = await settled(FILES);
    const first = await quickIndexBaseCached(dir, NOW);
    const second = await quickIndexBaseCached(dir, NOW + 5 * 60_000);
    expect(second).toBe(first);
    expect(first).toEqual(await quickIndexBase(dir, NOW));
  });

  it("rebuilds when a file is added or changed, and when the week window moves", async () => {
    const dir = await settled(FILES);
    const first = (await quickIndexBaseCached(dir, NOW))!;
    expect(first.places.find((p) => p.path === "Areas/Family.md")!.memories).toBe(0);
    // A new filing cites the page: the base must see it.
    const family = join(dir, "Areas/Family.md");
    await writeFile(family, `---\ntitle: Family\nparent: "[[Tree]]"\nmemory: long-term\nupdated: 2026-09-01\n---\nCited now [[2026-11-07#^e-dddddd]].\n`);
    const old = new Date(Date.now() - 60_000);
    await utimes(family, old, old);
    const second = (await quickIndexBaseCached(dir, NOW))!;
    expect(second).not.toBe(first);
    expect(second.places.find((p) => p.path === "Areas/Family.md")!.memories).toBe(1);
    // Same files, a later week: the this-week counts move, so it is built again.
    const third = (await quickIndexBaseCached(dir, NOW + 3 * 86_400_000))!;
    expect(third).not.toBe(second);
    expect(third.weekFrom).toBe("2026-11-06");
  });

  it("never trusts a file changed in the last 100 ms", async () => {
    const dir = await vault(FILES); // freshly written: racy
    const first = await quickIndexBaseCached(dir, NOW);
    const second = await quickIndexBaseCached(dir, NOW);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("is null without a tree and does not keep a failed answer", async () => {
    const dir = await settled({ "Notes/Loose.md": "no tree here\n" });
    expect(await quickIndexBaseCached(dir, NOW)).toBeNull();
    await writeFile(join(dir, "Tree.md"), FILES["Tree.md"]!);
    const old = new Date(Date.now() - 60_000);
    await utimes(join(dir, "Tree.md"), old, old);
    expect(await quickIndexBaseCached(dir, NOW)).not.toBeNull();
  });
});
