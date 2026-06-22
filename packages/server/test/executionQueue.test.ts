import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionQueue, IllegalTransitionError, type ExecutionEvent, type ExecutionTicket } from "../src/executionQueue.js";
import { ExecutionStore } from "../src/executionStore.js";

/** A test harness: a monotonic clock + captured seam calls. */
function harness(opts?: { concurrency?: number; ship?: (t: ExecutionTicket) => Promise<string> }) {
  let clock = 0;
  const launched: string[] = [];
  const shipped: string[] = [];
  const events: ExecutionEvent[] = [];
  const q = new ExecutionQueue({
    concurrency: opts?.concurrency ?? 1,
    now: () => ++clock,
    launch: (t) => {
      launched.push(t.executionId);
    },
    ship: opts?.ship ?? (async (t) => `https://example.test/shipped/${t.executionId}`),
    report: (e) => {
      events.push(e);
    },
  });
  const states = () => events.map((e) => `${e.executionId}:${e.state}`);
  return { q, launched, shipped, events, states };
}

const tk = (id: string) => ({ executionId: id, target: `o/r#${id}`, context: `do ${id}` });

describe("ExecutionQueue — concurrency", () => {
  it("runs only up to the concurrency cap; the rest stay queued", async () => {
    const h = harness({ concurrency: 2 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("b"));
    await h.q.enqueue(tk("c"));
    expect(h.launched).toEqual(["a", "b"]); // c waits
    expect(h.q.get("c")!.state).toBe("queued");
    expect(h.states()).toEqual(["a:running", "b:running"]);
  });

  it("frees a slot when a ticket parks at needs-review, starting the next queued", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("b"));
    expect(h.launched).toEqual(["a"]);
    // a produces an outward outcome → needs-review parks it → slot frees → b starts.
    await h.q.reportOutcome({ executionId: "a", outward: true, evidenceUrl: "pr://a" });
    expect(h.q.get("a")!.state).toBe("needs-review");
    expect(h.launched).toEqual(["a", "b"]);
  });

  it("an internal outcome completes at done and frees the slot", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("b"));
    await h.q.reportOutcome({ executionId: "a", outward: false, evidenceUrl: "note://a" });
    expect(h.q.get("a")!.state).toBe("done");
    expect(h.launched).toEqual(["a", "b"]);
    expect(h.states()).toEqual(["a:running", "a:done", "b:running"]);
  });
});

describe("ExecutionQueue — the outward gate + approval", () => {
  it("ships an approved outward outcome and reports done with the real evidence url", async () => {
    const h = harness({ concurrency: 1, ship: async (t) => `https://x.test/${t.executionId}/${t.finalContent}` });
    await h.q.enqueue(tk("a"));
    await h.q.reportOutcome({ executionId: "a", outward: true, evidenceUrl: "draft://a" });
    expect(h.q.get("a")!.state).toBe("needs-review");
    await h.q.approve({ executionId: "a", finalContent: "edited" });
    const a = h.q.get("a")!;
    expect(a.state).toBe("done");
    expect(a.evidenceUrl).toBe("https://x.test/a/edited");
    // done is reported with the SHIPPED url, not the draft ref.
    const done = h.events.find((e) => e.executionId === "a" && e.state === "done");
    expect(done?.evidenceUrl).toBe("https://x.test/a/edited");
  });

  it("a ship failure fails the ticket", async () => {
    const h = harness({
      concurrency: 1,
      ship: async () => {
        throw new Error("send rejected");
      },
    });
    await h.q.enqueue(tk("a"));
    await h.q.reportOutcome({ executionId: "a", outward: true });
    await h.q.approve({ executionId: "a" });
    expect(h.q.get("a")!.state).toBe("failed");
    expect(h.events.at(-1)).toMatchObject({ executionId: "a", state: "failed" });
  });

  it("approve is a no-op once shipped (idempotent)", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.reportOutcome({ executionId: "a", outward: true });
    await h.q.approve({ executionId: "a" });
    const before = h.events.length;
    await h.q.approve({ executionId: "a" }); // duplicate dispatch
    expect(h.events.length).toBe(before);
    expect(h.q.get("a")!.state).toBe("done");
  });

  it("approving a ticket that is not awaiting review is illegal", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a")); // still running
    await expect(h.q.approve({ executionId: "a" })).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});

