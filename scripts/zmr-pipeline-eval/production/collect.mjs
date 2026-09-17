// Consolidate per-cell production evidence into one run JSON for the report.
//
// Usage:
//   node collect.mjs --cells <dir> --meta <meta.json> [--reviews <reviews.json>] --out <run.json>
//
// <cells>/<cell>/ must contain operator-receipt.json (and, when present,
// usage.json from the cell driver). Reviews carry the manual semantic verdicts
// keyed by cell key (e.g. "B01:1").
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const cellsDir = arg('--cells');
const metaPath = arg('--meta');
const reviewsPath = arg('--reviews');
const outPath = arg('--out');
if (!cellsDir || !metaPath || !outPath) throw new Error('usage: collect.mjs --cells <dir> --meta <meta.json> [--reviews <r.json>] --out <run.json>');

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const reviews = reviewsPath ? JSON.parse(readFileSync(reviewsPath, 'utf8')) : {};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const cells = [];
for (const name of readdirSync(cellsDir).sort()) {
  const dir = join(cellsDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const receipt = readJson(join(dir, 'operator-receipt.json'));
  if (!receipt) continue;
  const run = receipt.run ?? {};
  const outcome = (run.outcomes ?? []).find((x) => x.status && x.status !== 'UNRUN');
  if (!outcome) continue;
  const manifest = readJson(join(dir, 'manifest.json')) ?? readJson(join(dir, 'manifest-prebootstrap.json')) ?? {};
  const usage = readJson(join(dir, 'usage.json')) ?? {available: false};
  const calls = (receipt.calls ?? []).map((c) => ({
    name: c.name,
    ms: c.startedAt && c.finishedAt ? new Date(c.finishedAt) - new Date(c.startedAt) : null,
  }));
  const review = reviews[outcome.key] ?? {};
  cells.push({
    key: outcome.key,
    caseId: outcome.id,
    trial: outcome.trial,
    status: outcome.status,
    gates: outcome.gates ?? null,
    latencyMs: outcome.latencyMs ?? null,
    turns: (outcome.turns ?? []).map((t) => ({message: t.message, thread: t.thread, answer: t.result?.text ?? ''})),
    pagesTouched: (outcome.captures ?? []).map((c) => c.enriched?.result?.pagesTouched ?? null),
    duplicateReplay: outcome.duplicateReplay ?? null,
    models: manifest.models ?? meta.models ?? {},
    usage,
    timing: {
      wallMs: outcome.latencyMs ?? null,
      mcpCalls: calls.length,
      mcpMs: calls.reduce((a, c) => a + (c.ms ?? 0), 0),
      calls,
    },
    cost: receipt.cost ?? run.cost ?? {},
    semanticVerdict: review.verdict ?? null,
    checks: review.checks ?? [],
    rationale: review.rationale ?? '',
  });
}

const totals = cells.reduce((a, c) => {
  const u = c.usage?.totals ?? {};
  a.actualUsd += u.costUsd ?? 0;
  a.providerUsd += u.providerCostUsd ?? 0;
  a.reservedUsd += c.cost?.reservedExposureUsd ?? 0;
  a.inputTokens += u.inputTokens ?? 0;
  a.outputTokens += u.outputTokens ?? 0;
  a.cachedInputTokens += u.cachedInputTokens ?? 0;
  a.calls += u.calls ?? 0;
  a.wallMs += c.latencyMs ?? 0;
  a.mcpCalls += c.timing.mcpCalls;
  a.mcpMs += c.timing.mcpMs;
  if (c.semanticVerdict === 'PASS') a.pass += 1;
  else if (c.semanticVerdict === 'PARTIAL') a.partial += 1;
  else if (c.semanticVerdict === 'FAIL') a.fail += 1;
  return a;
}, {actualUsd: 0, providerUsd: 0, reservedUsd: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, calls: 0, wallMs: 0, mcpCalls: 0, mcpMs: 0, pass: 0, partial: 0, fail: 0});

const run = {
  runId: meta.runId ?? `run-${Date.now()}`,
  suite: meta.suite ?? 'm2-basics-v1.1',
  generatedAt: meta.generatedAt ?? new Date().toISOString(),
  source: {
    candidateSha: meta.candidateSha ?? cells[0]?.models?.candidateSha ?? null,
    imageDigest: meta.imageDigest ?? null,
    deployment: meta.deployment ?? null,
    models: meta.models ?? cells[0]?.models ?? {},
    hashes: meta.hashes ?? {},
    observedAt: meta.observedAt ?? null,
  },
  cells: cells.sort((a, b) => a.key.localeCompare(b.key)),
  totals,
};
writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n');
console.log(JSON.stringify({out: outPath, cells: cells.length, totals}));
