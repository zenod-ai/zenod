import { describe, expect, it, vi } from "vitest";

// Capture the config handed to generateText so we can assert the step budget is
// injected into the prompt, the cap is dynamic, and the last step forces text.
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

import { createBrainLlm } from "../src/llm/aisdk.js";

const readTools = {
  searchVault: async () => "no hits",
  readNote: async () => "note",
  listPages: async () => "pages",
};

describe("answer tool-step budget", () => {
  it("tells the model its budget and forces a final answer on the last step", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer({ question: "hi", vaultBriefing: "brief", conversation: [] }, readTools);

    const system = captured.config.messages[0].content as string;
    // maxSteps 5 → 4 tool rounds advertised.
    expect(system).toContain("TOOL BUDGET");
    expect(system).toContain("4 rounds");

    // Final step (0-indexed 4) disables tools; earlier steps leave them on.
    expect(captured.config.prepareStep({ stepNumber: 4 })).toEqual({ toolChoice: "none" });
    expect(captured.config.prepareStep({ stepNumber: 0 })).toEqual({});
  });

  it("clamps an out-of-range configured budget", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 999 });
    await llm.answer({ question: "hi", vaultBriefing: "brief", conversation: [] }, readTools);
    // clamped to 20 → 19 rounds, and step 19 forces the answer.
    expect(captured.config.messages[0].content).toContain("19 rounds");
    expect(captured.config.prepareStep({ stepNumber: 19 })).toEqual({ toolChoice: "none" });
  });
});
