import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSOLE_AGENT, EPAMINON_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("Console mesh gateway contract", () => {
  let dir: string;
  let runtime: Runtime;
  let server: ServerType;
  let url: URL;
  let token: string;
  let epaminonDir: string;
  let epaminonRuntime: Runtime;
  let epaminonServer: ServerType;

  beforeAll(async () => {
    epaminonDir = await mkdtemp(join(tmpdir(), "zenod-mesh-epaminon-"));
    epaminonRuntime = new Runtime(epaminonDir, EPAMINON_AGENT);
    await epaminonRuntime.executionQueue!.enqueue({
      executionId: "104",
      target: "AlfaBlok/obsidian-brain#103",
      context: "Fusion spike execution context",
    });
    const epaminonApp = createApp(epaminonRuntime);
    epaminonServer = serve({ fetch: epaminonApp.fetch, port: 0 });
    const epaminonPort = (epaminonServer.address() as AddressInfo).port;
    const epaminonUrl = `http://127.0.0.1:${epaminonPort}/mcp`;

    dir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-"));
    runtime = new Runtime(dir, CONSOLE_AGENT);
    token = runtime.settings.apiToken();
    runtime.settings.setPeers([
      { name: "zenod", url: "http://zenod.test/mcp", token: "zenod-token" },
      { name: "archus", url: "http://archus.test/mcp", token: "archus-token" },
      { name: "epaminon", url: epaminonUrl, token: epaminonRuntime.settings.apiToken() },
      { name: "outbound", url: "http://outbound.test/mcp", token: "outbound-token" },
      { name: "phylax", url: "http://phylax.test/mcp", token: "phylax-token" },
    ]);
    const app = createApp(runtime);
    server = serve({ fetch: app.fetch, port: 0 });
    const { port } = server.address() as AddressInfo;
    url = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    server.close();
    runtime.close();
    epaminonServer.close();
    epaminonRuntime.close();
    await rm(dir, { recursive: true, force: true });
    await rm(epaminonDir, { recursive: true, force: true });
  });

  async function connectGateway(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "mesh-test-client", version: "0.0.0" });
    await client.connect(transport);
    return client;
  }

  async function listGatewayToolNames(): Promise<string[]> {
    const client = await connectGateway();
    try {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name).sort();
    } finally {
      await client.close();
    }
  }

  it("publishes only the curated semantic suite surface", async () => {
    await expect(listGatewayToolNames()).resolves.toEqual([
      "ask_archus",
      "ask_brain",
      "ask_outbound",
      "ask_phylax",
      "close_issue",
      "create_issue",
      "edit_issue",
      "execution_status",
      "get_memory",
      "get_task_result",
      "post_reddit",
      "post_tweet",
      "raise_event",
      "search_memory",
      "send_email",
      "store_memory",
    ]);
  });

  it("never republishes internal execution-lane or raw mechanical tools", async () => {
    const tools = await listGatewayToolNames();
    expect(tools).not.toContain("enqueue_execution");
    expect(tools).not.toContain("approve_execution");
    expect(tools).not.toContain("apply_execution_event");
    expect(tools).not.toContain("edit_github_issue");
    expect(tools).not.toContain("clean_slate_vault");
    expect(tools).not.toContain("run_task");
  });

  it("routes execution_status to Epaminon's native status tool, not chat", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({ name: "execution_status", arguments: { message: "AlfaBlok/obsidian-brain#103" } });
      const status = result.structuredContent as {
        tickets: Array<{ executionId: string; target: string; state: string }>;
      };
      expect(status.tickets).toEqual([
        expect.objectContaining({
          executionId: "104",
          target: "AlfaBlok/obsidian-brain#103",
          state: "running",
        }),
      ]);
      expect(JSON.stringify(result.content)).toContain("AlfaBlok/obsidian-brain#103");
    } finally {
      await client.close();
    }
  });
});
