import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverTree, DISCOVERY_GENERATOR } from "../src/engine/treeDiscover.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { coinedNames, findNamedSubjects, mentionRe, SUBJECT_GENERATOR } from "../src/engine/treeSubjects.js";
import { assertSweepChangesSafe, rediscoverTree } from "../src/engine/treeSweep.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { lintVault } from "../src/vault/lint.js";
import { readTree } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";

/**
 * EPIC-9 E9-2i: two subjects Jordi talks about that his tree did not show, in a
 * made-up vault.
 *
 * - A product the person keeps naming in voice notes ("the lumen desk"; the fleet's
 *   reports spell it `lumen_desk`) has no page: the librarian filed those notes onto
 *   the Nimbus pages, and as two common words it set no page apart. It should become
 *   a root of its own, from the person's captures only, never the agent reports.
 * - A family page the person captured about on its own, again and again, sat inside
 *   Housing because its words and links overlap the house decision. It should be a
 *   root of its own, named for what the person says ("Family"), not one page's title.
 */
const CONFIG = "schema_version: 1\ntags:\n  - work\nconfidence_threshold: 0.7\n";
const INDEX = "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n";
const TODAY = "2026-11-02";

const page = (title: string, parent: string, body: string, extra: string[] = []) => [
  "---", `title: ${title}`, "type: note", "tags: []", "created: 2026-07-01", "updated: 2026-07-01",
  `summary: ${title}.`, `parent: "[[${parent}]]"`, ...extra, "---", "", `# ${title}`, "", body, "",
].join("\n");

const entry = (time: string, anchor: string, source: string, text: string) =>
  `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: ${source}\n- verbatim: no\n\n> ${text}\n`;

const LUMEN_NOTES = [
  "Voice note: the lumen desk should open on the inbox; lumen desk sessions keep the context; I want the lumen desk on every laptop",
  "Thinking about the Lumen Desk pricing: lumen desk for teams, lumen desk for one person, the lumen desk trial",
  "The lumen desk demo went well; next the lumen desk onboarding",
  "Lumen desk idea: a lumen-desk keyboard shortcut",
];
const AGENT_REPORTS = [
  "lumen_desk E12-S3 (2026-10-30): the lumen_desk console merged 4f3a2b1 and is live; lumen_desk wake ok",
  "lumen_desk E12-S4 (2026-11-01, run_0a1b2c3d): lumen_desk tests green, lumen_desk deployed",
];
const FAMILY_NOTES = [
  "Family weekend: the kids want the garden swing at the new house",
  "Family: grandparents come in December, the guest room in the house",
  "Talked with the kids about the family trip and the move",
  "Family dinner: who cooks, the big table in the house",
  "Family: the kids' school run after the move",
];

const LOGS: Record<string, string> = {
  "Log/2026-08-10.md": `# 2026-08-10\n\n${entry("09:00", "e-fa0001", "whatsapp", FAMILY_NOTES[0]!)}`,
  "Log/2026-08-20.md": `# 2026-08-20\n\n${entry("09:00", "e-fa0002", "mcp", FAMILY_NOTES[1]!)}`,
  "Log/2026-09-05.md": `# 2026-09-05\n\n${entry("09:00", "e-fa0003", "whatsapp", FAMILY_NOTES[2]!)}`,
  "Log/2026-09-25.md": `# 2026-09-25\n\n${entry("09:00", "e-fa0004", "whatsapp", FAMILY_NOTES[3]!)}`,
  "Log/2026-10-13.md": `# 2026-10-13\n\n${entry("09:00", "e-fa0005", "whatsapp", FAMILY_NOTES[4]!)}`,
  "Log/2026-10-26.md": `# 2026-10-26\n\n${entry("09:00", "e-ab0001", "whatsapp", "House decision: Lakeside or Hilltop, the property price and the mortgage")}`,
  "Log/2026-10-28.md": `# 2026-10-28\n\n${entry("09:00", "e-d10001", "whatsapp", LUMEN_NOTES[0]!)}\n${entry("10:00", "e-bb0001", "whatsapp", "Nimbus pricing: three tiers for teams")}`,
  "Log/2026-10-30.md": `# 2026-10-30\n\n${entry("09:00", "e-d10002", "whatsapp", LUMEN_NOTES[1]!)}\n${entry("10:00", "e-c00001", "mcp", AGENT_REPORTS[0]!)}\n${entry("11:00", "e-ab0002", "whatsapp", "House decision: visit in Hilltop, the property and the garden")}`,
  "Log/2026-11-01.md": `# 2026-11-01\n\n${entry("09:00", "e-d10003", "whatsapp", LUMEN_NOTES[2]!)}\n${entry("10:00", "e-d10004", "whatsapp", LUMEN_NOTES[3]!)}\n${entry("11:00", "e-c00002", "mcp", AGENT_REPORTS[1]!)}\n${entry("12:00", "e-bb0002", "whatsapp", "Nimbus onboarding for the first paying teams")}`,
};

