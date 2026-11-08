// EPIC-20 A1: replay WhatsApp-style messages through the WhatsApp brain (channelTurn, the code a
// typed WhatsApp message now runs) on the built code of a checkout, over a read-only copy of a
// vault, with the hosted chat model through a local relay that adds the key. Nothing is sent to
// anyone and nothing is saved: keep and "run it?" are recorded, not performed.
//
// usage: node replay.mjs <checkout> <vault dir> <out.json> <set.json|questions.jsonl>...
//   a .json set holds {message, expect} rows (expect: keep | answer | both | job | hello);
//   a .jsonl file holds real questions ({id, question, ...}): each is answered through the WhatsApp
//   path and the cloud chat's full answer for the same call is kept beside it for grading.
// env: BENCH_BASE_URL (default http://127.0.0.1:18978/api/v1), BENCH_MODEL (default the hosted
//      chat model google/gemini-3.1-flash-lite). Private rows stay outside the repo.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, vaultSrc, outFile, ...sets] = process.argv.slice(2);
const load = (rel) => import(pathToFileURL(join(checkout, rel)).href);
const core = await load("packages/core/dist/index.js");
const brain = await load("packages/server/dist/channelBrain.js");
const chat = await load("packages/server/dist/memoryChat.js");
const baseUrl = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:18978/api/v1";
const model = process.env.BENCH_MODEL ?? "google/gemini-3.1-flash-lite";

const dir = mkdtempSync(join(tmpdir(), "e20-a1-replay-"));
const bare = join(dir, "origin.git");
const seed = join(dir, "seed");
cpSync(vaultSrc, seed, { recursive: true });
rmSync(join(seed, ".git"), { recursive: true, force: true });
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.email=replay@example.invalid", "-c", "user.name=replay", ...args], { cwd, stdio: "ignore" });
git(seed, "init", "-q", "-b", "main"); git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", "vault copy");
execFileSync("git", ["clone", "-q", "--bare", seed, bare]);

const usage = [];
const llm = core.createBrainLlm({ provider: "openrouter", apiKey: "relay-adds-the-key", baseUrl, askModel: model, chatModel: model, onUsage: (r) => usage.push(r) });
const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: bare });
const engine = core.createEngine({ repo, llm, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "replay" } });
await engine.rebuildMemoryIndex();

// Wrap the answer path so the cloud chat's full answer for the same call is kept for grading.
let lastCloud = null;
const origAnswer = engine.answerFromMemories.bind(engine);
engine.answerFromMemories = async (...args) => { const r = await origAnswer(...args); lastCloud = r; return r; };

function deps(record) {
  return {
    keep: (content) => { record.kept = content; return { id: `store-${record.i}`, status: "done" }; },
    job: (id) => ({ id, status: "done" }),
    offerJob: (captureId, request) => { record.offered = { captureId, request }; },
    appUrl: "https://cloud.zenod.dev",
    wait: async () => {},
  };
}

const rows = [];
let i = 0;
for (const set of sets) {
  const isReal = set.endsWith(".jsonl");
  const items = isReal
    ? readFileSync(set, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((q) => ({ id: q.id, message: q.question, expect: "answer", real: true }))
    : [JSON.parse(readFileSync(set, "utf8"))].map((d) => (Array.isArray(d) ? d : d.messages))[0].map((r, k) => ({ id: `${set.split("/").pop()}#${k + 1}`, message: r.message, expect: r.expect === "ask" ? "answer" : r.expect }));
  for (const item of items) {
    const record = { i: ++i, set: set.split("/").pop(), id: item.id, message: item.message, expect: item.expect };
    lastCloud = null;
    const calls = usage.length;
    const started = performance.now();
    try {
      const reply = await brain.channelTurn(engine, item.message, `chat-${i}`, deps(record));
      record.ms = Math.round(performance.now() - started);
      record.outcome = reply.outcome;
      record.whatsapp = reply.text;
      if (lastCloud) record.cloud = { checked: lastCloud.checked, text: lastCloud.text, cited: lastCloud.cited };
    } catch (error) {
      record.ms = Math.round(performance.now() - started);
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.calls = usage.length - calls;
    record.right = record.outcome === record.expect || (record.expect === "job" && record.outcome === "unsure");
    rows.push(record);
    console.error(`${record.i} ${record.right ? "ok " : "BAD"} ${record.expect}->${record.outcome} ${record.ms}ms`);
  }
}
const cost = usage.reduce((sum, r) => sum + (r.costUsd ?? r.cost ?? 0), 0);
writeFileSync(outFile, JSON.stringify({ model, at: new Date().toISOString(), costUsd: cost, calls: usage.length, rows }, null, 2));
console.error(`done: ${rows.length} rows, ${usage.length} model calls`);
