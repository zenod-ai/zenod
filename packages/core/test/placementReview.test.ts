import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { CORRECTIONS_PATH, readFilingConfidences } from "../src/engine/placementReview.js";
import { filedTarget, placementConfidence } from "../src/engine/treePlacement.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { buildTreeIndex, formatLineage } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import type { BrainLlm } from "../src/llm/types.js";
import { renderTreeFile } from "../src/vault/treeSeed.js";

/**
 * E12-S27: on the tree in the app, the person confirms where a page sits or moves it; each is ONE
 * commit with a correction record in the S6 landing feedback shape, no model call, and Undo puts it
 * back. New filings carry how sure Zenod was; the review lists the least sure first.
 */

class NoModel implements BrainLlm {
  calls = 0;
  private no(): never { this.calls++; throw new Error("no model call expected"); }
  async classify(): Promise<never> { return this.no(); }
  async composePage(): Promise<never> { return this.no(); }
  async answer(): Promise<never> { return this.no(); }
  async describeImage(): Promise<string> { return this.no(); }
  async work(): Promise<never> { return this.no(); }
  async extractBacklog(): Promise<never> { return this.no(); }
  async streamMemoryChat(): Promise<string> { return this.no(); }
}

const page = (title: string, parent: string, body: string, memory?: string) => [
  "---", `title: ${title}`, "type: project", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, ...(memory ? [`memory: ${memory}`] : []), "---", "", `# ${title}`, "", body, "",
].join("\n");

/** The memory desk's made-up vault (memoryDesk.test.ts), boat and cabin under one topic. */
const KNOTTED_VAULT: Record<string, string> = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
  "Tree.md": renderTreeFile([
    { name: "Boat and cabin", kind: "long-term", path: "Projects/Boat repair.md", summary: "The boat hull repair and the cabin purchase decision." },
    { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden." },
  ], "2026-08-01"),
  "Projects/Boat repair.md": page("Boat repair", "Tree", "Hull repair at the yard.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]", "long-term"),
  "Projects/Hull quotes.md": page("Hull quotes", "Projects/Boat repair", "Two quotes for the hull.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]"),
  "Projects/Cabin decision.md": page("Cabin decision", "Projects/Boat repair", "Buying the cabin by the lake or not."),
  "Projects/Oakmere survey.md": page("Oakmere survey", "Projects/Cabin decision", "The survey of the Oakmere cabin."),
  "Projects/Garden.md": page("Garden", "Tree", "Raised beds and seeds.", "working"),
  "Log/2026-10-01.md": "# 2026-10-01\n\n## 09:00 Hull quotes  ^e-111111\n- source: whatsapp\n- verbatim: yes\n\n> Hull quotes from two yards came in\n",
};

const provisionalNote = [
  "---", "title: Seed potatoes", "type: note", "tags: []", "created: 2026-11-05", "updated: 2026-11-05",
  "summary: \"Provisional: buy seed potatoes\"", "parent: \"[[Projects/Boat repair]]\"", "provisional: true", "---", "",
  "# Seed potatoes", "", "> Buy seed potatoes for the beds [[2026-11-05#^e-555555]]", "",
].join("\n");

const VAULT: Record<string, string> = {
  ...KNOTTED_VAULT,
  "Notes/Seed potatoes.md": provisionalNote,
  "Log/2026-11-05.md": "# 2026-11-05\n\n## 09:00 Buy seed potatoes  ^e-555555\n- source: whatsapp\n- verbatim: yes\n\n> Buy seed potatoes for the beds\n"
    + "- filed: [[Notes/Seed potatoes]] (Long-term › Boat and cabin › Seed potatoes) · provisional · 23% sure\n",
  "Log/2026-11-06.md": "# 2026-11-06\n\n## 09:00 Hull quote three  ^e-666666\n- source: whatsapp\n- verbatim: yes\n\n> A third hull quote\n"
    + "- filed: [[Projects/Hull quotes]] (Long-term › Boat and cabin › Hull quotes) · 81% sure\n",
};

async function gitVault(dir: string, files: Record<string, string>) {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(seed, path)), { recursive: true });
    await writeFile(join(seed, path), content);
  }
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("seed vault");
  await git.push("origin", "main");
  const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
  return { repo, work: simpleGit(repo.path) };
}

const placeOf = async (root: string, path: string) => {
  const lineage = (await buildTreeIndex(root)).lineage(path);
  return lineage.ok ? formatLineage(lineage) : lineage.reason;
};

