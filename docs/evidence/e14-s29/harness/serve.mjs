// E14-S29 local check (from the E22-L2 harness): the shipped customer-layer routes and a real engine + tier-0 index
// over a made-up demo memory (seed.py), behind a real customer session, serving the built web app. Localhost only.
// No model runs: the answer and the talk are fixed demo replies over the demo memories; the Send decision is
// Zenod's plain rules (what it uses without a model). Usage: serve.mjs <worktree> <web dist> <data dir> [port]
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer } from "node:http";
const [WT, WEB, DATA] = process.argv.slice(2, 5);
const PORT = Number(process.argv[5] ?? 18952);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const core = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { TaskJobStore } = await import(join(WT, "packages/server/dist/taskJobStore.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));
const qi = await import(join(WT, "packages/server/dist/quickIndex.js"));
const rd = await import(join(WT, "packages/server/dist/quickIndexRead.js"));
const tenantDir = join(DATA, "tenant-demo");
mkdirSync(join(tenantDir, "state"), { recursive: true });
const repo = await core.VaultRepo.open({ workdir: join(tenantDir, "vault"), remoteUrl: join(DATA, "origin.git") });
const engine = core.createEngine({ repo, llm: {}, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(tenantDir, "memory-index.sqlite"), tenantId: "tenant-demo" } });
if (engine.rebuildMemoryIndex) await engine.rebuildMemoryIndex();
// Demo replies (no model): a checked answer citing memory 1, and a talk citing memory 1.
engine.answerFromMemories = async (question, memories) => memories.length
  ? (() => { const m = memories.find((x) => /Moving|Ana|Cello/.test(x.title)) ?? memories[0];
      const text = /Ana/.test(m.title) ? "The blue notebook from the shop on Verdi street, for her birthday on 14 March" : /Cello/.test(m.title) ? "Your cello lessons moved to Thursdays at 6, and you are working on the Bach prelude" : "Lucía said on 6 November that the Ruzafa flat is still free until the 20th and the owner accepts a one-year contract";
      return { checked: true, text: `${text} [${m.n}].`, cited: [m.n], context: [] }; })()
  : { checked: false, reason: "no_answer", text: "", cited: [] };
engine.talkOverMemories = async (input, onText) => {
  const text = input.persona.name === "Weekly recap"
    ? "This week you wrote most about the flat hunt and running [1]. One thing stands out: you keep writing \"after the move\" about things that have nothing to do with the move. Want to start there?"
    : "You have written about running eight times since September, and the last three say you skipped it after the move [1]. Is it the time, or the new route?";
  onText?.(text);
  return { text, cited: [1] };
};
const jobs = new TaskJobStore(join(tenantDir, "jobs.sqlite"), "tenant-demo");
const queue = {
  enqueue: (kind, input, key) => {
    const job = jobs.enqueue(kind, input, key);
    // A keep is filed at once in this check (no model): under People › Ana, as the demo says.
    if (kind === "store") jobs.update(job.id, { status: "done", result: { pagesTouched: ["People/Ana.md"], pageUrls: [], urls: [] } });
    return jobs.get(job.id);
  },
  get: (id) => jobs.get(id),
  recent: (n) => jobs.recent(n),
};
// S29: the shipped quick index and its readings over the demo memory (no model call).
const store = new qi.QuickIndexStore(tenantDir);
const view = async () => qi.quickIndexView(await engine.quickIndexBase(), store.read());
const runtime = new Proxy({
  quickIndex: view,
  readAs: async (message) => rd.readAs(message, { places: (await view()).places, corrections: store.read().corrections }),
  correctReadAs: async (phrase, path) => { store.write(qi.correctReading(store.read(), phrase, path)); return true; },
  dataDir: tenantDir, getEngine: async () => engine, aiAllowanceBlock: () => null, featureBlock: () => null,
  taskJobQueue: queue, taskJobStore: jobs, memoryTreeOutline: () => engine.memoryTreeOutline(), treeSweepStatus: () => ({ status: "idle" }),
  monthToDateSpendUsd: () => 0.42, monthSpendByFeature: () => ({}), aiAllowanceStatus: () => ({ usedUsd: 0.42, capUsd: 5, enforced: true, resetsAt: "2026-12-01T00:00:00Z" }),
}, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && !k.startsWith("then") ? (console.log("runtime missing", k), undefined) : undefined)) });
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });
const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect(`/${new URL(c.req.url).searchParams.get("to") ?? "#chat"}`); });
app.get("/api/auth/status", (c) => c.json({ customerAuth: true, signInMethods: ["google"], authMethod: "google" }));
app.get("/api/me", (c) => c.json({ user: { display_name: "Demo user" } }));
app.get("/api/vault/provider", (c) => c.json({ ready: true, provider: "github" }));
app.get("/api/vault", (c) => c.json({ cloned: true, cloneError: null }));
app.get("/api/settings", (c) => c.json({ settings: {} }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: "tenant-demo", name: "Demo memory" }, usage: { units: 0 } }));
app.route("/", layer.app);
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ttf": "font/ttf" };
app.get("*", async (c) => {
  const path = c.req.path === "/" ? "/index.html" : c.req.path;
  if (path.startsWith("/api/")) return c.json({ error: "not in this local check" }, 404);
  const body = await readFile(join(WEB, path)).catch(() => null) ?? await readFile(join(WEB, "index.html"));
  return c.body(body, 200, { "content-type": TYPES[extname(path)] ?? "text/html" });
});
createServer(getRequestListener(app.fetch)).listen(PORT, "127.0.0.1", () => console.log(`ready http://127.0.0.1:${PORT}/dev-login`));
