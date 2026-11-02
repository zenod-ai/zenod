import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTreeDiscovery, captureWords, cleanTopicName, discoverTree, DISCOVERY_GENERATOR, withTreeFields } from "../src/engine/treeDiscover.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { rediscoverTree, runTreeSweep } from "../src/engine/treeSweep.js";
import { captureOrigin, parseLogCaptures } from "../src/vault/captureOrigin.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { parseTree, readTree } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { memoryTreeOutline } from "../src/vault/treeOutline.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * EPIC-9 E9-2g: roots discovered bottom-up from content and the person's own
 * recent captures. Fixture vault with made-up topics: a hand-seeded tree whose
 * roots no longer match what the person captures about (a garden they talk about
 * now, a Lisbon trip from the summer, recipes) and an agent-report page that is
 * busy today but was never the person's own activity (the "Zenod council" case).
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
  "Log/2026-11-02.md": [
    "# 2026-11-02", "",
    entry("01:00", "e-c00001", "mcp", "agent_team E46-S9 wake: council sub-agents drafted the daily voice posts"),
    entry("02:00", "e-c00002", "mcp", "agent_team EPIC-51 report: council scout and chronicler handoff merged"),
    entry("03:00", "e-c00003", "mcp", "agent_team E46-S9 wake: council chronicler posts ledger unchanged"),
  ].join("\n"),
};

function fixtureFiles(): Array<{ path: string; content: string }> {
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    ...seedTreeFiles(SEEDED, "2026-07-01"),
    // Garden: what the person talks about now; seeded under the wrong root.
    { path: "Notes/Raised beds.md", content: page("Raised beds", "Areas/Life admin", "Raised beds for tomato seedlings, garden soil depth and compost ([[2026-10-20#^e-b00001]]). Watering on a drip line.") },
    { path: "Notes/Watering timer.md", content: page("Watering timer", "Areas/Life admin", "Garden drip line and watering timer for the tomato beds ([[2026-10-28#^e-b00002]]); soil stays moist. See [[Raised beds]].") },
    { path: "Notes/Compost.md", content: page("Compost", "Areas/Life admin", "Compost for the garden soil before planting tomato seedlings in the raised beds ([[2026-11-01#^e-b00003]]).") },
    // Lisbon trip: captured in July, cold now.
    { path: "Notes/Lisbon flights.md", content: page("Lisbon flights", "Projects/Old trip", "Lisbon flights booked; hotel near Alfama ([[2026-07-10#^e-a00001]]). Tram pass for Lisbon.") },
    { path: "Notes/Lisbon hotel.md", content: page("Lisbon hotel", "Projects/Old trip", "Lisbon hotel in Alfama, tram pass and flights ([[2026-07-10#^e-a00002]]). See [[Lisbon flights]].") },
    // Kitchen: no capture at all.
    { path: "Notes/Soup recipes.md", content: page("Soup recipes", "Areas/Life admin", "Kitchen recipes: lentil soup, onion soup, stock for cooking.") },
    { path: "Notes/Bread recipes.md", content: page("Bread recipes", "Areas/Life admin", "Kitchen recipes: sourdough bread, cooking times, oven and flour. See [[Soup recipes]].") },
    { path: "Notes/Pasta recipes.md", content: page("Pasta recipes", "Areas/Life admin", "Kitchen recipes: fresh pasta, cooking water, flour and eggs. See [[Bread recipes]].") },
    // Agent council: busy today, but only agent reports cite it.
    { path: "Notes/Council design.md", content: page("Council design", "Projects/Old trip", "Council of sub-agents: scout and chronicler draft daily voice posts ([[2026-11-02#^e-c00001]], [[2026-11-02#^e-c00002]]).") },
    { path: "Notes/Council ledger.md", content: page("Council ledger", "Notes/Council design", "Council chronicler posts ledger and scout handoff ([[2026-11-02#^e-c00003]]). See [[Council design]].", "2026-11-02") },
    ...Object.entries(LOGS).map(([path, content]) => ({ path, content })),
    { path: "_attachments/voice-1.txt", content: "raw bytes stand-in" },
  ];
}

async function writeFixture(root: string, files = fixtureFiles()): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
}

