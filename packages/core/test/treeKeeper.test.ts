import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import {
  carryIds,
  classifyChanges,
  keeperCommitLabels,
  keeperWeekKey,
  loadKeeperState,
  refusedChanges,
  saveKeeperState,
  recentChangeLine,
  recentChangeLines,
  recentChanges,
  rollupRecent,
  selectChanges,
  type KeeperChange,
  type KeeperTreeState,
} from "../src/engine/treeKeeper.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseTree, TREE_PATH } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";
import { appendKeeperNote, parseKeeperNotes } from "../src/vault/treeSteering.js";

/**
 * EPIC-9 E9-5c: the memory-keeper. The Recent changes rollup is the EpicSpine skill's (parity
 * fixture); the gate lets at most the week's budget of structural changes through, needs two
 * sightings for anything but promote/demote, does nothing by default, and writes one revertable
 * commit per digestion. The daily wake makes no model call and no vault write.
 */

const PARITY = JSON.parse(await readFile(fileURLToPath(new URL("./fixtures/tree-library-parity.json", import.meta.url)), "utf8")) as {
  recent_changes: Array<{
    name: string;
    previous: Record<string, { name: string; kind?: string; members?: string[] }>;
    current: Record<string, { name: string; kind?: string; members?: string[] }>;
    day: string;
    existing: string[];
    expected_changes: unknown[];
    expected_section: string[];
  }>;
};

describe("E9-5c Recent changes: parity with the EpicSpine skill's tree library", () => {
  for (const c of PARITY.recent_changes) {
    it(c.name, () => {
      const changes = recentChanges(c.previous, c.current);
      expect(changes).toEqual(c.expected_changes);
      expect(rollupRecent(c.existing, changes.map(change => recentChangeLine(change, c.day)))).toEqual(c.expected_section);
    });
  }

  it("reads the section's bullets back from a Tree.md", () => {
    const raw = "---\ntitle: Tree\n---\n\n## Working memory\n\n- A | working | [[A]] | a\n\n## Recent changes\n\nWhat changed.\n\n- 2026-11-08 · new A\n- 2026-11-01 · retired B\n";
    expect(recentChangeLines(raw)).toEqual(["- 2026-11-08 · new A", "- 2026-11-01 · retired B"]);
  });
});

const state = (roots: Array<{ id: string; name: string; kind?: "working" | "long-term"; members: string[] }>, generated = true): KeeperTreeState => {
  const pages = new Map<string, { parent: string | undefined; root: string | null }>();
  for (const r of roots) for (const m of r.members) pages.set(m, { parent: m === r.members[0] ? "[[Tree]]" : `[[${r.members[0]!.replace(/\.md$/, "")}]]`, root: r.id });
  return { generated, roots: roots.map(r => ({ id: r.id, name: r.name, kind: r.kind ?? "working", path: r.members[0]!, summary: "", members: [...r.members].sort() })), missing: [], pages };
};
const pages = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `Notes/${prefix}${i}.md`);

