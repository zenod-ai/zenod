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

  it("requires an exact tenant-held action before approve_send reaches upstream", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([
      { token: "alpha-secret", tenant: { id: "tenant-alpha" } },
      { token: "beta-secret", tenant: { id: "tenant-beta" } },
    ]);
    let approvedCalls = 0;
    let approvedContentLength: string | null = "not-called";
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body ?? "{}")) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      if (rpc.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [
          { name: "createPosts", inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } },
          { name: "deletePosts", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
          { name: "searchPostsRecent", description: "upstream read", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
          { name: "unknownFutureTool", description: "preserve upstream metadata", annotations: { readOnlyHint: false } },
        ] } });
      }
      if (rpc.params?.name === "createPosts" && rpc.params.arguments?.callisthenes_approve) {
        approvedContentLength = new Headers(init?.headers).get("content-length");
        approvedCalls += 1;
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text: JSON.stringify({ data: { id: approvedCalls === 1 ? "1900123456789" : "1900123456790" } }) }] },
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
      const byName = Object.fromEntries(listed.result.tools.map((tool: { name: string }) => [tool.name, tool]));
      expect(byName.createPosts).toMatchObject({
        inputSchema: { required: ["text"], properties: { text: { type: "string" } } },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      });
      expect(byName.createPosts.inputSchema.properties.callisthenes_approve).toBeUndefined();
      expect(byName.deletePosts).toMatchObject({
        inputSchema: { required: ["id"], properties: { id: { type: "string" }, callisthenes_approve: { description: expect.stringContaining("Explicit approval") } } },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      });
      expect(byName.searchPostsRecent).toMatchObject({
        description: "upstream read",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      });
      expect(byName.approve_send).toMatchObject({
        inputSchema: { required: ["channel", "text"], properties: { channel: { enum: ["x"] }, action_id: { minLength: 1 }, text: { minLength: 1 } } },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      });
      expect(byName.approve_send.description).toContain("explicitly confirms the exact final text");
      expect(byName.reconcile_send).toMatchObject({
        inputSchema: { required: ["channel", "action_id", "text", "post_id"], properties: { channel: { enum: ["x"] }, post_id: { pattern: "^[0-9]+$" } } },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      });
      expect(byName.unknownFutureTool).toMatchObject({
        description: "preserve upstream metadata",
        annotations: { readOnlyHint: false },
      });

      const bypass = await (await call("alpha-secret", {
        jsonrpc: "2.0", id: 11, method: "tools/call",
        params: { name: "createPosts", arguments: { text: "Direct bypass attempt.", callisthenes_approve: true } },
      })).json() as any;
      expect(bypass.result.content[0].text).toContain("[draft_not_approved]");
      expect(bypass.result.content[0].text).toContain("[held_action]");
      expect(approvedCalls).toBe(0);

      const missing = await (await call("alpha-secret", {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "approve_send", arguments: { channel: "x", text: "Never held." } },
      })).json() as any;
      expect(missing.result.content[0].text).toBe("Nothing pending to approve.");
      expect(approvedCalls).toBe(0);

      const draftResponse = await (await call("alpha-secret", {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "createPosts", arguments: { text: "Ship the observable seam." } },
      })).json() as any;
      const heldText = String(draftResponse.result.content[0].text);
      expect(heldText).toMatch(/\[held_action\] action_id=act_[a-f0-9]{32} expires_at=/);
      const actionId = heldText.match(/action_id=(act_[a-f0-9]{32})/)?.[1];
      expect(actionId).toBeTruthy();
      expect(unit.observationLedger.read("tenant-alpha").drafts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: actionId, text: "Ship the observable seam.", status: "pending", expires_at: expect.any(String) }),
      ]));
      expect(unit.observationLedger.read("tenant-beta").drafts).toEqual([]);

      for (const [id, token, arguments_] of [
        [3, "alpha-secret", { channel: "x", action_id: actionId, text: "Ship the altered seam." }],
        [4, "beta-secret", { channel: "x", action_id: actionId, text: "Ship the observable seam." }],
        [5, "alpha-secret", { channel: "x", action_id: "act_unknown", text: "Ship the observable seam." }],
        [51, "alpha-secret", { channel: "x", action_id: actionId, text: "Ship the observable seam. " }],
      ] as const) {
        const rejected = await (await call(token, {
          jsonrpc: "2.0", id, method: "tools/call", params: { name: "approve_send", arguments: arguments_ },
        })).json() as any;
        expect(rejected.result.content[0].text).toBe("Nothing pending to approve.");
      }
      expect(approvedCalls).toBe(0);

      const approval = {
        jsonrpc: "2.0", id: 6, method: "tools/call",
        params: { name: "approve_send", arguments: { channel: "x", action_id: actionId, text: "Ship the observable seam." } },
      };
      const first = await (await call("alpha-secret", approval)).json() as any;
      const retry = await (await call("alpha-secret", { ...approval, id: 7 })).json() as any;
      expect(first.result.content[0].text).toBe("Posted to X. Live URL: https://x.com/i/web/status/1900123456789");
      expect(retry.result.content[0].text).toBe(first.result.content[0].text);
      expect(approvedCalls).toBe(1);
      expect(approvedContentLength).toBeNull();
      expect(unit.observationLedger.read("tenant-alpha").receipts).toMatchObject([
        { url: "https://x.com/i/web/status/1900123456789" },
      ]);
      expect(unit.observationLedger.read("tenant-alpha").usage).toMatchObject({ calls: 8, sends: 1, rejected_drafts: 2 });
      expect(unit.observationLedger.read("tenant-beta").receipts).toEqual([]);

      const secondDraft = await (await call("alpha-secret", {
        jsonrpc: "2.0", id: 8, method: "tools/call",
        params: { name: "createPosts", arguments: { text: "Ship the observable seam." } },
      })).json() as any;
      const secondActionId = String(secondDraft.result.content[0].text).match(/action_id=(act_[a-f0-9]{32})/)?.[1];
      expect(secondActionId).not.toBe(actionId);
      const compatible = await (await call("alpha-secret", {
        jsonrpc: "2.0", id: 9, method: "tools/call",
        params: { name: "approve_send", arguments: { channel: "x", text: "Ship the observable seam." } },
      })).json() as any;
      expect(compatible.result.content[0].text).toBe("Posted to X. Live URL: https://x.com/i/web/status/1900123456790");
      expect(approvedCalls).toBe(2);
    } finally {
      unit.close();
    }
  });

  it("fails closed for an expired held action without calling upstream", async () => {
    const dataDir = await tempDir();
    const tenantStore = createMemoryTenantStore([{ token: "tenant-secret", tenant: { id: "tenant-a" } }]);
    let approvedCalls = 0;
    const fetcher = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body ?? "{}")) as { id: number; params?: { arguments?: Record<string, unknown> } };
      if (rpc.params?.arguments?.callisthenes_approve) approvedCalls += 1;
      return Response.json({
        jsonrpc: "2.0", id: rpc.id,
        result: { content: [{ type: "text", text: "[draft_not_approved] drafts never send" }], isError: true },
      });
    });
    const unit = createCallisthenesUnit({
      dataDir,
      tenantStore,
      fetcher: fetcher as typeof fetch,
      env: { CALLISTHENES_PENDING_ACTION_TTL_MS: "1" },
    });
    const call = (body: unknown) => unit.app.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer tenant-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      const draft = await (await call({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "createPosts", arguments: { text: "Short lived." } },
      })).json() as any;
      const actionId = String(draft.result.content[0].text).match(/action_id=(act_[a-f0-9]{32})/)?.[1];
      await new Promise((resolve) => setTimeout(resolve, 5));
      const expired = await (await call({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "approve_send", arguments: { channel: "x", action_id: actionId, text: "Short lived." } },
      })).json() as any;
      expect(expired.result.content[0].text).toBe("Nothing pending to approve.");
      expect(approvedCalls).toBe(0);
      expect(unit.observationLedger.read("tenant-a").drafts[0]).toMatchObject({ id: actionId, status: "expired" });
    } finally {
      unit.close();
    }
  });
});
