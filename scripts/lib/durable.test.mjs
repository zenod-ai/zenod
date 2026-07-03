import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableRun, loadCompletedSteps, appendRecord } from "./durable.mjs";

// I8-2 / C-21: the durability primitive must replay completed steps after a "crash"
// (a fresh DurableRun over the same journal) and never re-run a step whose result is
// already durably recorded.

test("DurableRun runs each step once and records its result", async () => {
  const journal = join(mkdtempSync(join(tmpdir(), "durable-")), "run.jsonl");
  const run = new DurableRun(journal, "run-1");
  assert.equal(run.isResume, false, "a fresh run over an empty journal is not a resume");
  let sideEffects = 0;
  const a = await run.step("a", async () => { sideEffects++; return 1; });
  const b = await run.step("b", async () => { sideEffects++; return 2; });
  assert.equal(a, 1);
  assert.equal(b, 2);
  assert.equal(sideEffects, 2);
  assert.equal(run.executed, 2);
  assert.equal(run.replayed, 0);
});

test("a resumed run replays completed steps without re-running side effects", async () => {
  const journal = join(mkdtempSync(join(tmpdir(), "durable-")), "run.jsonl");
  // First process: completes step "a", then "crashes" before "b".
  const first = new DurableRun(journal, "run-2");
  let sideEffects = 0;
  await first.step("a", async () => { sideEffects++; return "A"; });

  // Second process (simulated redeploy): fresh DurableRun over the same journal.
  const resumed = new DurableRun(journal, "run-2");
  assert.equal(resumed.isResume, true, "should detect it is resuming a non-empty journal");
  const a = await resumed.step("a", async () => { sideEffects++; return "A-again"; }); // must NOT re-run
  const b = await resumed.step("b", async () => { sideEffects++; return "B"; }); // runs for the first time
  assert.equal(a, "A", "replayed the durable result, not the re-run value");
  assert.equal(b, "B");
  assert.equal(sideEffects, 2, "step a ran once total across both processes; b ran once");
  assert.equal(resumed.replayed, 1);
  assert.equal(resumed.executed, 1);
});

test("appendRecord + loadCompletedSteps round-trip step results", () => {
  const journal = join(mkdtempSync(join(tmpdir(), "durable-")), "run.jsonl");
  appendRecord(journal, { kind: "step", runId: "r", step: "one", result: { ok: true } });
  appendRecord(journal, { kind: "launch", runId: "r", attempt: 1 }); // non-step records ignored by the loader
  appendRecord(journal, { kind: "step", runId: "r", step: "two", result: 42 });
  const done = loadCompletedSteps(journal);
  assert.deepEqual(done.get("one"), { ok: true });
  assert.equal(done.get("two"), 42);
  assert.equal(done.size, 2);
});

test("loadCompletedSteps on a missing journal is empty (fresh run)", () => {
  const done = loadCompletedSteps(join(tmpdir(), "does-not-exist-durable.jsonl"));
  assert.equal(done.size, 0);
});
