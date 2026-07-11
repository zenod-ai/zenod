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

  it("observes rejected drafts and exposes approve_send with exactly-once canonical receipts per tenant", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([
      { token: "alpha-secret", tenant: { id: "tenant-alpha" } },
      { token: "beta-secret", tenant: { id: "tenant-beta" } },
    ]);
    let approvedCalls = 0;
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "createPosts" }] } });
      }
      if (rpc.params?.name === "createPosts" && rpc.params.arguments?.callisthenes_approve) {
        approvedCalls += 1;
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text: '{"data":{"id":"1900123456789"}}' }] },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { content: [{ type: "text", text: "[draft_not_approved] drafts never send" }], isError: true },
      });
    });
    const unit = createCallisthenesUnit({ dataDir, tenantStore, fetcher: fetcher as typeof fetch });
    const call = (token: string, body: unknown) => unit.app.request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      const listed = await (await call("alpha-secret", { jsonrpc: "2.0", id: 1, method: "tools/list" })).json() as any;
      expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("approve_send");

      await call("alpha-secret", {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "createPosts", arguments: { text: "Ship the observable seam." } },
      });
      expect(unit.observationLedger.read("tenant-alpha").drafts).toMatchObject([
        { text: "Ship the observable seam.", status: "pending" },
      ]);
      expect(unit.observationLedger.read("tenant-beta").drafts).toEqual([]);

      const approval = {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "approve_send", arguments: { channel: "x", text: "Ship the observable seam." } },
      };
      const first = await (await call("alpha-secret", approval)).json() as any;
      const retry = await (await call("alpha-secret", { ...approval, id: 4 })).json() as any;
      expect(first.result.content[0].text).toBe("Posted to X. Live URL: https://x.com/i/web/status/1900123456789");
      expect(retry.result.content[0].text).toBe(first.result.content[0].text);
      expect(approvedCalls).toBe(1);
      expect(unit.observationLedger.read("tenant-alpha").receipts).toMatchObject([
        { url: "https://x.com/i/web/status/1900123456789" },
      ]);
      expect(unit.observationLedger.read("tenant-alpha").usage).toMatchObject({ calls: 3, sends: 1, rejected_drafts: 1 });
      expect(unit.observationLedger.read("tenant-beta").receipts).toEqual([]);
    } finally {
      unit.close();
    }
  });
});
