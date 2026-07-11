import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RING_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { callPeerTool, callPeerWithArgs, councilToolName, discoverPeerTools } from "../src/peerClient.js";
import { Runtime } from "../src/runtime.js";

function mcpFetch(tools: Array<Record<string, unknown>>, onCall?: (args: Record<string, unknown>) => unknown) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      id?: number;
      method?: string;
      params?: { arguments?: Record<string, unknown> };
    };
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "test-peer", version: "1" },
        },
      });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools } });
    }
    if (body.method === "tools/call") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: onCall?.(body.params?.arguments ?? {}) });
    }
    return new Response(null, { status: 202 });
  });
}

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generic wallet MCP discovery", () => {
  it("uses collision-safe stable names for normalization, case and long-prefix collisions", () => {
    expect(councilToolName("foo bar", "read")).not.toBe(councilToolName("foo_bar", "read"));
    expect(councilToolName("Calli", "read")).not.toBe(councilToolName("calli", "read"));
    expect(councilToolName("p", `${"x".repeat(80)}a`)).not.toBe(councilToolName("p", `${"x".repeat(80)}b`));
    expect(councilToolName("foo bar", "read")).toBe(councilToolName("foo bar", "read"));
  });

  it("preserves authenticated descriptions, schemas and all MCP annotations", async () => {
    const fetcher = mcpFetch([{
      name: "createPosts",
      description: "Create a held post draft",
      inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1 } } },
      outputSchema: { type: "object", properties: { draftId: { type: "string" } } },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }]);
    vi.stubGlobal("fetch", fetcher);

    const result = await discoverPeerTools({ name: "Calli", url: "https://peer.example/mcp", token: "secret" });

    expect(result).toMatchObject({ transport: "connected", tools: "ready" });
    expect(result.specs).toEqual([expect.objectContaining({
      as: councilToolName("Calli", "createPosts"),
      mcp: "createPosts",
      description: "Create a held post draft",
      inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1 } } },
      outputSchema: { type: "object", properties: { draftId: { type: "string" } } },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    })]);
    expect(fetcher.mock.calls.some(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer secret")).toBe(true);
  });

  it("forwards exact arguments and retains structured and non-text tool results", async () => {
    const seen: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", mcpFetch([], (args) => {
      seen.push(args);
      return {
        content: [
          { type: "text", text: "created" },
          { type: "resource_link", uri: "https://example.test/draft/7", name: "draft" },
        ],
        structuredContent: { draftId: "7", nested: { held: true } },
        _meta: { receipt: "opaque" },
      };
    }));
    const peer = { name: "Calli", url: "https://peer.example/mcp", token: "secret" };
    const args = { text: "exact", options: { approval: false }, tags: ["a", "b"] };

    const raw = await callPeerTool(peer, "createPosts", args);
    const chat = await callPeerWithArgs(peer, "createPosts", args);

    expect(seen).toEqual([args, args]);
    expect(raw).toMatchObject({
      content: [
        { type: "text", text: "created" },
        { type: "resource_link", uri: "https://example.test/draft/7", name: "draft" },
      ],
      structuredContent: { draftId: "7", nested: { held: true } },
      _meta: { receipt: "opaque" },
    });
    expect(JSON.parse(chat)).toMatchObject(raw);
  });

  it("separates a connected transport from a failed tools catalog", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
      if (body.method === "initialize") return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "peer", version: "1" } },
      });
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "catalog unavailable" } });
      }
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(discoverPeerTools({ name: "peer", url: "https://peer.example/mcp", token: "secret" }))
      .resolves.toMatchObject({ transport: "connected", tools: "error", specs: [], error: expect.stringContaining("catalog unavailable") });
  });

  it("rejects catalog and schema sizes that could flood the provider prompt", async () => {
    vi.stubGlobal("fetch", mcpFetch(Array.from({ length: 65 }, (_, index) => ({
      name: `tool_${index}`,
      inputSchema: { type: "object" },
    }))));
    await expect(discoverPeerTools({ name: "peer", url: "https://peer.example/mcp", token: "secret" }))
      .resolves.toMatchObject({ transport: "connected", tools: "error", error: expect.stringContaining("maximum is 64") });

    vi.stubGlobal("fetch", mcpFetch([{
      name: "oversized",
      inputSchema: { type: "object", description: "x".repeat(70_000) },
    }]));
    await expect(discoverPeerTools({ name: "peer", url: "https://peer.example/mcp", token: "secret" }))
      .resolves.toMatchObject({ transport: "connected", tools: "error", error: expect.stringContaining("discovery limit") });
  });

  it("refreshes saved peers on startup and through the token-free refresh API", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-peer-refresh-"));
    dirs.push(dataDir);
    let advertised = [{
      name: "searchPostsRecent",
      description: "read posts",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
      if (body.method === "initialize") return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "peer", version: "1" } },
      });
      if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: advertised } });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetcher);

    const runtime = new Runtime(dataDir, RING_AGENT, { seedFromEnv: false, credentialMasterKey: "33".repeat(32) });
    runtime.settings.setRaw("api_token", "ring-test-token");
    runtime.settings.setPeers([{
      name: "Calli",
      url: "https://1.1.1.1/mcp",
      token: "downstream-secret",
      wallet: true,
      tools: [],
      // Future H2 fields survive because refresh spreads the stored peer object.
      skillArtifact: { id: "calli-skill-v1" },
    } as any]);
    const app = createApp(runtime, { agent: RING_AGENT });
    const headers = { authorization: "Bearer ring-test-token" };
    try {
      const boot = await app.request("/api/peers", { headers });
      expect(await boot.json()).toMatchObject({ peers: [{
        transportStatus: "connected",
        toolsStatus: "ready",
        toolCount: 1,
        tools: [{ mcpName: "searchPostsRecent", annotations: { readOnlyHint: true } }],
      }] });
      expect((runtime.settings.peers()[0] as any).skillArtifact).toEqual({ id: "calli-skill-v1" });

      advertised = [{
        name: "getUsersMe",
        description: "read profile",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      }];
      const refreshed = await app.request("/api/peers/refresh", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name: "Calli" }),
      });
      expect(await refreshed.json()).toMatchObject({ peers: [{
        transportStatus: "connected",
        toolsStatus: "ready",
        toolCount: 1,
        toolNames: [councilToolName("Calli", "getUsersMe")],
      }] });
      expect((runtime.settings.peers()[0] as any).skillArtifact).toEqual({ id: "calli-skill-v1" });
      expect(fetcher.mock.calls.some(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer downstream-secret")).toBe(true);
    } finally {
      runtime.close();
    }
  });
});
