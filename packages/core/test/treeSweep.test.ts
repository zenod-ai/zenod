import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { assertSweepChangesSafe, runTreeSweep, TREE_SWEEP_REPORT_PATH } from "../src/engine/treeSweep.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";
import type { BrainLlm } from "../src/llm/types.js";

/**
 * EPIC-9 E9-2d: the weekly tree sweep on a fixture vault (made-up topics, no
 * real captures): one stale working root, one fresh one, a duplicate title,
 * and four pending receipts of different shapes.
 */
const NODES: SeedNode[] = [
  { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden: seeds, beds and watering." },
  { name: "Old trip", kind: "working", path: "Projects/Old trip.md", summary: "Planning a trip to Lisbon: flights and hotels." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: insurance, kitchen, recipes and travel documents." },
];

const CONFIG = "schema_version: 1\ntags:\n  - home\n  - travel\nconfidence_threshold: 0.7\n";
const INDEX = "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n";

const page = (title: string, parent: string, body: string, created = "2026-08-01") => [
  "---", `title: ${title}`, "type: note", "tags: []", `created: ${created}`, `updated: ${created}`,
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "", "See [[Index]].", "",
].join("\n");

const logEntry = (time: string, anchor: string, text: string) =>
  `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;

const LOGS: Record<string, string> = {
  "Log/2026-10-20.md": `# 2026-10-20\n\n${logEntry("09:00", "e-111111", "Grandma's tomato soup recipe")}\n- filed: [[Notes/Recipes]] (Long-term › Life admin › Recipes)\n`,
  "Log/2026-10-21.md": `# 2026-10-21\n\n${logEntry("10:00", "e-222222", "Buy tomato seeds for the garden beds before spring")}`,
  "Log/2026-10-22.md": `# 2026-10-22\n\n${logEntry("11:00", "e-444444", "Something about the watering timer for the garden")}`,
  "Log/2026-10-25.md": `# 2026-10-25\n\n${logEntry("12:00", "e-555555", "Raised beds built")}`,
  "Log/2026-11-02.md": `# 2026-11-02\n\n${logEntry("08:00", "e-333333", "Fresh capture still settling")}`,
};

const receipt = (ref: string, outcomes: unknown[]) => [
  "---", "status: filing-record", `evidence: ${JSON.stringify(ref)}`, "---", "", "# Topic filing receipt", "",
  "```json", JSON.stringify(outcomes, null, 2), "```", "",
].join("\n");

function fixtureFiles(): Array<{ path: string; content: string }> {
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: INDEX },
    ...seedTreeFiles(NODES, "2026-08-01"),
    { path: "Notes/Raised beds.md", content: page("Raised beds", "Projects/Garden", "- Built the beds ([[2026-10-25#^e-555555]]).") },
    { path: "Notes/Recipes.md", content: page("Recipes", "Areas/Life admin", "- Soup ([[2026-10-20#^e-111111]]).") },
    { path: "Notes/Kitchen/Recipes.md", content: page("Recipes", "Areas/Life admin", "- Older recipe list.") },
    ...Object.entries(LOGS).map(([path, content]) => ({ path, content })),
    { path: "_attachments/voice-1.txt", content: "raw bytes stand-in" },
    // a: already filed on a placed page → archived
    { path: "Inbox/filing-2026-10-20-e-111111.md", content: receipt("Log/2026-10-20.md#^e-111111", [{ topic: "recipes", status: "filed", filedPages: ["Notes/Recipes.md"] }]) },
    // b: no page → provisional leaf under the closest node
    { path: "Inbox/filing-2026-10-21-e-222222.md", content: receipt("Log/2026-10-21.md#^e-222222", [{ topic: "garden", status: "uncertain", reason: "low confidence", filedPages: [] }]) },
    // c: too recent → left alone
    { path: "Inbox/filing-2026-11-02-e-333333.md", content: receipt("Log/2026-11-02.md#^e-333333", [{ topic: "x", status: "pending", filedPages: [] }]) },
    // d: a needs-filing stub
    { path: "Inbox/needs-filing-2026-10-22T11-00-00.md", content: ["---", "status: needs-filing", 'question: "Which project?"', 'evidence: "Log/2026-10-22.md#^e-444444"', "---", "", "Something about the watering timer for the garden", ""].join("\n") },
  ];
}

