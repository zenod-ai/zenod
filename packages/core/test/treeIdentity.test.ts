import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heat, jaccard, matchRootIds, newRootId } from "../src/engine/treeIdentity.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { rediscoverTree } from "../src/engine/treeSweep.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { readTree, TREE_PATH } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * EPIC-9 E9-5b stable root identity, kept after E9-5i removed the steering (pins, renames,
 * aliases, Keeper notes; root L-7). A made-up vault: a garden the person talks about now, a
 * Lisbon trip from the summer, kitchen recipes nobody captures about. Plus parity with the
 * EpicSpine skill's shared tree library (E9-5f).
 */

const SEEDED: SeedNode[] = [
  { name: "Old trip", kind: "working", path: "Projects/Old trip.md", summary: "Planning a trip: flights and hotels." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: kitchen, insurance and documents." },
];
const CONFIG = "schema_version: 1\ntags:\n  - home\n  - travel\nconfidence_threshold: 0.7\n";
const INDEX = "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n";
const page = (title: string, parent: string, body: string, created = "2026-07-01") => [
  "---", `title: ${title}`, "type: note", "tags: []", `created: ${created}`, `updated: ${created}`,
  `summary: ${title}.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "", "See [[Index]].", "",
].join("\n");
const entry = (time: string, anchor: string, source: string, text: string) =>
  `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: ${source}\n- verbatim: no\n\n> ${text}\n`;
const LOGS: Record<string, string> = {
  "Log/2026-07-10.md": `# 2026-07-10\n\n${entry("09:00", "e-a00001", "whatsapp", "Lisbon flights booked, hotel near Alfama")}\n${entry("10:00", "e-a00002", "whatsapp", "Lisbon hotel confirmation and the tram pass")}`,
  "Log/2026-10-20.md": `# 2026-10-20\n\n${entry("09:00", "e-b00001", "whatsapp", "Tomato seedlings need deeper raised beds in the garden")}`,
  "Log/2026-10-28.md": `# 2026-10-28\n\n${entry("09:00", "e-b00002", "whatsapp", "Garden watering timer: drip line for the tomato beds")}`,
  "Log/2026-11-01.md": `# 2026-11-01\n\n${entry("09:00", "e-b00003", "whatsapp", "Compost for the garden soil before planting tomato")}`,
};
function fixtureFiles(): Array<{ path: string; content: string }> {
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    ...seedTreeFiles(SEEDED, "2026-07-01"),
    { path: "Notes/Raised beds.md", content: page("Raised beds", "Areas/Life admin", "Raised beds for tomato seedlings, garden soil depth and compost ([[2026-10-20#^e-b00001]]). Watering on a drip line.") },
    { path: "Notes/Watering timer.md", content: page("Watering timer", "Areas/Life admin", "Garden drip line and watering timer for the tomato beds ([[2026-10-28#^e-b00002]]); soil stays moist. See [[Raised beds]].") },
    { path: "Notes/Compost.md", content: page("Compost", "Areas/Life admin", "Compost for the garden soil before planting tomato seedlings in the raised beds ([[2026-11-01#^e-b00003]]).") },
    { path: "Notes/Lisbon flights.md", content: page("Lisbon flights", "Projects/Old trip", "Lisbon flights booked; hotel near Alfama ([[2026-07-10#^e-a00001]]). Tram pass for Lisbon.") },
    { path: "Notes/Lisbon hotel.md", content: page("Lisbon hotel", "Projects/Old trip", "Lisbon hotel in Alfama, tram pass and flights ([[2026-07-10#^e-a00002]]). See [[Lisbon flights]].") },
    { path: "Notes/Lisbon museums.md", content: page("Lisbon museums", "Projects/Old trip", "Lisbon museums near Alfama and the tram. See [[Lisbon hotel]].") },
    { path: "Notes/Soup recipes.md", content: page("Soup recipes", "Areas/Life admin", "Kitchen recipes: lentil soup, onion soup, stock for cooking.") },
    { path: "Notes/Bread recipes.md", content: page("Bread recipes", "Areas/Life admin", "Kitchen recipes: sourdough bread, cooking times, oven and flour. See [[Soup recipes]].") },
    { path: "Notes/Pasta recipes.md", content: page("Pasta recipes", "Areas/Life admin", "Kitchen recipes: fresh pasta, cooking water, flour and eggs. See [[Bread recipes]].") },
    ...Object.entries(LOGS).map(([path, content]) => ({ path, content })),
  ];
}
async function writeFixture(root: string, files = fixtureFiles()): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
}

const PARITY = JSON.parse(await readFile(fileURLToPath(new URL("./fixtures/tree-library-parity.json", import.meta.url)), "utf8")) as {
  constants: Record<string, number>;
  heat: Array<{ name: string; events: Array<string | [string, number]>; today: string; half_life?: number; expected: number }>;
  match_ids: Array<{ name: string; previous: Record<string, string[]>; current: string[][]; expected: string[] }>;
  /** The "Recent changes" rollup is E9-5c's (the keeper writes it); not ported here yet. */
  recent_changes: unknown[];
};