const OLD_TREE = [
  "---", "title: Tree", "updated: 2026-11-01", `generated: ${DISCOVERY_GENERATOR}`, "---", "", "# Memory tree", "",
  "## Working memory", "",
  "- Nimbus | working | [[Projects/Nimbus]] | Product.",
  "- Housing | working | [[Areas/Housing]] | House decision.",
  "",
].join("\n");

function fixtureFiles(): Array<{ path: string; content: string }> {
  const root = ["memory: working"];
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    { path: "Tree.md", content: OLD_TREE },
    // The product; the librarian filed the lumen desk voice notes here.
    { path: "Projects/Nimbus.md", content: page("Nimbus", "Tree", "Nimbus is a memory product for teams: pricing and onboarding ([[2026-11-01#^e-bb0002]], [[2026-10-28#^e-d10001]], [[2026-11-01#^e-d10003]]).", root) },
    { path: "Notes/Nimbus pricing.md", content: page("Nimbus pricing", "Projects/Nimbus", "Nimbus pricing in three tiers for teams ([[2026-10-28#^e-bb0001]], [[2026-10-30#^e-d10002]], [[2026-11-01#^e-d10004]]). See [[Nimbus]].") },
    // Housing, and the family page the overlap pulled into it.
    { path: "Areas/Housing.md", content: page("Housing", "Tree", "Housing: the house decision between Lakeside and Hilltop, the property, the mortgage, the garden, room for the family ([[2026-10-26#^e-ab0001]]).", root) },
    { path: "Notes/House decision.md", content: page("House decision", "Areas/Housing", "Lakeside or Hilltop: property price, mortgage, garden; the family and the kids' school matter here ([[2026-10-30#^e-ab0002]]). See [[Family Holidays & Logistics 2026-08]].") },
    { path: "Notes/Family Holidays & Logistics 2026-08.md", content: page("Family Holidays & Logistics 2026-08", "Areas/Housing", "The kids, the grandparents, the trip, the school run, the guest room and the garden after the move ([[2026-08-10#^e-fa0001]], [[2026-08-20#^e-fa0002]], [[2026-09-05#^e-fa0003]], [[2026-09-25#^e-fa0004]], [[2026-10-13#^e-fa0005]]). See [[House decision]].") },
    ...Object.entries(LOGS).map(([path, content]) => ({ path, content })),
  ];
}

async function writeFixture(root: string): Promise<void> {
  for (const file of fixtureFiles()) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of await listMarkdownFiles(root)) out.set(file, await readFile(join(root, file), "utf8"));
  return out;
}

