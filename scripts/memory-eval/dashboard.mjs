#!/usr/bin/env node
// E15-Q2: the memory test dashboard. Three numbers as a trend, one point per change, bottom line first.
//
// usage: node dashboard.mjs --demo demo.jsonl [--private private.jsonl] [--live live.jsonl] [--changes changes.json]
//          [--recorded recorded.json] --out <dir>/index.html
// Each history line is one run.mjs record. A record belongs to the change in changes.json with the same
// commit (and, for the private set, the same vault revision); later runs (nightly, after a deploy) follow in time order.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const lines = (f) => (f && existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const demo = lines(opt("demo"));
const priv = lines(opt("private"));
// E15-Q3: live-model runs on the fixed slice, each followed by the stand-in on the same slice and code.
const liveRuns = lines(opt("live"));
const changes = JSON.parse(readFileSync(opt("changes", join(HERE, "changes.json")), "utf8"));
const recorded = existsSync(opt("recorded", join(HERE, "recorded.json"))) ? JSON.parse(readFileSync(opt("recorded", join(HERE, "recorded.json")), "utf8")) : [];
const out = opt("out");
if (!out) { console.error("--out is required"); process.exit(2); }

// The error rate includes the answer check; before the chat had an answer step (S1b) it cannot be compared.
const val = (r, key) => (r == null ? null : key === "errorRate" && !r.retrieval?.factsReachAnswer ? null : r[key]);
const vaultRev = (r) => String(r.vault ?? "").replace(/^private@/, "");
const latest = (rows) => rows.at(-1) ?? null;
// One step per change; the newest record wins when a change ran more than once.
const steps = changes.map((c) => ({
  ...c, short: c.label.split(" ")[0] + (/round 2/.test(c.label) ? " r2" : ""),
  demo: c.vaultChange ? null : latest(demo.filter((r) => r.sha === c.sha)),
  real: latest(priv.filter((r) => r.sha === c.sha && vaultRev(r) === c.privateVault)),
}));
const known = new Set(steps.flatMap((s) => [s.demo, s.real]).filter(Boolean));
const later = [...demo, ...priv].filter((r) => !known.has(r)).sort((a, b) => a.at.localeCompare(b.at));
for (const r of later) {
  const key = `${r.sha}@${r.at.slice(0, 13)}`;
  let step = steps.find((s) => s.key === key);
  if (!step) { step = { key, sha: r.sha, at: r.at, label: `${r.label ?? r.sha} (${r.at.slice(5, 16).replace("T", " ")}Z)`, short: r.sha, what: "run after a change", demo: null, real: null }; steps.push(step); }
  if (r.dataset === "demo") step.demo = r; else step.real = r;
}

const METRICS = [
  { key: "ingestionSuccess", name: "Ingestion success rate", better: "up", detail: (r) => `${r.ingestion.ok} of ${r.ingestion.of} notes and agent saves stored, filed in the right place and linked in time` },
  { key: "retrievalEfficiency", name: "Retrieval efficiency", better: "up", detail: (r) => `${r.retrieval.top5} of ${r.retrieval.of} questions with the right memory in the top 5; ${r.retrieval.medianMs} ms; ${r.retrieval.tokensPerQuestion ?? "–"} tokens read per answer` },
  { key: "errorRate", name: "Error rate", better: "down", detail: (r) => `${r.errors.failed} of ${r.errors.of} operations failed or came out wrong` },
];
const SERIES = [
  { key: "demo", name: "Demo vault", color: "#0f8a5f", dash: "" },
  { key: "real", name: "Your real notes", color: "#c2591f", dash: "6 4" },
];

function verdict(metric, from, to) {
  if (from == null || to == null) return "–";
  const d = Math.round((to - from) * 10) / 10;
  if (Math.abs(d) < 1) return "same";
  return (metric.better === "up" ? d > 0 : d < 0) ? `better (${d > 0 ? "+" : ""}${d})` : `worse (${d > 0 ? "+" : ""}${d})`;
}

