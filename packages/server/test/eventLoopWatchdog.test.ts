import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainThread } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { startEventLoopWatchdog, watchdogOptionsFromEnv, type EventLoopWatchdog } from "../src/eventLoopWatchdog.js";

// EPIC-24 M34 round 4: a freeze names itself. The watchdog reads the main thread's stack from a worker.
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
function spinForAWhile(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* hold the loop */ }
}

const open: { dog?: EventLoopWatchdog; dir?: string; fd?: number } = {};
afterEach(() => {
  open.dog?.stop();
  if (open.fd !== undefined) closeSync(open.fd);
  if (open.dir) rmSync(open.dir, { recursive: true, force: true });
  open.dog = undefined; open.fd = undefined; open.dir = undefined;
});

function logFile() {
  open.dir = mkdtempSync(join(tmpdir(), "zenod-watchdog-"));
  const path = join(open.dir, "log.txt");
  open.fd = openSync(path, "a");
  return { path, fd: open.fd };
}
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe.skipIf(!isMainThread)("event-loop watchdog", () => {
  it("logs the main thread's stack once for one block, naming the function that held the loop", async () => {
    const { path, fd } = logFile();
    open.dog = startEventLoopWatchdog({ blockMs: 300, checkMs: 50, beatMs: 50, fd });
    await tick(150);
    spinForAWhile(1_500);
    await tick(400);
    const entries = lines(path);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({ level: "warn", event: "event_loop.blocked", threshold_ms: 300 });
    expect(entry.held_ms as number).toBeGreaterThanOrEqual(300);
    const stack = entry.stack as string[];
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.some((frame) => frame.startsWith("spinForAWhile ("))).toBe(true);
    // Code only: function names and file:line, nothing else.
    expect(stack.every((frame) => / \([^()]*:\d+\)$/.test(frame))).toBe(true);
    expect(Object.keys(entry).sort()).toEqual(["event", "held_ms", "level", "stack", "still_held", "threshold_ms"]);
  }, 15_000);

  it("names the caller of a blocking native call too (the stack is read as the call returns)", async () => {
    const { path, fd } = logFile();
    open.dog = startEventLoopWatchdog({ blockMs: 300, checkMs: 50, beatMs: 50, fd });
    await tick(150);
    const waitSynchronously = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
    function callerOfTheSyncWait() { waitSynchronously(1_200); }
    callerOfTheSyncWait();
    await tick(400);
    const entries = lines(path);
    expect(entries).toHaveLength(1);
    const stack = entries[0]!.stack as string[];
    expect(stack.some((frame) => frame.startsWith("callerOfTheSyncWait (") || frame.startsWith("waitSynchronously ("))).toBe(true);
  }, 15_000);

  it("writes a second line for a second block, and none while the loop is free", async () => {
    const { path, fd } = logFile();
    open.dog = startEventLoopWatchdog({ blockMs: 300, checkMs: 50, beatMs: 50, fd });
    await tick(800);
    expect(lines(path)).toHaveLength(0);
    spinForAWhile(900);
    await tick(500);
    expect(lines(path)).toHaveLength(1);
    await tick(600);
    spinForAWhile(900);
    await tick(500);
    expect(lines(path)).toHaveLength(2);
  }, 20_000);

  it("a short stall under the threshold writes nothing", async () => {
    const { path, fd } = logFile();
    open.dog = startEventLoopWatchdog({ blockMs: 600, checkMs: 50, beatMs: 50, fd });
    await tick(100);
    spinForAWhile(250);
    await tick(500);
    expect(lines(path)).toHaveLength(0);
  }, 10_000);

  it("is off at 0 and reads its threshold from the environment", () => {
    expect(startEventLoopWatchdog({ blockMs: 0 }).stop).toBeTypeOf("function");
    expect(watchdogOptionsFromEnv({})).toEqual({});
    expect(watchdogOptionsFromEnv({ EVENT_LOOP_WATCHDOG_MS: "8000" })).toEqual({ blockMs: 8000 });
    expect(watchdogOptionsFromEnv({ EVENT_LOOP_WATCHDOG_MS: "0" })).toEqual({ blockMs: 0 });
    expect(watchdogOptionsFromEnv({ EVENT_LOOP_WATCHDOG_MS: "nope" })).toEqual({});
  });
});
