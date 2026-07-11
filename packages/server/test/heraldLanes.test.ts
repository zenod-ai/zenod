import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HeraldLaneService } from "../src/heraldLanes.js";
import type { PeerConfig, PeerToolResult } from "../src/peerClient.js";
import type { Runtime } from "../src/runtime.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function peer(name: string, tools: string[]): PeerConfig {
  return {
    name,
    url: `https://${name.toLowerCase()}.zenod.dev/mcp/token`,
    token: `${name}-token`,
    wallet: true,
    tools: tools.map((tool) => ({
      as: tool,
      mcp: tool,
      arg: "input",
      description: tool,
    })),
  };
}

function text(
  value: string,
  structuredContent?: Record<string, unknown>,
): PeerToolResult {
  return {
    content: [{ type: "text", text: value }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "herald-lanes-"));
  dirs.push(dataDir);
  const chat: string[] = [];
  const prompts: string[] = [];
  const calls: Array<{
    peer: string;
    tool: string;
    args: Record<string, unknown>;
  }> = [];
  const peers = [
    peer("Zenod", ["search_memory", "get_memory", "store_memory"]),
    peer("Calli", ["createPosts", "approve_send"]),
  ];
  const runtime = {
    settings: { peers: () => peers },
    state: {
      appendMessage: async (_id: string, _role: string, value: string) => {
        chat.push(value);
      },
    },
  } as unknown as Runtime;
  const callTool = vi.fn(
    async (
      target: PeerConfig,
      toolName: string,
      args: Record<string, unknown>,
    ) => {
      calls.push({ peer: target.name, tool: toolName, args });
      if (toolName === "search_memory") {
        return text("Projects/Launch.md", {
          hits: [
            {
              path: "Projects/Launch.md",
              githubUrl:
                "https://github.com/acme/brain/blob/main/Projects/Launch.md",
            },
          ],
        });
      }
      if (toolName === "get_memory") {
        return text("Launch shipped with a customer-first story.", {
          path: "Projects/Launch.md",
          body: "Launch shipped with a customer-first story.",
          githubUrl:
            "https://github.com/acme/brain/blob/main/Projects/Launch.md",
        });
      }
      if (toolName === "createPosts")
        return text("[draft_not_approved] held as dr_123");
      if (toolName === "approve_send")
        return text(
          "Posted to X. Live URL: https://x.com/i/web/status/123456789",
        );
      throw new Error(`unexpected tool ${toolName}`);
    },
  );
  const service = new HeraldLaneService(dataDir, {
    runtimeForTenant: () => runtime,
    callTool,
    callToolText: async () =>
      "Stored.\ncommit: abc123\nhttps://github.com/acme/brain/commit/abc123",
    answer: async (_runtime, prompt) => {
      prompts.push(prompt);
      return JSON.stringify([
        {
          text: "The launch is alive.",
          rationale: "Builds on the customer-first launch story.",
          sourceIndex: 0,
        },
      ]);
    },
    startScheduler: false,
    log: { info: () => undefined, error: () => undefined },
  });
  service.store.approveBriefing({
    tenantId: "alpha",
    content: {
      theme: "launch",
      objectives: ["show proof"],
      tone: "direct",
      replyPolicy: "few",
    },
    cadenceMinutes: 15,
    proposalCount: 1,
  });
  return { service, chat, prompts, calls, callTool };
}

describe("Herald proposer and poster lanes", () => {
  it("reads tenant memory, creates a cited proposal, and emits a chat receipt", async () => {
    const { service, chat, calls } = await fixture();
    try {
      await expect(service.proposeNow("alpha")).resolves.toMatchObject({
        status: "completed",
        code: "wake_completed",
      });
      expect(calls.map((call) => call.tool)).toEqual([
        "search_memory",
        "get_memory",
      ]);
      expect(service.getBoard("alpha").items).toEqual([
        expect.objectContaining({
          state: "proposed",
          rationale: "Builds on the customer-first launch story.",
          memoryCitation:
            "https://github.com/acme/brain/blob/main/Projects/Launch.md",
        }),
      ]);
      expect(chat.at(-1)).toContain("1 substantiated proposal");
    } finally {
      service.close();
    }
  });

  it("uses Calli's C-22 draft then approve_send, stores the canonical permalink, and feeds the filing into the next wake", async () => {
    const { service, calls, prompts } = await fixture();
    try {
      await service.proposeNow("alpha");
      const item = service.getBoard("alpha").items[0];
      await expect(
        service.approveAndPublish("alpha", [item.id]),
      ).resolves.toMatchObject({
        status: "ok",
        published: [
          {
            itemId: item.id,
            permalink: "https://x.com/i/web/status/123456789",
          },
        ],
      });
      expect(calls.slice(-2).map((call) => [call.tool, call.args])).toEqual([
        ["createPosts", { text: "The launch is alive." }],
        ["approve_send", { channel: "x", text: "The launch is alive." }],
      ]);
      expect(service.getBoard("alpha").items[0]).toMatchObject({
        state: "posted",
        permalink: "https://x.com/i/web/status/123456789",
      });

      await service.proposeNow("alpha");
      expect(prompts[1]).toContain(
        "Recent filings MUST visibly shape the new ideas",
      );
      expect(prompts[1]).toContain("Build on this outcome in the next wake");
    } finally {
      service.close();
    }
  });

  it("never calls approve_send unless Calli first proves the draft was held", async () => {
    const { service, callTool } = await fixture();
    callTool.mockImplementation(async (_target, toolName) => {
      if (toolName === "search_memory")
        return text("Projects/Launch.md", {
          hits: [{ path: "Projects/Launch.md" }],
        });
      if (toolName === "get_memory")
        return text("memory", { path: "Projects/Launch.md", body: "memory" });
      if (toolName === "createPosts")
        return text("unexpected success without C-22");
      return text("must not run");
    });
    try {
      await service.proposeNow("alpha");
      const item = service.getBoard("alpha").items[0];
      await expect(
        service.approveAndPublish("alpha", [item.id]),
      ).rejects.toThrow("did not hold the draft under C-22");
      expect(
        callTool.mock.calls.filter((call) => call[1] === "approve_send"),
      ).toHaveLength(0);
    } finally {
      service.close();
    }
  });
});
