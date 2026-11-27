import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import type { ReconciliationInput, ReconciliationOperation } from "../src/engine/reconciliation.js";
import { isOneOff, pickRootTopic, ROOT_PICK_HINT, TrackedWrites, writeProvisionalLeaf } from "../src/engine/treePlacement.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { BrainLlm, Classification, ClassifyInput } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { lintVault } from "../src/vault/lint.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * E22-S6 (alpha9 E105-S252, Jordi vn_8e8b0693 23 Nov: "Compounding as opposed to diluting, meaning is it kind
 * of growing vertically or is it kind of spreading horizontally?"). The 19 notes of 25-27 Nov that still made a
 * new file, by cause. Each fixture is shaped on one of alpha9's examples (its Log id in the test name), in
 * made-up words: never his vault, never his text.
 */
const ROOTS: SeedNode[] = [
  { name: "Epic Team", kind: "working", path: "Projects/Epic Team.md", summary: "The team app: cards, the inbox, the chat, voice notes and the debriefer." },
  { name: "Housing", kind: "working", path: "Areas/Housing.md", summary: "Where to live and which house to buy: cities, flats, visits." },
  { name: "Epic Social", kind: "working", path: "Projects/Epic Social.md", summary: "The social posting tool: drafts, replies and reach." },
  { name: "Poly-Maker", kind: "long-term", path: "Projects/Poly-Maker Campaign July 2026.md", summary: "The July trading campaign: long positions and the market maker." },
];

async function seed(dir: string, nodes: readonly SeedNode[] = ROOTS): Promise<void> {
  for (const file of seedTreeFiles([...nodes], "2026-11-01")) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.content);
  }
  await mkdir(join(dir, "Notes"), { recursive: true });
}

const point = (content: string, anchor: string, title?: string) =>
  ({ content, evidenceRef: `Log/2026-11-25.md#^${anchor}`, reason: "filing_needs_clarification", today: "2026-11-25", ...(title ? { title } : {}) });

const notesFiles = async (dir: string) => (await readdir(join(dir, "Notes"))).sort();

describe("E22-S6 cause 1: a second point of a note joins the topic the note already went into", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e22s6-1-")); await seed(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("^e-079c02: 'was the record button always there' grows Epic Team, where the note's other points went", async () => {
    const before = await notesFiles(dir);
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      point("Was that button there from the start?", "e-079c02", "The user asks whether the record button was always there"),
      new TrackedWrites(dir), { rootsOnly: true, notePages: ["Projects/Epic Team.md"] });
    expect(out).toMatchObject({ path: "Projects/Epic Team.md", grown: true });
    const raw = await readFile(join(dir, "Projects/Epic Team.md"), "utf8");
    expect(raw).toMatch(/^## 2026-11-25 · .*\[\[2026-11-25#\^e-079c02\]\]$/m);
    expect(raw).toContain("> Was that button there from the start?");
    expect(await notesFiles(dir)).toEqual(before);
  });

  it("^e-95d179: of two pages the note reached, the point grows the closer one", async () => {
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      point("The drafts queue should show the reply count on each post.", "e-95d179", "Unclassified source passage"),
      new TrackedWrites(dir), { rootsOnly: true, notePages: ["Projects/Epic Team.md", "Projects/Epic Social.md"] });
    expect(out).toMatchObject({ path: "Projects/Epic Social.md", grown: true });
  });

  it("^e-11d9c7: a point the word match cannot place still grows the note's own topic (Housing)", async () => {
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      point("I like the direction this is taking.", "e-11d9c7", "The user says they like the direction the search is taking"),
      new TrackedWrites(dir), { rootsOnly: true, notePages: ["Areas/Housing.md", "Log/2026-11-26.md", "Inbox/filing-2026-11-26-e-11d9c7.md"] });
    expect(out).toMatchObject({ path: "Areas/Housing.md", grown: true });
  });

  it("a point with its own subject page keeps it: a note that truly spans two topics grows both", async () => {
    const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir),
      point("The flat in Girona has a garden.", "e-11d9c8"), new TrackedWrites(dir),
      { rootsOnly: true, anchors: ["Areas/Housing.md"], notePages: ["Projects/Epic Team.md"] });
    expect(out?.path).toBe("Areas/Housing.md");
  });
});

