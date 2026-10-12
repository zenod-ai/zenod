import { describe, expect, it } from "vitest";
import { EventLoopMonitor, eventLoopOptionsFromEnv } from "../src/eventLoopHealth.js";

function busy(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* block the loop */ }
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("EventLoopMonitor", () => {
  it("reports a snapshot shape before and after a window rolls", async () => {
    const m = new EventLoopMonitor({ windowMs: 60_000 }).start();
    try {
      const s = m.snapshot();
      expect(s.complete).toBe(false);
      expect(s.p99Ms).toBeGreaterThanOrEqual(0);
      await tick(60);
      const r = m.rollWindow();
      expect(r.complete).toBe(true);
      expect(m.snapshot()).toEqual(r);
      expect(r.utilization).toBeGreaterThanOrEqual(0);
      expect(r.utilization).toBeLessThanOrEqual(1);
    } finally {
      m.stop();
    }
  });

  it("detects a blocked loop and warns at most once per interval", async () => {
    let t = 1_000_000;
    const warnings: Record<string, unknown>[] = [];
    const m = new EventLoopMonitor({
      p99WarnMs: 50,
      now: () => t,
      warn: (e) => warnings.push(e),
    }).start();
    try {
      await tick(30);
      busy(300);
      await tick(40);
      const s = m.rollWindow();
      expect(s.maxMs).toBeGreaterThan(100);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ event: "event_loop.lag", level: "warn" });

      busy(300);
      await tick(40);
      t += 10_000; // inside the 60s rate limit
      m.rollWindow();
      expect(warnings).toHaveLength(1);

      busy(300);
      await tick(40);
      t += 60_000;
      m.rollWindow();
      expect(warnings).toHaveLength(2);
    } finally {
      m.stop();
    }
  });

  it("does not warn when under thresholds", async () => {
    const warnings: unknown[] = [];
    const m = new EventLoopMonitor({ p99WarnMs: 10_000, utilizationWarn: 2, warn: (e) => warnings.push(e) }).start();
    try {
      await tick(50);
      m.rollWindow();
      expect(warnings).toHaveLength(0);
    } finally {
      m.stop();
    }
  });

  it("reads thresholds from env and ignores bad values", () => {
    expect(
      eventLoopOptionsFromEnv({
        EVENT_LOOP_P99_WARN_MS: "500",
        EVENT_LOOP_UTILIZATION_WARN: "0.5",
        EVENT_LOOP_WINDOW_MS: "bad",
      }),
    ).toEqual({ windowMs: 60_000, p99WarnMs: 500, utilizationWarn: 0.5 });
  });
});
