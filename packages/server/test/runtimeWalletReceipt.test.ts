import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine, PeerTools } from "zenod";

vi.mock("../src/walletUrl.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/walletUrl.js")>();
  return { ...original, validateWalletUrl: vi.fn(async () => undefined) };
});

import { RING_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("Ring wallet receipt", () => {
  it("waits for a Zenod store_memory job and returns its commit receipt", async () => {
    const zenodDir = await mkdtemp(join(tmpdir(), "zenod-runtime-wallet-store-zenod-"));
    const ringDir = await mkdtemp(join(tmpdir(), "zenod-runtime-wallet-store-ring-"));
    let zenodServer: ServerType | undefined;
    const zenodRuntime = new Runtime(zenodDir);
    const ringRuntime = new Runtime(ringDir, RING_AGENT);
    try {
      zenodRuntime.getEngine = async () =>
        ({
          async store() {
            return {
              evidenceRef: "Log/2026-07-11.md#^e-ring",
              pagesTouched: ["Projects/Ring.md"],
              commitSha: "b".repeat(40),
              githubUrls: ["https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Ring.md"],
            };
          },
        }) as BrainEngine;
      const zenodApp = createApp(zenodRuntime);
      zenodServer = serve({ fetch: zenodApp.fetch, port: 0 });
      const zenodPort = (zenodServer.address() as AddressInfo).port;
      ringRuntime.settings.setPeers([
        {
          name: "zenod",
          url: `http://127.0.0.1:${zenodPort}/mcp`,
          token: zenodRuntime.settings.apiToken(),
          wallet: true,
          tools: [{ as: "add_memory", mcp: "store_memory", arg: "content", description: "Store memory." }],
        },
      ]);

      const tools = (ringRuntime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();
      expect(tools.add_memory.verifiedMutationReceipt).toBe(true);
      const result = await tools.add_memory.run("remember this: the ring is alive");

      expect(result).toContain("Stored.");
      expect(result).toContain("evidence: Log/2026-07-11.md#^e-ring");
      expect(result).toContain(`commit: ${"b".repeat(40)}`);
      expect(result).toContain("https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Ring.md");
    } finally {
      zenodServer?.close();
      zenodRuntime.close();
      ringRuntime.close();
      await rm(zenodDir, { recursive: true, force: true });
      await rm(ringDir, { recursive: true, force: true });
    }
  });

  it("uses MCP readOnlyHint generically for wallet receipt gating", async () => {
    const ringDir = await mkdtemp(join(tmpdir(), "zenod-runtime-wallet-contract-ring-"));
    const ringRuntime = new Runtime(ringDir, RING_AGENT);
    try {
      ringRuntime.settings.setPeers([
        {
          name: "portable-peer",
          url: "https://unit.example/mcp",
          token: "test-token",
          wallet: true,
          tools: [
            {
              as: "future_write_tool",
              mcp: "createPosts",
              arg: "text",
              description: "Create a post and return its verified receipt.",
              annotations: { readOnlyHint: false, destructiveHint: true },
            },
            {
              as: "future_read_tool",
              mcp: "searchPostsRecent",
              arg: "query",
              description: "Search recent posts.",
              annotations: { readOnlyHint: true, destructiveHint: false },
            },
            {
              as: "unknown_unannotated_tool",
              mcp: "ask_brain",
              arg: "question",
              description: "A future unannotated delegation tool.",
            },
          ],
        },
        {
          name: "default-peer",
          url: "https://default.example/mcp",
          token: "test-token",
          wallet: true,
        },
      ]);

      const tools = (ringRuntime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();

      expect(tools.future_write_tool.verifiedMutationReceipt).toBe(true);
      expect(tools.future_read_tool.verifiedMutationReceipt).toBeUndefined();
      expect(tools.unknown_unannotated_tool.verifiedMutationReceipt).toBeUndefined();
      expect(tools.ask_default_peer.verifiedMutationReceipt).toBeUndefined();
    } finally {
      ringRuntime.close();
      await rm(ringDir, { recursive: true, force: true });
    }
  });
});
