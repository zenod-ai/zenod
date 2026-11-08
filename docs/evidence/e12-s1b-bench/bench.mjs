// E12-S1b bench: the 20 demo questions through the cloud chat's answer path, on the built code of a
// checkout, over the made-up demo vault. Records time to the memories, to the first words and to the
// full answer, whether the answer is checked, and whether it carries the expected facts.
//
// usage: node bench.mjs <checkout> <vault src dir> <questions.json> <out.json> [model]
// env: BENCH_BASE_URL (OpenAI-compatible base URL; a localhost relay that adds the key), BENCH_RUNS (default 1),
//      BENCH_PATH=s1 replays S1's answer exactly (ranked memories next to the read-only ask loop, one retry
//      after a protocol slip, checked = the ask loop's own verdict) on the same build, for the before numbers.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [checkout, vaultSrc, questionsFile, outFile, model] = process.argv.slice(2);
const core = await import(pathToFileURL(join(checkout, "packages/core/dist/index.js")).href);
const chat = await import(pathToFileURL(join(checkout, "packages/server/dist/memoryChat.js")).href);
const { rankMemories } = await import(pathToFileURL(join(checkout, "packages/server/dist/rankedMemory.js")).href);
const s1 = process.env.BENCH_PATH === "s1";

const dir = mkdtempSync(join(tmpdir(), "s1b-bench-"));
const bare = join(dir, "origin.git");
const seed = join(dir, "seed");
cpSync(vaultSrc, seed, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
git(seed, "init", "-q", "-b", "main");
git(seed, "-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "add", "-A");
git(seed, "-c", "user.email=demo@example.invalid", "-c", "user.name=demo", "commit", "-q", "-m", "demo vault");
execFileSync("git", ["clone", "-q", "--bare", seed, bare]);

const usage = [];
const llm = core.createBrainLlm({
  provider: "openrouter",
  apiKey: "relay-adds-the-key",
  baseUrl: process.env.BENCH_BASE_URL ?? "http://127.0.0.1:18978/api/v1",
  ...(model ? { askModel: model, chatModel: model } : {}),
  onUsage: (report) => usage.push(report),
});
const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: bare });
const engine = core.createEngine({ repo, llm, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "demo" } });
await engine.rebuildMemoryIndex();

const questions = JSON.parse(readFileSync(questionsFile, "utf8"));
const runs = Number(process.env.BENCH_RUNS ?? 1);
const rows = [];
for (let run = 0; run < runs; run++) {
  for (const { q, expect } of questions) {
    const before = usage.length;
    const started = performance.now();
    let memoriesMs = null;
    let firstMs = null;
    let result;
    let error = null;
    try {
      if (s1) {
        // S1 (cd597ca) memoryChat.answerFromMemory: Promise.all([rankMemories(top 5), askOnce]).
        const askOnce = async () => { const a = await engine.ask(q); return core.askNonAnswer(a.text) === "retry" ? engine.ask(q) : a; };
        const [, answer] = await Promise.all([rankMemories(engine, q, 5).then((r) => { memoriesMs = performance.now() - started; return r; }), askOnce()]);
        result = { answered: core.askNonAnswer(answer.text) === null, answer: answer.text, memories: [] };
        memoriesMs = performance.now() - started; // S1 showed the memories only with the answer
      } else if (chat.streamAnswerFromMemory) {
        result = await chat.streamAnswerFromMemory(engine, q, {
          onMemories: () => { memoriesMs ??= performance.now() - started; },
          onText: (delta) => { if (delta.trim()) firstMs ??= performance.now() - started; },
        });
      } else {
        result = await chat.answerFromMemory(engine, q);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const fullMs = performance.now() - started;
    const text = result?.answer ?? "";
    const correct = Boolean(result?.answered) && expect.every((group) => group.some((word) => text.toLowerCase().includes(word.toLowerCase())));
    const calls = usage.slice(before);
    rows.push({
      run, q,
      memoriesMs: memoriesMs === null ? null : Math.round(memoriesMs),
      firstMs: Math.round(firstMs ?? fullMs),
      fullMs: Math.round(fullMs),
      answered: Boolean(result?.answered),
      correct,
      cited: result?.memories?.filter((m) => m.cited).length ?? 0,
      calls: calls.length,
      costUsd: calls.reduce((sum, c) => sum + (c.providerCostUsd ?? 0), 0),
      inputTokens: calls.reduce((sum, c) => sum + c.inputTokens + c.cachedInputTokens, 0),
      outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
      model: calls[0]?.model ?? null,
      error,
      answer: text.slice(0, 400),
    });
    const r = rows.at(-1);
    console.log(`${r.answered ? "✓" : "✗"}${r.correct ? "=" : " "} first ${(r.firstMs / 1000).toFixed(1)}s full ${(r.fullMs / 1000).toFixed(1)}s calls ${r.calls} ${q}`);
  }
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const summary = {
  n: rows.length,
  model: rows.find((r) => r.model)?.model ?? model ?? "default",
  firstP50: pct(rows.map((r) => r.firstMs), 50), firstP95: pct(rows.map((r) => r.firstMs), 95),
  fullP50: pct(rows.map((r) => r.fullMs), 50), fullP95: pct(rows.map((r) => r.fullMs), 95),
  checked: rows.filter((r) => r.answered).length / rows.length,
  correct: rows.filter((r) => r.correct).length / rows.length,
  callsPerAnswer: rows.reduce((s, r) => s + r.calls, 0) / rows.length,
  costPerAnswerUsd: rows.reduce((s, r) => s + r.costUsd, 0) / rows.length,
  inputTokensPerAnswer: Math.round(rows.reduce((s, r) => s + r.inputTokens, 0) / rows.length),
  outputTokensPerAnswer: Math.round(rows.reduce((s, r) => s + r.outputTokens, 0) / rows.length),
};
writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
process.exit(0);
