import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import {
  ChassisStorage,
  createMemoryTenantStore,
  hashToken,
  type UnitContext,
} from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import {
  createZenodUnit,
  ZENOD_READ_TOOLS,
  ZenodRuntimePool,
} from "../src/zenodUnit.js";

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
      "get_recent_conversation_transcript",
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
      await expect(health.json()).resolves.toMatchObject({
        status: "ok",
        name: "zenod",
      });

      const publicHealth = await unit.app.request("/api/health");
      expect(publicHealth.status).toBe(200);
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
    const tenants = createMemoryTenantStore([
      { token: "customer-token", tenant: { id: "github-42" } },
      { token: "other-token", tenant: { id: "github-99" } },
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

      const update = await unit.app.request("/api/settings?tenantId=github-99", {
        method: "PUT",
        headers: { cookie, authorization: "Bearer other-token", "content-type": "application/json" },
        body: JSON.stringify({ vault_repo: "owner/customer-vault" }),
      });
      expect(update.status).toBe(200);
      expect(await update.json()).toMatchObject({ settings: { vault_repo: "owner/customer-vault" } });
      expect(unit.runtimes.get("github-42")).not.toBeNull();
      expect(unit.runtimes.get("github-99")).toBeNull();
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
