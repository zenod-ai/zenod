import { access } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NoteNotFoundError, VERSION } from "zenod";
import { clearSession, issueSession, requireAuth } from "./auth.js";
import {
  appStatus,
  buildManifest,
  disconnectApp,
  exchangeManifestCode,
  installationToken,
  listInstallationRepos,
} from "./githubApp.js";
import { buildMcpServer } from "./mcp.js";
import { NotConfiguredError, Runtime, testAnthropic, testGithub } from "./runtime.js";
import { SETTING_KEYS, type SettingKey } from "./settings.js";

export interface AppOptions {
  /** Directory with the built web UI (apps/web/dist). Optional in dev/tests. */
  webDist?: string;
}

export function createApp(runtime: Runtime, options: AppOptions = {}): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { settings } = runtime;

  app.onError((err, c) => {
    if (err instanceof NotConfiguredError) return c.json({ error: err.message, code: "not_configured" }, 409);
    if (err instanceof NoteNotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  // --- public ---

  app.get("/api/health", (c) => c.json({ status: "ok", name: "zenod", version: VERSION }));

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

  app.post("/api/settings/test-anthropic", async (c) => {
    const body = await c.req.json<{ api_key?: string }>().catch(() => ({}) as Record<string, string>);
    const key = (body.api_key && !body.api_key.includes("••••") ? body.api_key : null) || settings.get("anthropic_api_key");
    if (!key) return c.json({ ok: false, message: "API key is required" });
    return c.json(await testAnthropic(key));
  });

  app.get("/api/token", (c) =>
    c.json({ token: settings.apiToken(), mcpPath: "/mcp" }),
  );

  app.post("/api/token/regenerate", (c) => c.json({ token: settings.regenerateApiToken() }));

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
      anthropicReady: Boolean(settings.get("anthropic_api_key")),
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
    if (!code) return c.json({ error: "missing code" }, 400);
    const application = await exchangeManifestCode(code, settings);
    runtime.invalidate();
    // continue straight into the install step (repo picker on GitHub's side)
    return c.redirect(`https://github.com/apps/${application.slug}/installations/new`);
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
    const engine = await runtime.getEngine();
    return c.json(await engine.chat(message, "web"));
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

  app.all("/mcp", auth, async (c) => {
    const { incoming, outgoing } = c.env;
    const server = buildMcpServer(() => runtime.getEngine());
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
    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });

  // --- static settings UI ---

  if (options.webDist) {
    const root = options.webDist;
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" })); // SPA fallback
  }

  return app;
}
