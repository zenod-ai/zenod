#!/usr/bin/env node
// Run the frozen production memory batch against a deployed Zenod over MCP and
// score the classify decisions. No harness clone, no tenant provisioning: it
// calls the real production MCP and reads each store's receipt.
//
//   ZENOD_MCP_URL=https://cloud.zenod.dev/mcp ZENOD_MCP_TOKEN=<tenant token> \
//     node scripts/memory-eval/production-eval.mjs \
//       --batch scripts/memory-eval/production-batch.json \
//       --out docs/evidence/jev-classify
//
// Writes <out>/<deployedSha>/production-<timestamp>.json and updates index.json.
// Every case is prefixed EVAL-TEST in its content, so entries are findable and
// removable afterwards. Use --dry-run to resolve the endpoints and validate the
// batch without storing anything.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const arg = (n, f) => { const i = argv.indexOf(n); return i < 0 ? f : argv[i + 1]; };
const DRY = argv.includes("--dry-run");
const HEALTH = arg("--health", "https://cloud.zenod.dev/api/health");
const MCP_URL = process.env.ZENOD_MCP_URL ?? "https://cloud.zenod.dev/mcp";
const TOKEN = process.env.ZENOD_MCP_TOKEN;
const BATCH = arg("--batch", "scripts/memory-eval/production-batch.json");
const OUT = resolve(arg("--out", "docs/evidence/jev-classify"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cut = (s, n = 400) => String(s ?? "").slice(0, n);

async function callTool(name, args) {
  const body = {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name, arguments: args },
  };
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mcp ${name} http ${res.status}: ${cut(text, 200)}`);
  // Streamable HTTP may answer as SSE; take the last data: line.
  const jsonText = text.startsWith("event:") || text.includes("\ndata:")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop()
    : text;
  const parsed = JSON.parse(jsonText);
  if (parsed.error) throw new Error(`mcp ${name} error: ${cut(JSON.stringify(parsed.error), 200)}`);
  return parsed.result?.structuredContent ?? parsed.result;
}

function scoreCase(entry, receipt) {
  const topics = Array.isArray(receipt?.topics) ? receipt.topics : [];
  const gotPages = new Set();
  const gotDisp = new Set();
  for (const t of topics) {
    if (t.disposition) gotDisp.add(t.disposition);
    for (const p of (t.filedPages ?? t.pages ?? [])) gotPages.add(String(p));
  }
  const wantPages = new Set(entry.expectPage ? String(entry.expectPage).split("|") : []);
  const pageOk = wantPages.size === 0 ? gotPages.size === 0 : [...gotPages].some((p) => wantPages.has(p));
  const dispOk = gotDisp.has(entry.expectDisposition);
  return { pageOk, dispOk, correct: pageOk && dispOk, gotPages: [...gotPages], gotDisp: [...gotDisp] };
}

async function main() {
  const batchRaw = await readFile(BATCH, "utf8");
  const batch = JSON.parse(batchRaw);
  const health = await fetch(HEALTH, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());
  const deployedSha = health.sha ?? "unknown";

  console.log(`batch ${batch.version}  cases ${batch.cases.length}  deployed ${deployedSha}`);
  console.log(`mcp   ${MCP_URL}`);
  if (DRY) {
    if (!TOKEN) console.log("token: MISSING (dry run still validates the batch shape)");
    let bad = 0;
    for (const c of batch.cases) {
      const okContent = typeof c.content === "string" && c.content.startsWith("EVAL-TEST");
      if (!c.id || !c.expectDisposition || !okContent) { console.log(`  INVALID ${c.id}`); bad++; }
    }
    console.log(bad ? `batch invalid: ${bad}` : "batch valid; nothing stored");
    const parsed = { deployedSha, dryRun: true, cases: batch.cases.length };
    console.log(JSON.stringify(parsed));
    return;
  }
  if (!TOKEN) {
    console.error("ZENOD_MCP_TOKEN is required (get it from the Zenod console). Nothing was stored.");
    process.exit(2);
  }

  const results = [];
  for (const entry of batch.cases) {
    const started = Date.now();
    let receipt = null; let error = null;
    try {
      const stored = await callTool("store_memory", {
        content: entry.content,
        hints: [`EVAL-TEST ${entry.id} (production classify eval; safe to remove)`],
        source: "selftest",
        idempotencyKey: `jev-prod-${deployedSha.slice(0, 7)}-${entry.id}`,
      });
      const ticket = stored?.ticket_id ?? stored?.jobId;
      if (!ticket) throw new Error(`no ticket id: ${cut(JSON.stringify(stored), 160)}`);
      for (let i = 0; i < 60; i++) {
        const r = await callTool("get_task_result", { ticket_id: ticket });
        if (r?.status === "done") { receipt = r.result ?? {}; break; }
        if (r?.status === "error") throw new Error(cut(r.error, 160));
        await sleep(3000);
      }
      if (!receipt) throw new Error("store did not complete within the poll window");
    } catch (e) { error = cut(e.message, 200); }
    const score = receipt ? scoreCase(entry, receipt) : null;
    results.push({
      id: entry.id, category: entry.category,
      expectedPage: entry.expectPage, expectedDisposition: entry.expectDisposition,
      pagesTouched: receipt?.pagesTouched ?? null, filing: receipt?.filing ?? null,
      topics: (receipt?.topics ?? []).map((t) => ({ disp: t.disposition, conf: t.confidence, pages: t.filedPages ?? t.pages ?? [] })),
      score, error, ms: Date.now() - started,
    });
    const flag = score ? (score.correct ? "PASS" : `FAIL(${score.gotPages.join(",") || "-"}|${score.gotDisp.join(",")})`) : `ERR(${error})`;
    console.log(`${entry.id} ${entry.category.padEnd(16)} ${flag}  ${results.at(-1).ms}ms`);
  }

  const scored = results.filter((r) => r.score);
  const correct = scored.filter((r) => r.score.correct).length;
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
  const summary = {
    deployedSha, batchVersion: batch.version, batchSha256: createHash("sha256").update(batchRaw).digest("hex"),
    generatedAt: new Date().toISOString(),
    cases: results.length, scored: scored.length, correct, accuracy: pct(correct, scored.length),
    errors: results.filter((r) => r.error).length,
    medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null,
  };
  console.log(`\naccuracy ${correct}/${scored.length} (${summary.accuracy})  errors ${summary.errors}  median ${summary.medianMs}ms`);

  const dir = join(OUT, deployedSha);
  await mkdir(dir, { recursive: true });
  const outFile = join(dir, `production-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outFile, JSON.stringify({ ...summary, results }, null, 2));
  console.log(`receipt ${outFile}`);
}

main().catch((e) => { console.error(`production-eval failed: ${cut(e.message, 300)}`); process.exit(1); });
