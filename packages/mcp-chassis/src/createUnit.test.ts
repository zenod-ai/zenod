import { createHash } from "node:crypto";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage, ChassisUsageStore, createMemoryTenantStore, createUnit, hashToken, type UnitContext } from "./index.js";

const servers: ServerType[] = [];
const tempDirs: string[] = [];

async function listen(
  app: ReturnType<typeof createUnit>["app"],
): Promise<string> {
  const info = await new Promise<{ port: number }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (address) => {
        resolve({ port: address.port });
      },
    );
    servers.push(server);
  });
  return `http://127.0.0.1:${info.port}`;
}

afterEach(async () => {
  await Promise.all([
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
    ...tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  ]);
});

function initializeBody(id = 1, params: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-chassis-test", version: "0.0.0" },
      ...params,
    },
  });
}

async function initialize(
  base: string,
  init?: RequestInit,
  path = "/mcp",
  params: Record<string, unknown> = {},
): Promise<Response> {
  const { headers, ...rest } = init ?? {};
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeBody(1, params),
    ...rest,
  });
}

function controlPlaneHeaders(token = "control-secret"): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function provisionTenant(
  base: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${base}/api/tenants`, {
    method: "POST",
    headers: controlPlaneHeaders(),
    body: JSON.stringify(body),
  });
}

async function login(base: string, token: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie ?? "";
}

async function tempWebDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-web-"));
  tempDirs.push(dir);
  await writeFile(
    join(dir, "index.html"),
    "<!doctype html><main>chassis shell</main>",
  );
  await writeFile(join(dir, "asset.txt"), "asset");
  return dir;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function formBody(input: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) body.set(key, value);
  return body;
}

describe("createUnit", () => {
  it("serves healthz", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    await expect(
      fetch(`${base}/healthz`).then((r) => r.json()),
    ).resolves.toEqual({
      status: "ok",
      name: "demo",
      version: "1.2.3",
    });
  });

  it("answers MCP initialize over stateless Streamable HTTP", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    const response = await initialize(base);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "demo",
          version: "1.2.3",
        },
      },
    });
  });

  it("stores only token hashes in the memory tenant table", () => {
    const tenants = createMemoryTenantStore([
      { token: "raw-secret-token", tenant: { id: "tenant-a" } },
    ]);

    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("raw-secret-token"),
        tenant: { id: "tenant-a" },
        status: "active",
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(tenants.snapshot())).not.toContain(
      "raw-secret-token",
    );
  });

  it("resolves bearer and tokened MCP URL auth to tenant context for tools", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-auth-storage-"));
    tempDirs.push(dataDir);
    const seenTenants: Array<string | null> = [];
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
      {
        token: "tenant-two-token",
        tenant: { id: "tenant-two", name: "Tenant Two" },
      },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      tools(_server, context) {
        seenTenants.push(context.tenant?.id ?? null);
      },
    });
    const base = await listen(unit.app);

    const bearerResponse = await initialize(base, {
      headers: { authorization: "Bearer tenant-one-token" },
    });
    const urlResponse = await initialize(
      base,
      undefined,
      "/mcp/tenant-two-token",
    );

    expect(bearerResponse.status).toBe(200);
    expect(urlResponse.status).toBe(200);
    expect(seenTenants).toEqual(["tenant-one", "tenant-two"]);
  });

  it("rejects unknown or mutated tenant tokens with WWW-Authenticate", async () => {
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({ name: "demo", tenantAuth: { store: tenants } });
    const base = await listen(unit.app);

    const unknown = await initialize(base, {
      headers: { authorization: "Bearer unknown-token" },
    });
    const mutated = await initialize(
      base,
      undefined,
      "/mcp/known-token-mutated",
    );

    expect(unknown.status).toBe(401);
    expect(mutated.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis", error="invalid_token"',
    );
    expect(mutated.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis", error="invalid_token"',
    );
    await expect(unknown.json()).resolves.toEqual({ error: "unauthorized" });
    await expect(mutated.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("guards POST /api/tenants and mints one raw token without storing it", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);

    const unauthorized = await fetch(`${base}/api/tenants`, { method: "POST" });
    const created = await provisionTenant(base, {
      tenantId: "tenant-a",
      name: "Tenant A",
      plan: "pro",
    });

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis-control-plane", error="invalid_token"',
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({
      tenant: { id: "tenant-a", name: "Tenant A", plan: "pro" },
      status: "active",
    });
    expect(body.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken(body.token),
        tenant: { id: "tenant-a", name: "Tenant A", plan: "pro" },
        status: "active",
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(tenants.snapshot())).not.toContain(body.token);

    const mcp = await initialize(base, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(mcp.status).toBe(200);
  });

  it("rejects suspended and deleted tenants during MCP auth", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);
    const first = await provisionTenant(base, { tenantId: "tenant-a" }).then(
      (r) => r.json(),
    );
    const second = await provisionTenant(base, { tenantId: "tenant-b" }).then(
      (r) => r.json(),
    );

    const suspended = await fetch(`${base}/api/tenants/tenant-a`, {
      method: "PATCH",
      headers: controlPlaneHeaders(),
      body: JSON.stringify({ status: "suspended" }),
    });
    const deleted = await fetch(`${base}/api/tenants/tenant-b`, {
      method: "DELETE",
      headers: controlPlaneHeaders(),
    });

    expect(suspended.status).toBe(200);
    await expect(suspended.json()).resolves.toEqual({
      tenant: { id: "tenant-a" },
      status: "suspended",
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({
      tenant: { id: "tenant-b" },
      status: "deleted",
    });
    await expect(
      initialize(base, { headers: { authorization: `Bearer ${first.token}` } }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${second.token}` },
      }),
    ).resolves.toHaveProperty("status", 401);
  });

  it("rotates tenant tokens and invalidates the old token", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);
    const created = await provisionTenant(base, { tenantId: "tenant-a" }).then(
      (r) => r.json(),
    );

    const rotatedResponse = await fetch(
      `${base}/api/tenants/tenant-a/token/rotate`,
      {
        method: "POST",
        headers: controlPlaneHeaders(),
      },
    );
    const rotated = await rotatedResponse.json();

    expect(rotatedResponse.status).toBe(200);
    expect(rotated.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(rotated.token).not.toBe(created.token);
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken(rotated.token),
        tenant: { id: "tenant-a" },
        status: "active",
        expiresAt: null,
      },
    ]);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${created.token}` },
      }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${rotated.token}` },
      }),
    ).resolves.toHaveProperty("status", 200);
  });

  it("binds UI token login sessions to one tenant and ignores cross-tenant URL attempts", async () => {
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
      {
        token: "tenant-two-token",
        tenant: { id: "tenant-two", name: "Tenant Two" },
      },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      ui: {
        displayName: "Demo Unit",
        tagline: "Tenant settings",
        panels: ["keys", "connections"],
        sessionSecret: "test-session-secret",
      },
    });
    const base = await listen(unit.app);

    const tenantOneCookie = await login(base, "tenant-one-token");
    const tenantTwoCookie = await login(base, "tenant-two-token");
    const status = await fetch(`${base}/api/auth/status`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const settings = await fetch(`${base}/api/settings?tenantId=tenant-two`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const overview = await fetch(`${base}/api/overview`, {
      headers: { cookie: tenantTwoCookie },
    }).then((r) => r.json());
    const agent = await fetch(`${base}/api/agent`).then((r) => r.json());

    expect(status).toMatchObject({
      authenticated: true,
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    expect(settings).toMatchObject({
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    expect(JSON.stringify(settings)).not.toContain("tenant-two");
    expect(overview).toMatchObject({
      tenant: { id: "tenant-two", name: "Tenant Two" },
    });
    expect(agent).toMatchObject({
      name: "demo",
      displayName: "Demo Unit",
      tagline: "Tenant settings",
      panels: ["keys", "connections"],
    });
  });

  it("rejects protected UI routes without a tenant session or bearer token", async () => {
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      ui: { sessionSecret: "test-session-secret" },
    });
    const base = await listen(unit.app);

    const anonymous = await fetch(`${base}/api/settings`);
    const bearer = await fetch(`${base}/api/settings`, {
      headers: { authorization: "Bearer known-token" },
    });

    expect(anonymous.status).toBe(401);
    expect(bearer.status).toBe(200);
    await expect(bearer.json()).resolves.toMatchObject({
      tenant: { id: "tenant-a" },
    });
  });

  it("rotates the logged-in tenant token from the UI and invalidates the old MCP token", async () => {
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
      ui: { sessionSecret: "test-session-secret" },
    });
    const base = await listen(unit.app);
    const cookie = await login(base, "tenant-one-token");

    const rotatedResponse = await fetch(`${base}/api/token/regenerate`, {
      method: "POST",
      headers: { cookie },
    });
    const rotated = await rotatedResponse.json();

    expect(rotatedResponse.status).toBe(200);
    expect(rotated).toMatchObject({
      tenant: { id: "tenant-one" },
      mcpPath: "/mcp",
    });
    expect(rotated.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    await expect(
      initialize(base, {
        headers: { authorization: "Bearer tenant-one-token" },
      }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${rotated.token}` },
      }),
    ).resolves.toHaveProperty("status", 200);
  });

  it("serves the existing React console assets with an SPA fallback", async () => {
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      ui: {
        webDist: await tempWebDist(),
        sessionSecret: "test-session-secret",
      },
    });
    const base = await listen(unit.app);

    await expect(
      fetch(`${base}/asset.txt`).then((r) => r.text()),
    ).resolves.toBe("asset");
    const fallback = await fetch(`${base}/settings/keys`);

    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    await expect(fallback.text()).resolves.toContain("chassis shell");
  });

  it("seeds one implicit self-host tenant from env token", async () => {
    const tenants = createMemoryTenantStore();
    const env = { DEMO_API_TOKEN: "zenod_self_host_seed_token" };
    const first = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      singleTenant: { store: tenants, env },
    });
    createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      singleTenant: { store: tenants, env },
    });
    const base = await listen(first.app);

    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("zenod_self_host_seed_token"),
        tenant: { id: "self-host", name: "Self-host", plan: "self-host" },
        status: "active",
        expiresAt: null,
      },
    ]);
    const response = await initialize(base, {
      headers: { authorization: "Bearer zenod_self_host_seed_token" },
    });
    expect(response.status).toBe(200);
  });

  it("maps MCP OAuth sign-in grants back to the approving tenant", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-oauth-server-"));
    tempDirs.push(dataDir);
    const seenTenants: Array<string | null> = [];
    const tenants = createMemoryTenantStore([{ token: "tenant-one-token", tenant: { id: "tenant-one" } }]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      oauth: { server: true },
      tools(_server, context) {
        seenTenants.push(context.tenant?.id ?? null);
      },
    });
    const base = await listen(unit.app);

    const unauthenticated = await initialize(base);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      `${base}/.well-known/oauth-protected-resource`,
    );

    const registered = (await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Desktop",
        redirect_uris: ["https://client.example/callback"],
      }),
    }).then((r) => r.json())) as { client_id: string };
    const verifier = "deterministic-test-verifier";
    const authorizeParams = {
      client_id: registered.client_id,
      redirect_uri: "https://client.example/callback",
      state: "client-state",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      resource: `${base}/mcp`,
      scope: "mcp",
    };

    const decision = await fetch(`${base}/oauth/authorize/decision`, {
      method: "POST",
      redirect: "manual",
      body: formBody({ ...authorizeParams, token: "tenant-one-token", decision: "approve" }),
    });
    expect(decision.status).toBe(302);
    const location = decision.headers.get("location");
    expect(location).toBeTruthy();
    const code = new URL(location!).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await fetch(`${base}/oauth/token`, {
      method: "POST",
      body: formBody({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: authorizeParams.redirect_uri,
        code_verifier: verifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as { access_token: string };

    const mcp = await initialize(base, { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
    expect(mcp.status).toBe(200);
    expect(seenTenants).toEqual(["tenant-one"]);
  });

  it("binds provider OAuth state to one tenant and stores tokens in that tenant vault", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-oauth-"));
    tempDirs.push(dataDir);
    const storage = new ChassisStorage({ dataDir });
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one" } },
      { token: "tenant-two-token", tenant: { id: "tenant-two" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      storage,
      oauth: {
        providers: [
          {
            id: "demo",
            displayName: "Demo Provider",
            clientId: "demo-client",
            authorizationUrl: "https://provider.example/oauth",
            scopes: ["read"],
            exchangeCode: ({ code, tenant }) => ({
              accessToken: `access-${tenant.id}-${code}`,
              refreshToken: `refresh-${tenant.id}`,
            }),
          },
        ],
      },
    });
    const base = await listen(unit.app);

    const start = await fetch(`${base}/api/oauth/providers/demo/start`, {
      redirect: "manual",
      headers: { authorization: "Bearer tenant-one-token" },
    });
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state");
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
    expect(authorizeUrl.origin).toBe("https://provider.example");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("demo-client");
    expect(authorizeUrl.searchParams.get("scope")).toBe("read");
    expect(state).toBeTruthy();
    expect(new URL(redirectUri!).searchParams.get("tenant_id")).toBe("tenant-one");

    const mismatched = new URL(redirectUri!);
    mismatched.searchParams.set("tenant_id", "tenant-two");
    mismatched.searchParams.set("code", "wrong-tenant-code");
    mismatched.searchParams.set("state", state!);
    const mismatchResponse = await fetch(mismatched);
    expect(mismatchResponse.status).toBe(400);
    await expect(mismatchResponse.json()).resolves.toEqual({ error: "tenant_state_mismatch" });

    const replayed = new URL(redirectUri!);
    replayed.searchParams.set("code", "valid-code-after-replay");
    replayed.searchParams.set("state", state!);
    const replayResponse = await fetch(replayed);
    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toEqual({ error: "invalid_oauth_state" });

    const secondStart = await fetch(`${base}/api/oauth/providers/demo/start`, {
      redirect: "manual",
      headers: { authorization: "Bearer tenant-one-token" },
    });
    const secondAuthorizeUrl = new URL(secondStart.headers.get("location")!);
    const secondState = secondAuthorizeUrl.searchParams.get("state");
    const secondCallback = new URL(secondAuthorizeUrl.searchParams.get("redirect_uri")!);
    secondCallback.searchParams.set("code", "valid-code");
    secondCallback.searchParams.set("state", secondState!);

    const callback = await fetch(secondCallback);
    expect(callback.status).toBe(200);
    await expect(callback.json()).resolves.toEqual({ ok: true, provider: "demo", tenant: { id: "tenant-one" } });

    const tenantOneVault = storage.forTenant({ id: "tenant-one" }).vault();
    const tenantTwoVault = storage.forTenant({ id: "tenant-two" }).vault();
    try {
      expect(JSON.parse(tenantOneVault.get("oauth:demo")!)).toMatchObject({
        providerId: "demo",
        tenantId: "tenant-one",
        tokens: {
          accessToken: "access-tenant-one-valid-code",
          refreshToken: "refresh-tenant-one",
        },
      });
      expect(tenantTwoVault.get("oauth:demo")).toBeNull();
    } finally {
      tenantOneVault.close();
      tenantTwoVault.close();
    }
  });

  it("binds storage to the trusted tenant resolved by auth, not client-supplied tenant ids", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-"));
    tempDirs.push(dataDir);
    let captured: UnitContext | undefined;
    const tenants = createMemoryTenantStore([{ token: "tenant-alpha-token", tenant: { id: "tenant_alpha" } }]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      tools(_server, context) {
        captured = context;
      },
    });
    const base = await listen(unit.app);

    const response = await initialize(
      base,
      { headers: { authorization: "Bearer tenant-alpha-token" } },
      "/mcp",
      { tenant_id: "tenant_beta" },
    );

    expect(response.status).toBe(200);
    expect(captured?.tenant).toEqual({ id: "tenant_alpha" });
    expect(captured?.storage?.rootDir).toBe(join(dataDir, "tenant_alpha"));
    expect(captured?.storage?.dir("unit")).toBe(join(dataDir, "tenant_alpha", "unit"));
  });

  it("increments only the resolved tenant's usage for MCP requests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-usage-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    const seenUsageTotals: number[] = [];
    const tenants = createMemoryTenantStore([
      { token: "tenant-alpha-token", tenant: { id: "tenant_alpha", quota: 10 } },
      { token: "tenant-beta-token", tenant: { id: "tenant_beta", quota: 10 } },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      metering: usageStore,
      tools(_server, context) {
        seenUsageTotals.push(context.usage?.summary().units ?? 0);
      },
    });
    const base = await listen(unit.app);

    expect((await initialize(base, { headers: { authorization: "Bearer tenant-alpha-token" } })).status).toBe(200);
    expect((await initialize(base, { headers: { authorization: "Bearer tenant-beta-token" } })).status).toBe(200);
    expect((await initialize(base, { headers: { authorization: "Bearer tenant-alpha-token" } })).status).toBe(200);

    expect(seenUsageTotals).toEqual([1, 1, 2]);
    expect(usageStore.summary({ id: "tenant_alpha" })).toMatchObject({ events: 2, units: 2 });
    expect(usageStore.summary({ id: "tenant_beta" })).toMatchObject({ events: 1, units: 1 });
    expect(JSON.stringify(usageStore.timeline({ id: "tenant_alpha" }))).not.toContain("tenant_beta");
    usageStore.close();
  });

  it("returns a structured denial and does not run tools when tenant quota is zero", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-quota-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    let toolCalls = 0;
    const tenants = createMemoryTenantStore([{ token: "tenant-zero-token", tenant: { id: "tenant_zero", quota: 0 } }]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      metering: usageStore,
      tools() {
        toolCalls += 1;
      },
    });
    const base = await listen(unit.app);

    const response = await initialize(base, { headers: { authorization: "Bearer tenant-zero-token" } });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "quota_exceeded",
      quota: 0,
      used: 0,
      requested: 1,
      remaining: 0,
    });
    expect(toolCalls).toBe(0);
    expect(usageStore.summary({ id: "tenant_zero" })).toMatchObject({ events: 0, units: 0 });
    usageStore.close();
  });

  it("honors quota supplied through tenant provisioning", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-provisioned-quota-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    let toolCalls = 0;
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
      metering: usageStore,
      tools() {
        toolCalls += 1;
      },
    });
    const base = await listen(unit.app);
    const created = await provisionTenant(base, { tenantId: "tenant_zero", quota: 0 }).then((r) => r.json());

    const response = await initialize(base, { headers: { authorization: `Bearer ${created.token}` } });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "quota_exceeded", quota: 0 });
    expect(toolCalls).toBe(0);
    expect(tenants.snapshot()[0]?.tenant).toEqual({ id: "tenant_zero", quota: 0 });
    usageStore.close();
  });
});
