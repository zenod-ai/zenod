import { describe, expect, it, vi } from "vitest";

/**
 * Regression for the "Working… forever" hang: when the provider fails
 * mid-stream (bad key, out of quota, rate limit), the AI SDK reports it as a
 * `{type:"error"}` part on fullStream rather than throwing. The streaming
 * path must re-throw it so the chat turn ends with a visible error instead of
 * an empty bubble that never resolves.
 */
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    streamText: () => ({
      fullStream: (async function* () {
        yield { type: "error", error: { message: "You exceeded your current quota, check your billing." } };
      })(),
    }),
  };
});

import { clampMaxSteps, createBrainLlm, DEFAULT_MAX_STEPS, MAX_WORK_STEPS, PROVIDER_DEFAULTS } from "../src/llm/aisdk.js";

describe("aisdk streaming error handling", () => {
  it("uses the cheaper OpenAI model and bounded loop caps by default", () => {
    expect(PROVIDER_DEFAULTS.openai).toEqual({ ask: "gpt-4o-mini", classify: "gpt-4o-mini", vision: "gpt-4o-mini" });
    expect(DEFAULT_MAX_STEPS).toBe(8);
    expect(MAX_WORK_STEPS).toBe(12);
  });

  it("clamps the configured step budget to a sane range", () => {
    expect(clampMaxSteps(undefined)).toBe(DEFAULT_MAX_STEPS);
    expect(clampMaxSteps(0)).toBe(2);
    expect(clampMaxSteps(1)).toBe(2);
    expect(clampMaxSteps(100)).toBe(20);
    expect(clampMaxSteps(10)).toBe(10);
    expect(clampMaxSteps(7.6)).toBe(8);
    expect(clampMaxSteps(Number.NaN)).toBe(DEFAULT_MAX_STEPS);
  });

  it("re-throws a provider error part instead of resolving with empty text", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "test-key" });
    await expect(
      llm.answer(
        { question: "hi", vaultBriefing: "brief", conversation: [], onTextDelta: () => {} },
        { searchVault: async () => "", readNote: async () => "", listPages: async () => "" },
      ),
    ).rejects.toThrow(/quota/i);
  });
});
