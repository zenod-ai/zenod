import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { __resetApprovalTokens } from "../src/approvalTokens.js";

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

describe("D9 exact standing approval at the AI SDK execution boundary", () => {
  beforeEach(() => __resetApprovalTokens());

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
});
