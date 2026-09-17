import { readFile, writeFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createBrainLlm } from "../../packages/core/src/llm/aisdk.js";
import { JevClient, assembleClassification } from "../../packages/core/src/llm/jev.js";
import type { Classification, ClassifyInput, PageIndexEntry, SourcePassage } from "../../packages/core/src/llm/types.js";

/**
 * Live classify-accuracy eval. CLASSIFY ONLY: both sides run the classify step
 * and are scored on the classify decision (destination page set + disposition
 * set). Compose, retrieval and the answer loop are out of scope.
 *
 * The incumbent side is the real production classifier (`createBrainLlm` →
 * `classify`, i.e. the production prompt and schema). The Jev side is the real
 * Jev client, scored raw plus the auto-filed subset the confidence gate accepts.
 *
 * A hard budget cap stops the run before the provider balance is exhausted;
 * a stopped run is reported as incomplete with its real denominator, never as a
 * pass over a reduced one.
 *
 * Gated: only runs when JEV_EVAL_LIVE=1, so it never fires in a normal test run.
 */

const FIXTURE = new URL("./classify-fixture.json", import.meta.url);
const LIVE = process.env.JEV_EVAL_LIVE === "1";
const INCUMBENT_MODEL = process.env.JEV_EVAL_INCUMBENT_MODEL ?? "openai/gpt-5.6-luna";
/** Route the incumbent through an OpenAI-compatible gateway (e.g. opencode-go) instead of OpenRouter. */
const INCUMBENT_BASE_URL = process.env.JEV_EVAL_BASE_URL;
const INCUMBENT_API_KEY = process.env.JEV_EVAL_API_KEY ?? process.env.OPENROUTER_API_KEY;
/** JSON object of extra gateway headers, e.g. {"x-opencode-session":"..."}. */
const INCUMBENT_HEADERS: Record<string, string> | undefined = (() => {
  if (!process.env.JEV_EVAL_HEADERS) return undefined;
  try { return JSON.parse(process.env.JEV_EVAL_HEADERS) as Record<string, string>; } catch { return undefined; }
})();
/** "responses" for gateways that serve a model only on the Responses API. */
const INCUMBENT_API_FORMAT = process.env.JEV_EVAL_API_FORMAT === "responses" ? "responses" as const : undefined;
const GATE = Number(process.env.JEV_EVAL_GATE ?? "0.75");
const RUNS = Number(process.env.JEV_EVAL_RUNS ?? "1");
const TRIALS = process.env.JEV_EVAL_TRIALS ? Number(process.env.JEV_EVAL_TRIALS) : null;
const LIMIT = process.env.JEV_EVAL_LIMIT ? Number(process.env.JEV_EVAL_LIMIT) : null;
const BUDGET = Number(process.env.JEV_EVAL_BUDGET_USD ?? "0.20");
const JEV_RETRIES = Number(process.env.JEV_EVAL_JEV_RETRIES ?? "3");
/** Published rates for the incumbent model; used only to estimate spend locally. */
const RATE_IN = Number(process.env.JEV_EVAL_INPUT_RATE ?? "0.2");
const RATE_OUT = Number(process.env.JEV_EVAL_OUTPUT_RATE ?? "1.2");

interface FixturePage { path: string; type: string; tags: string[]; title: string; summary: string }
interface FixtureCase { id: string; category: string; content: string; expected: Array<{ page: string | null; disposition: string }> }
interface Fixture { version: string; suite: string; trials: number; tagVocabulary: string[]; pages: FixturePage[]; cases: FixtureCase[] }

const fixture: Fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
const cases = LIMIT ? fixture.cases.slice(0, LIMIT) : fixture.cases;
const trials = TRIALS ?? fixture.trials;
const catalogPages: PageIndexEntry[] = fixture.pages.map((p) => ({ path: p.path, type: p.type, tags: p.tags, title: p.title, summary: p.summary }));

function classifyInput(entry: FixtureCase): ClassifyInput {
  const passages: SourcePassage[] = [{ id: "p0", start: 0, end: entry.content.length, text: entry.content }];
  return {
    content: entry.content,
    hints: [],
    pageIndex: catalogPages,
    tagVocabulary: fixture.tagVocabulary,
    sourcePassages: passages,
    sourceRange: { start: 0, end: entry.content.length },
  };
}

