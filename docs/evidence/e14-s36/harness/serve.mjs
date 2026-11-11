// E14-S36 local check: the shipped inbox (server and web app of the S36 branch) behind a real customer
// session, its cards posted from a JSON file: each card once as helpers posted it before S36 (title,
// reason, the desk's words) and once in the new shape (the two ideas, why yes, why not). No model call.
// Usage: node serve.mjs <worktree> <data dir> <port> <cards.json>
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer } from "node:http";
const [WT, DATA, PORT_ARG, CARDS] = process.argv.slice(2);
const PORT = Number(PORT_ARG ?? 18960);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { inboxFor } = await import(join(WT, "packages/server/dist/inboxStore.js"));
const { Runtime } = await import(join(WT, "packages/server/dist/runtime.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

const runtime = new Runtime(join(DATA, "tenant"), undefined, { tenantId: "tenant-demo", seedFromEnv: false });
const inbox = inboxFor(runtime);
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#inbox"); });
// ?shape=before posts each card as before S36, ?shape=after in the new shape; the inbox is emptied first.
app.post("/dev/seed", async (c) => {
  const shape = c.req.query("shape");
  inbox.db.exec("DELETE FROM inbox_items"); // a local check only: start each shape on an empty inbox
  const cards = JSON.parse(await readFile(CARDS, "utf8"));
  // A helper's question (the Clarifier): the same title and buttons, the new shape adds its card.
  const ask = (card, i) => inbox.post({ kind: "question", from: card.from, title: card.title, options: card.options.map((label, n) => ({ id: `m${n + 1}`, label })),
    ...(shape === "after" ? { card: card.after.card } : { body: card.before.body }), links: card.links ?? [], sourceKey: `${shape}:${i}` });
  const posted = cards.map((card, i) => card.kind === "question" ? ask(card, i) : inbox.post(shape === "after"
    ? { kind: "suggestion", from: card.from, title: card.after.title, ...(card.after.body ? { body: card.after.body } : {}), action: card.action, links: card.links ?? [], card: card.after.card, sourceKey: `${shape}:${i}` }
    : { kind: "suggestion", from: card.from, title: card.before.title, ...(card.before.body ? { body: card.before.body } : {}), action: card.action, links: card.links ?? [], sourceKey: `${shape}:${i}` }));
  return c.json({ posted: posted.length });
});
app.get("/api/auth/status", (c) => c.json({ customerAuth: true, signInMethods: ["google"], authMethod: "google" }));
app.get("/api/me", (c) => c.json({ user: { display_name: "Demo user" } }));
app.get("/api/vault/provider", (c) => c.json({ ready: true, provider: "github" }));
app.get("/api/vault", (c) => c.json({ cloned: true, cloneError: null }));
app.get("/api/settings", (c) => c.json({ settings: {} }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: "tenant-demo", name: "Demo memory" }, usage: { units: 0 } }));
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
