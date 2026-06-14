import { access } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic, type ServeStaticOptions } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { conversationId, NoteNotFoundError, VERSION, type CleanSlateResult } from "zenod";
import { clearSession, issueSession, requireAuth, requireMcpAuth } from "./auth.js";
import {
  authServerMetadata,
  handleAuthorizeDecision,
  handleAuthorizeGet,
  handleRegister,
  handleToken,
  protectedResourceMetadata,
  publicBaseUrl,
} from "./oauth.js";
import {
  appStatus,
  buildManifest,
  disconnectApp,
  exchangeManifestCode,
  installationToken,
  listInstallationRepos,
} from "./githubApp.js";
import { buildMcpServer } from "./mcp.js";
import { parseServiceAccount, testDrive } from "./drive.js";
import { buildDriveTools } from "./driveTools.js";
import { prepareModel, transcribeAudio, transcriptionStatus, WHISPER_MODELS } from "./transcribe.js";
import { NotConfiguredError, Runtime, testGithub, testProviderKey } from "./runtime.js";
import { SETTING_KEYS, type Provider, type SettingKey } from "./settings.js";
import { runSyntheticChat, type ChatTestAuditStore, type SyntheticChatRequest } from "./testHarness.js";

export interface AppOptions {
  /** Directory with the built web UI (apps/web/dist). Optional in dev/tests. */
  webDist?: string;
}

const MAX_WEB_VOICE_NOTE_BYTES = 50 * 1024 * 1024;

