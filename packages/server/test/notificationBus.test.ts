import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NotificationBus, notificationDedupeKey, isCoalescible, type NotificationSender } from "../src/notificationBus.js";
import { NotificationStore } from "../src/notificationStore.js";

async function withStore<T>(fn: (store: NotificationStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-notif-"));
  const store = new NotificationStore(join(dir, "notifications.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("notificationDedupeKey (R2-T1)", () => {
  it("keys on target|run|eventType, collapsing sibling executions of one run", () => {
    const base = { eventType: "execution.terminal", runId: "fanout-1", targetIssue: "o/r#5" };
    expect(notificationDedupeKey({ ...base, executionId: "exec-a" })).toBe("o/r#5|fanout-1|execution.terminal");
    // Two sibling executions on the same issue+run+event share the key.
    expect(notificationDedupeKey({ ...base, executionId: "exec-b" })).toBe("o/r#5|fanout-1|execution.terminal");
  });

  it("falls back to executionId when there is no target, and honors an explicit key", () => {
    expect(notificationDedupeKey({ eventType: "execution.blocked", executionId: "exec-a" })).toBe("exec-a|-|execution.blocked");
    expect(notificationDedupeKey({ eventType: "x", dedupeKey: "explicit" })).toBe("explicit");
  });
});

describe("NotificationBus (R2-T1)", () => {
  it("sends on the chosen channel and journals a sent record with recipients", async () => {
    await withStore(async (store) => {
      const calls: Array<{ surface: string; text: string }> = [];
      const send: NotificationSender = async (surface, text) => {
        calls.push({ surface, text });
        return { sent: 1, recipients: ["34600@s.whatsapp.net"] };
      };
      const bus = new NotificationBus(send, store, () => 1000);
      const res = await bus.notify({ eventType: "execution.terminal", text: "✅ done", targetIssue: "o/r#5", executionId: "exec-a", surface: "whatsapp" });

      expect(calls).toEqual([{ surface: "whatsapp", text: "✅ done" }]);
      expect(res).toMatchObject({ status: "sent", sent: 1, recipients: ["34600@s.whatsapp.net"] });
      const rec = store.recent()[0];
      expect(rec).toMatchObject({
        eventType: "execution.terminal",
        surface: "whatsapp",
        targetIssue: "o/r#5",
        executionId: "exec-a",
        composedText: "✅ done",
        recipients: ["34600@s.whatsapp.net"],
        status: "sent",
        dedupeKey: "o/r#5|-|execution.terminal",
      });
    });
  });

  it("routes telegram surface to the telegram channel", async () => {
    await withStore(async (store) => {
      let seen = "";
      const bus = new NotificationBus(async (surface) => { seen = surface; return { sent: 1, recipients: ["c1"] }; }, store, () => 1);
      await bus.notify({ eventType: "manual", text: "hi", surface: "telegram" });
      expect(seen).toBe("telegram");
    });
  });

  it("records a failed send without throwing", async () => {
    await withStore(async (store) => {
      const bus = new NotificationBus(async () => { throw new Error("socket closed"); }, store, () => 1);
      const res = await bus.notify({ eventType: "manual", text: "hi" });
      expect(res.status).toBe("failed");
      expect(store.recent()[0].status).toBe("failed");
    });
  });

  it("suppresses an empty-text event (journaled, not sent)", async () => {
    await withStore(async (store) => {
      let sends = 0;
      const bus = new NotificationBus(async () => { sends += 1; return { sent: 1, recipients: [] }; }, store, () => 1);
      const res = await bus.notify({ eventType: "manual", text: "   " });
      expect(sends).toBe(0);
      expect(res.status).toBe("suppressed");
      expect(store.recent()[0].status).toBe("suppressed");
    });
  });
});

describe("NotificationBus coalescing (R2-T2)", () => {
  it("suppresses a repeat of the same fact within the window, pointing at the sender", async () => {
    await withStore(async (store) => {
      let sends = 0;
      let clock = 1000;
      const bus = new NotificationBus(async () => { sends += 1; return { sent: 1, recipients: ["c"] }; }, store, () => clock, 10 * 60 * 1000);
      const a = await bus.notify({ eventType: "execution.terminal", text: "✅", targetIssue: "o/r#5", executionId: "exec-a" });
      clock += 2000;
      const b = await bus.notify({ eventType: "execution.terminal", text: "✅", targetIssue: "o/r#5", executionId: "exec-b" });
      expect(sends).toBe(1);
      expect(a.status).toBe("sent");
      expect(b.status).toBe("suppressed");
      const suppressed = store.recent().find((r) => r.status === "suppressed");
      expect(suppressed?.suppressedBy).toBe(a.id);
    });
  });

  it("sends again once the window has passed", async () => {
    await withStore(async (store) => {
      let sends = 0;
      let clock = 1000;
      const bus = new NotificationBus(async () => { sends += 1; return { sent: 1, recipients: ["c"] }; }, store, () => clock, 60 * 1000);
      await bus.notify({ eventType: "execution.blocked", text: "⛔", targetIssue: "o/r#5" });
      clock += 61 * 1000; // outside the 60s window
      await bus.notify({ eventType: "execution.blocked", text: "⛔ still", targetIssue: "o/r#5" });
      expect(sends).toBe(2);
    });
  });

  it("never coalesces keyless manual notifications", async () => {
    await withStore(async (store) => {
      let sends = 0;
      const bus = new NotificationBus(async () => { sends += 1; return { sent: 1, recipients: ["c"] }; }, store, () => 1000);
      await bus.notify({ eventType: "manual", text: "first" });
      await bus.notify({ eventType: "manual", text: "second" });
      expect(sends).toBe(2);
      expect(isCoalescible({ eventType: "manual", text: "x" })).toBe(false);
    });
  });

  it("collapses the #102 storm: 3 sibling execs blocked + 3 terminal → 1 blocked + 1 terminal (R2-T2)", async () => {
    await withStore(async (store) => {
      const sent: string[] = [];
      let clock = 1000;
      const bus = new NotificationBus(async (_s, text) => { sent.push(text); return { sent: 2, recipients: ["a", "b"] }; }, store, () => clock);
      const execs = ["exec-1", "exec-2", "exec-3"];
      // Three sibling executions on the SAME issue each report blocked, then terminal.
      for (const executionId of execs) {
        clock += 100;
        await bus.notify({ eventType: "execution.blocked", text: `⛔ ${executionId}`, targetIssue: "AlfaBlok/idea_scraper#102", executionId });
      }
      for (const executionId of execs) {
        clock += 100;
        await bus.notify({ eventType: "execution.terminal", text: `✅ ${executionId}`, targetIssue: "AlfaBlok/idea_scraper#102", executionId });
      }
      // One blocked + one terminal actually sent (recipient fan-out owned centrally).
      expect(sent).toHaveLength(2);
      expect(store.recent().filter((r) => r.status === "suppressed")).toHaveLength(4);
    });
  });
});

describe("NotificationStore (R2-T1)", () => {
  it("round-trips a record and finds the latest by dedupe key", async () => {
    await withStore(async (store) => {
      store.record({ id: "n1", eventType: "e", surface: "whatsapp", dedupeKey: "k", composedText: "a", recipients: ["x"], status: "sent" }, 100);
      store.record({ id: "n2", eventType: "e", surface: "whatsapp", dedupeKey: "k", composedText: "b", recipients: ["x"], status: "sent" }, 200);
      expect(store.latestByDedupeKey("k")?.id).toBe("n2");
      expect(store.latestByDedupeKey("missing")).toBeNull();
      expect(store.recent()).toHaveLength(2);
    });
  });
});
