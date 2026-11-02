import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { AnswerInput, AnswerResult, BrainLlm, VaultReadTools } from "../src/llm/types.js";

// EPIC-9 E9-3b: ask_brain briefs from the tree (levels 0–1), shows lineage on search hits,
// and cites the tree path of the sources the answer relies on. Unplaced vaults are unchanged.
const TREE_FIXTURE = fileURLToPath(new URL("./fixtures/tree-vault", import.meta.url));
const FLAT_FIXTURE = fileURLToPath(new URL("./fixtures/vault", import.meta.url));
const QUOTES = "Projects/Hair transplant/2023 Barcelona quotes.md";
const QUOTES_PATH = "Working memory › Hair transplant › 2023 Barcelona quotes ← Log/2026-10-31.md#^e-c64e3b";

let dir: string | undefined;
let state: SqliteStateStore | undefined;
afterEach(async () => {
  state?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  state = undefined;
});

async function engineFor(fixture: string, answer: (input: AnswerInput, tools: VaultReadTools) => Promise<AnswerResult>) {
  dir = await mkdtemp(join(tmpdir(), "zenod-ask-lineage-"));
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  await cp(fixture, seed, { recursive: true });
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("seed vault");
  await git.push("origin", "main");
  const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
  state = new SqliteStateStore(":memory:");
  const inputs: AnswerInput[] = [];
  const llm = { answer: async (input: AnswerInput, tools: VaultReadTools) => { inputs.push(input); return answer(input, tools); } } as unknown as BrainLlm;
  return { engine: createEngine({ repo, llm, state }), inputs };
}

