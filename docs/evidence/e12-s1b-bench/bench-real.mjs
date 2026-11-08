// E12-S1b round 2: accuracy on real questions. Runs each question through the cloud chat's answer
// path (streamAnswerFromMemory) on the built code of a checkout, over a read-only copy of a vault,
// then a judge model grades the answer against the expected answer and the source notes:
// correct / partly / wrong / no_answer, with the cause. Private rows stay outside the repo.
//
// usage: node bench-real.mjs <checkout> <vault dir> <questions.jsonl> <out.json> [model]
// env: BENCH_BASE_URL (OpenAI-compatible base URL; a localhost relay that adds the key),
//      BENCH_JUDGE (judge model, default anthropic/claude-sonnet-5.5), BENCH_ONLY (comma ids)
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, vaultSrc, questionsFile, outFile, model] = process.argv.slice(2);
const core = await import(pathToFileURL(join(checkout, "packages/core/dist/index.js")).href);
const chat = await import(pathToFileURL(join(checkout, "packages/server/dist/memoryChat.js")).href);
const { rankMemories } = await import(pathToFileURL(join(checkout, "packages/server/dist/rankedMemory.js")).href);
const baseUrl = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:18978/api/v1";
const judgeModel = process.env.BENCH_JUDGE ?? "anthropic/claude-sonnet-5.5";

const dir = mkdtempSync(join(tmpdir(), "s1b2-bench-"));
const bare = join(dir, "origin.git");
const seed = join(dir, "seed");
cpSync(vaultSrc, seed, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
git(seed, "init", "-q", "-b", "main");
git(seed, "-c", "core.hooksPath=/dev/null", "-c", "user.email=bench@example.invalid", "-c", "user.name=bench", "add", "-A");
git(seed, "-c", "core.hooksPath=/dev/null", "-c", "user.email=bench@example.invalid", "-c", "user.name=bench", "commit", "-q", "-m", "vault copy");
execFileSync("git", ["clone", "-q", "--bare", seed, bare]);

const usage = [];
const llm = core.createBrainLlm({
  provider: "openrouter", apiKey: "relay-adds-the-key", baseUrl,
  ...(model ? { askModel: model, chatModel: model } : {}),
  onUsage: (report) => usage.push(report),
});
const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: bare });
const engine = core.createEngine({ repo, llm, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "bench" } });
await engine.rebuildMemoryIndex();