async function writeFixture(root: string): Promise<void> {
  for (const file of fixtureFiles()) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
}

async function snapshotRaw(root: string, prefix: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of fixtureFiles().filter(f => f.path.startsWith(prefix))) out[file.path] = await readFile(join(root, file.path), "utf8");
  return out;
}

class NoLlm implements BrainLlm {
  async classify(): Promise<never> { throw new Error("the sweep uses no LLM"); }
  async composePage(): Promise<never> { throw new Error("the sweep uses no LLM"); }
  async answer(): Promise<never> { throw new Error("the sweep uses no LLM"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("the sweep uses no LLM"); }
  async extractBacklog(): Promise<never> { throw new Error("the sweep uses no LLM"); }
}

describe("E9-2d weekly tree sweep", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e92d-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("proposes closure for a stale working root, re-files receipts, proposes merges, and keeps lint clean", async () => {
    await writeFixture(dir);
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);
    const logsBefore = await snapshotRaw(dir, "Log/");
    const attachmentsBefore = await snapshotRaw(dir, "_attachments/");
    const filesBefore = await listMarkdownFiles(dir);

    const report = await runTreeSweep(dir, { today: "2026-11-02", discover: false });

    // Stale roots: only "Old trip" (Garden has a capture 8 days ago through its child).
    expect(report.staleRoots.map(r => r.name)).toEqual(["Old trip"]);
    expect(report.staleRoots[0]!.lastCapture).toBe("2026-08-01");
    expect(report.counts.workingRoots).toBe(2);
    // Never moved: the root is still a working node in Tree.md.
    const index = await buildTreeIndex(dir);
    expect(index.tree!.nodes.find(n => n.name === "Old trip")!.kind).toBe("working");

    // Duplicates: one merge proposal, nothing merged.
    expect(report.duplicates).toEqual([{ title: "Recipes", keep: "Notes/Recipes.md", fold: ["Notes/Kitchen/Recipes.md"] }]);
    expect(await readFile(join(dir, "Notes/Kitchen/Recipes.md"), "utf8")).toContain("Older recipe list");

    // Receipts.
    const byPath = Object.fromEntries(report.receipts.map(r => [r.path, r]));
    expect(byPath["Inbox/filing-2026-10-20-e-111111.md"]!.outcome).toBe("archived");
    expect(byPath["Inbox/filing-2026-10-21-e-222222.md"]!.outcome).toBe("refiled");
    expect(byPath["Inbox/filing-2026-11-02-e-333333.md"]!.outcome).toBe("skipped");
    expect(byPath["Inbox/needs-filing-2026-10-22T11-00-00.md"]!.outcome).toBe("refiled");
    expect(report.counts).toMatchObject({ receiptsSeen: 4, receiptsRefiled: 2, receiptsArchived: 1, receiptsSkipped: 1, duplicateGroups: 1, staleRoots: 1, proposals: 2 });

    // The re-filed capture is a provisional leaf under Garden, citing its Log entry.
    const leafPath = byPath["Inbox/filing-2026-10-21-e-222222.md"]!.pages![0]!;
    const lineage = (await buildTreeIndex(dir)).lineage(leafPath);
    expect(lineage.ok && lineage.root.name).toBe("Garden");
    expect(await readFile(join(dir, leafPath), "utf8")).toContain("[[2026-10-21#^e-222222]]");

    // Never delete: every original receipt's bytes now sit under Archive/Inbox/.
    for (const file of fixtureFiles().filter(f => f.path.startsWith("Inbox/") && f.path !== "Inbox/filing-2026-11-02-e-333333.md")) {
      const result = byPath[file.path]!;
      expect(await readFile(join(dir, result.archivedTo!), "utf8")).toBe(file.content);
    }
    const filesAfter = await listMarkdownFiles(dir);
    for (const path of filesBefore) {
      if (!path.startsWith("Inbox/")) expect(filesAfter, path).toContain(path);
    }

    // Log/ and _attachments/ untouched, byte for byte.
    expect(await snapshotRaw(dir, "Log/")).toEqual(logsBefore);
    expect(await snapshotRaw(dir, "_attachments/")).toEqual(attachmentsBefore);
    expect(report.changedPaths.some(p => p.startsWith("Log/") || p.startsWith("_attachments/"))).toBe(false);

    // One proposals page with one line per proposal.
    const proposals = await readFile(join(dir, TREE_SWEEP_REPORT_PATH), "utf8");
    expect(proposals.split("\n").filter(l => l.startsWith("- Close "))).toHaveLength(1);
    expect(proposals.split("\n").filter(l => l.startsWith("- Merge "))).toHaveLength(1);

    // Lint after: 0 tree errors.
    expect(report.counts.treeLintErrorsAfter).toBe(0);
    expect((await lintTree(dir)).issues.filter(i => i.severity === "error")).toEqual([]);
  });

