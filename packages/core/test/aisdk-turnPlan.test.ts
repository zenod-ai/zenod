import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { calls: any[]; object: unknown; failure: Error | null } = {
  calls: [],
  object: null,
  failure: null,
};

vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateObject: async (config: any) => {
      captured.calls.push(config);
      if (captured.failure) throw captured.failure;
      return { object: captured.object, usage: {}, providerMetadata: {} };
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";

const toolId = "generic__store_item__0123456789abcdef";

function compileInput() {
  return {
    currentTurn: "Store this attachment.",
    correlationId: "corr-1",
    tools: [{
      id: toolId,
      description: "Store one tenant-private item.",
      inputSchema: { type: "object", properties: { content: { type: "string" } } },
      annotations: { readOnlyHint: false },
    }],
    payloads: [{ ref: "artifact://one", kind: "document", mediaType: "text/plain", sizeBytes: 10_000 }],
  } as const;
}

beforeEach(() => {
  captured.calls = [];
  captured.failure = null;
  captured.object = {
    outerIntent: "mutate",
    disposition: "tool",
    authority: { quote: "Store this attachment", start: 0, end: 21 },
    requestedOperations: [{ toolId, inputJson: '{"content":"artifact://one"}', payloadRef: "artifact://one" }],
    embeddedCandidates: [],
    needsClarification: false,
    clarification: null,
  };
});

describe("AiSdkBrainLlm TurnPlan compiler seam", () => {
  it("uses exactly one provider call and returns an exact-bound plan without executing a tool", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    const result = await llm.compileTurnPlan(compileInput());

    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0].maxRetries).toBe(0);
    expect(captured.calls[0].prompt).toContain(toolId);
    expect(captured.calls[0].system).toContain("not authorization, a receipt, or customer-facing prose");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.plan.metadata.modelCallBudget).toBe(1);
      expect(result.plan.requestedOperations[0]?.toolId).toBe(toolId);
    }
    expect(result.observedProviderAttempts).toBe(1);
  });

  it("fails closed without a plan when structured generation fails", async () => {
    const sensitiveProviderText = "provider returned invalid structured output: sk-secret";
    captured.failure = new Error(sensitiveProviderText);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = createBrainLlm({ provider: "openrouter", apiKey: "k" });
    const result = await llm.compileTurnPlan(compileInput());

    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0].maxRetries).toBe(0);
    expect(result.status).toBe("clarify");
    expect(result.plan).toBeNull();
    expect(result.observedProviderAttempts).toBe(1);
    expect(JSON.stringify(result.errors)).not.toContain(sensitiveProviderText);
    expect(result.errors).toEqual([{
      code: "provider_output_unavailable",
      message: "The turn could not be compiled into a safe structured plan.",
    }]);
    expect(warning).toHaveBeenCalledWith(expect.not.stringContaining("sk-secret"));
    warning.mockRestore();
  });

  it("defers an ordinary turn without carrying customer-facing prose", async () => {
    captured.object = {
      outerIntent: "respond",
      disposition: "defer_answer",
      authority: { quote: "Store this attachment", start: 0, end: 21 },
      requestedOperations: [],
      embeddedCandidates: [],
      needsClarification: false,
      clarification: null,
    };
    const llm = createBrainLlm({ provider: "groq", apiKey: "k" });
    const result = await llm.compileTurnPlan(compileInput());

    expect(captured.calls).toHaveLength(1);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.plan.disposition).toBe("defer_answer");
      expect(result.plan).not.toHaveProperty("directAnswer");
    }
  });

  it("documents one compiler call for action planning and a separate answer path for deferrals", async () => {
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    await llm.compileTurnPlan(compileInput());
    expect(captured.calls[0].system).toContain("Normal mutation/action planning is this one compiler inference");
    expect(captured.calls[0].system).toContain("Non-action defer_answer may enter the existing answer path");
  });
});
