import { Worker } from "node:worker_threads";

/**
 * EPIC-24 M34 round 4: the capture-receipts query (taskJobStore.ts) parses every finished capture job's JSON. It is
 * a synchronous `node:sqlite` call, so on the main thread it held the loop that also serves chat, WhatsApp and the
 * web for 13-41 s (`event_loop.blocked`, stack `captureReceipts`). This runs one such SELECT on a worker thread with
 * its own connection to the same file (WAL: a reader never blocks the writer), so only the caller waits.
 */

/** The worker could not start or open the file; the caller may fall back to the synchronous read. */
export class ReceiptWorkerUnavailable extends Error {}

/** The worker's program, run from a string like the watchdog's so it needs no build step and no file next to this one. */
const WORKER_SOURCE = String.raw`
const { workerData, parentPort } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
let db;
try {
  db = new DatabaseSync(workerData.path);
  db.exec("PRAGMA busy_timeout = " + workerData.busyMs + "; PRAGMA query_only = ON;");
} catch (error) {
  parentPort.postMessage({ unavailable: String(error && error.message).slice(0, 160) });
  process.exit(0);
}
try {
  parentPort.postMessage({ rows: db.prepare(workerData.sql).all(...workerData.params) });
} catch (error) {
  parentPort.postMessage({ error: String(error && error.message).slice(0, 160) });
} finally {
  try { db.close(); } catch {}
}
`;

const MAX_PARALLEL = 2;
const READ_TIMEOUT_MS = 180_000;
const BUSY_TIMEOUT_MS = 30_000;
let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await run();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** Run one SELECT (`sql` with positional `params`) against the file at `path` on a worker thread and return its rows. */
export function receiptsOffThread(path: string, sql: string, params: string[]): Promise<Array<Record<string, string | number | null>>> {
  return slot(() => new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { path, sql, params, busyMs: BUSY_TIMEOUT_MS } });
    } catch (error) {
      reject(new ReceiptWorkerUnavailable(error instanceof Error ? error.message : "worker did not start"));
      return;
    }
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      done();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("capture receipts read timed out"))), READ_TIMEOUT_MS);
    timer.unref();
    worker.on("message", (message: { rows?: Array<Record<string, string | number | null>>; error?: string; unavailable?: string }) => {
      if (message.rows) finish(() => resolve(message.rows!));
      else if (message.unavailable !== undefined) finish(() => reject(new ReceiptWorkerUnavailable(message.unavailable)));
      else finish(() => reject(new Error(`capture receipts read failed: ${message.error ?? "unknown"}`)));
    });
    worker.on("error", (error) => finish(() => reject(new ReceiptWorkerUnavailable(error.message))));
    worker.on("exit", () => finish(() => reject(new ReceiptWorkerUnavailable("worker exited"))));
  }));
}