function chart(metric) {
  const W = 920, H = 230, L = 44, R = 16, T = 14, B = 46;
  const vals = steps.flatMap((s) => SERIES.map((se) => val(s[se.key], metric.key))).filter((v) => v != null);
  const top = metric.better === "down" ? Math.max(20, Math.ceil(Math.max(...vals, 0) / 10) * 10) : 100;
  const x = (i) => L + (steps.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (steps.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric.name)} per change">`;
  for (let g = 0; g <= top; g += top / 4) svg += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="#e4ddcd"/><text x="${L - 6}" y="${y(g) + 4}" text-anchor="end" class="ax">${g}%</text>`;
  steps.forEach((s, i) => {
    svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="#efe9dc"/>`;
    svg += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" class="ax${s.vaultChange ? " vault" : ""}">${esc(s.short)}</text>`;
    svg += `<text x="${x(i)}" y="${H - B + 30}" text-anchor="middle" class="ax small">${esc((s.at ?? "").slice(11, 16))}</text>`;
  });
  const used = [];
  for (const se of SERIES) {
    const pts = steps.map((s, i) => [i, val(s[se.key], metric.key)]).filter(([, v]) => v != null);
    if (!pts.length) continue;
    svg += `<polyline fill="none" stroke="${se.color}" stroke-width="2" stroke-dasharray="${se.dash}" points="${pts.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}"/>`;
    for (const [i, v] of pts) {
      const r = steps[i][se.key];
      svg += `<g class="pt"><circle cx="${x(i)}" cy="${y(v)}" r="10" fill="transparent"/><circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${se.color}" stroke="#fbf8f1" stroke-width="2"/><title>${esc(`${se.name} · ${steps[i].label} (${r.sha})\n${metric.name}: ${v}%\n${metric.detail(r)}`)}</title></g>`;
    }
    const [li, lv] = pts.at(-1);
    // End labels never sit on top of each other: a close second one goes below its line.
    let ly = y(lv) - 8;
    if (used.some((u) => Math.abs(u - ly) < 14)) ly = y(lv) + 18;
    used.push(ly);
    svg += `<text x="${Math.min(x(li) + 8, W - R - 4)}" y="${ly}" class="lab" text-anchor="${x(li) > W - 120 ? "end" : "start"}">${esc(se.name)} ${lv}%</text>`;
  }
  return `${svg}</svg>`;
}

const first = (k, m) => steps.find((s) => val(s[k], m)) ?? null;
const last = (k, m) => [...steps].reverse().find((s) => val(s[k], m) != null) ?? null;
const fmt = (v) => (v == null ? "–" : `${v}%`);
const bottom = METRICS.map((m) => {
  const parts = SERIES.map((se) => {
    const a = val(first(se.key, m.key)?.[se.key], m.key), b = val(last(se.key, m.key)?.[se.key], m.key);
    return a == null ? null : `${se.name.toLowerCase()} ${fmt(a)} → ${fmt(b)}, ${verdict(m, a, b)}`;
  }).filter(Boolean);
  return `<li><b>${m.name}</b>: ${parts.join("; ")}</li>`;
}).join("");

const movers = [];
for (let i = 1; i < steps.length; i++) {
  for (const se of SERIES) {
    for (const m of METRICS) {
      const prev = [...steps.slice(0, i)].reverse().find((s) => val(s[se.key], m.key) != null);
      if (!prev || val(steps[i][se.key], m.key) == null) continue;
      const v = verdict(m, val(prev[se.key], m.key), val(steps[i][se.key], m.key));
      if (v.startsWith("better") || v.startsWith("worse")) movers.push(`${steps[i].short}: ${m.name.toLowerCase()} ${v} on ${se.key === "demo" ? "the demo vault" : "your real notes"}`);
    }
  }
}

