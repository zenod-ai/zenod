import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { checkDeskChanges, nameFitsPage, runDeskAgent, type DeskReadTools } from "../src/engine/memoryDesk.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { buildTreeIndex, formatLineage } from "../src/vault/tree.js";
import { lintTree } from "../src/vault/treeLint.js";
import { renderTreeFile } from "../src/vault/treeSeed.js";
import type { BrainLlm } from "../src/llm/types.js";

/**
 * EPIC-14 S3, the memory desk, on a made-up vault with the EPIC-19 knot: two subjects ("Boat
 * repair" and "Cabin decision") hang under one shared topic, the Cabin page sits under the Boat
 * page, and a weekly sweep copied a boat note onto the cabin page. The model is scripted.
 */

const page = (title: string, parent: string, body: string, memory?: string) => [
  "---", `title: ${title}`, "type: project", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, ...(memory ? [`memory: ${memory}`] : []), "---", "", `# ${title}`, "", body, "",
].join("\n");

const logEntry = (anchor: string, text: string) => `## 09:00 ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;

export const KNOTTED_VAULT: Record<string, string> = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
  "Tree.md": renderTreeFile([
    { name: "Boat and cabin", kind: "long-term", path: "Projects/Boat repair.md", summary: "The boat hull repair and the cabin purchase decision." },
    { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden." },
  ], "2026-08-01"),
  "Projects/Boat repair.md": page("Boat repair", "Tree", "Hull repair at the yard.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]", "long-term"),
  "Projects/Hull quotes.md": page("Hull quotes", "Projects/Boat repair", "Two quotes for the hull.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]"),
  "Projects/Cabin decision.md": page("Cabin decision", "Projects/Boat repair", "Buying the cabin by the lake or not.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]"),
  "Projects/Oakmere survey.md": page("Oakmere survey", "Projects/Cabin decision", "The survey of the Oakmere cabin.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]"),
  "Projects/Garden.md": page("Garden", "Tree", "Raised beds and seeds.", "working"),
  "Log/2026-10-01.md": `# 2026-10-01\n\n${logEntry("e-111111", "Hull quotes from two yards came in")}`,
  "Log/2026-10-02.md": `# 2026-10-02\n\n${logEntry("e-222222", "The yard can start the boat in March")}`,
  "Log/2026-10-03.md": `# 2026-10-03\n\n${logEntry("e-333333", "Oakmere cabin survey booked for Friday")}`,
};

export const UNTANGLE_PLAN = {
  done: true,
  title: "Split Boat repair and Cabin decision",
  summary: "Two topics again: the cabin gets its own topic and the boat note copied onto it is taken off.",
  search: "cabin",
  changes: [
    { op: "rename", page: "Projects/Boat repair.md", name: "Boat repair", summary: "The boat hull repair at the yard." },
    { op: "root", page: "Projects/Cabin decision.md", name: "Cabin decision", kind: "long-term", summary: "Whether to buy the cabin by the lake." },
    { op: "unlink", from: "Projects/Cabin decision.md", to: "2026-10-02#^e-222222" },
  ],
};

