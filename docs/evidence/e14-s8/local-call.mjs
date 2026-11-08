// E14-S8 local check: the call button end to end on a local git vault, with a recorded Realtime
// session in place of OpenAI. Derived from the E14-S3 local desk check: the real core engine and
// tenant job queue, the real customer routes (now with the call routes) behind a real customer
// session, and the web app built with VITE_ZENOD_CALL_STUB=1 so the page plays the recorded call.
// The server mints its client key from a local stub of OpenAI's client-secret endpoint (this file),
// so no OpenAI key is used. The answer engine's last step (the checked answer) is scripted; ranking,
// the memory desk (scripted plan) and the commit are real. Localhost only.
//
//   node local-call.mjs <worktree> <data dir> demo serve [port]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { execFileSync } from "node:child_process";

const [WT, DATA, VAULT, MODE = "serve", ARG] = process.argv.slice(2);
const MODEL = process.env.MODEL ?? "scripted";
const imp = (path) => import(join(WT, path));
const core = await imp("packages/core/dist/index.js");
const { VaultRepo } = await imp("packages/core/dist/git/vaultRepo.js");
const { SqliteStateStore } = await imp("packages/core/dist/state/sqlite.js");
const { TaskJobStore } = await imp("packages/server/dist/taskJobStore.js");
const { TaskJobQueue } = await imp("packages/server/dist/taskJobQueue.js");
const { InboxError, inboxFor } = await imp("packages/server/dist/inboxStore.js");
const desk = await imp("packages/server/dist/memoryDesk.js");

// ---- the vault: a made-up demo, or a copy from a git bundle
const bare = join(DATA, "origin.git");
async function demoVault(root) {
  const page = (title, parent, body, memory) => ["---", `title: ${title}`, "type: project", "tags: []", "created: 2026-08-01", "updated: 2026-08-01",
    `summary: ${title} notes.`, `parent: "[[${parent}]]"`, ...(memory ? [`memory: ${memory}`] : []), "---", "", `# ${title}`, "", body, ""].join("\n");
  const entry = (anchor, text) => `## 09:00 ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;
  const files = {
    ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
    "Index.md": "---\ntitle: Index\n---\n\n# Index\n",
    "Tree.md": core.renderTreeFile([
      { name: "Boat and cabin", kind: "long-term", path: "Projects/Boat repair.md", summary: "The boat hull repair and the cabin purchase decision." },
      { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden this spring." },
      { name: "House", kind: "long-term", path: "Areas/House.md", summary: "Running the house: boiler, plumber, insurance." },
    ], "2026-08-01"),
    "Projects/Boat repair.md": page("Boat repair", "Tree", "Hull repair at the yard.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]", "long-term"),
    "Projects/Hull quotes.md": page("Hull quotes", "Projects/Boat repair", "Two quotes for the hull, Ribeira and Porto yards.\n\n- 2026-10-01 · Hull quotes from two yards [[2026-10-01#^e-111111]]"),
    "Projects/Yard schedule.md": page("Yard schedule", "Projects/Boat repair", "When the yard can take the boat.\n\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]"),
    "Projects/Cabin decision.md": page("Cabin decision", "Projects/Boat repair", "Buying the cabin by the lake or not.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]\n- 2026-10-02 · Yard can start in March [[2026-10-02#^e-222222]]"),
    "Projects/Oakmere survey.md": page("Oakmere survey", "Projects/Cabin decision", "The survey of the Oakmere cabin.\n\n- 2026-10-03 · Oakmere cabin survey booked [[2026-10-03#^e-333333]]"),
    "Projects/Cabin financing.md": page("Cabin financing", "Projects/Cabin decision", "Mortgage offer for the cabin.\n\n- 2026-10-04 · Bank offers 3.1 percent for the cabin [[2026-10-04#^e-444444]]"),
    "Projects/Garden.md": page("Garden", "Tree", "Raised beds and seeds.\n\n- 2026-10-05 · Tomato seeds ordered [[2026-10-05#^e-555555]]", "working"),
    "Areas/House.md": page("House", "Tree", "The house.\n\n- 2026-10-06 · Ana the plumber fixed the boiler [[2026-10-06#^e-666666]]", "long-term"),
    "Areas/Boiler.md": page("Boiler", "Areas/House", "The boiler and its service.\n\n- 2026-10-06 · Ana the plumber fixed the boiler [[2026-10-06#^e-666666]]"),
  };
  const logs = [["2026-10-01", "e-111111", "Hull quotes from two yards came in"], ["2026-10-02", "e-222222", "The yard can start the boat in March"],
    ["2026-10-03", "e-333333", "Oakmere cabin survey booked for Friday"], ["2026-10-04", "e-444444", "Bank offers 3.1 percent for the cabin"],
    ["2026-10-05", "e-555555", "Tomato seeds ordered"], ["2026-10-06", "e-666666", "Ana the plumber fixed the boiler"]];
  for (const [date, anchor, text] of logs) files[`Log/${date}.md`] = `# ${date}\n\n${entry(anchor, text)}`;
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }
}
const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
try { git(["rev-parse", "--git-dir"], bare); } catch {
  await mkdir(DATA, { recursive: true });
  if (VAULT === "demo") {
    git(["init", "--bare", "--initial-branch=main", bare], DATA);
    const seed = join(DATA, "seed");
    git(["clone", bare, seed], DATA);
    await demoVault(seed);
    git(["-c", "user.name=demo", "-c", "user.email=demo@example.test", "add", "-A"], seed);
    git(["-c", "user.name=demo", "-c", "user.email=demo@example.test", "commit", "-qm", "demo vault"], seed);
    git(["push", "-q", "origin", "HEAD:main"], seed);
  } else {
    git(["clone", "-q", "--bare", VAULT, bare], DATA);
  }
}
const repo = await VaultRepo.open({ workdir: join(DATA, "vault"), remoteUrl: bare });

