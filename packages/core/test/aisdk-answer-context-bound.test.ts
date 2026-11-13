import { afterEach, describe, expect, it, vi } from "vitest";

// T7-F7: drive the answer loop's own prepareStep/onStepFinish hooks the way the AI SDK does, with the
// per-round input sizes production logged, and check what the whole answer reads.
const captured: { config?: any } = {};
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: (config: any) => {
      captured.config = config;
      return Promise.resolve({ text: "answer", totalUsage: {}, providerMetadata: {} });
    },
  };
});

import { ANSWER_INPUT_TOKEN_BUDGET, ANSWER_TIME_BUDGET_MS, createBrainLlm } from "../src/llm/aisdk.js";

const readTools = { searchVault: async () => "hits", readNote: async () => "note", listPages: async () => "pages" };

// E7-S4 question 3 on production e0100de1: "What is the T7 rehearsal test word?" asked again ran all 8 rounds and
// read 97,105 input tokens in 125 s. These rounds grow as each re-sends the context plus the last tool result.
const PRODUCTION_ROUNDS = [9_000, 10_000, 11_000, 12_000, 13_000, 13_500, 14_000, 14_605];

/** Run the loop like the SDK: each round asks prepareStep, the model reads its input, onStepFinish counts it. */
function replay(rounds: number[], maxSteps = 8, msPerRound = 0) {
  let read = 0;
  let used = 0;
  for (let stepNumber = 0; stepNumber < maxSteps; stepNumber++) {
    const step = captured.config.prepareStep({ stepNumber });
    const input = rounds[Math.min(stepNumber, rounds.length - 1)]!;
    read += input;
    used = stepNumber + 1;
    if (msPerRound) vi.advanceTimersByTime(msPerRound);
    if (step.toolChoice === "none") return { read, rounds: used, answered: true };
    captured.config.onStepFinish({ usage: { inputTokens: input, outputTokens: 80, cachedInputTokens: 0 } });
  }
  return { read, rounds: used, answered: false };
}

describe("T7-F7 answer context bound", () => {
  afterEach(() => vi.useRealTimers());

  it("the production 97K-token repeat question now reads a bounded context and still ends on an answer round", async () => {
    expect(PRODUCTION_ROUNDS.reduce((a, b) => a + b, 0)).toBe(97_105);
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 8 });
    await llm.answer({ question: "What is the T7 rehearsal test word?", vaultBriefing: "brief", conversation: [] }, readTools);
    const run = replay(PRODUCTION_ROUNDS);
    expect(run.answered).toBe(true);
    expect(run.read).toBeLessThanOrEqual(ANSWER_INPUT_TOKEN_BUDGET + Math.max(...PRODUCTION_ROUNDS));
    expect(run.read).toBeLessThan(65_000);
    expect(run.rounds).toBeLessThan(8);
  });

  it("leaves a normal short answer alone (production question 1: 21,587 tokens)", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 8 });
    await llm.answer({ question: "hi", vaultBriefing: "brief", conversation: [] }, readTools);
    expect(captured.config.prepareStep({ stepNumber: 0 })).toEqual({});
    captured.config.onStepFinish({ usage: { inputTokens: 10_500 } });
    expect(captured.config.prepareStep({ stepNumber: 1 })).toEqual({});
    captured.config.onStepFinish({ usage: { inputTokens: 11_087 } });
    expect(captured.config.prepareStep({ stepNumber: 2 })).toEqual({});
  });

  it("a memory answer's forced final round only submits", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 8 });
    await llm.answer({ question: "Summarize this", vaultBriefing: "brief", conversation: [], answerSupportContract: "v1", answerSupportScope: "memory_only", answerSupportRead: true }, readTools);
    expect(captured.config.prepareStep({ stepNumber: 1 }).activeTools).toContain("search_vault");
    captured.config.onStepFinish({ usage: { inputTokens: 30_000 } });
    expect(captured.config.prepareStep({ stepNumber: 1 })).toEqual({ activeTools: ["submit_memory_answer"], toolChoice: "required" });
  });

  it("the time budget forces the answer round even when rounds are small", async () => {
    vi.useFakeTimers();
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 8 });
    await llm.answer({ question: "hi", vaultBriefing: "brief", conversation: [] }, readTools);
    const run = replay([2_000], 8, 16_000);
    expect(run.answered).toBe(true);
    expect(run.rounds * 16_000).toBeLessThanOrEqual(ANSWER_TIME_BUDGET_MS + 2 * 16_000);
    expect(run.rounds).toBeLessThan(8);
  });
});

describe("E7-S4 answer round log", () => {
  it("logs one content-free line per round with its input, elapsed time and whether it was the final round", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 8 });
      await llm.answer({ question: "secret question text", vaultBriefing: "brief", conversation: [] }, readTools);
      captured.config.prepareStep({ stepNumber: 0 });
      captured.config.onStepFinish({ usage: { inputTokens: 15_000, outputTokens: 90, cachedInputTokens: 4_000 } });
      captured.config.prepareStep({ stepNumber: 1 });
      captured.config.onStepFinish({ usage: { inputTokens: 40_000, outputTokens: 120, cachedInputTokens: 14_000 } });
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[answer-round]"));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^\[answer-round\] step=1 input=15000 output=90 cache_read=4000 total_input=15000 elapsed_ms=\d+ final=false$/);
      expect(lines[1]).toMatch(/step=2 input=40000 .* total_input=55000 /);
      expect(lines.join(" ")).not.toContain("secret");
    } finally {
      warn.mockRestore();
    }
  });
});
