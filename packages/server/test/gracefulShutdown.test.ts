import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGracefulShutdown,
  SHUTDOWN_FORCE_CLOSE_MS,
  SHUTDOWN_HARD_EXIT_MS,
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
});
