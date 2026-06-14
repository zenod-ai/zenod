import { describe, it, expect } from "vitest";
import { WriteQueue } from "../src/git/queue.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("WriteQueue", () => {
  it("serializes tasks — exactly one runs at a time", async () => {
    const q = new WriteQueue();
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 5 }, () =>
      q.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(maxActive).toBe(1);
  });

  it("runs interactive work before queued background work — no starvation (#96)", async () => {
    const q = new WriteQueue();
    const order: string[] = [];
    const gate = deferred();

    // A background task occupies the queue (in flight) until we release the gate.
    const inflight = q.run(async () => {
      order.push("bg-inflight");
      await gate.promise;
    }, "background");
    // A backlog of background filings queues up behind it...
    const b1 = q.run(async () => void order.push("bg1"), "background");
    const b2 = q.run(async () => void order.push("bg2"), "background");
    // ...then an interactive turn arrives last.
    const interactive = q.run(async () => void order.push("interactive"), "interactive");

    expect(q.busy).toBe(true);
    gate.resolve();
    await Promise.all([inflight, b1, b2, interactive]);

    // The in-flight task is never interrupted, then interactive jumps ahead of
    // the remaining background backlog.
    expect(order).toEqual(["bg-inflight", "interactive", "bg1", "bg2"]);
    expect(q.busy).toBe(false);
  });

  it("defaults to interactive priority", async () => {
    const q = new WriteQueue();
    const order: string[] = [];
    const gate = deferred();
    const inflight = q.run(async () => void (await gate.promise), "background");
    const bg = q.run(async () => void order.push("bg"), "background");
    const def = q.run(async () => void order.push("default")); // no priority arg
    gate.resolve();
    await Promise.all([inflight, bg, def]);
    expect(order).toEqual(["default", "bg"]);
  });

  it("a failed task does not poison the queue", async () => {
    const q = new WriteQueue();
    await expect(q.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(q.run(async () => 42)).resolves.toBe(42);
  });
});
