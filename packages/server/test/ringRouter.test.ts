import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { RingRouterCore, type RingConnectedServer, type RingMcpCaller, type RingToolCall } from "../src/ringRouter.js";
import { Runtime } from "../src/runtime.js";

function servers(overrides: Partial<RingConnectedServer>[] = []): RingConnectedServer[] {
  const base: RingConnectedServer[] = [
    {
      id: "mentor",
      endpoint: "https://mentor.example.test/mcp",
      token: "mentor-token",
      displayName: "Mentor",
      skillText: "Default chief-of-staff route for general turns.",
      enabled: true,
      relayPolicy: "same_channel",
      settingsUrl: "https://mentor.example.test/settings",
      tools: { chat: "chat_with_mentor" },
    },
    {
      id: "zenod",
      endpoint: "https://zenod.example.test/mcp",
      token: "zenod-token",
      displayName: "Zenod",
      skillText: "Memory owner: ingest, store, search, and answer with citations.",
      enabled: true,
      relayPolicy: "same_channel",
      settingsUrl: "https://zenod.example.test/settings",
      tools: { askMemory: "ask_brain", storeMemory: "store_memory", ingestMemory: "ingest_memory" },
    },
    {
      id: "herald",
      endpoint: "https://herald.example.test/mcp",
      token: "herald-token",
      displayName: "Herald",
      skillText: "Paid product strategist and reporting guy.",
      enabled: true,
      relayPolicy: "same_channel",
      settingsUrl: "https://herald.example.test/settings",
      tools: { chat: "chat_with_herald" },
    },
    {
      id: "epaminon",
      endpoint: "https://epaminon.example.test/mcp",
      token: "epaminon-token",
      displayName: "Epaminon",
      skillText: "Cloud worker harness for prompt-first execution.",
      enabled: true,
      relayPolicy: "same_channel",
      settingsUrl: "https://epaminon.example.test/settings",
      tools: { chat: "chat_with_epaminon", runTask: "epaminon.run_task" },
    },
  ];
  return base.map((server) => ({ ...server, ...overrides.find((override) => override.id === server.id) }));
}

function router(calls: RingToolCall[], configuredServers = servers()): RingRouterCore {
  const caller: RingMcpCaller = async (call) => {
    calls.push(call);
    return { content: [{ type: "text", text: `${call.server.displayName} saw ${JSON.stringify(call.arguments)}` }] };
  };
  return new RingRouterCore({ servers: configuredServers, defaultServerId: "mentor", zenodServerId: "zenod" }, caller);
}