describe("E9-5c classifying a re-derivation by stable id", () => {
  it("names promote, demote, rename, merge, split, reform, retire and new, one unit each", () => {
    const before = state([
      { id: "r-garden", name: "Garden", kind: "long-term", members: pages("g", 4) },
      { id: "r-trip", name: "Trip", members: pages("t", 4) },
      { id: "r-kids", name: "Kids", members: pages("k", 4) },
      { id: "r-tax", name: "Tax", members: pages("x", 4) },
      { id: "r-old", name: "Old", members: pages("o", 4) },
      { id: "r-house", name: "House", members: pages("h", 6) },
    ]);
    const proposed = state([
      { id: "r-garden", name: "Garden", kind: "working", members: pages("g", 4) },         // promote
      { id: "r-trip", name: "Travel", kind: "long-term", members: pages("t", 4) },         // demote + rename
      { id: "r-kids", name: "Kids", members: [...pages("k", 4), ...pages("x", 4)] },       // merge Tax into Kids
      { id: "n-houseA", name: "House renovation", members: pages("h", 3) },                // split out of House…
      { id: "r-house", name: "House", members: pages("h", 6).slice(3) },                   // …House keeps its id
      { id: "n-new", name: "Bikes", members: pages("b", 3) },                              // new
    ]);
    const kinds = classifyChanges(before, proposed).map(c => `${c.kind}:${c.label}`);
    expect(kinds).toEqual(expect.arrayContaining([
      "promote:move Garden to working",
      "demote:move Trip to long-term",
      "rename:rename Trip to Travel",
      "merge:merge Tax into Kids",
      "split:split House renovation out of House",
      "new:new Bikes",
      "retire:retire Old",
    ]));
    expect(classifyChanges(before, proposed).find(c => c.kind === "promote")!.needsConfirm).toBe(false);
    expect(classifyChanges(before, proposed).find(c => c.kind === "merge")!.needsConfirm).toBe(true);
    // A first digestion (a tree discovery never wrote) needs no second sighting.
    expect(classifyChanges({ ...before, generated: false }, proposed, true).every(c => !c.needsConfirm)).toBe(true);
  });

  it("a root that re-forms under the same name keeps its id (identity follows the name the person sees)", () => {
    const before = state([{ id: "r-mail", name: "Email comercial", kind: "long-term", members: pages("m", 3) }]);
    const proposed = state([{ id: "n-grown", name: "Email comercial", kind: "long-term", members: [...pages("m", 3), ...pages("n", 5)] }]);
    expect(classifyChanges(before, structuredClone(proposed)).map(c => c.kind)).toEqual(["reform"]);
    expect(carryIds(before, proposed)).toBe(1);
    expect(proposed.roots[0]!.id).toBe("r-mail");
    expect(classifyChanges(before, proposed)).toEqual([]);
  });
});

describe("E9-5c selecting what lands: budget, two sightings, NOOP default", () => {
  const change = (kind: KeeperChange["kind"], id: string, extra: Partial<KeeperChange> = {}): KeeperChange => ({
    kind, key: `${kind}:${id}`, retire: [], add: [], persist: id, members: [], label: `${kind} ${id}`, needsConfirm: kind !== "promote" && kind !== "demote", weight: 1, ...extra,
  });

  it("lets at most the budget through and keeps the rest pending", () => {
    const five = ["a", "b", "c", "d", "e"].map(id => change("promote", id));
    const picked = selectChanges(five, [], 3);
    expect(picked.applied.map(c => c.persist)).toEqual(["a", "b", "c"]);
    expect(picked.overBudget.map(c => c.persist)).toEqual(["d", "e"]);
    expect(selectChanges(five, [], 0).applied).toEqual([]);
  });

  it("needs the same signal on the previous digestion for anything but promote and demote", () => {
    const merge = change("merge", "kids", { key: "merge:tax>kids", retire: ["tax"] });
    expect(selectChanges([merge], [], 3)).toMatchObject({ applied: [], unconfirmed: [merge] });
    expect(selectChanges([merge], [{ kind: "merge", key: "merge:tax>kids", firstSeen: "2026-11-01" }], 3).applied).toEqual([merge]);
    // A new root is matched to last week's sighting by its pages (Jaccard ≥ 0.5), its id being new each week.
    const fresh = change("new", "n-1", { key: "new", persist: null, add: ["n-1"], members: ["a", "b", "c", "d"] });
    expect(selectChanges([fresh], [{ kind: "new", key: "new", members: ["a", "b", "c", "x"], firstSeen: "2026-11-01" }], 3).applied).toEqual([fresh]);
    expect(selectChanges([fresh], [{ kind: "new", key: "new", members: ["a", "x", "y", "z"], firstSeen: "2026-11-01" }], 3).applied).toEqual([]);
  });

  it("never lands two changes on the same root in one run", () => {
    const rename = change("rename", "trip", { key: "rename:trip>travel" });
    const demote = change("demote", "trip");
    const picked = selectChanges([demote, rename], [{ kind: "rename", key: "rename:trip>travel", firstSeen: "2026-11-01" }], 3);
    expect(picked.applied).toEqual([demote]);
    expect(picked.overBudget).toEqual([rename]);
  });

  it("keys the budget week by its Sunday", () => {
    expect(keeperWeekKey("2026-11-08")).toBe("2026-11-08");
    expect(keeperWeekKey("2026-11-14")).toBe("2026-11-08");
    expect(keeperWeekKey("2026-11-07")).toBe("2026-11-01");
  });
});

