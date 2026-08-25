import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import {
  ChassisStorage,
  createMemoryTenantStore,
  hashToken,
  type UnitContext,
} from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createZenodUnit,
  MEMORY_CHANNEL_MCP_TOOLS,
  ZENOD_READ_TOOLS,
  ZenodRuntimePool,
} from "../src/zenodUnit.js";
import { PeerSkillStore } from "../src/peerSkillStore.js";
import type { ManagedAiProviderClient } from "../src/customerManagedAi.js";
import { SETTING_KEYS } from "../src/settings.js";

const tempDirs: string[] = [];
const CHASSIS_VAULT_MASTER_KEY = "11".repeat(32);

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-unit-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function contextFor(
  storage: ChassisStorage,
  tenantId: string,
): UnitContext {
  const tenant = { id: tenantId };
  return {
    unitName: "zenod",
    tenant,
    storage: storage.forTenant(tenant),
    usage: null,
    operatingRules: null,
  };
}

async function signInCustomer(unit: ReturnType<typeof createZenodUnit>): Promise<string> {
  const signin = await unit.app.request("/auth/signin");
  const state = new URL(signin.headers.get("location")!).searchParams.get("state")!;
  const callback = await unit.app.request(`/auth/github/callback?code=ok&state=${encodeURIComponent(state)}`);
  return callback.headers.get("set-cookie")!.split(";")[0]!;
}