describe("E9-2g capture origin", () => {
  it("counts the person's own channels and plain MCP notes as theirs, agent reports as agents'", () => {
    expect(captureOrigin("whatsapp", "agent_team E46-S9 wake")).toBe("user");
    expect(captureOrigin("mcp", "Remember that I take my coffee as a flat white")).toBe("user");
    expect(captureOrigin("mcp", "agent_team EPIC-46 (Moss Lantern), 2026-11-02 DM wake: all live")).toBe("agent");
    expect(captureOrigin("mcp", "Decision (E51-A1): the paper style")).toBe("agent");
    expect(captureOrigin("mcp", "fixed in PR #1467, live 61f6f52")).toBe("agent");
    expect(captureOrigin("selftest", "hello")).toBe("agent");
    expect(captureOrigin(null, "an old note")).toBe("user");
  });

  it("parses Log entries with their source and drops ingest headers from the words", () => {
    const [voice] = parseLogCaptures("2026-11-01", [
      "# 2026-11-01", "",
      '## 15:08 Voice note "abc.ogg" ingested through Ze...  ^e-a63578',
      "- source: whatsapp", "- verbatim: yes", "",
      '> Voice note "abc.ogg" ingested through Zenod.', "> Raw artifact: drive://file/x", "> Transcribed by some model", ">",
      "> Another post idea about the garden.",
    ].join("\n"));
    expect(voice).toMatchObject({ key: "2026-11-01#^e-a63578", source: "whatsapp", origin: "user" });
    expect(captureWords(voice!).trim()).toBe("Another post idea about the garden.");
  });
});

