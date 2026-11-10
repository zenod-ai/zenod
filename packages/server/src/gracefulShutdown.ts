// Shutdown must finish inside Docker's stop grace (Swarm default StopGracePeriod 10 s),
// otherwise dockerd SIGKILLs the task (exit 137) instead of the app exiting on its own.
// Force-close lingering HTTP connections at 7 s, hard-exit at 8.5 s.
export const SHUTDOWN_FORCE_CLOSE_MS = 7_000;
export const SHUTDOWN_HARD_EXIT_MS = 8_500;
const DEFAULT_STOP_GRACE_MS = 10_000;

/**
 * EPIC-24 M6: a release starts the new task first and then stops the old one, which must finish the
 * requests it is still answering (an AI answer can take 30 s). ZENOD_STOP_GRACE_MS names the task's
 * stop grace (keep it equal to the Swarm StopGracePeriod); the force close and hard exit sit 3 s and
 * 1.5 s before it. Unset or below 10 s keeps the 7 s / 8.5 s defaults.
 */
export function shutdownTimings(env: NodeJS.ProcessEnv = process.env): { forceCloseMs: number; hardExitMs: number } {
  const grace = Number(env.ZENOD_STOP_GRACE_MS);
  if (!Number.isSafeInteger(grace) || grace <= DEFAULT_STOP_GRACE_MS) {
    return { forceCloseMs: SHUTDOWN_FORCE_CLOSE_MS, hardExitMs: SHUTDOWN_HARD_EXIT_MS };
  }
  return { forceCloseMs: grace - 3_000, hardExitMs: grace - 1_500 };
}

export interface ShutdownServer {
  close(callback: (error?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownProcess {
  exitCode?: number | string | null | undefined;
  exit(code?: number): void;
}

export interface GracefulShutdownOptions {
  server: ShutdownServer;
  closeResources: () => unknown;
  label?: string;
  forceCloseMs?: number;
  hardExitMs?: number;
  proc?: ShutdownProcess;
  log?: (...args: unknown[]) => void;
}

export function createGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const proc = options.proc ?? process;
  const log = options.log ?? console.error;
  const prefix = options.label ? `${options.label} shutdown` : "shutdown";
  const forceCloseMs = options.forceCloseMs ?? SHUTDOWN_FORCE_CLOSE_MS;
  const hardExitMs = options.hardExitMs ?? SHUTDOWN_HARD_EXIT_MS;
  let closing = false;
  return () => {
    if (closing) return;
    closing = true;
    let settled = false;
    const serverClosed = new Promise<void>((resolve, reject) => {
      options.server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
    options.server.closeIdleConnections?.();
    let forced: () => void = () => {};
    const forcedClose = new Promise<void>((resolve) => { forced = resolve; });
    // Stores and queues close once the requests in flight are answered (or cut at the force close),
    // so an answer still running never meets a closed database.
    const resourcesClosed = Promise.race([serverClosed.catch(() => undefined), forcedClose])
      .then(() => options.closeResources());
    const forceTimer = setTimeout(() => {
      log(`${prefix} exceeded ${forceCloseMs / 1000} seconds; closing remaining HTTP connections`);
      proc.exitCode = 1;
      options.server.closeAllConnections?.();
      forced();
    }, forceCloseMs);
    // Unref'd: it never delays a clean exit, it only fires if something still holds the event loop.
    const hardTimer = setTimeout(() => {
      log(`${prefix} exceeded ${hardExitMs / 1000} seconds; exiting before the stop grace runs out`);
      proc.exit(settled ? Number(proc.exitCode ?? 0) : 1);
    }, hardExitMs);
    hardTimer.unref?.();
    void Promise.allSettled([serverClosed, resourcesClosed]).then((results) => {
      settled = true;
      clearTimeout(forceTimer);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        log(`${prefix} failed:`, new AggregateError(failures, `${prefix} failed`));
        proc.exitCode = 1;
      }
    });
  };
}
