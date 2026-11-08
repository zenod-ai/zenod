// E15-Q1: score Zenod's memory answers against a set of real-life questions with expected answers.
// The set is JSON lines: {id, question, expected, refs: ["Log/<day>.md#^e-xxxxxx", ...], expect: [[word, ...], ...], minGroups}.
// A person's own set stays private next to their vault; demo-questions.jsonl here runs on the made-up demo vault.
//
// Two scores per question:
//   retrieval  one of the five memories shown is a source note itself or a page that cites it (no model, free)
//   answer     the checked answer carries at least minGroups of the expected word groups
//
// usage:
//   node run.mjs chat <checkout> <vault dir> <questions.jsonl> <out.json> [--retrieval-only]
//        the cloud chat's own answer path (streamAnswerFromMemory) on the built code of a checkout, over a
//        throwaway copy of the vault. Needs an OpenRouter key on stdin unless --retrieval-only.
//   node run.mjs ask <checkout> <vault dir> <questions.jsonl> <out.json>
//        the MCP ask_brain path (engine.ask, the read-only research loop) the same way; key on stdin.
//   node run.mjs score <vault dir> <questions.jsonl> <answers.json> <out.json>
//        scores answers captured elsewhere (e.g. live MCP ask_brain + search_memory):
//        answers.json = [{id, answer, answered?, memories: [{path}]}]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [mode, ...args] = process.argv.slice(2);
// A question the person would have given up on counts as unanswered (env EVAL_ASK_TIMEOUT_S, default 180).
const ASK_TIMEOUT_MS = Number(process.env.EVAL_ASK_TIMEOUT_S ?? 180) * 1000;
const readSet = (file) => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// Which pages cite a note: a page file that contains the note's anchor (e-xxxxxx). Built once per vault.
function citingIndex(vault) {
  const out = new Map();
  let files = [];
  try {
    files = execFileSync("grep", ["-rlE", "\\^?e-[0-9a-f]{6}", "--include=*.md", "--exclude-dir=.git", "--exclude-dir=Log", vault], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
  } catch { files = []; }
  for (const file of files) {
    const rel = file.slice(vault.length + 1);
    for (const m of readFileSync(file, "utf8").matchAll(/e-[0-9a-f]{6}/g)) {
      if (!out.has(m[0])) out.set(m[0], new Set());
      out.get(m[0]).add(rel.replace(/\.md$/, ""));
    }
  }
  return out;
}

const anchor = (ref) => ref.match(/e-[0-9a-f]{6}/)?.[0] ?? null;
const notePath = (p) => String(p ?? "").replace(/\.md(?=#|$)/, "").replace(/^\/+/, "");

function scoreOne(item, result, citing) {
  const text = (result.answer ?? "").toLowerCase();
  const groups = item.expect ?? [];
  const hits = groups.map((g) => g.some((w) => text.includes(String(w).toLowerCase())));
  const need = item.minGroups ?? groups.length;
  const answerOk = result.answered !== false && hits.filter(Boolean).length >= need;
  const top5 = (result.memories ?? []).slice(0, 5).map((m) => notePath(m.path));
  const wanted = new Set();
  for (const ref of item.refs ?? []) {
    wanted.add(notePath(ref));
    for (const page of citing.get(anchor(ref)) ?? []) wanted.add(page);
  }
  const retrievalHits = top5.filter((p) => wanted.has(p) || [...wanted].some((w) => w.includes("#^") && p.includes("#^") && anchor(w) === anchor(p)));
  return {
    id: item.id, question: item.question,
    answered: result.answered !== false, answerOk, groupsHit: hits.filter(Boolean).length, groupsNeeded: need,
    retrievalOk: retrievalHits.length > 0, top5, error: result.error ?? null,
    ms: result.ms ?? null, answer: (result.answer ?? "").slice(0, 1200),
  };
}

function summarise(rows) {
  const n = rows.length;
  return {
    n,
    answerOk: rows.filter((r) => r.answerOk).length,
    retrievalOk: rows.filter((r) => r.retrievalOk).length,
    answered: rows.filter((r) => r.answered).length,
    both: rows.filter((r) => r.answerOk && r.retrievalOk).length,
  };
}

if (mode === "score") {
  const [vault, setFile, answersFile, outFile] = args;
  const set = readSet(setFile);
  const answers = new Map(JSON.parse(readFileSync(answersFile, "utf8")).map((a) => [a.id, a]));
  const citing = citingIndex(vault);
  const rows = set.map((item) => scoreOne(item, answers.get(item.id) ?? { answered: false, answer: "", memories: [], error: "no answer captured" }, citing));
  const summary = summarise(rows);
  writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary));
} else if (mode === "chat" || mode === "ask") {
  const [checkout, vaultSrc, setFile, outFile] = args;
  const retrievalOnly = args.includes("--retrieval-only");
  const apiKey = retrievalOnly ? "unused" : readFileSync(0, "utf8").trim();
  if (!apiKey) throw new Error("an OpenRouter key on stdin is required (or --retrieval-only)");
  const core = await import(pathToFileURL(join(checkout, "packages/core/dist/index.js")).href);
  const chat = await import(pathToFileURL(join(checkout, "packages/server/dist/memoryChat.js")).href);
  const { rankMemories } = await import(pathToFileURL(join(checkout, "packages/server/dist/rankedMemory.js")).href);

  // A throwaway copy: the run never writes to the source vault or its remote.
  const dir = mkdtempSync(join(tmpdir(), "e15-eval-"));
  const seed = join(dir, "seed");
  cpSync(vaultSrc, seed, { recursive: true, filter: (p) => !p.endsWith("/.git") });
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore" });
  git(seed, "init", "-q", "-b", "main");
  git(seed, "-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "add", "-A");
  git(seed, "-c", "user.email=eval@example.invalid", "-c", "user.name=eval", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-verify", "-m", "eval copy");
  execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
  const usage = [];
  const llm = core.createBrainLlm({ provider: "openrouter", apiKey, user: "eval", onUsage: (r) => usage.push(r) });
  const repo = await core.VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
  const engine = core.createEngine({ repo, llm, state: new core.SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "eval" } });
  await engine.rebuildMemoryIndex();
  const citing = citingIndex(seed);

  const set = readSet(setFile);
  const rows = [];
  for (const item of set) {
    const started = performance.now();
    let result;
    try {
      result = mode === "ask"
        ? await Promise.race([engine.ask(item.question), new Promise((_, no) => setTimeout(() => no(new Error(`no answer within ${ASK_TIMEOUT_MS / 1000} s`)), ASK_TIMEOUT_MS).unref())]).then((a) => ({ answered: core.askNonAnswer(a.text) === null, answer: a.text, memories: (a.sources ?? []).map((s) => ({ path: s.path })) }))
        : retrievalOnly
        ? { answered: false, answer: "", memories: (await rankMemories(engine, item.question, 5)).results ?? [] }
        : await chat.streamAnswerFromMemory(engine, item.question, { onMemories: () => {}, onText: () => {} });
    } catch (e) {
      result = { answered: false, answer: "", memories: [], error: e instanceof Error ? e.message : String(e) };
    }
    result.ms = Math.round(performance.now() - started);
    const row = scoreOne(item, result, citing);
    rows.push(row);
    console.log(`${row.retrievalOk ? "R" : "-"}${row.answerOk ? "A" : "-"} ${(row.ms / 1000).toFixed(1)}s ${item.id} ${item.question}`);
  }
  const summary = { ...summarise(rows), mode, retrievalOnly, calls: usage.length, costUsd: +usage.reduce((s, c) => s + (c.providerCostUsd ?? 0), 0).toFixed(4) };
  writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(0);
} else {
  console.error("usage: node run.mjs chat|score ... (see the header)");
  process.exit(2);
}
