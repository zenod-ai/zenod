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

  it("tells Console how to route owner-specific and multi-step peer work", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    await llm.answer(
      { question: "create a ticket and run it", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      {
        archus_request_backlog_action: {
          description: "Owner: Archus. Change the GitHub backlog.",
          run: async () => "archus",
        },
        epaminon_run_existing_issue: {
          description: "Owner: Epaminon. Start execution.",
          run: async () => "epaminon",
        },
        epaminon_run_ephemeral_task: {
          description: "Owner: Epaminon. Start one-off execution.",
          run: async () => "ephemeral",
        },
        epaminon_read_issue_execution_status: {
          description: "Owner: Epaminon. Read execution status.",
          run: async () => "status",
        },
      },
    );

    const system = captured.config.messages[0].content as string;
    expect(system).toContain("Archus owns GitHub issue/backlog reads and writes");
    expect(system).toContain("Epaminon owns execution starts and execution status");
    expect(system).toContain("For exact run/start/execute requests on an existing owner/repo#N issue, call Epaminon's run-existing-issue tool");
    expect(system).toContain("For one-off execution/research/operational work where the user did NOT ask to create/file/open a durable ticket");
    expect(system).toContain("When the user asks for multiple side effects");
    expect(system).toContain("ask ONE concrete clarification before mutating or dispatching");
  });
});
