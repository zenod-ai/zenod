import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChassisStorage, createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";

const peerMocks = vi.hoisted(() => ({
  discoverPeerTools: vi.fn(),
}));

vi.mock("../src/peerClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/peerClient.js")>()),
  discoverPeerTools: peerMocks.discoverPeerTools,
}));

import { PHYLAX_AGENT } from "../src/agent.js";
import {
  createPhylaxUnit,
  normalizePhylaxTranscriptionUpdate,
  parsePhylaxSettingsUpdate,
  parsePhylaxTranscriptionCheck,
  parsePhylaxTranscriptionKeyRemoval,
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
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Phylax customer unit mount", () => {
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

  it("serves artifacts only to the matching tenant token and rejects traversal", async () => {
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
      const own = await unit.app.request("/mcp/alpha-token/artifacts/alpha/voice.ogg");
      expect(own.status).toBe(200);
      expect(own.headers.get("content-type")).toContain("audio/ogg");
      expect(await own.text()).toBe("alpha-audio");
      const image = await unit.app.request("/mcp/alpha-token/artifacts/alpha/screenshot.png");
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toContain("image/png");
      expect(await image.text()).toBe("alpha-image");
      expect((await unit.app.request("/mcp/beta-token/artifacts/alpha/voice.ogg")).status).toBe(404);
      expect((await unit.app.request("/mcp/beta-token/artifacts/alpha/screenshot.png")).status).toBe(404);
      expect((await unit.app.request("/mcp/alpha-token/artifacts/alpha/%2e%2e")).status).toBe(404);
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
