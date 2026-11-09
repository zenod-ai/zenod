// E14-S10 local check: the shipped customer routes (Usage section) behind a real customer session,
// on a real hosted Runtime ($3 allowance) whose usage ledger holds a recorded month for two made-up
// users: a typical one and a heavy one (Jordi-sized, from the E15-Q0 cost basis). No model is
// called and nothing is spent. Localhost only. /dev-login?who=typical|heavy
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18934);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { Runtime } = await import(join(WT, "packages/server/dist/runtime.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { projectLedgerUsage } = await import(join(WT, "packages/server/dist/customerMetering.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

// Month-to-date spend by feature (USD), recorded on each tenant's real usage ledger.
const MONTHS = {
  typical: { filing: ["classify", 0.84], chat: ["answer", 0.11], personas: ["answer", 0.09], desk: ["compose", 0.03], calls: ["call", 0.21] },
  heavy: { filing: ["classify", 2.48], chat: ["answer", 0.31], personas: ["answer", 0.14], desk: ["compose", 0.06], calls: ["call", 0.27] },
};
const runtimes = {};
for (const [who, month] of Object.entries(MONTHS)) {
  const runtime = new Runtime(mkdtempSync(join(tmpdir(), `zenod-s10-${who}-`)), undefined, {
    seedFromEnv: false, tenantId: `tenant-${who}`, platformLlm: { apiKey: "sk-or-v1-local-demo" }, tenantMonthlyAllowanceUsd: 3,
  });
  for (const [feature, [operation, usd]] of Object.entries(month)) {
    runtime.usageStore.record({ operation, provider: "openrouter", model: "demo", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, providerCostUsd: usd }, Date.now(), feature);
  }
  runtimes[`tenant-${who}`] = runtime;
}
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => runtimes[a.tenant_id] ?? null },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const users = {};
for (const who of Object.keys(MONTHS)) {
  users[who] = { user_id: customerUserId("google", who), provider: "google", provider_subject: who, display_name: `Demo ${who}`, avatar_url: null, email: `${who}@example.test`, email_verified: true, github_id: null, github_login: null };
  layer.accounts.upsert(`cs_${who}`, { account_id: `user-${who}`, user_id: users[who].user_id, tier: "monthly", tenant_id: `tenant-${who}`, subscription_status: "active" });
}
let current = "typical";
const app = new Hono();
app.get("/dev-login", (c) => { current = c.req.query("who") === "heavy" ? "heavy" : "typical"; issueCustomerSession(c, users[current], env); return c.redirect("/"); });
// The top card's existing projection, from the same ledger (in production: /api/customer-usage).
app.get("/api/customer-usage", (c) => {
  const runtime = runtimes[`tenant-${current}`];
  const p = projectLedgerUsage(runtime.monthToDateSpendUsd(), 3, 80, Date.now(), true);
  return c.json({ ...p, breakdown: { ai: { spendUsd: p.monthSpendUsd, allowanceUsd: 3, percentageUsed: p.percentageUsed, paused: p.state === "paused" }, channel: null } });
});
app.get("/api/auth/status", (c) => c.json({ customerAuth: true, signInMethods: ["google"], authMethod: "google" }));
app.get("/api/me", (c) => c.json({ user: { display_name: `Demo ${current}` } }));
app.get("/api/vault/provider", (c) => c.json({ ready: true, provider: "github" }));
app.get("/api/vault", (c) => c.json({ cloned: true, cloneError: null }));
app.get("/api/settings", (c) => c.json({ settings: {} }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: `tenant-${current}`, name: "Demo memory" }, usage: { units: 0 } }));
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
