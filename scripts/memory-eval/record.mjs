#!/usr/bin/env node
// Record one eval run as a receipt paired to a production commit.
//
// Usage:
//   node scripts/memory-eval/record.mjs \
//     --results scripts/memory-eval/classify-results.json \
//     --candidate <40-hex-sha> [--image sha256:<64-hex>] \
//     --suite classify-basics-v2 --label jev-on \
//     --settings '{"jev_enabled":true,"jev_confidence_threshold":0.75}' \
//     --out docs/evidence/jev-classify
//
// Writes <out>/<candidateSha>/<label>.json and maintains <out>/index.json.
// The receipt carries the hashes that make two runs comparable; a receipt is
// never rewritten, so a re-run gets a new label or overwrites only its own file
// when --force is given.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const resultsPath = arg("--results");
const candidateSha = arg("--candidate");
const imageDigest = arg("--image") ?? null;
const suite = arg("--suite") ?? "classify-basics";
const label = arg("--label");
const outDir = resolve(arg("--out") ?? "docs/evidence/jev-classify");
const force = argv.includes("--force");
let settings = {};
if (arg("--settings")) {
  try { settings = JSON.parse(arg("--settings")); }
  catch { console.error("--settings must be JSON"); process.exit(2); }
}

if (!resultsPath || !candidateSha || !label) {
  console.error("required: --results <file> --candidate <sha> --label <name>");
  process.exit(2);
}
if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
  console.error(`--candidate must be a 40-hex commit sha, got: ${candidateSha}`);
  process.exit(2);
}
if (imageDigest && !/^sha256:[a-f0-9]{64}$/.test(imageDigest)) {
  console.error(`--image must be sha256:<64 hex>, got: ${imageDigest}`);
  process.exit(2);
}

const raw = await readFile(resultsPath, "utf8");
const results = JSON.parse(raw);

const receipt = {
  version: 1,
  suite,
  label,
  candidateSha,
  imageDigest,
  settings,
  // Comparability hashes: two runs are only comparable when these match.
  resultsSha256: sha256(raw),
  fixtureVersion: results.fixtureVersion ?? null,
  model: results.model ?? null,
  gate: results.gate ?? null,
  runs: results.runs ?? null,
  trials: results.trials ?? null,
  cases: results.cases ?? null,
  complete: results.complete ?? null,
  spentUsd: results.spentUsd ?? null,
  incumbentCalls: results.incumbentCalls ?? null,
  generatedAt: new Date().toISOString(),
  aggregate: results.aggregate ?? null,
  runSummaries: results.runSummaries ?? null,
  spread: results.spread ?? null,
};
receipt.receiptSha256 = sha256(JSON.stringify(receipt));

const dir = join(outDir, candidateSha);
await mkdir(dir, { recursive: true });
const receiptPath = join(dir, `${label}.json`);
if (!force) {
  try {
    await readdir(dir);
    const existing = await readFile(receiptPath, "utf8").catch(() => null);
    if (existing) {
      console.error(`${receiptPath} already exists. Use a new --label or --force to overwrite.`);
      process.exit(3);
    }
  } catch { /* directory listing is best-effort */ }
}
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));

// Maintain a flat, newest-first index so "the latest production eval" is a lookup.
const indexPath = join(outDir, "index.json");
const index = JSON.parse(await readFile(indexPath, "utf8").catch(() => '{"version":1,"runs":[]}'));
index.runs = index.runs.filter((r) => !(r.candidateSha === candidateSha && r.label === label));
index.runs.unshift({
  candidateSha, label, suite, imageDigest,
  generatedAt: receipt.generatedAt,
  fixtureVersion: receipt.fixtureVersion,
  model: receipt.model,
  runs: receipt.runs, trials: receipt.trials, cases: receipt.cases,
  complete: receipt.complete,
  receiptSha256: receipt.receiptSha256,
  path: join(outDir, candidateSha, `${label}.json`).replace(resolve(".") + "/", ""),
});
index.runs.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
await writeFile(indexPath, JSON.stringify(index, null, 2));

console.log(`recorded ${receiptPath}`);
console.log(`  sha ${receipt.receiptSha256.slice(0, 16)}  ~/+index: ${index.runs.length} run(s) on file`);