async function writeVault(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

class ScriptedLlm implements BrainLlm {
  calls: Array<{ system: string; prompt: string }> = [];
  constructor(private readonly replies: string[]) {}
  async classify(): Promise<never> { throw new Error("no filing here"); }
  async composePage(): Promise<never> { throw new Error("no filing here"); }
  async answer(): Promise<never> { throw new Error("no ask here"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("no work loop here"); }
  async extractBacklog(): Promise<never> { throw new Error("no backlog here"); }
  async streamMemoryChat(input: { system: string; prompt: string }): Promise<string> {
    this.calls.push(input);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("the script ran out");
    return reply;
  }
}

const SCRIPT = () => [
  JSON.stringify({ tool: "tree" }),
  JSON.stringify({ tool: "read", page: "Projects/Cabin decision.md" }),
  JSON.stringify(UNTANGLE_PLAN),
];

async function gitVault(dir: string, files: Record<string, string>) {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  await writeVault(seed, files);
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("seed vault");
  await git.push("origin", "main");
  const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
  return { bare, repo, work: simpleGit(repo.path) };
}

const places = async (root: string) => {
  const index = await buildTreeIndex(root);
  return Object.fromEntries([...index.fields.keys()].sort().map((path) => {
    const lineage = index.lineage(path);
    return [path, lineage.ok ? formatLineage(lineage) : lineage.reason];
  }));
};

describe("EPIC-14 S3 memory desk", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e14s3-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("the agent reads with its tools, reports each step, and returns a plan within its step cap", async () => {
    const llm = new ScriptedLlm(SCRIPT());
    const steps: string[] = [];
    const used: string[] = [];
    const tools: DeskReadTools = {
      tree: async () => { used.push("tree"); return "- Boat and cabin | long-term | Projects/Boat repair.md | 3 pages under it"; },
      read: async (p) => { used.push(`read ${p}`); return "title: Cabin decision"; },
      search: async () => "", children: async () => "", links: async () => "",
    };
    const outcome = await runDeskAgent({ request: "Boat and cabin are tangled, split them", call: (input) => llm.streamMemoryChat(input), tools, onStep: (s) => steps.push(s) });
    expect(outcome.status).toBe("plan");
    if (outcome.status !== "plan") return;
    expect(outcome.steps).toBe(3);
    expect(outcome.plan.changes).toHaveLength(3);
    expect(used).toEqual(["tree", "read Projects/Cabin decision.md"]);
    expect(steps).toEqual(["Reading your topics", "Reading Cabin decision"]);
    // The second call carries what the first tool returned.
    expect(llm.calls[1]!.prompt).toContain("3 pages under it");
    expect(llm.calls[0]!.system).toContain("never rewrite the person's words and never delete");
  });

  it("a plan whose topic name does not fit its page goes back to the model, which fixes it", async () => {
    const { repo } = await gitVault(dir, KNOTTED_VAULT);
    const wrong = { ...UNTANGLE_PLAN, changes: [{ op: "rename", page: "Projects/Boat repair.md", name: "Cabin decision" }] };
    const llm = new ScriptedLlm([JSON.stringify(wrong), JSON.stringify(UNTANGLE_PLAN)]);
    const steps: string[] = [];
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
    const result = await engine.deskJob!({ request: "split boat and cabin", onStep: (s) => steps.push(s) });
    expect(result.status).toBe("done");
    expect(llm.calls[1]!.prompt).toContain('the name "Cabin decision" does not fit the page it sits on, "Boat repair"');
    expect(steps[0]).toBe("Checking the plan again");
    expect(result.agent.steps).toBe(2);
  });

  it("stops at the step cap and on the model's refusal, never half done", async () => {
    const tools: DeskReadTools = { tree: async () => "t", read: async () => "", search: async () => "", children: async () => "", links: async () => "" };
    const looping = new ScriptedLlm(Array(10).fill(JSON.stringify({ tool: "tree" })));
    const capped = await runDeskAgent({ request: "tidy everything", call: (i) => looping.streamMemoryChat(i), tools, maxSteps: 4 });
    expect(capped.status).toBe("refused");
    expect(looping.calls).toHaveLength(4);
    expect(looping.calls[3]!.prompt).toContain("This is your last step");
    const refusing = new ScriptedLlm([JSON.stringify({ refuse: "Deleting is always a question in your inbox first." })]);
    const refused = await runDeskAgent({ request: "delete all my cabin notes", call: (i) => refusing.streamMemoryChat(i), tools });
    expect(refused).toMatchObject({ status: "refused", reason: "Deleting is always a question in your inbox first." });
    const budget = new ScriptedLlm(Array(10).fill(JSON.stringify({ tool: "tree" })));
    const spent = await runDeskAgent({ request: "x", call: (i) => budget.streamMemoryChat(i), tools, maxInputChars: 5_000 });
    expect(spent.status).toBe("refused");
    expect(budget.calls.length).toBeLessThan(3);
  });

  it("untangles the knot as ONE commit: Log untouched, nothing deleted or rewritten, search before and after; Undo puts it back exactly", async () => {
    const { bare, repo, work } = await gitVault(dir, KNOTTED_VAULT);
    const llm = new ScriptedLlm(SCRIPT());
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-08T12:00:00Z"), memoryIndex: { path: join(dir, "memory-index.sqlite"), tenantId: "demo" } });
    const placesBefore = await places(repo.path);
    expect(placesBefore["Projects/Oakmere survey.md"]).toBe("Long-term › Boat and cabin › Cabin decision › Oakmere survey");
    const start = (await work.revparse(["HEAD"])).trim();
    const steps: string[] = [];

    const result = await engine.deskJob!({ request: "Boat and cabin are tangled, they are two separate things, please split them", onStep: (s) => steps.push(s) });
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    const head = (await work.revparse(["HEAD"])).trim();
    expect((await work.raw(["rev-list", "--count", `${start}..${head}`])).trim()).toBe("1");
    expect((await work.raw(["log", "-1", "--format=%s"])).trim()).toBe("memory desk: Split Boat repair and Cabin decision");
    const changed = (await work.raw(["diff", "--name-status", start, head])).trim().split("\n");
    expect(changed.sort()).toEqual(["M\tProjects/Cabin decision.md", "M\tTree.md"]);
    expect((await simpleGit(bare).revparse(["main"])).trim()).toBe(head);

    const placesAfter = await places(repo.path);
    expect(placesAfter["Projects/Cabin decision.md"]).toBe("Long-term › Cabin decision");
    expect(placesAfter["Projects/Oakmere survey.md"]).toBe("Long-term › Cabin decision › Oakmere survey");
    expect(placesAfter["Projects/Hull quotes.md"]).toBe("Long-term › Boat repair › Hull quotes");
    expect(result.touched).toBe(4);
    expect(result.changes.map((c) => c.what)).toEqual([
      "Topic renamed", "Cabin decision became its own topic", "A note line taken off Cabin decision, still filed elsewhere",
    ]);
    expect(result.search.query).toBe("cabin");
    expect(result.search.before.join(" ")).toContain("Boat and cabin");
    expect(result.search.after.join(" ")).not.toContain("Boat and cabin");
    expect(steps).toEqual(["Reading your topics", "Reading Cabin decision", "Making 3 changes"]);
    const cabin = await readFile(join(repo.path, "Projects/Cabin decision.md"), "utf8");
    expect(cabin).toContain("Buying the cabin by the lake or not.");
    expect(cabin).not.toContain("e-222222");
    expect((await lintTree(repo.path)).issues.filter((i) => i.severity === "error")).toEqual([]);

    // Something else lands on the cabin page after the job: Undo still puts the job's edits back.
    await writeFile(join(repo.path, "Projects/Oakmere survey.md"), `${await readFile(join(repo.path, "Projects/Oakmere survey.md"), "utf8")}\nMore survey notes.\n`);
    await work.addConfig("user.name", "t").addConfig("user.email", "t@test");
    await work.add(["-A"]);
    await work.commit("a later filing");
    await work.push("origin", "main");

    const undone = await engine.undoDeskJob!({ title: result.plan.title, edits: result.edits });
    expect(undone.skipped).toBe(0);
    expect(undone.revision).not.toBeNull();
    expect((await work.raw(["log", "-1", "--format=%s"])).trim()).toBe("memory desk: undo Split Boat repair and Cabin decision");
    expect(await places(repo.path)).toEqual(placesBefore);
    expect((await work.raw(["diff", start, "HEAD", "--", "Tree.md", "Projects/Cabin decision.md"])).trim()).toBe("");
  });

  it("a job touching more memories than the cap is put back and waits for a yes; the approved plan then runs", async () => {
    const { repo, work } = await gitVault(dir, KNOTTED_VAULT);
    const engine = createEngine({ repo, llm: new ScriptedLlm(SCRIPT()), state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-08T12:00:00Z") });
    const start = (await work.revparse(["HEAD"])).trim();
    const big = await engine.deskJob!({ request: "split boat and cabin", maxTouched: 2 });
    expect(big.status).toBe("needs_go");
    if (big.status !== "needs_go") return;
    expect(big.touched).toBe(4);
    expect(big.changes).toHaveLength(3);
    expect((await work.revparse(["HEAD"])).trim()).toBe(start);
    expect((await work.status()).isClean()).toBe(true);

    const go = await engine.deskJob!({ request: "split boat and cabin", plan: big.plan, maxTouched: Number.POSITIVE_INFINITY });
    expect(go.status).toBe("done");
    expect(go.agent.steps).toBe(0);
  });

  it("a change that does not fit the memory stops the job before anything is written", async () => {
    const { repo, work } = await gitVault(dir, KNOTTED_VAULT);
    const engine = createEngine({ repo, llm: new ScriptedLlm([]), state: new SqliteStateStore(":memory:") });
    const start = (await work.revparse(["HEAD"])).trim();
    const plan = (changes: unknown[]) => ({ ...UNTANGLE_PLAN, changes } as never);
    // Plans given straight to the apply step (as an approved plan is): the host still checks each change.
    await expect(engine.deskJob!({ request: "x", plan: plan([UNTANGLE_PLAN.changes[1], { op: "move", page: "Projects/Nowhere.md", to: "Projects/Garden.md" }]) })).rejects.toThrow(/Nowhere\.md" is not a page in the tree/);
    expect((await work.revparse(["HEAD"])).trim()).toBe(start);
    expect((await work.status()).isClean()).toBe(true);
    await expect(engine.deskJob!({ request: "x", plan: plan([{ op: "move", page: "Projects/Cabin decision.md", to: "Projects/Oakmere survey.md" }]) })).rejects.toThrow(/cannot go under itself/);
    await expect(engine.deskJob!({ request: "x", plan: plan([{ op: "unlink", from: "Projects/Garden.md", to: "2026-10-03#^e-333333" }]) })).rejects.toThrow(/no link line/);
    expect((await work.status()).isClean()).toBe(true);
    // From the agent, a plan that still does not fit on its last step is refused, never applied.
    const stubborn = createEngine({ repo, llm: new ScriptedLlm(Array(3).fill(JSON.stringify({ ...UNTANGLE_PLAN, changes: [{ op: "move", page: "Projects/Nowhere.md", to: "Garden" }] }))), state: new SqliteStateStore(":memory:") });
    const refused = await stubborn.deskJob!({ request: "x", maxSteps: 3 });
    expect(refused.status).toBe("refused");
    expect((await work.revparse(["HEAD"])).trim()).toBe(start);
  });

  it("moves, links and unlinks pages, and refuses a job that only repeats what is there", async () => {
    const { repo } = await gitVault(dir, KNOTTED_VAULT);
    const plan = { ...UNTANGLE_PLAN, title: "Garden under boat", search: "garden", changes: [
      { op: "move", page: "Garden", to: "Projects/Hull quotes.md" },
      { op: "link", from: "Projects/Garden.md", to: "Projects/Oakmere survey.md" },
    ] };
    const engine = createEngine({ repo, llm: new ScriptedLlm([JSON.stringify(plan), JSON.stringify({ ...plan, changes: [{ op: "unlink", from: "Projects/Garden.md", to: "Projects/Oakmere survey.md" }] })]), state: new SqliteStateStore(":memory:") });
    const moved = await engine.deskJob!({ request: "put the garden under hull quotes and link it to the survey" });
    expect(moved.status).toBe("done");
    if (moved.status !== "done") return;
    expect(moved.changes[0]).toEqual({ what: "Garden moved under Hull quotes", before: "Working › Garden", after: "Long-term › Boat and cabin › Hull quotes › Garden" });
    const garden = await readFile(join(repo.path, "Projects/Garden.md"), "utf8");
    expect(garden).toContain('parent: "[[Projects/Hull quotes]]"');
    expect(garden).toContain("memory: long-term");
    expect(garden).toContain("## Related\n\n- [[Projects/Oakmere survey]]");
    expect(await readFile(join(repo.path, "Tree.md"), "utf8")).not.toContain("- Garden |");
    const unlinked = await engine.deskJob!({ request: "unlink garden and the survey" });
    expect(unlinked.status).toBe("done");
    expect(await readFile(join(repo.path, "Projects/Garden.md"), "utf8")).not.toContain("## Related");
  });

  it("a topic's name must share a word with its page", () => {
    expect(nameFitsPage("Poly-Maker", "Poly-Maker Campaign July 2026", "Projects/Poly-Maker Campaign July 2026.md")).toBe(true);
    expect(nameFitsPage("Idealista Data Relationship", "Poly-Maker Campaign July 2026", "Projects/Poly-Maker Campaign July 2026.md")).toBe(false);
    expect(nameFitsPage("Idealista", "Idealista Data Relationship", "Projects/Idealista Data Relationship/Idealista Data Relationship.md")).toBe(true);
  });

  it("the guard refuses rewritten words, deletes, new files, Log changes and other front matter", () => {
    const before = KNOTTED_VAULT["Projects/Cabin decision.md"]!;
    expect(checkDeskChanges([{ path: "Projects/Cabin decision.md", before, after: before.replace('parent: "[[Projects/Boat repair]]"', 'parent: "[[Tree]]"') }])).toEqual([]);
    expect(checkDeskChanges([{ path: "Projects/Cabin decision.md", before, after: `${before}\n## Related\n\n- [[Projects/Garden]]\n` }])).toEqual([]);
    expect(checkDeskChanges([{ path: "Projects/Cabin decision.md", before, after: before.replace("Buying the cabin by the lake or not.", "Buy the cabin.") }]).join()).toMatch(/words were removed/);
    expect(checkDeskChanges([{ path: "Projects/Cabin decision.md", before, after: before.replace("summary: Cabin decision notes.", "summary: Other.") }]).join()).toMatch(/front matter/);
    expect(checkDeskChanges([{ path: "Projects/Cabin decision.md", before, after: null }]).join()).toMatch(/never deletes/);
    expect(checkDeskChanges([{ path: "Projects/New.md", before: null, after: "x" }]).join()).toMatch(/never creates/);
    expect(checkDeskChanges([{ path: "Log/2026-10-01.md", before: "a", after: "b" }]).join()).toMatch(/only the tree and its pages/);
  });
});
