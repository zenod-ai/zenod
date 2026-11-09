#!/usr/bin/env node
// E15-Q4: where the time goes when Zenod files a note on a large memory. Files notes through the
// production capture-then-enrich path (with the one pending resume TaskJobQueue gives a filing) on a
// throwaway copy of a vault, with the free stand-in model, and records every model call: what it was,
// how much it was handed, and the host time between calls. No model credit is spent.
//
// Model time is not measured (the stand-in answers at once). It is estimated per call from the
// prompt and answer sizes with rates fitted to recorded DeepSeek V4.1 Flash filing runs (E12-S6/S8):
// see MODEL_RATE below. The host time and the call and token counts are measured. With
// --latency-scale s the stand-in also waits s x its estimated time per call, so calls that overlap are
// seen to overlap: the model time of a note is then the time spent waiting on at least one call / s.
//
// usage: node scripts/memory-eval/filing-profile.mjs --checkout <repo> (--vault <dir> | --demo)
//          [--notes <jsonl>] [--long] [--latency-scale <0..1>] [--from-log <Log/day.md#^e-id>,...] [--out <json>] [--label <text>]
// --from-log files the text of those Log entries of the vault again as new notes (a private vault's
// real voice notes stay on this machine; only counts are printed).

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StandInModel } from "./organiser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);

/**
 * Seconds per call, fitted by least squares to recorded DeepSeek V4.1 Flash filing runs (E12-S6 demo-new
 * and demo-old, 24 notes, 77 calls, median error 3.8 s on a median note of 29 s): a fixed start per call,
 * prompt reading and answer writing. The stand-in writes no reasoning, so each answer is counted at the
 * recorded median for its kind (classify 3,382 tokens; reconcile and compose, logged together, 696).
 */
const MODEL_RATE = { startS: 0.45, promptTokPerS: 2430, answerTokPerS: 290 };
const RECORDED_ANSWER_TOKENS = { classify: 3382, reconcile: 696, compose: 696 };
const tokens = (value) => Math.round(JSON.stringify(value ?? "").length / 4);

/** The stand-in with a reconciler (production has one) and a log of every call. */
class ProfiledModel extends StandInModel {
  constructor(scale = 0) { super(); this.log = []; this.calls.reconcile = 0; this.scale = scale; this.open = 0; this.waitStart = 0; this.waited = 0; }
  /** Wait s x the call's estimated model time, keeping the time at least one call was open. */
  async wait(modelS) {
    if (!this.scale) return;
    if (this.open++ === 0) this.waitStart = performance.now();
    await new Promise((r) => setTimeout(r, modelS * 1000 * this.scale));
    if (--this.open === 0) this.waited += performance.now() - this.waitStart;
  }
  note(op, input) {
    const promptTokens = tokens(input);
    const answerTokens = RECORDED_ANSWER_TOKENS[op] ?? 500;
    const modelS = MODEL_RATE.startS + promptTokens / MODEL_RATE.promptTokPerS + answerTokens / MODEL_RATE.answerTokPerS;
    this.log.push({ op, at: performance.now(), promptTokens, candidates: input?.pageIndex?.length ?? null, modelS: Math.round(modelS * 10) / 10 });
    return this.wait(modelS);
  }
  async classify(input) { await this.note("classify", input); return super.classify(input); }
  async composePage(input) { await this.note("compose", input); return super.composePage(input); }
  async reconcile(input) {
    this.calls.reconcile += 1;
    await this.note("reconcile", input);
    // Add every classifier-selected quote, as a model does for new knowledge.
    return (input.addCandidates ?? []).map((candidate) => ({ kind: "add", ideaIds: candidate.ideaIds, sourceIds: [candidate.id], sourceQuote: "-",
      targetId: null, factKey: null, correctionQuote: null, reason: "new knowledge on this branch" }));
  }
}

/** A long multi-topic voice note, like the ones that took minutes: the demo notes run together. */
function longNote(notes) {
  return { id: "long", text: notes.map((n) => n.text).join(" Also, "), memories: notes.flatMap((n) => n.memories ?? []) };
}

