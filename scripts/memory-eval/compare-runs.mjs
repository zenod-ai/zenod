#!/usr/bin/env node
// Compare two recorded eval receipts.
//
//   node scripts/memory-eval/compare-runs.mjs --a <receipt.json> --b <receipt.json>
//   node scripts/memory-eval/compare-runs.mjs --latest 2 --out docs/evidence/jev-classify
//
// Refuses to present a clean comparison when the two runs are not comparable
// (different fixture version, model, or sample shape); it reports the mismatch
// instead of quietly producing a number.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i < 0 ? f : argv[i + 1]; };

const KEY = (r) => `${r.suite}|${r.fixtureVersion}|${r.model}|${r.cases}|${r.runs}|${r.trials}`;

async function fromIndex(outDir, n, pick) {
  const index = JSON.parse(await readFile(join(outDir, "index.json"), "utf8"));
  const same = index.runs.filter((r) => r.suite === (arg("--suite") ?? r.suite));
  const chosen = pick === "latest" ? same.slice(0, n) : same.slice(-n);
  if (chosen.length < 2) throw new Error(`need at least 2 recorded runs in ${outDir}; found ${chosen.length}`);
  return Promise.all(chosen.map((r) => readFile(join(resolve("."), r.path), "utf8").then(JSON.parse)));
}

const outDir = resolve(arg("--out") ?? "docs/evidence/jev-classify");
let a, b;
if (arg("--a") && arg("--b")) {
  a = JSON.parse(await readFile(arg("--a"), "utf8"));
  b = JSON.parse(await readFile(arg("--b"), "utf8"));
} else {
  const n = Number(arg("--latest", "2"));
  const [x, y] = await fromIndex(outDir, n, "latest"); // newest first
  b = x; a = y;
}

const pct = (c, t) => (t ? (100 * c) / t : null);
const fmt = (v, d = 1) => (v === null || v === undefined ? "—" : v.toFixed(d));
const sign = (v, d = 1) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

const comparable = KEY(a) === KEY(b);
console.log(`A  ${a.candidateSha?.slice(0, 12)}  ${a.label}   ${a.generatedAt}`);
console.log(`B  ${b.candidateSha?.slice(0, 12)}  ${b.label}   ${b.generatedAt}`);
console.log(`suite ${a.suite}  fixture ${a.fixtureVersion}  model ${a.model}`);
if (!comparable) {
  console.log("\n!! NOT COMPARABLE — the comparability key differs:");
  console.log(`   A: ${KEY(a)}`);
  console.log(`   B: ${KEY(b)}`);
  console.log("   Fixture version, model or sample shape changed. Report the mismatch, do not average across it.");
} else {
  console.log("comparability: OK (same suite, fixture, model and sample shape)");
}

const rows = [
  ["incumbent", (r) => r.aggregate?.incumbent],
  ["jev gated", (r) => r.aggregate?.jevGated],
  ["combined", (r) => r.aggregate?.combined],
];
console.log(`\n${"measure".padEnd(14)}${"A".padStart(14)}${"B".padStart(14)}${"delta".padStart(12)}`);
for (const [name, get] of rows) {
  const va = get(a), vb = get(b);
  if (!va || !vb) continue;
  const pa = pct(va.correct, va.total), pb = pct(vb.correct, vb.total);
  console.log(`${name.padEnd(14)}${`${va.correct}/${va.total} ${fmt(pa)}%`.padStart(14)}${`${vb.correct}/${vb.total} ${fmt(pb)}%`.padStart(14)}${`${sign(pb !== null && pa !== null ? pb - pa : null)}pp`.padStart(12)}`);
}

if (a.spread || b.spread) {
  console.log(`\nrun-to-run spread`);
  for (const k of ["incumbent", "jevGated", "combined"]) {
    const sa = a.spread?.[k], sb = b.spread?.[k];
    if (!sa && !sb) continue;
    console.log(`  ${k.padEnd(12)} A ${fmt(sa?.spreadPct)}pp (sd ${fmt(sa?.sdPct)})   B ${fmt(sb?.spreadPct)}pp (sd ${fmt(sb?.sdPct)})`);
  }
}

const ca = a.spentUsd, cb = b.spentUsd;
if (ca !== null || cb !== null) {
  console.log(`\nspend  A $${fmt(ca, 4)}  (${a.incumbentCalls ?? "?"} calls)   B $${fmt(cb, 4)}  (${b.incumbentCalls ?? "?"} calls)`);
}
console.log(`\nsettings A ${JSON.stringify(a.settings ?? {})}`);
console.log(`settings B ${JSON.stringify(b.settings ?? {})}`);
if (a.imageDigest || b.imageDigest) {
  console.log(`image    A ${a.imageDigest ?? "—"}`);
  console.log(`image    B ${b.imageDigest ?? "—"}`);
}
