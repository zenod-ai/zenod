#!/usr/bin/env node
// E15-Q2: Zenod's systematic memory test suite. One run gives three headline numbers
// (definitions: docs/memory-test-suite.md):
//   ingestion success rate  of the notes sent, the share stored, filed under the right branch and linked, in time, nothing lost
//   retrieval efficiency    the share of questions whose right memory is in the top 5 (plus rank, time and tokens)
//   error rate              the share of all test operations that failed or came out wrong
//
// Suites: filing (notes -> expected branch), graph (expected strong and absent links), retrieval and answers
// (questions -> expected memories and facts), recall (questions about the notes just filed) and agent
// (MCP store_memory, then get_memory and search_memory find it; an item with `ask` then asks ask_brain in plain words,
// and its own search must list the entry, E23-U6: a self-test entry kept only in the Log).
//
// Models are a free deterministic stand-in (organiser.mjs) by default, so it runs on every change at no cost.
// --model live (E15-Q3) uses real DeepSeek calls through production's client instead, cached and capped (live.mjs).
//
// usage:
//   node scripts/memory-eval/run.mjs --checkout <built checkout> --dataset demo [--out result.json] [--append history.jsonl]
//        [--label <change name>] [--sha <sha>] [--floor scripts/memory-eval/floor.json]
//   node scripts/memory-eval/run.mjs --checkout <dir> --dataset private --vault <vault dir> --questions <jsonl> [...]
//        a person's own set: a throwaway copy of their vault, never pushed; only counts leave the machine.
//        [--vault-git <clone>] questions that ask by time ("my last voice note", "today") are asked on the vault
//        revision and at the moment their `asOf` names, read from this clone (E12-S33); in the person's time
//        zone when `asOf.timeZone` names one, so "yesterday" at 19:30 in Mexico City is that evening's day before (E12-S38).
//   live tier: add --model live [--slice <question id prefix>] [--skip agent] [--live-dir <cache and ledger dir>]
//        [--live-run-cap 0.25] [--live-month-cap 3] [--live-model deepseek-flash] [--live-reasoning none]
//        with DEEPSEEK_API_KEY in the environment (never on the command line).
//   Claude (E7-S3 iteration 3): --model live --live-provider staging [--staging-url http://100.104.206.10:8781]
//        [--staging-token-file ~/.config/zenod-staging/tenant-token]: every call runs inside zenod-staging on its
//        Anthropic credit (Haiku files, Sonnet answers, as production), under its own monthly cap; no model key here.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deepseekLive, LiveCapError, LiveModel, stagingLive } from "./live.mjs";
import { StandInModel } from "./organiser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_REPO = resolve(HERE, "../..");
// A note must be filed within a minute on the demo vault, three on a person's large vault.
let FILING_LIMIT_MS = 60_000;
const QUESTION_LIMIT_MS = 10_000;
// A page and its branch are tied at 0.75 or more by design (memoryWeights childToParent); unrelated pages stay under 0.5.
const TIED = 0.7;
const APART = 0.5;

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const readSet = (file) => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const pct = (num, den) => (den ? Math.round((1000 * num) / den) / 10 : null);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const noMd = (p) => String(p ?? "").replace(/\.md(?=#|$)/, "").replace(/^\/+/, "");
const anchorOf = (ref) => String(ref ?? "").match(/e-[0-9a-f]{6}/)?.[0] ?? null;
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();

// ---------- vault helpers (read the files directly, so scoring is the same for every version) ----------

function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) { const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/); if (kv) out[kv[1]] = kv[2].replace(/^"|"$/g, ""); }
  return out;
}

