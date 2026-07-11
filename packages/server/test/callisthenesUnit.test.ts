import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallisthenesUnit } from "../src/callisthenesUnit.js";
import { resolveServerMode } from "../src/serverMode.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "callisthenes-unit-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Callisthenes front unit", () => {
  it("selects Callisthenes before the default Zenod agent mode", () => {
    expect(resolveServerMode({ ZENOD_UNIT: "callisthenes" }, "zenod")).toBe("callisthenes");
    expect(resolveServerMode({}, "zenod")).toBe("zenod");
    expect(resolveServerMode({ AGENT: "ring" }, "ring")).toBe("legacy");
  });

  it("mounts landing, dashboard, health, and bearer-preserving MCP forwarding", async () => {
    const dataDir = await tempDir();
    const siteDist = join(dataDir, "site");
    const webDist = join(dataDir, "web");
    await mkdir(siteDist);
    await mkdir(webDist);
    await writeFile(join(siteDist, "index.html"), "<html>calli landing</html>");
    await writeFile(join(webDist, "index.html"), "<html>calli dashboard</html>");
    const tenantStore = createMemoryTenantStore([{ token: "tenant-secret", tenant: { id: "tenant-a" } }]);
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return Response.json({
        target: String(request),
        authorization: headers.get("authorization"),
        body: init?.body ? await new Response(init.body).text() : "",
      });
    });
    const unit = createCallisthenesUnit({
      dataDir,
      siteDist,
      webDist,
      tenantStore,
      fetcher: fetcher as typeof fetch,
      env: { ACCOUNT_STATE_SECRET: "session-secret", CUSTOMER_APP_URL: "https://calli.zenod.dev" },
    });
    try {
      expect(await (await unit.app.request("/healthz")).json()).toMatchObject({ status: "ok", name: "callisthenes" });
      expect(await (await unit.app.request("/", { headers: { host: "calli.zenod.dev" } })).text()).toContain("calli landing");
      expect(await (await unit.app.request("/app", { headers: { host: "calli.zenod.dev" } })).text()).toContain("calli dashboard");
      expect((await unit.app.request("/mcp", { method: "POST", body: "{}" })).status).toBe(401);

      const forwarded = await unit.app.request("/mcp", {
        method: "POST",
        headers: { authorization: "Bearer tenant-secret", "content-type": "application/json" },
        body: '{"jsonrpc":"2.0"}',
      });
      expect(await forwarded.json()).toMatchObject({
        target: "http://calli-engine:8000/mcp",
        authorization: "Bearer tenant-secret",
        body: '{"jsonrpc":"2.0"}',
      });

      const pathCredential = await unit.app.request("/mcp/tenant-secret", { method: "POST", body: "{}" });
      expect(await pathCredential.json()).toMatchObject({ authorization: "Bearer tenant-secret" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unit.close();
    }
  });
});
