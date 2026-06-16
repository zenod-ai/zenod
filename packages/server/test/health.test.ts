import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { type AgentDefinition } from "../src/agent.js";

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
    runtime.close();
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

  it("transcribes authenticated web voice-note uploads", async () => {
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    try {
      const form = new FormData();
      form.append("audio", new Blob([Buffer.from("fake-audio")], { type: "audio/webm" }), "voice.webm");
      const res = await app.request("/api/chat/voice/transcribe", {
        method: "POST",
        headers,
        body: form,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.transcript).toBe("remember to renew the travel insurance");
      expect(body.provider).toContain("whisper.cpp");
    } finally {
      delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
    }
  });

  it("chat exposes clean-slate preview and explicit confirmation", async () => {
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    runtime.cleanSlate = async () => ({
      vaultPath: "/tmp/vault",
      branch: "main",
      initialCommitSha: "1".repeat(40),
      setupCommitSha: "2".repeat(40),
      initialPaths: ["README.md"],
      setupPaths: [".brain/config.yml"],
      topLevelPaths: ["README.md", "Inbox/", "Log/"],
      githubUrls: [],
      lint: { ok: true, errors: [], checkedFiles: 3 },
      inspect: ["git -C /tmp/vault log --oneline -2"],
      revert: ["git -C /tmp/vault revert 2222222"],
    });

    const preview = await app.request("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "/clean-slate" }),
    });
    expect(preview.status).toBe(200);
    expect((await preview.json()).text).toContain("/clean-slate confirm");

    const confirmed = await app.request("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "/clean-slate confirm" }),
    });
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json();
    expect(body.text).toContain("Initial clean commit");
    expect(body.cleanSlate.setupCommitSha).toBe("2".repeat(40));
  });

  it("chat stream forwards live tool events and text deltas from engine.chat", async () => {
    const calls: Array<{ message: string; surface: string }> = [];
    runtime.getEngine = async () =>
      ({
        async chat(message, surface, options) {
          calls.push({ message, surface });
          if (typeof options === "object") {
            options.onToolEvent?.({ phase: "start", tool: "search_vault", label: "Searching the vault" });
            options.onDelta?.("Found ");
            options.onToolEvent?.({ phase: "end", tool: "search_vault", label: "Searching the vault" });
            options.onDelta?.("notes.");
          }
          return {
            text: "Found notes.",
            sources: [{ path: "Projects/Zenod.md", githubUrl: "https://example.test/Projects/Zenod.md" }],
          };
        },
        async handleTasking() {
          throw new Error("web chat stream should not use handleTasking");
        },
      }) as unknown as BrainEngine;

    const res = await app.request("/api/chat/stream", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.settings.apiToken()}` },
      body: JSON.stringify({ message: "find zenod notes" }),
    });

    expect(res.status).toBe(200);
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toEqual([
      { type: "tool", phase: "start", tool: "search_vault", label: "Searching the vault" },
      { type: "delta", text: "Found " },
      { type: "tool", phase: "end", tool: "search_vault", label: "Searching the vault" },
      { type: "delta", text: "notes." },
      {
        type: "done",
        sources: [{ path: "Projects/Zenod.md", githubUrl: "https://example.test/Projects/Zenod.md" }],
      },
    ]);
    expect(calls).toEqual([{ message: "find zenod notes", surface: "web" }]);
  });

  it("test chat runs through engine.chat with explicit context and audit readback", async () => {
    const calls: Array<{ message: string; surface: string; conversationKey?: string }> = [];
    runtime.getEngine = async () =>
      ({
        async chat(message, surface, options) {
          calls.push({
            message,
            surface,
            conversationKey: typeof options === "object" ? options.conversationKey : undefined,
          });
          if (typeof options === "object") {
            options.onToolEvent?.({ phase: "start", tool: "searchVault", label: "Searching memory" });
            options.onToolEvent?.({ phase: "end", tool: "searchVault", label: "Searching memory" });
          }
          return {
            text: `Memory-only answer: ${message}`,
            sources: [{ path: "Areas/Insurance.md", githubUrl: "https://example.test/Areas/Insurance.md" }],
          };
        },
      }) as BrainEngine;

    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    const res = await app.request("/api/test/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "negative control: answer from memory only",
        surface: "web",
        conversationKey: "issue-37-http",
        testRunId: "issue-37",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Memory-only answer: negative control: answer from memory only");
    expect(body.correlationId).toMatch(/^test_/);
    expect(body.conversationId).toBe("web:issue-37-http");
    expect(body.toolEvents).toHaveLength(2);
    expect(calls).toEqual([
      { message: "negative control: answer from memory only", surface: "web", conversationKey: "issue-37-http" },
    ]);

    const audit = await app.request(`/api/test/chat/${body.correlationId}`, { headers });
    expect(audit.status).toBe(200);
    const auditBody = await audit.json();
    expect(auditBody.run.prompt).toBe("negative control: answer from memory only");
    expect(auditBody.run.reply).toBe("Memory-only answer: negative control: answer from memory only");
    expect(auditBody.run.status).toBe("ok");

    const recent = await app.request("/api/test/chat?limit=1", { headers });
    expect((await recent.json()).runs[0].correlationId).toBe(body.correlationId);
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

  it("the shell is agent-agnostic: a supplied AgentDefinition drives identity", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "zenod-archus-"));
    const archus: AgentDefinition = {
      name: "archus",
      displayName: "Archus",
      tagline: "Backlog agent",
      persona: "You are Archus, the backlog agent.",
    };
    const otherRuntime = new Runtime(otherDir, archus);
    const otherApp = createApp(otherRuntime);
    try {
      const health = await (await otherApp.request("/api/health")).json();
      expect(health.name).toBe("archus");

      const agent = await (
        await otherApp.request("/api/agent", {
          headers: { Authorization: `Bearer ${otherRuntime.settings.apiToken()}` },
        })
      ).json();
      expect(agent).toMatchObject({ name: "archus", displayName: "Archus", tagline: "Backlog agent" });
    } finally {
      otherRuntime.close();
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