describe("E9-2g root discovery", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e92g-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("finds the roots from content and the person's own captures, not from the seed or agent reports", async () => {
    await writeFixture(dir);
    const plan = (await discoverTree(dir, { today: "2026-11-02" }))!;
    expect(plan.fresh).toBe(true);
    const working = plan.roots.filter(r => r.kind === "working");
    const longTerm = plan.roots.filter(r => r.kind === "long-term");
    // The garden is what the person captures about now: it is the one working root, named after its own page.
    expect(working.map(r => r.name)).toHaveLength(1);
    expect(["Raised beds", "Watering timer", "Compost"]).toContain(working[0]!.name);
    expect(working[0]).toMatchObject({ pages: 3, ownCaptures: 3, lastOwnCapture: "2026-11-01", continues: null });
    // The seeded working root is gone from working memory; the council (agent reports only) is not working either.
    expect(plan.roots.some(r => r.kind === "working" && /trip|council/i.test(r.name))).toBe(false);
    expect(longTerm.length).toBeGreaterThan(0);
    // Every tree page is placed exactly once, under a root of its own topic.
    expect(plan.parents.size).toBe(12);
    const garden = new Set(["Notes/Raised beds.md", "Notes/Watering timer.md", "Notes/Compost.md"]);
    for (const path of garden) expect(plan.memory.get(path)).toBe("working");
    expect(plan.memory.get("Notes/Council design.md")).toBe("long-term");
    expect(plan.memory.get("Notes/Lisbon hotel.md")).toBe("long-term");
    // Tree.md is generated output.
    expect(plan.treeFile).toContain(`generated: ${DISCOVERY_GENERATOR}`);
    expect(parseTree(plan.treeFile).problems).toEqual([]);
  });

  it("applies as frontmatter edits only: lint clean, Log and attachments untouched, nothing deleted, then stable", async () => {
    await writeFixture(dir);
    const filesBefore = await listMarkdownFiles(dir);
    const logBefore = await Promise.all(Object.keys(LOGS).map(p => readFile(join(dir, p), "utf8")));
    const writes = new TrackedWrites(dir);
    const result = (await rediscoverTree(dir, "2026-11-02", writes))!;
    expect(result.changed.every(p => p === "Tree.md" || p.startsWith("Notes/") || p.startsWith("Projects/") || p.startsWith("Areas/"))).toBe(true);
    expect(await listMarkdownFiles(dir)).toEqual(filesBefore);
    expect(await Promise.all(Object.keys(LOGS).map(p => readFile(join(dir, p), "utf8")))).toEqual(logBefore);
    expect(await readFile(join(dir, "_attachments/voice-1.txt"), "utf8")).toBe("raw bytes stand-in");
    const lint = await lintTree(dir);
    expect(lint.issues.filter(i => i.severity === "error")).toEqual([]);
    expect(lint.stats.rooted).toBe(lint.stats.treePages);

    // The next run continues the same roots and writes nothing.
    const again = (await discoverTree(dir, { today: "2026-11-02" }))!;
    expect(again.fresh).toBe(false);
    expect(again.roots.map(r => [r.name, r.kind])).toEqual(result.roots.map(r => [r.name, r.kind]));
    expect(again.roots.every(r => r.continues === r.name)).toBe(true);
    expect(await applyTreeDiscovery(dir, again, new TrackedWrites(dir))).toEqual([]);

    // Revert restores the vault byte for byte.
    await writes.revert();
    expect(await readFile(join(dir, "Tree.md"), "utf8")).toBe(seedTreeFiles(SEEDED, "2026-07-01")[0]!.content);
  });

  it("keeps a working root while it cools a little (hysteresis), then lets it drop to long-term", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    const name = (await readTree(dir))!.nodes.find(n => n.kind === "working")!.name;
    // 3 weeks on, heat is below the promote bar but above the demote bar: still working.
    const cooling = (await discoverTree(dir, { today: "2026-11-23" }))!;
    expect(cooling.roots.find(r => r.name === name)).toMatchObject({ kind: "working" });
    expect(cooling.roots.find(r => r.name === name)!.heat).toBeLessThan(0.9);
    // Nobody would promote it from cold at that heat.
    const fromCold = (await discoverTree(dir, { today: "2026-11-23", fresh: true }))!;
    expect(fromCold.roots.filter(r => r.kind === "working")).toEqual([]);
    // Two months on it is long-term.
    const cold = (await discoverTree(dir, { today: "2027-01-05" }))!;
    expect(cold.roots.filter(r => r.kind === "working")).toEqual([]);
  });

  it("leaves a vault without Tree.md alone", async () => {
    await writeFixture(dir, fixtureFiles().filter(f => f.path !== "Tree.md"));
    expect(await discoverTree(dir, { today: "2026-11-02" })).toBeNull();
    const report = await runTreeSweep(dir, { today: "2026-11-02" });
    expect(report.hasTree).toBe(false);
    expect(report.changedPaths).toEqual([]);
  });

  it("the weekly sweep re-roots and reports counts", async () => {
    await writeFixture(dir);
    const report = await runTreeSweep(dir, { today: "2026-11-02" });
    expect(report.counts).toMatchObject({ discoveredWorking: 1, treeLintErrorsAfter: 0 });
    expect(report.counts.rootsNew).toBe(report.roots.length);
    expect(report.changedPaths).toContain("Tree.md");
  });

  it("the Memory tab never shows agent reports as fresh", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    const outline = (await memoryTreeOutline(dir))!;
    const nodes = outline.groups.flatMap(function walk(n): typeof outline.groups { return [n, ...n.children.flatMap(walk)]; });
    const council = nodes.find(n => n.title === "Council design")!;
    expect(council.latest).toBeNull();
    expect(outline.groups[0]!.latest).toMatchObject({ date: "2026-11-01" });
  });
});

describe("E9-2g helpers", () => {
  it("names a topic after its page title without dates or subtitles", () => {
    expect(cleanTopicName("Oakmere vs Fernhill Cabin Decision 2026-07-24")).toBe("Oakmere vs Fernhill Cabin Decision");
    expect(cleanTopicName("Council — Two Sub-Agents for Daily Posts")).toBe("Council");
    expect(cleanTopicName("Reef-Bot Campaign July 2026")).toBe("Reef-Bot Campaign");
    expect(cleanTopicName("notas_estrategia")).toBe("Notas estrategia");
  });

  it("rewrites only parent: and memory: lines", () => {
    const raw = "---\ntitle: A\nparent: \"[[Tree]]\"\nmemory: working\ntags: []\n---\n\nBody [[2026-01-01#^e-aaaaaa]]\n";
    expect(withTreeFields(raw, "[[Notes/B]]", "long-term", false)).toBe("---\ntitle: A\ntags: []\nparent: \"[[Notes/B]]\"\nmemory: long-term\n---\n\nBody [[2026-01-01#^e-aaaaaa]]\n");
    expect(withTreeFields("---\ntitle: A\nparent: \"[[Notes/B]]\"\n---\nx\n", "[[Notes/B]]", "working", false)).toBeNull();
  });
});
