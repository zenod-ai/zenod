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

import { createBrainLlm } from "../src/llm/aisdk.js";

describe("aisdk streaming error handling", () => {
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
