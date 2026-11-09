import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placeCapture } from "../src/engine/treePlacement.js";
import { runTreeSweep } from "../src/engine/treeSweep.js";
import { loadMemoryTree } from "../src/vault/lineage.js";
import { lintTree } from "../src/vault/treeLint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * EPIC-9 E9-2f: a Log entry cited only by a level-1 root is also cited on the
 * deepest page below it that matches, so retrieval lineage reaches the leaf.
 * Fixture vault with made-up topics, no real captures.
 */
const NODES: SeedNode[] = [
  { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden: seeds, beds and watering." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: insurance, kitchen and travel documents." },
];

const page = (title: string, parent: string, body: string) => [
  "---", `title: ${title}`, "type: note", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "",
].join("\n");

const logEntry = (time: string, anchor: string, text: string) =>
  `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;

const LOGS: Record<string, string> = {
  "Log/2026-10-23.md": `# 2026-10-23\n\n${logEntry("09:00", "e-666666", "Raised beds need a drip line along each bed")}`,
  "Log/2026-10-24.md": `# 2026-10-24\n\n${logEntry("09:00", "e-777777", "Beds watering schedule for the dry weeks")}`,
  "Log/2026-10-25.md": `# 2026-10-25\n\n${logEntry("12:00", "e-555555", "Raised beds built")}`,
  "Log/2026-10-26.md": `# 2026-10-26\n\n${logEntry("08:00", "e-999999", "zenod-bot EPIC-9 watcher report: raised beds deployed, ci green")}\n${logEntry("08:30", "e-888888", "zenod-bot EPIC-9 console decision")}`,
  "Log/2026-10-27.md": `# 2026-10-27\n\n${logEntry("10:00", "e-aaaaaa", "Raised beds: add mulch to the raised bed corners")}`,
};

// The E9-2c clean-up wrote re-filed captures as dated lines on the root page.
const GARDEN_LINES = [
  "",
  "## Captures re-filed here by the clean-up (E9-2c, 2026-11-01)",
  "",
  "- 2026-10-23 · Raised beds need a drip line along each bed [[2026-10-23#^e-666666]]",
  "- 2026-10-24 · Beds watering schedule for the dry weeks [[2026-10-24#^e-777777]]",
  "- 2026-10-25 · Raised beds built [[2026-10-25#^e-555555]]",
  "- 2026-10-26 · zenod-bot EPIC-9 watcher report: raised beds deployed [[2026-10-26#^e-999999]]",
  "",
  "## Ops rollup",
  "",
  "- 2026-10-26 ops (1): [[2026-10-26#^e-888888]]",
  "",
].join("\n");

async function writeFixture(root: string): Promise<void> {
  const files = [
    { path: ".brain/config.yml", content: "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n" },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n" },
    ...seedTreeFiles(NODES, "2026-08-01"),
    { path: "Notes/Raised beds.md", content: page("Raised beds", "Projects/Garden", "- Built the beds ([[2026-10-25#^e-555555]]).") },
    { path: "Notes/Insurance.md", content: page("Insurance", "Areas/Life admin", "- Car and home policies.") },
    ...Object.entries(LOGS).map(([path, content]) => ({ path, content })),
    { path: "_attachments/voice-1.txt", content: "raw bytes stand-in" },
  ];
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  const garden = await readFile(join(root, "Projects/Garden.md"), "utf8");
  await writeFile(join(root, "Projects/Garden.md"), `${garden.trimEnd()}\n${GARDEN_LINES}`);
}

async function readAll(root: string, paths: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(join(root, path), "utf8")] as const)));
}

