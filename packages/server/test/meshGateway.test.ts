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
      "archus.run_issue",
      "ask_archus",
      "ask_brain",
      "ask_outbound",
      "ask_phylax",
      "chat_with_console",
      "close_issue",
      "create_issue",
      "edit_issue",
      "epaminon.run_ephemeral_task",
      "epaminon.run_existing_issue",
      "execution_status",
      "fetch_execution_deliverable",
      "get_memory",
      "get_recent_conversation_transcript",
      "get_task_result",
      "post_reddit",
      "post_tweet",
      "raise_event",
      "read_llm_timeline",
      "read_reddit_replies",
      "read_subreddit",
      "read_x_mentions",
      "read_x_post",
      "search_memory",
      "search_reddit",
      "search_x",
      "send_email",
      "store_memory",
    ]);
  });

  it("serves recent conversation transcripts from the Console channel audit store", async () => {
    runtime.whatsappStore.recordInbound({
      messageId: "voice-old-transcript",
      chatId: "110771719696610@lid",
      senderId: "34618217703@s.whatsapp.net",
      senderName: "Jordi",
      chatName: "Jordi",
      isGroup: false,
      timestamp: Math.floor(Date.now() / 1000) - 3_600,
      body: "old transcript should be truncated",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: {},
      raw: {},
    });
    runtime.whatsappStore.recordInbound({
      messageId: "voice-local-transcript",
      chatId: "110771719696610@lid",
      senderId: "34618217703@s.whatsapp.net",
      senderName: "Jordi",
      chatName: "Jordi",
      isGroup: false,
      timestamp: Math.floor(Date.now() / 1000),
      body: "local console transcript text",
      hasMedia: true,
      mediaType: "ptt",
      mimeType: "audio/ogg",
      fileName: null,
      mediaRaw: {},
      raw: {},
    });
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "get_recent_conversation_transcript",
        arguments: { windowMinutes: 120, contactId: "34618217703", limit: 1 },
      });
      expect(JSON.stringify(result.content)).toContain("local console transcript text");
      expect(JSON.stringify(result.content)).not.toContain("old transcript should be truncated");
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          count: 1,
          entries: expect.arrayContaining([
            expect.objectContaining({
              messageId: "voice-local-transcript",
              bodyText: "local console transcript text",
              mediaType: "ptt",
            }),
          ]),
        }),
      );
      runtime.whatsappStore.recordOutboundAudit({
        messageId: "voice-local-transcript",
        chatId: "110771719696610@lid",
        contactId: "34618217703@s.whatsapp.net",
        bodyText: "Storage receipt\nVault evidence: Log/2026-06-21.md#^e-test",
        status: "sent",
        sentMessageId: "sent-local-transcript-receipt",
      });
      const exact = await client.callTool({
        name: "get_recent_conversation_transcript",
        arguments: { messageId: "voice-local-transcript" },
      });
      expect(JSON.stringify(exact.content)).toContain("local console transcript text");
      expect(JSON.stringify(exact.content)).toContain("Vault evidence: Log/2026-06-21.md#^e-test");
      expect((exact.structuredContent as { entries: unknown[] }).entries).toHaveLength(2);
    } finally {
      await client.close();
    }
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

  it("publishes typed backlog write tools (I8-1) under the v4 flag with deterministic output schemas", async () => {
    await withEnv(
      {
        ZENOD_V4_TOOL_NAMES: "true",
        ZENOD_V4_STRICT_OUTPUT_SCHEMA: "true",
        ZENOD_V4_STRICT_TOOLS: "archus.backlog_create,archus.backlog_edit,archus.backlog_close,archus.backlog_comment",
      },
      async () => {
        const strictDir = await mkdtemp(join(tmpdir(), "zenod-mesh-gateway-v4-write-"));
        const strictRuntime = new Runtime(strictDir, CONSOLE_AGENT);
        const strictToken = strictRuntime.settings.apiToken();
        let strictServer: ServerType | undefined;
        try {
          strictRuntime.settings.setPeers([{ name: "archus", url: "http://archus.test/mcp", token: "archus-token" }]);
          const app = createApp(strictRuntime);
          strictServer = serve({ fetch: app.fetch, port: 0 });
          const { port } = strictServer.address() as AddressInfo;
          const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${strictToken}` } },
          });
          const client = new Client({ name: "mesh-test-client-v4-write", version: "0.0.0" });
          await client.connect(transport);
          try {
            const { tools } = await client.listTools();
            const create = tools.find((t) => t.name === "backlog_create");
            const edit = tools.find((t) => t.name === "backlog_edit");
            const close = tools.find((t) => t.name === "backlog_close");
            const comment = tools.find((t) => t.name === "backlog_comment");
            // Typed service surface: all four present, no repo parameter (hard-wired repo).
            expect(create?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ title: expect.any(Object) }) }));
            expect((create?.inputSchema as { properties?: Record<string, unknown> })?.properties).not.toHaveProperty("repo");
            expect(edit?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ number: expect.any(Object) }) }));
            expect(close?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ number: expect.any(Object) }) }));
            expect(comment?.inputSchema).toEqual(expect.objectContaining({ properties: expect.objectContaining({ body: expect.any(Object) }) }));
            // Deterministic (ID+URL-or-error) output contract, not a chat passthrough.
            expect(create?.outputSchema).toEqual(expect.objectContaining({ $id: "https://zenod.dev/schemas/tool-output/archus.backlog_create.json" }));
            expect(close?.outputSchema).toEqual(expect.objectContaining({ $id: "https://zenod.dev/schemas/tool-output/archus.backlog_close.json" }));
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

  it("routes the create_issue front door to Archus chat with a semantic receipt-or-error directive", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "create_issue",
        arguments: { message: "Create a bug for the Console issue lookup confusion." },
      });
      const text = JSON.stringify(result.content);
      expect(text).toContain("ARCHUS_CHAT");
      expect(text).toContain("Route semantically");
      expect(text).toContain("Epaminon internally");
      expect(text).toContain("read-back verified");
      expect(text).toContain("Create a bug for the Console issue lookup confusion");
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

  it("routes exact run requests to Epaminon's native run tool", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "epaminon.run_existing_issue",
        arguments: { target: "zenod-ai/zenod#270", instructions: "Use the current branch.", notifyOnStart: false },
      });
      const structured = result.structuredContent as {
        ticket: { executionId: string; target: string; state: string; context: string; notifyOnStart?: boolean };
      };
      expect(structured.ticket).toMatchObject({
        target: "zenod-ai/zenod#270",
        state: "running",
        notifyOnStart: false,
      });
      expect(structured.ticket.executionId).toMatch(/^direct-/);
      expect(structured.ticket.context).toContain("Use the current branch.");
      expect(epaminonRuntime.executionQueue!.snapshot()).toEqual(
        expect.arrayContaining([expect.objectContaining({ executionId: structured.ticket.executionId, target: "zenod-ai/zenod#270" })]),
      );
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

  it("routes one-off tasks to Epaminon's native ephemeral execution tool", async () => {
    const client = await connectGateway();
    try {
      const result = await client.callTool({
        name: "epaminon.run_ephemeral_task",
        arguments: { objective: "Research one thing without filing a ticket.", instructions: "Keep it short." },
      });
      const structured = result.structuredContent as { ticket: { executionId: string; target: string; state: string; context: string } };
      expect(structured.ticket).toMatchObject({
        target: `ephemeral:${structured.ticket.executionId}`,
        state: "running",
      });
      expect(structured.ticket.executionId).toMatch(/^ephemeral-/);
      expect(structured.ticket.context).toContain("Research one thing");
      expect(epaminonRuntime.executionQueue!.snapshot()).toEqual(
        expect.arrayContaining([expect.objectContaining({ executionId: structured.ticket.executionId, target: structured.ticket.target })]),
      );
    } finally {
      await client.close();
    }
  });
});
