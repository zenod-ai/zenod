import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryTenantStore, createUnit } from "./index.js";

const servers: ServerType[] = [];
const tempDirs: string[] = [];

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

async function listen(
  app: ReturnType<typeof createUnit>["app"],
): Promise<string> {
  const info = await new Promise<{ port: number }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (address) => resolve({ port: address.port }),
    );
    servers.push(server);
  });
  return `http://127.0.0.1:${info.port}`;
}

function captureLogs(): {
  destination: { write(message: string): void };
  raw(): string;
  records(): Array<Record<string, unknown>>;
} {
  const messages: string[] = [];
  return {
    destination: { write: (message) => messages.push(message) },
    raw: () => messages.join(""),
    records: () =>
      messages
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "logging-test", version: "0.0.0" },
    },
  });
}

function callToolBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "log_probe", arguments: {} },
  });
}

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("chassis logging", () => {
  it("correlates authenticated MCP/tool logs and redacts credentials", async () => {
    const logs = captureLogs();
    const token = "tenant-one-path-token";
    const bearerSecret = "nested-bearer-secret";
    const apiSecret = "nested-api-key-secret";
    const childSecret = "child-logger-secret";
    const dataDir = await mkdtemp(join(tmpdir(), "chassis-logging-mcp-"));
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token, tenant: { id: "tenant-one" } },
    ]);
    const unit = createUnit({
      name: "logging-demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      logging: { destination: logs.destination },
      tools(server, context) {
        server.registerTool(
          "log_probe",
          { description: "Emit a redaction probe" },
          async () => {
            context.logger.info(
              {
                headers: { authorization: `Bearer ${bearerSecret}` },
                provider: { openaiApiKey: apiSecret },
              },
              `tool invoked with Bearer ${bearerSecret}`,
            );
            context.logger
              .child({ clientSecret: childSecret })
              .info("child logger invoked");
            return { content: [{ type: "text", text: "ok" }] };
          },
        );
      },
    });
    const base = await listen(unit.app);

    const initialized = await fetch(`${base}/mcp/${token}`, {
      method: "POST",
      headers: mcpHeaders,
      body: initializeBody(),
    });
    const called = await fetch(`${base}/mcp/${token}`, {
      method: "POST",
      headers: mcpHeaders,
      body: callToolBody(),
    });

    expect(initialized.status).toBe(200);
    expect(called.status).toBe(200);
    const records = logs.records();
    const toolLog = records.find((record) =>
      String(record.msg).startsWith("tool invoked"),
    );
    const toolRequestLog = records.find(
      (record) =>
        record.event === "http.request.completed" &&
        record.request_id === toolLog?.request_id,
    );
    expect(toolLog).toMatchObject({ tenant_id: "tenant-one" });
    expect(toolRequestLog).toMatchObject({
      tenant_id: "tenant-one",
      http: { method: "POST", path: "/mcp/:token", status_code: 200 },
    });
    expect(called.headers.get("x-request-id")).toBe(toolLog?.request_id);
    expect(JSON.stringify(toolLog)).toContain("[Redacted]");
    expect(logs.raw()).not.toContain(token);
    expect(logs.raw()).not.toContain(bearerSecret);
    expect(logs.raw()).not.toContain(apiSecret);
    expect(logs.raw()).not.toContain(childSecret);
  });

  it("labels bearer/session UI and custom routes while public work is explicit", async () => {
    const logs = captureLogs();
    const token = "tenant-ui-login-token";
    const sessionSecret = "session-signing-secret";
    const cookieSecret = "cookie-value-that-must-not-leak";
    const oauthState = "oauth-state-that-must-not-leak";
    const dataDir = await mkdtemp(join(tmpdir(), "chassis-logging-ui-"));
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token, tenant: { id: "tenant-ui", name: "Tenant UI" } },
    ]);
    const unit = createUnit({
      name: "logging-demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      logging: { destination: logs.destination },
      ui: { sessionSecret },
      routes(routes) {
        routes.get("/api/log-probe", (c) => {
          const context = c.get("unitContext");
          context.logger.info(
            {
              headers: { cookie: cookieSecret },
              oauth: { state: oauthState },
            },
            "custom route invoked",
          );
          return c.json({ tenant: context.tenant });
        });
      },
    });
    const base = await listen(unit.app);

    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/api/log-probe`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/log-probe?state=${oauthState}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    expect(login.status).toBe(200);
    expect(cookie).toBeTruthy();
    expect(login.headers.get("x-request-id")).toBeTruthy();
    expect(
      (await fetch(`${base}/api/overview`, { headers: { cookie: cookie! } }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/api/log-probe`, { headers: { cookie: cookie! } }))
        .status,
    ).toBe(200);

    const records = logs.records();
    const lifecycle = records.filter(
      (record) => record.event === "http.request.completed",
    );
    expect(lifecycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: null,
          http: expect.objectContaining({ path: "/healthz", status_code: 200 }),
        }),
        expect.objectContaining({
          tenant_id: null,
          http: expect.objectContaining({
            path: "/api/log-probe",
            status_code: 401,
          }),
        }),
        expect.objectContaining({
          tenant_id: "tenant-ui",
          http: expect.objectContaining({
            path: "/api/overview",
            status_code: 200,
          }),
        }),
      ]),
    );
    const routeLogs = records.filter(
      (record) => record.msg === "custom route invoked",
    );
    expect(routeLogs).toHaveLength(2);
    expect(routeLogs.every((record) => record.tenant_id === "tenant-ui")).toBe(
      true,
    );
    expect(
      routeLogs.every((record) => typeof record.request_id === "string"),
    ).toBe(true);
    expect(logs.raw()).not.toContain(token);
    expect(logs.raw()).not.toContain(sessionSecret);
    expect(logs.raw()).not.toContain(cookieSecret);
    expect(logs.raw()).not.toContain(oauthState);
  });
});
