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
});
