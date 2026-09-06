import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RING_AGENT } from "../src/agent.js";
import { createApp } from "../src/app.js";
import {
  callPeerTool,
  callPeerWithArgs,
  councilToolName,
  discoverAdvertisedPeerSkill,
  discoverPeerTools,
  peerApprovalConnectionId,
  pollPeerMcpJob,
} from "../src/peerClient.js";
import { Runtime } from "../src/runtime.js";
import type { PeerTools } from "zenod";

function mcpFetch(
  tools: Array<Record<string, unknown>>,
  onCall?: (args: Record<string, unknown>, toolName?: string) => unknown,
) {
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
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: onCall?.(body.params?.arguments ?? {}, (body.params as { name?: string } | undefined)?.name),
      });
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

  it("scopes approval identity to the exact endpoint and credential, not the display name", () => {
    const connection = { name: "Calli", url: "https://calli.example/mcp", token: "token-a" };
    expect(peerApprovalConnectionId(connection)).toBe(peerApprovalConnectionId({ ...connection }));
    expect(peerApprovalConnectionId(connection)).not.toBe(peerApprovalConnectionId({
      ...connection,
      url: "https://replacement.example/mcp",
    }));
    expect(peerApprovalConnectionId(connection)).not.toBe(peerApprovalConnectionId({
      ...connection,
      token: "token-b",
    }));
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
      preserveFullResult: true,
    })]);
    expect(fetcher.mock.calls.some(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer secret")).toBe(true);
  });

  it("discovers only a same-origin advertised Agent Skill bundle", async () => {
    const skill = `---\nname: zenod\ndescription: Durable memory.\nmetadata:\n  version: "1.0.0"\n---\n\n# Zenod\n`;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/.well-known/atomic-unit-skill.json") {
        return Response.json({
          schemaVersion: "1.0",
          bundle: {
            format: "zenod-agent-skill-bundle-v1",
            url: "/.well-known/agent-skill-bundle.json",
          },
        });
      }
      if (parsed.pathname === "/.well-known/agent-skill-bundle.json") {
        return Response.json({
          format: "zenod-agent-skill-bundle-v1",
          files: [{ path: "SKILL.md", contentBase64: Buffer.from(skill).toString("base64") }],
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(discoverAdvertisedPeerSkill({
      name: "Zenod",
      url: "https://peer.example/mcp/token",
      token: "secret",
    })).resolves.toEqual([
      { path: "SKILL.md", contentBase64: Buffer.from(skill).toString("base64") },
    ]);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      bundle: {
        format: "zenod-agent-skill-bundle-v1",
        url: "https://other.example/skill.json",
      },
    })));
    await expect(discoverAdvertisedPeerSkill({
      name: "Zenod",
      url: "https://peer.example/mcp/token",
      token: "secret",
    })).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      headers: { "content-length": String(4_194_305) },
    })));
    await expect(discoverAdvertisedPeerSkill({
      name: "Zenod",
      url: "https://peer.example/mcp/token",
      token: "secret",
    })).resolves.toBeNull();
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

  it("passes typed answer content to the model without the host-only status", async () => {
    vi.stubGlobal("fetch", mcpFetch([], () => ({
      content: [{
        type: "text",
        text: "The note says saved verbatim.\n\nRead-only answer — no action was performed.",
      }],
      structuredContent: {
        type: "answer_content",
        text: "The note says saved verbatim.",
        sources: [{ path: "Log/2026-07-29.md#^e-a7f53e" }],
        coverage: { status: "partial", continuation: [{ tool: "read_note", input: { path: "Log/2026-07-29.md#^e-a7f53e", cursor: "opaque" } }] },
        status: {
          type: "read_only_status",
          text: "Read-only answer — no action was performed.",
        },
      },
    })));

    const chat = await callPeerWithArgs(
      { name: "Zenod", url: "https://peer.example/mcp", token: "secret" },
      "ask_brain",
      { question: "What did the note say?" },
      { preserveFullResult: true },
    );

    expect(JSON.parse(chat)).toEqual({
      type: "answer_content",
      text: "The note says saved verbatim.",
      sources: [{ path: "Log/2026-07-29.md#^e-a7f53e" }],
      coverage: { status: "partial", continuation: [{ tool: "read_note", input: { path: "Log/2026-07-29.md#^e-a7f53e", cursor: "opaque" } }] },
    });
  });

  it("polls an async wallet receipt through scoped MCP get_task_result", async () => {
    const calls: Array<{ tool?: string; args: Record<string, unknown> }> = [];
    let polls = 0;
    const fetcher = mcpFetch([], (args, tool) => {
      calls.push({ tool, args });
      polls += 1;
      return polls === 1
        ? {
            content: [{ type: "text", text: "Status: running." }],
            structuredContent: {
              found: true,
              ticket_id: "job-7",
              jobId: "job-7",
              kind: "store",
              status: "running",
              state: "running",
              result: null,
            },
          }
        : {
            content: [{ type: "text", text: "Stored." }],
            structuredContent: {
              found: true,
              ticket_id: "job-7",
              jobId: "job-7",
              kind: "store",
              status: "done",
              state: "done",
              result: {
                evidenceRef: "Log/2026-07-30.md#^e-terminal",
                commitSha: "a".repeat(40),
              },
            },
          };
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(pollPeerMcpJob(
      {
        name: "Zenod",
        url: "https://1.1.1.1/mcp/memory-scoped-token",
        token: "memory-scoped-token",
        wallet: true,
      },
      "job-7",
      0,
      1_000,
    )).resolves.toEqual({
      status: "done",
      kind: "store",
      result: {
        evidenceRef: "Log/2026-07-30.md#^e-terminal",
        commitSha: "a".repeat(40),
      },
    });
    expect(calls).toEqual([
      { tool: "get_task_result", args: { ticket_id: "job-7" } },
      { tool: "get_task_result", args: { ticket_id: "job-7" } },
    ]);
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).pathname.startsWith("/mcp/"))).toBe(true);
  });

  it("never renders Stored from a done job without a verified store receipt", async () => {
    const fetcher = mcpFetch([], (_args, tool) => tool === "store_memory"
      ? {
          content: [{ type: "text", text: "Queued." }],
          structuredContent: {
            ticket_id: "job-unverified",
            jobId: "job-unverified",
            status: "queued",
            state: "accepted",
          },
        }
      : {
          content: [{ type: "text", text: "Done." }],
          structuredContent: {
            found: true,
            ticket_id: "job-unverified",
            jobId: "job-unverified",
            kind: "store",
            status: "done",
            state: "done",
            result: { message: "Done without evidence." },
          },
        });
    vi.stubGlobal("fetch", fetcher);

    const result = await callPeerWithArgs({
      name: "Zenod",
      url: "https://1.1.1.1/mcp/memory-scoped-token",
      token: "memory-scoped-token",
      wallet: true,
    }, "store_memory", { content: "test" });

    expect(result).toBe("Zenod filing returned an invalid terminal receipt for job job-unverified.");
    expect(result).not.toContain("Stored.");
  });

  it("accepts a Drive durable revision receipt without requiring or inventing a commit SHA", async () => {
    const revision = {
      provider: "google_drive",
      id: "drive-txn-verified",
      committedAt: "2026-08-29T10:00:00.000Z",
      urls: ["https://drive.google.com/file/d/log-1/view"],
    };
    const fetcher = mcpFetch([], (_args, tool) => tool === "store_memory"
      ? {
          content: [{ type: "text", text: "Queued." }],
          structuredContent: { ticket_id: "job-drive", jobId: "job-drive", status: "queued", state: "accepted" },
        }
      : {
          content: [{ type: "text", text: "Saved." }],
          structuredContent: {
            found: true,
            ticket_id: "job-drive",
            jobId: "job-drive",
            kind: "store",
            status: "done",
            state: "done",
            result: {
              evidenceRef: "Log/2026-08-29.md#^e-drive",
              evidenceUrl: revision.urls[0],
              pagesTouched: ["Projects/Zenod.md"],
              revision,
              urls: revision.urls,
              filing: "filed",
            },
          },
        });
    vi.stubGlobal("fetch", fetcher);

    const result = JSON.parse(await callPeerWithArgs({
      name: "Zenod",
      url: "https://1.1.1.1/mcp/memory-scoped-token",
      token: "memory-scoped-token",
      wallet: true,
    }, "store_memory", { content: "test" })) as Record<string, unknown>;

    expect(result).toMatchObject({ status: "done", revision, urls: revision.urls });
    expect(result).not.toHaveProperty("commitSha");
    expect(result).not.toHaveProperty("githubUrls");
  });

  it("accepts an independent matching Git bundle commit on a Drive receipt", async () => {
    const commitSha = "d".repeat(40);
    const urls = ["https://drive.google.com/file/d/log-with-bundle/view"];
    const revision = {
      provider: "google_drive", id: "drive-txn-independent", committedAt: "2026-08-29T10:00:00.000Z",
      urls, commitSha,
    };
    vi.stubGlobal("fetch", mcpFetch([], (_args, tool) => tool === "store_memory"
      ? { content: [{ type: "text", text: "Queued." }], structuredContent: { ticket_id: "job-drive-bundle", status: "queued" } }
      : { content: [{ type: "text", text: "Saved." }], structuredContent: {
          found: true, ticket_id: "job-drive-bundle", kind: "store", status: "done",
          result: { evidenceRef: "Log/x.md#^e-drive-bundle", revision, urls, commitSha, filing: "filed" },
        } }));
    const result = JSON.parse(await callPeerWithArgs({
      name: "Zenod", url: "https://1.1.1.1/mcp/token", token: "token", wallet: true,
    }, "store_memory", { content: "test" })) as Record<string, unknown>;
    expect(result).toMatchObject({ revision, urls, commitSha });
    expect((result.revision as { id: string }).id).not.toBe(commitSha);
    expect(result).not.toHaveProperty("githubUrls");
  });

  it("accepts a fully consistent GitHub revision receipt", async () => {
    const sha = "a".repeat(40);
    const urls = [`https://github.com/zenod-ai/vault/blob/${sha}/Log/2026-08-29.md`];
    const githubUrls = ["https://github.com/zenod-ai/vault/blob/main/Log/2026-08-29.md"];
    const revision = { provider: "github", id: sha, committedAt: "2026-08-29T10:00:00.000Z", urls, commitSha: sha, githubUrls };
    vi.stubGlobal("fetch", mcpFetch([], (_args, tool) => tool === "store_memory"
      ? { content: [{ type: "text", text: "Queued." }], structuredContent: { ticket_id: "job-git", status: "queued" } }
      : { content: [{ type: "text", text: "Saved." }], structuredContent: {
          found: true, ticket_id: "job-git", kind: "store", status: "done",
          result: { evidenceRef: "Log/2026-08-29.md#^e-git", revision, urls, commitSha: sha, githubUrls, filing: "filed" },
        } }));

    const result = JSON.parse(await callPeerWithArgs({
      name: "Zenod", url: "https://1.1.1.1/mcp/token", token: "token", wallet: true,
    }, "store_memory", { content: "test" })) as Record<string, unknown>;
    expect(result).toMatchObject({ revision, urls, commitSha: sha, githubUrls });
  });

  it.each([
    {
      name: "contradictory nested GitHub SHA and arbitrary nested URLs",
      result: (() => {
        const topSha = "a".repeat(40);
        return {
          evidenceRef: "Log/2026-08-29.md#^e-bad-git",
          revision: {
            provider: "github", id: topSha, committedAt: "2026-08-29T10:00:00.000Z",
            urls: [`https://github.com/zenod-ai/vault/blob/${topSha}/Log/x.md`],
            commitSha: "b".repeat(40), githubUrls: ["https://evil.example/not-github"],
          },
          urls: [`https://github.com/zenod-ai/vault/blob/${topSha}/Log/x.md`],
          commitSha: topSha,
          githubUrls: ["https://github.com/zenod-ai/vault/blob/main/Log/x.md"],
        };
      })(),
    },
    {
      name: "Drive revision with mismatched top-level URLs",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-bad-drive",
        revision: { provider: "google_drive", id: "drive-1", committedAt: "2026-08-29T10:00:00.000Z", urls: ["https://drive.google.com/file/d/a/view"] },
        urls: ["https://drive.google.com/file/d/b/view"],
      },
    },
    {
      name: "Drive revision with nested Git compatibility fields",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-bad-drive-git",
        revision: {
          provider: "google_drive", id: "drive-2", committedAt: "2026-08-29T10:00:00.000Z",
          urls: ["https://drive.google.com/file/d/a/view"], commitSha: "c".repeat(40), githubUrls: [],
        },
        urls: ["https://drive.google.com/file/d/a/view"],
      },
    },
    {
      name: "Drive revision with a mismatched top-level Git bundle commit",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-bad-drive-commit",
        revision: {
          provider: "google_drive", id: "drive-not-a-sha", committedAt: "2026-08-29T10:00:00.000Z",
          urls: ["https://drive.google.com/file/d/a/view"], commitSha: "a".repeat(40),
        },
        urls: ["https://drive.google.com/file/d/a/view"],
        commitSha: "b".repeat(40),
      },
    },
    {
      name: "Drive revision with only top-level Git bundle provenance",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-incomplete-drive-commit",
        revision: {
          provider: "google_drive", id: "drive-not-a-sha", committedAt: "2026-08-29T10:00:00.000Z",
          urls: ["https://drive.google.com/file/d/a/view"],
        },
        urls: ["https://drive.google.com/file/d/a/view"],
        commitSha: "a".repeat(40),
      },
    },
    {
      name: "Drive revision id synthesized from its Git bundle commit",
      result: (() => {
        const commitSha = "a".repeat(40);
        return {
          evidenceRef: "Log/2026-08-29.md#^e-equal-drive-commit",
          revision: {
            provider: "google_drive", id: commitSha, committedAt: "2026-08-29T10:00:00.000Z",
            urls: ["https://drive.google.com/file/d/a/view"], commitSha,
          },
          urls: ["https://drive.google.com/file/d/a/view"],
          commitSha,
        };
      })(),
    },
    {
      name: "Drive revision with a github.com subdomain URL",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-bad-drive-host",
        revision: {
          provider: "google_drive", id: "drive-host-1", committedAt: "2026-08-29T10:00:00.000Z",
          urls: ["https://gist.github.com/zenod-ai/receipt"],
        },
        urls: ["https://gist.github.com/zenod-ai/receipt"],
      },
    },
    {
      name: "Drive revision with a githubusercontent content URL",
      result: {
        evidenceRef: "Log/2026-08-29.md#^e-bad-drive-content-host",
        revision: {
          provider: "google_drive", id: "drive-host-2", committedAt: "2026-08-29T10:00:00.000Z",
          urls: ["https://raw.githubusercontent.com/zenod-ai/vault/main/Log/x.md"],
        },
        urls: ["https://raw.githubusercontent.com/zenod-ai/vault/main/Log/x.md"],
      },
    },
  ])("rejects $name", async ({ result }) => {
    vi.stubGlobal("fetch", mcpFetch([], (_args, tool) => tool === "store_memory"
      ? { content: [{ type: "text", text: "Queued." }], structuredContent: { ticket_id: "job-adversarial", status: "queued" } }
      : { content: [{ type: "text", text: "Saved." }], structuredContent: {
          found: true, ticket_id: "job-adversarial", kind: "store", status: "done", result,
        } }));

    await expect(callPeerWithArgs({
      name: "Zenod", url: "https://1.1.1.1/mcp/token", token: "token", wallet: true,
    }, "store_memory", { content: "test" })).resolves.toBe(
      "Zenod filing returned an invalid terminal receipt for job job-adversarial.",
    );
  });

  it("retains isError and _meta for a discovered pure-text result", async () => {
    vi.stubGlobal("fetch", mcpFetch([], () => ({
      content: [{ type: "text", text: "upstream rejected the call" }],
      isError: true,
      _meta: { upstreamCode: "held_not_approved", retryable: false },
    })));
    const dataDir = await mkdtemp(join(tmpdir(), "ring-discovered-result-"));
    dirs.push(dataDir);
    const runtime = new Runtime(dataDir, RING_AGENT, { seedFromEnv: false, credentialMasterKey: "44".repeat(32) });
    const as = councilToolName("Calli", "createPosts");
    runtime.settings.setPeers([{
      name: "Calli",
      url: "https://1.1.1.1/mcp",
      token: "secret",
      wallet: true,
      tools: [{
        as,
        mcp: "createPosts",
        arg: "text",
        description: "Create a held draft.",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        annotations: { readOnlyHint: false },
        preserveFullResult: true,
      }],
    }]);
    try {
      const tools = (runtime as unknown as { buildPeerTools(): PeerTools }).buildPeerTools();
      const serialized = await tools[as]!.run({ text: "draft" });
      expect(JSON.parse(serialized)).toEqual({
        content: [{ type: "text", text: "upstream rejected the call" }],
        isError: true,
        _meta: { upstreamCode: "held_not_approved", retryable: false },
      });
    } finally {
      runtime.close();
    }
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

  it("keeps the catalog usable while loudly marking one oversized optional output schema", async () => {
    vi.stubGlobal("fetch", mcpFetch([
      {
        name: "getPostsByIds",
        description: "Read posts by id",
        inputSchema: {
          type: "object",
          required: ["ids"],
          properties: { ids: { type: "array", items: { type: "string" } } },
        },
        outputSchema: { type: "object", description: "x".repeat(70_000) },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: "createPosts",
        description: "Create a held post draft",
        inputSchema: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string" } },
        },
        outputSchema: { type: "object", properties: { draftId: { type: "string" } } },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ]));

    const result = await discoverPeerTools({ name: "Calli", url: "https://peer.example/mcp", token: "secret" });

    expect(result).toMatchObject({
      transport: "connected",
      tools: "ready",
      specs: [
        expect.objectContaining({
          mcp: "getPostsByIds",
          outputSchemaError: expect.stringContaining("getPostsByIds outputSchema exceeds"),
        }),
        expect.objectContaining({
          mcp: "createPosts",
          outputSchema: { type: "object", properties: { draftId: { type: "string" } } },
        }),
      ],
    });
    expect(result.specs[0]).not.toHaveProperty("outputSchema");
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
      skillArtifact: { artifactId: "sha256:calli-skill-v1", version: "v1" },
    } as any]);
    const app = createApp(runtime, { agent: RING_AGENT });
    const headers = { authorization: "Bearer ring-test-token" };
    try {
      const boot = await app.request("/api/peers", { headers });
      const bootPayload = await boot.json() as { peers: Array<Record<string, unknown>> };
      expect(bootPayload).toMatchObject({ peers: [{
        transportStatus: "connected",
        toolsStatus: "ready",
        toolCount: 1,
        tools: [{ mcpName: "searchPostsRecent", annotations: { readOnlyHint: true } }],
        refreshedAt: expect.any(String),
      }] });
      expect(bootPayload.peers[0]).not.toHaveProperty("tool");
      expect((runtime.settings.peers()[0] as any).skillArtifact).toEqual({ artifactId: "sha256:calli-skill-v1", version: "v1" });

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
      const refreshedPayload = await refreshed.json() as { peers: Array<Record<string, unknown>> };
      expect(refreshedPayload).toMatchObject({ peers: [{
        transportStatus: "connected",
        toolsStatus: "ready",
        toolCount: 1,
        tools: [{ name: councilToolName("Calli", "getUsersMe") }],
        refreshedAt: expect.any(String),
      }] });
      expect(refreshedPayload.peers[0]).not.toHaveProperty("tool");
      expect((runtime.settings.peers()[0] as any).skillArtifact).toEqual({ artifactId: "sha256:calli-skill-v1", version: "v1" });
      expect(fetcher.mock.calls.some(([, init]) => new Headers(init?.headers).get("authorization") === "Bearer downstream-secret")).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it("auto-attaches an advertised peer skill without overwriting manual attachments", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ring-peer-auto-skill-"));
    dirs.push(dataDir);
    const skill = `---\nname: zenod\ndescription: Durable memory.\nmetadata:\n  version: "1.0.0"\n---\n\n# Zenod\nUse cited memory.\n`;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/.well-known/atomic-unit-skill.json") {
        return Response.json({
          bundle: {
            format: "zenod-agent-skill-bundle-v1",
            url: "/.well-known/agent-skill-bundle.json",
          },
        });
      }
      if (parsed.pathname === "/.well-known/agent-skill-bundle.json") {
        return Response.json({
          format: "zenod-agent-skill-bundle-v1",
          files: [{ path: "SKILL.md", contentBase64: Buffer.from(skill).toString("base64") }],
        });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
      if (body.method === "initialize") return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "peer", version: "1" } },
      });
      if (body.method === "tools/list") return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "search_memory", inputSchema: { type: "object" } }] },
      });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetcher);

    const runtime = new Runtime(dataDir, RING_AGENT, { seedFromEnv: false, credentialMasterKey: "33".repeat(32) });
    runtime.settings.setRaw("api_token", "ring-test-token");
    runtime.settings.setPeers([{
      name: "Zenod",
      url: "https://1.1.1.1/mcp/token",
      token: "downstream-secret",
      wallet: true,
      tools: [],
    }]);
    const app = createApp(runtime, { agent: RING_AGENT });
    try {
      const response = await app.request("/api/peers", {
        headers: { authorization: "Bearer ring-test-token" },
      });
      const payload = await response.json() as { peers: Array<{ skill?: { name?: string; version?: string } }> };
      expect(payload.peers[0]?.skill).toMatchObject({ name: "zenod", version: "1.0.0" });
      const attached = runtime.settings.peers()[0]?.skillArtifact;
      expect(attached).toMatchObject({ version: "1.0.0" });

      await app.request("/api/peers/refresh", {
        method: "POST",
        headers: { authorization: "Bearer ring-test-token", "content-type": "application/json" },
        body: JSON.stringify({ name: "Zenod" }),
      });
      expect(runtime.settings.peers()[0]?.skillArtifact).toEqual(attached);
      expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/.well-known/agent-skill-bundle.json")).toHaveLength(1);

      const detached = await app.request("/api/peers/Zenod/skill", {
        method: "DELETE",
        headers: { authorization: "Bearer ring-test-token" },
      });
      expect(detached.status).toBe(200);
      await app.request("/api/peers/refresh", {
        method: "POST",
        headers: { authorization: "Bearer ring-test-token", "content-type": "application/json" },
        body: JSON.stringify({ name: "Zenod" }),
      });
      expect(runtime.settings.peers()[0]?.skillArtifact).toBeUndefined();
      expect(runtime.settings.peers()[0]?.skillAutoImport).toBe(false);
      expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/.well-known/agent-skill-bundle.json")).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });
});
