import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverTree } from "../src/engine/treeDiscover.js";
import { leafCaptures, mergeSmallLeaves, withAlias } from "../src/engine/treeMergeLeaves.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { runTreeSweep } from "../src/engine/treeSweep.js";
import { scanVault } from "../src/vault/pages.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * E12-S24: the weekly sweep merges a small provisional leaf into the page it is about, keeping
 * every capture word for word, and leaves a pointer page; provisional leaves never become roots.
 * Fixture vault with made-up garden topics, no real captures.
 */
const NODES: SeedNode[] = [
  { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden: seeds, beds and watering." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: insurance, kitchen and travel documents." },
];

const CONFIG = "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n";
const INDEX = "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n";

const page = (title: string, parent: string, body: string) => [
  "---", `title: ${title}`, "type: note", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "", "See [[Index]].", "",
].join("\n");

/** A rescue leaf exactly as writeProvisionalLeaf writes it. */
const leaf = (title: string, parent: string, captures: Array<[string, string, string]>, created = "2026-10-30", extra = "") => [
  "---", `title: ${JSON.stringify(title)}`, "type: note", "tags: []", `created: ${created}`, `updated: ${created}`,
  `summary: ${JSON.stringify(`Provisional: ${captures[0]![2].slice(0, 80)}`)}`, `parent: "[[${parent}]]"`, "provisional: true", "---", "",
  `# ${title}`, "", `A provisional leaf under [[${parent}|${parent.split("/").pop()}]]: nothing in the tree fitted this capture well, so the weekly sweep reviews where it belongs.`, "",
  ...captures.flatMap(([date, anchor, text]) => [`## Capture ${date} [[${date}#^${anchor}]]`, "", `> ${text}`, "", "Filing note: low confidence", ""]),
  ...(extra ? [extra, ""] : []),
].join("\n");

const logEntry = (anchor: string, text: string) => `## 09:00 ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;

const TEXT = {
  bedsWater: "The tomato beds need watering every morning while the tomato plants are young, drip line on the beds.",
  compostA: "The compost heap smells bad again, the compost needs more dry leaves and turning.",
  compostB: "Turn the compost heap every week so the compost does not smell, add dry leaves.",
  big: Array.from({ length: 40 }, (_, i) => `fence post ${i} needs paint`).join(", "),
  edited: "Greenhouse heater thermostat setting for the greenhouse at night.",
  fresh: "Greenhouse heater thermostat schedule for the greenhouse in winter.",
  bitcoin: "Bitcoin options on Deribit priced against the volatility smile, bitcoin options expiry.",
};

function fixtureFiles(): Array<{ path: string; content: string }> {
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    ...seedTreeFiles(NODES, "2026-08-01"),
    { path: "Notes/Tomato beds.md", content: page("Tomato beds", "Projects/Garden", "- Built the tomato beds with a drip line for watering.") },
    { path: "Notes/Greenhouse.md", content: page("Greenhouse", "Projects/Garden", "- The greenhouse frame went up in August.") },
    { path: "Notes/Tomato beds watering.md", content: leaf("Tomato beds watering", "Projects/Garden", [["2026-10-20", "e-111111", TEXT.bedsWater]]) },
    { path: "Notes/Compost heap smell.md", content: leaf("Compost heap smell", "Projects/Garden", [["2026-10-21", "e-222222", TEXT.compostA]]) },
    { path: "Notes/Compost heap turning schedule.md", content: leaf("Compost heap turning schedule", "Projects/Garden", [["2026-10-22", "e-333333", `${TEXT.compostB} ${TEXT.compostB}`]]) },
    { path: "Notes/Fence painting.md", content: leaf("Fence painting", "Projects/Garden", [["2026-10-23", "e-444444", TEXT.big]]) },
    { path: "Notes/Greenhouse heater thermostat.md", content: leaf("Greenhouse heater thermostat", "Notes/Greenhouse", [["2026-10-24", "e-555555", TEXT.edited]], "2026-10-30", "My own note: check the fuse.") },
    { path: "Notes/Greenhouse heater thermostat winter.md", content: leaf("Greenhouse heater thermostat winter", "Notes/Greenhouse", [["2026-10-25", "e-666666", TEXT.fresh]], "2026-11-08") },
    ...["e-777771", "e-777772", "e-777773"].map((anchor, i) => ({ path: `Notes/Bitcoin options ${i + 1}.md`, content: leaf(`Bitcoin options ${["expiry", "smile", "deribit"][i]}`, "Areas/Life admin", [["2026-10-26", anchor, TEXT.bitcoin]], "2026-11-08") })),
    { path: "Log/2026-10-20.md", content: `# 2026-10-20\n\n${logEntry("e-111111", TEXT.bedsWater)}` },
    { path: "Log/2026-10-21.md", content: `# 2026-10-21\n\n${logEntry("e-222222", TEXT.compostA)}` },
    { path: "Log/2026-10-22.md", content: `# 2026-10-22\n\n${logEntry("e-333333", TEXT.compostB)}` },
    { path: "Log/2026-10-23.md", content: `# 2026-10-23\n\n${logEntry("e-444444", TEXT.big)}` },
    { path: "Log/2026-10-24.md", content: `# 2026-10-24\n\n${logEntry("e-555555", TEXT.edited)}` },
    { path: "Log/2026-10-25.md", content: `# 2026-10-25\n\n${logEntry("e-666666", TEXT.fresh)}` },
    { path: "Log/2026-10-26.md", content: `# 2026-10-26\n\n${["e-777771", "e-777772", "e-777773"].map(a => logEntry(a, TEXT.bitcoin)).join("\n")}` },
  ];
}

