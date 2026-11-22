import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { createGracefulShutdown, shutdownTimings, type ShutdownProcess } from "../src/gracefulShutdown.js";
import { handBackRunningJobs, stopTakingJobs, TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";

// EPIC-24 M35: on 22 Nov the old task kept running AI filing calls past Zenod's 57 s shutdown deadline, so dockerd
// force-killed it at Swarm's 60 s grace (exit 137, "failed to exit within 1m0s"). A stopping process now takes no new
// job from the signal, hands the filing jobs still running back to the queue at 53 s, and the replacement runs them.
const dirs: string[] = [];
const stores: TaskJobStore[] = [];
const queues: TaskJobQueue[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const queue of queues.splice(0)) await queue.close().catch(() => {});
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* already closed */ } }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const dbPath = () => { const dir = mkdtempSync(join(tmpdir(), "zenod-handback-")); dirs.push(dir); return join(dir, "jobs.sqlite"); };
const openStore = (path: string) => { const store = new TaskJobStore(path, "tenant-alpha"); stores.push(store); return store; };
const openQueue = (store: TaskJobStore, engine: Partial<BrainEngine>) => {
  const queue = new TaskJobQueue(store, async () => engine as BrainEngine);
  queues.push(queue);
  return queue;
};
const stored = (ref: string) => ({ evidenceRef: ref, pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "filed" as const });
const never = () => new Promise<never>(() => {});
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a stopping process takes no new job", () => {
  it("claims nothing from the signal on, but keeps a job queued for the replacement", async () => {
    const path = dbPath();
    const store = openStore(path);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const storeCall = vi.fn(async (input: { content: string }) => { await gate; return stored(`Log/2026-11-22.md#^e-${input.content === "first" ? "aaaaaa" : "bbbbbb"}`); });
    const queue = openQueue(store, { store: storeCall as never });
    const first = queue.enqueue("store", { content: "first" }, "first");
    await vi.waitFor(() => expect(storeCall).toHaveBeenCalledTimes(1));

    stopTakingJobs();
    // A request still being answered during the HTTP drain may save a note: it is accepted (durable), not run here.
    const second = queue.enqueue("store", { content: "second" }, "second");
    release();
    await vi.waitFor(() => expect(store.get(first.id)?.status).toBe("done"));
    await settle(60);
    expect(storeCall).toHaveBeenCalledTimes(1);
    expect(store.get(second.id)?.status).toBe("queued");

    // The replacement (a new process on the same database) runs it.
    const replacement = openQueue(openStore(path), { store: storeCall as never });
    replacement.resume();
    await vi.waitFor(() => expect(openStore(path).get(second.id)?.status).toBe("done"));
  });
});

