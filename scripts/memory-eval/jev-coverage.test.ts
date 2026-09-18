import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { JevClient, assembleClassification, type JevVerdict } from "../../packages/core/src/llm/jev.js";
import type { Classification, ClassifyInput, PageIndexEntry, SourcePassage } from "../../packages/core/src/llm/types.js";

/**
 * Coverage + accuracy loop for the Jev fast path, run against the frozen
 * synthetic classify fixture. Jev only — no incumbent calls — so this is cheap
 * enough to iterate on the question design and the gate between deploys.
 *
 * The number that matters is COVERAGE: the share of memories the fast path
 * handles itself rather than escalating. Accuracy is reported only over the
 * routed subset, because that is the only place a wrong answer can escape.
 *
 *   JEV_COVERAGE=1 npx vitest run scripts/memory-eval/jev-coverage.test.ts
 *   JEV_GATE=0.6 JEV_COVERAGE=1 npx vitest run ...   # sweep the threshold
 */

const LIVE = process.env.JEV_COVERAGE === "1";
const GATE = Number(process.env.JEV_GATE ?? "0.5");
/** Declining a genuine multi-page capture is correct (one Choice cannot name two
 *  destinations); declining a single-page one costs coverage for nothing. This
 *  floor is therefore tuned, not fixed. Default matches JEV_MULTI_TOPIC_FLOOR. */
const MULTI_FLOOR = Number(process.env.JEV_MULTI_FLOOR ?? "0.8");
const FIXTURE = new URL("./classify-fixture.json", import.meta.url);

interface FixtureCase { id: string; category: string; content: string; expected: Array<{ page: string | null; disposition: string }> }
interface Fixture { version: string; tagVocabulary: string[]; pages: Array<{ path: string; type: string; tags: string[]; title: string; summary: string }>; cases: FixtureCase[] }

const fixture: Fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
const catalog: PageIndexEntry[] = fixture.pages.map((p) => ({ path: p.path, type: p.type, tags: p.tags, title: p.title, summary: p.summary }));

function inputFor(entry: FixtureCase): ClassifyInput {
  const passages: SourcePassage[] = [{ id: "p0", start: 0, end: entry.content.length, text: entry.content }];
  return { content: entry.content, hints: [], pageIndex: catalog, tagVocabulary: fixture.tagVocabulary, sourcePassages: passages, sourceRange: { start: 0, end: entry.content.length } };
}

function decisionOf(c: Classification): { pages: Set<string>; dispositions: Set<string> } {
  const topics = c.topics ?? [{ ...c, pages: c.pages }];
  const pages = new Set<string>(); const dispositions = new Set<string>();
  for (const t of topics) {
    dispositions.add(t.disposition ?? "integrate_page");
    if (t.disposition === "append_compact_note" || t.disposition === "integrate_page") {
      for (const p of t.pages ?? []) pages.add(p.action === "create" ? "@new" : p.path);
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

describe.skipIf(!LIVE)("jev coverage loop", () => {
  it(`gate ${GATE}: coverage and accuracy on the frozen fixture`, async () => {
    const key = process.env.TYPESAFE_API_KEY;
    expect(key, "TYPESAFE_API_KEY required").toBeTruthy();
    const jev = new JevClient({ apiKey: key! });

    type Row = { id: string; category: string; verdict: JevVerdict | null; routed: boolean; reason: string; correct: boolean | null; pages: string[]; wanted: string[] };
    const rows: Row[] = [];

    for (const entry of fixture.cases) {
      const input = inputFor(entry);
      let verdict: JevVerdict | null = null;
      try { verdict = await jev.classify(structuredClone(input)); } catch { verdict = null; }
      if (!verdict) { rows.push({ id: entry.id, category: entry.category, verdict: null, routed: false, reason: "unavailable", correct: null, pages: [], wanted: [] }); continue; }
      const assembled = assembleClassification(input, verdict);
      const reason = !assembled ? "incomplete"
        : verdict.confidence < GATE ? "low_confidence"
        : verdict.multiplePropositions >= MULTI_FLOOR ? "multi_page"
        : "routed";
      const routed = reason === "routed";
      const s = assembled ? score(assembled.classification, entry.expected) : null;
      rows.push({ id: entry.id, category: entry.category, verdict, routed, reason,
        correct: s ? s.correct : null, pages: s?.gotPages ?? [], wanted: entry.expected.map((e) => e.page ?? "-") });
    }

    const routed = rows.filter((r) => r.routed);
    const correct = routed.filter((r) => r.correct).length;
    const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

    console.log(`\n=== JEV COVERAGE (gate ${GATE}, multi-page floor ${MULTI_FLOOR}) ===`);
    console.log(`cases ${rows.length}   routed ${routed.length} (${pct(routed.length, rows.length)})   declined ${rows.length - routed.length}`);
    console.log(`routed accuracy ${correct}/${routed.length} (${pct(correct, routed.length)})`);
    const byReason = new Map<string, number>();
    for (const r of rows) if (!r.routed) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    console.log(`declines: ${[...byReason.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);

    console.log("\nper-category (routed / total, correct):");
    for (const cat of [...new Set(rows.map((r) => r.category))].sort()) {
      const rs = rows.filter((r) => r.category === cat);
      const rt = rs.filter((r) => r.routed);
      const ok = rt.filter((r) => r.correct).length;
      console.log(`  ${cat.padEnd(18)} ${String(rt.length).padStart(2)}/${String(rs.length).padEnd(2)} routed   ${ok}/${rt.length} correct`);
    }
    const wrong = routed.filter((r) => !r.correct);
    if (wrong.length) {
      console.log("\nwrong while routed:");
      for (const w of wrong) console.log(`  ${w.id} ${w.category.padEnd(16)} got=${w.pages.join(",") || "-"} want=${w.wanted.join(",")}`);
    }
  }, 1_800_000);
});
