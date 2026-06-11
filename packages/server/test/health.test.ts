import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

describe("server API", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-server-"));
    runtime = new Runtime(dir);
    app = createApp(runtime);
  });

  afterEach(async () => {
    runtime.state.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/health is public and reports the version", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("requires auth for /api/settings and /mcp", async () => {
    expect((await app.request("/api/settings")).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST" })).status).toBe(401);
  });

  it("first-boot setup: create password, get session, read settings", async () => {
    const status = await (await app.request("/api/auth/status")).json();
    expect(status.needsSetup).toBe(true);

    const setup = await app.request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.get("set-cookie")!;
    expect(cookie).toContain("zenod_session=");

    // second setup attempt is rejected
    const again = await app.request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password: "whatever123" }),
    });
    expect(again.status).toBe(403);

    // session cookie grants API access
    const settings = await app.request("/api/settings", { headers: { cookie } });
    expect(settings.status).toBe(200);
    const body = await settings.json();
    expect(body.configured).toBe(false);
  });

  it("login with wrong password fails; right password succeeds", async () => {
    runtime.settings.setAdminPassword("correct-horse-battery");
    const bad = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "nope" }),
    });
    expect(bad.status).toBe(401);

    const good = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "correct-horse-battery" }),
    });
    expect(good.status).toBe(200);
  });

  it("bearer token grants API access; settings round-trip masks secrets", async () => {
    const token = runtime.settings.apiToken();
    const headers = { Authorization: `Bearer ${token}` };

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        vault_repo: "owner/vault",
        github_token: "ghp_secret1234",
        anthropic_api_key: "sk-ant-secret5678",
      }),
    });
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body.configured).toBe(true);
    expect(body.settings.vault_repo).toBe("owner/vault");
    expect(body.settings.github_token).toBe("••••1234");
    expect(body.settings.anthropic_api_key).toBe("••••5678");

    // writing the masked echo back must not clobber the secret
    await app.request("/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({ github_token: "••••1234" }),
    });
    expect(runtime.settings.get("github_token")).toBe("ghp_secret1234");
  });

  it("engine routes report not-configured as 409", async () => {
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    const res = await app.request("/api/ask", {
      method: "POST",
      headers,
      body: JSON.stringify({ question: "anything" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_configured");
  });

  it("tracks MCP clients and lists them via /api/connections", async () => {
    runtime.state.recordMcpClient("Claude Code", "1.0.0");
    runtime.state.recordMcpClient("Codex", null);
    runtime.state.recordMcpClient("Claude Code", "1.0.1"); // reconnect bumps count + version

    const res = await app.request("/api/connections", {
      headers: { Authorization: `Bearer ${runtime.settings.apiToken()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mcpPath).toBe("/mcp");
    expect(body.token).toBe(runtime.settings.apiToken());
    const claude = body.clients.find((x: { name: string }) => x.name === "Claude Code");
    expect(claude.version).toBe("1.0.1");
    expect(claude.connections).toBe(2);
    expect(body.clients.map((x: { name: string }) => x.name)).toContain("Codex");
  });

  it("token regeneration invalidates the old token", async () => {
    const old = runtime.settings.apiToken();
    const res = await app.request("/api/token/regenerate", {
      method: "POST",
      headers: { Authorization: `Bearer ${old}` },
    });
    const { token: fresh } = await res.json();
    expect(fresh).not.toBe(old);
    expect((await app.request("/api/settings", { headers: { Authorization: `Bearer ${old}` } })).status).toBe(401);
    expect((await app.request("/api/settings", { headers: { Authorization: `Bearer ${fresh}` } })).status).toBe(200);
  });
});
