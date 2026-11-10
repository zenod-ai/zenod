// E14-S35 local check: the shipped code of the S35 branch on a made-up memory (from the S27 round 2
// harness). A real tenant Runtime with subscribers on, one made-up Team connection whose hook URL points
// at this server, and a fake /ask that answers like the Team desk. The model is a stub with fixed replies,
// so the run, the card and the Helpers switch are the shipped code and nothing here is real data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";
const WT = process.argv[2];
const DATA = process.argv[3];
const PORT = Number(process.argv[4] ?? 18960);
const { Hono } = await import(join(WT, "node_modules/hono/dist/index.js"));
const { getRequestListener } = await import(join(WT, "node_modules/@hono/node-server/dist/index.mjs"));
const { simpleGit } = await import(join(WT, "node_modules/simple-git/dist/esm/index.js"));
const { createEngine, VaultRepo, SqliteStateStore, renderTreeFile } = await import(join(WT, "packages/core/dist/index.js"));
const { createCustomerLayer } = await import(join(WT, "packages/server/dist/customerLayer.js"));
const { issueCustomerSession } = await import(join(WT, "packages/server/dist/customerSession.js"));
const { customerUserId } = await import(join(WT, "packages/server/dist/customerIdentity.js"));
const { inboxFor } = await import(join(WT, "packages/server/dist/inboxStore.js"));
const { personasFor } = await import(join(WT, "packages/server/dist/personaStore.js"));
const { personaById } = await import(join(WT, "packages/server/dist/personaCatalog.js"));
const { Runtime } = await import(join(WT, "packages/server/dist/runtime.js"));
const { createSqliteTenantStore } = await import(join(WT, "packages/mcp-chassis/dist/index.js"));

const page = (title, parent, body, memory) => ["---", `title: ${title}`, "type: note", "tags: []", "created: 2026-10-20", "updated: 2026-11-09",
  `summary: ${title}.`, ...(parent ? [`parent: "[[${parent}]]"`] : []), ...(memory ? [`memory: ${memory}`] : []), "---", "", `# ${title}`, "", body, ""].join("\n");
const ENTRIES = [
  ["2026-10-28", "e-a00001", "Boiler making a noise again. Call Marc the plumber this week."],
  ["2026-10-29", "e-a00002", "Promised Ana I would send her the blue notebook before her trip on 14 November."],
  ["2026-10-31", "e-a00003", "Idea: a small shed for the bikes behind the garden."],
  ["2026-11-01", "e-a00004", "Dentist: need to book a check-up, the crown feels loose."],
  ["2026-11-02", "e-a00005", "Marc came, boiler pressure fixed. He will send the invoice."],
  ["2026-11-03", "e-a00006", "Bike shed again: we could build it from the old pallets."],
  ["2026-11-04", "e-a00007", "Compost bin is full, buy a second one on Saturday."],
  ["2026-11-05", "e-a00008", "Ana asked about the notebook again."],
  ["2026-11-06", "e-a00009", "Thinking about sharing the boat with Leo, half the mooring cost each."],
  ["2026-11-07", "e-a00010", "Bike shed: measured it, 2 by 1.5 metres fits next to the compost."],
  ["2026-11-08", "e-a00011", "Still have not booked the dentist."],
  ["2026-11-09", "e-a00012", "Boiler fine since Marc's visit. Invoice not here yet."],
];
const cite = (anchor) => { const [day, a, text] = ENTRIES.find((e) => e[1] === anchor); return `- ${day} · ${text} [[${day}#^${a}]]`; };
const logEntry = (anchor, text) => `## 09:00 ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;
const files = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
  "Tree.md": renderTreeFile([
    { name: "Home", kind: "working", path: "Areas/Home.md", summary: "The flat on Verdi street and its repairs." },
    { name: "Garden", kind: "working", path: "Areas/Garden.md", summary: "The vegetable garden and compost." },
    { name: "People", kind: "long-term", path: "Areas/People.md", summary: "Friends, family and the people who help." },
    { name: "Boat", kind: "long-term", path: "Areas/Boat.md", summary: "The boat and its mooring." },
  ], "2026-10-20"),
  "Areas/Home.md": page("Home", "Tree", "The flat on Verdi street.", "working"),
  "Areas/Garden.md": page("Garden", "Tree", "Raised beds and compost.", "working"),
  "Areas/People.md": page("People", "Tree", "People who come up.", "long-term"),
  "Areas/Boat.md": page("Boat", "Tree", "The boat at the marina.", "long-term"),
  // Filed in the wrong place: the boiler is about the flat, not the garden.
  "Notes/Boiler.md": page("Boiler", "Areas/Garden", ["The flat's boiler.", "", cite("e-a00001"), cite("e-a00005"), cite("e-a00012")].join("\n")),
  "Notes/Compost.md": page("Compost", "Areas/Garden", cite("e-a00007")),
  "People/Ana.md": page("Ana", "Areas/People", "A friend."),
  "People/Marc.md": page("Marc", "Areas/People", "The plumber."),
  // Loose: under no place yet.
  "Notes/Bike shed.md": page("Bike shed", null, [cite("e-a00003"), cite("e-a00006"), cite("e-a00010")].join("\n")),
  "Notes/Dentist.md": page("Dentist", null, [cite("e-a00004"), cite("e-a00011")].join("\n")),
  "Notes/Blue notebook.md": page("Blue notebook", null, [cite("e-a00002"), cite("e-a00008")].join("\n")),
  "Notes/Boat sharing.md": page("Boat sharing", null, cite("e-a00009")),
};
for (const [day, anchor, text] of ENTRIES) files[`Log/${day}.md`] = `# ${day}\n\n${logEntry(anchor, text)}`.replace("## 09:00", `## 09:00`);
const bare = join(DATA, "origin.git");
await simpleGit().init(["--bare", "--initial-branch=main", bare]);
const seed = join(DATA, "seed");
await simpleGit().clone(bare, seed);
for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(seed, path)), { recursive: true }); await writeFile(join(seed, path), content); }
const git = simpleGit(seed);
await git.addConfig("user.name", "demo").addConfig("user.email", "demo@example.test");
await git.add(["-A"]); await git.commit("made-up vault"); await git.push("origin", "main");
const repo = await VaultRepo.open({ workdir: join(DATA, "work"), remoteUrl: bare });

