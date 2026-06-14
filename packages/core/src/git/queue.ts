/**
 * Serialized write queue: exactly one writing turn at a time per vault, so two
 * stores fired together land as two clean commits, never interleaved (the
 * concurrency guard from docs/M0-SPEC.md). Reads don't queue.
 *
 * Two priority lanes (#96): interactive work — a user waiting on a reply — always
 * runs before queued background work (the librarian filing notes in the
 * background). Heavy background filing can therefore never starve an interactive
 * turn: the worst an interactive op waits is the single task already in flight,
 * not the whole backlog behind it. The in-flight task is never interrupted; only
 * the *next* pick is prioritized.
 */
export type QueuePriority = "interactive" | "background";

export class WriteQueue {
  private running = false;
  private readonly lanes: Record<QueuePriority, Array<() => void>> = {
    interactive: [],
    background: [],
  };

  /**
   * True while a task is executing. Callers can use this to skip best-effort
   * work (e.g. a read-sync pull) instead of blocking behind a slow write.
   */
  get busy(): boolean {
    return this.running;
  }

  run<T>(fn: () => Promise<T>, priority: QueuePriority = "interactive"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = (): void => {
        this.running = true;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            this.running = false;
            this.dequeue();
          });
      };
      this.lanes[priority].push(task);
      this.dequeue();
    });
  }

  /** Run the next task, interactive lane first. A failed turn must not poison the queue. */
  private dequeue(): void {
    if (this.running) return;
    const task = this.lanes.interactive.shift() ?? this.lanes.background.shift();
    if (task) task();
  }
}