const only = process.env.BENCH_ONLY ? new Set(process.env.BENCH_ONLY.split(",")) : null;
const questions = readFileSync(questionsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((q) => !only || only.has(q.id));

/** The source notes the expected answer comes from, so the judge can check facts itself. */
function sourceText(ref) {
  const [file, anchor] = ref.split("#^");
  const body = readFileSync(join(vaultSrc, file), "utf8");
  if (!anchor) return body.slice(0, 4000);
  const start = body.search(new RegExp(`^## .*\\^${anchor}\\s*$`, "m"));
  if (start < 0) return "";
  const next = body.slice(start + 1).search(/^## /m);
  return body.slice(start, next < 0 ? body.length : start + 1 + next).slice(0, 6000);
}

const JUDGE = `You grade an answer that a memory app gave to its user, from the user's own notes.
Grade against the EXPECTED answer and the SOURCE notes (the truth). Labels:
- correct: answers the question right and covers the main points of the expected answer.
- partly: right but clearly incomplete (misses main points), or mixes a right answer with a wrong detail.
- wrong: answers something else, states a wrong fact, or picks the wrong note/time.
- no_answer: the app declined or said it has no confident answer.
Cause (one): ok | retrieval_missed (the right note was not among the notes the app read) | wrong_note_first (the app read the right note but answered from another) | misread (had the right note, got the facts wrong) | too_thin (had the right note, answer too short or vague) | time_not_handled (a time/date question answered without regard to the date) | aggregation (needs many notes; the app saw too few) | declined_wrongly (the right note was there but the app declined or its check failed).
Reply with JSON only: {"label": "...", "cause": "...", "why": "<one short sentence>"}`;

async function judge(q, answer, answered, readPaths) {
  const sources = q.refs.map((r) => `--- ${r}\n${sourceText(r)}`).join("\n\n");
  const prompt = `QUESTION (asked ${q.asOf?.at ?? "2026-11-08T16:00Z"}): ${q.question}\n\nEXPECTED: ${q.expected}\n\nSOURCE NOTES:\n${sources}\n\nNOTES THE APP READ (paths): ${readPaths.join(", ")}\nTHE SOURCE NOTES WERE AMONG THEM: ${q.refs.some((r) => readPaths.some((p) => p === r || p.startsWith(r.split("#")[0] + "#") && p === r)) ? "yes" : "no"}\n\nAPP ${answered ? "ANSWER" : "SAID (not shown as an answer)"}:\n${answer}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: judgeModel, temperature: 0, max_tokens: 800, messages: [{ role: "system", content: JUDGE }, { role: "user", content: prompt }] }) });
    const body = await res.json().catch(() => null);
    const text = body?.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch { /* retry */ }
    console.error(`judge reply not JSON (${res.status}): ${text.slice(0, 200) || JSON.stringify(body).slice(0, 200)}`);
  }
  return { label: "unjudged", cause: "unjudged", why: "judge failed" };
}

const rows = [];
for (const q of questions) {
  const before = usage.length;
  const started = performance.now();
  let firstMs = null;
  let result;
  let error = null;
  try {
    result = await chat.streamAnswerFromMemory(engine, q.question, { onText: (d) => { if (d.trim()) firstMs ??= performance.now() - started; } });
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const fullMs = performance.now() - started;
  const ranked = await rankMemories(engine, q.question, 20);
  const read = result?.contextPaths ?? ranked.results.slice(0, 8).map((m) => m.path);
  const rankOf = (ref) => { const i = ranked.results.findIndex((m) => m.path === ref); return i < 0 ? null : i + 1; };
  const answer = result?.answer ?? `(error) ${error}`;
  const readPaths = read;
  const verdict = process.env.BENCH_NOJUDGE ? { label: result?.answered ? "unjudged" : "no_answer", cause: null, why: null }
    : result?.answered === false && !result?.answer?.trim() ? { label: "no_answer" } : await judge(q, answer, Boolean(result?.answered), read);
  const calls = usage.slice(before);
  rows.push({
    id: q.id, kind: q.kind, q: q.question, answered: Boolean(result?.answered), answer, label: result?.answered ? verdict.label : "no_answer",
    judgeLabel: verdict.label, cause: verdict.cause, why: verdict.why,
    refRanks: Object.fromEntries(q.refs.map((r) => [r, rankOf(r)])), readCount: read.length, cited: (result?.memories ?? []).filter((m) => m.cited).map((m) => m.path),
    keywordOk: (q.expect ?? []).filter((g) => g.some((w) => answer.toLowerCase().includes(w.toLowerCase()))).length >= (q.minGroups ?? (q.expect ?? []).length),
    firstMs: Math.round(firstMs ?? fullMs), fullMs: Math.round(fullMs), calls: calls.length,
    inputTokens: calls.reduce((s, c) => s + c.inputTokens + c.cachedInputTokens, 0), outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
    costUsd: calls.reduce((s, c) => s + (c.providerCostUsd ?? 0), 0), model: calls[0]?.model ?? null, error,
  });
  const r = rows.at(-1);
  console.log(`${r.label.padEnd(9)} ${r.cause ?? ""} first ${(r.firstMs / 1000).toFixed(1)}s full ${(r.fullMs / 1000).toFixed(1)}s ${q.id}`);
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const count = (k) => rows.filter((r) => r.label === k).length;
const summary = {
  n: rows.length, model: rows.find((r) => r.model)?.model ?? model ?? "default", judge: judgeModel,
  correct: count("correct"), partly: count("partly"), wrong: count("wrong"), noAnswer: count("no_answer"),
  causes: rows.reduce((acc, r) => (r.label !== "correct" ? { ...acc, [r.cause]: (acc[r.cause] ?? 0) + 1 } : acc), {}),
  firstP50: pct(rows.map((r) => r.firstMs), 50), firstP95: pct(rows.map((r) => r.firstMs), 95),
  fullP50: pct(rows.map((r) => r.fullMs), 50), fullP95: pct(rows.map((r) => r.fullMs), 95),
  costPerAnswerUsd: rows.reduce((s, r) => s + r.costUsd, 0) / rows.length,
};
writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
process.exit(0);
