// Deterministic HTML report for M2 production eval runs.
//
//   node report.mjs --runs <run.json>[,<run2.json>...] --out <report.html> [--title "..."]
//
// Renders per-cell expected-vs-actual behaviour, manual score, tokens, time and
// cost (actual + reserved), totals, per-operation model breakdown, and — when
// more than one run is supplied — a baseline-vs-current comparison.
import {readFileSync, writeFileSync} from 'node:fs';
import {literalChecks, loadExpectations} from './expectations.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const runsArg = arg('--runs');
const outPath = arg('--out');
if (!runsArg || !outPath) throw new Error('usage: report.mjs --runs <a.json[,b.json]> --out <report.html> [--title ...]');
const title = arg('--title', 'Zenod Memory — production MCP evaluation');
const runs = runsArg.split(',').map((p) => JSON.parse(readFileSync(p, 'utf8')));
const expectations = loadExpectations();

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const usd = (n) => `$${(n ?? 0).toFixed(6)}`;
const num = (n) => (n ?? 0).toLocaleString('en-US');
const secs = (ms) => `${((ms ?? 0) / 1000).toFixed(1)}s`;
const verdictClass = (v) => (v === 'PASS' ? 'pass' : v === 'PARTIAL' ? 'partial' : v === 'FAIL' ? 'fail' : 'unscored');
const modelList = (models) => Object.entries(models ?? {}).map(([k, v]) => `${esc(k.replace(/^model_/, ''))}=${esc(v)}`).join(' · ');
const realCost = (totals) => (totals?.providerCostUsd > 0 ? totals.providerCostUsd : (totals?.costUsd ?? 0));

function usageRows(cell) {
  const ops = cell.usage?.byOperation ?? [];
  if (!ops.length) return '<tr><td colspan="7" class="mut">usage unavailable</td></tr>';
  return ops.map((o) => `<tr><td>${esc(o.operation)}</td><td>${esc(o.model)}</td><td class="num">${num(o.calls)}</td><td class="num">${num(o.inputTokens)} / ${num(o.outputTokens)}</td><td class="num">${num(o.cachedInputTokens)}</td><td class="num">${usd(o.costUsd)}</td><td class="num">${usd(o.providerCostUsd)}</td></tr>`).join('');
}

function cellHtml(cell) {
  const checks = literalChecks(expectations, cell.caseId, cell.turns.map((t) => t.answer).join('\n'));
  const facts = checks.requiredFacts.map((f) => `<span class="${f.present ? 'pass' : 'fail'}">${f.present ? '✓' : '✗'} ${esc(f.fact)}</span>`).join('  ');
  const forbid = checks.forbidden.length ? checks.forbidden.map((f) => `<span class="${f.present ? 'fail' : 'pass'}">${f.present ? '✗ present' : '✓ absent'} ${esc(f.fact)}</span>`).join('  ') : '<span class="mut">none</span>';
  const conds = checks.conditions.map((c) => `<li>${esc(c)}</li>`).join('');
  const reviewChecks = (cell.checks ?? []).length
    ? `<ul class="checks">${cell.checks.map((c) => `<li><span class="${verdictClass(c.status)}">${esc(c.status)}</span> ${esc(c.text)}${c.evidence ? ` — <span class="mut">${esc(c.evidence)}</span>` : ''}</li>`).join('')}</ul>`
    : '<div class="mut">not reviewed</div>';
  const turns = (cell.turns ?? []).map((t) => `<div class="qa"><div class="q">${esc(t.message)}</div><div class="a">${esc(t.answer)}</div></div>`).join('') || '<div class="qa"><div class="a mut">no chat turn</div></div>';
  const timingCalls = (cell.timing?.calls ?? []).map((c) => `${esc(c.name)}${c.ms != null ? ` (${secs(c.ms)})` : ''}`).join(', ');
  return `
  <details class="cell">
    <summary><b>${esc(cell.key)}</b> ${esc(expectations.cases[cell.caseId]?.name ?? '')} — <span class="${verdictClass(cell.semanticVerdict)}">${esc(cell.semanticVerdict ?? 'UNSCORED')}</span>
      <span class="mut">· ${usd(realCost(cell.usage?.totals))} gateway · ${usd(cell.usage?.totals?.costUsd)} est · ${secs(cell.timing?.wallMs)} · ${num(cell.usage?.totals?.inputTokens)}/${num(cell.usage?.totals?.outputTokens)} tok</span></summary>
    <div class="grid">
      <div><h4>Expected</h4>
        <div class="labels">Facts: ${facts}</div>
        <div class="labels">Forbidden: ${forbid}</div>
        <div class="labels">Citation required: <b>${checks.requireCitation ? 'yes' : 'no'}</b></div>
        <ul class="checks">${conds}</ul></div>
      <div><h4>Actual</h4>${turns}
        <div class="mut">Filed: ${esc((cell.pagesTouched ?? []).map((p) => (p ?? []).join(', ')).filter(Boolean).join(' | ') || 'n/a')}</div></div>
    </div>
    <h4>Manual review${cell.rationale ? ` — <span class="mut">${esc(cell.rationale)}</span>` : ''}</h4>
    ${reviewChecks}
    <h4>Cost · tokens · time</h4>
    <table><thead><tr><th>op</th><th>model</th><th>calls</th><th>in / out</th><th>cached</th><th>estimate</th><th>gateway $</th></tr></thead><tbody>${usageRows(cell)}</tbody></table>
    <div class="mut">wall ${secs(cell.timing?.wallMs)} · mcp calls ${num(cell.timing?.mcpCalls)} (${secs(cell.timing?.mcpMs)}): ${timingCalls || '—'} · reserved ${usd(cell.cost?.reservedExposureUsd)}</div>
    <div class="mut">models: ${modelList(cell.models)}</div>
  </details>`;
}