describe("E12-S27 reclassify on the tree, confidence per filing", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e12s27-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("scores a filing from what it already knows, and writes it on the filed line", () => {
    expect(placementConfidence(0.9, "in_tree")).toBe(90);
    expect(placementConfidence(0.9, "hung")).toBe(77);
    expect(placementConfidence(0.9, "hung_weak")).toBe(45);
    expect(placementConfidence(undefined, "leaf")).toBe(23);
    expect(placementConfidence(7, "in_tree")).toBe(100);
    expect(filedTarget({ path: "Notes/A.md", lineage: "Working › A", confidence: 64 })).toBe("[[Notes/A]] (Working › A) · 64% sure");
    expect(filedTarget({ path: "Projects/X.md", rollup: true, confidence: 64 })).toBe("[[Projects/X]] · ops rollup");
  });

  it("lists the least sure filing first, then older provisional pages; confirm and move are ONE commit each, Log untouched, no model; Undo puts a move back", async () => {
    const { repo, work } = await gitVault(dir, VAULT);
    const llm = new NoModel();
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-09T06:00:00Z") });

    expect((await readFilingConfidences(repo.path)).map((f) => [f.path, f.confidence])).toEqual([["Projects/Hull quotes.md", 81], ["Notes/Seed potatoes.md", 23]]);
    const review = await engine.placementReview!();
    expect(review.items.map((item) => [item.title, item.confidence])).toEqual([["Seed potatoes", 23], ["Hull quotes", 81]]);
    expect(review).toMatchObject({ total: 2, scored: 2, low: 1, checked: { confirmed: 0, moved: 0 } });
    expect(review.items[0]).toMatchObject({ place: "Long-term › Boat and cabin › Seed potatoes", provisional: true, evidenceRef: "Log/2026-11-05.md#^e-555555" });

    // Wrong place: the potatoes belong under Garden.
    const start = (await work.revparse(["HEAD"])).trim();
    const moved = await engine.correctPlacement!({ page: "Notes/Seed potatoes.md", to: "Projects/Garden.md" });
    expect(moved).toMatchObject({ action: "move", title: "Seed potatoes", before: "Long-term › Boat and cabin › Seed potatoes", after: "Working › Garden › Seed potatoes" });
    const head = (await work.revparse(["HEAD"])).trim();
    expect((await work.raw(["rev-list", "--count", `${start}..${head}`])).trim()).toBe("1");
    expect((await work.raw(["log", "-1", "--format=%s"])).trim()).toBe("memory: you moved Seed potatoes under Garden");
    expect((await work.raw(["diff", "--name-only", start, head])).trim().split("\n").sort()).toEqual([CORRECTIONS_PATH, "Notes/Seed potatoes.md"]);
    const note = await readFile(join(repo.path, "Notes/Seed potatoes.md"), "utf8");
    expect(note).toContain('parent: "[[Projects/Garden]]"');
    expect(note).not.toContain("provisional");
    expect(note).toContain("> Buy seed potatoes for the beds");
    expect((await lintTree(repo.path)).issues.filter((i) => i.severity === "error")).toEqual([]);

    // The correction is an S6 landing feedback record.
    const record = JSON.parse((await readFile(join(repo.path, CORRECTIONS_PATH), "utf8")).trim());
    expect(record).toMatchObject({ type: "answer", source: "app", action: "move", note_id: "555555", memory_id: "Notes/Seed potatoes.md",
      zenod_page: "Seed potatoes", zenod_parent: "Boat and cabin", verdict: "no", moved_to: "Garden", confidence: 23,
      correction: "wrong parent: moved from Boat and cabin to Garden" });

    // Right place: the hull quotes stay. Checked pages leave the list.
    const confirmed = await engine.correctPlacement!({ page: "Projects/Hull quotes.md" });
    expect(confirmed.action).toBe("confirm");
    expect((await work.raw(["log", "-1", "--format=%s"])).trim()).toBe("memory: you confirmed Hull quotes");
    const after = await engine.placementReview!();
    expect(after.items).toEqual([]);
    expect(after.checked).toEqual({ confirmed: 1, moved: 1 });
    expect(after.recent[0]).toMatchObject({ id: moved.id, title: "Seed potatoes", from: "Boat and cabin", to: "Garden", undone: false });

    // Undo the move: back where it was, provisional again, and on the list again.
    const undo = await engine.undoPlacementCorrection!({ id: moved.id });
    expect(undo.action).toBe("undo");
    expect((await work.raw(["log", "-1", "--format=%s"])).trim()).toBe("memory: undo move of Seed potatoes");
    expect(await placeOf(repo.path, "Notes/Seed potatoes.md")).toBe("Long-term › Boat and cabin › Seed potatoes");
    expect(await readFile(join(repo.path, "Notes/Seed potatoes.md"), "utf8")).toBe(provisionalNote);
    expect((await engine.placementReview!()).items.map((i) => i.title)).toEqual(["Seed potatoes"]);
    await expect(engine.undoPlacementCorrection!({ id: moved.id })).rejects.toThrow(/already undone/);

    // The Log never changed and no model was called.
    expect((await work.raw(["diff", start, "HEAD", "--", "Log"])).trim()).toBe("");
    expect(llm.calls).toBe(0);
  });

  it("moves a page whose child already had a tree problem: an old problem is no reason to refuse", async () => {
    const kid = page("Kid notes", "Projects/Hull quotes", "A child page.").replace("type: project", "type: project\nmemory: banana");
    const { repo } = await gitVault(dir, { ...VAULT, "Projects/Kid notes.md": kid });
    const engine = createEngine({ repo, llm: new NoModel(), state: new SqliteStateStore(":memory:") });
    expect((await lintTree(repo.path)).issues.filter((i) => i.severity === "error").map((i) => i.rule)).toEqual(["page/memory-invalid"]);
    const moved = await engine.correctPlacement!({ page: "Projects/Hull quotes.md", to: "Projects/Garden.md" });
    expect(moved.after).toBe("Working › Garden › Hull quotes");
    expect(await placeOf(repo.path, "Projects/Kid notes.md")).toBe("Working › Garden › Hull quotes › Kid notes");
  });

  it("refuses a move under itself or to a page not in the tree, changing nothing", async () => {
    const { repo, work } = await gitVault(dir, VAULT);
    const engine = createEngine({ repo, llm: new NoModel(), state: new SqliteStateStore(":memory:") });
    const start = (await work.revparse(["HEAD"])).trim();
    await expect(engine.correctPlacement!({ page: "Projects/Cabin decision.md", to: "Projects/Oakmere survey.md" })).rejects.toThrow(/cannot go under itself/);
    await expect(engine.correctPlacement!({ page: "Projects/Nowhere.md", to: "Projects/Garden.md" })).rejects.toThrow(/not a page in your tree/);
    expect((await work.revparse(["HEAD"])).trim()).toBe(start);
    expect((await work.status()).files).toEqual([]);
  });
});
