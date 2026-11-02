import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { aliasCanonicalizer, discoverTree } from "../src/engine/treeDiscover.js";
import { heat, jaccard, matchRootIds, newRootId } from "../src/engine/treeIdentity.js";
import { TrackedWrites } from "../src/engine/treePlacement.js";
import { steerTreeRoot, TreeSteerError } from "../src/engine/treeSteer.js";
import { rediscoverTree } from "../src/engine/treeSweep.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { keeperAliases } from "../src/vault/memoryIndex.js";
import { parseTree, readTree, TREE_PATH } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { memoryTreeOutline } from "../src/vault/treeOutline.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";
import { appendKeeperNote, parseKeeperNotes, withSteeringFields } from "../src/vault/treeSteering.js";

/**
 * EPIC-9 E9-5b: stable root identity and steering data. A made-up vault: a garden the person
 * talks about now, a Lisbon trip from the summer, kitchen recipes nobody captures about.
 * Done check (E9-4 §10): a rename and a pin survive 3 re-derivations; a keep-apart note blocks
 * a merge; lint 0. Plus parity with the EpicSpine skill's shared tree library (E9-5f).
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

describe("E9-5b Keeper notes", () => {
  it("parses, formats and appends one-line notes; Tree.md never reads them as roots", () => {
    const tree = "---\ntitle: Tree\n---\n\n## Working memory\n\n- Garden | working | [[Notes/Compost]] | 3 pages. ^n-1ecbdbe6\n\n## Long-term memory\n\n- Kitchen | long-term | [[Notes/Bread recipes]] | 5 pages.\n";
    const first = appendKeeperNote(tree, { targets: [{ name: "Agent Team" }], rule: { kind: "aliases", aliases: ["agentine", "agent_team"] }, why: "transcription writes agentine", confirmed: "2026-11-02" });
    expect(first.id).toBe("K-1");
    const second = appendKeeperNote(first.raw, { targets: [{ name: "Garden", id: "n-1ecbdbe6" }, { name: "Kitchen" }], rule: { kind: "keep-apart" }, why: "two things", confirmed: "2026-11-02" });
    expect(second.id).toBe("K-2");
    expect(second.raw).toContain("- K-2 | Garden ^n-1ecbdbe6, Kitchen | keep apart | two things | confirmed 2026-11-02");
    const { notes, problems } = parseKeeperNotes(second.raw);
    expect(problems).toEqual([]);
    expect(notes.map(n => [n.id, n.rule.kind, n.targets])).toEqual([
      ["K-1", "aliases", [{ name: "Agent Team" }]],
      ["K-2", "keep-apart", [{ name: "Garden", id: "n-1ecbdbe6" }, { name: "Kitchen" }]],
    ]);
    const parsed = parseTree(second.raw);
    expect(parsed.problems).toEqual([]);
    expect(parsed.nodes.map(n => [n.name, n.id ?? null, n.summary])).toEqual([["Garden", "n-1ecbdbe6", "3 pages."], ["Kitchen", null, "5 pages."]]);
    // The index (E9-5a) reads the alias groups from the same notes.
    expect(keeperAliases(second.raw)).toEqual([["Agent Team", "agentine", "agent_team"]]);
  });

  it("reads every alias as the name it stands for", () => {
    const canon = aliasCanonicalizer([["Agent Team", "agentine", "agent_team"]]);
    expect(canon("Agentine wake; the agent_team board; agent-team and agent team")).toBe("Agent Team wake; the Agent Team board; Agent Team and Agent Team");
    expect(canon("agentines and pageagentine stay")).toBe("agentines and pageagentine stay");
  });

  it("adds steering flags to a page without touching anything else, and never removes one", () => {
    const raw = "---\ntitle: Garden\naliases:\n  - veg patch\nparent: \"[[Tree]]\"\nmemory: working\n---\nBody stays.\n";
    const next = withSteeringFields(raw, { pinned: true, nameLocked: true, aliases: ["Veg patch", "allotment"] })!;
    expect(parseNote(next).frontmatter).toMatchObject({ title: "Garden", parent: "[[Tree]]", memory: "working", pinned: true, "name-locked": true, aliases: ["veg patch", "allotment"] });
    expect(next.endsWith("---\nBody stays.\n")).toBe(true);
    expect(withSteeringFields(next, { pinned: true, aliases: ["allotment"] })).toBeNull();
  });
});

describe("E9-5b stable identity and steering in discovery", { timeout: 60_000 }, () => {
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

  it("a rename and a pin survive 3 re-derivations (done check), lint 0", async () => {
    await writeFixture(dir);
    const first = (await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir)))!;
    const garden = first.roots.find(r => r.kind === "working")!;
    const kitchen = first.roots.find(r => r.members.includes("Notes/Soup recipes.md"))!;
    expect(kitchen.name).not.toBe("Kitchen");

    // Control: unpinned, the garden cools to long-term by February.
    expect((await discoverTree(dir, { today: "2027-02-01" }))!.roots.find(r => r.path === garden.path)!.kind).toBe("long-term");

    const pin = await steerTreeRoot(dir, { action: "pin", root: garden.id, today: "2026-11-02" }, new TrackedWrites(dir));
    const rename = await steerTreeRoot(dir, { action: "rename", root: kitchen.id, name: "Kitchen", today: "2026-11-02" }, new TrackedWrites(dir));
    expect([pin.note, rename.note]).toEqual(["K-1", "K-2"]);
    const notesText = (await readFile(join(dir, TREE_PATH), "utf8")).split("## Keeper notes")[1];
    expect(notesText).toContain(`- K-1 | ${garden.name} ^${garden.id} | pinned | pinned set in the Memory tab | confirmed 2026-11-02`);
    expect(notesText).toContain(`- K-2 | ${kitchen.name} ^${kitchen.id} | name: Kitchen |`);
    expect((await rootsOf()).find(n => n.id === kitchen.id)!.name).toBe("Kitchen");
    expect(await lintErrors()).toEqual([]);

    // Three re-derivations, weeks apart, with new pages arriving in between.
    const days = ["2026-11-09", "2026-12-20", "2027-02-01"];
    const extra = [
      { path: "Notes/Cake recipes.md", content: page("Cake recipes", "Notes/Bread recipes", "Kitchen recipes: sponge cake, oven times, flour and eggs. See [[Bread recipes]].") },
      { path: "Notes/Lisbon tram.md", content: page("Lisbon tram", "Notes/Lisbon hotel", "Lisbon tram 28 to Alfama from the hotel. See [[Lisbon hotel]].") },
      { path: "Notes/Garden shed.md", content: page("Garden shed", "Notes/Compost", "Garden shed for tools near the raised beds and the compost.") },
    ];
    for (const [k, today] of days.entries()) {
      await writeFixture(dir, [extra[k]!]);
      const run = (await rediscoverTree(dir, today, new TrackedWrites(dir)))!;
      const pinned = run.roots.find(r => r.id === garden.id)!;
      const named = run.roots.find(r => r.id === kitchen.id)!;
      expect(pinned).toMatchObject({ name: garden.name, kind: "working", path: garden.path, pinned: true, nameLocked: true });
      expect(named).toMatchObject({ name: "Kitchen", path: kitchen.path, nameLocked: true });
      expect(await lintErrors()).toEqual([]);
      // The notes are carried over verbatim; nobody else took the names.
      expect((await readFile(join(dir, TREE_PATH), "utf8")).split("## Keeper notes")[1]).toBe(notesText);
      expect(run.roots.filter(r => r.name === "Kitchen" || r.name === garden.name)).toHaveLength(2);
    }
    // The pinned working root stays working although it is cold now.
    expect((await discoverTree(dir, { today: "2027-02-01" }))!.roots.find(r => r.id === garden.id)!.heat).toBeLessThan(0.3);
    // The pages carry the mirror flags.
    expect(parseNote(await readFile(join(dir, garden.path), "utf8")).frontmatter).toMatchObject({ pinned: true, "name-locked": true });
    expect(parseNote(await readFile(join(dir, kitchen.path), "utf8")).frontmatter).toMatchObject({ "name-locked": true });
    // The Memory tab shows it.
    const outline = (await memoryTreeOutline(dir))!;
    const roots = outline.groups.flatMap(g => g.children);
    expect(roots.find(r => r.rootId === garden.id)).toMatchObject({ pinned: true, nameLocked: true });
    expect(roots.find(r => r.rootId === kitchen.id)).toMatchObject({ title: "Kitchen", nameLocked: true });
    expect(outline.keeperNotes).toBe(2);
  });

  it("a keep-apart note blocks a merge (done check)", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    const lisbon = (await rootsOf()).find(n => /lisbon/i.test(n.name))!;
    const kitchen = (await rootsOf()).find(n => /recipes/i.test(n.name))!;
    // Control: with room for one long-term area, the cold topics merge.
    const merged = (await discoverTree(dir, { today: "2026-11-02", maxAreas: 1 }))!;
    expect(merged.roots.filter(r => r.kind === "long-term")).toHaveLength(1);

    const raw = await readFile(join(dir, TREE_PATH), "utf8");
    await writeFile(join(dir, TREE_PATH), appendKeeperNote(raw, { targets: [{ name: lisbon.name }, { name: kitchen.name }], rule: { kind: "keep-apart" }, why: "a trip is not cooking", confirmed: "2026-11-02" }).raw);
    const apart = (await discoverTree(dir, { today: "2026-11-02", maxAreas: 1 }))!;
    const longTerm = apart.roots.filter(r => r.kind === "long-term");
    expect(longTerm).toHaveLength(2);
    expect(longTerm.find(r => r.members.includes("Notes/Lisbon hotel.md"))!.members).not.toContain("Notes/Soup recipes.md");
    expect(apart.steering.applied).toEqual([expect.stringMatching(/^K-1: keep-apart → /)]);

    // Pages that cluster together are kept apart too (a page-level merge).
    await writeFile(join(dir, TREE_PATH), appendKeeperNote(raw, { targets: [{ name: "Lisbon flights" }, { name: "Lisbon hotel" }], rule: { kind: "keep-apart" }, why: "test", confirmed: "2026-11-02" }).raw);
    const pages = (await discoverTree(dir, { today: "2026-11-02" }))!;
    const holder = (path: string) => pages.roots.find(r => r.members.includes(path))!.id;
    expect(holder("Notes/Lisbon flights.md")).not.toBe(holder("Notes/Lisbon hotel.md"));
  });

  it("an own-root note makes a page its own root; aliases reach the root page; unknown targets are reported, not acted on", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    let raw = await readFile(join(dir, TREE_PATH), "utf8");
    raw = appendKeeperNote(raw, { targets: [{ name: "Lisbon museums" }], rule: { kind: "own-root" }, why: "its own thing", confirmed: "2026-11-02" }).raw;
    raw = appendKeeperNote(raw, { targets: [{ name: "Lisbon museums" }], rule: { kind: "aliases", aliases: ["museus", "Lisbon museums"] }, why: "Portuguese", confirmed: "2026-11-02" }).raw;
    raw = appendKeeperNote(raw, { targets: [{ name: "Nowhere" }], rule: { kind: "pinned" }, why: "no such root", confirmed: "2026-11-02" }).raw;
    await writeFile(join(dir, TREE_PATH), raw);
    const run = (await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir)))!;
    const museums = run.roots.find(r => r.path === "Notes/Lisbon museums.md")!;
    expect(museums).toMatchObject({ kind: "long-term", members: ["Notes/Lisbon museums.md"], aliases: ["museus"] });
    expect(parseNote(await readFile(join(dir, "Notes/Lisbon museums.md"), "utf8")).frontmatter!.aliases).toEqual(["museus"]);
    const plan = (await discoverTree(dir, { today: "2026-11-02" }))!;
    expect(plan.steering.unresolved).toEqual(["K-3: Nowhere"]);
    expect(await lintErrors()).toEqual([]);
  });

  it("pin and rename refuse what would break the tree, and a repeat is a no-op", async () => {
    await writeFixture(dir);
    const first = (await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir)))!;
    const [a, b] = first.roots;
    const steer = (input: Parameters<typeof steerTreeRoot>[1]) => steerTreeRoot(dir, input, new TrackedWrites(dir));
    await expect(steer({ action: "pin", root: "n-00000000", today: "2026-11-02" })).rejects.toMatchObject({ code: "unknown_root" });
    await expect(steer({ action: "rename", root: a!.id, name: b!.name.toUpperCase(), today: "2026-11-02" })).rejects.toMatchObject({ code: "name_taken" });
    for (const bad of ["", "a | b", "x".repeat(61), "[[link]]", "id ^x"]) {
      await expect(steer({ action: "rename", root: a!.id, name: bad, today: "2026-11-02" })).rejects.toBeInstanceOf(TreeSteerError);
    }
    // By page path too; a second pin changes nothing.
    expect(await steer({ action: "pin", root: a!.path, today: "2026-11-02" })).toMatchObject({ changed: true, note: "K-1" });
    expect(await steer({ action: "pin", root: a!.id, today: "2026-11-02" })).toMatchObject({ changed: false, note: null });
    expect(parseKeeperNotes(await readFile(join(dir, TREE_PATH), "utf8")).notes).toHaveLength(1);
  });

  it("lint reports a malformed Keeper note and a repeated root id", async () => {
    await writeFixture(dir);
    await rediscoverTree(dir, "2026-11-02", new TrackedWrites(dir));
    const raw = await readFile(join(dir, TREE_PATH), "utf8");
    const id = (await rootsOf())[0]!.id!;
    const broken = raw.replace(/ \^n-[0-9a-f]{8}\n(?=- )/, ` ^${id}\n`) + "\n## Keeper notes\n\n- K-1 | Garden | pinned\n";
    await writeFile(join(dir, TREE_PATH), broken);
    expect((await lintErrors()).map(e => e.rule).sort()).toEqual(["tree/keeper-note", "tree/node-duplicate"]);
  });
});

describe("E9-5b engine: pin and rename go through the vault write lock as one commit each", { timeout: 30_000 }, () => {
  let tmp: string | undefined;
  let state: SqliteStateStore | undefined;
  afterEach(async () => {
    state?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("commits a Keeper note per steer, serialised, and leaves Log/ alone", async () => {
    tmp = await mkdtemp(join(tmpdir(), "zenod-e95b-engine-"));
    const bare = join(tmp, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(tmp, "seed");
    await simpleGit().clone(bare, seed);
    await cp(fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url)), seed, { recursive: true });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(tmp, "work"), remoteUrl: bare });
    state = new SqliteStateStore(":memory:");
    const engine = createEngine({ repo, llm: {} as BrainLlm, state });

    // Two steers at once: the write queue runs them one after the other.
    const [pin, rename] = await Promise.all([
      engine.steerTree!({ action: "pin", root: "Projects/Hair transplant.md" }),
      engine.steerTree!({ action: "rename", root: "Projects/House decision.md", name: "House" }),
    ]);
    expect([pin.note, rename.note]).toEqual(["K-1", "K-2"]);
    await expect(engine.steerTree!({ action: "rename", root: "Projects/House decision.md", name: "Hair transplant" })).rejects.toMatchObject({ code: "name_taken" });

    const check = join(tmp, "check");
    await simpleGit().clone(bare, check);
    const log = await simpleGit(check).log();
    expect(log.all.slice(0, 2).map(c => c.message)).toEqual(["memory: keeper note K-2 (rename to House)", "memory: keeper note K-1 (pin Hair transplant)"]);
    const files = (await simpleGit(check).show(["--name-only", "--format=", "HEAD~2..HEAD"])).split("\n").filter(Boolean).sort();
    expect([...new Set(files)]).toEqual(["Projects/Hair transplant.md", "Projects/House decision.md", "Tree.md"]);
    const tree = await readFile(join(check, TREE_PATH), "utf8");
    expect(parseTree(tree).nodes.map(n => n.name)).toContain("House");
    expect(parseKeeperNotes(tree).notes.map(n => n.rule.kind)).toEqual(["pinned", "name"]);
    expect(parseNote(await readFile(join(check, "Projects/Hair transplant.md"), "utf8")).frontmatter).toMatchObject({ pinned: true });
  });
});