describe("E22-S6 cause 2: a note makes at most one new page", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e22s6-2-")); await seed(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("^e-e23bb7: eight points about startup credits make one leaf, the others join it as its sections", async () => {
    const points = [
      ["Research which startup credit programs to apply to.", "Startup credit programs"],
      ["Make each program a key result and track how many turn green.", "Each program a key result"],
      ["Look at the Cloudflare startup program too.", "Cloudflare startup program"],
      ["Create a new objective to get funding for Alpha nine.", "Funding objective"],
    ];
    const made: string[] = [];
    for (const [text, title] of points) {
      const out = await writeProvisionalLeaf(dir, await buildTreeIndex(dir), point(text!, "e-e23bb7", title), new TrackedWrites(dir),
        { rootsOnly: true, notePages: made });
      if (out && !made.includes(out.path)) made.push(out.path);
    }
    const leaves = (await notesFiles(dir));
    expect(leaves).toHaveLength(1);
    expect(made).toEqual([`Notes/${leaves[0]}`]);
    const raw = await readFile(join(dir, made[0]!), "utf8");
    for (const [text] of points) expect(raw).toContain(`> ${text}`);
  });

  it("a leaf of another note is never joined", async () => {
    const first = await writeProvisionalLeaf(dir, await buildTreeIndex(dir), point("Quantum orchestra tuning forks resonate oddly.", "e-aaaaa1"));
    const second = await writeProvisionalLeaf(dir, await buildTreeIndex(dir), point("Glacier violin strings snap in the cold.", "e-aaaaa2"),
      new TrackedWrites(dir), { rootsOnly: true, notePages: [first!.path] });
    expect(second?.path).not.toBe(first!.path);
  });
});

describe("E22-S6 cause 3: a weak word match lets the classifier pick a root topic; fragments stay in the Log", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e22s6-3-")); await seed(dir); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const answer = (path: string | null, confidence = 0.85): Classification => ({
    confidence, summary: "pick", tags: [], pages: [], topics: [{ topic: "pick", summary: "pick", evidenceQuotes: [], confidence,
      disposition: path ? "integrate_page" : "needs_clarification", pages: path ? [{ path, action: "update", title: path }] : [] }] });

  it("^e-053f59: 'the debriefer call cut off' goes to Epic Team, not the campaign it shares a word with", async () => {
    const seen: ClassifyInput[] = [];
    const text = "I just had a long call with the debriefer and it got disconnected; can you see what was saved?";
    const index = await buildTreeIndex(dir);
    const pick = await pickRootTopic(dir, index, { content: text }, async input => { seen.push(input); return answer("Projects/Epic Team.md"); }, { threshold: 0.7 });
    expect(pick).toMatchObject({ path: "Projects/Epic Team.md", weak: false });
    expect(seen[0]!.hints).toEqual([ROOT_PICK_HINT]);
    expect(seen[0]!.pageIndex.map(page => page.path).sort()).toEqual(ROOTS.map(root => root.path).sort());
    const out = await writeProvisionalLeaf(dir, index, point(text, "e-053f59"), new TrackedWrites(dir), { rootsOnly: true, fallback: pick });
    expect(out).toMatchObject({ path: "Projects/Epic Team.md", grown: true });
    expect(await notesFiles(dir)).toEqual([]);
  });

  it("an unsure, unlisted or failed pick is no pick", async () => {
    const index = await buildTreeIndex(dir);
    const text = { content: "The button keeps moving around and I cannot find it." };
    expect(await pickRootTopic(dir, index, text, async () => answer("Projects/Epic Team.md", 0.5), { threshold: 0.7 })).toBeNull();
    expect(await pickRootTopic(dir, index, text, async () => answer("Notes/Something else.md"), { threshold: 0.7 })).toBeNull();
    expect(await pickRootTopic(dir, index, text, async () => answer(null), { threshold: 0.7 })).toBeNull();
    expect(await pickRootTopic(dir, index, text, async () => { throw new Error("provider down"); }, { threshold: 0.7 })).toBeNull();
  });

  it("^e-738ee6: a cut-off fragment is a one-off; a short real point is not", () => {
    expect(isOneOff("Okay, so I'm gonna open the-")).toBe(true);
    expect(isOneOff("Extraction artifact: drive://file/x\n\nOkay, so I'm gonna open the-")).toBe(true);
    expect(isOneOff("So the next thing is…")).toBe(true);
    // The ingest lines of a chat voice note (its app among them) are not the person's words.
    expect(isOneOff('Voice note "chat-voice-note.webm" ingested through Zenod media seam.\nRaw artifact: drive://file/x\nMedia type: audio/webm\n'
      + "Source: EpicTeam Chat voice note\nSource app: EpicTeam Chat\nSource timestamp: 2026-11-25T12:06:39Z\nTranscribed by a model.\n"
      + "Extraction artifact: drive://file/y\n\nOkay, so I'm gonna open the-")).toBe(true);
    expect(isOneOff("Remember the thing about the passport renewal.")).toBe(false);
    expect(isOneOff("Call the notary about the deposit, the bank wants the papers by Friday and-")).toBe(false);
  });
});

/** Engine path: the rescue of an unplaced point (engine.ts, after page filing). */
const CONFIG = "schema_version: 1\ntags:\n  - work\nconfidence_threshold: 0.7\n";
const FILED = "The floating recording pane should show at once when recording starts, not only after scrolling.";
const ASIDE = "Was that button there from the start?";
const DEBRIEF = "I just had a long call with the debriefer and it got disconnected; can you see what was saved?";

