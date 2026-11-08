// E14-S4 round 2 local check (the persona catalog): the shipped customer-layer routes (personas and inbox) behind a real customer
// session, serving the built web app. The real persona runner and engine run on a made-up demo vault
// (a local git repo); the model is a recorded stub reply, so no model is called. Localhost only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18932);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { simpleGit } = await import(join(WT, "node_modules/simple-git/dist/esm/index.js"));
const { createEngine, VaultRepo, SqliteStateStore } = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { inboxFor } = await import(join(WT, "packages/server/dist/inboxStore.js"));
const { personasFor } = await import(join(WT, "packages/server/dist/personaStore.js"));
const { runPersona } = await import(join(WT, "packages/server/dist/personaRunner.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

// A made-up demo vault: four memories this week, one older.
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const entry = (time, anchor, text) => `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;
const files = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n",
  [`Log/${day(20)}.md`]: `# ${day(20)}\n\n${entry("09:00", "e-aaaaa1", "Old note about tomato seeds")}`,
  [`Log/${day(5)}.md`]: `# ${day(5)}\n\n${entry("10:00", "e-bbbbb2", "Call the dentist about the crown, it hurts when I chew")}`,
  [`Log/${day(3)}.md`]: `# ${day(3)}\n\n${entry("18:30", "e-ccccc3", "Garden beds: buy compost on Saturday")}`,
  [`Log/${day(2)}.md`]: `# ${day(2)}\n\n${entry("12:10", "e-eeeee5", "Boiler service booked for the 20th, 95 euros")}`,
  [`Log/${day(1)}.md`]: `# ${day(1)}\n\n${entry("08:15", "e-ddddd4", "Dentist next week, still not booked")}`,
};
const bare = join(DATA, "origin.git");
await simpleGit().init(["--bare", "--initial-branch=main", bare]);
const seed = join(DATA, "seed");
await simpleGit().clone(bare, seed);
for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(seed, path)), { recursive: true }); await writeFile(join(seed, path), content); }
const git = simpleGit(seed);
await git.addConfig("user.name", "demo").addConfig("user.email", "demo@example.test");
await git.add(["-A"]); await git.commit("demo vault"); await git.push("origin", "main");
const repo = await VaultRepo.open({ workdir: join(DATA, "work"), remoteUrl: bare });
const engine = createEngine({ repo, llm: {}, state: new SqliteStateStore(":memory:") });

// Recorded model replies per persona, numbered against the prompt's memories (newest first). No model is called.
const REPLIES = {
  "Weekly recap": { recap: ["You booked the boiler service for the 20th.", "You planned to buy compost for the garden beds on Saturday.", "The dentist came up twice: the crown hurts and it is still not booked."], finding: { title: "You mentioned the dentist twice this week and it is still not booked.", detail: "On the first mention the crown hurt when you chewed; yesterday you wrote it is still not booked.", sources: [1, 4] } },
  "Open loops finder": { loops: [{ title: "Book the dentist about the crown", sources: [1, 4] }, { title: "Buy compost for the garden beds", sources: [3] }] },
  "People and follow-ups": { people: [{ name: "The dentist", followUp: "Call to book the crown", sources: [1, 4] }] },
  "Topic gardener": { tidy: { request: "Join the Garden and Garden beds topics into one topic called Garden", why: "Garden and Garden beds hold the same kind of notes." } },
  "Ideas digest": { ideas: [{ title: "Raised garden beds with compost", sources: [3] }] },
};
const model = () => ({
  async complete(input) {
    const name = /You are ([^,]+),/.exec(input.system)?.[1] ?? "Weekly recap";
    console.log(`[stub model] ${name}: prompt has ${input.prompt.split("\n").filter((l) => l.startsWith("[")).length} memories`);
    return { text: JSON.stringify(REPLIES[name] ?? {}), inputTokens: 612, outputTokens: 118, costUsd: 0.00009 };
  },
});
const runtime = {
  dataDir: DATA, tenantId: "tenant-demo", getEngine: async () => engine, aiAllowanceBlock: () => null,
  taskJobQueue: { enqueue: () => ({ id: "demo-job" }) },
  runPersona: (persona, trigger) => runPersona(persona, {
    memory: engine, model, inbox: inboxFor(runtime), store: personasFor(runtime),
    writeNotes: (input) => engine.writePersonaNotes(input), aiAllowanceBlock: () => null,
  }, trigger),
};
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#personas"); });
app.get("/dev/commits", async (c) => c.json({ log: (await simpleGit(join(DATA, "work")).log()).all.map((x) => x.message), files: (await simpleGit(join(DATA, "work")).raw(["show", "--name-only", "--format=", "HEAD"])).trim() }));
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
createServer(getRequestListener(app.fetch)).listen(PORT, "127.0.0.1", () => console.log(`local check on http://127.0.0.1:${PORT}/dev-login (${today})`));
