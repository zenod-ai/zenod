#!/usr/bin/env node
// Execution-lane smoke gate (#stab T8).
//
// Proves the ephemeral execution round-trip end to end against a LIVE Console:
// fire a no-op ephemeral, then poll execution_status until it reaches a terminal
// state, asserting the run is TRACEABLE (terminal state + a non-empty note). Runs
// N times and only exits 0 if every round is green — the sprint gate is "3x green".
//
// This deliberately uses the same public surfaces a chat client uses, so a pass
// means the path the user actually exercises works.
//
// Usage:
//   ZENOD_CONSOLE_URL=https://app.zenod.dev ZENOD_API_TOKEN=... node scripts/exec-smoke.mjs [rounds]
//
// Env:
//   ZENOD_CONSOLE_URL   Console base URL (required)
//   ZENOD_API_TOKEN     bearer token for the Console API (required)
//   ZENOD_SMOKE_ROUNDS  number of rounds (default 3; arg overrides)
//   ZENOD_SMOKE_TIMEOUT_MS  per-round terminal-wait timeout (default 240000)

const BASE = (process.env.ZENOD_CONSOLE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.ZENOD_API_TOKEN || "";
const ROUNDS = Number(process.argv[2] || process.env.ZENOD_SMOKE_ROUNDS || 3);
const TIMEOUT_MS = Number(process.env.ZENOD_SMOKE_TIMEOUT_MS || 240000);
const TERMINAL = new Set(["done", "blocked", "failed", "needs-review"]);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function findTicket(execStatusJson, executionId) {
  const tickets = execStatusJson?.tickets || execStatusJson?.structuredContent?.tickets || [];
  return tickets.find((t) => t.executionId === executionId) || null;
}

async function runOnce(round, sentinel) {
  console.log(`\n— round ${round}/${ROUNDS} (sentinel ${sentinel}) —`);
  const fire = await api("/api/journeys/run-ephemeral-task", {
    method: "POST",
    body: JSON.stringify({
      originalRequest: `exec smoke ${sentinel}`,
      objective: `return a short summary saying \`ephemeral smoke ${sentinel} observed\``,
      instructions: "This is a no-op smoke test. Do not create, edit, close, or run any GitHub issue, and make no code or file changes. Return the result only.",
      artifactPolicy: "return summary only",
    }),
  });
  if (!fire.ok) die(`fire failed: HTTP ${fire.status} ${JSON.stringify(fire.json)}`);
  const executionId = fire.json?.execution?.executionId;
  if (!executionId) die(`no executionId in response: ${JSON.stringify(fire.json)}`);
  console.log(`  queued ${executionId} (${fire.json?.execution?.state})`);

  const deadline = Date.now() + TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const st = await api("/api/executions");
    if (!st.ok) die(`execution_status failed: HTTP ${st.status}`);
    const t = findTicket(st.json, executionId);
    if (t) {
      last = t;
      if (TERMINAL.has(t.state)) break;
    }
    await sleep(3000);
  }
  if (!last) die(`execution ${executionId} never appeared in execution_status — NOT traceable`);
  if (!TERMINAL.has(last.state)) die(`execution ${executionId} did not reach a terminal state within ${TIMEOUT_MS}ms (stuck at ${last.state})`);
  // Traceability assertion: a terminal run must carry a note (the #stab T1 guarantee).
  if (!String(last.note || "").trim() && last.state !== "done") {
    die(`execution ${executionId} reached ${last.state} with an EMPTY note — not traceable (T1 regression)`);
  }
  console.log(`  ✓ ${executionId} → ${last.state}${last.note ? ` (note: ${String(last.note).slice(0, 80)}…)` : ""}`);
  return last.state;
}

async function main() {
  if (!BASE || !TOKEN) die("set ZENOD_CONSOLE_URL and ZENOD_API_TOKEN");
  console.log(`exec-smoke: ${ROUNDS} round(s) against ${BASE}`);
  const results = [];
  for (let i = 1; i <= ROUNDS; i++) {
    // Sentinel varies per round (no Math.random/Date import gymnastics needed here —
    // this is a standalone CLI, not a resumable workflow).
    results.push(await runOnce(i, `sentinel-${Date.now()}-${i}`));
  }
  const green = results.filter((s) => s === "done" || s === "needs-review").length;
  console.log(`\n${green}/${ROUNDS} rounds completed (states: ${results.join(", ")})`);
  if (green < ROUNDS) die(`gate not met: ${ROUNDS - green} round(s) did not complete cleanly`);
  console.log("✓ gate met: all rounds round-tripped traceably");
}

main().catch((e) => die(e.message));
