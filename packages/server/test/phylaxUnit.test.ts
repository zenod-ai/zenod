import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChassisStorage, createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";

const peerMocks = vi.hoisted(() => ({
  discoverPeerTools: vi.fn(),
  callPeerTool: vi.fn(),
}));

vi.mock("../src/peerClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/peerClient.js")>()),
  discoverPeerTools: peerMocks.discoverPeerTools,
  callPeerTool: peerMocks.callPeerTool,
}));

import { PHYLAX_AGENT } from "../src/agent.js";
import { createPhylaxArtifactCapabilityUrl, phylaxArtifactCapabilitySecret } from "../src/phylaxArtifactCapability.js";
import {
  createPhylaxUnit,
  normalizePhylaxTranscriptionUpdate,
  parsePhylaxSettingsUpdate,
  parsePhylaxTranscriptionCheck,
  parsePhylaxTranscriptionKeyRemoval,
  ZENOD_WHATSAPP_VERIFICATION_REPLY,
} from "../src/phylaxUnit.js";
import { PhylaxTenantSettingsStore } from "../src/phylaxTenantSettings.js";
import { resolveServerMode } from "../src/serverMode.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { Hono } from "hono";

const dirs: string[] = [];
const MASTER_KEY = "22".repeat(32);

afterEach(async () => {
  vi.unstubAllGlobals();
  peerMocks.discoverPeerTools.mockReset();
  peerMocks.callPeerTool.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Phylax customer unit mount", () => {
  it("pins the verification handoff to bounded Zenod-only customer copy", () => {
    expect(ZENOD_WHATSAPP_VERIFICATION_REPLY)
      .toBe("Your WhatsApp number is verified. Return to Zenod to finish setup.");
    expect(ZENOD_WHATSAPP_VERIFICATION_REPLY).not.toMatch(/Phylax|Ring|MCP|tool|https?:\/\//i);
  });

  it("restarts only sustained restartable outages or stale workers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T16:00:00.000Z"));
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-transport-health-"));
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        PHYLAX_TRANSPORT_RESTART_AFTER_MS: "5000",
      },
    });
    try {
      const healthy = await unit.app.request("/api/health");
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toMatchObject({
        status: "ok",
        worker: { status: "ok" },
        restart: { required: false, transportRestartAfterMs: 5_000 },
        channels: {
          whatsapp: {
            state: "disabled",
            scope: "transport-lifecycle-only",
            receivePath: { status: "disabled" },
          },
        },
      });

      const heartbeat = unit.phylaxRuntime.workerHealth();
      expect(unit.phylaxRuntime.workerHealth(
        heartbeat.lastHeartbeatAt + heartbeat.staleAfterMs + 1,
      ).status).toBe("degraded");

      const baseStatus = unit.phylaxRuntime.whatsapp.status();
      const outageSince = Date.now();
      const status = vi.spyOn(unit.phylaxRuntime.whatsapp, "status");
      status.mockReturnValue({
        ...baseStatus,
        enabled: true,
        state: "disconnected",
        receivePath: {
          ...baseStatus.receivePath,
          status: "degraded",
          phase: "retry_wait",
          restartable: true,
          operatorActionRequired: false,
          outageSince,
          reason: "WhatsApp disconnected (408)",
        },
      });

      // The ordinary two-second reconnect window is observable but probe-healthy.
      await vi.advanceTimersByTimeAsync(2_000);
      const reconnecting = await unit.app.request("/api/health");
      expect(reconnecting.status).toBe(200);
      expect(await reconnecting.json()).toMatchObject({
        status: "degraded",
        restart: { required: false, outageForMs: 2_000 },
        channels: {
          whatsapp: {
            receivePath: {
              status: "degraded",
              phase: "retry_wait",
              restartable: true,
            },
          },
        },
      });

      await vi.advanceTimersByTimeAsync(3_000);
      const sustained = await unit.app.request("/api/health");
      expect(sustained.status).toBe(503);
      expect(await sustained.json()).toMatchObject({
        status: "unhealthy",
        restart: {
          required: true,
          reason: "transport-outage-sustained",
          outageForMs: 5_000,
        },
      });

      status.mockReturnValue({
        ...baseStatus,
        enabled: true,
        state: "error",
        receivePath: {
          ...baseStatus.receivePath,
          status: "terminal",
          phase: "terminal",
          restartable: false,
          operatorActionRequired: true,
          outageSince,
          reason: "WhatsApp logged out. Reset the session and pair again.",
        },
      });
      const terminal = await unit.app.request("/api/health");
      expect(terminal.status).toBe(200);
      expect(await terminal.json()).toMatchObject({
        status: "degraded",
        restart: { required: false },
        channels: {
          whatsapp: {
            receivePath: {
              status: "terminal",
              operatorActionRequired: true,
              reason: "WhatsApp logged out. Reset the session and pair again.",
            },
          },
        },
      });

      status.mockReturnValue(baseStatus);
      vi.spyOn(unit.phylaxRuntime, "workerHealth").mockReturnValue({
        status: "degraded",
        lastHeartbeatAt: Date.now() - 20_001,
        staleAfterMs: 20_000,
      });
      const workerStalled = await unit.app.request("/api/health");
      expect(workerStalled.status).toBe(503);
      expect(await workerStalled.json()).toMatchObject({
        status: "unhealthy",
        restart: { required: true, reason: "event-loop-heartbeat-stale" },
      });
    } finally {
      await unit.close();
      vi.useRealTimers();
    }
  });

  it("restarts the compose service when its bounded health probe fails", async () => {
    const compose = await readFile(new URL("../../../docker-compose.phylax.yml", import.meta.url), "utf8");
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("http://127.0.0.1:8080/api/health");
    expect(compose).toContain("AbortSignal.timeout(3000)");
    expect(compose).toContain("kill -TERM 1");
    expect(compose).toContain("start_period: 60s");
  });

  it("strictly parses tenant transcription settings and checks before mutation", () => {
    expect(() => parsePhylaxSettingsUpdate(null)).toThrow("settings body must be an object");
    expect(() => parsePhylaxSettingsUpdate({ transcriptionEnabled: "true" }))
      .toThrow("transcriptionEnabled must be a boolean");
    expect(() => parsePhylaxSettingsUpdate({ transcriptionProvider: "other" }))
      .toThrow("invalid transcription provider");
    expect(() => parsePhylaxSettingsUpdate({ transcriptionKey: "x".repeat(8_193) }))
      .toThrow("transcriptionKey must be a string");
    expect(() => parsePhylaxSettingsUpdate({ extra: true }))
      .toThrow("unsupported setting: extra");
    expect(() => parsePhylaxSettingsUpdate({ voiceDefault: "maybe" }))
      .toThrow("invalid voiceDefault");
    expect(() => parsePhylaxSettingsUpdate({ turnBindings: [] }))
      .toThrow("turnBindings must be an object");
    expect(parsePhylaxSettingsUpdate({
      voiceDefault: "capture",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: { source: "transcript" } },
        },
      },
    })).toMatchObject({
      voiceDefault: "capture",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: { source: "transcript" } },
        },
      },
    });
    expect(() => parsePhylaxTranscriptionCheck({ tenantId: "alpha" }))
      .toThrow("unsupported check field: tenantId");
    expect(() => parsePhylaxTranscriptionCheck({ key: 123 })).toThrow("key must be a string");
    expect(() => parsePhylaxTranscriptionKeyRemoval({ provider: "local" }))
      .toThrow("invalid transcription provider");
    expect(parsePhylaxTranscriptionKeyRemoval({ provider: "groq" }))
      .toEqual({ provider: "groq" });
    expect(parsePhylaxTranscriptionCheck({
      provider: "openrouter",
      model: "openai/whisper-large-v3-turbo",
      key: "ephemeral-key",
    })).toEqual({
      provider: "openrouter",
      model: "openai/whisper-large-v3-turbo",
      key: "ephemeral-key",
    });
  });

  it("rejects enabled cloud settings without that provider's tenant key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-transcription-normalize-"));
    dirs.push(dataDir);
    const settings = new PhylaxTenantSettingsStore(
      dataDir,
      new ChassisStorage({ dataDir, vaultEncryptionKey: MASTER_KEY }),
    );
    settings.update("alpha", {
      transcriptionProvider: "openrouter",
      transcriptionKey: "openrouter-only-key",
      transcriptionModel: "openai/whisper-large-v3-turbo",
    });
    expect(() => normalizePhylaxTranscriptionUpdate(settings, "alpha", {
      transcriptionProvider: "groq",
    })).toThrow("groq transcription requires a tenant-configured provider key");
    expect(normalizePhylaxTranscriptionUpdate(settings, "alpha", {
      transcriptionProvider: "groq",
      transcriptionKey: "groq-key",
      transcriptionModel: "ignored-model",
    })).toMatchObject({
      transcriptionProvider: "groq",
      transcriptionModel: "whisper-large-v3-turbo",
      transcriptionKey: "groq-key",
    });
  });

  it("authorizes transcription routes by session tenant and never persists an ephemeral check key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-transcription-routes-"));
    dirs.push(dataDir);
    const env = {
      ACCOUNT_STATE_SECRET: "phylax-route-session-secret",
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
    };
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env,
    });
    unit.customerAccounts.upsert("alpha", {
      account_id: "github-41",
      github_id: 41,
      github_login: "alpha",
      subscription_status: "active",
      tenant_id: "tenant-alpha",
    });
    unit.customerAccounts.upsert("beta", {
      account_id: "github-42",
      github_id: 42,
      github_login: "beta",
      subscription_status: "active",
      tenant_id: "tenant-beta",
    });
    const cookieFor = async (id: number, login: string) => {
      const sessions = new Hono();
      sessions.get("/", (c) => {
        issueCustomerSession(c, { id, login }, env);
        return c.text("ok");
      });
      return (await sessions.request("/")).headers.get("set-cookie")!.split(";", 1)[0]!;
    };
    const alphaCookie = await cookieFor(41, "alpha");
    const betaCookie = await cookieFor(42, "beta");
    try {
      expect((await unit.app.request("/api/phylax/transcription/options")).status).toBe(401);
      expect((await unit.app.request("/api/phylax/transcription/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "groq", key: "not-used" }),
      })).status).toBe(401);

      const alphaUpdate = await unit.app.request("/api/phylax/settings", {
        method: "PUT",
        headers: { cookie: alphaCookie, "content-type": "application/json" },
        body: JSON.stringify({
          transcriptionProvider: "openrouter",
          transcriptionModel: "openai/whisper-large-v3-turbo",
          transcriptionKey: "alpha-openrouter-secret",
        }),
      });
      expect(alphaUpdate.status).toBe(200);
      expect(JSON.stringify(await alphaUpdate.json())).not.toContain("alpha-openrouter-secret");

      const alphaView = await (await unit.app.request("/api/phylax/settings", {
        headers: { cookie: alphaCookie },
      })).json() as { settings: { transcriptionKeysConfigured: Record<string, boolean> } };
      const betaView = await (await unit.app.request("/api/phylax/settings", {
        headers: { cookie: betaCookie },
      })).json() as { settings: { transcriptionKeysConfigured: Record<string, boolean> } };
      expect(alphaView.settings.transcriptionKeysConfigured.openrouter).toBe(true);
      expect(betaView.settings.transcriptionKeysConfigured.openrouter).toBe(false);

      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ data: [{ id: "whisper-large-v3-turbo" }] }),
      );
      vi.stubGlobal("fetch", fetchImpl);
      const check = await unit.app.request("/api/phylax/transcription/check", {
        method: "POST",
        headers: { cookie: betaCookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "groq", key: "ephemeral-groq-secret" }),
      });
      expect(check.status).toBe(200);
      expect(await check.json()).toMatchObject({ ok: true, provider: "groq" });
      expect(JSON.stringify(await (await unit.app.request("/api/phylax/settings", {
        headers: { cookie: betaCookie },
      })).json())).not.toContain("ephemeral-groq-secret");
      expect(((await (await unit.app.request("/api/phylax/settings", {
        headers: { cookie: betaCookie },
      })).json()) as { settings: { transcriptionKeysConfigured: Record<string, boolean> } })
        .settings.transcriptionKeysConfigured.groq).toBe(false);

      const removed = await unit.app.request("/api/phylax/transcription/key", {
        method: "DELETE",
        headers: { cookie: alphaCookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openrouter" }),
      });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toMatchObject({
        settings: {
          transcriptionEnabled: false,
          transcriptionKeysConfigured: { openrouter: false },
        },
      });
    } finally {
      unit.close();
    }
  });

  it("uses direct Zenod chat, durable voice capture, and durable media ingest while preserving separate Ring credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-production-bindings-"));
    dirs.push(dataDir);
    const tenantStore = createMemoryTenantStore([{
      token: "tenant-alpha-artifact-token",
      tenant: { id: "tenant-alpha", name: "Tenant Alpha" },
    }]);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore,
      env: {
        ACCOUNT_STATE_SECRET: "phylax-production-binding-secret",
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        CUSTOMER_APP_URL: "https://phylax.test",
      },
    });
    unit.customerAccounts.upsert("alpha", {
      account_id: "github-alpha",
      github_id: 71,
      github_login: "alpha",
      subscription_status: "active",
      tenant_id: "tenant-alpha",
    });
    unit.customerTokenVault.put("github-alpha", "tenant-alpha-artifact-token");
    const registration = unit.phylaxTenantSettings.registerPhone(
      "tenant-alpha",
      "+34 611 111 111",
      "number-alpha",
    );
    expect(unit.phylaxTenantSettings.verifyInbound(
      "34611111111@s.whatsapp.net",
      registration.keyword,
    )).toMatchObject({ tenantId: "tenant-alpha", verified: true });
    unit.phylaxTenantSettings.update("tenant-alpha", {
      downstreamUrl: "https://memory.test/mcp",
      downstreamToken: "tenant-alpha-memory-scope",
      assistantUrl: "https://ring.test/mcp",
      assistantToken: "tenant-alpha-assistant-scope",
      voiceDefault: "assistant",
    });

    peerMocks.discoverPeerTools.mockResolvedValue({
      transport: "connected",
      tools: "ready",
      specs: [
        {
          as: "assistant",
          mcp: "chat_with_zenod",
          arg: "input",
          description: "Answer an assistant turn",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["message", "surface", "conversationKey"],
            properties: {
              message: { type: "string" },
              surface: { enum: ["whatsapp", "mcp"] },
              conversationKey: { type: "string" },
            },
          },
        },
        {
          as: "memory",
          mcp: "store_memory",
          arg: "input",
          description: "Store a voice memory",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["content", "verbatim", "hints", "idempotencyKey"],
            properties: {
              content: { type: "string", minLength: 1 },
              verbatim: { const: true },
              hints: { type: "array", items: { type: "string" } },
              source: { enum: ["whatsapp", "telegram"] },
              contentType: { const: "voice_note" },
              capturedAt: { type: "string", minLength: 1 },
              sourceId: { type: "string", minLength: 1 },
              idempotencyKey: { type: "string", minLength: 1 },
            },
          },
        },
        {
          as: "media",
          mcp: "ingest_memory",
          arg: "input",
          description: "Ingest media structurally",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["artifactUrl", "mediaType", "filename", "sourceHint", "idempotencyKey"],
            properties: {
              artifactUrl: { type: "string", minLength: 1 },
              mediaType: {
                enum: ["audio", "screenshot", "image", "pdf", "document", "link"],
              },
              filename: { type: "string", minLength: 1 },
              sourceHint: { const: "WhatsApp media" },
              idempotencyKey: { type: "string", minLength: 1 },
            },
          },
        },
      ],
    });
    peerMocks.callPeerTool.mockImplementation(async (
      _peer: unknown,
      tool: string,
      args: Record<string, unknown>,
    ) => {
      if (tool === "chat_with_zenod") {
        return { content: [{ type: "text", text: "Assistant answer." }] };
      }
      if (tool === "store_memory") {
        return {
          content: [{ type: "text", text: "queued" }],
          structuredContent: { ticket_id: "voice-job", state: "accepted" },
        };
      }
      if (tool === "ingest_memory") {
        return {
          content: [{ type: "text", text: "queued" }],
          structuredContent: { ticket_id: "media-job", state: "accepted" },
        };
      }
      if (tool === "get_task_result" && args.ticket_id === "voice-job") {
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "voice-job",
            state: "done",
            result: {
              recap: "Remember the launch sequence.",
              evidenceRef: "Log/2026-07-29.md#^voice-production",
              pagesTouched: ["Projects/Launch.md"],
              commitSha: "abc1234",
              githubUrls: ["https://github.test/commit/abc1234"],
            },
          },
        };
      }
      if (tool === "get_task_result" && args.ticket_id === "media-job") {
        return {
          content: [{ type: "text", text: "done" }],
          structuredContent: {
            ticket_id: "media-job",
            state: "done",
            result: {
              message: "Screenshot filed.",
              mediaType: "screenshot",
              digest: {
                evidenceRef: "Log/2026-07-29.md#^media-production",
                pagesTouched: ["Inbox/Media.md"],
                commitSha: "feed123",
                githubUrls: ["https://github.test/commit/feed123"],
              },
            },
          },
        };
      }
      throw new Error(`unexpected downstream call: ${tool}`);
    });

    try {
      const assistant = await unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat-alpha",
        messageId: "assistant-voice-1",
        transcription: { text_transcript: "What did I save?" },
      });
      expect(assistant.replyText).toBe("Assistant answer.");
      expect(peerMocks.callPeerTool.mock.calls[0]?.[0]).toMatchObject({
        url: "https://memory.test/mcp",
        token: "tenant-alpha-memory-scope",
      });
      expect(peerMocks.callPeerTool.mock.calls[0]?.[1]).toBe("chat_with_zenod");
      expect(peerMocks.callPeerTool.mock.calls[0]?.[2]).toEqual({
        message: "What did I save?",
        surface: "whatsapp",
        conversationKey: "whatsapp:34611111111",
      });

      unit.phylaxTenantSettings.update("tenant-alpha", { voiceDefault: "capture" });
      const voice = await unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat-alpha",
        messageId: "capture-voice-1",
        senderTimestamp: "2026-08-01T14:00:00.000Z",
        transcription: { text_transcript: "Remember the launch sequence." },
      });
      expect(peerMocks.callPeerTool.mock.calls[1]?.[0]).toMatchObject({
        url: "https://memory.test/mcp",
        token: "tenant-alpha-memory-scope",
      });
      expect(peerMocks.callPeerTool.mock.calls[1]?.[1]).toBe("store_memory");
      expect(peerMocks.callPeerTool.mock.calls[1]?.[2]).toEqual({
        content: "Remember the launch sequence.",
        verbatim: true,
        hints: ["WhatsApp voice note"],
        source: "whatsapp",
        contentType: "voice_note",
        capturedAt: "2026-08-01T14:00:00.000Z",
        sourceId: "capture-voice-1",
        idempotencyKey: "tenant-alpha:whatsapp:capture-voice-1",
      });
      expect(peerMocks.callPeerTool.mock.calls[2]?.slice(1)).toEqual([
        "get_task_result",
        { ticket_id: "voice-job" },
      ]);
      expect(voice.replyText).toContain("Saved ✓");
      expect(voice.replyText).not.toContain("Log/2026-07-29.md#^voice-production");
      expect(voice.replyText).not.toContain("abc1234");
      expect(voice.replyText).toMatch(
        /\nreply to this message to discuss or act on it$/,
      );

      const media = await unit.phylaxRuntime.organ.receive({
        channel: "whatsapp",
        sender: "34611111111",
        chatId: "chat-alpha",
        messageId: "capture-media-1",
        media: {
          bytes: Buffer.from("immutable-screenshot"),
          mimeType: "image/png",
          fileName: "Screenshot 2026-07-29.png",
        },
      });
      const ingestArguments = peerMocks.callPeerTool.mock.calls[3]?.[2] as Record<string, unknown>;
      expect(peerMocks.callPeerTool.mock.calls[3]?.[1]).toBe("ingest_memory");
      expect(ingestArguments).toEqual({
        artifactUrl: expect.any(String),
        mediaType: "screenshot",
        filename: "Screenshot 2026-07-29.png",
        sourceHint: "WhatsApp media",
        idempotencyKey: "tenant-alpha:whatsapp:capture-media-1",
      });
      const artifactCapability = new URL(String(ingestArguments.artifactUrl));
      expect(artifactCapability.origin).toBe("https://phylax.test");
      expect(artifactCapability.pathname.startsWith("/artifacts/tenant-alpha/")).toBe(true);
      expect(artifactCapability.searchParams.get("expires")).not.toBeNull();
      expect(artifactCapability.searchParams.get("signature")).not.toBeNull();
      expect(artifactCapability.toString()).not.toContain("tenant-alpha-artifact-token");
      expect(ingestArguments).not.toHaveProperty("bytesRef");
      expect(ingestArguments).not.toHaveProperty("message");
      expect(peerMocks.callPeerTool.mock.calls[4]?.slice(1)).toEqual([
        "get_task_result",
        { ticket_id: "media-job" },
      ]);
      expect(media.replyText).toContain("Saved ✓");
      expect(media.replyText).toContain("Screenshot filed.");
      expect(media.replyText).toContain("Inbox/Media.md");
      expect(media.replyText).not.toContain("Log/2026-07-29.md#^media-production");
      expect(media.replyText).not.toContain("feed123");
      expect(media.replyText).toMatch(
        /\nreply to this message to discuss or act on it$/,
      );
      expect(unit.phylaxRuntime.organ.lastCaptureEvidenceRef(
        "tenant-alpha",
        "whatsapp:34611111111",
      )).toBe("Log/2026-07-29.md#^media-production");
      expect(unit.phylaxTenantSettings.assistantCredentials("tenant-alpha")).toEqual({
        url: "https://ring.test/mcp",
        token: "tenant-alpha-assistant-scope",
      });
    } finally {
      await unit.close();
    }
  });

  it("discovers exact downstream tools with the saved tenant credential and never exposes credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-tool-discovery-"));
    dirs.push(dataDir);
    const env = {
      ACCOUNT_STATE_SECRET: "phylax-discovery-session-secret",
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
    };
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env,
    });
    unit.customerAccounts.upsert("alpha", {
      account_id: "github-51",
      github_id: 51,
      github_login: "alpha",
      subscription_status: "active",
      tenant_id: "tenant-alpha",
    });
    unit.customerAccounts.upsert("beta", {
      account_id: "github-52",
      github_id: 52,
      github_login: "beta",
      subscription_status: "active",
      tenant_id: "tenant-beta",
    });
    unit.phylaxTenantSettings.update("tenant-alpha", {
      downstreamUrl: "https://alpha-memory.example/mcp",
      downstreamToken: "alpha-memory-token",
    });
    unit.phylaxTenantSettings.update("tenant-beta", {
      downstreamUrl: "https://beta-memory.example/mcp",
      downstreamToken: "beta-memory-token",
    });
    const sessions = new Hono();
    sessions.get("/:id", (c) => {
      const alpha = c.req.param("id") === "alpha";
      issueCustomerSession(c, {
        id: alpha ? 51 : 52,
        login: alpha ? "alpha" : "beta",
      }, env);
      return c.text("ok");
    });
    const alphaCookie = (await sessions.request("/alpha")).headers.get("set-cookie")!.split(";", 1)[0]!;
    const betaCookie = (await sessions.request("/beta")).headers.get("set-cookie")!.split(";", 1)[0]!;
    peerMocks.discoverPeerTools.mockImplementation(async (peer: { token: string }) => ({
      transport: "connected",
      tools: "ready",
      specs: [{
        as: "unused",
        mcp: peer.token === "alpha-memory-token" ? "remember_alpha" : "remember_beta",
        arg: "input",
        description: "Store one durable memory",
        inputSchema: {
          type: "object",
          properties: { content: { type: "string" } },
          required: ["content"],
        },
        annotations: { readOnlyHint: false },
      }],
    }));
    try {
      expect((await unit.app.request("/api/phylax/downstream/tools", { method: "POST" })).status)
        .toBe(401);
      const alpha = await unit.app.request("/api/phylax/downstream/tools", {
        method: "POST",
        headers: { cookie: alphaCookie },
      });
      const beta = await unit.app.request("/api/phylax/downstream/tools", {
        method: "POST",
        headers: { cookie: betaCookie },
      });
      expect(alpha.status).toBe(200);
      expect(beta.status).toBe(200);
      expect(alpha.headers.get("cache-control")).toBe("private, no-store");
      const alphaBody = await alpha.json();
      const betaBody = await beta.json();
      expect(alphaBody).toEqual({
        tools: [{
          name: "remember_alpha",
          description: "Store one durable memory",
          inputSchema: {
            type: "object",
            properties: { content: { type: "string" } },
            required: ["content"],
          },
          annotations: { readOnlyHint: false },
        }],
      });
      expect(betaBody).toMatchObject({ tools: [{ name: "remember_beta" }] });
      expect(JSON.stringify([alphaBody, betaBody])).not.toMatch(
        /alpha-memory-token|beta-memory-token|alpha-memory\.example|beta-memory\.example/,
      );
      expect(peerMocks.discoverPeerTools.mock.calls.map(([peer]) => peer.token))
        .toEqual(["alpha-memory-token", "beta-memory-token"]);
    } finally {
      await unit.close();
    }
  });

  it("fails downstream discovery loudly without leaking the credential or transport error", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-tool-discovery-error-"));
    dirs.push(dataDir);
    const env = {
      ACCOUNT_STATE_SECRET: "phylax-discovery-error-secret",
      CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
    };
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env,
    });
    unit.customerAccounts.upsert("alpha", {
      account_id: "github-61",
      github_id: 61,
      github_login: "alpha",
      subscription_status: "active",
      tenant_id: "tenant-alpha",
    });
    unit.phylaxTenantSettings.update("tenant-alpha", {
      downstreamUrl: "https://secret-host.example/mcp",
      downstreamToken: "do-not-leak-this-token",
    });
    const sessions = new Hono();
    sessions.get("/", (c) => {
      issueCustomerSession(c, { id: 61, login: "alpha" }, env);
      return c.text("ok");
    });
    const cookie = (await sessions.request("/")).headers.get("set-cookie")!.split(";", 1)[0]!;
    peerMocks.discoverPeerTools.mockResolvedValue({
      transport: "error",
      tools: "error",
      specs: [],
      error: "connect ECONNREFUSED https://secret-host.example?token=do-not-leak-this-token",
    });
    try {
      const response = await unit.app.request("/api/phylax/downstream/tools", {
        method: "POST",
        headers: { cookie },
      });
      expect(response.status).toBe(502);
      const body = JSON.stringify(await response.json());
      expect(body).toContain("Could not connect");
      expect(body).not.toMatch(/secret-host|do-not-leak-this-token|ECONNREFUSED/);
    } finally {
      await unit.close();
    }
  });

  it("selects Phylax mode explicitly", () => {
    expect(resolveServerMode({ ZENOD_UNIT: "phylax" }, PHYLAX_AGENT.name)).toBe("phylax");
  });

  it("serves the Phylax landing and customer dashboard shell on the canonical host", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-static-"));
    dirs.push(dataDir);
    const siteDist = join(dataDir, "site");
    const webDist = join(dataDir, "web");
    await mkdir(siteDist);
    await mkdir(webDist);
    await writeFile(join(siteDist, "index.html"), "PHYLAX LANDING");
    await writeFile(join(webDist, "index.html"), "PHYLAX APP");
    const unit = createPhylaxUnit({
      dataDir: join(dataDir, "data"),
      siteDist,
      webDist,
      tenantStore: createMemoryTenantStore(),
      env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY },
    });
    try {
      expect(await (await unit.app.request("/", { headers: { host: "phylax.zenod.dev" } })).text())
        .toContain("PHYLAX LANDING");
      expect(await (await unit.app.request("/app", { headers: { host: "phylax.zenod.dev" } })).text())
        .toContain("PHYLAX APP");
    } finally {
      unit.close();
    }
  });

  it("serves artifacts only with an exact signed capability and never accepts a tenant token URL", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-artifact-"));
    dirs.push(dataDir);
    const tenantStore = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "alpha", name: "Alpha" } },
      { token: "beta-token", tenant: { id: "beta", name: "Beta" } },
    ]);
    const unit = createPhylaxUnit({ dataDir, tenantStore, env: { CHASSIS_VAULT_MASTER_KEY: MASTER_KEY } });
    const artifactDir = join(dataDir, "whatsapp", "artifacts", "alpha");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "voice.ogg"), "alpha-audio");
    await writeFile(join(artifactDir, "screenshot.png"), "alpha-image");
    try {
      const secret = phylaxArtifactCapabilitySecret({ CHASSIS_VAULT_MASTER_KEY: MASTER_KEY });
      const capability = (tenantId: string, file: string) => {
        const url = new URL(createPhylaxArtifactCapabilityUrl({
          baseUrl: "https://phylax.test",
          secret,
          tenantId,
          file,
          expiresAt: Date.now() + 60_000,
        }));
        return `${url.pathname}${url.search}`;
      };
      const own = await unit.app.request(capability("alpha", "voice.ogg"));
      expect(own.status).toBe(200);
      expect(own.headers.get("content-type")).toContain("audio/ogg");
      expect(await own.text()).toBe("alpha-audio");
      const image = await unit.app.request(capability("alpha", "screenshot.png"));
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toContain("image/png");
      expect(await image.text()).toBe("alpha-image");
      expect((await unit.app.request("/mcp/alpha-token/artifacts/alpha/voice.ogg")).status).toBe(404);
      const wrongTenant = new URL(capability("alpha", "voice.ogg"), "https://phylax.test");
      wrongTenant.pathname = "/artifacts/beta/voice.ogg";
      expect((await unit.app.request(`${wrongTenant.pathname}${wrongTenant.search}`)).status).toBe(404);
      const tamperedFile = new URL(capability("alpha", "voice.ogg"), "https://phylax.test");
      tamperedFile.pathname = "/artifacts/alpha/screenshot.png";
      expect((await unit.app.request(`${tamperedFile.pathname}${tamperedFile.search}`)).status).toBe(404);
      expect((await unit.app.request("/artifacts/alpha/%2e%2e?expires=1&signature=x")).status).toBe(404);
    } finally {
      unit.close();
    }
  });

  it("returns 404 for /admin and its channel APIs unless the GitHub session login is alfablok, case-insensitively", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-admin-"));
    dirs.push(dataDir);
    const webDist = join(dataDir, "web");
    await mkdir(webDist);
    await writeFile(join(webDist, "index.html"), "PHYLAX ADMIN");
    const env = { ACCOUNT_STATE_SECRET: "admin-test-secret", CHASSIS_VAULT_MASTER_KEY: MASTER_KEY };
    const unit = createPhylaxUnit({
      dataDir: join(dataDir, "data"),
      webDist,
      tenantStore: createMemoryTenantStore(),
      env,
    });
    const cookieFor = async (login: string) => {
      const sessions = new Hono();
      sessions.get("/", (c) => {
        issueCustomerSession(c, { id: login === "alfablok" ? 1 : 2, login }, env);
        return c.text("ok");
      });
      return (await sessions.request("/")).headers.get("set-cookie")!.split(";", 1)[0]!;
    };
    try {
      expect((await unit.app.request("/admin")).status).toBe(404);
      expect((await unit.app.request("/admin", { headers: { cookie: await cookieFor("someone-else") } })).status).toBe(404);
      expect((await unit.app.request("/api/whatsapp/status", { headers: { cookie: await cookieFor("someone-else") } })).status).toBe(404);
      const adminCookie = await cookieFor("alfablok");
      const page = await unit.app.request("/admin", { headers: { cookie: adminCookie } });
      expect(page.status).toBe(200);

      const canonicalGithubCookie = await cookieFor("AlfaBlok");
      const canonicalGithubPage = await unit.app.request("/admin", { headers: { cookie: canonicalGithubCookie } });
      expect(canonicalGithubPage.status).toBe(200);
      expect(await page.text()).toContain("PHYLAX ADMIN");
      const status = await unit.app.request("/api/whatsapp/status", { headers: { cookie: adminCookie } });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ state: "disabled", linkedNumber: null });
    } finally {
      unit.close();
    }
  });
});
