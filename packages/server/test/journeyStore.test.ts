import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { JourneyMonitor } from "../src/journeyMonitor.js";
import { JourneyStore } from "../src/journeyStore.js";

async function withStore<T>(fn: (store: JourneyStore, path: string) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-journeys-"));
  const path = join(dir, "journeys.sqlite");
  const store = new JourneyStore(path);
  try {
    return await fn(store, path);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("JourneyStore", () => {
  it("creates a durable journey with ordered steps and an event trace", async () => {
    await withStore((store) => {
      const journey = store.create(
        {
          conversationId: "whatsapp:+123",
          surface: "whatsapp",
          originalRequest: "create a ticket and run it",
          context: { userIntent: "create_then_run" },
        },
        100,
      );
      const archus = store.addStep(
        journey.id,
        { owner: "archus", title: "Create the GitHub issue", input: { repo: "AlfaBlok/zenod" } },
        110,
      );
      const epaminon = store.addStep(
        journey.id,
        { owner: "epaminon", title: "Run the created issue", dependencyIds: [archus.id], input: { dependsOn: archus.id } },
        120,
      );
      const artifact = store.addArtifact(
        journey.id,
        {
          stepId: archus.id,
          kind: "github_issue",
          artifactKey: "github:AlfaBlok/zenod#123",
          data: { target: "AlfaBlok/zenod#123", url: "https://github.test/123" },
        },
        130,
      );

      const snapshot = store.snapshot(journey.id)!;
      expect(snapshot.journey).toMatchObject({
        conversationId: "whatsapp:+123",
        status: "active",
        originalRequest: "create a ticket and run it",
      });
      expect(snapshot.steps.map((step) => `${step.sequence}:${step.owner}:${step.status}`)).toEqual([
        "1:archus:pending",
        "2:epaminon:pending",
      ]);
      expect(snapshot.steps[1].input).toEqual({ dependsOn: archus.id });
      expect(snapshot.steps[1].dependencyIds).toEqual([archus.id]);
      expect(snapshot.artifacts).toEqual([artifact]);
      expect(snapshot.events.map((event) => event.type)).toEqual(["journey_created", "step_added", "step_added", "artifact_added"]);
      expect(epaminon.sequence).toBe(2);
    });
  });

  it("uses idempotency keys to avoid duplicate mutating steps and artifacts", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "create issue" }, 100);
      const first = store.addStep(
        journey.id,
        { owner: "archus", title: "Create issue", idempotencyKey: `journey:${journey.id}:step:create` },
        110,
      );
      const duplicate = store.addStep(
        journey.id,
        { owner: "archus", title: "Create issue again", idempotencyKey: `journey:${journey.id}:step:create` },
        120,
      );
      const artifact = store.addArtifact(journey.id, { stepId: first.id, kind: "github_issue", artifactKey: "github:repo#1" }, 130);
      const duplicateArtifact = store.addArtifact(
        journey.id,
        { stepId: first.id, kind: "github_issue", artifactKey: "github:repo#1", data: { ignored: true } },
        140,
      );

      expect(duplicate.id).toBe(first.id);
      expect(duplicate.title).toBe("Create issue");
      expect(duplicateArtifact.id).toBe(artifact.id);
      expect(store.stepsForJourney(journey.id)).toHaveLength(1);
      expect(store.artifactsForJourney(journey.id)).toHaveLength(1);
    });
  });

  it("records callback handoff state and completes the journey when all steps complete", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "do one thing" }, 100);
      const step = store.addStep(journey.id, { owner: "archus", title: "Read issue" }, 110);

      const dispatched = store.dispatchStep(step.id, { deadlineAt: 1_000 }, 120);
      expect(dispatched).toMatchObject({ status: "dispatched", dispatchedAt: 120, deadlineAt: 1_000 });

      const completed = store.completeStep(step.id, { target: "AlfaBlok/zenod#123", url: "https://github.test/123" }, 130);
      expect(completed).toMatchObject({ status: "completed", completedAt: 130, error: null });
      expect(store.completeJourneyIfReady(journey.id, 140)).toBe(true);

      const snapshot = store.snapshot(journey.id)!;
      expect(snapshot.journey).toMatchObject({ status: "completed", completedAt: 140 });
      expect(snapshot.events.map((event) => event.type)).toEqual([
        "journey_created",
        "step_added",
        "step_dispatched",
        "step_completed",
        "journey_completed",
      ]);
    });
  });

  it("blocks overdue dispatched steps without touching future or pending steps", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "multi-step" }, 100);
      const overdue = store.addStep(journey.id, { owner: "archus", title: "callback due" }, 110);
      const future = store.addStep(journey.id, { owner: "epaminon", title: "callback later" }, 120);
      const pending = store.addStep(journey.id, { owner: "phylax", title: "notify at end", deadlineAt: 150 }, 130);
      store.dispatchStep(overdue.id, { deadlineAt: 200 }, 140);
      store.dispatchStep(future.id, { deadlineAt: 500 }, 150);

      const monitor = new JourneyMonitor(store, { now: () => 250 });
      const { blocked } = monitor.runOnce();

      expect(blocked.map((step) => step.id)).toEqual([overdue.id]);
      expect(store.getStep(overdue.id)).toMatchObject({ status: "blocked" });
      expect(store.getStep(future.id)).toMatchObject({ status: "dispatched" });
      expect(store.getStep(pending.id)).toMatchObject({ status: "pending" });
      expect(store.get(journey.id)).toMatchObject({ status: "blocked" });
      expect(store.eventsForJourney(journey.id).map((event) => event.type)).toContain("journey_blocked");
    });
  });

  it("claims due steps with a lease so another worker cannot claim the same step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-journeys-"));
    const path = join(dir, "journeys.sqlite");
    const firstStore = new JourneyStore(path);
    try {
      const journey = firstStore.create({ surface: "console", originalRequest: "claim work" }, 100);
      const due = firstStore.addStep(journey.id, { owner: "archus", title: "due now", wakeAt: 200 }, 110);
      firstStore.addStep(journey.id, { owner: "epaminon", title: "later", wakeAt: 5_000 }, 120);

      const claimed = firstStore.claimDueSteps(250, 1_000);
      expect(claimed).toEqual([expect.objectContaining({ id: due.id, attemptCount: 1, leaseUntil: 1_250 })]);

      const secondStore = new JourneyStore(path);
      try {
        expect(secondStore.claimDueSteps(250, 1_000)).toEqual([]);
        expect(secondStore.claimDueSteps(1_251, 1_000)).toEqual([
          expect.objectContaining({ id: due.id, attemptCount: 2, leaseUntil: 2_251 }),
        ]);
      } finally {
        secondStore.close();
      }
    } finally {
      firstStore.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not claim dependent steps until all dependencies complete", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "create and run issue" }, 100);
      const archus = store.addStep(journey.id, { owner: "archus", title: "Create issue", wakeAt: 100 }, 110);
      const epaminon = store.addStep(
        journey.id,
        { owner: "epaminon", title: "Run created issue", dependencyIds: [archus.id] },
        120,
      );

      expect(store.claimDueSteps(150, 1_000).map((step) => step.id)).toEqual([archus.id]);
      expect(store.claimDueSteps(1_151, 1_000)).toEqual([expect.objectContaining({ id: archus.id })]);

      store.completeStep(archus.id, { target: "zenod-ai/zenod#500" }, 200);

      expect(store.claimDueSteps(201, 1_000).map((step) => step.id)).toEqual([epaminon.id]);
      expect(store.eventsForJourney(journey.id).map((event) => event.type)).toContain("step_ready");
    });
  });

  it("marks running callbacks distinctly from dispatch", async () => {
    await withStore((store) => {
      const journey = store.create({ surface: "console", originalRequest: "long task" }, 100);
      const step = store.addStep(journey.id, { owner: "epaminon", title: "Run issue" }, 110);
      const running = store.runStep(step.id, { deadlineAt: 500 }, 120);

      expect(running).toMatchObject({ status: "running", deadlineAt: 500, dispatchedAt: 120 });
      expect(store.eventsForJourney(journey.id).map((event) => event.type)).toContain("step_running");
    });
  });

  it("survives reopening the sqlite file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-journeys-"));
    const path = join(dir, "journeys.sqlite");
    const first = new JourneyStore(path);
    const journey = first.create({ conversationId: "thread-1", surface: "web", originalRequest: "remember this" }, 10);
    const step = first.addStep(journey.id, { owner: "zenod", title: "Store memory" }, 20);
    first.dispatchStep(step.id, { deadlineAt: 100 }, 30);
    first.close();

    const second = new JourneyStore(path);
    try {
      expect(second.snapshot(journey.id)).toMatchObject({
        journey: { id: journey.id, conversationId: "thread-1", status: "active" },
        steps: [{ id: step.id, status: "dispatched", deadlineAt: 100 }],
      });
    } finally {
      second.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates a database created with the first minimal journey schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-journeys-"));
    const path = join(dir, "journeys.sqlite");
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE journeys (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        surface TEXT NOT NULL,
        original_request TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE journey_steps (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        owner TEXT NOT NULL,
        title TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        dispatch_after INTEGER,
        deadline_at INTEGER,
        dispatched_at INTEGER,
        completed_at INTEGER,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE journey_events (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        step_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
    `);
    db.close();

    const store = new JourneyStore(path);
    try {
      const journey = store.create({ surface: "console", originalRequest: "after migration" }, 10);
      const step = store.addStep(journey.id, { owner: "archus", title: "migrated", wakeAt: 20, idempotencyKey: "idem-1" }, 20);
      store.addArtifact(journey.id, { stepId: step.id, kind: "github_issue", artifactKey: "github:repo#7" }, 30);
      expect(store.snapshot(journey.id)).toMatchObject({
        steps: [expect.objectContaining({ idempotencyKey: "idem-1", wakeAt: 20 })],
        artifacts: [expect.objectContaining({ artifactKey: "github:repo#7" })],
      });
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
