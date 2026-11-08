// E12-S1b local harness: the built web app and the REAL customer-layer chat routes (session, tenant,
// AI allowance, metering, streaming) for one hosted demo tenant whose engine reads the made-up demo
// vault with a real model through a localhost relay. Only the app-shell boot calls (auth status,
// overview, vault status) are stubbed, as in App.hosted-onboarding.test.tsx. Localhost only.
//
// usage: node harness.mjs <checkout> <vault src dir> <port> [chat model]
// GET /dev-login sets a customer session cookie for the demo user, then redirects to the app.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, vaultSrc, port = "18990", model] = process.argv.slice(2);
const imp = (rel) => import(pathToFileURL(join(checkout, rel)).href);
const core = await imp("packages/core/dist/index.js");
const { Runtime } = await imp("packages/server/dist/runtime.js");
const { createCustomerLayer } = await imp("packages/server/dist/customerLayer.js");
const { customerUserId } = await imp("packages/server/dist/customerIdentity.js");
const { issueCustomerSession } = await imp("packages/server/dist/customerSession.js");
const { createSqliteTenantStore } = await import(pathToFileURL(join(checkout, "node_modules/@zenod/mcp-chassis/dist/index.js")).href);
const { Hono } = await import(pathToFileURL(join(checkout, "node_modules/hono/dist/index.js")).href);
const { serve } = await import(pathToFileURL(join(checkout, "node_modules/@hono/node-server/dist/index.mjs")).href);
const { serveStatic } = await import(pathToFileURL(join(checkout, "node_modules/@hono/node-server/dist/serve-static.mjs")).href);

const dir = mkdtempSync(join(tmpdir(), "s1b-harness-"));
cpSync(vaultSrc, join(dir, "seed"), { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
git(join(dir, "seed"), "init", "-q", "-b", "main");
git(join(dir, "seed"), "-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "add", "-A");
git(join(dir, "seed"), "-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "commit", "-q", "-m", "demo vault");
execFileSync("git", ["clone", "-q", "--bare", join(dir, "seed"), join(dir, "origin.git")]);

const tenantId = "tenant-demo";
const runtime = new Runtime(join(dir, tenantId), undefined, {
  tenantId, seedFromEnv: false, platformLlm: { apiKey: "relay-adds-the-key" }, tenantMonthlyAllowanceUsd: 5,
});
const llm = core.createBrainLlm({
  provider: "openrouter",
  apiKey: "relay-adds-the-key",
  baseUrl: process.env.BENCH_BASE_URL ?? "http://127.0.0.1:18978/api/v1",
  ...(model ? { chatModel: model } : {}),
  user: tenantId,
  onBeforeCall: () => runtime.checkTenantAllowance(),
  onUsage: (report) => runtime.usageStore.record(report),
});
const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
const engine = core.createEngine({ repo, llm, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId } });
await engine.rebuildMemoryIndex();
runtime.getEngine = async () => engine;

const env = {
  NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${port}`, ACCOUNT_STATE_SECRET: "harness-state-secret",
  STRIPE_SECRET_KEY: "sk_test_not-used", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_MODE: "test", PRICE_MONTHLY: "p_m", PRICE_YEARLY: "p_y",
};
const tenants = createSqliteTenantStore({ dataDir: dir });
const layer = createCustomerLayer({ dataDir: dir, runtimeForAccount: (account) => (account.tenant_id === tenantId ? runtime : null) }, { env, stripe: {}, tenantStore: tenants });
const user = {
  user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user",
  avatar_url: null, email: "demo@example.invalid", email_verified: true, github_id: null, github_login: null,
};
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: tenantId, subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/"); });
// App-shell boot calls, stubbed as in App.hosted-onboarding.test.tsx (a verified GitHub vault).
app.get("/api/auth/status", (c) => c.json({ needsSetup: false, configured: true, hostedMode: null, customerAuth: true, authMethod: "github", signInMethods: ["github"] }));
app.get("/api/settings", (c) => c.json({ settings: { provider: "openrouter" } }));
app.get("/api/overview", (c) => c.json({ unit: { name: "zenod" }, tenant: { id: tenantId, name: "Demo memory" }, usage: null }));
app.get("/api/me", (c) => c.json({ provider: "github", providers: ["github"] }));
app.get("/api/console/account", (c) => c.json({ account_id: "user-demo", vault_repo: "demo/brain" }));
app.get("/api/vault/provider", (c) => c.json({ provider: null, ready: false }));
app.get("/api/vault", (c) => c.json({ vaultConfigured: true, repo: "demo/brain", cloned: true, cloneError: null }));
app.get("/api/customer-usage", (c) => c.json({ percentageUsed: Math.round((runtime.monthToDateSpendUsd() / 5) * 100), state: "normal", resetsAt: null }));
app.get("/api/harness/spend", (c) => c.json({ monthToDateUsd: runtime.monthToDateSpendUsd() }));
app.route("/", layer.app);
process.chdir(join(checkout, "apps/web/dist")); // serveStatic roots are relative to the working directory
app.use("/*", serveStatic({ root: "./" }));
app.get("*", serveStatic({ root: "./", path: "index.html" }));
serve({ fetch: app.fetch, port: Number(port), hostname: "127.0.0.1" }, () => console.log(`harness on http://127.0.0.1:${port}/dev-login`));
