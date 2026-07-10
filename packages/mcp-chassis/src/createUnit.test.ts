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
});