  it("is a no-op on a vault without Tree.md", async () => {
    await mkdir(join(dir, "Inbox"), { recursive: true });
    await writeFile(join(dir, "Inbox/filing-2026-10-20-e-111111.md"), receipt("Log/2026-10-20.md#^e-111111", []));
    const report = await runTreeSweep(dir, { today: "2026-11-02", discover: false });
    expect(report.hasTree).toBe(false);
    expect(report.changedPaths).toEqual([]);
  });

  it("writes no proposals page when it only archives receipts", async () => {
    await writeFixture(dir);
    await rm(join(dir, "Notes/Kitchen/Recipes.md"));
    const report = await runTreeSweep(dir, { today: "2026-11-02", staleDays: 1000, discover: false });
    expect(report.counts.proposals).toBe(0);
    expect(report.counts.receiptsArchived + report.counts.receiptsRefiled).toBeGreaterThan(0);
    expect(await readFile(join(dir, TREE_SWEEP_REPORT_PATH), "utf8").catch(() => null)).toBeNull();
  });

  it("skips receipts whose filing job is still queued", async () => {
    await writeFixture(dir);
    const report = await runTreeSweep(dir, { today: "2026-11-02", discover: false, skipEvidenceRefs: new Set(["Log/2026-10-21.md#^e-222222"]) });
    expect(report.receipts.find(r => r.path === "Inbox/filing-2026-10-21-e-222222.md")!.outcome).toBe("skipped");
  });

  it("refuses a change set that deletes or touches evidence", () => {
    expect(() => assertSweepChangesSafe([{ path: "Log/2026-10-20.md", before: "a", after: "a\nb" }])).toThrow(/touched_evidence/);
    expect(() => assertSweepChangesSafe([{ path: "Notes/Recipes.md", before: "a", after: null }])).toThrow(/delete_refused/);
    expect(() => assertSweepChangesSafe([{ path: "Inbox/filing-2026-10-20-e-111111.md", before: "r", after: null }])).toThrow(/delete_refused/);
    expect(() => assertSweepChangesSafe([
      { path: "Inbox/filing-2026-10-20-e-111111.md", before: "r", after: null },
      { path: "Archive/Inbox/filing-2026-10-20-e-111111.md", before: null, after: "r" },
    ])).not.toThrow();
  });

  it("engine.sweepTree publishes ONE revertable commit, then is idempotent", async () => {
    const bare = join(dir, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    await writeFixture(seed);
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");
    const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    const engine = createEngine({ repo, llm: new NoLlm(), state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-02T03:00:00Z") });

    const work = simpleGit(repo.path);
    const before = (await work.revparse(["HEAD"])).trim();
    const first = await engine.sweepTree!();
    expect(first.committed).toBe(true);
    expect(first.report.counts.receiptsRefiled).toBe(2);
    const after = (await work.revparse(["HEAD"])).trim();
    expect((await work.raw(["rev-list", "--count", `${before}..${after}`])).trim()).toBe("1");
    const changed = (await work.raw(["diff", "--name-status", "-M", before, after])).trim().split("\n");
    expect(changed.some(line => /\t(Log|_attachments)\//.test(line))).toBe(false);
    expect(changed.some(line => line.startsWith("D\t"))).toBe(false);
    // Published to the vault's origin.
    expect((await simpleGit(bare).revparse(["main"])).trim()).toBe(after);

    // Nothing new to do: no second commit.
    const second = await engine.sweepTree!();
    expect(second.committed).toBe(false);
    expect((await work.revparse(["HEAD"])).trim()).toBe(after);

    // One `git revert` restores the pre-sweep tree exactly.
    await work.addConfig("user.name", "t").addConfig("user.email", "t@test");
    await work.raw(["revert", "--no-edit", after]);
    expect((await work.raw(["diff", "--stat", before, "HEAD"])).trim()).toBe("");
  });
});