/** The text of one Log entry (its body under the heading). */
function logEntry(vault, ref) {
  const [path, anchor] = ref.split("#^");
  const raw = readFileSync(join(vault, path), "utf8");
  const entry = raw.split(/\n(?=## )/).find((e) => e.split("\n", 1)[0].includes(`^${anchor}`));
  if (!entry) throw new Error(`no entry ${ref}`);
  return entry.split("\n").slice(1).join("\n").trim();
}

async function main() {
  const checkout = resolve(opt("checkout", join(HERE, "..", "..")));
  const core = await import(pathToFileURL(join(checkout, "packages/core/dist/index.js")).href);
  const dir = mkdtempSync(join(tmpdir(), "zenod-filing-profile-"));
  const seed = join(dir, "seed");
  if (flag("demo")) {
    execFileSync("python3", [join(HERE, "demo", "gen_vault.py"), join(checkout, "packages/core/test/fixtures/tree-vault"), seed, join(dir, "q.json")], { stdio: "ignore" });
  } else {
    const vault = opt("vault");
    if (!vault || !existsSync(vault)) throw new Error("--vault <dir> or --demo is required");
    cpSync(vault, seed, { recursive: true, filter: (p) => !p.endsWith("/.git") });
  }
  const g = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" });
  g(seed, "init", "-q", "-b", "main");
  g(seed, "-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "add", "-A");
  g(seed, "-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-verify", "-m", "profile copy");
  execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
  const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
  g(join(dir, "vault"), "config", "core.hooksPath", "/dev/null");
  const scale = Number(opt("latency-scale", "0"));
  const model = new ProfiledModel(scale);
  const engine = core.createEngine({ repo, llm: model, state: new core.SqliteStateStore(":memory:"), readSyncTtlMs: 0,
    memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "profile" } });
  if (engine.rebuildMemoryIndex) await engine.rebuildMemoryIndex();

  const demoNotes = readFileSync(opt("notes", join(HERE, "demo", "notes.jsonl")), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const fromLog = opt("from-log");
  const notes = fromLog ? fromLog.split(",").map((ref) => ({ id: ref.split("#^")[1], text: logEntry(join(dir, "vault"), ref) }))
    : flag("long") ? [longNote(demoNotes.slice(0, 10))] : demoNotes;
  const rows = [];
  for (const [i, note] of notes.entries()) {
    const input = { content: note.text, source: "whatsapp", contentType: "voice_note", verbatim: true,
      capturedAt: new Date(Date.UTC(2026, 10, 9, 8, i)).toISOString(), sourceId: `q4-profile:${note.id}` };
    const from = model.log.length;
    const waited0 = model.waited;
    const started = performance.now();
    let result = null, error = null, passes = 0;
    try {
      const captured = await engine.captureEvidence(input);
      result = await engine.enrichEvidence({ ...input, evidenceRef: captured.evidenceRef }); passes += 1;
      // Production re-queues a pending filing once (taskJobStore resumePending).
      if (result.filing === "pending") { result = await engine.enrichEvidence({ ...input, evidenceRef: captured.evidenceRef }); passes += 1; }
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const hostMs = Math.round(performance.now() - started);
    const calls = model.log.slice(from);
    const byOp = {};
    for (const c of calls) { const o = (byOp[c.op] ??= { calls: 0, promptTokens: 0, modelS: 0, maxCandidates: 0 }); o.calls += 1; o.promptTokens += c.promptTokens; o.modelS += c.modelS; o.maxCandidates = Math.max(o.maxCandidates, c.candidates ?? 0); }
    const waitedMs = model.waited - waited0;
    // Without waiting, model calls run back to back: their time adds up. With waiting, overlap counts once.
    const modelS = scale ? waitedMs / 1000 / scale : calls.reduce((s, c) => s + c.modelS, 0);
    const hostOnlyMs = scale ? hostMs - waitedMs : hostMs;
    const topics = result?.topics ?? [];
    rows.push({ id: note.id, chars: note.text.length, passes, filing: result?.filing ?? null, error,
      topics: { filed: topics.filter((t) => t.status === "filed").length, uncertain: topics.filter((t) => t.status === "uncertain").length, pending: topics.filter((t) => t.status === "pending").length },
      hostS: Math.round(hostOnlyMs / 100) / 10, modelCalls: calls.length, promptTokens: calls.reduce((s, c) => s + c.promptTokens, 0),
      estModelS: Math.round(modelS), estTotalS: Math.round(hostOnlyMs / 1000 + modelS), byOp });
    const r = rows.at(-1);
    console.log(`${r.id} ${r.chars} chars: ${r.filing}${r.error ? ` ERROR ${r.error}` : ""} · passes ${r.passes} · calls ${r.modelCalls} (${Object.entries(r.byOp).map(([k, v]) => `${k} ${v.calls}`).join(", ")}) · prompt ${r.promptTokens} tok · host ${r.hostS} s · est. total ${r.estTotalS} s`);
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const summary = { label: opt("label") ?? null, latencyScale: scale, notes: rows.length, modelCalls: sum("modelCalls"), promptTokens: sum("promptTokens"),
    hostS: Math.round(sum("hostS") * 10) / 10, estModelS: sum("estModelS"), estTotalS: sum("estTotalS"),
    callsPerNote: Math.round(sum("modelCalls") / rows.length * 10) / 10, promptTokensPerNote: Math.round(sum("promptTokens") / rows.length) };
  console.log(JSON.stringify(summary));
  const out = opt("out");
  if (out) writeFileSync(out, JSON.stringify({ summary, modelRate: MODEL_RATE, rows }, null, 1));
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(2); });