describe("E9-5b shared tree library parity (EpicSpine skill assets/tree-library-parity.json)", () => {
  it("uses the skill's constants", () => {
    expect(PARITY.constants).toMatchObject({ HALF_LIFE_DAYS: 14, HORIZON_DAYS: 120, MATCH_THRESHOLD: 0.5 });
  });

  for (const c of PARITY.heat) {
    it(`heat: ${c.name}`, () => {
      expect(heat(c.events.map(e => typeof e === "string" ? e : [e[0], e[1]] as const), c.today, c.half_life)).toBe(c.expected);
    });
  }

  for (const c of PARITY.match_ids) {
    it(`stable ids: ${c.name}`, () => {
      expect(matchRootIds(c.previous, c.current)).toEqual(c.expected);
    });
  }

  it("jaccard and new ids behave as the skill's", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "d"])).toBe(0.5);
    expect(jaccard([], [])).toBe(0);
    expect(newRootId(["b", "a"])).toBe(newRootId(["a", "b"]));
    expect(newRootId(["a", "x", "y"])).toBe("n-99c8ee65");
  });
});


describe("E9-5b stable identity in discovery", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e95b-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const rootsOf = async () => (await readTree(dir))!.nodes;
  const lintErrors = async () => (await lintTree(dir)).issues.filter(i => i.severity === "error");

  it("gives every root an id, keeps it across runs and while the root keeps half its pages", async () => {
    await writeFixture(dir);
    const first = (await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir)))!;
    const ids = new Map(first.roots.map(r => [r.path, r.id]));
    expect([...ids.values()].every(id => /^n-[0-9a-f]{8}$/.test(id))).toBe(true);
    expect((await rootsOf()).map(n => n.id)).toEqual(first.roots.map(r => r.id));
    expect(await lintErrors()).toEqual([]);
    // Heat is the shared library's: the garden's three own captures, decayed to today.
    const garden = first.roots.find(r => r.kind === "working")!;
    expect(garden.heat).toBe(heat(["2026-10-20", "2026-10-28", "2026-11-01"], "2026-11-02"));

    // A new page joins the garden: 3 of 4 pages shared, the id stays.
    await writeFixture(dir, [{ path: "Notes/Seed trays.md", content: page("Seed trays", "Notes/Compost", "Seed trays for tomato seedlings before the raised beds and garden compost.") }]);
    const again = (await rediscoverTree(dir, "2026-11-03", new TrackedWrites(dir)))!;
    expect(again.roots.map(r => [r.path, r.id])).toEqual(first.roots.map(r => [r.path, ids.get(r.path)]));
    expect(again.roots.find(r => r.kind === "working")!.members).toContain("Notes/Seed trays.md");
  });

  it("reads no steering: page flags and an old Keeper notes section change nothing and are not carried over (E9-5i)", async () => {
    await writeFixture(dir);
    const first = (await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir)))!;
    const root = first.roots.find(r => r.kind === "long-term")!;
    const raw = await readFile(join(dir, root.path), "utf8");
    await writeFile(join(dir, root.path), raw.replace(/^---\n/, "---\npinned: true\nname-locked: true\n"));
    await writeFile(join(dir, TREE_PATH), `${await readFile(join(dir, TREE_PATH), "utf8")}\n## Keeper notes\n\n- K-1 | ${root.name} | name: Mine | why | confirmed 2026-11-02\n`);
    const again = (await rediscoverTree(dir, "2026-11-03", new TrackedWrites(dir)))!;
    expect(again.roots.map(r => [r.path, r.name, r.id])).toEqual(first.roots.map(r => [r.path, r.name, r.id]));
    const tree = await readFile(join(dir, TREE_PATH), "utf8");
    expect(tree).not.toContain("Keeper notes");
    expect(tree).not.toContain("K-1");
    for (const r of again.roots) {
      const fm = parseNote(await readFile(join(dir, r.path), "utf8")).frontmatter ?? {};
      if (r.path !== root.path) expect(fm).not.toHaveProperty("pinned");
      expect(fm).not.toHaveProperty("aliases");
    }
    expect(await lintErrors()).toEqual([]);
  });

  it("lint reports a repeated root id", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    const raw = await readFile(join(dir, TREE_PATH), "utf8");
    const id = (await rootsOf())[0]!.id!;
    await writeFile(join(dir, TREE_PATH), raw.replace(/ \^n-[0-9a-f]{8}\n(?=- )/, ` ^${id}\n`));
    expect((await lintErrors()).map(e => e.rule)).toEqual(["tree/node-duplicate"]);
  });
});
