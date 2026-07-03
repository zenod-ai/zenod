/**
 * Durable event-log journal — the DIY stand-in for the "Workflow SDK" durability
 * pillar. This is deliberately the SMALLEST thing that satisfies acceptance test 2
 * (crash-recovery): every completed step is appended, fsync'd, to an append-only
 * JSONL log keyed by runId. A resumed run replays the log and skips any step whose
 * result is already durably recorded — so killing the process mid-turn loses at
 * most the in-flight step, never a completed one.
 *
 * In a real DIY build this role is played by the open-source Workflow SDK
 * (@workflow/*) or Temporal. Here we implement the *contract* those provide —
 * durable, replayable, at-least-once step execution — in ~60 LOC so the spike is
 * self-contained and provable offline, with no Postgres/Cloudflare dependency.
 */
import { appendFileSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from "node:fs";

/** One durable record in the log. `kind: "step"` = a completed step + its result. */
export function appendRecord(path, record) {
  const line = JSON.stringify(record) + "\n";
  // Append + fsync so a crash immediately after this returns still sees the record.
  appendFileSync(path, line);
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Read every durably-recorded step result for this run, keyed by step name. */
export function loadCompletedSteps(path) {
  const done = new Map();
  if (!existsSync(path)) return done;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (rec.kind === "step") done.set(rec.step, rec.result);
  }
  return done;
}

/**
 * A durable run bound to one journal file. `.step(name, fn)` runs `fn` exactly
 * once *durably*: if the log already has a result for `name` (from a previous,
 * crashed process), it returns that instantly and does NOT re-run `fn`.
 */
export class DurableRun {
  constructor(journalPath, runId) {
    this.journalPath = journalPath;
    this.runId = runId;
    this.completed = loadCompletedSteps(journalPath);
    this.replayed = 0;
    this.executed = 0;
  }

  /** True if this run is resuming a journal that already has completed steps. */
  get isResume() { return this.completed.size > 0; }

  async step(name, fn) {
    if (this.completed.has(name)) {
      this.replayed += 1;
      return this.completed.get(name); // durable replay — skip side-effecting work
    }
    const result = await fn();
    appendRecord(this.journalPath, { kind: "step", runId: this.runId, step: name, result });
    this.completed.set(name, result);
    this.executed += 1;
    return result;
  }
}
