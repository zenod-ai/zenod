import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryTenantStore, createUnit, hashToken } from "./index.js";

const servers: ServerType[] = [];

async function listen(app: ReturnType<typeof createUnit>["app"]): Promise<string> {
  const info = await new Promise<{ port: number }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (address) => {
      resolve({ port: address.port });
    });
    servers.push(server);
  });
  return `http://127.0.0.1:${info.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
  );
});

function initializeBody(id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-chassis-test", version: "0.0.0" },
    },
  });
}

async function initialize(base: string, init?: RequestInit, path = "/mcp"): Promise<Response> {
  const { headers, ...rest } = init ?? {};
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeBody(),
    ...rest,
  });
}

function controlPlaneHeaders(token = "control-secret"): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function provisionTenant(base: string, body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${base}/api/tenants`, {
    method: "POST",
    headers: controlPlaneHeaders(),
    body: JSON.stringify(body),
  });
}

describe("createUnit", () => {
  it("serves healthz", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    await expect(fetch(`${base}/healthz`).then((r) => r.json())).resolves.toEqual({
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
    const tenants = createMemoryTenantStore([{ token: "raw-secret-token", tenant: { id: "tenant-a" } }]);

    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("raw-secret-token"),
        tenant: { id: "tenant-a" },
        status: "active",
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(tenants.snapshot())).not.toContain("raw-secret-token");
  });

  it("resolves bearer and tokened MCP URL auth to tenant context for tools", async () => {
    const seenTenants: Array<string | null> = [];
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one", name: "Tenant One" } },
      { token: "tenant-two-token", tenant: { id: "tenant-two", name: "Tenant Two" } },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      tenantAuth: { store: tenants },
      tools(_server, context) {
        seenTenants.push(context.tenant?.id ?? null);
      },
    });
    const base = await listen(unit.app);

    const bearerResponse = await initialize(base, { headers: { authorization: "Bearer tenant-one-token" } });
    const urlResponse = await initialize(base, undefined, "/mcp/tenant-two-token");

    expect(bearerResponse.status).toBe(200);
    expect(urlResponse.status).toBe(200);
    expect(seenTenants).toEqual(["tenant-one", "tenant-two"]);
  });

  it("rejects unknown or mutated tenant tokens with WWW-Authenticate", async () => {
    const tenants = createMemoryTenantStore([{ token: "known-token", tenant: { id: "tenant-a" } }]);
    const unit = createUnit({ name: "demo", tenantAuth: { store: tenants } });
    const base = await listen(unit.app);

    const unknown = await initialize(base, { headers: { authorization: "Bearer unknown-token" } });
    const mutated = await initialize(base, undefined, "/mcp/known-token-mutated");

    expect(unknown.status).toBe(401);
    expect(mutated.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toBe('Bearer realm="mcp-chassis", error="invalid_token"');
    expect(mutated.headers.get("www-authenticate")).toBe('Bearer realm="mcp-chassis", error="invalid_token"');
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
    const created = await provisionTenant(base, { tenantId: "tenant-a", name: "Tenant A", plan: "pro" });

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

    const mcp = await initialize(base, { headers: { authorization: `Bearer ${body.token}` } });
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
    const first = await provisionTenant(base, { tenantId: "tenant-a" }).then((r) => r.json());
    const second = await provisionTenant(base, { tenantId: "tenant-b" }).then((r) => r.json());

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
    await expect(initialize(base, { headers: { authorization: `Bearer ${first.token}` } })).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(initialize(base, { headers: { authorization: `Bearer ${second.token}` } })).resolves.toHaveProperty(
      "status",
      401,
    );
  });

  it("rotates tenant tokens and invalidates the old token", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);
    const created = await provisionTenant(base, { tenantId: "tenant-a" }).then((r) => r.json());

    const rotatedResponse = await fetch(`${base}/api/tenants/tenant-a/token/rotate`, {
      method: "POST",
      headers: controlPlaneHeaders(),
    });
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
    await expect(initialize(base, { headers: { authorization: `Bearer ${created.token}` } })).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(initialize(base, { headers: { authorization: `Bearer ${rotated.token}` } })).resolves.toHaveProperty(
      "status",
      200,
    );
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
    const response = await initialize(base, { headers: { authorization: "Bearer zenod_self_host_seed_token" } });
    expect(response.status).toBe(200);
  });
});
