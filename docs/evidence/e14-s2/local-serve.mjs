// E14-S2 local check: the shipped customer-layer routes (inbox included) behind a real customer
// session, serving the built web app. Demo data only, localhost only.
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18931);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { TaskJobStore } = await import(join(WT, "packages/server/dist/taskJobStore.js"));
const { inboxFor } = await import(join(WT, "packages/server/dist/inboxStore.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

const jobs = new TaskJobStore(join(DATA, "tasks.sqlite"), "tenant-demo");
const engine = { get: async (path) => ({ path, body: `# ${path.replace(/\.md$/, "").split("/").pop()}\n\nA made-up demo memory.`, url: "", provider: "github" }) };
const runtime = {
  dataDir: DATA, tenantId: "tenant-demo", getEngine: async () => engine, aiAllowanceBlock: () => null,
  taskJobQueue: { enqueue: (kind, input, key) => { const job = jobs.enqueue(kind, input, key); console.log(`[store job] ${job.id} ${JSON.stringify(input)}`); return job; } },
};
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#inbox"); });
// What a persona (S4) and the memory desk (S3) will do, through the internal API.
app.post("/dev/persona-question", (c) => c.json(inboxFor(runtime).post({ kind: "question", from: "Librarian", sourceKey: "dev:q1",
  title: "You have two notes called Boiler service. Keep them as one memory?", options: [{ id: "one", label: "Yes, one memory" }, { id: "two", label: "No, they differ" }], recommended: "one",
  links: [{ label: "Boiler service", path: "Home/Boiler service.md" }] })));
app.post("/dev/desk-job", (c) => c.json(inboxFor(runtime).post({ kind: "job", sourceKey: "dev:j1", title: "Join the Garden and Allotment topics", step: "Reading 12 memories" })));
app.post("/dev/desk-job/step", async (c) => { const { id, step } = await c.req.json(); return c.json(inboxFor(runtime).updateJob(id, { status: "working", step })); });
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