function runCards(run) {
  const t = run.totals;
  return `<div class="cards">
    <div class="card"><div class="k">Cells</div><div class="v">${run.cells.length}</div></div>
    <div class="card"><div class="k">PASS / partial / fail</div><div class="v"><span class="pass">${t.pass}</span> / <span class="partial">${t.partial}</span> / <span class="fail">${t.fail}</span></div></div>
    <div class="card"><div class="k">Gateway cost (real)</div><div class="v">${usd(t.providerUsd ?? 0)}</div></div>
    <div class="card"><div class="k">Cost estimate</div><div class="v">${usd(t.actualUsd)}</div></div>
    <div class="card"><div class="k">Reserved (stop-gate)</div><div class="v">${usd(t.reservedUsd)}</div></div>
    <div class="card"><div class="k">Tokens in / out</div><div class="v">${num(t.inputTokens)} / ${num(t.outputTokens)}</div></div>
    <div class="card"><div class="k">Cached input</div><div class="v">${num(t.cachedInputTokens)}</div></div>
    <div class="card"><div class="k">LLM calls</div><div class="v">${num(t.calls)}</div></div>
    <div class="card"><div class="k">Summed cell wall time</div><div class="v">${secs(t.wallMs)}</div></div>
  </div>`;
}

function identity(run) {
  const s = run.source ?? {};
  return `<div class="meta">
    <div><b>Candidate SHA</b><span><code>${esc(s.candidateSha)}</code></span></div>
    <div><b>Image digest</b><span><code>${esc(s.imageDigest)}</code></span></div>
    <div><b>Deployment</b><span>${esc(s.deployment?.provider ?? '')} <code>${esc(s.deployment?.deploymentId ?? '')}</code> ${esc(s.deployment?.title ?? '')}</span></div>
    <div><b>Models</b><span>${modelList(s.models)}</span></div>
    <div><b>Suite</b><span>${esc(run.suite)}</span></div>
    <div><b>Generated</b><span>${esc(run.generatedAt)}</span></div>
  </div>`;
}