describe("RingRouterCore", () => {
  it("routes a general turn to the default server and preserves same-channel provenance", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    const result = await core.route({ channel: "whatsapp", chatId: "chat-1", messageId: "wa-1", text: "hello, what is next?" });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("mentor");
    expect(calls[0].tool).toBe("chat_with_mentor");
    expect(calls[0].arguments).toEqual({ message: "hello, what is next?", conversationKey: "whatsapp:chat-1", origin_ticket_id: result.mailboxEntry.id });
    expect(result.outbound).toMatchObject({
      channel: "whatsapp",
      chatId: "chat-1",
      inReplyToMailboxId: result.mailboxEntry.id,
    });
    expect(result.outbound?.text).toContain("Mentor:");
    expect(core.mailbox()[0]).toMatchObject({ channel: "whatsapp", chatId: "chat-1", messageId: "wa-1" });
    expect(core.routeLog()[0]).toMatchObject({
      mailboxId: result.mailboxEntry.id,
      chosenServerId: "mentor",
      reason: "default",
      resultStatus: "ok",
      channel: "whatsapp",
      chatId: "chat-1",
    });
    expect(core.routeLog()[0].inputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("routes remember-this text to Zenod store_memory without importing memory internals", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    await core.route({ channel: "web", chatId: "thread-a", text: "remember this: my policy renews in October" });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("zenod");
    expect(calls[0].tool).toBe("store_memory");
    expect(calls[0].arguments).toEqual({ content: "remember this: my policy renews in October", verbatim: true });
    expect(core.routeLog()[0]).toMatchObject({ chosenServerId: "zenod", reason: "memory_write", resultStatus: "ok" });
  });

  it("routes memory questions to Zenod ask_brain", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    await core.route({ channel: "telegram", chatId: "tg-1", text: "what did I say about travel insurance?" });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("zenod");
    expect(calls[0].tool).toBe("ask_brain");
    expect(calls[0].arguments).toEqual({ question: "what did I say about travel insurance?" });
    expect(core.routeLog()[0].reason).toBe("memory_read");
  });

  it("routes media handles to Zenod ingest_memory and leaves archive/transcription to Zenod", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    await core.route({
      channel: "whatsapp",
      chatId: "chat-voice",
      text: "remember the action items in this voice note",
      senderTimestamp: "2026-07-09T14:00:00Z",
      media: [
        {
          mediaType: "audio",
          mediaId: "phylax-media-123",
          filename: "voice.ogg",
          contentHint: "remember the action items",
          hints: ["meeting"],
        },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("zenod");
    expect(calls[0].tool).toBe("ingest_memory");
    expect(calls[0].arguments).toEqual({
      mediaType: "audio",
      bytesRef: "phylax-media-123",
      filename: "voice.ogg",
      sourceHint: "Ring whatsapp",
      contentHint: "remember the action items",
      senderTimestamp: "2026-07-09T14:00:00Z",
      hints: ["meeting"],
    });
    expect(core.routeLog()[0]).toMatchObject({ chosenServerId: "zenod", reason: "media_ingest", resultStatus: "ok" });
  });

  it("passes explicitly named turns to the named server without rewriting the payload", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    const result = await core.route({ channel: "web", chatId: "thread-b", text: "for Herald: draft a tweet about the Ring launch" });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("herald");
    expect(calls[0].tool).toBe("chat_with_herald");
    expect(calls[0].arguments).toEqual({
      message: "draft a tweet about the Ring launch",
      conversationKey: "web:thread-b",
      origin_ticket_id: result.mailboxEntry.id,
    });
    expect(core.routeLog()[0]).toMatchObject({ chosenServerId: "herald", reason: "named", resultStatus: "ok" });
  });

  it("routes named Epaminon execution from WhatsApp to run_task with provenance and run context", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls);

    const result = await core.route({
      channel: "whatsapp",
      chatId: "chat-exec",
      messageId: "wa-exec-1",
      text: "Epaminon: research the Council seam. effort: high. repo zenod-ai/zenod. output target: docs/council-seam.md",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].server.id).toBe("epaminon");
    expect(calls[0].tool).toBe("epaminon.run_task");
    expect(calls[0].arguments).toEqual({
      prompt: "research the Council seam. effort: high. repo zenod-ai/zenod. output target: docs/council-seam.md",
      effort: "high",
      repo: "zenod-ai/zenod",
      outputTarget: "docs/council-seam.md",
      instructions: `Origin: Ring whatsapp chat chat-exec; provider message wa-exec-1; ring mailbox ${result.mailboxEntry.id}`,
    });
    expect(result.outbound).toMatchObject({
      channel: "whatsapp",
      chatId: "chat-exec",
      inReplyToMailboxId: result.mailboxEntry.id,
    });
    expect(result.decision).toMatchObject({
      chosenServerId: "epaminon",
      reason: "execution_task",
      tool: "epaminon.run_task",
      resultStatus: "ok",
      channel: "whatsapp",
      chatId: "chat-exec",
    });
  });

  it("refuses a disabled named server loudly and does not call MCP", async () => {
    const calls: RingToolCall[] = [];
    const core = router(calls, servers([{ id: "herald", enabled: false }]));

    const result = await core.route({ channel: "whatsapp", chatId: "chat-2", text: "@Herald draft the launch note" });

    expect(calls).toHaveLength(0);
    expect(result.toolResult?.isError).toBe(true);
    expect(result.toolResult?.structuredContent).toMatchObject({ code: "route_refused" });
    expect(result.outbound).toMatchObject({ channel: "whatsapp", chatId: "chat-2" });
    expect(result.outbound?.text).toContain("disabled");
    expect(core.routeLog()[0]).toMatchObject({
      chosenServerId: "herald",
      chosenServerDisplayName: "Herald",
      reason: "named",
      tool: "chat_with_herald",
      resultStatus: "refused",
    });
  });

  it("logs MCP caller failures as route errors", async () => {
    const core = new RingRouterCore(
      { servers: servers(), defaultServerId: "mentor", zenodServerId: "zenod" },
      async () => {
        throw new Error("connection refused");
      },
    );

    const result = await core.route({ channel: "web", chatId: "thread-error", text: "hello" });

    expect(result.toolResult?.isError).toBe(true);
    expect(result.toolResult?.structuredContent).toMatchObject({ code: "mcp_call_failed", message: "connection refused" });
    expect(core.routeLog()[0]).toMatchObject({
      chosenServerId: "mentor",
      reason: "default",
      resultStatus: "error",
    });
    expect(result.outbound).toMatchObject({ channel: "web", chatId: "thread-error" });
  });
});

