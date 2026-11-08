import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import * as placement from "../src/engine/treePlacement.js";
import { parseFiledLines } from "../src/engine/treePlacement.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { seedTreeFiles } from "../src/vault/treeSeed.js";
import { REAL_SHAPED_REPORTS } from "./fixtures/agentReports.js";
import { NEUTRAL_TREE } from "./fixtures/neutralTree.js";
import type { BrainLlm, Classification, ClassifyInput, ComposePageInput } from "../src/llm/types.js";

/**
 * E12-S15: when an agent report's rollup is unavailable (any failure), the report stays in
 * the Log with a `filed: log only` line. Before, it fell back to ordinary topic filing and
 * landed on the person's pages. The rollup is made to fail here; voice notes file as before.
 */
vi.mock("../src/engine/treePlacement.js", async (original) => {
  const actual = await original<typeof import("../src/engine/treePlacement.js")>();
  return { ...actual, appendOpsRollup: vi.fn(actual.appendOpsRollup) };
});

const VOICE = "Voice note: called the yard in Vigo, hull quote 2,800 euros all-in for 30 planks; compare with the Porto quotes before deciding on the boat repair.";
const KEPT = "log only (agent report, kept in the Log)";

/** Files every capture onto one page, so a report reaching topic filing would show. */
class OnePageLlm implements BrainLlm {
  classified: string[] = [];
  async classify(input: ClassifyInput): Promise<Classification> {
    this.classified.push(input.content);
    return { disposition: "integrate_page", confidence: 0.95, summary: input.content.slice(0, 80), tags: [],
      pages: [{ path: "Projects/Boat repair.md", action: "update", title: "Boat repair" }] };
  }
  async composePage(input: ComposePageInput): Promise<string> {
    const { frontmatter, body } = parseNote(input.currentContent!);
    return serializeNote(frontmatter!, `${body.trimEnd()}\n- ${input.classification.summary} (${input.citation}).\n`);
  }
  async answer(): Promise<never> { throw new Error("not used"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("not used"); }
  async extractBacklog(): Promise<never> { throw new Error("not used"); }
}

async function treeVault(dir: string): Promise<VaultRepo> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  const files = [
    { path: ".brain/config.yml", content: "schema_version: 1\ntags:\n  - work\nconfidence_threshold: 0.7\n" },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
    { path: "Log/.gitkeep", content: "" },
    { path: "Inbox/.gitkeep", content: "" },
    ...seedTreeFiles(NEUTRAL_TREE, "2026-11-01"),
  ];
  for (const file of files) {
    await mkdir(dirname(join(seed, file.path)), { recursive: true });
    await writeFile(join(seed, file.path), file.content);
  }
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("seed vault");
  await git.push("origin", "main");
  return VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
}

async function pagesText(repo: VaultRepo): Promise<string> {
  const pages = (await listMarkdownFiles(repo.path)).filter((path) => /^(?:Projects|Areas|Notes)\//.test(path)).sort();
  return (await Promise.all(pages.map((path) => readFile(join(repo.path, path), "utf8")))).join("\n");
}

describe("E12-S15 a report whose rollup is unavailable stays in the Log", { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-e12s15-off-"));
    vi.mocked(placement.appendOpsRollup).mockRejectedValue(new Error("rollup unavailable"));
  });
  afterEach(async () => {
    vi.mocked(placement.appendOpsRollup).mockReset();
    await rm(dir, { recursive: true, force: true });
  });

  it("store: reports never reach topic filing, a voice note still files", async () => {
    const repo = await treeVault(dir);
    const llm = new OnePageLlm();
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
    const pagesBefore = await pagesText(repo);
    for (const report of REAL_SHAPED_REPORTS) {
      const result = await engine.store({ content: report, source: "mcp" });
      expect(result).toMatchObject({ pagesTouched: [], filing: "filed" });
      const [logPath, anchor] = result.evidenceRef.split("#^") as [string, string];
      expect(parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor)).toEqual([KEPT]);
      expect(result.commitSha).toBe(await simpleGit(repo.path).revparse(["HEAD"]));
    }
    expect(llm.classified).toEqual([]);
    expect(await pagesText(repo)).toBe(pagesBefore);
    expect((await simpleGit(repo.path).status()).files).toEqual([]);

    const voice = await engine.store({ content: VOICE, source: "whatsapp", contentType: "voice_note" });
    expect(voice.pagesTouched).toContain("Projects/Boat repair.md");
    expect(llm.classified).toHaveLength(1);
  });

  it("capture first, then enrichment: the report stays in the Log, replays add nothing", async () => {
    const repo = await treeVault(dir);
    const llm = new OnePageLlm();
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:") });
    const pagesBefore = await pagesText(repo);
    const input = { content: REAL_SHAPED_REPORTS[1]!, source: "mcp" as const };
    const captured = await engine.captureEvidence!(input);
    const result = await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
    expect(result.pagesTouched).toEqual([]);
    expect(result.commitSha).toBe(await simpleGit(repo.path).revparse(["HEAD"]));
    const [logPath, anchor] = captured.evidenceRef.split("#^") as [string, string];
    expect(parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor)).toEqual([KEPT]);
    await engine.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
    expect(parseFiledLines(await readFile(join(repo.path, logPath), "utf8"), anchor)).toEqual([KEPT]);
    expect(llm.classified).toEqual([]);
    expect(await pagesText(repo)).toBe(pagesBefore);
  });
});
