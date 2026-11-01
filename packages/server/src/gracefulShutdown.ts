// Shutdown must finish inside Docker's stop grace (Swarm default StopGracePeriod 10 s),
// otherwise dockerd SIGKILLs the task (exit 137) instead of the app exiting on its own.
// Force-close lingering HTTP connections at 7 s, hard-exit at 8.5 s.
export const SHUTDOWN_FORCE_CLOSE_MS = 7_000;
export const SHUTDOWN_HARD_EXIT_MS = 8_500;

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
  proc?: ShutdownProcess;
  log?: (...args: unknown[]) => void;
}

export function createGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const proc = options.proc ?? process;
  const log = options.log ?? console.error;
  const prefix = options.label ? `${options.label} shutdown` : "shutdown";
  let closing = false;
  return () => {
    if (closing) return;
    closing = true;
    let settled = false;
    const serverClosed = new Promise<void>((resolve, reject) => {
      options.server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
    options.server.closeIdleConnections?.();
    const resourcesClosed = Promise.resolve().then(() => options.closeResources());
    const forceTimer = setTimeout(() => {
      log(`${prefix} exceeded ${SHUTDOWN_FORCE_CLOSE_MS / 1000} seconds; closing remaining HTTP connections`);
      proc.exitCode = 1;
      options.server.closeAllConnections?.();
    }, SHUTDOWN_FORCE_CLOSE_MS);
    // Unref'd: it never delays a clean exit, it only fires if something still holds the event loop.
    const hardTimer = setTimeout(() => {
      log(`${prefix} exceeded ${SHUTDOWN_HARD_EXIT_MS / 1000} seconds; exiting before the stop grace runs out`);
      proc.exit(settled ? Number(proc.exitCode ?? 0) : 1);
    }, SHUTDOWN_HARD_EXIT_MS);
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