const rows = steps.map((s, i) => {
  const cell = (se, m) => {
    const r = s[se.key];
    if (!r) return "–";
    if (val(r, m.key) == null) return `<span class="muted">no answer step to check</span>`;
    const prev = [...steps.slice(0, i)].reverse().find((p) => val(p[se.key], m.key) != null);
    const v = prev ? verdict(m, val(prev[se.key], m.key), r[m.key]) : "start";
    return `${fmt(r[m.key])} <span class="${v.split(" ")[0]}">${esc(v)}</span>`;
  };
  return `<tr><td><b>${esc(s.label)}</b><br><span class="muted">${esc(s.what)} · ${esc(s.sha)}${s.pr ? ` · <a href="https://github.com/zenod-ai/zenod/pull/${s.pr.slice(1)}">${esc(s.pr)}</a>` : ""}${s.vaultChange ? ` · vault ${esc(s.privateVault)}` : ""}</span></td>${METRICS.map((m) => `<td>${SERIES.map((se) => `<div><span class="sw" style="background:${se.color}"></span>${cell(se, m)}</div>`).join("")}</td>`).join("")}</tr>`;
}).join("");

const rec = recorded.map((r) => `<tr><td>${esc(r.change)}</td><td>${esc(r.suite)}</td><td>${esc(r.value)}</td><td>${r.source.endsWith(".md") ? `<a href="https://github.com/zenod-ai/zenod/blob/main/docs/evidence/${esc(r.source)}">${esc(r.source)}</a>` : esc(r.source)}</td></tr>`).join("");

