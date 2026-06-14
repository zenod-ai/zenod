import { describe, expect, it, vi } from "vitest";

/**
 * Regression for the "I couldn't compose a reply to that one" failure: a
 * reasoning model (e.g. grok) runs its tools successfully but spends its whole
 * output budget on reasoning + tool calls and ends the turn with NO final text
 * block — `result.text` comes back empty even though the work is done and the
 * tool results are in context. The answer path must notice the empty text and
 * force a closing text step (tools disabled) to recover the answer the model
 * already gathered, instead of bubbling "" up to finalizeReply.
 */
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    // Streaming path: emit reasoning + a tool round, but never a text-delta.
    streamText: () => ({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", text: "thinking about recent evidence..." };
        yield { type: "tool-call", toolName: "search_vault", input: { query: "recent evidence" } };
        yield { type: "tool-result", toolName: "search_vault", input: { query: "recent evidence" } };
      })(),
      totalUsage: Promise.resolve({ inputTokens: 26433, outputTokens: 710 }),
      providerMetadata: Promise.resolve({}),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "" }] }),
    }),
    // generateText is used both for the initial non-streaming turn and for the
    // forced recovery step. Distinguish them by toolChoice.
    generateText: vi.fn(async (cfg: { toolChoice?: string }) => {
      if (cfg.toolChoice === "none") {
        return { text: "Here are recent evidence examples …", totalUsage: {}, providerMetadata: {} };
      }
      return {
        text: "",
        reasoningText: "internal monologue",
        totalUsage: { inputTokens: 26433, outputTokens: 710 },
        providerMetadata: {},
        response: { messages: [{ role: "assistant", content: "" }] },
      };
    }),
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";

const readTools = { searchVault: async () => "", readNote: async () => "", listPages: async () => "" };

describe("aisdk empty-text recovery", () => {
  it("forces a closing text step when the streaming turn ends with no text", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "test-key" });
    const deltas: string[] = [];
    const result = await llm.answer(
      { question: "examples of recent evidence?", vaultBriefing: "brief", conversation: [], onTextDelta: (d) => deltas.push(d) },
      readTools,
    );
    expect(result.text).toBe("Here are recent evidence examples …");
    // The recovered text is streamed to the UI even though the first pass was silent.
    expect(deltas.join("")).toContain("recent evidence examples");
  });

  it("forces a closing text step when the non-streaming turn ends with no text", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "test-key" });
    const result = await llm.answer(
      { question: "examples of recent evidence?", vaultBriefing: "brief", conversation: [] },
      readTools,
    );
    expect(result.text).toBe("Here are recent evidence examples …");
  });
});
