/**
 * Human-runnable crash-recovery demo (acceptance test 2), narrated to stdout.
 *   node src/crash-recovery-demo.mjs
 * Spawns a worker that dies mid-turn, then resumes it from the durable journal.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const journalPath = join(mkdtempSync(join(tmpdir(), "d2-demo-")), "journal.jsonl");
const worker = join(HERE, "worker.mjs");
const env = { ...process.env, JOURNAL: journalPath, RUN_ID: "demo", TASK: "resolve D-2 substrate" };

console.log(`journal: ${journalPath}\n--- turn 1: worker will crash after 1 durable step ---`);
try {
  execFileSync(process.execPath, [worker], { env: { ...env, CRASH_AFTER: "1" }, stdio: "inherit" });
} catch (e) {
  console.log(`(worker exited ${e.status} — mid-turn kill, as designed)`);
}
console.log(`\n--- turn 2: fresh process resumes from the durable journal ---`);
execFileSync(process.execPath, [worker], { env, stdio: "inherit" });