describe("ExecutionQueue — blocked / unblock / fail", () => {
  it("blocks, then an advisory unblock re-runs the same ticket with guidance in context", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.reportBlocked({ executionId: "a", note: "needs API choice" });
    expect(h.q.get("a")!.state).toBe("blocked");
    await h.q.unblock({ executionId: "a", guidance: "use provider X" });
    expect(h.q.get("a")!.state).toBe("running");
    expect(h.launched).toEqual(["a", "a"]); // relaunched
    expect(h.q.get("a")!.context).toContain("use provider X");
  });

  it("a rescoped blocked ticket fails (Archus re-mints a fresh exec separately)", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.reportBlocked({ executionId: "a", note: "wrong scope" });
    await h.q.fail("a", "rescoped");
    expect(h.q.get("a")!.state).toBe("failed");
  });

  it("blocking frees the slot for the next queued ticket", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("b"));
    await h.q.reportBlocked({ executionId: "a", note: "x" });
    expect(h.launched).toEqual(["a", "b"]);
  });

  it("allows a real outcome to supersede the synthetic restart-interrupted block", async () => {
    const events: ExecutionEvent[] = [];
    const q = new ExecutionQueue({
      concurrency: 1,
      initialTickets: [
        {
          executionId: "a",
          target: "o/r#a",
          context: "do a",
          state: "blocked",
          note: "interrupted by a server restart",
          updatedAt: 1,
        },
      ],
      launch: () => undefined,
      ship: async () => "ship://a",
      report: (e) => events.push(e),
    });

    await q.reportOutcome({ executionId: "a", outward: false });

    expect(q.get("a")).toMatchObject({ state: "done" });
    expect(q.get("a")?.note).toBeUndefined();
    expect(events).toEqual([{ executionId: "a", state: "done", evidenceUrl: undefined, note: undefined }]);
  });

  it("fails the ticket when launch throws", async () => {
    let clock = 0;
    const events: ExecutionEvent[] = [];
    const q = new ExecutionQueue({
      concurrency: 1,
      now: () => ++clock,
      launch: () => {
        throw new Error("spawn EACCES");
      },
      ship: async () => "u",
      report: (e) => events.push(e),
    });
    await q.enqueue(tk("a"));
    expect(q.get("a")!.state).toBe("failed");
    expect(events.map((e) => e.state)).toEqual(["running", "failed"]);
  });
});

describe("ExecutionQueue — protocol invariants", () => {
  it("enqueue is idempotent (a re-dispatched id never double-runs)", async () => {
    const h = harness({ concurrency: 2 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("a"));
    expect(h.launched).toEqual(["a"]);
  });

  it("never reports queued or approved (those are Archus's writes)", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.reportOutcome({ executionId: "a", outward: true });
    await h.q.approve({ executionId: "a" });
    const reported = new Set(h.events.map((e) => e.state));
    expect(reported.has("running")).toBe(true);
    expect(reported.has("needs-review")).toBe(true);
    expect(reported.has("done")).toBe(true);
    expect([...reported]).not.toContain("queued");
    expect([...reported]).not.toContain("approved");
  });

  it("tolerates duplicate/out-of-order worker callbacks", async () => {
    const h = harness({ concurrency: 1 });
    await h.q.enqueue(tk("a"));
    await h.q.reportOutcome({ executionId: "a", outward: false }); // → done
    await h.q.reportOutcome({ executionId: "a", outward: true }); // stale, ignored
    await h.q.reportBlocked({ executionId: "a", note: "stale" }); // stale, ignored
    expect(h.q.get("a")!.state).toBe("done");
  });

  it("snapshot lists all tickets newest-activity first", async () => {
    const h = harness({ concurrency: 2 });
    await h.q.enqueue(tk("a"));
    await h.q.enqueue(tk("b"));
    await h.q.reportOutcome({ executionId: "a", outward: false });
    const snap = h.q.snapshot();
    expect(snap[0].executionId).toBe("a"); // most recently updated
    expect(snap.map((t) => t.executionId).sort()).toEqual(["a", "b"]);
  });
});

describe("ExecutionQueue — durable state seam", () => {
  it("persists state changes through the injected onChange hook", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-exec-store-"));
    const store = new ExecutionStore(join(dir, "execution.sqlite"));
    try {
      const q = new ExecutionQueue({
        concurrency: 1,
        now: () => 1,
        launch: () => {},
        ship: async () => "ship://a",
        report: () => {},
        onChange: (ticket) => store.upsert(ticket),
      });
      await q.enqueue(tk("a"));
      expect(store.get("a")?.state).toBe("running");
      await q.reportOutcome({ executionId: "a", outward: true, evidenceUrl: "draft://a" });
      expect(store.get("a")).toMatchObject({ state: "needs-review", evidenceUrl: "draft://a", outward: true });
      await q.approve({ executionId: "a" });
      expect(store.get("a")).toMatchObject({ state: "done", evidenceUrl: "ship://a" });
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("marks running tickets blocked on restart instead of losing them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-exec-store-"));
    const path = join(dir, "execution.sqlite");
    const first = new ExecutionStore(path, () => 10);
    first.upsert({ executionId: "a", target: "o/r#a", context: "do a", state: "running", updatedAt: 1 });
    first.close();

    const second = new ExecutionStore(path, () => 20);
    try {
      expect(second.get("a")).toMatchObject({
        state: "blocked",
        note: "interrupted by a server restart",
        updatedAt: 20,
      });
    } finally {
      second.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hydrates active tickets into a fresh queue and resumes queued work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-exec-store-"));
    const store = new ExecutionStore(join(dir, "execution.sqlite"));
    try {
      store.upsert({ executionId: "a", target: "o/r#a", context: "do a", state: "queued", updatedAt: 1 });
      store.upsert({ executionId: "b", target: "o/r#b", context: "do b", state: "needs-review", evidenceUrl: "pr://b", updatedAt: 2 });
      const launched: string[] = [];
      const q = new ExecutionQueue({
        concurrency: 1,
        initialTickets: store.active(),
        now: () => 3,
        launch: (ticket) => launched.push(ticket.executionId),
        ship: async () => "ship://",
        report: () => {},
        onChange: (ticket) => store.upsert(ticket),
      });
      await q.resume();
      expect(launched).toEqual(["a"]);
      expect(store.get("a")?.state).toBe("running");
      expect(q.get("b")?.state).toBe("needs-review");
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
