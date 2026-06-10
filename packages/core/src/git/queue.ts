/**
 * Serialized write queue: exactly one writing turn at a time per vault.
 * Reads don't queue. This is the concurrency guard from docs/M0-SPEC.md —
 * two stores fired together must land as two clean commits, never interleaved.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {
      // a failed turn must not poison the queue
    });
    return next;
  }
}