async function vaultRepo(dir: string): Promise<VaultRepo> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seedDir = join(dir, "seed");
  await simpleGit().clone(bare, seedDir);
  const files = [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
    { path: "Log/.gitkeep", content: "" }, { path: "Inbox/.gitkeep", content: "" }, { path: "Notes/.gitkeep", content: "" },
    ...seedTreeFiles(ROOTS, "2026-11-01"),
  ];
  for (const file of files) {
    await mkdir(dirname(join(seedDir, file.path)), { recursive: true });
    await writeFile(join(seedDir, file.path), file.content);
  }
  const git = simpleGit(seedDir);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]); await git.commit("seed vault"); await git.push("origin", "main");
  return VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
}

/** Files every topic the classifier gives a page; `rootPick` answers the root-topic pick. */
class ScriptedLlm implements BrainLlm {
  rootPicks: ClassifyInput[] = [];
  constructor(private readonly topics: Classification["topics"], private readonly rootPick: string | null = null) {}
  async classify(input: ClassifyInput): Promise<Classification> {
    if (input.hints.includes(ROOT_PICK_HINT)) {
      this.rootPicks.push(input);
      const path = this.rootPick;
      return { confidence: 0.9, summary: "pick", tags: [], pages: [], topics: [{ topic: "pick", summary: "pick", evidenceQuotes: [], confidence: 0.9,
        disposition: path ? "integrate_page" : "needs_clarification", pages: path ? [{ path, action: "update", title: path }] : [] }] };
    }
    return { confidence: 0.9, summary: "note", tags: [], pages: [], topics: this.topics };
  }
  async reconcile(request: ReconciliationInput): Promise<ReconciliationOperation[]> {
    const idea = request.ideas[0]!;
    const candidate = request.addCandidates![0]!;
    return [{ kind: "add", ideaIds: [idea.id], sourceIds: [candidate.id], sourceQuote: "-", targetId: null, factKey: null, correctionQuote: null, reason: "Same subject." }];
  }
  async composePage(): Promise<string> { throw new Error("reconciliation path only"); }
  async answer(): Promise<never> { throw new Error("not used"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("not used"); }
  async extractBacklog(): Promise<never> { throw new Error("not used"); }
}

async function enrich(repo: VaultRepo, llm: BrainLlm, content: string) {
  const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
  const input = { content, source: "whatsapp" as const, contentType: "voice_note" as const };
  const captured = await engine.captureEvidence!(input);
  return { captured, result: await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef }) };
}

describe("E22-S6 the engine's rescue path", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e22s6-engine-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("^e-079c02: the unsure aside of a note filed into Epic Team grows Epic Team, no new leaf", async () => {
    const repo = await vaultRepo(dir);
    const llm = new ScriptedLlm([
      { topic: "Recording pane should show at once", summary: FILED, evidenceQuotes: [FILED], confidence: 0.85, disposition: "append_compact_note",
        pages: [{ path: "Projects/Epic Team.md", action: "update", title: "Epic Team" }] },
      { topic: "The user asks whether the record button was always there", summary: ASIDE, evidenceQuotes: [ASIDE], confidence: 0.6,
        disposition: "needs_clarification", pages: [], question: "Was the record button always there?" },
    ]);
    const { captured, result } = await enrich(repo, llm, `${FILED} ${ASIDE}`);
    expect(llm.rootPicks).toHaveLength(0);
    const aside = result.topics!.find(topic => topic.topic.startsWith("The user asks"))!;
    expect(aside.filedPages).toEqual(["Projects/Epic Team.md"]);
    expect(aside.reason).toMatch(/^grown_topic:/);
    const raw = await readFile(join(repo.path, "Projects/Epic Team.md"), "utf8");
    expect(raw).toContain(ASIDE);
    expect(raw).toContain(`#^${captured.evidenceRef.split("#^")[1]}]]`);
    expect((await readdir(join(repo.path, "Notes"))).filter(file => file.endsWith(".md"))).toEqual([]);
    expect((await lintVault(repo.path)).errors).toEqual([]);
  });

  it("^e-053f59: a note no page took, with a weak word match, goes where the root-topic pick says", async () => {
    const repo = await vaultRepo(dir);
    const llm = new ScriptedLlm([
      { topic: "User worries a long debriefer call disconnected", summary: DEBRIEF, evidenceQuotes: [DEBRIEF], confidence: 0.6,
        disposition: "needs_clarification", pages: [], question: "Which call?" },
    ], "Projects/Epic Team.md");
    const { result } = await enrich(repo, llm, DEBRIEF);
    expect(llm.rootPicks).toHaveLength(1);
    expect(result.topics![0]!.filedPages).toEqual(["Projects/Epic Team.md"]);
    expect(await readFile(join(repo.path, "Projects/Epic Team.md"), "utf8")).toContain(DEBRIEF);
    expect(await readFile(join(repo.path, "Projects/Poly-Maker Campaign July 2026.md"), "utf8")).not.toContain(DEBRIEF);
    expect((await readdir(join(repo.path, "Notes"))).filter(file => file.endsWith(".md"))).toEqual([]);
  });
});