// ---------- live model checks (E15-Q3), shown first ----------
const liveRec = [...liveRuns].reverse().find((r) => r.model !== "stand-in") ?? null;
const pairRec = liveRec ? [...liveRuns].reverse().find((r) => r.model === "stand-in" && r.sha === liveRec.sha && vaultRev(r) === vaultRev(liveRec)) ?? null : null;
const usd = (v) => `$${Number(v ?? 0).toFixed(v >= 0.01 ? 2 : 4)}`;
let liveHtml;
if (!liveRec) {
  liveHtml = `<div class="bl"><p><b>Live AI model checks: waiting for the first weekly run.</b> Once a week the check files your 8 judged notes on Claude Haiku and answers your 20 questions on Claude Sonnet, the models Zenod runs, through the test copy of Zenod and its own capped allowance, and the result shows here next to the stand-in.</p></div>`;
} else {
  const L = liveRec, S = pairRec;
  const ans = L.retrieval.answersRight;
  const cmp = (m) => S ? verdict(m, S[m.key], L[m.key]) : "–";
  const line = (m) => `<tr><td><b>${m.name}</b></td><td>${S ? fmt(S[m.key]) : "–"}</td><td>${fmt(L[m.key])}</td><td><span class="${cmp(m).split(" ")[0]}">${esc(cmp(m).replace(/^better/, "live better").replace(/^worse/, "live worse"))}</span></td><td class="muted">${esc(m.detail(L))}</td></tr>`;
  const headlineParts = METRICS.map((m) => `${m.name.toLowerCase()} ${fmt(L[m.key])}${S ? ` (stand-in ${fmt(S[m.key])})` : ""}`);
  liveHtml = `<div class="bl"><p><b>Live AI model on your notes (${esc(L.model)}, ${esc(L.at.slice(0, 16).replace("T", " "))} UTC, code ${esc(L.sha)}): ${ans ? `${ans.ok} of ${ans.of} answers carried the right facts; ` : ""}${esc(headlineParts.join(", "))}. This run cost ${usd(L.live.spentUsd)}, ${L.live.calls.cached} of ${L.live.calls.cached + L.live.calls.live} model calls came from the cache.</b></p></div>
<table><tr><th>Number</th><th>Stand-in, same slice</th><th>Live model</th><th>Live vs stand-in</th><th>Live, in counts</th></tr>${METRICS.map(line).join("")}
<tr><td><b>Answers with the right facts</b></td><td class="muted">the stand-in never answers</td><td>${ans ? `${ans.ok} of ${ans.of}` : "–"}</td><td></td><td class="muted">the model's own answer contains the expected facts of the question</td></tr></table>
<p class="muted">Slice: your 20 judged questions and the 8 notes behind the placements you judged, on a throwaway copy of your vault. Spend: ${usd(L.live.spentUsd)} this run (cap ${usd(L.live.runCapUsd)}), ${usd(L.live.monthSpentUsd)} this month (cap ${usd(L.live.monthCapUsd)})${L.live.notRun ? `; ${L.live.notRun} items not run because a cap was reached` : ""}.${L.live.calls.failed ? ` ${L.live.calls.failed} model calls failed${L.live.failures ? `: ${esc(Object.entries(L.live.failures).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} × ${why}`).join("; "))}` : ""}.` : ""} ${/claude/i.test(L.model) ? "Filing on Claude Haiku and answers on Claude Sonnet, as Zenod runs them, made inside the test copy of Zenod on its own capped allowance with the key it already holds." : "Filing runs on the model production then used for filing; answers on the same model."}</p>`;
}

const newest = last("demo", "ingestionSuccess")?.demo ?? last("real", "ingestionSuccess")?.real;
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenod memory tests</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:980px;margin:32px auto;padding:0 18px;background:#fbf8f1;color:#1d1b17}
h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:1.9em;margin-bottom:4px}
.muted{color:#6b6458;font-size:13px}.ax{font-size:11px;fill:#6b6458}.ax.small{font-size:10px}.ax.vault{font-style:italic}.lab{font-size:12px;fill:#1d1b17}
svg{width:100%;height:auto;background:#fffdf8;border:1px solid #e4ddcd;border-radius:6px}
.pt:hover circle:last-of-type{r:6}
table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0}td,th{border-bottom:1px solid #e4ddcd;padding:6px 8px;vertical-align:top;text-align:left}th{font-weight:600}
.better{color:#0b6b48}.worse{color:#a33d10}.same,.start{color:#6b6458}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.legend span{margin-right:18px}.bl{background:#f1ebdd;border-radius:6px;padding:10px 16px}
a{color:#1f5b3f}
</style>
<h1>Zenod memory tests</h1>
<p class="muted">Updated ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC${newest ? ` · newest run on ${esc(newest.sha)}` : ""} · every change runs the same suite</p>
<h2>Live AI model checks</h2>
${liveHtml}
<h2>Every change, with the free stand-in model</h2>
<div class="bl"><p><b>Bottom line over today's changes</b></p><ul>${bottom}</ul>
<p class="muted">Biggest moves: ${movers.length ? esc(movers.join(" · ")) : "none over 1 point"}.</p></div>
<h2>What the three numbers mean</h2>
<ul>
<li><b>Ingestion success rate</b>: of the notes sent (voice notes and agent saves), the share stored in the Log, written onto a page in the right place, linked into the tree, within the time limit, with nothing lost.</li>
<li><b>Retrieval efficiency</b>: the share of questions whose right memory is among the five shown. Hover a point for rank, time and tokens.</li>
<li><b>Error rate</b>: the share of all test operations that failed or came out wrong: a memory lost or filed in the wrong place, a question that errored, timed out or did not reach the facts, an agent save it could not find again.</li>
</ul>
<p class="legend">${SERIES.map((se) => `<span><span class="sw" style="background:${se.color}"></span>${se.name}${se.dash ? " (dashed)" : ""}</span>`).join("")}<span class="muted">italic labels are changes to your vault, not code</span></p>
${METRICS.map((m) => `<h2>${m.name}</h2>${chart(m)}`).join("")}
<h2>Each change</h2>
<table><tr><th>Change</th>${METRICS.map((m) => `<th>${m.name}</th>`).join("")}</tr>${rows}</table>
<h2>Checks with the live AI model (recorded, not rerun each change)</h2>
<p class="muted">The suite above uses a free stand-in for the AI model, so it can run on every change. These are the live-model runs made today; they judge meaning, which the stand-in cannot.</p>
<table><tr><th>Change</th><th>What ran</th><th>Result</th><th>Source</th></tr>${rec}</table>
<p class="muted">How it runs: the demo suite runs in CI on every pull request and push; the real-note suite runs on VPS3 every night and after each production roll, on a throwaway copy of your vault, never pushed. Only counts leave the machine.</p>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