describe("E9-5c the person's word: steered changes land at once; undone changes stay off the table", () => {
  const change = (kind: KeeperChange["kind"], id: string, extra: Partial<KeeperChange> = {}): KeeperChange => ({
    kind, key: `${kind}:${id}`, retire: [], add: [], persist: id, members: [], label: `${kind} ${id}`, needsConfirm: kind !== "promote" && kind !== "demote", weight: 1, ...extra,
  });

  it("a close (E9-5e) is a steered demote: it lands first, needs no second sighting and spends no budget", () => {
    const before = state([{ id: "r-house", name: "House", members: pages("h", 3) }, { id: "r-trip", name: "Trip", kind: "long-term", members: pages("t", 3) }]);
    const proposed = state([{ id: "r-house", name: "House", kind: "long-term", members: pages("h", 3) }, { id: "r-trip", name: "Trip", members: pages("t", 3) }]);
    const changes = classifyChanges(before, proposed, false, new Map([["Notes/h0.md", { closed: true }]]));
    expect(changes.map(c => [c.kind, c.steered])).toEqual([["demote", true], ["promote", false]]);
    const picked = selectChanges(changes, [], 0);
    expect(picked.applied.map(c => c.kind)).toEqual(["demote"]);
    expect(picked.overBudget.map(c => c.kind)).toEqual(["promote"]);
  });

  it("reads undone keeper digestions from the vault's commits: refused for 8 weeks, a redo lifts it", () => {
    const subject = "keeper (weekly digestion, 2 changes: merge Tax into Kids; new Bikes; re-filed 0, archived 0, deepened 0, 0 proposals)";
    expect(keeperCommitLabels(subject)).toEqual(["merge Tax into Kids", "new Bikes"]);
    expect(keeperCommitLabels("keeper (weekly digestion, 0 changes; re-filed 0, archived 0, deepened 0, 0 proposals)")).toEqual([]);
    const undone = refusedChanges({ refused: [] }, [`memory: undo abc1234 (${subject})`, "memory: filed e-123456"], "2026-11-08");
    expect(undone).toEqual([{ label: "merge Tax into Kids", since: "2026-11-08" }, { label: "new Bikes", since: "2026-11-08" }]);
    // Newest first: a redo after the undo lifts it.
    expect(refusedChanges({ refused: undone }, [`memory: redo def5678 (${subject})`, `memory: undo abc1234 (${subject})`], "2026-11-15")).toEqual([]);
    // The refusal keeps its first date, and ends 8 weeks later.
    expect(refusedChanges({ refused: undone }, [`memory: undo abc1234 (${subject})`], "2026-11-15")[0]!.since).toBe("2026-11-08");
    expect(refusedChanges({ refused: undone }, [], "2027-01-03")).toEqual([]);
    const merge = change("merge", "kids", { key: "merge:tax>kids", label: "merge Tax into Kids", retire: ["tax"] });
    const picked = selectChanges([merge], [{ kind: "merge", key: "merge:tax>kids", firstSeen: "2026-11-01" }], 3, new Set(["merge Tax into Kids"]));
    expect(picked).toMatchObject({ applied: [], refused: [merge] });
  });
});

