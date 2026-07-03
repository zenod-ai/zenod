/**
 * Ephemeral executor — the ONE representative lane the D-2 spike ports (per the Eve
 * research doc §6): run one enabled task end-to-end as generate → act → summarize,
 * durably, under a hard budget, and hand the raw outcome to the authority for a receipt.
 *
 * Every phase is a durable step (durable.mjs). Because steps are replayed from the
 * journal on resume, killing the process between phases and restarting resumes exactly
 * where it left off — acceptance test 2. The budget is charged on every model call
 * (budget.mjs) — acceptance test 4. The `act` phase calls search_memory through the
 * MCP tool layer (tools.mjs) — acceptance test 3. The executor returns a RAW outcome;
 * it never authors a "done" claim — the receipt is emitted separately (receipt.mjs) —
 * acceptance test 5.
 */
import { DurableRun } from "./durable.mjs";
import { Budget } from "./budget.mjs";
import { makeSearchMemoryTool } from "./tools.mjs";

/**
 * @param {object} opts
 * @param {string} opts.runId
 * @param {string} opts.journalPath
 * @param {string} opts.task            The task prompt.
 * @param {object} opts.model           Model adapter with async generate({phase,prompt}).
 * @param {number} opts.budgetTokens    Hard ceiling; a run past this terminates.
 * @param {object} [opts.searchTool]    Injected search_memory tool (MCP).
 * @param {number} [opts.crashAfter]    Test hook: throw after this many EXECUTED steps.
 * @param {string} [opts.phaseSet]      "normal" (default) or "runaway".
 * @returns {Promise<object>} raw outcome (NOT a receipt).
 */
export async function runExecutor(opts) {
  const {
    runId, journalPath, task, model, budgetTokens,
    searchTool = makeSearchMemoryTool(), crashAfter = Infinity, phaseSet = "normal",
  } = opts;

  const run = new DurableRun(journalPath, runId);
  const budget = new Budget(budgetTokens);
  // Re-apply budget for steps already spent in a prior (crashed) process.
  for (const rec of run.completed.values()) if (rec?.usage) budget.charge(rec.usage);

  const maybeCrash = () => { if (run.executed >= crashAfter) throw new Error("__injected_crash__"); };

  const phases = phaseSet === "runaway"
    ? ["generate", "runaway", "runaway", "runaway", "runaway", "runaway"]
    : ["generate", "act", "summarize"];

  try {
    const evidence = [];
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const stepName = `${phase}:${i}`;
      const result = await run.step(stepName, async () => {
        const gen = await model.generate({ phase, prompt: task });
        budget.charge(gen.usage.totalTokens); // hard ceiling enforced here
        let toolResult = null;
        if (phase === "act") {
          // Acceptance test 3: call the Zenod search_memory MCP tool from the tool layer.
          toolResult = await searchTool.invoke({ query: task });
        }
        return { phase, text: gen.text, usage: gen.usage.totalTokens, tool: toolResult };
      });
      evidence.push({ step: stepName, phase: result.phase, text: result.text });
      maybeCrash(); // simulate a mid-turn kill AFTER a step is durably recorded
    }

    const summaryStep = evidence.find((e) => e.phase === "summarize");
    return {
      runId,
      status: "completed",
      summary: summaryStep?.text ?? "completed",
      evidence,
      stats: { executed: run.executed, replayed: run.replayed, tokens: budget.spent },
    };
  } catch (err) {
    if (err.name === "BudgetExceededError") {
      return { runId, status: "terminated-budget", error: err.message, stats: { tokens: budget.spent } };
    }
    // Injected crash / real crash: propagate so the process actually dies; the
    // durable journal is what lets a fresh process resume.
    throw err;
  }
}
