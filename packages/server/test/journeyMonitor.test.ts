import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { JourneyMonitor } from "../src/journeyMonitor.js";
import { JourneyStore } from "../src/journeyStore.js";

async function withStore<T>(fn: (store: JourneyStore) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-journey-monitor-"));
  const path = join(dir, "journeys.sqlite");
  const store = new JourneyStore(path);
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("JourneyMonitor", () => {
  it("ignores future wakeups, then claims and reconciles due steps", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "create issue" }, 100);
      const step = store.addStep(journey.id, { owner: "archus", title: "Create issue", wakeAt: 500 }, 110);

      const early = new JourneyMonitor(store, {
        now: () => 400,
        reconcileStep: () => ({ status: "completed", result: { ignored: true } }),
      });
      expect(early.runOnce()).toMatchObject({ blocked: [], claimed: [], reconciled: [] });

      const due = new JourneyMonitor(store, {
        now: () => 600,
        reconcileStep: ({ step: claimedStep }) => ({
          status: "completed",
          result: { target: "zenod-ai/zenod#500" },
          artifacts: [
            {
              stepId: claimedStep.id,
              kind: "github_issue",
              artifactKey: "github:zenod-ai/zenod#500",
              data: { target: "zenod-ai/zenod#500" },
            },
          ],
        }),
      });
      expect(due.runOnce()).toMatchObject({
        blocked: [],
        claimed: [expect.objectContaining({ id: step.id })],
        reconciled: [{ step: expect.objectContaining({ id: step.id }), action: expect.objectContaining({ status: "completed" }) }],
      });
      expect(store.snapshot(journey.id)).toMatchObject({
        journey: { status: "completed" },
        steps: [expect.objectContaining({ id: step.id, status: "completed", result: { target: "zenod-ai/zenod#500" } })],
        artifacts: [expect.objectContaining({ artifactKey: "github:zenod-ai/zenod#500" })],
      });
    });
  });

  it("blocks a due step when reconciliation cannot find authority evidence", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "create issue" }, 100);
      const step = store.addStep(journey.id, { owner: "archus", title: "Create issue", wakeAt: 100 }, 110);
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        reconcileStep: () => ({ status: "blocked", reason: "no GitHub issue found for idempotency key" }),
      });

      const result = monitor.runOnce();

      expect(result.claimed).toEqual([expect.objectContaining({ id: step.id })]);
      expect(store.snapshot(journey.id)).toMatchObject({
        journey: { status: "blocked" },
        steps: [expect.objectContaining({ id: step.id, status: "blocked", blocker: "no GitHub issue found for idempotency key" })],
      });
    });
  });

  it("does not claim the same due step while a lease is active", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "run issue" }, 100);
      const step = store.addStep(journey.id, { owner: "epaminon", title: "Run issue", wakeAt: 100 }, 110);
      const first = new JourneyMonitor(store, {
        now: () => 200,
        leaseMs: 1_000,
        reconcileStep: () => ({ status: "unchanged", reason: "authority still pending" }),
      });
      const second = new JourneyMonitor(store, {
        now: () => 200,
        leaseMs: 1_000,
        reconcileStep: () => ({ status: "blocked", reason: "should not run" }),
      });

      expect(first.runOnce().claimed).toEqual([expect.objectContaining({ id: step.id, leaseUntil: 1_200 })]);
      expect(second.runOnce().claimed).toEqual([]);
      expect(store.getStep(step.id)).toMatchObject({ status: "pending", leaseUntil: 1_200 });
    });
  });
});