async function writeFixture(root: string): Promise<void> {
  for (const file of fixtureFiles()) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
}

const read = (root: string, path: string) => readFile(join(root, path), "utf8");
const captureBlocks = (raw: string) => leafCaptures(raw.split(/^---$/m).slice(2).join("---"))!.blocks;

describe("E12-S24 small provisional leaves merge into their page", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e12s24-")); await writeFixture(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("merges word for word, keeps a pointer page and an alias, leaves the rest alone", async () => {
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);
    const before = Object.fromEntries(await Promise.all(fixtureFiles().map(async f => [f.path, f.content] as const)));
    const writes = new TrackedWrites(dir);
    const merged = await mergeSmallLeaves(dir, writes, { today: "2026-11-09" });

    expect(merged.map(m => [m.path, m.into, m.relation])).toEqual([
      // A confirmed sibling whose name covers the leaf's title.
      ["Notes/Tomato beds watering.md", "Notes/Tomato beds.md", "sibling"],
      // Two alike sibling leaves become one, kept on the fuller one.
      ["Notes/Compost heap smell.md", "Notes/Compost heap turning schedule.md", "sibling"],
    ]);

    for (const { path, into } of merged) {
      // Every capture block of the leaf sits in the page byte for byte, citation included.
      const page = await read(dir, into);
      for (const block of captureBlocks(before[path]!)) expect(page).toContain(block);
      expect(page).toContain(`Merged from [[${path.replace(/\.md$/, "")}|`);
      // The page's own text is all still there.
      expect(page.startsWith(before[into]!.split("\n---\n")[0]!.split("\n").slice(0, 3).join("\n"))).toBe(true);
      for (const line of before[into]!.split("\n---\n").slice(1).join("\n---\n").split("\n")) expect(page).toContain(line);
      // The leaf stays at its path as a pointer: same parent and title, not provisional, links to the page.
      const pointer = await read(dir, path);
      expect(pointer).toContain(`merged-into: "[[${into.replace(/\.md$/, "")}]]"`);
      expect(pointer).toMatch(/^parent: "\[\[Projects\/Garden\]\]"$/m);
      expect(pointer).not.toMatch(/^provisional:/m);
      expect(pointer).toContain(`Merged into [[${into.replace(/\.md$/, "")}|`);
    }
    expect(await read(dir, "Notes/Tomato beds.md")).toContain('aliases:\n  - "Tomato beds watering"');

    // Too big, hand-edited and too fresh leaves are untouched; Log/ is never written.
    for (const path of ["Notes/Fence painting.md", "Notes/Greenhouse heater thermostat.md", "Notes/Greenhouse heater thermostat winter.md", "Notes/Greenhouse.md"]) {
      expect(await read(dir, path)).toBe(before[path]);
    }
    expect(writes.paths.some(p => p.startsWith("Log/"))).toBe(false);
    expect(writes.paths.sort()).toEqual(["Notes/Compost heap smell.md", "Notes/Compost heap turning schedule.md", "Notes/Tomato beds watering.md", "Notes/Tomato beds.md"]);

    // Tree stays valid; pointer pages are not tree pages new captures can be filed on, nor catalog pages.
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);
    const index = await buildTreeIndex(dir);
    expect(index.fields.get("Notes/Tomato beds watering.md")?.merged).toBe(true);
    expect((await scanVault(dir)).pages.map(p => p.path)).not.toContain("Notes/Tomato beds watering.md");

    // A second run finds nothing more to merge (pointers are skipped).
    expect(await mergeSmallLeaves(dir, new TrackedWrites(dir), { today: "2026-11-09" })).toEqual([]);
  });

  it("the weekly sweep runs it and reports the count; a revert restores every byte", async () => {
    const report = await runTreeSweep(dir, { today: "2026-11-09", discover: false });
    expect(report.counts.leavesMerged).toBe(2);
    expect(report.merged.map(m => m.path)).toEqual(["Notes/Tomato beds watering.md", "Notes/Compost heap smell.md"]);

    await rm(dir, { recursive: true, force: true });
    await writeFixture(dir);
    const writes = new TrackedWrites(dir);
    await mergeSmallLeaves(dir, writes, { today: "2026-11-09" });
    await writes.revert();
    for (const file of fixtureFiles()) expect(await read(dir, file.path)).toBe(file.content);
  });

  it("root discovery never turns provisional leaves into roots or moves them (they stay on their branch)", async () => {
    const plan = await discoverTree(dir, { today: "2026-11-09" });
    expect(plan).not.toBeNull();
    const leaves = fixtureFiles().filter(f => f.content.includes("provisional: true")).map(f => f.path);
    for (const path of leaves) {
      expect(plan!.parents.has(path), path).toBe(false);
      expect(plan!.roots.map(r => r.path)).not.toContain(path);
    }
  });

  it("withAlias adds to an existing block list and leaves other lines as written", () => {
    const raw = "---\ntitle: X\naliases:\n  - Old name\nparent: \"[[Tree]]\"\n---\n\n# X\n";
    expect(withAlias(raw, "New name")).toBe("---\ntitle: X\naliases:\n  - Old name\n  - \"New name\"\nparent: \"[[Tree]]\"\n---\n\n# X\n");
    expect(withAlias(withAlias(raw, "New name"), "new name")).toBe(withAlias(raw, "New name"));
    expect(withAlias("---\ntitle: X\naliases: [A, B]\n---\nbody", "C")).toBe("---\ntitle: X\naliases:\n  - \"A\"\n  - \"B\"\n  - \"C\"\n---\nbody");
  });
});
