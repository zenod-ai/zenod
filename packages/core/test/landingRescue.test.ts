import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { classifyCandidates } from "../src/engine/meaningNotes.js";
import { scanVault } from "../src/vault/pages.js";
import { parseFiledLines } from "../src/engine/treePlacement.js";
import type { ReconciliationInput, ReconciliationOperation } from "../src/engine/reconciliation.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import { lintVault } from "../src/vault/lint.js";
import { seedTreeFiles } from "../src/vault/treeSeed.js";
import { NEUTRAL_TREE } from "./fixtures/neutralTree.js";
import type { BrainLlm, Classification, ClassifyInput } from "../src/llm/types.js";

/**
 * E12-S8 fix 1 (S6 round 5 cause "rejected, then dropped"): when the reconciler
 * rejects the page the organiser chose, the memory is classified again without that
 * page, or kept as a provisional leaf; it never stays only in the filing receipt.
 */
const CONFIG = "schema_version: 1\ntags:\n  - work\nconfidence_threshold: 0.7\n";
const page = (title: string, summary: string, parent: string) => serializeNote(
  { title, type: "project", tags: [], created: "2026-10-01", updated: "2026-10-01", summary, parent: `[[${parent}]]` },
  `# ${title}\n\n${summary} See [[Index]].\n`);
const NAMING = page("Moss Lantern naming", "How Moss Lantern got its name: candidate names and the domain.", "Projects/Launching Moss Lantern");
const TIDE_BRAND = page("Tide Cart brand", "The Tide Cart brand family: names of the sister apps and how they relate.", "Projects/Launching Tide Cart");

async function vaultRepo(dir: string): Promise<VaultRepo> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  const files = [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
    { path: "Log/.gitkeep", content: "" }, { path: "Inbox/.gitkeep", content: "" },
    { path: "Projects/Moss Lantern naming.md", content: NAMING },
    { path: "Projects/Tide Cart brand.md", content: TIDE_BRAND },
    ...seedTreeFiles(NEUTRAL_TREE, "2026-11-01"),
  ];
  for (const file of files) {
    await mkdir(dirname(join(seed, file.path)), { recursive: true });
    await writeFile(join(seed, file.path), file.content);
  }
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]); await git.commit("seed vault"); await git.push("origin", "main");
  return VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
}

const SENTENCE = "The sister app names tire me: each app should feel like its own world.";

/** First call routes to the naming page on a shared word; a re-route call answers `reroute`. */
class RejectingLlm implements BrainLlm {
  classifyCalls: ClassifyInput[] = [];
  reconcileTargets: string[] = [];
  constructor(private readonly reroute: Classification["pages"]) {}
  async classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls.push(input);
    const rerouting = input.hints.some(hint => hint.startsWith("Re-route:"));
    const pages = rerouting ? this.reroute : [{ path: "Projects/Moss Lantern naming.md", action: "update" as const, title: "Moss Lantern naming" }];
    return { confidence: 0.9, summary: "Sister app names", tags: [], pages: [], topics: [{
      topic: "Sister app names feel tiring", summary: SENTENCE, evidenceQuotes: [SENTENCE], confidence: 0.9,
      disposition: pages.length ? "append_compact_note" : "needs_clarification", pages }] };
  }
  async reconcile(request: ReconciliationInput): Promise<ReconciliationOperation[]> {
    this.reconcileTargets.push(request.branch?.title ?? "");
    const idea = request.ideas[0]!;
    if (request.branch?.title === "Moss Lantern naming") {
      return [{ kind: "clarify", ideaIds: [idea.id], sourceIds: idea.sourceIds, sourceQuote: SENTENCE, targetId: null, factKey: null, correctionQuote: null, reason: "About the sister apps, not Moss Lantern's name." }];
    }
    const candidate = request.addCandidates![0]!;
    return [{ kind: "add", ideaIds: [idea.id], sourceIds: [candidate.id], sourceQuote: "-", targetId: null, factKey: null, correctionQuote: null, reason: "The sister app family is this page's subject." }];
  }
  async composePage(): Promise<string> { throw new Error("reconciliation path only"); }
  async answer(): Promise<never> { throw new Error("not used"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("not used"); }
  async extractBacklog(): Promise<never> { throw new Error("not used"); }
}

async function enrich(repo: VaultRepo, llm: RejectingLlm) {
  const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
  const input = { content: SENTENCE, source: "whatsapp" as const, contentType: "voice_note" as const };
  const captured = await engine.captureEvidence!(input);
  const result = await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
  return { engine, input, captured, result };
}

