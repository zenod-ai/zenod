import { describe, expect, it, vi } from "vitest";
import { InvalidToolInputError, NoSuchToolError } from "ai";
import { z } from "zod";

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

import { createBrainLlm, uniqueSuffixedPeerToolName } from "../src/llm/aisdk.js";

const readTools = {
  searchVault: async () => "no hits",
  readNote: async () => "note",
  listPages: async () => "pages",
};

function missingToolError(toolName: string) {
  return new NoSuchToolError({ toolName, availableTools: Object.keys(captured.config.tools) });
}

describe("connected MCP exact tool identifier repair", () => {
  it("repairs one uniquely omitted collision suffix and runs the exact read tool once", async () => {
    const calls: unknown[] = [];
    const exact = "portable__search_records__0123456789abcdef";
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });

    await llm.answer(
      { question: "Find the record", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      {
        [exact]: {
          connectedMcp: true,
          description: "Search records.",
          annotations: { readOnlyHint: true },
          inputSchema: z.object({ query: z.string() }),
          run: async (input) => {
            calls.push(input);
            return '{"answer":"found"}';
          },
        },
      },
    );

    const original = {
      type: "tool-call",
      toolCallId: "repair-read-1",
      toolName: "portable__search_records",
      input: '{"query":"ring"}',
    };
    const repaired = await captured.config.experimental_repairToolCall({
      toolCall: original,
      tools: captured.config.tools,
      error: missingToolError(original.toolName),
    });

    expect(repaired).toEqual({ ...original, toolName: exact });
    expect(captured.config.messages[0].content).toContain("EXACT CONNECTED TOOL IDENTIFIERS");
    expect(await captured.config.tools[repaired.toolName].execute({ query: "ring" })).toBe('{"answer":"found"}');
    expect(calls).toEqual([{ query: "ring" }]);
  });

  it("fails closed when the omitted suffix base is ambiguous or not exact", () => {
    const tools = [
      "portable__shared_prefix__0123456789abcdef",
      "portable__shared_prefix__fedcba9876543210",
    ];

    expect(uniqueSuffixedPeerToolName("portable__shared_prefix", tools)).toBeNull();
    expect(uniqueSuffixedPeerToolName("portable__shared", tools)).toBeNull();
    expect(uniqueSuffixedPeerToolName("portable__delete_records", tools)).toBeNull();
  });

  it("does not repair invalid arguments", async () => {
    const exact = "portable__search_records__0123456789abcdef";
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    await llm.answer(
      { question: "Find a record", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      {
        [exact]: {
          connectedMcp: true,
          description: "Search records.",
          annotations: { readOnlyHint: true },
          inputSchema: z.object({ query: z.string() }),
          run: async () => "found",
        },
      },
    );

    const toolCall = { type: "tool-call", toolCallId: "bad-input", toolName: exact, input: "{}" };
    const repaired = await captured.config.experimental_repairToolCall({
      toolCall,
      tools: captured.config.tools,
      error: new InvalidToolInputError({ toolName: exact, toolInput: "{}", cause: new Error("query required") }),
    });

    expect(repaired).toBeNull();
  });

  it("preserves the exact tool's mutation guard after name repair", async () => {
    const upstream = vi.fn(async () => "changed");
    const exact = "portable__create_record__0123456789abcdef";
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k" });
    await llm.answer(
      { question: "Read the current context without changing anything.", vaultBriefing: "brief", conversation: [] },
      readTools,
      undefined,
      undefined,
      {
        [exact]: {
          connectedMcp: true,
          verifiedMutationReceipt: true,
          description: "Create a remote record.",
          annotations: { readOnlyHint: false },
          inputSchema: z.object({ text: z.string() }),
          run: upstream,
        },
      },
    );

    const original = {
      type: "tool-call",
      toolCallId: "repair-write-1",
      toolName: "portable__create_record",
      input: '{"text":"do not write"}',
    };
    const repaired = await captured.config.experimental_repairToolCall({
      toolCall: original,
      tools: captured.config.tools,
      error: missingToolError(original.toolName),
    });
    const result = await captured.config.tools[repaired.toolName].execute({ text: "do not write" });

    expect(repaired.toolName).toBe(exact);
    expect(result).toMatch(/^ERROR: Blocked /);
    expect(upstream).not.toHaveBeenCalled();
  });
});