describe("ask_brain cites the memory tree (E9-3b)", { timeout: 20_000 }, () => {
  it("briefs levels 0–1, annotates hits and cites the page's tree path", async () => {
    let searchText = "";
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async (_input, tools) => {
      searchText = await tools.searchVault!("Barcelona quotes");
      await tools.readNote!(QUOTES);
      return { text: "The 2023 Barcelona quotes were around 4,000 euros.", readPaths: [QUOTES] };
    });
    const answer = await engine.ask("Where did the hair transplant quotes come from?");

    const briefing = inputs[0]!.vaultBriefing;
    expect(briefing).toContain("MAP — memory tree, levels 0–1");
    expect(briefing).toContain("Working memory (ongoing now)\n- Launching Epic Social → Projects/Launching Epic Social.md:");
    expect(briefing).toContain("Long-term memory (what lasts)");
    expect(briefing.indexOf("MAP — memory tree")).toBeLessThan(briefing.indexOf("MAP — meaning pages"));

    expect(searchText).toContain(`${QUOTES} (score`);
    expect(searchText).toContain(`· tree: ${QUOTES_PATH}`);
    expect(searchText).not.toMatch(/^Log\/.*· tree:/m);

    expect(answer.text).toContain("4,000 euros");
    expect(answer.text).toContain(`Where this sits in your memory:\n- ${QUOTES_PATH}`);
    // Search auto-reads the single matching Log entry too; both sources map to one page, cited once.
    expect(answer.lineage).toEqual([expect.objectContaining({
      page: QUOTES,
      evidence: "Log/2026-10-31.md#^e-c64e3b",
      text: QUOTES_PATH,
    })]);
    expect(answer.lineage![0]!.lineage.map((node) => node.title)).toEqual(["Working memory", "Hair transplant", "2023 Barcelona quotes"]);
  });

  it("traces a Log entry source back to the deepest placed page that cites it", async () => {
    const { engine } = await engineFor(TREE_FIXTURE, async (_input, tools) => {
      await tools.readNote!("Log/2026-10-31.md#^e-c64e3b");
      return { text: "You found the 2023 Barcelona quotes, around 4,000 euros.", readPaths: ["Log/2026-10-31.md#^e-c64e3b"] };
    });
    const answer = await engine.ask("Where did the Barcelona quote come from?");
    expect(answer.sources.map((source) => source.path)).toEqual(["Log/2026-10-31.md#^e-c64e3b"]);
    expect(answer.lineage?.map((item) => [item.page, item.text])).toEqual([[QUOTES, QUOTES_PATH]]);
    expect(answer.text).toContain(`- ${QUOTES_PATH}`);
  });

  it("retries once when the model answers without any tool call", async () => {
    let calls = 0;
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async (_input, tools) => {
      if (++calls === 1) return { text: "From the map: about 4,000 euros.", readPaths: [] };
      await tools.readNote!(QUOTES);
      return { text: "The 2023 Barcelona quotes were around 4,000 euros.", readPaths: [QUOTES] };
    });
    const answer = await engine.ask("What were the Barcelona quotes?");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.hostInstruction).toBeUndefined();
    expect(inputs[1]!.hostInstruction).toContain("made no tool call");
    expect(answer.sources.map((source) => source.path)).toContain(QUOTES);
    expect(answer.text).toContain(`- ${QUOTES_PATH}`);
  });

  it("does not retry when the model searched and found nothing", async () => {
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async (_input, tools) => {
      await tools.searchVault!("zzqx nothing matches");
      return { text: "Nothing found.", readPaths: [] };
    });
    await engine.ask("What about zzqx?");
    expect(inputs).toHaveLength(1);
  });

  it("E9-3c: when the ask ends with nothing read, Zenod searches the question, reads the top page and answers from it", async () => {
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async (input) => {
      if (input.hostInstruction?.includes("HOST-READ SOURCE")) {
        // Answer the typed way, selecting a support the host read registered.
        const id = /"id":"(as_[a-f0-9]{24})","kind":"passage"/.exec(input.vaultBriefing)![1]!;
        return { text: "", readPaths: [], supportSelections: [{ id, mode: "raw_report" as const, summaryText: "The 2023 Barcelona quotes were around 4,000 euros." }] };
      }
      return { text: "From the map: about 4,000 euros.", readPaths: [] };
    });
    const answer = await engine.ask("Barcelona quotes hair transplant");
    // Ask, the no-tool retry, then one answer from the host's own read.
    expect(inputs).toHaveLength(3);
    expect(inputs[2]!.answerSupportRead).toBe(true);
    expect(inputs[2]!.vaultBriefing).toContain(`HOST-READ SOURCE — Zenod searched the question and read this page (tree: ${QUOTES_PATH}):\n[${QUOTES}]`);
    expect(answer.sources.map((source) => source.path)).toContain(QUOTES);
    expect(answer.text).toContain("4,000 euros");
    expect(answer.text).toContain(`- ${QUOTES_PATH}`);
    expect(answer.lineage?.map((item) => item.page)).toEqual([QUOTES]);
  });

  it("E9-3c: if the model still gives no usable answer, the host returns a verbatim excerpt of the page it read", async () => {
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async () => ({ text: "", readPaths: [], supportProtocolError: "missing_submission" as const }));
    const answer = await engine.ask("Barcelona quotes hair transplant");
    expect(inputs).toHaveLength(3);
    expect(answer.text).toContain(`here is what the closest page in your memory says (${QUOTES}):`);
    expect(answer.text).toMatch(/^> /m);
    expect(answer.sources.map((source) => source.path)).toContain(QUOTES);
    expect(answer.text).toContain(`- ${QUOTES_PATH}`);
  });

  it("E9-3c: no fallback when the model already read a source", async () => {
    const read = await engineFor(TREE_FIXTURE, async (_input, tools) => {
      await tools.readNote!(QUOTES);
      return { text: "The 2023 Barcelona quotes were around 4,000 euros.", readPaths: [QUOTES] };
    });
    await read.engine.ask("Barcelona quotes hair transplant");
    expect(read.inputs).toHaveLength(1);
  });

  it("E9-3c: no fallback read when the best hit carries under half the question's words", async () => {
    const { engine, inputs } = await engineFor(TREE_FIXTURE, async () => ({ text: "From the map.", readPaths: [] }));
    const answer = await engine.ask("Barcelona zzqx yyvw wwpt");
    expect(inputs).toHaveLength(2);
    expect(answer.sources).toEqual([]);
    expect(answer.text).toContain("couldn't verify");
  });

  it("leaves a vault without a tree exactly as before", async () => {
    let searchText = "";
    const { engine, inputs } = await engineFor(FLAT_FIXTURE, async (_input, tools) => {
      searchText = await tools.searchVault!("insurance");
      await tools.readNote!("Areas/Insurance.md");
      return { text: "Travel insurance with Axa.", readPaths: ["Areas/Insurance.md"] };
    });
    const answer = await engine.ask("What insurance do I have?");
    expect(inputs[0]!.vaultBriefing).not.toContain("MAP — memory tree");
    expect(searchText).not.toContain("· tree:");
    expect(answer.text).not.toContain("Where this sits");
    expect(answer.lineage).toBeUndefined();
  });
});
