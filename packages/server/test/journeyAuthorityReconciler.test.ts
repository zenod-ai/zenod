import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createJourneyAuthorityReconciler } from "../src/journeyAuthorityReconciler.js";
import { JourneyMonitor } from "../src/journeyMonitor.js";
import { JourneyStore } from "../src/journeyStore.js";
import { toolResponse } from "../src/toolOutput.js";
import type { ExecutionTicket } from "../src/executionQueue.js";

async function withStore<T>(fn: (store: JourneyStore) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-journey-authority-"));
  const store = new JourneyStore(join(dir, "journeys.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function ticket(patch: Partial<ExecutionTicket>): ExecutionTicket {
  return {
    executionId: "exec-1",
    target: "AlfaBlok/obsidian-brain#10",
    context: "run issue",
    state: "done",
    updatedAt: 200,
    ...patch,
  };
}

describe("createJourneyAuthorityReconciler", () => {
  it("completes a stale GitHub step only from issue readback evidence", async () => {
    await withStore(async (store) => {
      const journey = store.create({ surface: "console", originalRequest: "read issue" }, 100);
      const step = store.addStep(
        journey.id,
        {
          owner: "archus",
          title: "Read issue",
          input: { intent: "github.issue.read", target: "AlfaBlok/obsidian-brain#10" },
          wakeAt: 100,
        },
        110,
      );
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        reconcileStep: createJourneyAuthorityReconciler({
          readIssue: async () =>
            toolResponse({
              evidence: [
                {
                  kind: "issue",
                  target: "AlfaBlok/obsidian-brain#10",
                  title: "Smoke",
                  body: "Body",
                  state: "open",
                  labels: [],
                  url: "https://github.com/AlfaBlok/obsidian-brain/issues/10",
                  comments: [],
                },
              ],
            }),
        }),
      });

      await monitor.runOnce();

      expect(store.snapshot(journey.id)).toMatchObject({
        journey: { status: "completed" },
        steps: [expect.objectContaining({ id: step.id, status: "completed" })],
        artifacts: [expect.objectContaining({ artifactKey: "github:AlfaBlok/obsidian-brain#10" })],
      });
    });
  });

  it("blocks a stale GitHub step when there is no target to read back", async () => {
    await withStore(async (store) => {
      const journey = store.create({ surface: "console", originalRequest: "create issue" }, 100);
      const step = store.addStep(
        journey.id,
        { owner: "archus", title: "Create issue", input: { intent: "github.issue.create" }, wakeAt: 100 },
        110,
      );
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        reconcileStep: createJourneyAuthorityReconciler({
          readIssue: async () => {
            throw new Error("must not be called without a target");
          },
        }),
      });

      await monitor.runOnce();

      expect(store.getStep(step.id)).toMatchObject({
        status: "blocked",
        blocker: "cannot reconcile GitHub step: no issue target or artifact was recorded",
      });
    });
  });

  it("reconciles execution steps from Epaminon's queue state", async () => {
    await withStore(async (store) => {
      const journey = store.create({ surface: "console", originalRequest: "run issue" }, 100);
      const step = store.addStep(
        journey.id,
        {
          owner: "epaminon",
          title: "Run issue",
          input: { intent: "execution.issue.run", executionId: "exec-1" },
          wakeAt: 100,
        },
        110,
      );
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        reconcileStep: createJourneyAuthorityReconciler({
          readExecution: async () => ticket({ state: "done" }),
        }),
      });

      await monitor.runOnce();

      expect(store.snapshot(journey.id)).toMatchObject({
        journey: { status: "completed" },
        steps: [expect.objectContaining({ id: step.id, status: "completed" })],
        artifacts: [expect.objectContaining({ artifactKey: "execution:exec-1" })],
      });
    });
  });

  it("blocks execution steps from Epaminon's blocked state", async () => {
    await withStore(async (store) => {
      const journey = store.create({ surface: "console", originalRequest: "run issue" }, 100);
      const step = store.addStep(
        journey.id,
        {
          owner: "epaminon",
          title: "Run issue",
          input: { intent: "execution.issue.run", executionId: "exec-1" },
          wakeAt: 100,
        },
        110,
      );
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        reconcileStep: createJourneyAuthorityReconciler({
          readExecution: async () => ticket({ state: "blocked", note: "missing acceptance criteria" }),
        }),
      });

      await monitor.runOnce();

      expect(store.getStep(step.id)).toMatchObject({
        status: "blocked",
        blocker: "execution exec-1 blocked: missing acceptance criteria",
      });
    });
  });

  it("does not complete notification steps until a notification artifact exists", async () => {
    await withStore(async (store) => {
      const journey = store.create({ surface: "console", originalRequest: "notify me" }, 100);
      const step = store.addStep(
        journey.id,
        { owner: "phylax", title: "Notify", input: { intent: "notification.send" }, wakeAt: 100 },
        110,
      );
      const monitor = new JourneyMonitor(store, {
        now: () => 200,
        leaseMs: 1,
        reconcileStep: createJourneyAuthorityReconciler({}),
      });

      expect((await monitor.runOnce()).reconciled[0]?.action).toMatchObject({ status: "unchanged" });
      expect(store.getStep(step.id)).toMatchObject({ status: "pending" });

      store.addArtifact(journey.id, {
        stepId: step.id,
        kind: "notification",
        artifactKey: `notification:${step.id}`,
        data: { delivered: true },
      });

      const second = new JourneyMonitor(store, {
        now: () => 202,
        reconcileStep: createJourneyAuthorityReconciler({}),
      });
      expect((await second.runOnce()).reconciled[0]?.action).toMatchObject({ status: "completed" });
      expect(store.getStep(step.id)).toMatchObject({ status: "completed" });
    });
  });
});
