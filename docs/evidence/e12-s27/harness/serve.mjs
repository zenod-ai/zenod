// E12-S27 local check (from the E12-S2/S13 harness): the shipped customer-layer routes and a real engine over a
// vault copy, behind a real customer session, serving the built web app. Localhost only; the copy's origin is a
// local bare repo, so nothing is ever pushed anywhere.
//   node serve.mjs <checkout> <data dir> <port> <vault source dir> [demo notes.jsonl]
// With demo notes, each is filed first through the real capture + filing path with the free stand-in model of the
// memory test suite (no model spend), so their `filed:` lines carry how sure Zenod was.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const [WT, DATA, PORT_ARG, SOURCE, NOTES] = process.argv.slice(2);
const PORT = Number(PORT_ARG ?? 18951);
const imp = (rel) => import(pathToFileURL(join(WT, rel)).href);
const { Hono } = await imp("node_modules/hono/dist/index.js");
const { getRequestListener } = await imp("node_modules/@hono/node-server/dist/index.mjs");
const core = await imp("packages/core/dist/index.js");
const { createCustomerLayer } = await imp("packages/server/dist/customerLayer.js");
const { issueCustomerSession } = await imp("packages/server/dist/customerSession.js");
const { customerUserId } = await imp("packages/server/dist/customerIdentity.js");
const { createSqliteTenantStore } = await imp("packages/mcp-chassis/dist/index.js");
const { StandInModel } = await imp("scripts/memory-eval/organiser.mjs");

if (!existsSync(join(DATA, "origin.git"))) {
  const seed = join(DATA, "seed");
  mkdirSync(seed, { recursive: true });
  cpSync(SOURCE, seed, { recursive: true, filter: (p) => !p.endsWith("/.git") });
  const g = (...a) => execFileSync("git", ["-c", "user.email=local@example.invalid", "-c", "user.name=local", "-c", "core.hooksPath=/dev/null", ...a], { cwd: seed, stdio: "ignore" });
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-q", "--no-verify", "-m", "local copy");
  execFileSync("git", ["clone", "-q", "--bare", seed, join(DATA, "origin.git")]);
}
const repo = await core.VaultRepo.open({ workdir: join(DATA, "tenant-demo", "vault"), remoteUrl: join(DATA, "origin.git") });
execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: join(DATA, "tenant-demo", "vault"), stdio: "ignore" });
const model = new StandInModel();
const engine = core.createEngine({ repo, llm: model, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(DATA, "tenant-demo", "memory-index.sqlite"), tenantId: "tenant-demo" } });
if (NOTES && !existsSync(join(DATA, ".filed"))) {
  for (const line of readFileSync(NOTES, "utf8").split("\n").filter((l) => l.trim())) {
    const note = JSON.parse(line);
    const input = { content: note.text, source: "whatsapp", contentType: "voice_note" };
    const captured = await engine.captureEvidence(input);
    let filed = await engine.enrichEvidence({ ...input, evidenceRef: captured.evidenceRef });
    if (filed.filing === "pending") filed = await engine.enrichEvidence({ ...input, evidenceRef: captured.evidenceRef });
  }
  execFileSync("touch", [join(DATA, ".filed")]);
  console.log(`filed ${model.calls.classify} classify / ${model.calls.compose} compose calls (stand-in, free)`);
}
const runtime = { getEngine: async () => engine, aiAllowanceBlock: () => null, memoryTreeOutline: () => engine.memoryTreeOutline() };
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#memory"); });
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
