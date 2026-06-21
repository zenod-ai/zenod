import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { ARCHUS_AGENT, CONSOLE_AGENT, EPAMINON_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("Console mesh gateway contract", () => {
  let dir: string;
  let runtime: Runtime;
  let server: ServerType;
  let url: URL;
  let token: string;
  let archusDir: string;
  let archusRuntime: Runtime;
  let archusServer: ServerType;
  let archusUrl: string;
  let epaminonDir: string;
  let epaminonRuntime: Runtime;
  let epaminonServer: ServerType;
  let epaminonUrl: string;

  beforeAll(async () => {
    archusDir = await mkdtemp(join(tmpdir(), "zenod-mesh-archus-"));
    archusRuntime = new Runtime(archusDir, ARCHUS_AGENT);
    archusRuntime.getEngine = async () =>
      ({
        async chat(message: string) {
          return { text: `ARCHUS_CHAT:\n${message}`, sources: [] };
        },
      }) as BrainEngine;
    const archusApp = createApp(archusRuntime);
    archusServer = serve({ fetch: archusApp.fetch, port: 0 });
    const archusPort = (archusServer.address() as AddressInfo).port;
    archusUrl = `http://127.0.0.1:${archusPort}/mcp`;

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
    epaminonUrl = `http://127.0.0.1:${epaminonPort}/mcp`;

    dir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-"));
    runtime = new Runtime(dir, CONSOLE_AGENT);
    token = runtime.settings.apiToken();
    runtime.settings.setPeers([
      { name: "zenod", url: "http://zenod.test/mcp", token: "zenod-token" },
      { name: "archus", url: archusUrl, token: archusRuntime.settings.apiToken() },
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
    archusServer.close();
    archusRuntime.close();
    epaminonServer.close();
    epaminonRuntime.close();
    await rm(dir, { recursive: true, force: true });
    await rm(archusDir, { recursive: true, force: true });
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

  async function listGatewayTools(): Promise<Array<{ name: string; outputSchema?: unknown }>> {
    const client = await connectGateway();
    try {
      const { tools } = await client.listTools();
      return tools;
    } finally {
      await client.close();
    }
  }

  async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const old = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of old) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("publishes only the curated semantic suite surface", async () => {
    await expect(listGatewayToolNames()).resolves.toEqual([
      "archus.request_backlog_action",
      "archus.run_issue",
      "ask_archus",
      "ask_brain",
      "ask_outbound",
      "ask_phylax",
      "chat_with_console",
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

  it("does not advertise strict v4 output schemas by default", async () => {
    const tools = await listGatewayTools();
    expect(tools.find((tool) => tool.name === "execution_status")?.outputSchema).toBeUndefined();
  });

  it("does not advertise strict v4 output schemas for legacy tools even when allowlisted", async () => {
    await withEnv(
      {
        ZENOD_V4_STRICT_OUTPUT_SCHEMA: "true",
        ZENOD_V4_STRICT_TOOLS: "execution_status",
      },
      async () => {
        const strictDir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-strict-"));
        const strictRuntime = new Runtime(strictDir, CONSOLE_AGENT);
        const strictToken = strictRuntime.settings.apiToken();
        let strictServer: ServerType | undefined;
        try {
          strictRuntime.settings.setPeers([{ name: "epaminon", url: epaminonUrl, token: epaminonRuntime.settings.apiToken() }]);
          const app = createApp(strictRuntime);
          strictServer = serve({ fetch: app.fetch, port: 0 });
          const { port } = strictServer.address() as AddressInfo;
          const strictUrl = new URL(`http://127.0.0.1:${port}/mcp`);
          const transport = new StreamableHTTPClientTransport(strictUrl, {
            requestInit: { headers: { Authorization: `Bearer ${strictToken}` } },
          });
          const client = new Client({ name: "mesh-test-client-strict", version: "0.0.0" });
          await client.connect(transport);
          try {
            const { tools } = await client.listTools();
            const status = tools.find((tool) => tool.name === "execution_status");
            expect(status?.outputSchema).toBeUndefined();
          } finally {
            await client.close();
          }
        } finally {
          strictServer?.close();
          strictRuntime.close();
          await rm(strictDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("publishes the canonical v4 Epaminon status tool only under the v4 tool-name flag", async () => {
    await withEnv(
      {
        ZENOD_V4_TOOL_NAMES: "true",
        ZENOD_V4_STRICT_OUTPUT_SCHEMA: "true",
        ZENOD_V4_STRICT_TOOLS: "epaminon.execution_status",
      },
      async () => {
        const strictDir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-v4-status-"));
        const strictRuntime = new Runtime(strictDir, CONSOLE_AGENT);
        const strictToken = strictRuntime.settings.apiToken();
        let strictServer: ServerType | undefined;
        try {
          strictRuntime.settings.setPeers([{ name: "epaminon", url: epaminonUrl, token: epaminonRuntime.settings.apiToken() }]);
          const app = createApp(strictRuntime);
          strictServer = serve({ fetch: app.fetch, port: 0 });
          const { port } = strictServer.address() as AddressInfo;
          const strictUrl = new URL(`http://127.0.0.1:${port}/mcp`);
          const transport = new StreamableHTTPClientTransport(strictUrl, {
            requestInit: { headers: { Authorization: `Bearer ${strictToken}` } },
          });
          const client = new Client({ name: "mesh-test-client-v4-status", version: "0.0.0" });
          await client.connect(transport);
          try {
            const { tools } = await client.listTools();
            const status = tools.find((tool) => tool.name === "epaminon.execution_status");
            expect(status?.inputSchema).toEqual(
              expect.objectContaining({
                properties: expect.objectContaining({
                  workIssue: expect.any(Object),
                  executionId: expect.any(Object),
                }),
              }),
            );
            expect(status?.outputSchema).toEqual(
              expect.objectContaining({
                $id: "https://zenod.dev/schemas/tool-output/epaminon.execution_status.json",
              }),
            );

            const result = await client.callTool({
              name: "epaminon.execution_status",
              arguments: { workIssue: "AlfaBlok/obsidian-brain#103" },
            });
            expect(result.structuredContent).toEqual(
              expect.objectContaining({
                evidence: [
                  expect.objectContaining({
                    kind: "execution_status",
                    executionId: "104",
                    workIssue: "AlfaBlok/obsidian-brain#103",
                  }),
                ],
              }),
            );
          } finally {
            await client.close();
          }
        } finally {
          strictServer?.close();
          strictRuntime.close();
          await rm(strictDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("publishes canonical v4 Archus read tools only under the v4 tool-name flag", async () => {
    await withEnv(
      {
        ZENOD_V4_TOOL_NAMES: "true",
        ZENOD_V4_STRICT_OUTPUT_SCHEMA: "true",
        ZENOD_V4_STRICT_TOOLS: "archus.get_issue,archus.find_issue,archus.list_issues",
      },
      async () => {
        const strictDir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-v4-archus-"));
        const strictRuntime = new Runtime(strictDir, CONSOLE_AGENT);
        const strictToken = strictRuntime.settings.apiToken();
        let strictServer: ServerType | undefined;
        try {
          strictRuntime.settings.setPeers([{ name: "archus", url: "http://archus.test/mcp", token: "archus-token" }]);
          const app = createApp(strictRuntime);
          strictServer = serve({ fetch: app.fetch, port: 0 });
          const { port } = strictServer.address() as AddressInfo;
          const strictUrl = new URL(`http://127.0.0.1:${port}/mcp`);
          const transport = new StreamableHTTPClientTransport(strictUrl, {
            requestInit: { headers: { Authorization: `Bearer ${strictToken}` } },
          });
          const client = new Client({ name: "mesh-test-client-v4-archus", version: "0.0.0" });
          await client.connect(transport);
          try {
            const { tools } = await client.listTools();
            const getIssue = tools.find((tool) => tool.name === "archus.get_issue");
            const findIssue = tools.find((tool) => tool.name === "archus.find_issue");
            const listIssues = tools.find((tool) => tool.name === "archus.list_issues");
            expect(getIssue?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ target: expect.any(Object) }) }));
            expect(findIssue?.inputSchema).toEqual(
              expect.objectContaining({ properties: expect.objectContaining({ reference: expect.any(Object) }) }),
            );
            expect(listIssues?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ state: expect.any(Object) }) }));
            expect(getIssue?.outputSchema).toEqual(
              expect.objectContaining({ $id: "https://zenod.dev/schemas/tool-output/archus.get_issue.json" }),
            );
            expect(findIssue?.outputSchema).toEqual(
              expect.objectContaining({ $id: "https://zenod.dev/schemas/tool-output/archus.find_issue.json" }),
            );
            expect(listIssues?.outputSchema).toEqual(
              expect.objectContaining({ $id: "https://zenod.dev/schemas/tool-output/archus.list_issues.json" }),
            );
          } finally {
            await client.close();
          }
        } finally {
          strictServer?.close();
          strictRuntime.close();
          await rm(strictDir, { recursive: true, force: true });
        }
      },
    );
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

  it("routes archus.request_backlog_action to Archus chat with the backlog-action directive", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "archus.request_backlog_action",
        arguments: { message: "Create a bug for the Console issue lookup confusion." },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain("ARCHUS_CHAT");
      expect(text).toContain("Backlog action request");
      expect(text).toContain("Create a bug for the Console issue lookup confusion");
      expect(text).toContain("Do not run/queue execution");
    } finally {
      await client.close();
    }
  });

  it("routes archus.run_issue to Archus chat with an exact run directive", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "archus.run_issue",
        arguments: { target: "zenod-ai/zenod#270", instructions: "Use the current branch.", repo: "zenod-ai/zenod" },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain("ARCHUS_CHAT");
      expect(text).toContain("Run this exact work issue");
      expect(text).toContain("zenod-ai/zenod#270");
      expect(text).toContain("Use the current branch");
      expect(text).toContain("Execution backlog repo: zenod-ai/zenod");
    } finally {
      await client.close();
    }
  });

  it("exposes chat_with_console through the Console chat path", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "chat_with_console",
        arguments: { message: "/clean-slate", surface: "web", conversationKey: "mesh-gateway-chat-smoke" },
      });
      expect(JSON.stringify(result.content)).toContain("clean-slate");
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          status: "ok",
          surface: "web",
          conversationKey: "mesh-gateway-chat-smoke",
          actions: [],
        }),
      );
    } finally {
      await client.close();
    }
  });
});
