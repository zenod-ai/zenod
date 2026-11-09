import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import type { ReconciliationInput, ReconciliationOperation } from "../src/engine/reconciliation.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { withBackgroundRoute } from "../src/llm/backgroundRoute.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { serializeNote } from "../src/vault/frontmatter.js";
import { lintVault } from "../src/vault/lint.js";
import { seedTreeFiles } from "../src/vault/treeSeed.js";
import { NEUTRAL_TREE } from "./fixtures/neutralTree.js";
import type { BrainLlm, Classification } from "../src/llm/types.js";

/**
 * EPIC-14 S11: when DeepSeek fails mid-filing (no balance, outage), the same filing finishes on
 * OpenRouter and the memory is saved exactly as it would have been. Both models are stubs; no spend.
 */
const SENTENCE = "The sister app names tire me: each app should feel like its own world.";
const BRAND = serializeNote(
  { title: "Tide Cart brand", type: "project", tags: [], created: "2026-10-01", updated: "2026-10-01", summary: "The Tide Cart brand family: names of the sister apps.", parent: "[[Projects/Launching Tide Cart]]" },
  "# Tide Cart brand\n\nThe Tide Cart brand family: names of the sister apps. See [[Index]].\n");

async function vaultRepo(dir: string): Promise<VaultRepo> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  const files = [
    { path: ".brain/config.yml", content: "schema_version: 1\ntags:\n  - work\nconfidence_threshold: 0.7\n" },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
    { path: "Log/.gitkeep", content: "" }, { path: "Inbox/.gitkeep", content: "" },
    { path: "Projects/Tide Cart brand.md", content: BRAND },
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

/** The OpenRouter stand-in: files the sentence on the brand page. */
class FilingLlm implements BrainLlm {
  calls: string[] = [];
  async classify(): Promise<Classification> {
    this.calls.push("classify");
    const pages = [{ path: "Projects/Tide Cart brand.md", action: "update" as const, title: "Tide Cart brand" }];
    return { confidence: 0.9, summary: "Sister app names", tags: [], pages: [], topics: [{
      topic: "Sister app names feel tiring", summary: SENTENCE, evidenceQuotes: [SENTENCE], confidence: 0.9, disposition: "append_compact_note", pages }] };
  }
  async reconcile(request: ReconciliationInput): Promise<ReconciliationOperation[]> {
    this.calls.push("reconcile");
    const idea = request.ideas[0]!;
    const candidate = request.addCandidates![0]!;
    return [{ kind: "add", ideaIds: [idea.id], sourceIds: [candidate.id], sourceQuote: "-", targetId: null, factKey: null, correctionQuote: null, reason: "The sister app family is this page's subject." }];
  }
  async composePage(): Promise<never> { throw new Error("reconciliation path only"); }
  async answer(): Promise<never> { throw new Error("not used"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("not used"); }
  async extractBacklog(): Promise<never> { throw new Error("not used"); }
}

/** The DeepSeek stand-in: every call fails like an account with no balance (402) or an outage (503). */
function failingLlm(statusCode: number, calls: string[]): BrainLlm {
  const fail = (method: string) => async () => { calls.push(method); throw Object.assign(new Error(`deepseek ${statusCode}`), { statusCode }); };
  return { classify: fail("classify"), reconcile: fail("reconcile"), composePage: fail("composePage"), answer: fail("answer"), describeImage: fail("describeImage"), work: fail("work"), extractBacklog: fail("extractBacklog"), streamMemoryChat: fail("streamMemoryChat") } as unknown as BrainLlm;
}

describe("EPIC-14 S11 a DeepSeek failure never loses a save", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-e14s11-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  for (const statusCode of [402, 503]) {
    it(`files the memory on OpenRouter when DeepSeek answers ${statusCode}`, async () => {
      const repo = await vaultRepo(dir);
      const openrouter = new FilingLlm();
      const deepseekCalls: string[] = [];
      const fallbacks: Array<{ method: string; status: number | null; parked: boolean }> = [];
      const llm = withBackgroundRoute(openrouter, failingLlm(statusCode, deepseekCalls), { filing: true, desk: true, onFallback: (event) => fallbacks.push(event) });
      const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
      const input = { content: SENTENCE, source: "whatsapp" as const, contentType: "voice_note" as const };
      const captured = await engine.captureEvidence!(input);
      const result = await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });

      expect(deepseekCalls[0]).toBe("classify");
      expect(fallbacks[0]).toEqual({ method: "classify", status: statusCode, parked: statusCode === 402 });
      expect(openrouter.calls).toEqual(["classify", "reconcile"]);
      expect(result.filing).toBe("filed");
      expect(result.topics![0]).toMatchObject({ status: "filed", filedPages: ["Projects/Tide Cart brand.md"] });
      const [logPath] = captured.evidenceRef.split("#^") as [string, string];
      expect(await readFile(join(repo.path, logPath), "utf8")).toContain(SENTENCE);
      expect(await readFile(join(repo.path, "Projects/Tide Cart brand.md"), "utf8")).toContain(SENTENCE);
      expect(await simpleGit(repo.path).status()).toMatchObject({ files: [] });
      expect((await lintVault(repo.path)).errors).toEqual([]);
    });
  }
});
