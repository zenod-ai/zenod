import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";
import { CONSOLE_AGENT, type AgentDefinition } from "../src/agent.js";
import { journeyStepIdempotencyKey } from "../src/journeyContracts.js";
import { createHostedEntryTicket } from "../src/auth.js";

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
    delete process.env.ZENOD_HOSTED_MODE;
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/health is public and reports the version", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.sha).toBe("unknown");
  });

  it("GET /api/health reports the build's GIT_SHA when set", async () => {
    process.env.GIT_SHA = "abc1234";
    try {
      const body = await (await app.request("/api/health")).json();
      expect(body.sha).toBe("abc1234");
    } finally {
      delete process.env.GIT_SHA;
    }
  });

  it("requires auth for /api/settings and /mcp", async () => {
    expect((await app.request("/api/settings")).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST" })).status).toBe(401);
  });

  it("first-boot setup: create password, get session, read settings", async () => {
    const status = await (await app.request("/api/auth/status")).json();
    expect(status.needsSetup).toBe(true);
    expect((await app.request("/api/auth/hosted-entry?ticket=invalid")).status).toBe(404);

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

  it("hosted Ring uses a signed one-time entry without enabling self-host setup", async () => {
    process.env.ZENOD_HOSTED_MODE = "ring";
    const status = await (await app.request("/api/auth/status")).json();
    expect(status).toMatchObject({ needsSetup: false, hostedMode: "ring" });

    const setup = await app.request("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password: "not-allowed-here" }),
    });
    expect(setup.status).toBe(404);
    expect((await app.request("/api/settings")).status).toBe(401);
    expect((await app.request("/api/auth/hosted-entry?ticket=invalid")).status).toBe(401);

    const ticket = createHostedEntryTicket(runtime.settings.apiToken(), "ring-router-products");
    const entry = await app.request(`/api/auth/hosted-entry?ticket=${encodeURIComponent(ticket)}`);
    expect(entry.status).toBe(303);
    expect(entry.headers.get("location")).toBe("/#ring-router-products");
    const cookie = entry.headers.get("set-cookie")!;
    expect(cookie).toContain("zenod_session=");
    expect((await app.request("/api/settings", { headers: { cookie } })).status).toBe(200);
    expect((await app.request(`/api/auth/hosted-entry?ticket=${encodeURIComponent(ticket)}`)).status).toBe(401);

    const phylaxTicket = createHostedEntryTicket(runtime.settings.apiToken(), "phylax-channels");
    const phylaxEntry = await app.request(
      `/api/auth/hosted-entry?ticket=${encodeURIComponent(phylaxTicket)}`,
    );
    expect(phylaxEntry.status).toBe(303);
    expect(phylaxEntry.headers.get("location")).toBe("/#phylax-channels");
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

  it("serves proactive notification audit records to authenticated callers", async () => {
    const token = runtime.settings.apiToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    runtime.whatsappStore.recordOutboundAudit({
      messageId: "reply-ordinary",
      chatId: "34618217703@s.whatsapp.net",
      contactId: "34618217703@s.whatsapp.net",
      bodyText: "ordinary chat reply",
      status: "sent",
      sentMessageId: "sent_reply",
    });
    runtime.whatsappStore.recordOutboundAudit({
      messageId: "notify-34618217703-1782149999",
      chatId: "34618217703@s.whatsapp.net",
      contactId: "34618217703@s.whatsapp.net",
      bodyText: "✅ Execution 142 (AlfaBlok/obsidian-brain#141) — done.",
      status: "notify",
      sentMessageId: "sent_142",
    });

    const res = await app.request("/api/notifications/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "142", windowMinutes: 60, limit: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.records).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        messageId: "notify-34618217703-1782149999",
        sentMessageId: "sent_142",
        status: "notify",
        bodyText: "✅ Execution 142 (AlfaBlok/obsidian-brain#141) — done.",
      }),
    ]);
  });

  it("exposes a durable journey ledger for multi-agent handoffs", async () => {
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    const created = await app.request("/api/journeys", {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId: "whatsapp:+123",
        surface: "whatsapp",
        originalRequest: "create a ticket and run it",
        steps: [
          { owner: "archus", title: "Create issue", input: { repo: "AlfaBlok/zenod" } },
          { owner: "epaminon", title: "Run issue", input: { fromPreviousStep: true }, deadlineAt: 1 },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const snapshot = await created.json();
    expect(snapshot.steps.map((step: { owner: string }) => step.owner)).toEqual(["archus", "epaminon"]);

    const firstStepId = snapshot.steps[0].id as string;
    const secondStepId = snapshot.steps[1].id as string;
    const dispatched = await app.request(`/api/journey-steps/${firstStepId}/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ deadlineAt: Date.now() + 60_000 }),
    });
    expect(dispatched.status).toBe(200);

    const completed = await app.request(`/api/journey-steps/${firstStepId}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ result: { target: "AlfaBlok/zenod#123" } }),
    });
    expect(completed.status).toBe(200);

    await app.request(`/api/journey-steps/${secondStepId}/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ deadlineAt: 1 }),
    });
    const monitor = await app.request("/api/journeys/monitor/run", { method: "POST", headers });
    expect(monitor.status).toBe(200);
    expect((await monitor.json()).blocked).toEqual([expect.objectContaining({ id: secondStepId, status: "blocked" })]);

    const readback = await app.request(`/api/journeys/${snapshot.journey.id}`, { headers });
    expect(readback.status).toBe(200);
    const finalSnapshot = await readback.json();
    expect(finalSnapshot.journey.status).toBe("blocked");
    expect(finalSnapshot.events.map((event: { type: string }) => event.type)).toContain("journey_blocked");
  });

  it("accepts authenticated journey callbacks and advances dependent steps", async () => {
    const headers = { Authorization: `Bearer ${runtime.settings.apiToken()}` };
    const created = await app.request("/api/journeys", {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId: "whatsapp:+123",
        surface: "whatsapp",
        originalRequest: "create a ticket and run it",
        steps: [{ owner: "archus", title: "Create issue", input: { expectedArtifactKinds: ["github_issue"] } }],
      }),
    });
    const initial = await created.json();
    const journeyId = initial.journey.id as string;
    const archusStepId = initial.steps[0].id as string;
    const epaminonStep = runtime.journeyStore.addStep(journeyId, {
      owner: "epaminon",
      title: "Run issue",
      dependencyIds: [archusStepId],
      wakeAt: 1,
    });

    expect(runtime.journeyStore.claimDueSteps(10).map((step) => step.id)).toEqual([archusStepId]);

    const callbackBody = {
      journeyId,
      stepId: archusStepId,
      status: "completed",
      idempotencyKey: journeyStepIdempotencyKey(journeyId, archusStepId),
      result: { target: "zenod-ai/zenod#500" },
      createdArtifacts: [
        {
          kind: "github_issue",
          artifactKey: "github:zenod-ai/zenod#500",
          data: { target: "zenod-ai/zenod#500", url: "https://github.com/zenod-ai/zenod/issues/500" },
        },
      ],
    };
    const callback = await app.request(`/internal/journeys/${journeyId}/steps/${archusStepId}/callback`, {
      method: "POST",
      headers,
      body: JSON.stringify(callbackBody),
    });
    expect(callback.status).toBe(200);
    const callbackJson = await callback.json();
    expect(callbackJson.readySteps).toEqual([expect.objectContaining({ id: epaminonStep.id, owner: "epaminon" })]);

    expect(runtime.journeyStore.claimDueSteps(20).map((step) => step.id)).toEqual([epaminonStep.id]);
    expect(runtime.journeyStore.artifactsForJourney(journeyId)).toEqual([
      expect.objectContaining({ artifactKey: "github:zenod-ai/zenod#500", kind: "github_issue" }),
    ]);

    const duplicate = await app.request(`/internal/journeys/${journeyId}/steps/${archusStepId}/callback`, {
      method: "POST",
      headers,
      body: JSON.stringify(callbackBody),
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    expect(runtime.journeyStore.artifactsForJourney(journeyId)).toHaveLength(1);
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
    const previewText = (await preview.json()).text as string;
    expect(previewText).toContain("/clean-slate confirm");

    const streamedPreview = await app.request("/api/chat/stream", {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "/clean-slate" }),
    });
    const previewEvents = (await streamedPreview.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(previewEvents).toEqual([
      { type: "delta", text: previewText },
      { type: "done", text: previewText, sources: [] },
    ]);

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
            options.onDelta?.("Draft ");
            options.onToolEvent?.({ phase: "end", tool: "search_vault", label: "Searching the vault" });
            options.onDelta?.("answer.");
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
      { type: "delta", text: "Draft " },
      { type: "tool", phase: "end", tool: "search_vault", label: "Searching the vault" },
      { type: "delta", text: "answer." },
      {
        type: "done",
        text: "Found notes.",
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

  it("Console boot sync exposes unambiguous Archus and Epaminon tool names", async () => {
    const consoleDir = await mkdtemp(join(tmpdir(), "zenod-console-tools-"));
    const consoleRuntime = new Runtime(consoleDir, CONSOLE_AGENT);
    try {
      consoleRuntime.settings.setPeers([
        { name: "archus", url: "http://archus.test/mcp", token: "archus-token" },
        { name: "epaminon", url: "http://epaminon.test/mcp", token: "epaminon-token" },
      ]);
      createApp(consoleRuntime);

      const archus = consoleRuntime.settings.peers().find((peer) => peer.name === "archus");
      const epaminon = consoleRuntime.settings.peers().find((peer) => peer.name === "epaminon");
      expect(archus?.tools?.map((tool) => tool.as)).toEqual(
        expect.arrayContaining([
          "archus_read_exact_github_issue",
          "archus_search_github_issues",
          "archus_list_github_issues",
          "archus_request_backlog_action",
          "archus_run_issue",
        ]),
      );
      expect(archus?.tools?.map((tool) => tool.as)).not.toEqual(
        expect.arrayContaining(["archus_get_issue", "archus_find_issue", "archus_list_issues"]),
      );
      expect(epaminon?.tools?.map((tool) => tool.as)).toEqual([
        "epaminon_run_task",
        "epaminon_dispatch_worker",
        "epaminon_run_existing_issue",
        "epaminon_read_issue_execution_status",
      ]);
      expect(epaminon?.tools?.find((tool) => tool.as === "epaminon_run_task")?.description).toContain("Prompt-first cloud worker harness");
      expect(epaminon?.tools?.find((tool) => tool.as === "epaminon_dispatch_worker")?.description).toContain("cloud Codex/Claude-style worker dispatcher");
      expect(epaminon?.tools?.find((tool) => tool.as === "epaminon_run_existing_issue")?.description).toContain("Start execution");
      expect(epaminon?.tools?.map((tool) => tool.as)).not.toContain("epaminon_run_ephemeral_task");
      expect(epaminon?.tools?.find((tool) => tool.as === "epaminon_read_issue_execution_status")?.description).toContain("did it run");
      expect(archus?.tools?.find((tool) => tool.as === "archus_run_issue")?.description).toContain("Legacy fallback");
      expect(archus?.tools?.find((tool) => tool.as === "archus_request_backlog_action")?.description).toContain("Do NOT use for running");
      expect(archus?.tools?.find((tool) => tool.as === "archus_request_backlog_action")?.description).toContain("configured central GitHub backlog only");
      expect(archus?.tools?.find((tool) => tool.as === "open_issue")?.description).toContain("central backlog issue only");
    } finally {
      consoleRuntime.close();
      await rm(consoleDir, { recursive: true, force: true });
    }
  });

  it("Console settings save syncs GitHub credentials to enabled repo agents", async () => {
    const consoleDir = await mkdtemp(join(tmpdir(), "zenod-console-gh-sync-"));
    const consoleRuntime = new Runtime(consoleDir, CONSOLE_AGENT);
    const consoleApp = createApp(consoleRuntime);
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    try {
      consoleRuntime.settings.setAgentToken("archus", "archus-token");
      consoleRuntime.settings.setPeers([{ name: "archus", url: "http://zenod-archus2:8080/mcp", token: "archus-token" }]);
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
          auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      const res = await consoleApp.request("/api/settings", {
        method: "PUT",
        headers: { Authorization: `Bearer ${consoleRuntime.settings.apiToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ github_token: "ghp_console_sync" }),
      });

      expect(res.status).toBe(200);
      expect(calls).toEqual([
        {
          url: "http://zenod-archus2:8080/api/agent/github",
          auth: "Bearer archus-token",
          body: { github_token: "ghp_console_sync" },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      consoleRuntime.close();
      await rm(consoleDir, { recursive: true, force: true });
    }
  });
});