function opBreakdown(run) {
  const agg = new Map();
  for (const c of run.cells) for (const o of c.usage?.byOperation ?? []) {
    const k = `${o.operation}\u0000${o.model}`;
    const prev = agg.get(k) ?? {operation: o.operation, model: o.model, calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, providerCostUsd: 0};
    prev.calls += o.calls; prev.inputTokens += o.inputTokens ?? 0; prev.outputTokens += o.outputTokens ?? 0; prev.cachedInputTokens += o.cachedInputTokens ?? 0; prev.costUsd += o.costUsd ?? 0; prev.providerCostUsd += o.providerCostUsd ?? 0;
    agg.set(k, prev);
  }
  const rows = [...agg.values()].sort((a, b) => (b.providerCostUsd || b.costUsd) - (a.providerCostUsd || a.costUsd))
    .map((o) => `<tr><td>${esc(o.operation)}</td><td>${esc(o.model)}</td><td class="num">${num(o.calls)}</td><td class="num">${num(o.inputTokens)} / ${num(o.outputTokens)}</td><td class="num">${usd(o.costUsd)}</td><td class="num">${usd(o.providerCostUsd)}</td></tr>`).join('');
  return `<table><thead><tr><th>op</th><th>model</th><th>calls</th><th>in / out</th><th>estimate</th><th>gateway $</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function compareTable(baseline, current) {
  const b = new Map(baseline.cells.map((c) => [c.key, c]));
  const rows = current.cells.map((c) => {
    const p = b.get(c.key);
    const dCost = realCost(c.usage?.totals) - realCost(p?.usage?.totals);
    const dTok = (c.usage?.totals?.inputTokens ?? 0) - (p?.usage?.totals?.inputTokens ?? 0);
    const dTime = (c.timing?.wallMs ?? 0) - (p?.timing?.wallMs ?? 0);
    return `<tr><td>${esc(c.key)}</td><td>${esc(p?.semanticVerdict ?? '—')}</td><td>${esc(c.semanticVerdict ?? '—')}</td>
      <td class="num ${dCost > 0 ? 'up' : dCost < 0 ? 'down' : ''}">${dCost >= 0 ? '+' : ''}${usd(dCost)}</td>
      <td class="num">${dTok >= 0 ? '+' : ''}${num(dTok)}</td>
      <td class="num">${dTime >= 0 ? '+' : ''}${secs(dTime)}</td></tr>`;
  }).join('');
  const dt = current.totals, db = baseline.totals;
  const dtotals = `<tr class="total"><td>ALL</td><td>${db.pass}P/${db.partial}~/${db.fail}F</td><td>${dt.pass}P/${dt.partial}~/${dt.fail}F</td>
    <td class="num">${realCost(dt) - realCost(db) >= 0 ? '+' : ''}${usd(realCost(dt) - realCost(db))}</td>
    <td class="num">${dt.inputTokens - db.inputTokens >= 0 ? '+' : ''}${num(dt.inputTokens - db.inputTokens)}</td>
    <td class="num">${dt.wallMs - db.wallMs >= 0 ? '+' : ''}${secs(dt.wallMs - db.wallMs)}</td></tr>`;
  return `<table><thead><tr><th>cell</th><th>baseline verdict</th><th>current verdict</th><th>Δ cost (gateway)</th><th>Δ input tokens</th><th>Δ wall</th></tr></thead><tbody>${rows}${dtotals}</tbody></table>
  <p class="mut">Baseline: <code>${esc(baseline.source?.candidateSha)}</code> (${modelList(baseline.source?.models)}). Current: <code>${esc(current.source?.candidateSha)}</code> (${modelList(current.source?.models)}).</p>`;
}

const current = runs[runs.length - 1];
const compare = runs.length > 1 ? `<h2>Comparison (baseline → current)</h2>${compareTable(runs[0], current)}` : '';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#0b0f17;--card:#141b26;--fg:#e8eef7;--mut:#93a2b8;--pass:#39d98a;--partial:#ffc453;--fail:#ff6b6b;--acc:#6aa8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1150px;margin:0 auto;padding:32px 20px 80px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:34px 0 12px;color:var(--acc)}h4{margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
.card{background:var(--card);border:1px solid #1f2a3a;border-radius:12px;padding:14px 16px}.card .k{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.card .v{font-size:22px;font-weight:700;margin-top:6px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px 24px;background:var(--card);border:1px solid #1f2a3a;border-radius:12px;padding:16px 18px;margin:12px 0}
.meta b{color:var(--mut);font-weight:600;min-width:130px;display:inline-block}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid #1f2a3a;border-radius:10px;overflow:hidden;margin:6px 0}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #1f2a3a;font-size:14px}th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.05em}
td.num{font-variant-numeric:tabular-nums;text-align:right}tr.total td{font-weight:700}
.pass{color:var(--pass);font-weight:700}.partial{color:var(--partial);font-weight:700}.fail{color:var(--fail);font-weight:700}.unscored,.mut{color:var(--mut)}
.up{color:var(--fail)}.down{color:var(--pass)}
details.cell{background:var(--card);border:1px solid #1f2a3a;border-radius:10px;padding:10px 14px;margin:8px 0;display:block}
summary{cursor:pointer;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.labels{margin:3px 0;font-size:13px}.labels span{margin-right:12px}
ul.checks{list-style:none;padding-left:0;margin:4px 0}ul.checks li{margin:3px 0;font-size:13.5px}
.qa{margin:6px 0}.q{color:var(--acc);font-size:13.5px}.a{white-space:pre-wrap;background:#0e1420;border-radius:8px;padding:8px 10px;margin-top:3px;font-size:13.5px}
code{background:#0e1420;padding:2px 6px;border-radius:6px;font-size:12.5px}footer{color:var(--mut);margin-top:40px;font-size:13px}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1>
<div class="mut">MCP-scored against the deployed agent · manual semantic review · ${esc(current.suite)} · run <code>${esc(current.runId)}</code></div>
${identity(current)}
${runCards(current)}

<h2>Cost by operation (all cells)</h2>${opBreakdown(current)}
${compare}

<h2>Cells</h2>
${current.cells.map(cellHtml).join('\n')}

<footer>Actual cost is the deployed server's own pricing × tokens (the MCP path does not return provider-billed cost). Reserved is the harness stop-gate, not spend. Generated by report.mjs.</footer>
</div></body></html>`;

writeFileSync(outPath, html);
console.log(JSON.stringify({out: outPath, bytes: html.length, runs: runs.length}));
