import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runExecutionIngestSweep, type IngestGuardData, type MemoryJobStatus } from "../src/executionIngestSweep.js";
import { JourneyStore } from "../src/journeyStore.js";
import type { ExecutionTicket } from "../src/executionQueue.js";

async function withStore<T>(fn: (store: JourneyStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-ingest-sweep-"));
  const store = new JourneyStore(join(dir, "journeys.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const deliverable = {
  repo: "AlfaBlok/obsidian-brain",
  issue: 201,
  merged: false,
  handoffExcerpt: "smoke observed; Deliverables: none",
  paths: ["notes/smoke.md"],
};

function ticket(patch: Partial<ExecutionTicket>): ExecutionTicket {
  return { executionId: "exec-1", target: "AlfaBlok/obsidian-brain#201", context: "smoke", state: "running", updatedAt: 1, ...patch };
}

function seedJourney(store: JourneyStore, executionId: string, data: Record<string, unknown>): string {
  const journey = store.create({ surface: "console", originalRequest: "run" }, 100);
  store.addArtifact(journey.id, { kind: "execution_record", artifactKey: `execution:${executionId}`, data }, 110);
  return journey.id;
}

function guardOf(store: JourneyStore, journeyId: string): IngestGuardData | undefined {
  return store.snapshot(journeyId)?.artifacts.find((a) => a.kind === "zenod_ingest")?.data as IngestGuardData | undefined;
}

describe("runExecutionIngestSweep (R1-T2 production seam, pending-guard lifecycle)", () => {
  it("starts a pending guard on acceptance, finalizes to filed only when the job completes", async () => {
    await withStore(async (store) => {
      const jid = seedJourney(store, "exec-1", ticket({ state: "running" }) as unknown as Record<string, unknown>);
      let jobState: MemoryJobStatus = { status: "running" };
      const filedContents: string[] = [];
      const deps = {
        store,
        readExecution: async () => ticket({ state: "done", deliverable }),
        fileMemory: async ({ content }: { content: string }) => {
          filedContents.push(content);
          return { jobId: "job-1" };
        },
        pollMemoryJob: async () => jobState,
      };

      // Pass 1: authority reports terminal → refresh + start filing → PENDING guard.
      const r1 = await runExecutionIngestSweep(deps);
      expect(r1).toMatchObject({ refreshed: 1, started: 1, filed: 0 });
      expect(filedContents[0]).toContain("AlfaBlok/obsidian-brain#201");
      expect(guardOf(store, jid)).toMatchObject({ status: "pending", jobId: "job-1", attempts: 1 });
      // The artifact was refreshed to the terminal ticket (fetch tool sees the manifest).
      const record = store.snapshot(jid)!.artifacts.find((a) => a.kind === "execution_record")!;
      expect((record.data as Record<string, unknown>).state).toBe("done");

      // Pass 2: job still running → guard unchanged, no re-file.
      const r2 = await runExecutionIngestSweep(deps);
      expect(r2.filed).toBe(0);
      expect(filedContents).toHaveLength(1);

      // Pass 3: job done → guard finalized with the evidence ref.
      jobState = { status: "done", evidenceRef: "Log/2026-07-02.md#^e-exec" };
      const r3 = await runExecutionIngestSweep(deps);
      expect(r3.filed).toBe(1);
      expect(guardOf(store, jid)).toMatchObject({ status: "filed", evidenceRef: "Log/2026-07-02.md#^e-exec" });

      // Pass 4: finished lifecycle → fully inert.
      const r4 = await runExecutionIngestSweep(deps);
      expect(r4).toMatchObject({ checked: 0, started: 0, filed: 0 });
    });
  });

  it("re-files on job error and gives up loudly after MAX_ATTEMPTS, recording why", async () => {
    await withStore(async (store) => {
      const jid = seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      let jobs = 0;
      const deps = {
        store,
        readExecution: async () => null,
        fileMemory: async () => {
          jobs += 1;
          return { jobId: `job-${jobs}` };
        },
        // Every job fails — the 2026-07-02 out-of-credits shape.
        pollMemoryJob: async () => ({ status: "error", error: "requires more credits" }) as MemoryJobStatus,
      };

      await runExecutionIngestSweep(deps); // start job-1 (attempts 1)
      await runExecutionIngestSweep(deps); // job-1 error → re-file job-2 (attempts 2)
      await runExecutionIngestSweep(deps); // job-2 error → re-file job-3 (attempts 3)
      const r = await runExecutionIngestSweep(deps); // job-3 error, attempts maxed → gave-up
      expect(jobs).toBe(3);
      expect(r.gaveUp).toBe(1);
      expect(guardOf(store, jid)).toMatchObject({ status: "gave-up", error: expect.stringContaining("credits") });

      // Gave-up is terminal: no further filing attempts.
      await runExecutionIngestSweep(deps);
      expect(jobs).toBe(3);
    });
  });

  it("files at most once per executionId even across multiple journeys", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      let files = 0;
      const r = await runExecutionIngestSweep({
        store,
        readExecution: async () => null,
        fileMemory: async () => {
          files += 1;
          return { jobId: "job-1" };
        },
        pollMemoryJob: async () => ({ status: "running" }) as MemoryJobStatus,
      });
      expect(files).toBe(1);
      expect(r.started).toBe(1);
    });
  });

  it("retries acceptance failure on the next pass (no guard written)", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      let attempts = 0;
      const deps = {
        store,
        readExecution: async () => null,
        fileMemory: async () => {
          attempts += 1;
          return attempts === 1 ? null : { jobId: "job-2" };
        },
        pollMemoryJob: async () => null,
      };
      expect((await runExecutionIngestSweep(deps)).started).toBe(0);
      expect((await runExecutionIngestSweep(deps)).started).toBe(1);
      expect(attempts).toBe(2);
    });
  });

  it("guards a terminal execution with no deliverable so it is not re-checked forever", async () => {
    await withStore(async (store) => {
      const jid = seedJourney(store, "exec-1", ticket({ state: "done" }) as unknown as Record<string, unknown>);
      const deps = {
        store,
        readExecution: async () => null,
        fileMemory: async () => ({ jobId: "x" }),
        pollMemoryJob: async () => null,
      };
      expect((await runExecutionIngestSweep(deps)).skipped).toBe(1);
      expect(guardOf(store, jid)).toMatchObject({ status: "skipped" });
      expect((await runExecutionIngestSweep(deps)).checked).toBe(0);
    });
  });

  it("upgrades a legacy acceptance-time guard (no status) to the pending lifecycle", async () => {
    await withStore(async (store) => {
      const jid = seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      // The pre-lifecycle code wrote guards at acceptance with just executionId+evidenceRef.
      store.addArtifact(jid, { kind: "zenod_ingest", artifactKey: "zenod-ingest:exec-1", data: { executionId: "exec-1", evidenceRef: '{"jobId":"old","status":"queued"}' } }, 120);
      let files = 0;
      const deps = {
        store,
        readExecution: async () => null,
        fileMemory: async () => {
          files += 1;
          return { jobId: "job-new" };
        },
        pollMemoryJob: async () => ({ status: "done", evidenceRef: "Log/x.md#^e" }) as MemoryJobStatus,
      };
      const r1 = await runExecutionIngestSweep(deps);
      expect(files).toBe(1);
      expect(r1.started).toBe(1);
      expect(guardOf(store, jid)).toMatchObject({ status: "pending", jobId: "job-new" });
      // Next pass finalizes normally.
      const r2 = await runExecutionIngestSweep(deps);
      expect(r2.filed).toBe(1);
      expect(guardOf(store, jid)).toMatchObject({ status: "filed" });
    });
  });

  it("leaves a still-running execution alone for the next pass", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "running" }) as unknown as Record<string, unknown>);
      const r = await runExecutionIngestSweep({
        store,
        readExecution: async () => ticket({ state: "running" }),
        fileMemory: async () => ({ jobId: "x" }),
        pollMemoryJob: async () => null,
      });
      expect(r).toMatchObject({ checked: 1, started: 0, refreshed: 0, skipped: 0 });
    });
  });
});
