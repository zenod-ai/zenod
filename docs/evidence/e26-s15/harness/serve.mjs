// E26-S15 local check (from the E14-S38 harness): the shipped code of the E26-S15 branch on a made-up memory.
// A real tenant Runtime and the real customer layer, signed in as a made-up tester. Each /dev/* step writes
// the same row the real path writes (a WhatsApp capture job, an OAuth sign-in), or calls the real route (the
// app's memory search, the helper switch), so the card ticks from that state and nothing here is real data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18961);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { simpleGit } = await import(join(WT, "node_modules/simple-git/dist/esm/index.js"));
const { createEngine, VaultRepo, SqliteStateStore } = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { setHelpersBuilding } = await import(join(WT, "packages/server/dist/personaRunner.js"));
const { Runtime } = await import(join(WT, "packages/server/dist/runtime.js"));
const { createSqliteTenantStore, createSqliteOAuthStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

const page = (title, body) => ["---", `title: ${title}`, "type: note", "tags: []", "created: 2026-11-11", "updated: 2026-11-11", `summary: ${title}.`, "---", "", `# ${title}`, "", body, ""].join("\n");
const files = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - books\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
  "Notes/Books to read.md": page("Books to read", "- Piranesi, by Susanna Clarke. Ana recommended it at lunch on 11 November."),
};
const bare = join(DATA, "origin.git");
await simpleGit().init(["--bare", "--initial-branch=main", bare]);
const seed = join(DATA, "seed");
await simpleGit().clone(bare, seed);
for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(seed, path)), { recursive: true }); await writeFile(join(seed, path), content); }
const git = simpleGit(seed);
await git.addConfig("user.name", "demo").addConfig("user.email", "demo@example.test");
await git.add(["-A"]); await git.commit("made-up vault"); await git.push("origin", "main");
const repo = await VaultRepo.open({ workdir: join(DATA, "work"), remoteUrl: bare });

await mkdir(join(DATA, "tenant"), { recursive: true });
const runtime = new Runtime(join(DATA, "tenant"), undefined, { tenantId: "tenant-tester", seedFromEnv: false });
const engine = createEngine({ repo, llm: null, state: new SqliteStateStore(":memory:") });
runtime.getEngine = async () => engine;
runtime.settings.vaultConfigured = () => true;
const oauth = createSqliteOAuthStore({ dataDir: DATA });
let building = false;
setHelpersBuilding(() => building);
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-tester" ? runtime : null) }, {
  env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }),
  // As zenodUnit.ts wires it: the chassis' OAuth sign-ins to this tenant.
  quickStartAssistantSignIn: (tenantId) => { const s = oauth.firstSignInForTenant(tenantId); return s ? { clientName: s.clientName, at: s.createdAt } : null; },
});
const user = { user_id: customerUserId("google", "tester"), provider: "google", provider_subject: "tester", display_name: "A tester", avatar_url: null, email: "tester@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_tester", { account_id: "user-tester", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-tester", subscription_status: "active" });

let waJob = null;
const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#chat"); });
// Step 1: the row a WhatsApp message makes (Phylax → store, keyed <tenant>:whatsapp:<message id>), still filing.
app.post("/dev/whatsapp", (c) => { waJob = runtime.taskJobStore.enqueue("store", { content: "Ana recommends Piranesi by Susanna Clarke", source: "whatsapp" }, "tenant-tester:whatsapp:wamid-1"); return c.json({ id: waJob.id }); });
// Step 2: the token Claude's OAuth sign-in makes for this tenant (the chassis' oauth_tokens row).
app.post("/dev/claude", (c) => { oauth.createToken({ accessToken: "demo-a", refreshToken: "demo-r", clientId: "demo", clientName: "claude-ai", resource: "mcp", scope: "mcp", tenant: { id: "tenant-tester" }, expiresAt: Date.now() + 3600e3, createdAt: Date.now() }); return c.json({ ok: true }); });
// Step 3: the same WhatsApp capture, filed.
app.post("/dev/filed", (c) => { runtime.taskJobStore.update(waJob.id, { status: "done" }); return c.json({ ok: true }); });
app.post("/dev/building/:on", (c) => { building = c.req.param("on") === "1"; return c.json({ building }); });
app.get("/dev/state", async (c) => c.json(JSON.parse(await readFile(join(DATA, "tenant", "quick-start.json"), "utf8").catch(() => "{}"))));
app.get("/api/auth/status", (c) => c.json({ customerAuth: true, signInMethods: ["google"], authMethod: "google" }));
app.get("/api/me", (c) => c.json({ user: { display_name: "A tester" } }));
app.get("/api/vault/provider", (c) => c.json({ ready: true, provider: "google_drive" }));
app.get("/api/vault", (c) => c.json({ cloned: true, cloneError: null }));
app.get("/api/settings", (c) => c.json({ settings: {} }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: "tenant-tester", name: "Tester memory" }, usage: { units: 0 } }));
app.route("/", layer.app);
const DIST = join(WT, "apps/web/dist");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  if (path.startsWith("/api/")) return c.json({ error: "not in this local check" }, 404);
  const body = await readFile(join(DIST, path)).catch(() => null) ?? await readFile(join(DIST, "index.html"));
  return c.body(body, 200, { "content-type": TYPES[extname(path)] ?? "text/html" });
});
createServer(getRequestListener(app.fetch)).listen(PORT, "127.0.0.1", () => console.log(`local check on http://127.0.0.1:${PORT}/dev-login`));
