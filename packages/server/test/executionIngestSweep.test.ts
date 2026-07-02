import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runExecutionIngestSweep } from "../src/executionIngestSweep.js";
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

describe("runExecutionIngestSweep (R1-T2 production seam)", () => {
  it("files once for a recorded RUNNING execution that the authority now reports terminal", async () => {
    await withStore(async (store) => {
      const jid = seedJourney(store, "exec-1", ticket({ state: "running" }) as unknown as Record<string, unknown>);
      const filed: string[] = [];
      const deps = {
        store,
        readExecution: async () => ticket({ state: "done", deliverable }),
        fileMemory: async ({ content }: { content: string }) => {
          filed.push(content);
          return { evidenceRef: "Log/x.md#^e" };
        },
      };
      const r1 = await runExecutionIngestSweep(deps);
      expect(r1).toMatchObject({ filed: 1, refreshed: 1 });
      expect(filed[0]).toContain("AlfaBlok/obsidian-brain#201");
      // The artifact was refreshed to the terminal ticket (fetch tool now sees the manifest).
      const snap = store.snapshot(jid)!;
      const record = snap.artifacts.find((a) => a.kind === "execution_record")!;
      expect((record.data as Record<string, unknown>).state).toBe("done");
      expect(snap.artifacts.some((a) => a.kind === "zenod_ingest")).toBe(true);

      // Second pass is a no-op (guarded).
      const r2 = await runExecutionIngestSweep(deps);
      expect(r2.filed).toBe(0);
      expect(filed).toHaveLength(1);
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
          return { evidenceRef: "Log/x.md#^e" };
        },
      });
      expect(files).toBe(1);
      expect(r.filed).toBe(1);
    });
  });

  it("retries on filing failure (no guard written)", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "done", deliverable }) as unknown as Record<string, unknown>);
      let attempts = 0;
      const deps = {
        store,
        readExecution: async () => null,
        fileMemory: async () => {
          attempts += 1;
          return attempts === 1 ? null : { evidenceRef: "Log/x.md#^e" };
        },
      };
      expect((await runExecutionIngestSweep(deps)).filed).toBe(0);
      expect((await runExecutionIngestSweep(deps)).filed).toBe(1);
      expect(attempts).toBe(2);
    });
  });

  it("guards a terminal execution with no deliverable so it is not re-checked forever", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "done" }) as unknown as Record<string, unknown>);
      let reads = 0;
      const deps = {
        store,
        readExecution: async () => {
          reads += 1;
          return null;
        },
        fileMemory: async () => ({ evidenceRef: "x" }),
      };
      const r1 = await runExecutionIngestSweep(deps);
      expect(r1.skipped).toBe(1);
      const r2 = await runExecutionIngestSweep(deps);
      expect(r2.checked).toBe(0); // guarded — no re-check, no authority reads
      expect(reads).toBe(0); // recorded state was already terminal; authority never consulted
    });
  });

  it("leaves a still-running execution alone for the next pass", async () => {
    await withStore(async (store) => {
      seedJourney(store, "exec-1", ticket({ state: "running" }) as unknown as Record<string, unknown>);
      const r = await runExecutionIngestSweep({
        store,
        readExecution: async () => ticket({ state: "running" }),
        fileMemory: async () => ({ evidenceRef: "x" }),
      });
      expect(r).toMatchObject({ checked: 1, filed: 0, refreshed: 0, skipped: 0 });
    });
  });
});
