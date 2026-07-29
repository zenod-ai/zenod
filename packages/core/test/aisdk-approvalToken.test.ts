import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { __resetApprovalTokens } from "../src/approvalTokens.js";

const captured: {
  config?: any;
  generateImplementation?: (config: any) => Promise<any>;
  streamImplementation?: (config: any) => any;
  streamCalls: number;
} = { streamCalls: 0 };
vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();
  return {
    ...actual,
    generateText: (config: any) => {
      captured.config = config;
      if (captured.generateImplementation) return captured.generateImplementation(config);
      return Promise.resolve({ text: "answer", totalUsage: {}, providerMetadata: {} });
    },
    streamText: (config: any) => {
      captured.streamCalls += 1;
      if (captured.streamImplementation) return captured.streamImplementation(config);
      return actual.streamText(config);
    },
  };
});

import { createBrainLlm } from "../src/llm/aisdk.js";
import { createEngine } from "../src/engine/engine.js";
import { SqliteStateStore } from "../src/state/sqlite.js";

const readTools = {
  searchVault: async () => "no hits",
  readNote: async () => "note",
  listPages: async () => "pages",
};

function elevatedPeer(calls: unknown[]) {
  return {
    portable__publish__0123456789abcdef: {
      owner: "tenant-a-connection",
      connectedMcp: true,
      trustedProfile: {
        exposure: "external" as const,
        tenantScope: "tenant" as const,
        financialScope: "none" as const,
        trustMcpAnnotations: true,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      description: "A discovered operation.",
      inputSchema: z.object({ text: z.string() }),
      verifiedMutationReceipt: true,
      run: async (input: unknown) => {
        calls.push(input);
        return "Published with receipt object_42";
      },
    },
  };
}

function privateBatchPeers(calls: unknown[]) {
  const peer = (tool: string) => ({
    owner: "tenant-a-connection",
    connectedMcp: true,
    trustedProfile: {
      exposure: "private" as const,
      tenantScope: "tenant" as const,
      financialScope: "none" as const,
      trustMcpAnnotations: true,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    description: "A private tenant-scoped discovered operation.",
    inputSchema: z.object({ text: z.string() }),
    run: async (input: unknown) => {
      calls.push({ tool, input });
      return `Completed ${tool}`;
    },
  });
  return {
    portable__first__0123456789abcdef: peer("first"),
    portable__second__fedcba9876543210: peer("second"),
  };
}

describe("D9 exact standing approval at the AI SDK execution boundary", () => {
  beforeEach(() => {
    __resetApprovalTokens();
    captured.config = undefined;
    captured.generateImplementation = undefined;
    captured.streamImplementation = undefined;
    captured.streamCalls = 0;
  });

  it("holds an elevated-risk exact proposal, then releases the same tool and arguments once", async () => {
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const peerTools = elevatedPeer(calls);

    await llm.answer(
      {
        question: "Prepare this exact external operation.",
        conversationId: "tenant-a:ring:one",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    const held = await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "exact" });
    expect(held).toContain("[approval_required]");
    expect(calls).toEqual([]);

    await llm.answer(
      {
        question: "Yes, approve.",
        conversationId: "tenant-a:ring:one",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    const released = await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "exact" });
    expect(released).toBe("Published with receipt object_42");
    expect(calls).toEqual([{ text: "exact" }]);

    await llm.answer(
      {
        question: "Yes, approve.",
        conversationId: "tenant-a:ring:one",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    expect(await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "exact" }))
      .toBe("Nothing pending to approve.");
    expect(calls).toHaveLength(1);
  });

  it("does not release changed arguments", async () => {
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const peerTools = elevatedPeer(calls);

    await llm.answer(
      {
        question: "Prepare it.",
        conversationId: "tenant-a:ring:two",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "original" });

    await llm.answer(
      {
        question: "Approve.",
        conversationId: "tenant-a:ring:two",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    expect(await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "changed" }))
      .toContain("exact arguments do not match");
    expect(calls).toEqual([]);
  });

  it("does not release the same arguments through another tool on the same connection", async () => {
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const publish = elevatedPeer(calls).portable__publish__0123456789abcdef;
    const peerTools = {
      portable__publish__0123456789abcdef: publish,
      portable__schedule__fedcba9876543210: {
        ...publish,
        run: async (input: unknown) => {
          calls.push(input);
          return "Scheduled with receipt object_43";
        },
      },
    };

    await llm.answer(
      {
        question: "Prepare it.",
        conversationId: "tenant-a:ring:cross-tool",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "exact" });

    await llm.answer(
      {
        question: "Approve.",
        conversationId: "tenant-a:ring:cross-tool",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    expect(await captured.config.tools.portable__schedule__fedcba9876543210.execute({ text: "exact" }))
      .toContain("exact arguments do not match");
    expect(calls).toEqual([]);
  });

  it("does not release a held operation with extra arguments", async () => {
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const peerTools = elevatedPeer(calls);

    await llm.answer(
      {
        question: "Prepare it.",
        conversationId: "tenant-a:ring:extra-args",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    await captured.config.tools.portable__publish__0123456789abcdef.execute({ text: "exact" });

    await llm.answer(
      {
        question: "Approve.",
        conversationId: "tenant-a:ring:extra-args",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    expect(await captured.config.tools.portable__publish__0123456789abcdef.execute({
      text: "exact",
      audience: "public",
    })).toContain("exact arguments do not match");
    expect(calls).toEqual([]);
  });

  it("rejects a two-proposal connected-tool batch before either upstream call", async () => {
    const calls: unknown[] = [];
    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const peerTools = privateBatchPeers(calls);

    await llm.answer(
      {
        question: "Do both.",
        conversationId: "tenant-a:ring:two-proposals",
        vaultBriefing: "brief",
        conversation: [],
      },
      readTools,
      undefined,
      undefined,
      peerTools,
    );
    await captured.config.tools.portable__first__0123456789abcdef.needsApproval({ text: "one" });
    await captured.config.tools.portable__second__fedcba9876543210.needsApproval({ text: "two" });
    const results = await Promise.all([
      captured.config.tools.portable__first__0123456789abcdef.execute({ text: "one" }),
      captured.config.tools.portable__second__fedcba9876543210.execute({ text: "two" }),
    ]);
    expect(results).toEqual([
      "ERROR: Ring accepts exactly one connected-tool proposal per turn; ask one clarifying question.",
      "ERROR: Ring accepts exactly one connected-tool proposal per turn; ask one clarifying question.",
    ]);
    expect(calls).toEqual([]);
  });

  it("renders a rejected two-mutation proposal batch as one honest mutation failure at the engine boundary", async () => {
    const calls: unknown[] = [];
    const firstName = "portable__first__0123456789abcdef";
    const secondName = "portable__second__fedcba9876543210";
    captured.generateImplementation = async (config) => {
      await config.tools[firstName].needsApproval({ text: "one" });
      await config.tools[secondName].needsApproval({ text: "two" });
      const results = await Promise.all([
        config.tools[firstName].execute({ text: "one" }),
        config.tools[secondName].execute({ text: "two" }),
      ]);
      return {
        text: results.join("\n"),
        totalUsage: {},
        providerMetadata: {},
      };
    };
    const engine = createEngine({
      llm: createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 }),
      state: new SqliteStateStore(":memory:"),
      peerTools: privateBatchPeers(calls),
    });

    const reply = await engine.chat("Do both.", "tenant-a:ring:two-proposal-outcome");

    expect(reply.text).toBe("Nothing was changed: no verified same-turn mutation receipt was returned.");
    expect(reply.text).not.toContain("couldn't read");
    expect(reply.text).not.toContain("exactly one connected-tool proposal");
    expect(calls).toEqual([]);
  });

  it("uses a full model-step barrier instead of staggered stream tool execution", async () => {
    const calls: unknown[] = [];
    const deltas: string[] = [];
    const firstName = "portable__first__0123456789abcdef";
    const secondName = "portable__second__fedcba9876543210";
    captured.generateImplementation = async (config) => {
      // generateText's production lifecycle parses the whole step and runs every
      // needsApproval preflight before executeTools crosses an upstream boundary.
      await config.tools[firstName].needsApproval({ text: "one" });
      await config.tools[secondName].needsApproval({ text: "two" });
      const results = await Promise.all([
        config.tools[firstName].execute({ text: "one" }),
        config.tools[secondName].execute({ text: "two" }),
      ]);
      return {
        text: results.join("\n"),
        totalUsage: {},
        providerMetadata: {},
      };
    };
    captured.streamImplementation = (config) => {
      // This mirrors streamText's hazardous lifecycle: execute the first complete
      // tool-call chunk immediately, then receive a distinct call in a later chunk.
      const first = config.tools[firstName].execute({ text: "one" });
      return {
        fullStream: (async function* () {
          yield { type: "tool-call", toolName: firstName, input: { text: "one" } };
          await new Promise((resolve) => setTimeout(resolve, 5));
          const second = config.tools[secondName].execute({ text: "two" });
          yield { type: "tool-call", toolName: secondName, input: { text: "two" } };
          yield { type: "tool-result", toolName: firstName, input: { text: "one" }, output: await first };
          yield { type: "tool-result", toolName: secondName, input: { text: "two" }, output: await second };
          yield { type: "text-delta", text: "answer" };
        })(),
        totalUsage: Promise.resolve({}),
        providerMetadata: Promise.resolve({}),
        response: Promise.resolve({ messages: [] }),
      };
    };

    const llm = createBrainLlm({ provider: "anthropic", apiKey: "k", maxSteps: 5 });
    const result = await llm.answer(
      {
        question: "Do both as streamed tool calls.",
        conversationId: "tenant-a:ring:staggered-stream",
        vaultBriefing: "brief",
        conversation: [],
        onTextDelta: (delta) => deltas.push(delta),
      },
      readTools,
      undefined,
      undefined,
      privateBatchPeers(calls),
    );

    expect(captured.streamCalls).toBe(0);
    expect(result.text.match(/exactly one connected-tool proposal/g)).toHaveLength(2);
    expect(deltas.join("")).toBe(result.text);
    expect(calls).toEqual([]);
  });
});