function readPage(vault, rel) {
  const file = join(vault, rel.endsWith(".md") ? rel : `${rel}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** The page's branch chain, following `parent:` up to the tree (at most 8 steps). */
function lineage(vault, rel) {
  const chain = [];
  let cur = noMd(rel);
  for (let i = 0; i < 8 && cur; i++) {
    chain.push(cur);
    const raw = readPage(vault, cur);
    if (!raw) break;
    const parent = frontmatter(raw).parent?.match(/\[\[([^\]|#]+)/)?.[1];
    if (!parent || parent === "Tree" || chain.includes(noMd(parent))) break;
    cur = noMd(parent);
  }
  return chain;
}

/** Which pages cite a Log entry: a page file outside Log/ that contains the entry's anchor. */
function citingIndex(vault) {
  const out = new Map();
  let files = [];
  try {
    files = execFileSync("grep", ["-rlE", "e-[0-9a-f]{6}", "--include=*.md", "--exclude-dir=.git", "--exclude-dir=Log", vault], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
  } catch { files = []; }
  for (const file of files) {
    const rel = noMd(file.slice(vault.length + 1));
    for (const m of readFileSync(file, "utf8").matchAll(/e-[0-9a-f]{6}/g)) {
      if (!out.has(m[0])) out.set(m[0], new Set());
      out.get(m[0]).add(rel);
    }
  }
  return out;
}

function pagesContaining(vault, text) {
  try {
    return execFileSync("grep", ["-rlF", "--include=*.md", "--exclude-dir=.git", "--exclude-dir=Log", "--", text, vault], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\n").filter(Boolean).map((f) => noMd(f.slice(vault.length + 1)));
  } catch { return []; }
}

// ---------- engine on a throwaway copy of a vault ----------

async function loadCheckout(checkout) {
  const core = await import(pathToFileURL(join(checkout, "packages/core/dist/index.js")).href);
  const tryImport = async (rel) => { const f = join(checkout, rel); return existsSync(f) ? import(pathToFileURL(f).href) : null; };
  const chat = await tryImport("packages/server/dist/memoryChat.js");
  const ranked = await tryImport("packages/server/dist/rankedMemory.js");
  const mcp = await tryImport("packages/server/dist/mcp.js");
  const recent = await tryImport("packages/core/dist/vault/recentIntent.js");
  const recovery = await tryImport("packages/server/dist/vaultRecovery.js");
  const req = createRequire(join(checkout, "packages/server/package.json"));
  let sdk = null;
  try {
    const client = await import(pathToFileURL(req.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
    const mem = await import(pathToFileURL(req.resolve("@modelcontextprotocol/sdk/inMemory.js")).href);
    sdk = { Client: client.Client, InMemoryTransport: mem.InMemoryTransport };
  } catch { sdk = null; }
  return { core, chat, ranked, mcp, sdk, recentIntent: recent?.recentIntent ?? null, recovery };
}

// ---------- vault recovery, as production does it (EPIC-24 M11) ----------

// Production never leaves a vault blocked: a write refused with filing_recovery_pending makes the server run
// recoverInterruptedFiling (packages/server/src/vaultRecovery.ts), which replays the interrupted filing from its
// job, then retries the refused job. The suite does the same, so one failed filing counts once instead of
// refusing every later store in the run (the 2026-11-11 gate: one conflict became 9 agent errors).
const enrichInputs = new Map();
const recoveries = { ran: 0, recovered: 0, unresolved: 0 };
const isRecoveryPending = (error) => /filing_recovery_pending/.test(error instanceof Error ? error.message : String(error));

async function recoverVault(mods, engine) {
  if (!mods.recovery?.recoverInterruptedFiling || !engine.inspectInterruptedFiling) return false;
  recoveries.ran++;
  const replays = [];
  const outcome = await mods.recovery.recoverInterruptedFiling({
    store: { requeueFilingRecoveryBlocked: () => 0, enrichmentJobsFor: () => [], requeueForRecovery: () => false },
    getEngine: async () => engine,
    // Production replays a known job's own input; the suite keeps each note's input for the same reason.
    enqueue: (kind, input, key) => {
      const job = { id: key ?? `recovery-${replays.length}`, kind, status: "running" };
      replays.push(engine.enrichEvidence(enrichInputs.get(input.evidenceRef) ?? input).then(() => { job.status = "done"; }, () => { job.status = "error"; }));
      return job;
    },
    kick: () => {}, isClosed: () => false, pollMs: 500, timeoutMs: FILING_LIMIT_MS,
  });
  await Promise.allSettled(replays);
  const ok = outcome.status === "recovered" || outcome.status === "clean";
  recoveries[ok ? "recovered" : "unresolved"]++;
  return ok;
}

/** Run a vault write; when the vault guard refuses it, recover as production does and retry it once. */
async function healing(mods, engine, write) {
  try { return await write(); } catch (error) {
    if (!isRecoveryPending(error) || !(await recoverVault(mods, engine))) throw error;
    return write();
  }
}

/** Capture, then enrich (twice when the first run leaves the filing pending), recovering a blocked vault first. */
async function captureAndFile(mods, engine, input) {
  const captured = await healing(mods, engine, () => engine.captureEvidence(input));
  const enrichInput = { ...input, evidenceRef: captured.evidenceRef };
  enrichInputs.set(captured.evidenceRef, enrichInput);
  let enriched = await healing(mods, engine, () => engine.enrichEvidence(enrichInput));
  // Production re-queues a pending filing once (taskJobStore resumePending); the second run is the final attempt.
  if (enriched.filing === "pending") enriched = await healing(mods, engine, () => engine.enrichEvidence(enrichInput));
  return { ...enriched, evidenceRef: enriched.evidenceRef ?? captured.evidenceRef };
}

async function openVault(mods, vaultSrc, model, timeZone = null) {
  const dir = mkdtempSync(join(tmpdir(), "zenod-memory-eval-"));
  const seed = join(dir, "seed");
  cpSync(vaultSrc, seed, { recursive: true, filter: (p) => !p.endsWith("/.git") });
  const g = (...a) => execFileSync("git", a, { cwd: seed, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "add", "-A");
  g("-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-verify", "-m", "eval copy");
  execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
  const { core } = mods;
  const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
  // The copy is throwaway: machine-wide git hooks (leak scanners and the like) must not run on its commits.
  execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: join(dir, "vault"), stdio: "ignore" });
  const engine = core.createEngine({ repo, llm: model, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "eval" }, ...(timeZone ? { timeZone: () => timeZone } : {}) });
  if (engine.rebuildMemoryIndex) await engine.rebuildMemoryIndex();
  return { dir, engine, vault: join(dir, "vault"), model };
}

/**
 * Run `fn` with the clock stopped at `atMs` (E12-S33): a question that asks by time ("my last voice note",
 * "today") has the right answer only at the moment it was written, so it is asked then, on the vault as it
 * was. The engine and its index are opened inside, so every clock they read is this one.
 */
async function atMoment(atMs, fn) {
  const Real = globalThis.Date;
  class Pinned extends Real {
    constructor(...a) { if (a.length) super(...a); else super(atMs); }
    static now() { return atMs; }
  }
  globalThis.Date = Pinned;
  try { return await fn(); } finally { globalThis.Date = Real; }
}

/** True when the live caps refused a model call since `before`: the item was not really run. */
const refusedSince = (model, before) => (model?.calls?.refused ?? 0) > before;

const withLimit = (promise, ms, what) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no result within ${ms / 1000} s`)), ms).unref())]);

