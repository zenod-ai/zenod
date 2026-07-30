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

import { HERALD_AGENT, RING_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("Ring wallet receipt", () => {
  it("marks the host catalog as requiring explicit catalog intent", async () => {
    const ringDir = await mkdtemp(join(tmpdir(), "ring-runtime-catalog-intent-"));
    const ringRuntime = new Runtime(ringDir, RING_AGENT);
    try {
      const tools = (ringRuntime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();
      expect(tools.inspect_connected_mcp_catalog).toMatchObject({
        authoritativeReadResult: true,
        requiresMcpCatalogIntent: true,
      });
    } finally {
      ringRuntime.close();
      await rm(ringDir, { recursive: true, force: true });
    }
  });

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
              evidenceUrl: `https://github.com/AlfaBlok/obsidian-brain/blob/${"b".repeat(40)}/Log/2026-07-11.md#L9`,
              pagesTouched: ["Projects/Ring.md"],
              pageUrls: [`https://github.com/AlfaBlok/obsidian-brain/blob/${"b".repeat(40)}/Projects/Ring.md`],
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

      expect(JSON.parse(result)).toEqual({
        status: "done",
        message: "Saved.",
        evidenceRef: "Log/2026-07-11.md#^e-ring",
        evidenceUrl: `https://github.com/AlfaBlok/obsidian-brain/blob/${"b".repeat(40)}/Log/2026-07-11.md#L9`,
        pagesTouched: ["Projects/Ring.md"],
        pageUrls: [`https://github.com/AlfaBlok/obsidian-brain/blob/${"b".repeat(40)}/Projects/Ring.md`],
        commitSha: "b".repeat(40),
        githubUrls: ["https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Ring.md"],
        filing: "filed",
      });
    } finally {
      zenodServer?.close();
      zenodRuntime.close();
      ringRuntime.close();
      await rm(zenodDir, { recursive: true, force: true });
      await rm(ringDir, { recursive: true, force: true });
    }
  });

  it("keeps Herald model turns read-only while deterministic loop lanes retain wallet custody", async () => {
    const heraldDir = await mkdtemp(join(tmpdir(), "zenod-runtime-wallet-herald-read-only-"));
    const heraldRuntime = new Runtime(heraldDir, HERALD_AGENT);
    try {
      heraldRuntime.settings.setPeers([{
        name: "Calli",
        url: "https://calli.example/mcp",
        token: "downstream-token",
        wallet: true,
        tools: [
          {
            as: "calli_publish",
            mcp: "approve_send",
            arg: "text",
            description: "Publish a held post.",
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
          {
            as: "calli_status",
            mcp: "status",
            arg: "query",
            description: "Read connection status.",
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            as: "calli_unannotated",
            mcp: "future_tool",
            arg: "input",
            description: "Unknown authority must not reach Herald's model.",
          },
        ],
      }]);

      const tools = (heraldRuntime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();
      expect(tools.calli_status).toBeDefined();
      expect(tools.calli_publish).toBeUndefined();
      expect(tools.calli_unannotated).toBeUndefined();
    } finally {
      heraldRuntime.close();
      await rm(heraldDir, { recursive: true, force: true });
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
      expect(tools.ask_default_peer).toBeUndefined();
    } finally {
      ringRuntime.close();
      await rm(ringDir, { recursive: true, force: true });
    }
  });
});
