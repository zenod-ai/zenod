/**
 * Spawnable worker used to prove crash-recovery ACROSS processes (not just an
 * in-process throw). Run one turn of the executor against a journal; if CRASH_AFTER
 * is set, the executor throws mid-turn and this process hard-exits(137-style) — the
 * journal is all that survives. A fresh invocation (CRASH_AFTER unset) resumes.
 *
 *   JOURNAL=... RUN_ID=... TASK=... [CRASH_AFTER=n] node src/worker.mjs
 */
import { runExecutor } from "./executor.mjs";
import { deterministicModel } from "./model.mjs";
import { emitAuthorityReceipt, renderReceipt } from "./receipt.mjs";

const journalPath = process.env.JOURNAL;
const runId = process.env.RUN_ID || "run-cli";
const task = process.env.TASK || "resolve D-2 spike task";
const crashAfter = process.env.CRASH_AFTER ? Number(process.env.CRASH_AFTER) : Infinity;

try {
  const outcome = await runExecutor({
    runId, journalPath, task,
    model: deterministicModel(), budgetTokens: 10_000, crashAfter,
  });
  const receipt = emitAuthorityReceipt(outcome);
  process.stdout.write(JSON.stringify({ outcome, receipt }) + "\n");
  process.stdout.write(renderReceipt(receipt) + "\n");
} catch (err) {
  // Simulated mid-turn kill: die hard, leaving only the durable journal behind.
  process.stderr.write(`worker crashed mid-turn: ${err.message}\n`);
  process.exit(137);
}