// ---------- suites ----------

/** One question through the chat's own answer path; the stand-in answerer records what it was given. */
async function askOne(mods, engine, model, question) {
  const started = performance.now();
  model.lastAnswerPrompt = null;
  model.lastAnswerText = null;
  model.takeReplayedMs?.();
  let shown = [];
  let mode = "chat";
  if (mods.chat?.streamAnswerFromMemory && engine.answerFromMemories) {
    await withLimit(mods.chat.streamAnswerFromMemory(engine, question, { onMemories: (m) => { shown = m; }, onText: () => {}, appChat: true }), QUESTION_LIMIT_MS, "question");
  } else if (mods.ranked?.rankMemories) {
    mode = "ranked";
    shown = (await withLimit(mods.ranked.rankMemories(engine, question, 5), QUESTION_LIMIT_MS, "question")).results ?? [];
  } else {
    mode = "search";
    shown = (await withLimit(engine.search(question), QUESTION_LIMIT_MS, "question")).slice(0, 5);
  }
  const ms = Math.round(performance.now() - started) + (model.takeReplayedMs?.() ?? 0);
  const top5 = shown.slice(0, 5).map((m) => noMd(m.path));
  // What the answer step read, without the question itself (its words would count as found facts).
  const context = model.lastAnswerPrompt == null ? null : model.lastAnswerPrompt.split(question).join(" ");
  return { ms, top5, context, tokens: model.lastAnswerPrompt == null ? null : model.lastAnswerTokens, mode, answer: model.lastAnswerText ?? null };
}

function scoreQuestion(item, got, wanted) {
  const rank = got.top5.findIndex((p) => wanted.has(p) || (p.includes("#^") && [...wanted].some((w) => anchorOf(w) && anchorOf(w) === anchorOf(p)))) + 1;
  const groups = item.expect ?? [];
  const need = item.minGroups ?? groups.length;
  const covers = (text) => groups.filter((g) => g.some((w) => text.includes(String(w).toLowerCase()))).length >= need;
  let facts = null;
  let tokens = null;
  if (got.context != null) {
    facts = covers(got.context.toLowerCase());
    tokens = got.tokens;
  }
  // Live tier: the model's own answer must carry the same facts (the stand-in never answers).
  const answered = got.answer == null ? null : covers(got.answer.toLowerCase());
  return { id: item.id, rank: rank || null, hit: rank > 0, facts, answered, tokens, ms: got.ms, mode: got.mode, error: got.error ?? null };
}

async function questionSuite(mods, ctx, model, set, wantedFor) {
  const rows = [];
  for (const item of set) {
    let got;
    const refused0 = model.calls?.refused ?? 0;
    try { got = await askOne(mods, ctx.engine, model, item.question); }
    catch (e) {
      // A call the live caps refused was not run: it is left out of the numbers and counted apart.
      if (e instanceof LiveCapError) { rows.push({ id: item.id, skipped: e.message }); continue; }
      got = { ms: null, top5: [], context: null, mode: "error", error: e instanceof Error ? e.message : String(e) };
    }
    if (refusedSince(model, refused0)) { rows.push({ id: item.id, skipped: "live cap reached" }); continue; }
    rows.push(scoreQuestion(item, got, wantedFor(item)));
  }
  return rows;
}

async function graphSuite(ctx, spec) {
  const { engine, vault } = ctx;
  const linksOf = new Map();
  let weighted = false;
  if (engine.memoryCloud) {
    for (const [a] of [...spec.strong, ...spec.apart]) {
      if (linksOf.has(a)) continue;
      try {
        const cloud = await engine.memoryCloud({ center: noMd(a), threshold: 0, maxNodes: 60 });
        linksOf.set(a, new Map((cloud?.nodes ?? []).map((n) => [noMd(n.path), n.strength])));
        weighted = true;
      } catch { linksOf.set(a, null); }
    }
  }
  const tieOf = (a, b) => {
    const cloud = linksOf.get(a);
    if (cloud) return cloud.get(noMd(b)) ?? 0;
    // Before weighted links: a page and its branch are tied when the branch is in its parent chain or it links there.
    const raw = readPage(vault, a) ?? "";
    return lineage(vault, a).includes(noMd(b)) || raw.includes(`[[${noMd(b)}]]`) ? 1 : 0;
  };
  const rows = [
    ...spec.strong.map(([a, b]) => { const s = tieOf(a, b); return { a, b, want: "strong", strength: Math.round(s * 100) / 100, ok: s >= TIED }; }),
    ...spec.apart.map(([a, b]) => { const s = tieOf(a, b); return { a, b, want: "apart", strength: Math.round(s * 100) / 100, ok: s < APART }; }),
  ];
  return { weighted, rows };
}