describe("Ring tenant API", () => {
  it("requires bearer auth for hosted Ring status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-ring-api-auth-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    try {
      expect((await app.request("/api/ring/status")).status).toBe(401);
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads status, writes basic config, and never returns connected product tokens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-ring-api-config-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      const saved = await app.request("/api/ring/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          tenantSlug: "acme",
          tenantName: "Acme Ring",
          defaultServerId: "mentor",
          zenodServerId: "zenod",
          connectedProducts: [
            {
              id: "mentor",
              displayName: "Mentor",
              endpoint: "https://mentor.example.test/mcp",
              token: "mentor-token",
              skillText: "Default chief-of-staff route.",
              enabled: true,
              relayPolicy: "same_channel",
              settingsUrl: "https://mentor.example.test/settings",
              tools: { chat: "chat_with_mentor" },
            },
            {
              id: "zenod",
              displayName: "Zenod",
              endpoint: "https://zenod.example.test/mcp",
              token: "zenod-token",
              skillText: "Memory owner.",
              enabled: true,
              relayPolicy: "same_channel",
              tools: { ingestMemory: "ingest_memory" },
            },
          ],
        }),
      });

      expect(saved.status).toBe(200);
      const body = await saved.json();
      expect(body.unit).toMatchObject({ id: "ring", tenantSlug: "acme", tenantName: "Acme Ring" });
      expect(body.routePolicy).toMatchObject({ defaultServerId: "mentor", zenodServerId: "zenod" });
      expect(body.connectedProducts).toEqual([
        expect.objectContaining({ id: "mentor", hasToken: true }),
        expect.objectContaining({ id: "zenod", hasToken: true }),
      ]);
      expect(body.connectedProducts[0]).not.toHaveProperty("token");
      expect(body.connectedProducts[1]).not.toHaveProperty("token");
      expect(JSON.stringify(body)).not.toContain("mentor-token");

      const status = await (await app.request("/api/ring/status", { headers })).json();
      expect(status.connectedProducts).toHaveLength(2);
      expect(status.mediaHandoff.zenodOwns).toEqual(expect.arrayContaining(["drive_archive", "transcription", "ocr", "digest"]));
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("route-test returns mailbox and route IDs with explicit unavailable errors when live MCP is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-ring-api-route-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      await app.request("/api/ring/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          defaultServerId: "mentor",
          connectedProducts: [
            {
              id: "mentor",
              displayName: "Mentor",
              endpoint: "",
              token: "",
              enabled: true,
              tools: { chat: "chat_with_mentor" },
            },
          ],
        }),
      });

      const routed = await app.request("/api/ring/route-test", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "web", chatId: "cloud-ui", text: "hello" }),
      });

      expect(routed.status).toBe(200);
      const body = await routed.json();
      expect(body.ok).toBe(false);
      expect(body.mailboxEntry.id).toEqual(expect.any(String));
      expect(body.decision.id).toEqual(expect.any(String));
      expect(body.decision).toMatchObject({ chosenServerId: "mentor", resultStatus: "error" });
      expect(body.toolResult).toMatchObject({
        isError: true,
        structuredContent: { code: "ring_product_unavailable", productId: "mentor" },
      });

      const status = await (await app.request("/api/ring/status", { headers })).json();
      expect(status.routeLogs[0]).toMatchObject({ id: body.decision.id, resultStatus: "error" });
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("route-test refuses disabled products without calling MCP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-ring-api-disabled-"));
    const runtime = new Runtime(dir);
    const app = createApp(runtime);
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}`, "Content-Type": "application/json" };
    try {
      await app.request("/api/ring/config", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          defaultServerId: "mentor",
          connectedProducts: [{ id: "mentor", displayName: "Mentor", endpoint: "", token: "", enabled: false }],
        }),
      });

      const routed = await app.request("/api/ring/route-test", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "web", chatId: "cloud-ui", text: "hello" }),
      });
      const body = await routed.json();
      expect(body.ok).toBe(false);
      expect(body.decision).toMatchObject({ chosenServerId: "mentor", resultStatus: "refused" });
      expect(body.toolResult.structuredContent).toMatchObject({ code: "route_refused" });
    } finally {
      runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