// ---- the model: Zenod's chat model through the relay, or a scripted plan
const usage = { calls: 0, in: 0, out: 0, cost: 0 };
const scripted = [JSON.stringify({ tool: "tree" }), JSON.stringify({ tool: "read", page: "Projects/Cabin decision.md" }), JSON.stringify({
  done: true, title: "Split Boat repair and Cabin decision", summary: "Two topics again: the cabin gets its own topic.", search: "cabin",
  changes: [{ op: "rename", page: "Projects/Boat repair.md", name: "Boat repair", summary: "The boat hull repair at the yard." },
    { op: "root", page: "Projects/Cabin decision.md", name: "Cabin decision", kind: "long-term", summary: "Whether to buy the cabin by the lake." },
    { op: "unlink", from: "Projects/Cabin decision.md", to: "2026-10-02#^e-222222" }] })];
const llm = {
  classify: async () => { throw new Error("no filing in this check"); }, composePage: async () => { throw new Error("no filing"); },
  answer: async () => { throw new Error("no ask"); }, describeImage: async () => "", work: async () => { throw new Error("no work"); },
  extractBacklog: async () => { throw new Error("no backlog"); },
  async streamMemoryChat({ system, prompt }, onText) {
    usage.calls++;
    let text;
    if (MODEL === "scripted") {
      text = system.includes("memory desk") ? scripted[(usage.calls - 1) % 3] : JSON.stringify({ keep: "", ask: "", job: prompt.replace(/^MESSAGE\n/, "") });
    } else {
      const r = await fetch("http://127.0.0.1:18999/chat", { method: "POST", body: JSON.stringify({ system, prompt }) });
      if (!r.ok) throw new Error(`relay ${r.status}`);
      const data = await r.json();
      text = data.text; usage.in += data.usage.in ?? 0; usage.out += data.usage.out ?? 0; usage.cost += data.usage.cost ?? 0;
    }
    onText?.(text);
    return text;
  },
};
const engine = core.createEngine({ repo, llm, state: new SqliteStateStore(join(DATA, "zenod.sqlite")), ...(process.env.DESK_NOW ? { now: () => new Date(process.env.DESK_NOW) } : {}), memoryIndex: { path: join(DATA, "memory-index.sqlite"), tenantId: "tenant-demo" } });

// ---- the tenant: its job queue and inbox, wired as runtime.ts wires them
const jobs = new TaskJobStore(join(DATA, "tasks.sqlite"), "tenant-demo");
const queue = new TaskJobQueue(jobs, async () => engine, undefined, undefined, () => null);
const { UsageStore } = await imp("packages/server/dist/usageStore.js");
const usageStore = new UsageStore(join(DATA, "usage.sqlite"));
// The checked answer, scripted: ranking is real, the last model step returns a quoted answer citing the Boiler page.
const callEngine = new Proxy(engine, { get(target, prop) {
  if (prop !== "answerFromMemories") return Reflect.get(target, prop);
  return async (question, memories) => {
    const boiler = memories.find((m) => m.path === "Areas/Boiler.md") ?? memories[0];
    return boiler && /plumber|boiler/i.test(question)
      ? { checked: true, text: `Ana the plumber fixed the boiler on 6 October [${boiler.n}].`, cited: [boiler.n], context: [] }
      : { checked: false, reason: "no_answer", text: "", cited: [], context: [] };
  };
} });
const runtime = {
  dataDir: DATA, tenantId: "tenant-demo", getEngine: async () => callEngine, usageStore, aiAllowanceBlock: () => null, taskJobQueue: queue,
  inboxDeskHooks: {
    undo: async (item) => desk.undoDeskItem(item, engine, queue),
    answer: (item, optionId) => { try { return desk.answerDeskQuestion(item, optionId, inboxFor(runtime), queue); } catch (e) { if (e instanceof desk.DeskLimitError) throw new InboxError("conflict", e.message); throw e; } },
    refresh: (store) => desk.settleDeskItems(store, queue),
  },
};
queue.setDeskHooks({
  run: (job, eng, assertActive) => desk.runDeskJob(job, eng, inboxFor(runtime), assertActive),
  failed: (job, error) => desk.deskJobFailed(inboxFor(runtime), job, error),
  afterCapture: (job) => desk.offerDeskJobFromChat(inboxFor(runtime), job.id, job.input.content ?? "", core.looksLikeDeskJob),
});

