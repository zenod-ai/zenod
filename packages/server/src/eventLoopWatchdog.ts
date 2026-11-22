import { isMainThread, Worker } from "node:worker_threads";

/**
 * EPIC-24 M34 round 4: name the next event-loop freeze. `event_loop.lag` says that the loop was held for 40 s, never
 * where (five blocks between 07:05Z and 15:51Z, none inside the sections we time). The loop cannot report on itself
 * while it is blocked, so a worker thread does: the main thread writes a heartbeat into shared memory once a second;
 * when the worker finds it older than `blockMs` it connects to the main thread with `node:inspector`, asks V8 to pause
 * it, reads the call stack and lets it go, then writes one `event_loop.blocked` line straight to the log file
 * descriptor (a worker's console goes through the blocked main thread, so it would only appear after the freeze).
 *
 * One line per block, whatever its length. The line holds the function names and `file:line` of the main thread's
 * top frames: code, never a variable, a scope, a note or a person. When the main thread is inside a native call (a
 * synchronous disk read), V8 can only stop it as the call returns, so the stack names the code that made the call and
 * `held_ms` says how long the loop had been held when it was read. Idle cost: one timer a second on each thread.
 */
export interface WatchdogOptions {
  /** A heartbeat older than this is a block (default 5 s; 0 turns the watchdog off). */
  blockMs?: number;
  /** How often the worker looks (default 1 s). */
  checkMs?: number;
  /** How often the main thread beats (default 1 s). */
  beatMs?: number;
  /** File descriptor the block line is written to (default 2, stderr, where `event_loop.lag` goes). */
  fd?: number;
  /** Frames kept (default 14). */
  frames?: number;
}

export interface EventLoopWatchdog {
  stop(): void;
}

export function watchdogOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): WatchdogOptions {
  const raw = env.EVENT_LOOP_WATCHDOG_MS;
  if (raw === undefined || raw.trim() === "") return {};
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? { blockMs: n } : {};
}

/** The worker's program, run from a string so it needs no build step and no file next to this one. */
const WORKER_SOURCE = String.raw`
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const inspector = require("node:inspector");
const { sab, blockMs, checkMs, fd, frames } = workerData;
const beat = new BigInt64Array(sab);
const nowMs = () => process.hrtime.bigint() / 1000000n;
let reported = 0n;
let busy = false;

const log = (entry) => { try { fs.writeSync(fd, JSON.stringify(entry) + "\n"); } catch {} };
// Code only: the last two path segments of a script, no directory of ours, no vault path.
const where = (url) => {
  const clean = String(url || "").replace(/^file:\/\//, "").split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
};

function capture(last) {
  busy = true;
  const session = new inspector.Session();
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(giveUp);
    try { session.disconnect(); } catch {}
    busy = false;
  };
  const giveUp = setTimeout(() => {
    log({ level: "warn", event: "event_loop.blocked", note: "no stack read: the main thread did not stop", held_ms: Number(nowMs() - last) });
    done();
  }, 120000);
  try {
    session.connectToMainThread();
  } catch (error) {
    log({ level: "warn", event: "event_loop.blocked", note: "no stack read: " + String(error && error.message).slice(0, 120), held_ms: Number(nowMs() - last) });
    done();
    return;
  }
  session.on("Debugger.paused", (message) => {
    const heldMs = Number(nowMs() - last);
    const stillHeld = Atomics.load(beat, 0) === last;
    const stack = (message.params.callFrames || []).slice(0, frames).map((frame) =>
      (frame.functionName || "(anonymous)") + " (" + where(frame.url) + ":" + (frame.location.lineNumber + 1) + ")");
    log({ level: "warn", event: "event_loop.blocked", held_ms: heldMs, still_held: stillHeld, threshold_ms: blockMs, stack });
    session.post("Debugger.resume", () => session.post("Debugger.disable", done));
  });
  session.post("Debugger.enable", () => session.post("Debugger.pause"));
}

setInterval(() => {
  const last = Atomics.load(beat, 0);
  if (last === 0n || busy || last === reported) return;
  if (Number(nowMs() - last) < blockMs) return;
  reported = last;
  capture(last);
}, checkMs);
`;

/** Start the watchdog in this process. Cheap, unref'd, never throws: a platform without worker threads gets a no-op. */
export function startEventLoopWatchdog(options: WatchdogOptions = {}): EventLoopWatchdog {
  const blockMs = options.blockMs ?? 5_000;
  // `connectToMainThread` means the process's main thread: from inside another worker it would watch the wrong loop.
  if (blockMs <= 0 || !isMainThread) return { stop() {} };
  const beatMs = options.beatMs ?? 1_000;
  try {
    const sab = new SharedArrayBuffer(8);
    const beat = new BigInt64Array(sab);
    const stamp = () => Atomics.store(beat, 0, process.hrtime.bigint() / 1_000_000n);
    stamp();
    const timer = setInterval(stamp, beatMs);
    timer.unref();
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { sab, blockMs, checkMs: options.checkMs ?? 1_000, fd: options.fd ?? 2, frames: options.frames ?? 14 },
    });
    worker.unref();
    worker.on("error", (error) => console.warn(`[watchdog] event-loop watchdog stopped: ${error.message.slice(0, 160)}`));
    return {
      stop() {
        clearInterval(timer);
        void worker.terminate();
      },
    };
  } catch (error) {
    console.warn(`[watchdog] event-loop watchdog not started: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`);
    return { stop() {} };
  }
}
