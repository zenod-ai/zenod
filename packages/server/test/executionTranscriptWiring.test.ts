import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionQueue, type ExecutionTicket } from "../src/executionQueue.js";
import { ExecutionStore } from "../src/executionStore.js";

function queue(store: ExecutionStore) {
  let clock = 0;
  return new ExecutionQueue({
    concurrency: 1,
    now: () => ++clock,
    launch: () => {},
    ship: async () => "https://example.test/ship",
    report: () => {},
    onChange: (t) => store.upsert(t),
  });
}

describe("recentEvents + transcriptUrl wiring (S-1)", () => {
  it("recordProgress persists recentEvents on a running ticket, durably", async () => {
    const store = new ExecutionStore(":memory:");
    const q = queue(store);
    await q.enqueue({ executionId: "e1", target: "o/r#1", context: "do it" });
    expect(q.get("e1")!.state).toBe("running");

    await q.recordProgress({ executionId: "e1", phase: "editing", recentEvents: ["ls", "apply_patch", "npm test"] });
    const live = q.get("e1")!;
    expect(live.recentEvents).toEqual(["ls", "apply_patch", "npm test"]);
    expect(live.phase).toBe("editing");

    // Durable: reload from the store (a restart) and the trail is still there.
    const reloaded = store.get("e1");
    expect(reloaded?.recentEvents).toEqual(["ls", "apply_patch", "npm test"]);
    store.close();
  });

  it("recordProgress is a no-op once the ticket has left running", async () => {
    const store = new ExecutionStore(":memory:");
    const q = queue(store);
    await q.enqueue({ executionId: "e2", target: "o/r#2", context: "do it" });
    await q.reportOutcome({ executionId: "e2", outward: false });
    expect(q.get("e2")!.state).toBe("done");
    await q.recordProgress({ executionId: "e2", recentEvents: ["late"] });
    expect(q.get("e2")!.recentEvents).toBeUndefined();
    store.close();
  });

  it("recordTranscriptUrl pins the link on a terminal ticket (uploaded after death)", async () => {
    const store = new ExecutionStore(":memory:");
    const q = queue(store);
    await q.enqueue({ executionId: "e3", target: "o/r#3", context: "do it" });
    await q.reportBlocked({ executionId: "e3", note: "stuck" });
    expect(q.get("e3")!.state).toBe("blocked");

    const url = "https://host/api/exec/transcript/e3";
    await q.recordTranscriptUrl({ executionId: "e3", transcriptUrl: url });
    expect(q.get("e3")!.transcriptUrl).toBe(url);
    expect(store.get("e3")?.transcriptUrl).toBe(url);
    store.close();
  });

  it("executionStore round-trips both new columns", () => {
    const store = new ExecutionStore(":memory:");
    const ticket: ExecutionTicket = {
      executionId: "e4",
      target: "o/r#4",
      context: "c",
      state: "running",
      recentEvents: ["a", "b"],
      transcriptUrl: "https://host/t/e4",
      updatedAt: 5,
    };
    store.upsert(ticket);
    const got = store.get("e4");
    expect(got?.recentEvents).toEqual(["a", "b"]);
    expect(got?.transcriptUrl).toBe("https://host/t/e4");
    store.close();
  });
});