export function createApp(runtime: Runtime, options: AppOptions = {}): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { settings } = runtime;
  const chatTestAudit = runtime.state as unknown as ChatTestAuditStore;

  void runtime.whatsapp.startIfEnabled().catch((err: unknown) => {
    console.error("[whatsapp] startup failed:", err);
  });

  // Pre-fetch the whisper model on boot when Drive is set up, so the one-time
  // ~1.5 GB download to the /data volume happens during setup — not inside the
  // user's first chat ingest. The /data volume persists across redeploys, so
  // this is genuinely one-time.
  if (settings.driveConfigured()) void prepareModel(settings.whisperModel());

  // Resume any ingest jobs left queued before the last restart.
  runtime.ingestQueue.resume();

  app.onError((err, c) => {
    if (err instanceof NotConfiguredError) return c.json({ error: err.message, code: "not_configured" }, 409);
    if (err instanceof NoteNotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  // --- public ---

  app.get("/api/health", (c) => c.json({ status: "ok", name: "zenod", version: VERSION }));

  // --- OAuth 2.1 provider (public — discovery + flow endpoints) ---

  // RFC 9728 protected-resource metadata (bare + path-suffixed variants clients probe)
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));

  // RFC 8414 authorization-server metadata (bare + OIDC-style suffix)
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(authServerMetadata(publicBaseUrl(c))));
  app.get("/.well-known/oauth-authorization-server/mcp", (c) => c.json(authServerMetadata(publicBaseUrl(c))));

  app.post("/oauth/register", (c) => handleRegister(c, runtime.oauth));
  app.get("/oauth/authorize", (c) => handleAuthorizeGet(c, runtime.oauth, settings));
  app.post("/oauth/authorize/decision", (c) => handleAuthorizeDecision(c, runtime.oauth, settings));
  app.post("/oauth/token", (c) => handleToken(c, runtime.oauth));

  app.get("/api/auth/status", (c) =>
    c.json({
      needsSetup: !settings.hasAdminPassword(),
      configured: settings.configured(),
    }),
  );

  app.post("/api/auth/setup", async (c) => {
    if (settings.hasAdminPassword()) return c.json({ error: "already set up" }, 403);
    const { password } = await c.req.json<{ password?: string }>();
    if (!password || password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
    settings.setAdminPassword(password);
    issueSession(c, settings);
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const { password } = await c.req.json<{ password?: string }>();
    if (!password || !settings.verifyAdminPassword(password)) {
      return c.json({ error: "wrong password" }, 401);
    }
    issueSession(c, settings);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    clearSession(c);
    return c.json({ ok: true });
  });

  // --- authenticated API ---

  const auth = requireAuth(settings);
  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    if (path === "/api/health" || path.startsWith("/api/auth/")) return next();
    return auth(c, next);
  });

  app.get("/api/settings", (c) =>
    c.json({ settings: settings.masked(), configured: settings.configured() }),
  );

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<Record<string, string>>();
    for (const key of SETTING_KEYS) {
      if (!(key in body)) continue;
      const value = body[key] ?? "";
      if (settings.isSecret(key) && value.includes("••••")) continue; // masked echo — unchanged
      settings.set(key as SettingKey, value);
    }
    runtime.invalidate();
    // Connecting Drive, or changing the quality, is the moment to fetch the
    // (newly) chosen transcription model to the persistent volume.
    if (settings.driveConfigured()) void prepareModel(settings.whisperModel());
    return c.json({ settings: settings.masked(), configured: settings.configured() });
  });

  app.post("/api/settings/test-github", async (c) => {
    const body = await c.req.json<{ repo?: string; token?: string }>().catch(() => ({}) as Record<string, string>);
    const repo = body.repo || settings.get("vault_repo");
    let token = (body.token && !body.token.includes("••••") ? body.token : null) || settings.get("github_token");
    if (!token && settings.hasGithubApp()) {
      token = await installationToken(settings).catch(() => null);
    }
    if (!repo || !token) return c.json({ ok: false, message: "repo and token (or a connected GitHub App) are required" });
    return c.json(await testGithub(repo, token));
  });

  app.post("/api/settings/test-llm", async (c) => {
    const body = await c.req
      .json<{ provider?: Provider; api_key?: string }>()
      .catch(() => ({}) as Record<string, string>);
    const provider: Provider = body.provider === "openai" ? "openai" : body.provider === "anthropic" ? "anthropic" : settings.provider();
    const storedKey = provider === "openai" ? settings.get("openai_api_key") : settings.get("anthropic_api_key");
    const key = (body.api_key && !body.api_key.includes("••••") ? body.api_key : null) || storedKey;
    if (!key) return c.json({ ok: false, message: "API key is required" });
    return c.json(await testProviderKey(provider, key));
  });

  app.post("/api/settings/test-drive", async (c) => {
    const body = await c.req
      .json<{ service_account_json?: string; folder_id?: string }>()
      .catch(() => ({}) as Record<string, string>);
    const json =
      (body.service_account_json && !body.service_account_json.includes("••••") ? body.service_account_json : null) ||
      settings.get("google_service_account_json");
    const folderId = body.folder_id ?? settings.get("google_drive_folder_id") ?? undefined;
    if (!json) return c.json({ ok: false, message: "paste the service account JSON key first" });
    return c.json(await testDrive(json, folderId || undefined));
  });

  // Drive connection status for the UI: which service account, and whether
  // audio transcription has a key to run on. Never returns the secret itself.
  app.get("/api/drive/status", (c) => {
    const json = settings.get("google_service_account_json");
    let clientEmail: string | null = null;
    if (json) {
      try {
        clientEmail = parseServiceAccount(json).client_email;
      } catch {
        clientEmail = null;
      }
    }
    return c.json({
      configured: settings.driveConfigured(),
      clientEmail,
      folderId: settings.get("google_drive_folder_id"),
      transcriptionProvider: [
        settings.get("groq_api_key") ? "groq for notes up to 5 min" : null,
        settings.useOpenAiForLongTranscription() ? "openai for notes over 5 min" : "local whisper.cpp for long notes",
      ]
        .filter(Boolean)
        .join("; "),
    });
  });

  // Whisper model readiness — the setup UI polls this so the one-time model
  // download shows as setup progress instead of stalling the first ingest.
  app.get("/api/transcription/status", async (c) => {
    return c.json(await transcriptionStatus(settings.whisperModel()));
  });

  // The selectable transcription qualities (id, label, note, sizeMb).
  app.get("/api/transcription/models", (c) =>
    c.json({ models: WHISPER_MODELS, selected: settings.whisperModel() }),
  );

  app.post("/api/chat/voice/transcribe", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File)) return c.json({ error: "audio file is required" }, 400);
    if (file.size <= 0) return c.json({ error: "audio file is empty" }, 400);
    if (file.size > MAX_WEB_VOICE_NOTE_BYTES) return c.json({ error: "audio file is too large" }, 413);

    const data = Buffer.from(await file.arrayBuffer());
    const result = await transcribeAudio(data, file.name || "web-voice-note.webm", {
      model: settings.whisperModel(),
      groqApiKey: settings.get("groq_api_key"),
      openaiApiKey: settings.get("openai_api_key"),
      useOpenAiForLongAudio: settings.useOpenAiForLongTranscription(),
    });
    if (!result.success) return c.json({ error: `could not transcribe voice note: ${result.error}` }, 422);
    return c.json({ transcript: result.transcript, provider: result.provider });
  });

  // Background ingest jobs — the Transcription panel polls this so a long
  // transcription is visible from any tab and survives navigation/refresh.
  app.get("/api/ingest/jobs", (c) => c.json({ jobs: runtime.ingestStore.recent() }));

  app.post("/api/ingest/jobs/:id/retry", (c) => {
    const job = runtime.ingestQueue.retry(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({ job });
  });

  app.post("/api/ingest/jobs/:id/cancel", (c) => {
    const job = runtime.ingestQueue.cancel(c.req.param("id"));
    if (!job) return c.json({ error: "job not found" }, 404);
    return c.json({ job });
  });

  app.get("/api/whatsapp/status", (c) => c.json(runtime.whatsapp.status()));

  app.put("/api/whatsapp/settings", async (c) => {
    const body = await c.req
      .json<{
        enabled?: boolean;
        allowedSenders?: string[] | string;
        groupsEnabled?: boolean;
        acceptAll?: boolean;
      }>()
      .catch(() => ({} as { enabled?: boolean; allowedSenders?: string[] | string; groupsEnabled?: boolean; acceptAll?: boolean }));
    const next = settings.setWhatsAppSettings({
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(body.allowedSenders !== undefined ? { allowedSenders: body.allowedSenders } : {}),
      ...(typeof body.groupsEnabled === "boolean" ? { groupsEnabled: body.groupsEnabled } : {}),
      ...(typeof body.acceptAll === "boolean" ? { acceptAll: body.acceptAll } : {}),
    });
    if (next.enabled) {
      await runtime.whatsapp.startIfEnabled();
      await runtime.whatsapp.refreshAllowedSenderAliases();
    } else {
      await runtime.whatsapp.disconnect();
    }
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/pair", async (c) => {
    await runtime.whatsapp.pair();
    await runtime.whatsapp.waitForPairingSignal();
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/disconnect", async (c) => {
    settings.setWhatsAppSettings({ enabled: false });
    await runtime.whatsapp.disconnect();
    return c.json(runtime.whatsapp.status());
  });

  app.post("/api/whatsapp/reset-session", async (c) => {
    const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
    if (body.confirm !== "RESET") return c.json({ error: "confirm must be RESET" }, 400);
    settings.setWhatsAppSettings({ enabled: false });
    await runtime.whatsapp.resetSession();
    return c.json(runtime.whatsapp.status());
  });

  app.get("/api/token", (c) =>
    c.json({ token: settings.apiToken(), mcpPath: "/mcp" }),
  );

  app.post("/api/token/regenerate", (c) => c.json({ token: settings.regenerateApiToken() }));

  app.get("/api/connections", (c) =>
    c.json({
      token: settings.apiToken(),
      mcpPath: "/mcp",
      clients: runtime.state.listMcpClients(),
      grants: runtime.oauth.listTokens(),
    }),
  );

  app.post("/api/connections/revoke", async (c) => {
    const { clientId } = await c.req.json<{ clientId?: string }>().catch(() => ({}) as { clientId?: string });
    if (!clientId) return c.json({ error: "clientId is required" }, 400);
    runtime.oauth.revokeClient(clientId);
    return c.json({ ok: true });
  });

  app.get("/api/vault", async (c) => {
    const vaultConfigured = settings.vaultConfigured();
    let cloned = await access(join(runtime.workdir, ".git")).then(() => true).catch(() => false);
    let headSha: string | null = null;
    let cloneError: string | null = null;
    if (vaultConfigured) {
      // getRepo clones on first use (and runs the schema-v1 migration)
      try {
        const repo = await runtime.getRepo();
        headSha = await repo.headSha();
        cloned = true;
      } catch (err) {
        cloneError = (err as Error).message;
      }
    }
    return c.json({
      repo: settings.get("vault_repo"),
      branch: settings.get("vault_branch") ?? "main",
      vaultConfigured,
      configured: settings.configured(),
      provider: settings.provider(),
      llmReady: Boolean(settings.activeApiKey()),
      cloned,
      headSha,
      cloneError,
    });
  });

  app.post("/api/vault/sync", async (c) => {
    const repo = await runtime.getRepo();
    await repo.pull();
    return c.json({ ok: true, headSha: await repo.headSha() });
  });

  app.post("/api/vault/reclone", async (c) => {
    await runtime.reclone();
    const repo = await runtime.getRepo();
    return c.json({ ok: true, headSha: await repo.headSha() });
  });

  app.get("/api/vault/lint", async (c) => c.json(await runtime.lint()));

  app.post("/api/vault/clean-slate", async (c) => c.json(await runtime.cleanSlate()));

  // --- GitHub App connect flow (manifest) ---

  /** Public base URL as seen through the reverse proxy. */
  const baseUrl = (c: { req: { header: (n: string) => string | undefined; url: string } }): string => {
    const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
    return `${proto}://${host}`;
  };

  app.get("/api/github/app/status", (c) => c.json(appStatus(settings)));

  app.get("/api/github/app/start", (c) => c.json(buildManifest(baseUrl(c))));

  // GitHub redirects the user's browser here after creating the app
  app.get("/api/github/app/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.redirect("/?github=error&reason=missing_code");
    try {
      const application = await exchangeManifestCode(code, settings);
      runtime.invalidate();
      // continue straight into the install step (repo picker on GitHub's side)
      return c.redirect(`https://github.com/apps/${application.slug}/installations/new`);
    } catch (err) {
      // Never bare-500 a connection flow — log it and bounce back to the UI
      // with a readable reason (e.g. an expired/used manifest code).
      const reason = err instanceof Error ? err.message : "manifest exchange failed";
      console.error("[github] manifest callback failed:", reason);
      return c.redirect(`/?github=error&reason=${encodeURIComponent(reason.slice(0, 200))}`);
    }
  });

  // ...and here after choosing which repos to grant
  app.get("/api/github/app/setup", (c) => {
    const installationId = c.req.query("installation_id");
    if (installationId) {
      settings.setRaw("github_app_installation_id", installationId);
      runtime.invalidate();
    }
    return c.redirect("/?github=connected");
  });

  app.get("/api/github/repos", async (c) => c.json({ repositories: await listInstallationRepos(settings) }));

  app.post("/api/github/app/disconnect", (c) => {
    disconnectApp(settings);
    runtime.invalidate();
    return c.json({ ok: true });
  });

  // --- engine ops ---

  app.post("/api/store", async (c) => {
    const body = await c.req.json<{ content?: string; hints?: string[]; verbatim?: boolean }>();
    if (!body.content) return c.json({ error: "content is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(
      await engine.store({
        content: body.content,
        source: "web",
        ...(body.hints ? { hints: body.hints } : {}),
        ...(body.verbatim !== undefined ? { verbatim: body.verbatim } : {}),
      }),
    );
  });

  app.post("/api/ask", async (c) => {
    const { question } = await c.req.json<{ question?: string }>();
    if (!question) return c.json({ error: "question is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.ask(question));
  });

  app.post("/api/chat", async (c) => {
    const { message } = await c.req.json<{ message?: string }>();
    if (!message) return c.json({ error: "message is required" }, 400);
    const cleanSlate = await handleCleanSlateChat(message, runtime);
    if (cleanSlate) return c.json(cleanSlate);
    const engine = await runtime.getEngine();
    const reply = await engine.handleTasking({ text: message, surface: "web", conversationKey: "default" });
    return c.json({ text: reply.text, sources: [], actions: reply.actions });
  });

  // #35 ping primitive: the external backlog monitor POSTs here (bearer-authed
  // like all /api/*) to make Zenod proactively message the owner over WhatsApp
  // when a Codex job lands or blocks. The WhatsApp connection stays in the app.
  app.post("/api/notify", async (c) => {
    const { text } = await c.req.json<{ text?: string }>().catch(() => ({ text: undefined }));
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    const result = await runtime.whatsapp.notifyOwner(text);
    return c.json(result);
  });

  app.post("/api/test/chat", async (c) => {
    const body = await c.req.json<SyntheticChatRequest>().catch((): SyntheticChatRequest => ({}));
    if (!body.message?.trim()) return c.json({ error: "message is required" }, 400);
    let result: Awaited<ReturnType<typeof runSyntheticChat>>;
    try {
      result = await runSyntheticChat({
        request: body,
        defaultSurface: "mcp",
        getEngine: () => runtime.getEngine(),
        recordAudit: (input) => chatTestAudit.recordChatTestRun(input),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid test chat request" }, 400);
    }
    return c.json(result, result.status === "ok" ? 200 : 500);
  });

  app.get("/api/test/chat", (c) => {
    const limit = Number(c.req.query("limit") ?? "20");
    return c.json({ runs: chatTestAudit.listChatTestRuns(Number.isFinite(limit) ? limit : 20) });
  });

  app.get("/api/test/chat/:correlationId", (c) => {
    const run = chatTestAudit.getChatTestRun(c.req.param("correlationId"));
    if (!run) return c.json({ error: "test chat run not found" }, 404);
    return c.json({ run });
  });

  // Streaming twin of /api/chat: newline-delimited JSON events
  // ({type:"delta"|"done"|"error"}). getEngine() runs first so a config error
  // surfaces as a normal 409 before the stream opens.
  app.post("/api/chat/stream", async (c) => {
    const { message } = await c.req.json<{ message?: string }>();
    if (!message) return c.json({ error: "message is required" }, 400);
    const cleanSlate = await handleCleanSlateChat(message, runtime);
    if (cleanSlate) {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(JSON.stringify({ type: "delta", text: cleanSlate.text }) + "\n"));
          controller.enqueue(enc.encode(JSON.stringify({ type: "done", sources: cleanSlate.sources }) + "\n"));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    const engine = await runtime.getEngine();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(JSON.stringify(event) + "\n"));
          } catch {
            open = false; // client disconnected mid-stream
          }
        };
        // Keep-alive: a long tool call (model download, whisper transcription)
        // can run minutes with no output. Without a heartbeat the reverse proxy
        // (Cloudflare/Traefik ~100s idle) drops the connection → "network error".
        const heartbeat = setInterval(() => send({ type: "ping" }), 15_000);
        try {
          const reply = await engine.handleTasking({ text: message, surface: "web", conversationKey: "default" });
          send({ type: "delta", text: reply.text });
          for (const action of reply.actions) {
            console.log(`[chat] action: ${action.tool}`);
            send({ type: "tool", phase: "end", tool: action.tool, label: action.tool });
          }
          send({ type: "done", sources: [], actions: reply.actions });
        } catch (err) {
          console.error("[chat] stream failed:", err);
          send({ type: "error", message: err instanceof Error ? err.message : "chat failed" });
        } finally {
          clearInterval(heartbeat);
          open = false;
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
    });
  });

  // History and clear touch only the conversation store — no engine, repo, or LLM,
  // so opening the chat tab never triggers a vault clone.
  app.get("/api/chat/history", async (c) => {
    const window = await runtime.state.recentWindow(conversationId("web"));
    return c.json({ messages: window.map((m) => ({ role: m.role, text: m.text })) });
  });

  app.delete("/api/chat", async (c) => {
    await runtime.state.clearConversation(conversationId("web"));
    return c.json({ ok: true });
  });

  app.post("/api/work", async (c) => {
    const { objective, plan } = await c.req.json<{ objective?: string; plan?: string }>();
    if (!objective) return c.json({ error: "objective is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.work({ objective, ...(plan ? { plan } : {}) }));
  });

  app.get("/api/search", async (c) => {
    const query = c.req.query("q") ?? "";
    if (!query) return c.json({ error: "q is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json({ hits: await engine.search(query) });
  });

  app.get("/api/note", async (c) => {
    const path = c.req.query("path") ?? "";
    if (!path) return c.json({ error: "path is required" }, 400);
    const engine = await runtime.getEngine();
    return c.json(await engine.get(path));
  });

  // --- MCP (Streamable HTTP, stateless: fresh transport+server per request) ---

  app.all("/mcp", requireMcpAuth(settings, runtime.oauth), async (c) => {
    const { incoming, outgoing } = c.env;
    const server = buildMcpServer(
      () => runtime.getEngine(),
      () => buildDriveTools(settings, runtime.ingestQueue),
      () => runtime.cleanSlate(),
      (input) => chatTestAudit.recordChatTestRun(input),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;

    // Record the connecting client from the initialize handshake (for the UI status).
    const init = Array.isArray(body) ? body.find((m) => m?.method === "initialize") : body;
    const clientInfo = init?.method === "initialize" ? init?.params?.clientInfo : undefined;
    if (clientInfo?.name) {
      runtime.state.recordMcpClient(String(clientInfo.name), clientInfo.version ? String(clientInfo.version) : null);
    }

    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  // --- static settings UI ---

  if (options.webDist) {
    const root = options.webDist;
    const noCache: Pick<ServeStaticOptions, "onFound"> = {
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      },
    };
    app.use("/*", serveStatic({ root, ...noCache }));
    app.get("*", serveStatic({ root, path: "index.html", ...noCache })); // SPA fallback
  }

  return app;
}

function cleanSlatePreview(): string {
  return [
    "Clean-slate vault onboarding is a two-commit setup for a fresh, empty vault repo.",
    "",
    "It will refuse to run if the vault already contains tracked or untracked files.",
    "",
    "To continue, send exactly `/clean-slate confirm`.",
  ].join("\n");
}

function formatCleanSlateResult(result: CleanSlateResult): string {
  return [
    "Clean-slate vault initialized.",
    "",
    `Vault path: ${result.vaultPath}`,
    `Branch: ${result.branch}`,
    `Initial clean commit: ${result.initialCommitSha}`,
    `Zenod setup commit: ${result.setupCommitSha}`,
    "",
    `Created top-level structure: ${result.topLevelPaths.join(", ")}`,
    `Lint: ${result.lint.ok ? "ok" : `${result.lint.errors.length} error(s)`}`,
    "",
    "Inspect:",
    ...result.inspect.map((cmd) => `- \`${cmd}\``),
    "",
    "Revert in order:",
    ...result.revert.map((cmd) => `- \`${cmd}\``),
  ].join("\n");
}

async function handleCleanSlateChat(
  message: string,
  runtime: Runtime,
): Promise<{ text: string; sources: []; cleanSlate?: CleanSlateResult } | null> {
  const trimmed = message.trim();
  if (trimmed === "/clean-slate" || /^start a clean slate vault\.?$/i.test(trimmed)) {
    return { text: cleanSlatePreview(), sources: [] };
  }
  if (trimmed !== "/clean-slate confirm") return null;
  const result = await runtime.cleanSlate();
  return { text: formatCleanSlateResult(result), sources: [], cleanSlate: result };
}
