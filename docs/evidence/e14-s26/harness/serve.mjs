// E14-S26 local check: the shipped customer-layer routes (inbox, desk, voice feedback) behind a real
// customer session and a real tenant Runtime, serving the built web app, over a made-up demo vault
// (a local git repo, the core desk test's knotted vault). The desk applies a recorded plan, so no chat
// model is called; it commits and undoes for real. Voice feedback is transcribed for real through the
// relay (relay.mjs). A made-up suggestion from "Topic gardener" is posted on the made-up tenant.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18940);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { simpleGit } = await import(join(WT, "node_modules/simple-git/dist/esm/index.js"));
const { createEngine, VaultRepo, SqliteStateStore, renderTreeFile } = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { inboxFor } = await import(join(WT, "packages/server/dist/inboxStore.js"));
const { Runtime } = await import(join(WT, "packages/server/dist/runtime.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

const page = (title, parent, body, memory) => ["---", `title: ${title}`, "type: project", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, ...(memory ? [`memory: ${memory}`] : []), "---", "", `# ${title}`, "", body, ""].join("\n");
const logEntry = (anchor, text) => `## 09:00 ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;
const files = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
  "Tree.md": renderTreeFile([
    { name: "Boat and cabin", kind: "long-term", path: "Projects/Boat repair.md", summary: "The boat hull repair and the cabin purchase decision." },
    { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden." },
  ], "2026-08-01"),
  "Projects/Boat repair.md": page("Boat repair", "Tree", "Hull repair at the yard.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]", "long-term"),
  "Projects/Hull quotes.md": page("Hull quotes", "Projects/Boat repair", "Two quotes for the hull.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]"),
  "Projects/Cabin decision.md": page("Cabin decision", "Projects/Boat repair", "Buying the cabin by the lake or not.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]"),
  "Projects/Oakmere survey.md": page("Oakmere survey", "Projects/Cabin decision", "The survey of the Oakmere cabin.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]"),
  "Projects/Garden.md": page("Garden", "Tree", "Raised beds and seeds.", "working"),
  "Log/2026-10-01.md": `# 2026-10-01\n\n${logEntry("e-111111", "Hull quotes from two yards came in")}`,
  "Log/2026-10-02.md": `# 2026-10-02\n\n${logEntry("e-222222", "The yard can start the boat in March")}`,
  "Log/2026-10-03.md": `# 2026-10-03\n\n${logEntry("e-333333", "Oakmere cabin survey booked for Friday")}`,
};
const PLAN = {
  title: "Split Boat repair and Cabin decision",
  summary: "Two topics again: the cabin gets its own topic and the boat note copied onto it is taken off.",
  search: "cabin",
  changes: [
    { op: "rename", page: "Projects/Boat repair.md", name: "Boat repair", summary: "The boat hull repair at the yard." },
    { op: "root", page: "Projects/Cabin decision.md", name: "Cabin decision", kind: "long-term", summary: "Whether to buy the cabin by the lake." },
    { op: "unlink", from: "Projects/Cabin decision.md", to: "2026-10-02#^e-222222" },
  ],
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
const real = createEngine({ repo, llm: {}, state: new SqliteStateStore(":memory:") });
const requests = [];
// The recorded plan stands in for the chat model's; the desk applies, checks, commits and undoes it for real.
const engine = Object.assign(Object.create(real), real, {
  deskJob: (input) => { requests.push(input.request); input.onStep?.("Reading your topics"); return real.deskJob({ ...input, plan: PLAN }); },
});

const runtime = new Runtime(join(DATA, "tenant"), undefined, { tenantId: "tenant-demo", seedFromEnv: false, platformLlm: { apiKey: "relay-placeholder", user: "tenant-demo" } });
runtime.getEngine = async () => engine;
const inbox = inboxFor(runtime);
inbox.post({
  kind: "suggestion", from: "Topic gardener", sourceKey: "demo:s26:1",
  title: "Boat repair and Cabin decision are two things under one topic. Split them?",
  body: "The cabin notes sit under the boat page, and a boat note was copied onto the cabin page, so \"what about the cabin\" also finds the yard.",
  action: "Give Cabin decision its own topic and take the copied boat note off it.",
  links: [{ label: "Boat repair", path: "Projects/Boat repair.md" }, { label: "Cabin decision", path: "Projects/Cabin decision.md" }],
});
inbox.post({
  kind: "suggestion", from: "People and follow-ups", sourceKey: "demo:s26:2",
  title: "Add to Ana's page: you promised her the blue notebook for 14 March.",
  body: "You said it in two notes, but her page does not have it.",
  action: "Add a line to People › Ana: blue notebook, before 14 March.",
});
inbox.post({
  kind: "suggestion", from: "Ideas digest", sourceKey: "demo:s26:3",
  title: "Give the boat-sharing idea its own page?",
  body: "It came up in three notes this month.",
  action: "Make a page Ideas › Boat sharing and link the three notes.",
});

const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#inbox"); });
app.get("/dev/state", async (c) => {
  const work = simpleGit(join(DATA, "work"));
  return c.json({
    commits: (await work.log()).all.map((x) => x.message),
    deskRequests: requests,
    cabinPage: await readFile(join(DATA, "work", "Projects/Cabin decision.md"), "utf8").catch(() => ""),
    unread: inbox.unreadFeedback("Topic gardener").map((e) => ({ kind: e.reply.kind, text: e.reply.text, voice: e.reply.voice ?? null })),
    unreadPeople: inbox.unreadFeedback("People and follow-ups").map((e) => ({ kind: e.reply.kind, text: e.reply.text })),
  });
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
