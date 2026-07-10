import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoUnit, DEMO_CONTROL_TOKEN } from "./demo.js";

const servers: ServerType[] = [];
const tempDirs: string[] = [];
const TEST_VAULT_KEY = "22".repeat(32);

afterEach(async () => {
  await Promise.all([
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
    ...tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  ]);
});

async function listen(env: NodeJS.ProcessEnv): Promise<string> {
  const unit = createDemoUnit(env);
  const address = await new Promise<{ port: number }>((resolve) => {
    const server = serve(
      { fetch: unit.app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => resolve({ port: info.port }),
    );
    servers.push(server);
  });
  return `http://127.0.0.1:${address.port}`;
}

function mcpBody(method: string, params: Record<string, unknown>, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function mcp(
  base: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
  id = 1,
): Promise<Response> {
  return fetch(`${base}/mcp/${token}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: mcpBody(method, params, id),
  });
}

async function provision(base: string, id: string, name: string) {
  const response = await fetch(`${base}/api/tenants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEMO_CONTROL_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tenantId: id, name, plan: "demo" }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    tenant: { id: string; name: string };
    token: string;
  };
}

async function login(base: string, token: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

describe("MCP chassis demo", () => {
  it("proves three-tenant isolation, token rotation, and single-tenant parity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-demo-e2e-"));
    tempDirs.push(dataDir);
    const base = await listen({
      DATA_DIR: dataDir,
      CONTROL_PLANE_TOKEN: DEMO_CONTROL_TOKEN,
      DEMO_SESSION_SECRET: "three-tenant-session-secret",
      CHASSIS_VAULT_MASTER_KEY: TEST_VAULT_KEY,
    });

    const tenants = await Promise.all([
      provision(base, "tenant-1", "Tenant One"),
      provision(base, "tenant-2", "Tenant Two"),
      provision(base, "tenant-3", "Tenant Three"),
    ]);

    for (const [index, tenant] of tenants.entries()) {
      const initialized = await mcp(base, tenant.token, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "demo-e2e", version: "1.0.0" },
      });
      expect(initialized.status).toBe(200);

      const marker = `marker-for-${tenant.tenant.id}`;
      const written = await mcp(
        base,
        tenant.token,
        "tools/call",
        { name: "set_tenant_marker", arguments: { marker } },
        index + 10,
      );
      expect(written.status).toBe(200);
      await expect(written.json()).resolves.toMatchObject({
        result: {
          structuredContent: {
            tenant: { id: tenant.tenant.id },
            marker,
            evidence: [
              { kind: "tenant_marker", id: `${tenant.tenant.id}:marker` },
            ],
          },
        },
      });
    }

    for (const tenant of tenants) {
      const cookie = await login(base, tenant.token);
      const headers = { cookie };
      const [overview, keys, settings, marker] = await Promise.all([
        fetch(`${base}/api/overview?tenantId=tenant-1`, { headers }).then((r) =>
          r.json(),
        ),
        fetch(`${base}/api/keys`, { headers }).then((r) => r.json()),
        fetch(`${base}/api/settings`, { headers }).then((r) => r.json()),
        mcp(base, tenant.token, "tools/call", {
          name: "get_tenant_marker",
          arguments: {},
        }).then((r) => r.json()),
      ]);
      expect(overview).toMatchObject({
        tenant: { id: tenant.tenant.id, name: tenant.tenant.name },
        usage: { tenantId: tenant.tenant.id },
      });
      expect(keys).toMatchObject({
        tenant: { id: tenant.tenant.id },
        keys: [],
      });
      expect(settings).toMatchObject({ tenant: { id: tenant.tenant.id } });
      expect(marker).toMatchObject({
        result: {
          structuredContent: {
            tenant: { id: tenant.tenant.id },
            marker: `marker-for-${tenant.tenant.id}`,
          },
        },
      });
      const serialized = JSON.stringify({ overview, keys, settings, marker });
      for (const other of tenants.filter((candidate) => candidate !== tenant)) {
        expect(serialized).not.toContain(other.tenant.id);
      }
    }

    await expect(
      mcp(base, `${tenants[0].token}-mutated`, "initialize", {}),
    ).resolves.toHaveProperty("status", 401);

    const tenantTwoCookie = await login(base, tenants[1].token);
    const rotated = await fetch(`${base}/api/token/regenerate`, {
      method: "POST",
      headers: { cookie: tenantTwoCookie },
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as { token: string };
    expect(rotatedBody.token).toBeTruthy();
    await expect(
      mcp(base, tenants[1].token, "initialize", {}),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      mcp(base, rotatedBody.token, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "demo-e2e", version: "1.0.0" },
      }),
    ).resolves.toHaveProperty("status", 200);

    const selfHostDataDir = await mkdtemp(
      join(tmpdir(), "mcp-chassis-demo-self-host-"),
    );
    tempDirs.push(selfHostDataDir);
    const selfHostBase = await listen({
      DATA_DIR: selfHostDataDir,
      DEMO_API_TOKEN: "self-host-token",
      DEMO_TENANT_ID: "self-host",
      DEMO_TENANT_NAME: "Self-hosted Demo",
      CHASSIS_VAULT_MASTER_KEY: TEST_VAULT_KEY,
    });
    const selfHostLogin = await login(selfHostBase, "self-host-token");
    await expect(
      fetch(`${selfHostBase}/api/overview`, {
        headers: { cookie: selfHostLogin },
      }).then((response) => response.json()),
    ).resolves.toMatchObject({
      tenant: { id: "self-host", name: "Self-hosted Demo" },
    });
    await expect(
      mcp(selfHostBase, "self-host-token", "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "demo-e2e", version: "1.0.0" },
      }),
    ).resolves.toHaveProperty("status", 200);
  });
});
