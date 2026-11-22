import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  SHUTDOWN_FORCE_CLOSE_MS,
  SHUTDOWN_HARD_EXIT_MS,
  shutdownTimings,
  type ShutdownProcess,
  type ShutdownServer,
} from "../src/gracefulShutdown.js";

// Docker Swarm's default StopGracePeriod: SIGKILL (exit 137) after this long.
const DOCKER_STOP_GRACE_MS = 10_000;

function fakeServer(closeDelayMs: number | null) {
  const server = {
    close: vi.fn((callback: (error?: Error) => void) => {
      if (closeDelayMs !== null) setTimeout(() => callback(), closeDelayMs);
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  } satisfies ShutdownServer;
  return server;
}

function fakeProcess() {
  const proc: ShutdownProcess & { exit: ReturnType<typeof vi.fn> } = {
    exitCode: undefined,
    exit: vi.fn(),
  };
  return proc;
}

describe("createGracefulShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finishes inside Docker's stop grace", () => {
    expect(SHUTDOWN_FORCE_CLOSE_MS).toBeLessThan(SHUTDOWN_HARD_EXIT_MS);
    expect(SHUTDOWN_HARD_EXIT_MS).toBeLessThanOrEqual(DOCKER_STOP_GRACE_MS - 1_000);
  });

  it("fast path: closes cleanly, leaves exit code unset and never forces an exit", async () => {
    const server = fakeServer(50);
    const proc = fakeProcess();
    const closeResources = vi.fn(async () => {});
    const shutdown = createGracefulShutdown({ server, closeResources, proc, log: vi.fn() });

    shutdown();
    shutdown(); // second signal is ignored
    await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_CLOSE_MS);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(proc.exitCode).toBeUndefined();
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it("slow close: force-closes connections, then exits 1 before the stop grace runs out", async () => {
    const server = fakeServer(null);
    const proc = fakeProcess();
    const closeResources = vi.fn(() => new Promise<void>(() => {})); // never settles
    const shutdown = createGracefulShutdown({ server, closeResources, proc, log: vi.fn() });

    shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_CLOSE_MS - 1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(proc.exitCode).toBe(1);
    expect(proc.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SHUTDOWN_HARD_EXIT_MS - SHUTDOWN_FORCE_CLOSE_MS);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("close that finishes after the force timer but before the hard stop exits on its own with code 1", async () => {
    const server = fakeServer(SHUTDOWN_FORCE_CLOSE_MS + 500);
    const proc = fakeProcess();
    const shutdown = createGracefulShutdown({ server, closeResources: () => undefined, proc, log: vi.fn() });

    shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_CLOSE_MS + 500);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(proc.exitCode).toBe(1);
  });

  it("records a failed close as exit code 1", async () => {
    const server = fakeServer(10);
    const proc = fakeProcess();
    const log = vi.fn();
    const shutdown = createGracefulShutdown({
      server,
      closeResources: async () => {
        throw new Error("db close failed");
      },
      proc,
      log,
    });

    shutdown();
    await vi.advanceTimersByTimeAsync(10);
    expect(proc.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith("shutdown failed:", expect.any(AggregateError));
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it("if the event loop is still held after a clean close, the hard stop exits with the clean code", async () => {
    const server = fakeServer(10);
    const proc = fakeProcess();
    const shutdown = createGracefulShutdown({ server, closeResources: () => undefined, proc, log: vi.fn() });

    shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_HARD_EXIT_MS);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("closes stores only after the requests in flight are answered", async () => {
    const server = fakeServer(3_000);
    const proc = fakeProcess();
    const closeResources = vi.fn(async () => {});
    const shutdown = createGracefulShutdown({ server, closeResources, proc, log: vi.fn() });

    shutdown();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(closeResources).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
    expect(proc.exitCode).toBeUndefined();
  });

  it("a long stop grace (EPIC-24 M6) lets a 30 s answer finish, then closes and never forces", async () => {
    const timings = shutdownTimings({ ZENOD_STOP_GRACE_MS: "60000" });
    expect(timings).toEqual({ forceCloseMs: 57_000, hardExitMs: 58_500, handBackMs: 53_000 });
    const server = fakeServer(30_000);
    const proc = fakeProcess();
    const closeResources = vi.fn(async () => {});
    const shutdown = createGracefulShutdown({ server, closeResources, proc, log: vi.fn(), ...timings });

    shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_HARD_EXIT_MS);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000 - SHUTDOWN_HARD_EXIT_MS);
    expect(closeResources).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(timings.hardExitMs);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(proc.exitCode).toBeUndefined();
  });

  it("unset, invalid or short stop graces keep the 10 s defaults", () => {
    const defaults = { forceCloseMs: SHUTDOWN_FORCE_CLOSE_MS, hardExitMs: SHUTDOWN_HARD_EXIT_MS, handBackMs: 4_200 };
    expect(shutdownTimings({})).toEqual(defaults);
    expect(shutdownTimings({ ZENOD_STOP_GRACE_MS: "abc" })).toEqual(defaults);
    expect(shutdownTimings({ ZENOD_STOP_GRACE_MS: "5000" })).toEqual(defaults);
  });

  it("EPIC-24 M35: tells the queues at the signal, hands back running jobs at 53 s of a 60 s grace, once", async () => {
    const timings = shutdownTimings({ ZENOD_STOP_GRACE_MS: "60000" });
    const server = fakeServer(null);
    const proc = fakeProcess();
    const order: string[] = [];
    const shutdown = createGracefulShutdown({
      server, proc, log: vi.fn(), ...timings,
      closeResources: async () => { order.push("close"); },
      onSignal: () => order.push("signal"),
      handBack: () => order.push("hand-back"),
    });
    shutdown();
    shutdown();
    expect(order).toEqual(["signal"]);
    await vi.advanceTimersByTimeAsync(52_999);
    expect(order).toEqual(["signal"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["signal", "hand-back"]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(order).toEqual(["signal", "hand-back", "close"]);
    // The hand-back sits before the force close and the hard exit, whatever the grace.
    for (const grace of ["15000", "60000", "120000"]) {
      const t = shutdownTimings({ ZENOD_STOP_GRACE_MS: grace });
      expect(t.handBackMs).toBeLessThan(t.forceCloseMs);
      expect(t.forceCloseMs).toBeLessThan(t.hardExitMs);
    }
  });

  it("EPIC-24 M35: no hand-back when the stop finished by itself, and a failing hook does not stop the shutdown", async () => {
    const server = fakeServer(10);
    const proc = fakeProcess();
    const handBack = vi.fn();
    const log = vi.fn();
    const shutdown = createGracefulShutdown({
      server, proc, log, closeResources: () => undefined, handBack,
      onSignal: () => { throw new Error("hook failed"); },
    });
    shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_FORCE_CLOSE_MS);
    expect(handBack).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("shutdown: could not stop taking jobs:", expect.any(Error));
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(proc.exitCode).toBeUndefined();
  });
});
