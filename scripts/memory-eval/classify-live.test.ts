import { readFile, writeFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createBrainLlm } from "../../packages/core/src/llm/aisdk.js";
import { JevClient, assembleClassification } from "../../packages/core/src/llm/jev.js";
import { classificationSourceUnits } from "../../packages/core/src/llm/classificationSourceUnits.js";
import type { Classification, ClassifyInput, PageIndexEntry, SourcePassage } from "../../packages/core/src/llm/types.js";

/**
 * Live classify-accuracy eval. CLASSIFY ONLY: both sides run the classify step
 * and are scored on the classify decision (destination page set + disposition
 * set). Compose, retrieval and the answer loop are out of scope.
 *
 * The incumbent side is the real production classifier (`createBrainLlm` →
 * `classify`, i.e. the production prompt and schema). The Jev side is the real
 * Jev client, scored raw so accuracy is visible before the confidence gate, plus
 * the auto-filed subset that the gate would actually accept.
 *
 * Gated: only runs when JEV_EVAL_LIVE=1, so it never fires in a normal test run.
 */

const FIXTURE = new URL("./classify-fixture.json", import.meta.url);
const LIVE = process.env.JEV_EVAL_LIVE === "1";
const INCUMBENT_MODEL = process.env.JEV_EVAL_INCUMBENT_MODEL ?? "openai/gpt-5.6-luna";
const GATE = Number(process.env.JEV_EVAL_GATE ?? "0.75");

interface FixturePage { path: string; type: string; tags: string[]; title: string; summary: string }
interface FixtureCase {
  id: string;
  category: string;
  content: string;
  expected: Array<{ page: string | null; disposition: string }>;
}
interface Fixture { version: string; suite: string; note: string; trials: number; tagVocabulary: string[]; pages: FixturePage[]; cases: FixtureCase[] }

const fixture: Fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
const catalogPages: PageIndexEntry[] = fixture.pages.map((p) => ({ path: p.path, type: p.type, tags: p.tags, title: p.title, summary: p.summary }));