function decisionOf(c: Classification): { pages: Set<string>; dispositions: Set<string> } {
  const topics = c.topics ?? [{ ...c, pages: c.pages }];
  const pages = new Set<string>();
  const dispositions = new Set<string>();
  for (const topic of topics) {
    dispositions.add(topic.disposition ?? "integrate_page");
    if (topic.disposition === "append_compact_note" || topic.disposition === "integrate_page") {
      for (const page of topic.pages ?? []) pages.add(page.action === "create" ? "@new" : page.path);
    }
  }
  return { pages, dispositions };
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

function score(actual: Classification, expected: FixtureCase["expected"]) {
  const got = decisionOf(actual);
  const wantPages = new Set(expected.map((e) => e.page).filter((p): p is string => p !== null));
  const wantDisp = new Set(expected.map((e) => e.disposition));
  const pagesOk = sameSet(got.pages, wantPages);
  const dispOk = sameSet(got.dispositions, wantDisp);
  return { pagesOk, dispOk, correct: pagesOk && dispOk, gotPages: [...got.pages], gotDisp: [...got.dispositions] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!LIVE)("classify accuracy (live)", () => {
  it("scores incumbent vs jev across repeated runs", async () => {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const typesafeKey = process.env.TYPESAFE_API_KEY;
    expect(INCUMBENT_API_KEY, "JEV_EVAL_API_KEY or OPENROUTER_API_KEY is required").toBeTruthy();
    expect(typesafeKey, "TYPESAFE_API_KEY is required").toBeTruthy();

    if (INCUMBENT_BASE_URL) console.log(`[route] incumbent via ${INCUMBENT_BASE_URL} (${INCUMBENT_MODEL})`);

    let spentUsd = 0;
    let calls = 0;
    let budgetStopped = false;
    const incumbent = createBrainLlm({
      // A custom gateway is plain OpenAI-compatible; without one, use OpenRouter.
      provider: INCUMBENT_BASE_URL ? "openai" : "openrouter",
      apiKey: INCUMBENT_API_KEY!,
      classifyModel: INCUMBENT_MODEL,
      ...(INCUMBENT_BASE_URL ? { baseUrl: INCUMBENT_BASE_URL } : {}),
      ...(INCUMBENT_HEADERS ? { headers: INCUMBENT_HEADERS } : {}),
      ...(INCUMBENT_API_FORMAT ? { apiFormat: INCUMBENT_API_FORMAT } : {}),
      onUsage: (report) => {
        // Report real provider cost where available; the SDK reports token counts,
        // so fall back to the published rate for the model.
        calls += 1;
        const cost = (report.inputTokens * RATE_IN + report.outputTokens * RATE_OUT) / 1_000_000;
        spentUsd += cost;
      },
    });
    const jev = new JevClient({ apiKey: typesafeKey! });

    const rows: any[] = [];
    const runSummaries: any[] = [];

    for (let run = 0; run < RUNS && !budgetStopped; run++) {
      for (let trial = 0; trial < trials && !budgetStopped; trial++) {
        for (const entry of cases) {
          if (spentUsd >= BUDGET) {
            budgetStopped = true;
            console.log(`\n[budget] stopping: spent $${spentUsd.toFixed(4)} of $${BUDGET}`);
            break;
          }
          const input = classifyInput(entry);

          const t0 = performance.now();
          let inc: any = { status: "ok" };
          try { inc.actual = await incumbent.classify(structuredClone(input)); }
          catch (error) { inc = { status: "error", error: (error as Error).message }; }
          const incMs = Math.round(performance.now() - t0);
          const incScore = inc.actual ? score(inc.actual, entry.expected) : null;

          const t1 = performance.now();
          let jevRow: any = { status: "ok" };
          let lastErr: unknown;
          for (let attempt = 0; attempt < JEV_RETRIES; attempt++) {
            try {
              const verdict = await jev.classify(structuredClone(input));
              const assembled = assembleClassification(input, verdict);
              const routed = Boolean(assembled) && verdict.confidence >= GATE && verdict.multiplePropositions < 0.5;
              jevRow = { status: assembled ? "ok" : "incomplete", verdict, actual: assembled?.classification ?? null, routed };
              lastErr = undefined;
              break;
            } catch (error) {
              lastErr = error;
              jevRow = { status: "error", error: (error as Error).message, routed: false };
              if (attempt < JEV_RETRIES - 1) await sleep(1000 * 2 ** attempt);
            }
          }
          if (lastErr) jevRow.status = "error";
          const jevMs = Math.round(performance.now() - t1);
          const jevScore = jevRow.actual ? score(jevRow.actual, entry.expected) : null;

          rows.push({
            run, trial, id: entry.id, category: entry.category, expected: entry.expected,
            incumbent: { ...inc, ms: incMs, score: incScore },
            jev: { ...jevRow, ms: jevMs, score: jevScore, confidence: jevRow.verdict?.confidence ?? null },
          });
          console.log(
            `${run}.${trial} ${entry.id} ${entry.category.padEnd(16)} ` +
            `inc=${incScore ? (incScore.correct ? "PASS" : `FAIL(${incScore.gotPages.join(",") || "-"}|${incScore.gotDisp.join(",")})`) : inc.status} ` +
            `jev=${jevScore ? (jevScore.correct ? "PASS" : `FAIL(${jevScore.gotPages.join(",") || "-"}|${jevScore.gotDisp.join(",")})`) : jevRow.status}` +
            `${jevRow.verdict ? ` conf=${jevRow.verdict.confidence.toFixed(2)} 2nd=${jevRow.verdict.multiplePropositions.toFixed(2)}` : ""}` +
            ` $${spentUsd.toFixed(4)}`,
          );
        }
      }
      const runRows = rows.filter((r) => r.run === run);
      const inc = runRows.filter((r) => r.incumbent.score);
      const jevA = runRows.filter((r) => r.jev.score);
      const gated = runRows.filter((r) => r.jev.routed && r.jev.score);
      runSummaries.push({
        run,
        attempts: runRows.length,
        incumbent: { correct: inc.filter((r) => r.incumbent.score.correct).length, total: inc.length },
        jevRaw: { correct: jevA.filter((r) => r.jev.score.correct).length, total: jevA.length },
        jevGated: { correct: gated.filter((r) => r.jev.score.correct).length, total: gated.length },
        combined: {
          correct: runRows.filter((r) => (r.jev.routed ? r.jev.score?.correct : r.incumbent.score?.correct)).length,
          total: runRows.length,
        },
        coveragePct: runRows.length ? Math.round((100 * gated.length) / runRows.length) : 0,
        spentUsd: Number(spentUsd.toFixed(4)),
      });
    }

    const spreadOf = (pick: (s: any) => { correct: number; total: number }) => {
      const vals = runSummaries.map((s) => {
        const v = pick(s);
        return v.total ? (100 * v.correct) / v.total : null;
      }).filter((v): v is number => v !== null);
      if (!vals.length) return null;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const min = Math.min(...vals), max = Math.max(...vals);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      return { meanPct: +mean.toFixed(1), minPct: +min.toFixed(1), maxPct: +max.toFixed(1), spreadPct: +(max - min).toFixed(1), sdPct: +sd.toFixed(1), runs: vals.length };
    };

    const incScores = rows.filter((r) => r.incumbent.score).map((r) => r.incumbent.score);
    const jevScores = rows.filter((r) => r.jev.score).map((r) => r.jev.score);
    const gatedRows = rows.filter((r) => r.jev.routed && r.jev.score);
    const lat = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s.length ? { p50: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)] } : null; };

    const report = {
      suite: fixture.suite, fixtureVersion: fixture.version, model: INCUMBENT_MODEL, gate: GATE,
      runs: RUNS, trials, cases: cases.length, budgetUsd: BUDGET, spentUsd: +spentUsd.toFixed(4),
      incumbentCalls: calls, complete: !budgetStopped,
      aggregate: {
        incumbent: { correct: incScores.filter((s) => s.correct).length, total: incScores.length, latency: lat(rows.filter((r) => r.incumbent.score).map((r) => r.incumbent.ms)) },
        jevRaw: { correct: jevScores.filter((s) => s.correct).length, total: jevScores.length, latency: lat(rows.filter((r) => r.jev.score).map((r) => r.jev.ms)) },
        jevGated: { correct: gatedRows.filter((r) => r.jev.score.correct).length, total: gatedRows.length, ofAttempts: rows.length },
        combined: { correct: rows.filter((r) => (r.jev.routed ? r.jev.score?.correct : r.incumbent.score?.correct)).length, total: rows.length },
      },
      runSummaries,
      spread: { incumbent: spreadOf((s) => s.incumbent), jevGated: spreadOf((s) => s.jevGated), combined: spreadOf((s) => s.combined) },
      rows,
    };
    await writeFile(new URL("./classify-results.json", import.meta.url), JSON.stringify(report, null, 2));

    const pct = (c: number, t: number) => (t ? `${((100 * c) / t).toFixed(1)}%` : "-");
    console.log("\n================ CLASSIFY ACCURACY ================");
    console.log(`fixture ${fixture.version} · ${cases.length} cases × ${trials} trials × ${RUNS} runs · gate ${GATE} · budget $${BUDGET}`);
    console.log(`incumbent calls ${calls} · spend $${spentUsd.toFixed(4)} · ${budgetStopped ? "STOPPED BY BUDGET (incomplete)" : "complete"}`);
    const a = report.aggregate;
    console.log(`\n${"".padEnd(14)}${"correct".padStart(10)}${"pct".padStart(8)}${"p50 ms".padStart(9)}`);
    console.log(`${"incumbent".padEnd(14)}${`${a.incumbent.correct}/${a.incumbent.total}`.padStart(10)}${pct(a.incumbent.correct, a.incumbent.total).padStart(8)}${String(a.incumbent.latency?.p50).padStart(9)}`);
    console.log(`${"jev (raw)".padEnd(14)}${`${a.jevRaw.correct}/${a.jevRaw.total}`.padStart(10)}${pct(a.jevRaw.correct, a.jevRaw.total).padStart(8)}${String(a.jevRaw.latency?.p50).padStart(9)}`);
    console.log(`${"jev (gated)".padEnd(14)}${`${a.jevGated.correct}/${a.jevGated.total}`.padStart(10)}${pct(a.jevGated.correct, a.jevGated.total).padStart(8)}   covers ${pct(a.jevGated.ofAttempts - (rows.length - gatedRows.length), rows.length)}`);
    console.log(`${"combined".padEnd(14)}${`${a.combined.correct}/${a.combined.total}`.padStart(10)}${pct(a.combined.correct, a.combined.total).padStart(8)}`);

    console.log("\nper-run:");
    for (const s of runSummaries) {
      console.log(`  run ${s.run}: incumbent ${pct(s.incumbent.correct, s.incumbent.total)}  jev gated ${pct(s.jevGated.correct, s.jevGated.total)} (cov ${s.coveragePct}%)  combined ${pct(s.combined.correct, s.combined.total)}`);
    }
    console.log("\nrun-to-run spread:");
    for (const [name, sp] of Object.entries(report.spread)) {
      if (sp) console.log(`  ${name.padEnd(10)} mean ${sp.meanPct}%  min ${sp.minPct}%  max ${sp.maxPct}%  spread ${sp.spreadPct}pp  sd ${sp.sdPct}pp  (${sp.runs} runs)`);
    }

    const cats = [...new Set(rows.map((r) => r.category))];
    console.log("\nper-category (all rows):");
    for (const cat of cats) {
      const rs = rows.filter((r) => r.category === cat);
      const i = rs.filter((r) => r.incumbent.score?.correct).length;
      const j = rs.filter((r) => r.jev.score?.correct).length;
      const g = rs.filter((r) => r.jev.routed).length;
      console.log(`  ${cat.padEnd(18)} incumbent ${i}/${rs.length}   jev ${j}/${rs.length}   jev-routed ${g}`);
    }
  }, 3_600_000);
});