describe("a slow AI call during shutdown", () => {
  it("is handed back at the deadline: the close ends at once and the replacement runs the job again", async () => {
    const path = dbPath();
    const store = openStore(path);
    const slow = vi.fn(never); // the AI call that does not come back
    const queue = openQueue(store, { enrichEvidence: slow as never });
    const job = queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-22.md#^e-c0ffee", content: "note" }, "enrich:c0ffee");
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    expect(store.get(job.id)?.status).toBe("running");

    let closed = false;
    const closing = queue.close().then(() => { closed = true; });
    await settle(100);
    expect(closed).toBe(false); // still waiting for the running filing: it may finish inside the grace

    const handed = handBackRunningJobs();
    expect(handed).toBe(1);
    // Back in the queue, unclaimed, retry count untouched: the replacement runs it as a fresh job.
    expect(store.get(job.id)).toMatchObject({ status: "queued", attempts: 0 });
    const started = performance.now();
    await closing;
    expect(performance.now() - started).toBeLessThan(2_500); // one second after the hand-back, never the AI call's time
    expect(closed).toBe(true);

    const rerun = vi.fn(async () => stored("Log/2026-11-22.md#^e-c0ffee"));
    const replacement = openQueue(openStore(path), { enrichEvidence: rerun as never });
    replacement.resume();
    await vi.waitFor(() => expect(openStore(path).get(job.id)?.status).toBe("done"));
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it("a late result from the old call is ignored: the job stays the replacement's", async () => {
    const store = openStore(dbPath());
    let finish!: (value: ReturnType<typeof stored>) => void;
    const late = new Promise<ReturnType<typeof stored>>((resolve) => { finish = resolve; });
    const enrich = vi.fn(() => late);
    const queue = openQueue(store, { enrichEvidence: enrich as never });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-22.md#^e-facade", content: "note" }, "enrich:facade");
      await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(1));
      expect(handBackRunningJobs()).toBe(1);
      finish(stored("Log/2026-11-22.md#^e-facade"));
      await settle(60);
      expect(store.get(job.id)?.status).toBe("queued");
      expect(store.get(job.id)?.result).toBeFalsy();
    } finally { warn.mockRestore(); }
  });

  it("a chat job still running is not handed back (running it twice is not safe)", async () => {
    const store = openStore(dbPath());
    const chat = vi.fn(never);
    const queue = openQueue(store, { chat: chat as never });
    const job = queue.enqueue("chat", { text: "hello", source: "mcp" });
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(handBackRunningJobs()).toBe(0);
    expect(store.get(job.id)?.status).toBe("running");
  });

  it("a replacement started earlier finds the handed-back job within a minute", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const path = dbPath();
    const oldStore = openStore(path);
    const slow = vi.fn(never);
    const oldQueue = openQueue(oldStore, { store: slow as never });
    const job = oldQueue.enqueue("store", { content: "note" }, "note-key");
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));

    const rerun = vi.fn(async () => stored("Log/2026-11-22.md#^e-ab12cd"));
    const newStore = openStore(path);
    const replacement = openQueue(newStore, { store: rerun as never });
    replacement.resumeAtStart(10 * 60_000); // the old process holds the running job: nothing to claim yet
    await vi.advanceTimersByTimeAsync(5);
    expect(rerun).not.toHaveBeenCalled();

    oldQueue.handBackRunningJobs();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(newStore.get(job.id)?.status).toBe("done"));
    expect(rerun).toHaveBeenCalledTimes(1);
  });
});

describe("the whole stop, with a filing that never returns", () => {
  it("ends inside Zenod's 57 s deadline under Swarm's 60 s grace and loses nothing", async () => {
    const path = dbPath();
    const store = openStore(path);
    const slow = vi.fn(never);
    const queue = openQueue(store, { enrichEvidence: slow as never });
    const job = queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-22.md#^e-0ddba1", content: "note" }, "enrich:0ddba1");
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));

    // Only setTimeout is faked (the shutdown's timers and the queue's one-second wait); sqlite and promises stay real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const timings = shutdownTimings({ ZENOD_STOP_GRACE_MS: "60000" });
    expect(timings).toEqual({ forceCloseMs: 57_000, hardExitMs: 58_500, handBackMs: 53_000 });
    const proc: ShutdownProcess & { exit: ReturnType<typeof vi.fn> } = { exitCode: undefined, exit: vi.fn() };
    const server = { close: vi.fn((callback: (error?: Error) => void) => { callback(); }), closeIdleConnections: vi.fn(), closeAllConnections: vi.fn() };
    let resourcesClosedAt: number | null = null;
    let elapsed = 0;
    const shutdown = createGracefulShutdown({
      server, proc, log: vi.fn(), ...timings,
      closeResources: async () => { await queue.close(); resourcesClosedAt = elapsed; },
      onSignal: stopTakingJobs,
      handBack: handBackRunningJobs,
    });
    shutdown();
    for (; elapsed < 52_000; elapsed += 1_000) await vi.advanceTimersByTimeAsync(1_000);
    expect(resourcesClosedAt).toBeNull(); // still inside its grace: the filing may yet finish
    expect(store.get(job.id)?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(1_000); // 53 s: handed back
    elapsed = 53_000;
    expect(store.get(job.id)?.status).toBe("queued");
    // The queue waits one more second for its drains after the hand-back, then the stores close.
    elapsed = 54_100;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(resourcesClosedAt).toBe(54_100);
    expect(resourcesClosedAt).toBeLessThan(57_000);
    vi.useRealTimers();
    expect(proc.exitCode).toBeUndefined(); // no force close, no exit 1
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();

    // Nothing was lost: the replacement runs it.
    const rerun = vi.fn(async () => stored("Log/2026-11-22.md#^e-0ddba1"));
    openQueue(openStore(path), { enrichEvidence: rerun as never }).resume();
    await vi.waitFor(() => expect(openStore(path).get(job.id)?.status).toBe("done"));
  });
});