function classifyInput(entry: FixtureCase): ClassifyInput {
  // One owned passage, exactly as the engine presents a single capture window.
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

/** Flatten a Classification into the two things classify is scored on. */
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

describe.skipIf(!LIVE)("classify accuracy (live)", () => {
  it("scores incumbent vs jev on the frozen fixture", async () => {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const typesafeKey = process.env.TYPESAFE_API_KEY;
    expect(openrouterKey, "OPENROUTER_API_KEY is required").toBeTruthy();
    expect(typesafeKey, "TYPESAFE_API_KEY is required").toBeTruthy();

    const incumbent = createBrainLlm({ provider: "openrouter", apiKey: openrouterKey!, classifyModel: INCUMBENT_MODEL });
    const jev = new JevClient({ apiKey: typesafeKey! });

    const rows: any[] = [];
    for (let trial = 0; trial < fixture.trials; trial++) {
      for (const entry of fixture.cases) {
        const input = classifyInput(entry);

        // --- incumbent (real production classify) ---
        const t0 = performance.now();
        let inc: any = { status: "ok" };
        try { inc.actual = await incumbent.classify(structuredClone(input)); }
        catch (error) { inc = { status: "error", error: (error as Error).message }; }
        const incMs = Math.round(performance.now() - t0);
        const incScore = inc.actual ? score(inc.actual, entry.expected) : null;

        // --- jev (raw, scored before the gate) ---
        const t1 = performance.now();
        let jevRow: any = { status: "ok" };
        try {
          const verdict = await jev.classify(structuredClone(input));
          const assembled = assembleClassification(input, verdict);
          // Same decline rules as withJevClassify: the fast path only serves a
          // confident, single-proposition, contract-complete decision.
          const routed = Boolean(assembled) && verdict.confidence >= GATE && verdict.multiplePropositions < 0.5;
          jevRow = { status: assembled ? "ok" : "incomplete", verdict, actual: assembled?.classification ?? null, routed };
        } catch (error) {
          jevRow = { status: "error", error: (error as Error).message, routed: false };
        }
        const jevMs = Math.round(performance.now() - t1);
        const jevScore = jevRow.actual ? score(jevRow.actual, entry.expected) : null;

        rows.push({
          trial, id: entry.id, category: entry.category,
          expected: entry.expected,
          incumbent: { ...inc, ms: incMs, score: incScore },
          jev: { ...jevRow, ms: jevMs, score: jevScore, confidence: jevRow.verdict?.confidence ?? null },
        });
        console.log(
          `${trial} ${entry.id} ${entry.category.padEnd(16)} ` +
          `incumbent=${incScore ? (incScore.correct ? "PASS" : `FAIL(${incScore.gotPages.join(",") || "-"}|${incScore.gotDisp.join(",")})`) : inc.status} ` +
          `jev=${jevScore ? (jevScore.correct ? "PASS" : `FAIL(${jevScore.gotPages.join(",") || "-"}|${jevScore.gotDisp.join(",")})`) : jevRow.status}` +
          `${jevRow.verdict ? ` conf=${jevRow.verdict.confidence.toFixed(2)}` : ""}`,
        );
      }
    }

    const summarise = (pick: (r: any) => any) => {
      const scored = rows.filter((r) => pick(r)?.score);
      const correct = scored.filter((r) => pick(r).score.correct).length;
      const pagesOk = scored.filter((r) => pick(r).score.pagesOk).length;
      const dispOk = scored.filter((r) => pick(r).score.dispOk).length;
      const lat = scored.map((r) => pick(r).ms).sort((a, b) => a - b);
      return {
        attempts: rows.length,
        scored: scored.length,
        errors: rows.length - scored.length,
        correct, total: scored.length,
        pagesOk, dispOk,
        p50: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      };
    };

    const incumbentSummary = summarise((r) => r.incumbent);
    const jevSummary = summarise((r) => r.jev);
    // Only the items the gate would actually auto-file.
    const gated = rows.filter((r) => r.jev.routed && r.jev.score);
    const jevGated = {
      autoFiled: gated.length,
      of: rows.length,
      correct: gated.filter((r) => r.jev.score.correct).length,
      total: gated.length,
    };
    // Production combination: Jev where it routes, incumbent everywhere else.
    const combinedRows = rows.filter((r) => r.incumbent.score && (r.jev.routed ? r.jev.score : true));
    const combined = {
      correct: combinedRows.filter((r) => (r.jev.routed ? r.jev.score.correct : r.incumbent.score.correct)).length,
      total: rows.length,
      jevShare: Math.round((100 * gated.length) / rows.length),
    };

    const report = { suite: fixture.suite, fixtureVersion: fixture.version, model: INCUMBENT_MODEL, gate: GATE, incumbent: incumbentSummary, jev: jevSummary, jevGated, combined, rows };
    const out = new URL("./classify-results.json", import.meta.url);
    await writeFile(out, JSON.stringify(report, null, 2));

    console.log("\n================ CLASSIFY ACCURACY ================");
    console.log(`fixture ${fixture.version} · ${fixture.cases.length} cases × ${fixture.trials} trials`);
    console.log(`${"".padEnd(12)}${"correct".padStart(10)}${"pages".padStart(8)}${"disp".padStart(8)}${"errors".padStart(8)}${"p50 ms".padStart(9)}`);
    const line = (name: string, s: any) => console.log(`${name.padEnd(12)}${`${s.correct}/${s.total}`.padStart(10)}${`${s.pagesOk}/${s.total}`.padStart(8)}${`${s.dispOk}/${s.total}`.padStart(8)}${String(s.errors).padStart(8)}${String(s.p50).padStart(9)}`);
    line("incumbent", incumbentSummary);
    line("jev (raw)", jevSummary);
    console.log(`jev behind the ${GATE} gate: ${jevGated.correct}/${jevGated.total} correct on ${jevGated.autoFiled}/${jevGated.of} auto-filed`);
    console.log(`COMBINED (jev where it routes, incumbent otherwise): ${combined.correct}/${combined.total} correct, jev carries ${combined.jevShare}% of items`);

    console.log("\nper-category (raw):");
    const cats = [...new Set(rows.map((r) => r.category))];
    for (const cat of cats) {
      const rs = rows.filter((r) => r.category === cat);
      const i = rs.filter((r) => r.incumbent.score?.correct).length;
      const j = rs.filter((r) => r.jev.score?.correct).length;
      console.log(`  ${cat.padEnd(18)} incumbent ${i}/${rs.length}   jev ${j}/${rs.length}`);
    }
    console.log(`\nartifacts: ${out.pathname}`);
  }, 600_000);
});