describe("E12-S8 a rejected memory is never dropped", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e12s8-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("classifies again without the rejected page and files it where it fits", async () => {
    const repo = await vaultRepo(dir);
    const llm = new RejectingLlm([{ path: "Projects/Tide Cart brand.md", action: "update", title: "Tide Cart brand" }]);
    const { result } = await enrich(repo, llm);
    expect(llm.reconcileTargets).toEqual(["Moss Lantern naming", "Tide Cart brand"]);
    const retry = llm.classifyCalls.find(call => call.hints.some(hint => hint.startsWith("Re-route:")))!;
    expect(retry.pageIndex.map(page => page.path)).not.toContain("Projects/Moss Lantern naming.md");
    expect(result.topics![0]).toMatchObject({ status: "filed", filedPages: ["Projects/Tide Cart brand.md"], reroutedFrom: ["Projects/Moss Lantern naming.md"] });
    expect(result.filing).toBe("filed");
    expect(await readFile(join(repo.path, "Projects/Tide Cart brand.md"), "utf8")).toContain(SENTENCE);
    expect(await readFile(join(repo.path, "Projects/Moss Lantern naming.md"), "utf8")).toBe(NAMING);
    expect((await lintVault(repo.path)).errors).toEqual([]);
  });

  it("keeps it as a provisional leaf when nothing else fits, cited and in the tree", async () => {
    const repo = await vaultRepo(dir);
    const llm = new RejectingLlm([]);
    const { engine, input, captured, result } = await enrich(repo, llm);
    const topic = result.topics![0]!;
    expect(topic.status).toBe("uncertain");
    expect(topic.reason).toMatch(/^provisional_leaf: reconciliation_needs_clarification/);
    expect(topic.reroutedFrom).toEqual(["Projects/Moss Lantern naming.md"]);
    const leaf = topic.filedPages[0]!;
    expect(leaf).toMatch(/^Notes\/Sister app names feel tiring\.md$/);
    const raw = await readFile(join(repo.path, leaf), "utf8");
    expect(raw).toContain(SENTENCE);
    expect(parseNote(raw).frontmatter).toMatchObject({ provisional: true });
    expect(raw).toContain(`#^${captured.evidenceRef.split("#^")[1]}]]`);
    // The capture's Log entry records where it went, and the page and receipt are published together.
    const [logPath, anchor] = captured.evidenceRef.split("#^") as [string, string];
    expect(parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor).join(" ")).toContain(leaf.replace(/\.md$/, ""));
    expect(await simpleGit(repo.path).status()).toMatchObject({ files: [] });
    expect((await lintVault(repo.path)).errors).toEqual([]);
    // A replay changes nothing and writes no second leaf.
    const head = await simpleGit(repo.path).revparse(["HEAD"]);
    await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
    expect(await simpleGit(repo.path).revparse(["HEAD"])).toBe(head);
  });
});

describe("E12-S8 the organiser sees the tree", { timeout: 60_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e12s8-tree-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("gives each candidate its place, the top-level branches, and the branch head of a strong candidate", async () => {
    const repo = await vaultRepo(dir);
    const seen: ClassifyInput[] = [];
    const llm = { classify: async (input: ClassifyInput): Promise<Classification> => { seen.push(input); return { confidence: 0.9, summary: "x", tags: [], pages: [] }; } };
    await classifyCandidates(llm, repo.path, await scanVault(repo.path), { content: "Moss Lantern naming: the candidate names", hints: [], pageIndex: [], tagVocabulary: [] });
    const input = seen[0]!;
    const naming = input.pageIndex.find(page => page.path === "Projects/Moss Lantern naming.md")!;
    expect(naming.place).toBe("Working › Launching Moss Lantern");
    expect(input.pageIndex.find(page => page.path === "Projects/Launching Moss Lantern.md")?.place).toBe("Working (top-level branch)");
    expect(input.hints.find(hint => hint.startsWith("Memory tree, top level"))).toContain("Launching Tide Cart [working]");
    expect(input.pageIndex.length).toBeLessThanOrEqual(24);
  });

  it("leaves a vault without a tree as before", async () => {
    const repo = await vaultRepo(dir);
    await rm(join(repo.path, "Tree.md"));
    const seen: ClassifyInput[] = [];
    const llm = { classify: async (input: ClassifyInput): Promise<Classification> => { seen.push(input); return { confidence: 0.9, summary: "x", tags: [], pages: [] }; } };
    await classifyCandidates(llm, repo.path, await scanVault(repo.path), { content: "Moss Lantern naming", hints: [], pageIndex: [], tagVocabulary: [] });
    expect(seen[0]!.pageIndex.every(page => page.place === undefined)).toBe(true);
    expect(seen[0]!.hints.some(hint => hint.startsWith("Memory tree"))).toBe(false);
  });
});
