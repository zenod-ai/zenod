// E15-S1 local check (from the E12-S13 harness): the shipped customer-layer chat routes and a real engine + tier-0 index
// over the made-up demo vault, behind a real customer session, serving the built web app. Localhost only.
// No model: the answer step replies "no answer", as the live model did for "who are you?".
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer } from "node:http";
const [WT, WEB, DATA, SEED] = process.argv.slice(2, 6);
const PORT = Number(process.argv[6] ?? 18951);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const core = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));
const repo = await core.VaultRepo.open({ workdir: join(DATA, "tenant-demo", "vault"), remoteUrl: join(DATA, "origin.git") });
const engine = core.createEngine({ repo, llm: {}, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(DATA, "tenant-demo", "memory-index.sqlite"), tenantId: "tenant-demo" } });
if (engine.rebuildMemoryIndex) await engine.rebuildMemoryIndex();
engine.answerFromMemories = async () => ({ checked: false, reason: "no_answer", text: "", cited: [] });
const runtime = { getEngine: async () => engine, aiAllowanceBlock: () => null, featureBlock: () => null };
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });
const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#chat"); });
app.get("/api/auth/status", (c) => c.json({ customerAuth: true, signInMethods: ["google"], authMethod: "google" }));
app.get("/api/me", (c) => c.json({ user: { display_name: "Demo user" } }));
app.get("/api/vault/provider", (c) => c.json({ ready: true, provider: "github" }));
app.get("/api/vault", (c) => c.json({ cloned: true, cloneError: null }));
app.get("/api/settings", (c) => c.json({ settings: {} }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: "tenant-demo", name: "Demo memory" }, usage: { units: 0 } }));
app.route("/", layer.app);
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  if (path.startsWith("/api/")) return c.json({ error: "not in this local check" }, 404);
  const body = await readFile(join(WEB, path)).catch(() => null) ?? await readFile(join(WEB, "index.html"));
  return c.body(body, 200, { "content-type": TYPES[extname(path)] ?? "text/html" });
});
createServer(getRequestListener(app.fetch)).listen(PORT, "127.0.0.1", () => console.log(`ready http://127.0.0.1:${PORT}/dev-login`));
