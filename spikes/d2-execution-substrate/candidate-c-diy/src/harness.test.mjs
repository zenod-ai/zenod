/**
 * THE acceptance harness — one identical test list for every D-2 candidate, taken
 * verbatim from the Eve research doc §6. This file runs it against candidate C (DIY).
 * The same six assertions are what candidates A (Eve) and B (Flue) must satisfy to
 * survive; their status is recorded in ../candidate-a-eve/NOTES.md and
 * ../candidate-b-flue/NOTES.md (DNF: infra-gated in this sandbox).
 *
 *   node --test src/harness.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runExecutor } from "./executor.mjs";
import { deterministicModel, anthropicModelIfAvailable } from "./model.mjs";
import { makeSearchMemoryTool, stubMcpTransport } from "./tools.mjs";
import { emitAuthorityReceipt, renderReceipt } from "./receipt.mjs";
import { Budget, BudgetExceededError } from "./budget.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
function tmpJournal() { return join(mkdtempSync(join(tmpdir(), "d2-diy-")), "journal.jsonl"); }

// ── Test 1: one representative task completes generate → act → summarize ──────────
test("1) ephemeral executor completes generate→act→summarize", async () => {
  const model = (await anthropicModelIfAvailable()) || deterministicModel();
  const outcome = await runExecutor({
    runId: "t1", journalPath: tmpJournal(), task: "resolve D-2 substrate",
    model, budgetTokens: 1000,
  });
  assert.equal(outcome.status, "completed");
  const phases = outcome.evidence.map((e) => e.phase);
  assert.deepEqual(phases, ["generate", "act", "summarize"]);
  assert.match(outcome.summary, /SUMMARY|resolved|D-2/i);
});

// ── Test 2: crash-recovery ACROSS PROCESSES — kill mid-turn, resume from journal ──
test("2) crash mid-turn in a child process, resume from durable state, complete", async () => {
  const journalPath = tmpJournal();
  const worker = join(HERE, "worker.mjs");
  const env = { ...process.env, JOURNAL: journalPath, RUN_ID: "t2", TASK: "durable task" };

  // Child crashes after 1 durably-recorded step (exit 137). Assert it really died.
  let crashed = false;
  try {
    execFileSync(process.execPath, [worker], { env: { ...env, CRASH_AFTER: "1" }, stdio: "pipe" });
  } catch (e) { crashed = true; assert.equal(e.status, 137); }
  assert.ok(crashed, "worker must have crashed mid-turn");
  assert.ok(existsSync(journalPath), "durable journal must survive the crash");

  // Fresh process resumes the SAME journal and finishes.
  const out = execFileSync(process.execPath, [worker], { env, encoding: "utf8" });
  const { outcome, receipt } = JSON.parse(out.trim().split("\n")[0]);
  assert.equal(outcome.status, "completed");
  assert.ok(outcome.stats.replayed >= 1, "resume must replay ≥1 durable step, not redo it");
  assert.equal(receipt.verified, true);
});

// ── Test 3: an existing Zenod MCP tool (search_memory) is called from the tool layer ─
test("3) search_memory MCP tool is invoked from inside the candidate tool layer", async () => {
  let called = null;
  const spyTransport = { id: "spy", async call(name, args) { called = { name, args }; return stubMcpTransport().call(name, args); } };
  const tool = makeSearchMemoryTool(spyTransport);
  const outcome = await runExecutor({
    runId: "t3", journalPath: tmpJournal(), task: "eve execution substrate",
    model: deterministicModel(), budgetTokens: 1000, searchTool: tool,
  });
  assert.equal(outcome.status, "completed");
  assert.equal(called?.name, "search_memory");
  assert.equal(called.args.query, "eve execution substrate");
});

// ── Test 4: hard per-run budget ceiling terminates a deliberately runaway run ─────
test("4) hard budget ceiling terminates a runaway run", async () => {
  const outcome = await runExecutor({
    runId: "t4", journalPath: tmpJournal(), task: "runaway",
    model: deterministicModel({ runawayTokensPerCall: 50 }), budgetTokens: 60, phaseSet: "runaway",
  });
  assert.equal(outcome.status, "terminated-budget");
  assert.ok(outcome.stats.tokens > 60, "run terminated only after crossing the ceiling");
  // And the primitive itself throws precisely at the boundary.
  const b = new Budget(100);
  b.charge(90);
  assert.throws(() => b.charge(20), BudgetExceededError);
});

// ── Test 5: the authority receipt is emitted UNCHANGED, outside the framework ─────
test("5) authority receipt is emitted outside the framework, structurally honest", async () => {
  const good = emitAuthorityReceipt({ runId: "t5", status: "completed", summary: "did it", evidence: [{ step: "s" }] });
  assert.equal(good.verified, true);
  assert.match(renderReceipt(good), /^✓ t5 completed/);

  // A substrate that claims success with NO evidence cannot manufacture a verified receipt.
  const fake = emitAuthorityReceipt({ runId: "t5b", status: "completed", summary: "trust me", evidence: [] });
  assert.equal(fake.verified, false);

  const failed = emitAuthorityReceipt({ runId: "t5c", status: "terminated-budget", error: "over budget" });
  assert.equal(failed.verified, false);
  assert.match(renderReceipt(failed), /^✗ t5c terminated-budget — over budget/);
});

// ── Test 6: honest ops notes exist (asserted as a real, non-trivial artifact) ─────
test("6) honest ops notes (version pain, self-host truth, LOC) are recorded", async () => {
  const { readFileSync } = await import("node:fs");
  const comparison = readFileSync(join(HERE, "..", "..", "COMPARISON.md"), "utf8");
  for (const marker of ["Version pain", "Self-host truth", "LOC written", "Recommendation"]) {
    assert.ok(comparison.includes(marker), `COMPARISON.md must document: ${marker}`);
  }
});