describe("E9-2f deepen root-only citations", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e92f-")); await writeFixture(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("the sweep cites a root-only capture on its matching leaf, keeps the root's line, and leaves the rest alone", async () => {
    const evidence = [...Object.keys(LOGS), "_attachments/voice-1.txt"];
    const before = await readAll(dir, evidence);
    const treeBefore = await loadMemoryTree(dir);
    expect(await treeBefore.placedCitersOf("Log/2026-10-23.md#^e-666666")).toEqual(["Projects/Garden.md"]);

    const report = await runTreeSweep(dir, { today: "2026-11-02", discover: false });

    // Root-only: e-666666, e-777777 and e-999999 (e-555555 is already on a leaf; the ops rollup is not counted).
    expect(report.counts).toMatchObject({ rootOnlyCitations: 3, citationsDeepened: 1, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0 });
    expect(report.deepened).toEqual([{ evidenceRef: "Log/2026-10-23.md#^e-666666", root: "Projects/Garden.md", leaf: "Notes/Raised beds.md" }]);

    const leaf = await readFile(join(dir, "Notes/Raised beds.md"), "utf8");
    expect(leaf).toContain("## Captures\n");
    expect(leaf).toContain("- 2026-10-23 · Raised beds need a drip line along each bed [[2026-10-23#^e-666666]]");
    // Never removed from the root.
    const garden = await readFile(join(dir, "Projects/Garden.md"), "utf8");
    expect(garden).toContain("[[2026-10-23#^e-666666]]");
    // A match only on a word the root already names ("beds"), and an agent ops report, stay on the root only.
    expect(leaf).not.toContain("e-777777");
    expect(leaf).not.toContain("e-999999");
    expect(leaf).not.toContain("e-888888");

    // Retrieval lineage now reaches the leaf.
    const tree = await loadMemoryTree(dir);
    expect(await tree.placedCitersOf("Log/2026-10-23.md#^e-666666")).toEqual(["Notes/Raised beds.md", "Projects/Garden.md"]);
    const [lineage] = await tree.answerLineage(["Log/2026-10-23.md#^e-666666"]);
    expect(lineage!.text).toBe("Working memory › Garden › Raised beds ← Log/2026-10-23.md#^e-666666");

    // Log/ and _attachments/ byte for byte; only the leaf changed.
    expect(await readAll(dir, evidence)).toEqual(before);
    expect(report.changedPaths).toEqual(["Notes/Raised beds.md"]);
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);

    // Idempotent: a second sweep has nothing more to deepen.
    const again = await runTreeSweep(dir, { today: "2026-11-02", discover: false });
    expect(again.counts).toMatchObject({ rootOnlyCitations: 2, citationsDeepened: 0 });
    expect(again.changedPaths).toEqual([]);
  });

  it("the librarian cites the leaf too when a new capture reached only a root", async () => {
    const result = await placeCapture(dir,
      { content: "Raised beds: add mulch to the raised bed corners", evidenceRef: "Log/2026-10-27.md#^e-aaaaaa", today: "2026-10-27" },
      { pages: ["Projects/Garden.md"], leafAllowed: false });
    expect(result.placed.map(p => p.path)).toEqual(["Projects/Garden.md", "Notes/Raised beds.md"]);
    expect(result.pagesTouched).toContain("Notes/Raised beds.md");
    expect(result.filedLines).toEqual([
      "- filed: [[Projects/Garden]] (Working › Garden) · 75% sure",
      "- filed: [[Notes/Raised beds]] (Working › Garden › Raised beds) · 64% sure",
    ]);
    expect(await readFile(join(dir, "Notes/Raised beds.md"), "utf8")).toContain("[[2026-10-27#^e-aaaaaa]]");
    expect(result.treeIssues).toEqual([]);
  });

  it("the librarian leaves ops rollups and leaf filings as they are", async () => {
    const rollup = await placeCapture(dir,
      { content: "Raised beds: add mulch to the raised bed corners", evidenceRef: "Log/2026-10-27.md#^e-aaaaaa", today: "2026-10-27" },
      { pages: ["Projects/Garden.md"], leafAllowed: false, rollup: true });
    expect(rollup.placed.map(p => p.path)).toEqual(["Projects/Garden.md"]);
    expect(await readFile(join(dir, "Notes/Raised beds.md"), "utf8")).not.toContain("e-aaaaaa");

    const onLeaf = await placeCapture(dir,
      { content: "Insurance renewal for the car", evidenceRef: "Log/2026-10-24.md#^e-777777", today: "2026-10-24" },
      { pages: ["Notes/Insurance.md"], leafAllowed: false });
    expect(onLeaf.placed.map(p => p.path)).toEqual(["Notes/Insurance.md"]);
  });
});