describe("named subjects and subjects of their own (E9-2i)", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "zenod-subjects-"));
    await writeFixture(vault);
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("knows coined names and every spelling of them, never ordinary words", () => {
    const names = coinedNames(["the lumen_desk console", "EpicSpine and Poly-Maker", "a voice_note with_the long-term follow-up", "e46-s9 x"]);
    expect([...names.keys()].sort()).toEqual(["epicspine", "lumendesk", "polymaker"]);
    const re = mentionRe(["lumen", "desk"]);
    expect("Lumen Desk, lumen desk, lumen-desk, lumen_desk, LumenDesk; illumen desks".match(re)).toHaveLength(5);
  });

  it("finds the product the person keeps naming, from their own captures only", async () => {
    const subjects = await findNamedSubjects(vault, TODAY);
    const lumen = subjects.find(s => s.key === "lumendesk")!;
    expect(lumen).toBeDefined();
    expect(lumen.page).toBeNull();
    expect(lumen.display).toBe("Lumen Desk");
    // Four voice notes on three days; the two agent reports that spell it lumen_desk do not count.
    expect(lumen.captures.map(h => h.capture.key)).toEqual(["2026-10-28#^e-d10001", "2026-10-30#^e-d10002", "2026-11-01#^e-d10003", "2026-11-01#^e-d10004"]);
    expect(lumen.days).toBe(3);
    expect(lumen.mentions).toBe(11);
  });

  it("before E9-2i the product and the family were not roots", async () => {
    // Without a page, discovery has nothing to cluster for the product: Nimbus holds its captures.
    const plan = (await discoverTree(vault, { today: TODAY }))!;
    expect(plan.roots.map(r => r.name)).not.toContain("Lumen Desk");
  });

  it("re-derives: the product becomes a working root, family a long-term root, nothing else moves", async () => {
    const before = await snapshot(vault);
    const writes = new TrackedWrites(vault);
    const result = (await rediscoverTree(vault, TODAY, writes))!;

    expect(result.subjects).toEqual([expect.objectContaining({ key: "lumendesk", path: "Projects/Lumen Desk.md", created: true, added: 4 })]);
    const created = await readFile(join(vault, "Projects/Lumen Desk.md"), "utf8");
    expect(created).toContain(`generated: ${SUBJECT_GENERATOR}`);
    expect(created).toContain("subject: lumendesk");
    for (const key of ["2026-10-28#^e-d10001", "2026-10-30#^e-d10002", "2026-11-01#^e-d10003", "2026-11-01#^e-d10004"]) expect(created).toContain(`[[${key}]]`);
    expect(created).not.toContain("e-c0000");

    const tree = (await readTree(vault))!;
    const byName = new Map(tree.nodes.map(n => [n.name, n]));
    expect(byName.get("Lumen Desk")?.kind).toBe("working");
    expect(byName.get("Lumen Desk")?.path).toContain("Projects/Lumen Desk");
    expect(byName.get("Nimbus")?.kind).toBe("working");
    expect(tree.nodes.find(n => n.path.includes("Areas/Housing"))?.kind).toBe("working");
    // Family: its own root, named for what the person says, not the page's long title.
    expect(byName.get("Family")?.kind).toBe("long-term");
    expect(byName.get("Family")?.path).toContain("Family Holidays & Logistics 2026-08");
    const family = await readFile(join(vault, "Notes/Family Holidays & Logistics 2026-08.md"), "utf8");
    expect(family).toContain('parent: "[[Tree]]"');

    // Log and every untouched page byte for byte; nothing deleted; only Tree.md, frontmatter and the new page change.
    const after = await snapshot(vault);
    for (const [path, content] of before) {
      expect(after.has(path)).toBe(true);
      if (path.startsWith("Log/")) expect(after.get(path)).toBe(content);
    }
    const changed = [...after].filter(([path, content]) => before.get(path) !== content).map(([path]) => path).sort();
    expect(changed).toEqual(["Notes/Family Holidays & Logistics 2026-08.md", "Projects/Lumen Desk.md", "Tree.md"]);
    assertSweepChangesSafe(writes.paths.map(path => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null })));

    expect((await lintTree(vault)).issues.filter(i => i.severity === "error")).toEqual([]);
    expect((await lintVault(vault, ["Projects/Lumen Desk.md"])).errors).toEqual([]);

    // A second run writes nothing; a fresh run finds the same roots.
    const again = new TrackedWrites(vault);
    expect((await rediscoverTree(vault, TODAY, again))!.changed).toEqual([]);
    const fresh = (await discoverTree(vault, { today: TODAY, fresh: true }))!;
    expect(fresh.roots.map(r => `${r.name}|${r.kind}`).sort()).toEqual(tree.nodes.map(n => `${n.name}|${n.kind}`).sort());
  });

  it("adds the person's new captures to the page it made, and never edits a page they wrote", async () => {
    await rediscoverTree(vault, TODAY, new TrackedWrites(vault));
    await writeFile(join(vault, "Log/2026-11-03.md"), `# 2026-11-03\n\n${entry("09:00", "e-d10005", "whatsapp", "The lumen desk needs a dark mode")}`);
    const writes = new TrackedWrites(vault);
    const result = (await rediscoverTree(vault, "2026-11-03", writes))!;
    expect(result.subjects).toEqual([expect.objectContaining({ key: "lumendesk", created: false, added: 1 })]);
    const page = await readFile(join(vault, "Projects/Lumen Desk.md"), "utf8");
    expect(page).toContain("[[2026-11-03#^e-d10005]]");
    expect(page).toContain("5 in the last 30 days");
    expect(page.match(/\[\[2026-\d\d-\d\d#\^e-d1000\d\]\]/g)).toHaveLength(5);

    // A name with a page of its own (the person's "Orbit-Lab" page) gets nothing from Zenod.
    await writeFile(join(vault, "Notes/Orbit-Lab.md"), page.replace(/^title: .*$/m, "title: Orbit-Lab").replace(/^generated: .*\n/m, "").replace(/^subject: .*\n/m, ""));
    const orbit = ["Orbit lab plan: orbit lab orbit lab orbit lab", "orbit lab again: orbit lab, orbit lab", "Orbit-Lab: the orbit lab budget, orbit lab"];
    await writeFile(join(vault, "Log/2026-11-04.md"), `# 2026-11-04\n\n${orbit.map((t, i) => entry(`0${i}:00`, `e-0b000${i}`, "whatsapp", t)).join("\n")}`);
    await writeFile(join(vault, "Log/2026-11-05.md"), `# 2026-11-05\n\n${entry("09:00", "e-0b0009", "whatsapp", "orbit lab: orbit lab")}`);
    const subjects = await findNamedSubjects(vault, "2026-11-05");
    expect(subjects.find(s => s.key === "orbitlab")?.page).toBe("Notes/Orbit-Lab.md");
    const before = await readFile(join(vault, "Notes/Orbit-Lab.md"), "utf8");
    await rediscoverTree(vault, "2026-11-05", new TrackedWrites(vault));
    const after = await readFile(join(vault, "Notes/Orbit-Lab.md"), "utf8");
    expect(after.replace(/^(parent|memory): .*\n/gm, "")).toBe(before.replace(/^(parent|memory): .*\n/gm, ""));
  });
});
