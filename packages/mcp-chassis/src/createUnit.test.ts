import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createUnit } from "./index.js";

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

    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "c1-smoke", version: "0.0.0" },
        },
      }),
    });

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
});