if (MODE === "job") {
  const started = Date.now();
  const steps = [];
  const result = await engine.deskJob({ request: ARG, onStep: (s) => steps.push(s), ...(process.env.MAX_TOUCHED ? { maxTouched: Number(process.env.MAX_TOUCHED) } : {}) });
  const out = { ms: Date.now() - started, steps, usage, status: result.status, ...(result.status === "refused" || result.status === "nothing" ? { reason: result.reason } : {}), ...(result.status === "answered" ? { answer: result.answer } : {}),
    ...(result.plan ? { plan: result.plan } : {}), ...(result.status === "done" || result.status === "needs_go" ? { touched: result.touched, changes: result.changes } : {}),
    ...(result.status === "done" ? { search: result.search, revision: result.revision.commitSha ?? result.revision.id, edits: result.edits } : {}) };
  await writeFile(join(DATA, "job-result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status: out.status, ms: out.ms, steps: out.steps, usage, touched: out.touched }, null, 1));
  process.exit(0);
}

if (MODE === "undo") {
  const last = JSON.parse(await readFile(join(DATA, "job-result.json"), "utf8"));
  const result = await engine.undoDeskJob({ title: last.plan.title, edits: last.edits });
  console.log(JSON.stringify({ undone: result.undone, skipped: result.skipped, revision: result.revision?.commitSha ?? null }));
  process.exit(0);
}

// ---- serve: the customer routes behind a real session, and the built web app
const PORT = Number(ARG ?? 18932);
const { Hono } = await imp("node_modules/hono/dist/index.js");
const { getRequestListener } = await imp("node_modules/@hono/node-server/dist/index.mjs");
const { createCustomerLayer } = await imp("packages/server/dist/customerLayer.js");
const { issueCustomerSession } = await imp("packages/server/dist/customerSession.js");
const { customerUserId } = await imp("packages/server/dist/customerIdentity.js");
const { createSqliteTenantStore } = await imp("packages/mcp-chassis/dist/index.js");
const env = { NODE_ENV: "test", CUSTOMER_APP_URL: `http://127.0.0.1:${PORT}`, ACCOUNT_STATE_SECRET: "local-demo-state",
  ...(process.env.CALL_KEY === "off" ? {} : { OPENAI_REALTIME_KEY: "stub-not-a-key" }), OPENAI_REALTIME_BASE_URL: `http://127.0.0.1:${PORT}` };
const layer = createCustomerLayer({ dataDir: DATA, runtimeForAccount: (a) => (a.tenant_id === "tenant-demo" ? runtime : null) },
  { env, stripe: {}, tenantStore: createSqliteTenantStore({ dataDir: DATA }) });
const user = { user_id: customerUserId("google", "demo"), provider: "google", provider_subject: "demo", display_name: "Demo user", avatar_url: null, email: "demo@example.test", email_verified: true, github_id: null, github_login: null };
layer.accounts.upsert("cs_demo", { account_id: "user-demo", user_id: user.user_id, tier: "monthly", tenant_id: "tenant-demo", subscription_status: "active" });
const app = new Hono();
app.get("/dev-login", (c) => { issueCustomerSession(c, user, env); return c.redirect(`/#${c.req.query("to") ?? "chat"}`); });
app.get("/dev/usage", (c) => c.json(usage));
// OpenAI's client-secret endpoint, stubbed: the server's real minter calls it with Zenod's session.
const minted = [];
app.post("/v1/realtime/client_secrets", async (c) => { const body = await c.req.json(); minted.push({ at: new Date().toISOString(), model: body.session?.model, tools: body.session?.tools?.map((t) => t.name), ttl: body.expires_after?.seconds });
  return c.json({ value: `ek_stub_${minted.length}`, expires_at: Math.floor(Date.now() / 1000) + 60, session: { id: `sess_stub_${minted.length}` } }); });
app.get("/dev/minted", (c) => c.json(minted));
const { callMeterFor } = await imp("packages/server/dist/memoryCall.js");
app.get("/dev/calls", (c) => c.json({ meter: callMeterFor(DATA).month(), ledger: usageStore.db.prepare("SELECT operation, model, cost_usd FROM llm_usage WHERE operation = 'call'").all() }));
app.get("/dev/head", (c) => c.json({ head: git(["rev-parse", "HEAD"], join(DATA, "vault")).trim(), log: git(["log", "--format=%h %s", "-5"], join(DATA, "vault")).trim().split("\n") }));
app.post("/dev/whatsapp", async (c) => { const { content } = await c.req.json(); const id = `wa-${Date.now()}`; desk.offerDeskJobFromChat(inboxFor(runtime), id, content, core.looksLikeDeskJob); return c.json({ ok: true }); });
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
createServer(getRequestListener(app.fetch)).listen(PORT, "127.0.0.1", () => console.log(`local check on http://127.0.0.1:${PORT}/dev-login (model: ${MODEL})`));