// A made-up vault (the E9-5b fixture's world): a garden the person talks about now, a summer trip, recipes.
const SEEDED: SeedNode[] = [
  { name: "Old trip", kind: "working", path: "Projects/Old trip.md", summary: "Planning a trip: flights and hotels." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: kitchen, insurance and documents." },
];
const page = (title: string, parent: string, body: string) => [
  "---", `title: ${title}`, "type: note", "tags: []", "created: 2026-07-01", "updated: 2026-07-01",
  `summary: ${title}.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "", "See [[Index]].", "",
].join("\n");
const entry = (time: string, anchor: string, text: string) => `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: no\n\n> ${text}\n`;
const FILES: Record<string, string> = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n",
  "Notes/Raised beds.md": page("Raised beds", "Areas/Life admin", "Raised beds for tomato seedlings, garden soil depth and compost ([[2026-10-20#^e-b00001]])."),
  "Notes/Watering timer.md": page("Watering timer", "Areas/Life admin", "Garden drip line and watering timer for the tomato beds ([[2026-10-28#^e-b00002]]). See [[Raised beds]]."),
  "Notes/Compost.md": page("Compost", "Areas/Life admin", "Compost for the garden soil before planting tomato seedlings ([[2026-11-01#^e-b00003]])."),
  "Notes/Lisbon flights.md": page("Lisbon flights", "Projects/Old trip", "Lisbon flights booked; hotel near Alfama ([[2026-07-10#^e-a00001]]). Tram pass."),
  "Notes/Lisbon hotel.md": page("Lisbon hotel", "Projects/Old trip", "Lisbon hotel in Alfama, tram pass and flights ([[2026-07-10#^e-a00002]]). See [[Lisbon flights]]."),
  "Notes/Lisbon museums.md": page("Lisbon museums", "Projects/Old trip", "Lisbon museums near Alfama and the tram. See [[Lisbon hotel]]."),
  "Notes/Soup recipes.md": page("Soup recipes", "Areas/Life admin", "Kitchen recipes: lentil soup, onion soup, stock for cooking."),
  "Notes/Bread recipes.md": page("Bread recipes", "Areas/Life admin", "Kitchen recipes: sourdough bread, cooking times, oven and flour. See [[Soup recipes]]."),
  "Notes/Pasta recipes.md": page("Pasta recipes", "Areas/Life admin", "Kitchen recipes: fresh pasta, cooking water, flour and eggs. See [[Bread recipes]]."),
  "Log/2026-07-10.md": `# 2026-07-10\n\n${entry("09:00", "e-a00001", "Lisbon flights booked, hotel near Alfama")}\n${entry("10:00", "e-a00002", "Lisbon hotel confirmation and the tram pass")}`,
  "Log/2026-10-20.md": `# 2026-10-20\n\n${entry("09:00", "e-b00001", "Tomato seedlings need deeper raised beds in the garden")}`,
  "Log/2026-10-28.md": `# 2026-10-28\n\n${entry("09:00", "e-b00002", "Garden watering timer: drip line for the tomato beds")}`,
  "Log/2026-11-01.md": `# 2026-11-01\n\n${entry("09:00", "e-b00003", "Compost for the garden soil before planting tomato")}`,
};

describe("E9-5c engine: the keeper's weekly digestion and daily wake", { timeout: 60_000 }, () => {
  let tmp: string | undefined;
  let store: SqliteStateStore | undefined;
  afterEach(async () => {
    store?.close();
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function setup(day: string) {
    tmp = await mkdtemp(join(tmpdir(), "zenod-e95c-"));
    const bare = join(tmp, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(tmp, "seed");
    await simpleGit().clone(bare, seed);
    const files = [...Object.entries(FILES).map(([path, content]) => ({ path, content })), ...seedTreeFiles(SEEDED, "2026-07-01")];
    for (const file of files) {
      await mkdir(dirname(join(seed, file.path)), { recursive: true });
      await writeFile(join(seed, file.path), file.content);
    }
    // The person's word applies from the start: the kitchen keeps its own root.
    const tree = await readFile(join(seed, TREE_PATH), "utf8");
    await writeFile(join(seed, TREE_PATH), appendKeeperNote(tree, { targets: [{ name: "Life admin" }], rule: { kind: "pinned" }, why: "test", confirmed: "2026-11-01" }).raw);
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(tmp, "work"), remoteUrl: bare });
    store = new SqliteStateStore(":memory:");
    // Any model call fails the test: structure is deterministic and the daily wake is $0.
    const llm = new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : () => { throw new Error(`model call: ${String(prop)}`); }) }) as BrainLlm;
    const statePath = join(tmp, "data", "memory-keeper.json");
    const engine = createEngine({ repo, llm, state: store, keeperStatePath: statePath, now: () => new Date(`${day}T03:00:00Z`) });
    const check = async () => {
      const dir = join(tmp!, `check-${Math.random().toString(36).slice(2)}`);
      await simpleGit().clone(bare, dir);
      return dir;
    };
    return { engine, bare, statePath, check, seedHead: (await git.revparse(["HEAD"])).trim() };
  }

  it("first digestion: one keeper commit, Recent changes written, Keeper notes kept, Log untouched, lint 0; revert is byte-identical", async () => {
    const { engine, statePath, check, seedHead } = await setup("2026-11-08");
    const result = await engine.sweepTree!({ mode: "weekly" });
    expect(result.committed).toBe(true);
    expect(result.keeper).toMatchObject({ mode: "weekly", modelCalls: 0, costUsd: 0, capUsd: 0.05 });
    expect(result.keeper!.changes).toBeGreaterThan(0);
    expect(result.keeper!.changes).toBeLessThanOrEqual(6);

    const dir = await check();
    const log = await simpleGit(dir).log();
    expect(log.all[0]!.message).toMatch(/^memory: keeper \(weekly digestion, \d+ changes?/);
    expect(log.all[1]!.hash).toBe(seedHead);
    const tree = await readFile(join(dir, TREE_PATH), "utf8");
    expect(recentChangeLines(tree).length).toBe(result.keeper!.recentLines);
    expect(recentChangeLines(tree).every(line => line.startsWith("- 2026-11-08 · "))).toBe(true);
    expect(parseKeeperNotes(tree).notes.map(n => n.id)).toEqual(["K-1"]);
    expect(parseTree(tree).nodes.some(n => n.name === "Life admin")).toBe(true);
    const changed = (await simpleGit(dir).show(["--name-only", "--format=", "HEAD"])).split("\n").filter(Boolean);
    expect(changed.some(path => path.startsWith("Log/") || path.startsWith("_attachments/"))).toBe(false);
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);

    const saved = await loadKeeperState(statePath);
    expect(saved).toMatchObject({ lastDigestion: "2026-11-08", week: { key: "2026-11-08", changes: result.keeper!.changes - result.keeper!.steered } });
    expect(saved.runs).toHaveLength(1);

    // One `git revert` gives back the vault as it stood, byte for byte.
    await simpleGit(dir).addConfig("user.name", "t").addConfig("user.email", "t@test");
    await simpleGit(dir).raw(["revert", "--no-edit", "HEAD"]);
    expect((await simpleGit(dir).raw(["diff", "--stat", seedHead, "HEAD"])).trim()).toBe("");
  });

  it("settles, then a digestion with nothing to change is a NOOP: no commit, Tree.md byte for byte", async () => {
    const { engine, check } = await setup("2026-11-08");
    // A change that waited (one change per root per run) lands on a later run; then the tree is still.
    let runs = 0;
    while ((await engine.sweepTree!({ mode: "weekly" })).committed) {
      runs++;
      expect(runs).toBeLessThanOrEqual(3);
    }
    const before = await readFile(join(await check(), TREE_PATH), "utf8");
    const again = await engine.sweepTree!({ mode: "early" });
    expect(again.committed).toBe(false);
    expect(again.keeper).toMatchObject({ mode: "early", changes: 0, recentLines: 0 });
    expect(await readFile(join(await check(), TREE_PATH), "utf8")).toBe(before);
  });

  it("a close lands at the next digestion even with the week's budget spent (the person's word is never held back)", async () => {
    const { engine, statePath, check } = await setup("2026-11-08");
    while ((await engine.sweepTree!({ mode: "weekly" })).committed) { /* settle */ }
    const tree = parseTree(await readFile(join(await check(), TREE_PATH), "utf8"));
    const working = tree.nodes.find(n => n.kind === "working")!;
    await engine.steerTree!({ action: "close", root: working.id! });
    await saveKeeperState(statePath, { ...(await loadKeeperState(statePath)), week: { key: "2026-11-08", changes: 3 } });
    const result = await engine.sweepTree!({ mode: "early" });
    expect(result.keeper).toMatchObject({ budget: 0, steered: 1 });
    const after = await readFile(join(await check(), TREE_PATH), "utf8");
    expect(parseTree(after).nodes.find(n => n.id === working.id)!.kind).toBe("long-term");
    expect(recentChangeLines(after)[0]).toBe(`- 2026-11-08 · moved ${working.name}: working → long-term`);
    expect((await loadKeeperState(statePath)).week).toEqual({ key: "2026-11-08", changes: 3 });
  });

  it("the daily wake makes no model call and no vault write", async () => {
    const { engine, check } = await setup("2026-11-09");
    const head = (await simpleGit(await check()).revparse(["HEAD"])).trim();
    const wake = await engine.keeperDaily!();
    expect(wake).toMatchObject({ day: "2026-11-09", modelCalls: 0, earlyDigestion: false, indexChanged: null });
    expect(wake.ownCapturesSinceDigestion).toBe(5);
    expect((await simpleGit(await check()).revparse(["HEAD"])).trim()).toBe(head);
  });
});