describe("Zenod chassis unit", () => {
  it("declares every Zenod read tool for chassis conduct enforcement", () => {
    expect([...ZENOD_READ_TOOLS].sort()).toEqual([
      "ask_brain",
      "get_ingest_result",
      "get_memory",
      "get_task_result",
      "list_drive_files",
      "read_llm_timeline",
      "search_memory",
    ]);
  });

  it("caches one runtime per verified tenant storage root", async () => {
    const dataDir = await tempDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: CHASSIS_VAULT_MASTER_KEY,
    });
    const pool = new ZenodRuntimePool();
    try {
      const alphaContext = contextFor(storage, "tenant-alpha");
      const betaContext = contextFor(storage, "tenant-beta");
      const alpha = pool.forContext(alphaContext);
      const beta = pool.forContext(betaContext);

      expect(pool.forContext(alphaContext)).toBe(alpha);
      expect(alpha.dataDir).toBe(join(dataDir, "tenant-alpha"));
      expect(beta.dataDir).toBe(join(dataDir, "tenant-beta"));
      expect(alpha.dataDir).not.toBe(beta.dataDir);
      expect(alpha.settings.get("artifact_archive_provider")).toBe("local");
      expect(alpha.settings.get("artifact_archive_local_dir")).toBe(
        join(dataDir, "tenant-alpha", "media"),
      );
      expect(beta.settings.get("artifact_archive_local_dir")).toBe(
        join(dataDir, "tenant-beta", "media"),
      );
      expect(alpha.settings.getRaw("api_token")).toBeNull();
      expect(beta.settings.getRaw("api_token")).toBeNull();
      alpha.settings.set("github_token", "ghp_alpha_secret");
      const alphaHandle = alpha.state.getSetting("github_token");
      expect(alphaHandle).toMatch(/^zenod-secret:v1:/);
      expect(alphaHandle).not.toContain("ghp_alpha_secret");
      expect(alpha.settings.get("github_token")).toBe("ghp_alpha_secret");
      expect(beta.credentialVault.materialize("github_token", alphaHandle!)).toBeNull();
    } finally {
      pool.close();
    }
  });

  it("preserves an explicit tenant Drive archive selection across runtime restarts", async () => {
    const dataDir = await tempDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: CHASSIS_VAULT_MASTER_KEY,
    });
    const context = contextFor(storage, "tenant-drive");
    let pool = new ZenodRuntimePool();
    const first = pool.forContext(context);
    first.settings.set("artifact_archive_provider", "drive");
    first.settings.set("google_drive_folder_id", "folder-tenant-drive");
    await pool.close();

    pool = new ZenodRuntimePool();
    try {
      const restarted = pool.forContext(context);
      expect(restarted.settings.get("artifact_archive_provider")).toBe("drive");
      expect(restarted.settings.get("google_drive_folder_id")).toBe("folder-tenant-drive");
    } finally {
      await pool.close();
    }
  });

  it("defaults new production tenants to Drive without a tenant-zero special case", async () => {
    const dataDir = await tempDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: CHASSIS_VAULT_MASTER_KEY,
    });
    const pool = new ZenodRuntimePool({ NODE_ENV: "production" });
    try {
      expect(pool.forContext(contextFor(storage, "tenant-new")).settings.get("artifact_archive_provider"))
        .toBe("drive");
    } finally {
      await pool.close();
    }
  });

  it("boots through createUnit and delegates provisioning to the chassis store", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore();
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      controlPlane: { token: "control-secret" },
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    try {
      const health = await unit.app.request("/healthz");
      expect(health.status).toBe(200);
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");
      expect(health.headers.get("x-frame-options")).toBe("DENY");
      expect(health.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(health.headers.get("content-security-policy")).toContain("https://avatars.githubusercontent.com");
      await expect(health.json()).resolves.toMatchObject({
        status: "ok",
        name: "zenod",
      });

      const publicHealth = await unit.app.request("/api/health");
      expect(publicHealth.status).toBe(200);
      expect(publicHealth.headers.get("cache-control")).toBe("no-store");
      await expect(publicHealth.json()).resolves.toMatchObject({
        status: "ok",
        name: "zenod",
        sha: "unknown",
      });

      const protectedApi = await unit.app.request("/api/settings");
      expect(protectedApi.status).toBe(401);

      const provisioned = await unit.app.request("/api/tenants", {
        method: "POST",
        headers: {
          authorization: "Bearer control-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tenantId: "tenant-alpha" }),
      });
      expect(provisioned.status).toBe(201);
      expect(tenants.snapshot()).toHaveLength(1);
      expect(JSON.stringify(tenants.snapshot())).not.toContain(
        (await provisioned.json() as { token: string }).token,
      );
    } finally {
      unit.close();
    }
  });

  it("publishes the canonical Zenod skill card and downloadable bundle", async () => {
    const dataDir = await tempDir();
    const unit = createZenodUnit({
      dataDir,
      tenantStore: createMemoryTenantStore(),
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    try {
      const manifestResponse = await unit.app.request(
        "/.well-known/atomic-unit-skill.json",
      );
      expect(manifestResponse.status).toBe(200);
      await expect(manifestResponse.json()).resolves.toMatchObject({
        schemaVersion: "1.0",
        id: "zenod.memory",
        name: "Zenod",
        bundle: {
          format: "zenod-agent-skill-bundle-v1",
          url: "/.well-known/agent-skill-bundle.json",
        },
      });

      const bundleResponse = await unit.app.request(
        "/.well-known/agent-skill-bundle.json",
      );
      expect(bundleResponse.status).toBe(200);
      expect(bundleResponse.headers.get("content-type")).toContain(
        "application/vnd.zenod.agent-skill+json",
      );
      const bundle = await bundleResponse.json() as {
        format: string;
        files: Array<{ path: string; contentBase64: string }>;
      };
      expect(bundle.format).toBe("zenod-agent-skill-bundle-v1");
      expect(bundle.files.map((file) => file.path)).toEqual([
        "SKILL.md",
        "references/EXAMPLES.md",
        "references/WORKFLOW.md",
      ]);
      expect(Buffer.from(bundle.files[0]!.contentBase64, "base64").toString("utf8"))
        .toContain("name: zenod");
      const stored = await new PeerSkillStore(await tempDir()).put(bundle.files);
      expect(stored).toMatchObject({ name: "zenod", version: "1.0.0" });
    } finally {
      unit.close();
    }
  });

  it("routes product APIs through the authenticated tenant runtime", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "tenant-alpha" } },
      { token: "beta-token", tenant: { id: "tenant-beta" } },
    ]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    try {
      for (const [token, repo] of [
        ["alpha-token", "owner/alpha"],
        ["beta-token", "owner/beta"],
      ]) {
        const response = await unit.app.request("/api/settings", {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ vault_repo: repo }),
        });
        expect(response.status).toBe(200);
      }

      const alpha = await unit.app.request(
        "/api/settings?tenantId=tenant-beta",
        { headers: { authorization: "Bearer alpha-token" } },
      );
      const beta = await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer beta-token" },
      });
      expect(await alpha.json()).toMatchObject({
        settings: { vault_repo: "owner/alpha" },
      });
      expect(await beta.json()).toMatchObject({
        settings: { vault_repo: "owner/beta" },
      });

      const anonymous = await unit.app.request("/api/settings");
      expect(anonymous.status).toBe(401);

      const login = await unit.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "alpha-token" }),
      });
      expect(login.status).toBe(404);
      expect(login.headers.get("set-cookie")).toBeNull();
    } finally {
      unit.close();
    }
  });

  it("delegates a signed-in customer browser session to only its bound tenant", async () => {
    const dataDir = await tempDir();
    await writeFile(
      join(dataDir, "vault-app.json"),
      JSON.stringify({ id: "3718758", slug: "zenod-memory-v01a", privateKeyPem: "test-private-key" }),
      "utf8",
    );
    const tenants = createMemoryTenantStore([
      { token: "customer-token", tenant: { id: "github-42" } },
      { token: "other-token", tenant: { id: "github-99" } },
      { token: "selfhost-token", tenant: { id: "self-host" } },
    ]);
    const env = {
      NODE_ENV: "test",
      ACCOUNT_STATE_SECRET: "customer-session-secret",
      GITHUB_OAUTH_CLIENT_ID: "client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      CHASSIS_VAULT_MASTER_KEY,
    };
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env,
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
    });
    try {
      unit.customerAccounts.upsert("cs_customer", {
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "github-42",
        tenant_slug: "octocat-42",
        mcp_url: "https://cloud.zenod.dev/mcp/customer-token",
        mcp_token: "customer-token",
        checkout_completed_at: new Date().toISOString(),
      });
      unit.customerAccounts.upsert("cs_other", {
        account_id: "github-99",
        github_id: 99,
        github_login: "other",
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "github-99",
        tenant_slug: "other-99",
        checkout_completed_at: new Date().toISOString(),
      });
      unit.customerTokenVault.put("github-42", "customer-token");
      unit.customerTokenVault.put("github-99", "other-token");
      const cookie = await signInCustomer(unit);

      const bearerRawUsage = await unit.app.request("/api/usage", {
        headers: { authorization: "Bearer customer-token" },
      });
      expect(bearerRawUsage.status).toBe(403);
      expect(await bearerRawUsage.json()).toEqual({ error: "forbidden", capability: "raw_usage" });
      const bearerManagedMutation = await unit.app.request("/api/settings", {
        method: "PUT",
        headers: { authorization: "Bearer customer-token", "content-type": "application/json" },
        body: JSON.stringify({ openrouter_api_key: "must-not-change" }),
      });
      expect(bearerManagedMutation.status).toBe(403);
      expect(await bearerManagedMutation.json()).toEqual({ error: "forbidden", capability: "managed_settings" });
      expect((await unit.app.request("/api/usage", {
        headers: { authorization: "Bearer selfhost-token" },
      })).status).toBe(200);
      expect((await unit.app.request("/api/settings", {
        method: "PUT",
        headers: { authorization: "Bearer selfhost-token", "content-type": "application/json" },
        body: JSON.stringify({ openrouter_api_key: "self-host-managed" }),
      })).status).toBe(200);
      expect(unit.runtimes.get("self-host")!.settings.get("openrouter_api_key")).toBe("self-host-managed");
      expect((unit.runtimes.get("self-host")!.telegram as unknown as {
        options: { managedInboundEnabled?: () => boolean };
      }).options.managedInboundEnabled?.()).toBe(false);
      expect((await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer customer-token" },
      })).status).toBe(200);
      const hostedRuntime = unit.runtimes.get("github-42")!;
      hostedRuntime.settings.set("provider", "openrouter");
      hostedRuntime.settings.set("openrouter_api_key", "hosted-secret-tail-9876");
      hostedRuntime.settings.set("model_ask", "paid/model-private");
      hostedRuntime.settings.set("model_vision", "paid/vision-private");
      hostedRuntime.settings.set("vault_repo", "owner/customer-vault");
      hostedRuntime.usageStore.record({
        operation: "ask",
        provider: "openrouter",
        model: "paid/model-private",
        inputTokens: 123,
        outputTokens: 45,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
      });
      for (const headers of [
        { cookie },
        { authorization: "Bearer customer-token" },
      ]) {
        const allowedCustomerSettings = new Set([
          "instance_name",
          "vault_repo",
          "vault_branch",
          "google_drive_folder_id",
          "artifact_archive_provider",
          "artifact_archive_drive_folder_id",
          "telegram_enabled",
          "telegram_allowed_users",
          "telegram_accept_all",
          "telegram_rich",
        ]);
        const hostileSettings = Object.fromEntries(
          SETTING_KEYS
            .filter((key) => !allowedCustomerSettings.has(key))
            .map((key) => [key, key === "google_service_account_json" ? '{"private_key":"hostile"}' : `hostile-${key}`]),
        );
        const mixedSettings = await unit.app.request("/api/settings", {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            instance_name: "must-not-apply-atomically",
            ...hostileSettings,
            totally_unknown_key: "hostile-unknown",
          }),
        });
        expect(mixedSettings.status).toBe(403);
        expect(await mixedSettings.json()).toEqual({ error: "forbidden", capability: "managed_settings" });
        expect(hostedRuntime.settings.get("instance_name")).not.toBe("must-not-apply-atomically");
        expect(hostedRuntime.settings.get("github_token")).toBeNull();
        expect(hostedRuntime.settings.get("telegram_bot_token")).toBeNull();
        expect(hostedRuntime.settings.get("composio_api_key")).toBeNull();

        const mistypedSettings = await unit.app.request("/api/settings", {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ instance_name: 42 }),
        });
        expect(mistypedSettings.status).toBe(403);
        expect(await mistypedSettings.json()).toEqual({ error: "forbidden", capability: "managed_settings" });

        const safeUpdate = await unit.app.request("/api/settings", {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ telegram_rich: "true" }),
        });
        expect(safeUpdate.status).toBe(200);
        expect(hostedRuntime.settings.get("telegram_rich")).toBe("true");

        const wrongMethod = await unit.app.request("/api/settings", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        });
        expect(wrongMethod.status).toBe(403);
        expect(await wrongMethod.json()).toEqual({ error: "forbidden", capability: "customer_capability" });

        const safeSettings = await unit.app.request("/api/settings", { headers });
        expect(safeSettings.status).toBe(200);
        expect(await safeSettings.json()).toEqual({
          settings: expect.objectContaining({ vault_repo: "owner/customer-vault" }),
          configured: true,
          hostedManagedAi: true,
        });
        const settingsText = await (await unit.app.request("/api/settings", { headers })).text();
        expect(settingsText).not.toMatch(/openrouter|paid\/model|paid\/vision|9876|api_key|model_ask|model_vision/i);

        const overview = await unit.app.request("/api/overview", { headers });
        expect(overview.status).toBe(200);
        expect(await overview.json()).toMatchObject({ usage: null, tenant: { id: "github-42" } });
        const overviewText = await (await unit.app.request("/api/overview", { headers })).text();
        expect(overviewText).not.toMatch(/costUsd|inputTokens|outputTokens|byOperation|byModel|paid\/model|openrouter/i);

        const driveStatusText = await (await unit.app.request("/api/drive/status", { headers })).text();
        expect(driveStatusText).not.toMatch(/transcriptionProvider|openrouter|paid\/model/i);
        const safeDriveCallback = await unit.app.request("/api/drive/oauth/callback", { headers });
        expect(safeDriveCallback.status).toBe(400);
        expect(await safeDriveCallback.text()).toContain("invalid OAuth state");
        const authStatus = await unit.app.request("/api/auth/status", { headers });
        await expect(authStatus.json()).resolves.toMatchObject({
          needsSetup: false,
          configured: true,
        });
        expect(await (await unit.app.request("/api/auth/status", { headers })).text())
          .not.toMatch(/provider|model|api.?key|cost|token/i);
        const safeAgent = await unit.app.request("/api/agent", { headers });
        expect(safeAgent.status).toBe(200);
        const safeAgentBody = await safeAgent.json() as { panels: string[] } & Record<string, unknown>;
        expect(safeAgentBody).toMatchObject({
          name: "zenod",
          hostedMode: "managed",
        });
        expect(safeAgentBody.panels).toEqual(["overview", "connect", "channels", "vault", "usage", "account"]);
        for (const hiddenPanel of ["keys", "transcription", "costs", "test"]) {
          expect(safeAgentBody.panels).not.toContain(hiddenPanel);
        }
        expect(await (await unit.app.request("/api/agent", { headers })).text())
          .not.toMatch(/ring|provider|model|api.?key|token/i);
        const safeVault = await unit.app.request("/api/vault", { headers });
        expect(safeVault.status).toBe(200);
        expect(await safeVault.json()).toMatchObject({
          repo: "owner/customer-vault",
          branch: "main",
        });
        expect(await (await unit.app.request("/api/vault", { headers })).text())
          .not.toMatch(/provider|llmReady|cloneError|api.?key|token/i);
        const connections = await unit.app.request("/api/connections", { headers });
        expect(connections.status).toBe(200);
        expect(await connections.json()).toEqual({ mcpPath: "/mcp", clients: [], grants: [] });
        const token = await unit.app.request("/api/token", { headers });
        expect(token.status).toBe(200);
        expect(await token.json()).toEqual({ token: "", mcpPath: "/mcp" });
        const githubStatus = await unit.app.request("/api/github/app/status", { headers });
        expect(githubStatus.status).toBe(200);
        expect(await (await unit.app.request("/api/github/app/status", { headers })).text())
          .not.toMatch(/private.?key|api.?key|token/i);
        for (const path of [
          "/api/keys",
          "/api/executor/settings",
          "/api/transcription/status",
          "/api/transcription/models",
          "/api/transcription/openrouter-models",
        ]) {
          const denied = await unit.app.request(path, { headers });
          expect(denied.status, path).toBe(403);
          expect(await denied.json()).toEqual({ error: "forbidden", capability: "managed_settings" });
        }
        for (const path of [
          "/api/ring/status",
          "/api/phylax/status",
          "/api/team",
          "/api/peers",
          "/api/peers/codex/skill",
          "/internal",
          "/internal/diagnostics",
        ]) {
          const denied = await unit.app.request(path, { headers });
          expect(denied.status, path).toBe(403);
          expect(await denied.json()).toEqual({ error: "forbidden", capability: "internal_controls" });
        }
        for (const [method, path] of [
          ["PUT", "/api/ring/config"],
          ["POST", "/api/ring/route-test"],
          ["PUT", "/api/phylax/config"],
          ["POST", "/api/team/disable"],
          ["PUT", "/api/peers"],
          ["POST", "/api/peers/refresh"],
          ["POST", "/internal/reconcile"],
        ] as const) {
          const denied = await unit.app.request(path, {
            method,
            headers: { ...headers, "content-type": "application/json" },
            body: "{}",
          });
          expect(denied.status, `${method} ${path}`).toBe(403);
          expect(await denied.json()).toEqual({ error: "forbidden", capability: "internal_controls" });
        }
        for (const [method, path] of [
          ["GET", "/api/operating-rules"],
          ["GET", "/api/skills"],
          ["GET", "/api/mcp-config"],
          ["GET", "/api/test/chat"],
          ["GET", "/api/test/chat/hostile"],
          ["POST", "/api/notifications/search"],
          ["POST", "/api/notify"],
          ["POST", "/api/vault/clean-slate"],
          ["GET", "/api/github/app/setup?installation_id=999"],
          ["POST", "/api/agent/github"],
          ["POST", "/api/provision"],
          ["POST", "/api/auth/login"],
          ["POST", "/api/auth/setup"],
          ["GET", "/api/future-internal-control"],
        ] as const) {
          const denied = await unit.app.request(path, {
            method,
            headers: { ...headers, "content-type": "application/json" },
            ...(method === "POST" ? { body: "{}" } : {}),
          });
          if (path === "/api/auth/login" || path === "/api/auth/setup") {
            expect(denied.status).toBe(404);
            expect(await denied.json()).toEqual({ error: "not found" });
            continue;
          }
          expect(denied.status, `${method} ${path}`).toBe(403);
          const capability = path.startsWith("/api/agent/") || path.startsWith("/api/provision")
            ? "internal_controls"
            : "customer_capability";
          expect(await denied.json()).toEqual({ error: "forbidden", capability });
        }
      }
      const timelineRead = await unit.app.request("/mcp/customer-token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_llm_timeline", arguments: {} } }),
      });
      expect(timelineRead.status).toBe(403);
      expect(await timelineRead.json()).toEqual({ error: "forbidden", capability: "raw_usage" });

      const selfHostedSettings = await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer selfhost-token" },
      });
      expect(await selfHostedSettings.json()).toMatchObject({
        settings: { provider: null, openrouter_api_key: expect.stringContaining("••••") },
      });
      expect((await unit.app.request("/api/ring/status", {
        headers: { authorization: "Bearer selfhost-token" },
      })).status).toBe(200);
      expect((await unit.app.request("/api/operating-rules", {
        headers: { authorization: "Bearer selfhost-token" },
      })).status).toBe(200);
      expect((await unit.app.request("/api/agent/repo", {
        method: "POST",
        headers: { authorization: "Bearer selfhost-token", "content-type": "application/json" },
        body: JSON.stringify({ repo: "owner/self-host-vault", branch: "main" }),
      })).status).toBe(200);
      expect(unit.runtimes.get("self-host")!.settings.get("vault_repo")).toBe("owner/self-host-vault");
      expect((await unit.app.request("/api/telegram/settings", {
        method: "PUT",
        headers: { authorization: "Bearer customer-token", "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      })).status).toBe(403);

      const start = await unit.app.request("/api/github/app/start", { headers: { cookie } });
      expect(start.status).toBe(200);
      const startBody = await start.json() as { url: string };
      const installUrl = new URL(startBody.url);
      expect(`${installUrl.origin}${installUrl.pathname}`).toBe(
        "https://github.com/apps/zenod-memory-v01a/installations/new",
      );
      expect(startBody.url).not.toContain("settings/apps/new");

      const update = await unit.app.request("/api/settings?tenantId=github-99", {
        method: "PUT",
        headers: { cookie, authorization: "Bearer other-token", "content-type": "application/json" },
        body: JSON.stringify({ vault_repo: "owner/customer-vault" }),
      });
      expect(update.status).toBe(200);
      expect(await update.json()).toMatchObject({ settings: { vault_repo: "owner/customer-vault" } });
      const managedUpdate = await unit.app.request("/api/settings", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ openrouter_api_key: "must-not-change" }),
      });
      expect(managedUpdate.status).toBe(403);
      expect(await managedUpdate.json()).toEqual({ error: "forbidden", capability: "managed_settings" });
      expect(unit.runtimes.get("github-42")!.settings.get("openrouter_api_key")).toBe("hosted-secret-tail-9876");
      expect(unit.runtimes.get("github-99")).toBeNull();

      const rawUsage = await unit.app.request("/api/usage", { headers: { cookie } });
      expect(rawUsage.status).toBe(403);
      expect(await rawUsage.json()).toEqual({ error: "forbidden", capability: "raw_usage" });
      const customerUsage = await unit.app.request("/api/customer-usage", { headers: { cookie } });
      expect(customerUsage.status).toBe(200);
      expect(await customerUsage.json()).toEqual({
        percentageUsed: null,
        state: "unavailable",
        resetsAt: null,
      });

      const unsignedSetup = await unit.app.request("/github/setup?installation_id=9999", {
        headers: { cookie },
      });
      expect(unsignedSetup.status).toBe(400);
      expect(unit.runtimes.get("github-42")!.settings.getRaw("github_app_installation_id")).toBeNull();

      const setup = await unit.app.request(
        `/github/setup?installation_id=4242&state=${encodeURIComponent(installUrl.searchParams.get("state")!)}`,
        { headers: { cookie } },
      );
      expect(setup.status).toBe(302);
      const setupLocation = setup.headers.get("location")!;
      expect(setupLocation).toBe("/app?github=connected");
      expect(unit.runtimes.get("github-42")!.settings.getRaw("github_app_id")).toBe("3718758");
      expect(unit.runtimes.get("github-42")!.settings.getRaw("github_app_installation_id")).toBe("4242");

      const selectRepo = await unit.app.request("/api/vault/repository", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ repo: "octocat/brain", branch: "main" }),
      });
      expect(selectRepo.status).toBe(200);
      expect(unit.runtimes.get("github-42")!.settings.get("vault_repo")).toBe("octocat/brain");
      expect(unit.customerAccounts.resolveActiveTenantForUser(42)?.vault_repo).toBe("octocat/brain");
      for (const path of ["/api/tenants", "/api/exec/event", "/mcp/customer-token", "/internal/status"]) {
        const forbidden = await unit.app.request(path, {
          method: path === "/api/tenants" || path === "/api/exec/event" ? "POST" : "GET",
          headers: { cookie, authorization: "Bearer other-token" },
        });
        expect(forbidden.status, path).toBe(403);
      }
    } finally {
      unit.close();
    }
  });

  it("preserves raw tenant controls for the configured owner operator", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "operator-token", tenant: { id: "github-42" } }]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        NODE_ENV: "test",
        ACCOUNT_STATE_SECRET: "customer-session-secret",
        GITHUB_OAUTH_CLIENT_ID: "client-id",
        GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
        CHASSIS_VAULT_MASTER_KEY,
      },
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
      customerAdmin: { githubLogin: "octocat" },
    });
    try {
      unit.customerAccounts.upsert("operator", {
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "github-42",
        tenant_slug: "octocat-42",
        checkout_completed_at: new Date().toISOString(),
      });
      unit.customerTokenVault.put("github-42", "operator-token");
      const runtime = unit.runtimes.forTenantStorage("github-42", unit.storage.forTenant({ id: "github-42" }));
      runtime.settings.set("provider", "openrouter");
      runtime.settings.set("openrouter_api_key", "operator-visible-tail-9876");
      const cookie = await signInCustomer(unit);

      const settings = await unit.app.request("/api/settings", { headers: { cookie } });
      expect(settings.status).toBe(200);
      expect(await settings.json()).toMatchObject({
        settings: {
          provider: "openrouter",
          openrouter_api_key: expect.stringContaining("9876"),
        },
      });
      expect((await unit.app.request("/api/operating-rules", { headers: { cookie } })).status).toBe(200);
      expect((await unit.app.request("/api/agent/repo", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ repo: "owner/operator-vault", branch: "main" }),
      })).status).toBe(200);
      expect(runtime.settings.get("vault_repo")).toBe("owner/operator-vault");
    } finally {
      await unit.close();
    }
  });

  it("fails closed for canceled, suspended, and ambiguous customer bindings", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([
      { token: "customer-token", tenant: { id: "github-42" } },
      { token: "second-token", tenant: { id: "github-42-second" } },
    ]);
    const env = {
      NODE_ENV: "test",
      ACCOUNT_STATE_SECRET: "customer-session-secret",
      GITHUB_OAUTH_CLIENT_ID: "client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      CHASSIS_VAULT_MASTER_KEY,
    };
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env,
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
    });
    try {
      const base = {
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        tenant_slug: "octocat-42",
        checkout_completed_at: new Date().toISOString(),
      } as const;
      unit.customerAccounts.upsert("active", {
        ...base,
        subscription_status: "active",
        tenant_id: "github-42",
      });
      unit.customerTokenVault.put("github-42", "customer-token");
      const cookie = await signInCustomer(unit);

      tenants.setTenantStatus("github-42", "suspended");
      expect((await unit.app.request("/api/settings", { headers: { cookie } })).status).toBe(401);
      tenants.setTenantStatus("github-42", "active");

      unit.customerAccounts.upsert("canceled", {
        ...base,
        subscription_status: "canceled",
        tenant_id: "github-42",
        claimed_at: new Date(Date.now() + 1_000).toISOString(),
      });
      expect((await unit.app.request("/api/settings", { headers: { cookie } })).status).toBe(401);

      unit.customerAccounts.upsert("reactivated", {
        ...base,
        subscription_status: "active",
        tenant_id: "github-42",
        claimed_at: new Date(Date.now() + 2_000).toISOString(),
      });
      unit.customerAccounts.upsert("ambiguous", {
        ...base,
        account_id: "github-42-second",
        subscription_status: "active",
        tenant_id: "github-42-second",
        tenant_slug: "octocat-second",
        claimed_at: new Date(Date.now() + 3_000).toISOString(),
      });
      expect((await unit.app.request("/api/settings", { headers: { cookie } })).status).toBe(401);
    } finally {
      unit.close();
    }
  });

  it("admits Hosted text, audio, and image evidence at the cap and resumes each job idempotently", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "hosted-token", tenant: { id: "github-42" } }]);
    let atCap = true;
    const provider: ManagedAiProviderClient = {
      listKeys: vi.fn(async () => [{
        name: "zenod-tenant:octocat-42",
        slug: "octocat-42",
        hash: "hosted-key-hash",
        limit: 2,
        usage: atCap ? 2 : 0.25,
        usage_monthly: atCap ? 2 : 0.25,
        byok_usage_monthly: 0,
        limit_remaining: atCap ? 0 : 1.75,
        disabled: false,
        limit_reset: "monthly",
        include_byok_in_limit: true,
        reset_at: "2026-08-01T00:00:00.000Z",
      }]),
      createKey: vi.fn(async () => { throw new Error("must not provision in admission test"); }),
      updateKey: vi.fn(async () => undefined),
    };
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        NODE_ENV: "test",
        ACCOUNT_STATE_SECRET: "customer-session-secret",
        GITHUB_OAUTH_CLIENT_ID: "client-id",
        GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
        CHASSIS_VAULT_MASTER_KEY,
        ZENOD_MANAGED_AI_ENABLED: "1",
        OPENROUTER_PROVISIONING_KEY: "provider-management-key",
        ZENOD_MANAGED_AI_ADMISSION_RESUME_INTERVAL_MS: "600000",
      },
      customer: {
        managedAiProvider: provider,
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
      appOptionsForTenant: () => ({
        chatInterceptor: async () => ({ handled: true, text: "managed reply" }),
      }),
    });
    try {
      unit.customerAccounts.upsert("active", {
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "github-42",
        tenant_slug: "octocat-42",
        managed_ai_key_hash: "hosted-key-hash",
        checkout_completed_at: new Date().toISOString(),
      });
      unit.customerTokenVault.put("github-42", "hosted-token");
      const cookie = await signInCustomer(unit);
      const submit = async (path: string, idempotencyKey: string, contentType: string, body: BodyInit) => {
        const response = await unit.app.request(path, {
          method: "POST",
          headers: { cookie, "idempotency-key": idempotencyKey, "content-type": contentType },
          body,
        });
        expect(response.status).toBe(202);
        return response.json() as Promise<{ state: string; job: { id: string; kind: string; status: string } }>;
      };
      const text = await submit(
        "/api/chat",
        "text-provider-message",
        "application/json",
        JSON.stringify({ message: "remember this" }),
      );
      const audio = await submit(
        "/api/chat/voice/transcribe",
        "audio-provider-message",
        "audio/webm",
        Buffer.from("raw-audio"),
      );
      const image = await submit(
        "/api/chat",
        "image-provider-message",
        "application/json",
        JSON.stringify({ message: "file this", attachment: { mimeType: "image/png", data: "raw-image" } }),
      );
      expect([text.job.kind, audio.job.kind, image.job.kind]).toEqual(["text", "audio", "image"]);
      expect(text).toMatchObject({ state: "paused_at_cap", job: { status: "paused_at_cap" } });

      const duplicate = await submit(
        "/api/chat",
        "text-provider-message",
        "application/json",
        JSON.stringify({ message: "remember this" }),
      );
      expect(duplicate.job.id).toBe(text.job.id);
      const hostedRuntime = unit.runtimes.forTenantStorage(
        "github-42",
        unit.storage.forTenant({ id: "github-42" }),
      );
      hostedRuntime.settings.setTelegramSettings({
        botToken: "TEST:HOSTED",
        allowedUsers: ["42"],
        enabled: false,
        rich: true,
      });
      const telegramMessages: string[] = [];
      const telegramFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = String(input).split("/").pop();
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        if (method === "sendRichMessage") {
          telegramMessages.push(String((body.rich_message as { markdown?: unknown })?.markdown ?? ""));
        } else if (method === "sendMessage") {
          telegramMessages.push(String(body.text ?? ""));
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: telegramMessages.length || 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;
      (hostedRuntime.telegram as unknown as { options: { fetchImpl?: typeof fetch } }).options.fetchImpl = telegramFetch;
      vi.stubEnv("ZENOD_WHISPER_FAKE_TRANSCRIPT", "transcribed managed audio");
      const getManagedEngine = vi.spyOn(hostedRuntime, "getEngine").mockResolvedValue({
        handleTasking: async (input: { text: string }) => ({ text: `managed Telegram reply: ${input.text}`, actions: [] }),
        describeImage: async () => "managed image description",
      } as unknown as Awaited<ReturnType<typeof hostedRuntime.getEngine>>);
      const managedTelegramInbound = (hostedRuntime.telegram as unknown as {
        options: { managedInboundHandler?: (input: {
          kind: "text" | "audio" | "image";
          sender: string;
          chatId: string;
          messageId: string;
          updateId: string;
          text: string;
          capturedAt: string;
          media?: { dataBase64: string; mimeType: string; fileName: string };
        }) => Promise<void> };
      }).options.managedInboundHandler;
      expect(managedTelegramInbound).toBeTypeOf("function");
      const telegramJobs: string[] = [];
      for (const [kind, messageId] of [["text", "tg-text"], ["audio", "tg-audio"], ["image", "tg-image"]] as const) {
        await managedTelegramInbound!({
          kind,
          sender: "@octocat",
          chatId: "42",
          messageId,
          updateId: messageId,
          text: kind === "text" ? "remember from Telegram" : "",
          capturedAt: "2026-08-25T12:00:00.000Z",
          ...(kind === "text" ? {} : {
            media: {
              dataBase64: Buffer.from(`raw-${kind}`).toString("base64"),
              mimeType: kind === "audio" ? "audio/ogg" : "image/png",
              fileName: `evidence.${kind === "audio" ? "ogg" : "png"}`,
            },
          }),
        });
        const telegramJob = unit.customerManagedAiAdmissions.getByIdempotencyKey(
          "github-42",
          `telegram:42:${messageId}`,
        );
        expect(telegramJob).toMatchObject({
          kind,
          status: "paused_at_cap",
          attempts: 0,
          pausedNotice: { state: "sent" },
          terminalNotice: null,
        });
        telegramJobs.push(telegramJob!.id);
        expect(Buffer.from(unit.customerManagedAiAdmissions.raw(telegramJob!.id)!).toString("utf8"))
          .toContain(kind === "text" ? "remember from Telegram" : Buffer.from(`raw-${kind}`).toString("base64"));
      }
      const duplicateTelegramText = {
        kind: "text" as const,
        sender: "@octocat",
        chatId: "42",
        messageId: "tg-text",
        updateId: "tg-text",
        text: "remember from Telegram",
        capturedAt: "2026-08-25T12:00:00.000Z",
      };
      await managedTelegramInbound!(duplicateTelegramText);
      expect(unit.customerManagedAiAdmissions.getByIdempotencyKey("github-42", "telegram:42:tg-text"))
        .toMatchObject({ id: telegramJobs[0], attempts: 0, terminalReceipt: null, pausedNotice: { state: "sent" } });
      expect(telegramMessages).toEqual([
        expect.stringContaining("saved your message and queued it"),
        expect.stringContaining("saved your message and queued it"),
        expect.stringContaining("saved your message and queued it"),
      ]);
      const pausedJob = await unit.app.request(`/api/customer-managed-ai/jobs/${text.job.id}`, { headers: { cookie } });
      expect(await pausedJob.json()).toMatchObject({ job: { id: text.job.id, terminalReceipt: null } });
      const bearerPausedJob = await unit.app.request(`/api/customer-managed-ai/jobs/${text.job.id}`, {
        headers: { authorization: "Bearer hosted-token" },
      });
      expect(await bearerPausedJob.json()).toMatchObject({ job: { id: text.job.id, terminalReceipt: null } });

      atCap = false;
      expect(await unit.resumeManagedAiAdmissions()).toBe(6);
      const textJob = await unit.app.request(`/api/customer-managed-ai/jobs/${text.job.id}`, { headers: { cookie } });
      const audioJob = await unit.app.request(`/api/customer-managed-ai/jobs/${audio.job.id}`, { headers: { cookie } });
      expect(await textJob.json()).toMatchObject({ job: { status: "done", attempts: 1, terminalReceipt: { state: "completed" } } });
      expect(await audioJob.json()).toMatchObject({ job: { status: "error", attempts: 1, terminalReceipt: { state: "failed" } } });
      for (const telegramJobId of telegramJobs) {
        expect(unit.customerManagedAiAdmissions.get(telegramJobId)).toMatchObject({
          status: "done",
          attempts: 1,
          terminalReceipt: { state: "completed", statusCode: 200 },
          pausedNotice: { state: "sent" },
          terminalNotice: { state: "sent" },
        });
      }
      expect(telegramMessages).toHaveLength(6);
      expect(telegramMessages.slice(3)).toEqual([
        expect.stringContaining("managed Telegram reply: remember from Telegram"),
        expect.stringContaining("managed Telegram reply: transcribed managed audio"),
        expect.stringContaining("managed Telegram reply: Telegram image from @octocat"),
      ]);
      await managedTelegramInbound!(duplicateTelegramText);
      expect(unit.customerManagedAiAdmissions.get(telegramJobs[0]!)).toMatchObject({
        attempts: 1,
        terminalReceipt: { state: "completed", statusCode: 200 },
        terminalNotice: { state: "sent" },
      });
      expect(telegramMessages).toHaveLength(6);

      getManagedEngine.mockRejectedValueOnce(new Error("private provider detail must not escape"));
      const failedTelegramInput = {
        ...duplicateTelegramText,
        messageId: "tg-failed",
        updateId: "tg-failed",
        text: "this processing attempt fails",
      };
      await managedTelegramInbound!(failedTelegramInput);
      const failedTelegramJob = unit.customerManagedAiAdmissions.getByIdempotencyKey(
        "github-42",
        "telegram:42:tg-failed",
      );
      expect(failedTelegramJob).toMatchObject({
        status: "error",
        attempts: 1,
        terminalReceipt: { state: "failed", statusCode: 503 },
        terminalNotice: { state: "sent" },
      });
      expect(telegramMessages.at(-1)).toBe(
        "⚠️ I saved your message, but could not finish processing it. Please try again later.",
      );
      expect(telegramMessages.at(-1)).not.toContain("private provider detail");
      await managedTelegramInbound!(failedTelegramInput);
      expect(telegramMessages).toHaveLength(7);

      const replay = await unit.app.request("/api/chat", {
        method: "POST",
        headers: { cookie, "idempotency-key": "text-provider-message", "content-type": "application/json" },
        body: JSON.stringify({ message: "remember this" }),
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ text: "managed reply" });
    } finally {
      vi.unstubAllEnvs();
      await unit.close();
    }
  });

  it("rotates the bound token, updates the customer endpoint, and invalidates the old token", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "old-token", tenant: { id: "github-42" } }]);
    const env = {
      NODE_ENV: "test",
      ACCOUNT_STATE_SECRET: "customer-session-secret",
      GITHUB_OAUTH_CLIENT_ID: "client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      CUSTOMER_APP_URL: "https://cloud.zenod.dev",
      CHASSIS_VAULT_MASTER_KEY,
    };
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env,
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: null }),
        },
      },
    });
    try {
      unit.customerAccounts.upsert("active", {
        account_id: "github-42",
        github_id: 42,
        github_login: "octocat",
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "github-42",
        tenant_slug: "octocat-42",
        checkout_completed_at: new Date().toISOString(),
      });
      unit.customerTokenVault.put("github-42", "old-token");
      const cookie = await signInCustomer(unit);
      const rotated = await unit.app.request("/api/token/regenerate", { method: "POST", headers: { cookie } });
      expect(rotated.status).toBe(200);
      const body = await rotated.json() as { token: string; mcp_url: string };
      expect(body.token).not.toBe("old-token");
      expect(body.mcp_url).toBe(`https://cloud.zenod.dev/mcp/${body.token}`);
      expect(tenants.resolveTokenHash(hashToken("old-token"))).toBeNull();
      expect(tenants.resolveTokenHash(hashToken(body.token))).toMatchObject({ tenant: { id: "github-42" } });
      const accountJson = await readFile(join(dataDir, "customer-accounts.json"), "utf8");
      expect(accountJson).not.toContain("old-token");
      expect(accountJson).not.toContain(body.token);
    } finally {
      unit.close();
    }
  });

  it("keeps host-aware public and dashboard static routes outside tenant auth", async () => {
    const dataDir = await tempDir();
    const siteDist = join(dataDir, "site");
    const webDist = join(dataDir, "web");
    await mkdir(siteDist, { recursive: true });
    await mkdir(webDist, { recursive: true });
    await writeFile(join(siteDist, "index.html"), "PUBLIC SITE", "utf8");
    await writeFile(join(webDist, "index.html"), "CUSTOMER APP", "utf8");
    const unit = createZenodUnit({
      dataDir: join(dataDir, "data"),
      siteDist,
      webDist,
      tenantStore: createMemoryTenantStore(),
      env: { ACCOUNT_STATE_SECRET: "static-test-secret", CHASSIS_VAULT_MASTER_KEY },
    });
    try {
      expect(await (await unit.app.request("/", { headers: { host: "zenod.dev" } })).text()).toContain("PUBLIC SITE");
      expect(await (await unit.app.request("/", { headers: { host: "cloud.zenod.dev" } })).text()).toContain("CUSTOMER APP");
      expect(await (await unit.app.request("/app", { headers: { host: "cloud.zenod.dev" } })).text()).toContain("CUSTOMER APP");
    } finally {
      unit.close();
    }
  });

  it("keeps the deployed token-path MCP route on the integrated app", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "path-token", tenant: { id: "tenant-path" } }]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp/path-token`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "zenod" } } });

      const mcpUrl = new URL(`http://127.0.0.1:${address.port}/mcp/path-token`);
      const client = new Client({ name: "receipt-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(mcpUrl));
      const accepted = await client.callTool({
        name: "store_memory",
        arguments: { content: "conduct receipt test", verbatim: true },
      });
      expect(accepted.isError).not.toBe(true);
      expect(accepted.structuredContent).toMatchObject({
        status: "queued",
        state: "accepted",
        poll: { name: "get_task_result", inputField: "ticket_id" },
      });
      const receipt = accepted.structuredContent as { ticket_id: string; jobId: string };
      expect(receipt.ticket_id).toBeTruthy();
      expect(receipt.jobId).toBe(receipt.ticket_id);
      await client.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      unit.close();
    }
  });

  it("binds the exact memory-channel profile to distinct hosted tenant tokens", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([
      { token: "alpha-primary-token", tenant: { id: "tenant-alpha" } },
      { token: "beta-primary-token", tenant: { id: "tenant-beta" } },
    ]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      controlPlane: { token: "control-secret" },
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    const issue = async (tenantId: string): Promise<string> => {
      const response = await unit.app.request(
        `/api/tenants/${tenantId}/tokens`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer control-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ profile: "memory-channel" }),
        },
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { token: string }).token;
    };
    const alphaScoped = await issue("tenant-alpha");
    const betaScoped = await issue("tenant-beta");
    const scopedSettings = await unit.app.request("/api/settings", {
      headers: { authorization: `Bearer ${alphaScoped}` },
    });
    const scopedTokenRotation = await unit.app.request(
      "/api/token/regenerate",
      {
        method: "POST",
        headers: { authorization: `Bearer ${alphaScoped}` },
      },
    );
    const primarySettings = await unit.app.request("/api/settings", {
      headers: { authorization: "Bearer alpha-primary-token" },
    });
    expect(scopedSettings.status).toBe(401);
    expect(scopedTokenRotation.status).toBe(401);
    expect(primarySettings.status).toBe(200);
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve(
        { fetch: unit.app.fetch, port: 0 },
        () => resolve(started),
      );
    });
    const clients: Client[] = [];
    try {
      const address = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;
      const connect = async (token: string) => {
        const client = new Client({ name: "memory-channel-test", version: "1" });
        clients.push(client);
        await client.connect(
          new StreamableHTTPClientTransport(
            new URL(`${base}/mcp/${token}`),
          ),
        );
        return client;
      };
      const alpha = await connect(alphaScoped);
      const beta = await connect(betaScoped);
      const primary = await connect("alpha-primary-token");
      const expected = [...MEMORY_CHANNEL_MCP_TOOLS].sort();
      const primaryTools = (await primary.listTools()).tools;

      expect((await alpha.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
        expected,
      );
      expect((await beta.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
        expected,
      );
      expect(primaryTools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "install_operating_directive",
          "task_brain",
          ...MEMORY_CHANNEL_MCP_TOOLS,
        ]),
      );
      expect(primaryTools.map((tool) => tool.name)).not.toContain(
        "get_recent_conversation_transcript",
      );
      expect(primaryTools.find((tool) => tool.name === "search_memory")?.inputSchema)
        .toMatchObject({
          properties: {
            source: {},
            contentType: {},
            capturedAfter: {},
            capturedBefore: {},
            order: {},
            limit: {},
          },
        });

      const allowed = await alpha.callTool({
        name: "get_task_result",
        arguments: { ticket_id: "missing-ticket" },
      });
      expect(allowed.isError).toBe(true);
      expect(JSON.stringify(allowed)).toMatch(/No job found/);
      const denied = await alpha.callTool({
        name: "task_brain",
        arguments: { task: "must never execute" },
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toMatch(/not found/i);

      const mismatch = await fetch(`${base}/mcp/${alphaScoped}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${betaScoped}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "cross-tenant", version: "1" },
          },
        }),
      });
      expect(mismatch.status).toBe(401);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      unit.close();
    }
  });

  it("serves OAuth DCR metadata and a working /oauth/register so MCP connectors can self-register", async () => {
    const dataDir = await tempDir();
    const unit = createZenodUnit({
      dataDir,
      tenantStore: createMemoryTenantStore([{ token: "reg-token", tenant: { id: "tenant-reg" } }]),
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
    });
    try {
      const address = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;

      // Discovery must return JSON metadata that advertises the registration endpoint —
      // not the SPA fallback (the regression that made the connector fall back to
      // POST /register → 404).
      const meta = await fetch(`${base}/.well-known/oauth-authorization-server`);
      expect(meta.status).toBe(200);
      expect(meta.headers.get("content-type")).toContain("application/json");
      const metaBody = (await meta.json()) as { registration_endpoint?: string };
      expect(metaBody.registration_endpoint).toBe(`${base}/oauth/register`);

      // Dynamic client registration (RFC 7591) must succeed and mint a client_id.
      const register = await fetch(`${base}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      });
      expect(register.status).toBe(201);
      expect((await register.json()) as { client_id: string }).toMatchObject({
        client_id: expect.stringMatching(/^zc_/),
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      unit.close();
    }
  });

  it("uses the durable chassis tenant store for idempotent self-host restart", async () => {
    const dataDir = await tempDir();
    const env = {
      ZENOD_API_TOKEN: "zenod_self_host_restart_token",
      ZENOD_TENANT_ID: "self-host-test",
      CHASSIS_VAULT_MASTER_KEY,
    };
    const first = createZenodUnit({ dataDir, env });
    expect(
      await first.tenantStore.resolveTokenHash(
        hashToken(env.ZENOD_API_TOKEN),
      ),
    ).toMatchObject({ tenant: { id: "self-host-test" } });
    first.close();

    const restarted = createZenodUnit({ dataDir, env });
    try {
      expect(
        await restarted.tenantStore.resolveTokenHash(
          hashToken(env.ZENOD_API_TOKEN),
        ),
      ).toMatchObject({ tenant: { id: "self-host-test" } });
    } finally {
      restarted.close();
    }
  });
});