const runtime = new Runtime(join(DATA, "tenant"), undefined, { tenantId: "tenant-demo", seedFromEnv: false, subscriberEnv: { ZENOD_SUBSCRIBERS: "on" } });
const engine = createEngine({ repo, llm: null, state: new SqliteStateStore(":memory:") });
runtime.getEngine = async () => engine;
const inbox = inboxFor(runtime);
// A stub model: the first call names one question for the team, the second uses the answer.
const calls = [];
const FIRST = JSON.stringify({ loops: [{ title: "Decide whether to share the boat with Leo", sources: [4] }], suggestion: { title: "Give the boat sharing note its place under Boat.", why: "The boat sharing idea sits under no place.", action: "Move Boat sharing under Boat.", sources: [4] }, teamQuestion: "Does the boat sharing idea connect to any of my plans or milestones, and what state are they in?" });
const SECOND = JSON.stringify({ loops: [{ title: "Decide whether to share the boat with Leo", sources: [4] }], suggestion: { title: "Give the boat sharing note its place under Boat.", why: "The boat sharing idea sits under no place, and the team says your Boat plan is waiting on that decision.", action: "Move Boat sharing under Boat.", sources: [4] }, usedTeamAnswer: true });
runtime.personaModel = () => ({ complete: async (input) => { calls.push(input); return { text: calls.length % 2 === 1 ? FIRST : SECOND, inputTokens: 1500, outputTokens: 120, costUsd: 0.0006 }; } });
const asked = [];
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state" };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });
runtime.subscribers.create({ name: "Epic Team", kind: "agent_team", product: "EpicSpine", url: `http://127.0.0.1:${PORT}/api/hooks/zenod/zcn_demo`, event: "voice_note.captured", via: "manual" });
personasFor(runtime).setEnabled("open-loops", true);

const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect("/#helpers"); });
// The fake Team desk: checks a signature is there and answers like the real one (made-up words).
app.post("/api/hooks/zenod/zcn_demo/ask", async (c) => {
  const body = await c.req.json();
  asked.push({ ...body, signed: /^t=\d+,v1=[0-9a-f]{64}$/.test(c.req.header("x-zenod-signature") ?? "") });
  return c.json({ answer: "The boat sharing idea connects to the milestone Boat plan, which is waiting on a decision about sharing the mooring.", refs: ["Boat plan"], model: "gpt-4o-mini", costUsd: 0.0007 });
});
app.post("/dev/run/:id", async (c) => {
  const run = await runtime.runPersona(personaById(c.req.param("id")), "manual");
  return c.json({ run, asked, calls: calls.length });
});
app.get("/dev/state", (c) => c.json({ inbox: inbox.list(100).map((i) => ({ kind: i.kind, from: i.from, title: i.title, body: i.body, action: i.action })), asked }));
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