async function filingSuite(mods, ctx, notes) {
  const { engine, vault } = ctx;
  const rows = [];
  for (const note of notes) {
    const started = performance.now();
    let result = null;
    let error = null;
    const input = { content: note.text, source: "whatsapp", contentType: "voice_note" };
    ctx.model?.takeReplayedMs?.();
    const refused0 = ctx.model?.calls?.refused ?? 0;
    try {
      result = await withLimit((async () => {
        if (engine.captureEvidence && engine.enrichEvidence) return captureAndFile(mods, engine, input);
        return engine.store(input);
      })(), FILING_LIMIT_MS, "filing");
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const ms = Math.round(performance.now() - started) + (ctx.model?.takeReplayedMs?.() ?? 0);
    if (refusedSince(ctx.model, refused0)) { rows.push({ id: note.id, skipped: "live cap reached" }); continue; }
    const ref = result?.evidenceRef ?? null;
    const anchor = anchorOf(ref);
    const logRaw = ref ? readPage(vault, ref.split("#^")[0]) ?? "" : "";
    const filed = [...new Set([...(result?.pagesTouched ?? []), ...(result?.topics ?? []).flatMap((t) => t.filedPages ?? [])].map(noMd))];
    const memories = note.memories.map((m) => {
      const stored = logRaw.includes(m.quote);
      // The pages this note was filed on: meaning pages that cite its Log entry (receipts in Inbox/ and the
      // archive are not meaning pages). The memory is written there when its words are; a single-memory note
      // also counts when the page cites it in other words (a live model rewrites).
      const citing = anchor ? pagesContaining(vault, anchor).filter((p) => !/^(Archive|Inbox|Log)\//.test(p)) : [];
      const withQuote = citing.filter((p) => (readPage(vault, p) ?? "").includes(m.quote));
      const pages = withQuote.length ? withQuote : note.memories.length === 1 ? citing : [];
      const written = pages.length > 0;
      // Right place: on the expected page or under it when one is given, else anywhere under the expected branch.
      const placedOn = pages.find((p) => m.root === "*" || lineage(vault, p).includes(m.page ?? m.root)) ?? null;
      const placed = Boolean(placedOn);
      const page = placedOn ?? pages[0] ?? null;
      const raw = page ? readPage(vault, page) ?? "" : "";
      const linked = Boolean(page && anchor && raw.includes(anchor) && (lineage(vault, page).length > 1 || /\[\[/.test(raw.replace(anchor, ""))));
      return { quote: m.quote, root: m.root, want: m.page ?? null, stored, written, placed, linked, page, branch: page ? lineage(vault, page).at(-1) : null };
    });
    const inTime = ms <= FILING_LIMIT_MS;
    const ok = !error && inTime && memories.every((m) => m.stored && m.written && m.placed && m.linked);
    rows.push({ id: note.id, kind: note.kind, ok, ms, error, evidenceRef: ref, filed, filing: result?.filing ?? null, topics: (result?.topics ?? []).map((t) => `${t.status}${t.reason ? `: ${t.reason}` : ""}`), memories });
  }
  return rows;
}

/**
 * A person's own notes re-filed on a copy of their vault: the notes behind the placements they judged
 * (landing-feedback.jsonl from the trial page). A note passes when it is stored, written on a meaning page that
 * cites it, linked, in time, and not filed on a page they said was wrong for it.
 */
async function judgedFilingSuite(mods, ctx, judgedFile) {
  const { engine, vault } = ctx;
  // Several files, comma separated: the trial page's answers and the app's own checks (E12-S27).
  const judged = judgedFile.split(",").filter((file) => existsSync(file)).flatMap((file) => readSet(file)).filter((r) => r.type === "answer" && r.note_id);
  const titles = new Map();
  for (const file of execFileSync("find", [vault, "-name", "*.md", "-not", "-path", "*/.git/*", "-not", "-path", "*/Log/*"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean)) {
    const t = frontmatter(readFileSync(file, "utf8")).title;
    if (t) titles.set(t.toLowerCase(), noMd(file.slice(vault.length + 1)));
  }
  const notes = new Map();
  for (const r of judged) {
    if (!notes.has(r.note_id)) notes.set(r.note_id, { rejected: new Set(), approved: new Set() });
    const page = titles.get(String(r.zenod_page ?? "").toLowerCase());
    // An app move says the page's parent was wrong, not the page: it rejects nothing to file on.
    if (page && r.verdict === "no" && r.action !== "move") notes.get(r.note_id).rejected.add(page);
    if (page && r.verdict === "yes") notes.get(r.note_id).approved.add(page);
  }
  const rows = [];
  for (const [id, want] of notes) {
    let logFile = null;
    try { logFile = execFileSync("grep", ["-rlF", `^e-${id}`, join(vault, "Log")], { encoding: "utf8" }).split("\n").filter(Boolean)[0] ?? null; } catch { logFile = null; }
    if (!logFile) { rows.push({ id, ok: false, ms: null, error: "note not in this vault revision", memories: [{ fail: true }] }); continue; }
    const entry = await engine.getEntry(`${noMd(logFile.slice(vault.length + 1))}.md#^e-${id}`).catch(() => null);
    const content = entry?.content?.trim();
    if (!content) { rows.push({ id, ok: false, ms: null, error: "note text not readable", memories: [{ fail: true }] }); continue; }
    const input = { content, source: "whatsapp", contentType: "voice_note" };
    ctx.model?.takeReplayedMs?.();
    const refused0 = ctx.model?.calls?.refused ?? 0;
    const started = performance.now();
    let result = null; let error = null;
    try {
      result = await withLimit(captureAndFile(mods, engine, input), FILING_LIMIT_MS, "filing");
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const ms = Math.round(performance.now() - started) + (ctx.model?.takeReplayedMs?.() ?? 0);
    if (refusedSince(ctx.model, refused0)) { rows.push({ id, skipped: "live cap reached" }); continue; }
    const anchor = anchorOf(result?.evidenceRef);
    const logRaw = result?.evidenceRef ? readPage(vault, result.evidenceRef.split("#^")[0]) ?? "" : "";
    const stored = Boolean(anchor && logRaw.includes(anchor));
    const pages = anchor ? pagesContaining(vault, anchor).filter((p) => !/^(Archive|Inbox|Log)\//.test(p)) : [];
    const linked = pages.some((p) => lineage(vault, p).length > 1);
    const onRejected = pages.filter((p) => want.rejected.has(p)).length;
    const ok = !error && ms <= FILING_LIMIT_MS && stored && pages.length > 0 && linked && onRejected === 0;
    rows.push({ id, ok, ms, error, stored, written: pages.length > 0, linked, onRejected, pages: pages.length, judged: { rejected: want.rejected.size, approved: want.approved.size },
      memories: [{ stored, written: pages.length > 0, placed: onRejected === 0, linked }] });
  }
  return rows;
}

async function agentSuite(mods, ctx, items) {
  if (!mods.mcp?.buildMcpServer || !mods.sdk) return { available: false, rows: [] };
  const server = mods.mcp.buildMcpServer(async () => ctx.engine);
  const [clientSide, serverSide] = mods.sdk.InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new mods.sdk.Client({ name: "memory-eval", version: "1" });
  await client.connect(clientSide);
  const rows = [];
  for (const item of items) {
    const row = { id: item.id, stored: false, got: false, found: false, rank: null, ms: null, error: null, ...(item.ask ? { asked: null } : {}) };
    const started = performance.now();
    try {
      const put = await healing(mods, ctx.engine, async () => {
        const put = await withLimit(client.callTool({ name: "store_memory", arguments: { content: item.store, ...(item.source ? { source: item.source } : {}) } }), FILING_LIMIT_MS, "store_memory");
        if (put.isError) throw new Error(`store_memory: ${put.content?.[0]?.text ?? "error"}`);
        return put;
      });
      const ref = put.structuredContent?.evidenceRef;
      row.stored = Boolean(ref);
      if (ref) {
        const read = await client.callTool({ name: "get_memory", arguments: { path: ref } });
        row.got = !read.isError && JSON.stringify(read.content ?? "").includes(item.expect[0]);
      }
      const t0 = performance.now();
      const found = await withLimit(client.callTool({ name: "search_memory", arguments: { query: item.query } }), QUESTION_LIMIT_MS, "search_memory");
      row.ms = Math.round(performance.now() - t0);
      const sc = found.structuredContent ?? {};
      const hits = [...(sc.hits ?? []).slice(0, 5), ...(sc.entries ?? []).slice(0, 5)];
      const idx = hits.findIndex((h) => (ref && (h.evidenceRef === ref || anchorOf(h.path) === anchorOf(ref) || (h.evidenceRefs ?? []).some((r) => anchorOf(r) === anchorOf(ref))))
        || JSON.stringify(h).includes(item.expect[0]));
      row.found = idx >= 0;
      row.rank = idx >= 0 ? (idx % 5) + 1 : null;
      // The stand-in's answer step runs ask's own search (organiser.mjs); a live model is not asked here.
      if (item.ask && ctx.model instanceof StandInModel) {
        ctx.model.lastAskSearch = null;
        const t1 = performance.now();
        await withLimit(client.callTool({ name: "ask_brain", arguments: { question: item.ask } }), QUESTION_LIMIT_MS, "ask_brain");
        row.askMs = Math.round(performance.now() - t1);
        row.asked = Boolean(ref && String(ctx.model.lastAskSearch ?? "").includes(`#^${anchorOf(ref)}`));
      }
    } catch (e) { row.error = e instanceof Error ? e.message : String(e); }
    row.totalMs = Math.round(performance.now() - started);
    rows.push(row);
  }
  await client.close().catch(() => {});
  return { available: true, rows };
}

// ---------- headline numbers ----------

function headline({ filing = [], questions = [], agent = { rows: [] }, graph = null }) {
  const agentRows = agent.rows ?? [];
  const ingestN = filing.length + agentRows.length;
  const ingestOk = filing.filter((r) => r.ok).length + agentRows.filter((r) => r.stored && r.got).length;
  const retrievalRows = [...questions, ...agentRows.map((r) => ({ hit: r.found, rank: r.rank, ms: r.ms })),
    ...agentRows.filter((r) => r.asked != null).map((r) => ({ hit: r.asked, rank: r.asked ? 1 : null, ms: r.askMs }))];
  const hits = retrievalRows.filter((r) => r.hit).length;
  const mrr = retrievalRows.length ? retrievalRows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / retrievalRows.length : null;
  // Error rate: every memory filed, question asked and agent store-and-find pair is one operation.
  const memOps = filing.flatMap((r) => r.memories.map((m) => ({ fail: Boolean(r.error) || r.ms > FILING_LIMIT_MS || !(m.stored && m.written && m.placed && m.linked) })));
  // Live tier: a question also fails when the model's answer leaves out the facts it needed.
  const qOps = questions.map((q) => ({ fail: Boolean(q.error) || (q.ms ?? 0) > QUESTION_LIMIT_MS || q.facts === false || q.answered === false }));
  const aOps = agentRows.map((r) => ({ fail: Boolean(r.error) || !r.stored || !r.got || !r.found || r.asked === false }));
  const ops = [...memOps, ...qOps, ...aOps];
  const factsRows = questions.filter((q) => q.facts !== null);
  const answerRows = questions.filter((q) => q.answered != null);
  return {
    ingestionSuccess: pct(ingestOk, ingestN), ingestion: { ok: ingestOk, of: ingestN,
      notes: { ok: filing.filter((r) => r.ok).length, of: filing.length }, agentStores: { ok: agentRows.filter((r) => r.stored && r.got).length, of: agentRows.length },
      memories: { of: memOps.length, stored: filing.flatMap((r) => r.memories).filter((m) => m.stored).length, written: filing.flatMap((r) => r.memories).filter((m) => m.written).length,
        placed: filing.flatMap((r) => r.memories).filter((m) => m.placed).length, linked: filing.flatMap((r) => r.memories).filter((m) => m.linked).length },
      medianMs: median(filing.map((r) => r.ms)) },
    retrievalEfficiency: pct(hits, retrievalRows.length), retrieval: { top5: hits, of: retrievalRows.length, mrr: mrr == null ? null : Math.round(mrr * 100) / 100,
      medianMs: median(retrievalRows.map((r) => r.ms)), tokensPerQuestion: median(questions.map((q) => q.tokens)),
      factsReachAnswer: factsRows.length ? { ok: factsRows.filter((q) => q.facts).length, of: factsRows.length } : null,
      answersRight: answerRows.length ? { ok: answerRows.filter((q) => q.answered).length, of: answerRows.length } : null },
    errorRate: pct(ops.filter((o) => o.fail).length, ops.length), errors: { failed: ops.filter((o) => o.fail).length, of: ops.length,
      filing: memOps.filter((o) => o.fail).length, questions: qOps.filter((o) => o.fail).length, agent: aOps.filter((o) => o.fail).length },
    graph: graph ? { ok: graph.rows.filter((r) => r.ok).length, of: graph.rows.length, weighted: graph.weighted } : null,
  };
}

// ---------- main ----------

async function main() {
  const checkout = resolve(opt("checkout", SUITE_REPO));
  const dataset = opt("dataset", "demo");
  const mods = await loadCheckout(checkout);
  const live = opt("model", "stand-in") === "live";
  const skip = new Set(String(opt("skip", "")).split(",").filter(Boolean));
  const slice = opt("slice");
  let model;
  const liveDir = resolve(opt("live-dir", join(process.env.HOME ?? tmpdir(), "zenod-eval", "live")));
  const caps = { runCapUsd: Number(opt("live-run-cap", "0.25")), monthCapUsd: Number(opt("live-month-cap", "3")), runId: opt("label") ?? new Date().toISOString() };
  if (live && flag("live-stub")) {
    // Proof without a key: the stand-in behind the live tier's cache and caps, charging a fixed fake price per call.
    const usd = Number(opt("live-stub-usd", "0.001"));
    model = new LiveModel({ model: "stub", dir: liveDir, ...caps, make: (onUsage) => {
      const inner = new StandInModel();
      return new Proxy(inner, { get: (t, p) => (typeof t[p] === "function" ? async (...a) => { const out = await t[p](...a); onUsage({ providerCostUsd: usd }); return out; } : t[p]) });
    } });
  } else if (live && opt("live-provider", "deepseek") === "staging") {
    // E7-S3 iteration 3: Claude on staging's Anthropic credit route (live.mjs stagingLive); only the
    // staging test tenant's token is read here, from a file, never the model key.
    const url = opt("staging-url", "http://100.104.206.10:8781");
    const tokenFile = opt("staging-token-file", join(process.env.HOME ?? "", ".config/zenod-staging/tenant-token"));
    const token = readFileSync(tokenFile, "utf8").trim();
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
    const a = health?.credit?.anthropic;
    if (!a?.on) throw new Error("staging is not on the Anthropic credit route");
    model = stagingLive({ url, token, model: `${a.model} files, ${a.askModel} answers`, dir: liveDir, ...caps });
  } else if (live) {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new Error("--model live needs DEEPSEEK_API_KEY in the environment");
    if (!mods.core.createBrainLlm) throw new Error("this checkout has no createBrainLlm");
    model = deepseekLive(mods.core, {
      apiKey, model: opt("live-model", "deepseek-flash"), baseUrl: process.env.ZENOD_EVAL_DEEPSEEK_BASE_URL || undefined,
      reasoning: opt("live-reasoning", "none") === "default" ? undefined : opt("live-reasoning", "none"),
      dir: liveDir, ...caps,
    });
  } else model = new StandInModel();
  const pick = (rows) => (slice ? rows.filter((r) => String(r.id).startsWith(slice)) : rows);
  const t0 = Date.now();
  const suites = {};
  let vaultLabel;
  let ctx;
  if (dataset === "demo") {
    const demo = join(HERE, "demo");
    const gen = mkdtempSync(join(tmpdir(), "zenod-memory-demo-"));
    execFileSync("python3", [join(demo, "gen_vault.py"), join(SUITE_REPO, "packages/core/test/fixtures/tree-vault"), join(gen, "vault")], { stdio: "ignore" });
    vaultLabel = "demo";
    ctx = await openVault(mods, join(gen, "vault"), model);
    rmSync(gen, { recursive: true, force: true });
    const citing = citingIndex(ctx.vault);
    const wanted = (item) => { const w = new Set(); for (const r of item.refs ?? []) { w.add(noMd(r)); for (const p of citing.get(anchorOf(r)) ?? []) w.add(p); } return w; };
    suites.questions = await questionSuite(mods, ctx, model, pick(readSet(join(demo, "questions.jsonl"))), wanted);
    try { suites.graph = await graphSuite(ctx, JSON.parse(readFileSync(join(demo, "graph.json"), "utf8"))); } catch (e) { suites.graph = { weighted: false, rows: [], error: String(e) }; }
    suites.filing = await filingSuite(mods, ctx, readSet(join(demo, "notes.jsonl")));
    if (ctx.engine.rebuildMemoryIndex) await ctx.engine.rebuildMemoryIndex();
    const byNote = new Map(suites.filing.map((r) => [r.id, r]));
    const recallWanted = (item) => {
      const w = new Set();
      for (const id of item.notes) { const r = byNote.get(id); if (!r) continue; if (r.evidenceRef) w.add(noMd(r.evidenceRef)); for (const m of r.memories) if (m.page) w.add(m.page); }
      return w;
    };
    suites.recall = await questionSuite(mods, ctx, model, readSet(join(demo, "recall-questions.jsonl")), recallWanted);
    if (!skip.has("agent")) suites.agent = await agentSuite(mods, ctx, readSet(join(demo, "agent.jsonl")));
  } else if (dataset === "private") {
    const vaultSrc = opt("vault");
    const setFile = opt("questions");
    if (!vaultSrc || !setFile) throw new Error("--vault and --questions are required for the private dataset");
    FILING_LIMIT_MS = 180_000;
    vaultLabel = `private@${opt("vault-rev") ?? (existsSync(join(vaultSrc, ".git")) ? git(vaultSrc, "rev-parse", "--short", "HEAD") : "copy")}`;
    ctx = await openVault(mods, vaultSrc, model);
    const citing = citingIndex(ctx.vault);
    const wantedIn = (index) => (item) => { const w = new Set(); for (const r of item.refs ?? []) { w.add(noMd(r)); for (const p of index.get(anchorOf(r)) ?? []) w.add(p); } return w; };
    const set = pick(readSet(setFile));
    // A question that asks by time is asked on the vault and at the moment its `asOf` names: later notes
    // change its right answer honestly ("my last voice note" is the newest one), so the live vault cannot score it.
    const vaultGit = opt("vault-git");
    const byTime = (item) => Boolean(vaultGit && mods.recentIntent && item.asOf?.vaultRevision && item.asOf?.at && mods.recentIntent(item.question, Date.parse(item.asOf.at), item.asOf.timeZone ?? null));
    const timeRows = new Map();
    for (const [key, items] of Map.groupBy(set.filter(byTime), (item) => `${item.asOf.vaultRevision} ${item.asOf.at} ${item.asOf.timeZone ?? ""}`)) {
      const [rev, at, zone] = key.split(" ");
      const snap = mkdtempSync(join(tmpdir(), "zenod-memory-asof-"));
      try {
        execFileSync("bash", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "_", vaultGit, rev, snap], { stdio: "ignore" });
        const rows = await atMoment(Date.parse(at), async () => {
          const then = await openVault(mods, snap, model, zone || null);
          try { return await questionSuite(mods, then, model, items, wantedIn(citingIndex(then.vault))); } finally { rmSync(then.dir, { recursive: true, force: true }); }
        });
        for (const row of rows) timeRows.set(row.id, { ...row, asOf: rev });
      } catch (e) { console.error(`as-of ${rev}: ${e instanceof Error ? e.message : e}; those questions run on today's vault`); }
      finally { rmSync(snap, { recursive: true, force: true }); }
    }
    const now = await questionSuite(mods, ctx, model, set.filter((item) => !timeRows.has(item.id)), wantedIn(citing));
    const nowById = new Map(now.map((row) => [row.id, row]));
    suites.questions = set.map((item) => timeRows.get(item.id) ?? nowById.get(item.id));
    const judged = opt("judged");
    if (judged && judged.split(",").some((file) => existsSync(file)) && ctx.engine.captureEvidence) suites.filing = await judgedFilingSuite(mods, ctx, judged);
    if (!skip.has("agent")) suites.agent = await agentSuite(mods, ctx, readSet(join(HERE, "demo", "agent.jsonl")));
  } else throw new Error(`unknown dataset ${dataset}`);

  const ran = (rows) => (rows ?? []).filter((r) => !r.skipped);
  const skipped = [...(suites.questions ?? []), ...(suites.recall ?? []), ...(suites.filing ?? [])].filter((r) => r.skipped).length;
  const allQuestions = [...ran(suites.questions), ...ran(suites.recall)];
  const summary = headline({ filing: ran(suites.filing), questions: allQuestions, agent: suites.agent ?? { rows: [] }, graph: suites.graph });
  let sha = opt("sha");
  try { sha ??= git(checkout, "rev-parse", "--short=7", "HEAD"); } catch { sha ??= "unknown"; }
  const record = {
    at: new Date().toISOString(), dataset, vault: vaultLabel, sha, label: opt("label") ?? sha, model: live ? model.model : "stand-in",
    ...(slice || skip.size ? { slice: { questions: slice ?? "all", skip: [...skip] } } : {}),
    seconds: Math.round((Date.now() - t0) / 1000), modelCalls: model.calls, ...(recoveries.ran ? { vaultRecoveries: recoveries } : {}), ...(live ? { live: { ...model.summary(), notRun: skipped } } : {}), ...summary,
  };
  const out = opt("out");
  if (out) writeFileSync(out, JSON.stringify({ record, suites }, null, 2));
  const append = opt("append");
  if (append) appendFileSync(append, `${JSON.stringify(record)}\n`);
  rmSync(ctx.dir, { recursive: true, force: true });
  if (live) console.log(`live ${record.live.model}: ${record.live.calls.live} calls, ${record.live.calls.cached} from cache, ${record.live.calls.refused} refused by the caps, $${record.live.spentUsd} this run, $${record.live.monthSpentUsd} this month${record.retrieval.answersRight ? ` · answers right ${record.retrieval.answersRight.ok}/${record.retrieval.answersRight.of}` : ""}`);
  console.log(`ingestion ${record.ingestionSuccess}% (${record.ingestion.ok}/${record.ingestion.of}) · retrieval ${record.retrievalEfficiency}% top-5 (${record.retrieval.top5}/${record.retrieval.of}, MRR ${record.retrieval.mrr}, ${record.retrieval.medianMs} ms, ${record.retrieval.tokensPerQuestion ?? "–"} tokens) · errors ${record.errorRate}% (${record.errors.failed}/${record.errors.of})${record.graph ? ` · graph ${record.graph.ok}/${record.graph.of}` : ""}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Memory test suite (${dataset}, ${sha})\n\n| Ingestion success | Retrieval efficiency (top 5) | Error rate |\n|---|---|---|\n| ${record.ingestionSuccess}% (${record.ingestion.ok}/${record.ingestion.of}) | ${record.retrievalEfficiency}% (${record.retrieval.top5}/${record.retrieval.of}) | ${record.errorRate}% (${record.errors.failed}/${record.errors.of}) |\n\n`);
  }
  const floorFile = opt("floor");
  if (floorFile) {
    const floor = JSON.parse(readFileSync(floorFile, "utf8"));
    const below = [];
    if (record.ingestionSuccess < floor.ingestionSuccess) below.push(`ingestion ${record.ingestionSuccess} < ${floor.ingestionSuccess}`);
    if (record.retrievalEfficiency < floor.retrievalEfficiency) below.push(`retrieval ${record.retrievalEfficiency} < ${floor.retrievalEfficiency}`);
    if (record.errorRate > floor.errorRate) below.push(`errors ${record.errorRate} > ${floor.errorRate}`);
    if (below.length) { console.error(`memory suite below its floor: ${below.join("; ")}`); process.exit(1); }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(2); });
