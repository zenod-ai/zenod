import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, TreeSweepInput, TreeSweepResult } from "zenod";

import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore, type TreeSweepJobResult } from "../src/taskJobStore.js";
import {
  inTreeSweepWindow,
  nextTreeSweepAt,
  treeSweepWeekKey,
  treeSweepWeekStart,
} from "../src/treeSweepSchedule.js";

const at = (iso: string) => Date.parse(iso);

describe("E9-2d tree sweep schedule", () => {
  it("keys each week by its Sunday 02:00 UTC start", () => {
    // 2026-11-08 is a Sunday.
    expect(new Date(treeSweepWeekStart(at("2026-11-08T02:00:00Z"))).toISOString()).toBe("2026-11-08T02:00:00.000Z");
    expect(treeSweepWeekKey(at("2026-11-08T01:59:00Z"))).toBe("tree-sweep:week:2026-11-01");
    expect(treeSweepWeekKey(at("2026-11-08T02:00:00Z"))).toBe("tree-sweep:week:2026-11-08");
    expect(treeSweepWeekKey(at("2026-11-14T23:00:00Z"))).toBe("tree-sweep:week:2026-11-08");
  });

  it("runs only off-peak, 02:00–06:00 UTC", () => {
    expect(inTreeSweepWindow(at("2026-11-08T01:59:00Z"))).toBe(false);
    expect(inTreeSweepWindow(at("2026-11-08T02:00:00Z"))).toBe(true);
    expect(inTreeSweepWindow(at("2026-11-08T05:59:00Z"))).toBe(true);
    expect(inTreeSweepWindow(at("2026-11-08T06:00:00Z"))).toBe(false);
    expect(inTreeSweepWindow(at("2026-11-04T14:00:00Z"))).toBe(false);
  });

  it("reports the next run: tonight's window while this week is still due, else next Sunday", () => {
    expect(nextTreeSweepAt(at("2026-11-02T14:00:00Z"), false).toISOString()).toBe("2026-11-03T02:00:00.000Z");
    expect(nextTreeSweepAt(at("2026-11-02T01:00:00Z"), false).toISOString()).toBe("2026-11-02T02:00:00.000Z");
    expect(nextTreeSweepAt(at("2026-11-02T03:00:00Z"), false).toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(nextTreeSweepAt(at("2026-11-02T14:00:00Z"), true).toISOString()).toBe("2026-11-08T02:00:00.000Z");
  });
});

describe("E9-2d tree sweep job", () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

  async function store(): Promise<TaskJobStore> {
    const dir = await mkdtemp(join(tmpdir(), "zenod-e92d-job-"));
    dirs.push(dir);
    return new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-a");
  }

  async function waitFor(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("runs past the AI allowance (no model), stores counts only, and is once per week key", async () => {
    const jobs = await store();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sweepTree = vi.fn(async (input?: TreeSweepInput): Promise<TreeSweepResult> => {
      order.push(`sweep:${(input?.skipEvidenceRefs ?? []).join(",")}`);
      return {
        committed: true,
        revision: { provider: "github", id: "f00d", committedAt: "2026-11-08T03:00:00Z", urls: [] },
        report: {
          hasTree: true, today: "2026-11-08",
          counts: { workingRoots: 4, receiptsSeen: 2, receiptsRefiled: 1, receiptsArchived: 1, receiptsSkipped: 0,
            rootOnlyCitations: 0, citationsDeepened: 0, filesChanged: 4, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0 },
          receipts: [{ path: "Inbox/filing-private-topic.md", outcome: "refiled", reason: "Private topic", pages: ["Projects/Private topic.md"] }],
          deepened: [], roots: [], changedPaths: [], lintErrorsBefore: [],
        },
      };
    });
    const enrichEvidence = vi.fn(async () => {
      order.push("filing:start");
      await gate;
      order.push("filing:end");
      return { evidenceRef: "Log/2026-11-08.md#^e-aaaaaa", pagesTouched: [], commitSha: "c".repeat(40), githubUrls: [], filing: "filed" as const };
    });
    const engine = { sweepTree, enrichEvidence } as unknown as BrainEngine;
    const queue = new TaskJobQueue(jobs, async () => engine, undefined, undefined, () => ({ message: "over allowance", resetsAt: "x" }));
    try {
      queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-08.md#^e-aaaaaa", content: "x" }, "capture-1");
      // Over the AI allowance on purpose: the filing stops, the sweep (no model) still runs.
      const sweep = queue.enqueue("tree_sweep", {}, "tree-sweep:week:2026-11-08");
      await waitFor(() => jobs.get(sweep.id)?.status === "done");
      release();
      const result = jobs.get(sweep.id)!.result as TreeSweepJobResult;
      expect(result).toEqual({
        kind: "tree_sweep", status: "swept", committed: true, revision: "f00d",
        counts: expect.objectContaining({ receiptsRefiled: 1 }),
      });
      // Counts only: the stored receipt never carries a topic name.
      expect(JSON.stringify(result)).not.toContain("Private topic");
      // Same week key → the same job, never a second sweep.
      expect(queue.enqueue("tree_sweep", {}, "tree-sweep:week:2026-11-08").id).toBe(sweep.id);
      expect(sweepTree).toHaveBeenCalledTimes(1);
      expect(jobs.latestOfKind("tree_sweep")!.id).toBe(sweep.id);
      expect(jobs.getByIdempotencyKey("tree-sweep:week:2026-11-08")!.id).toBe(sweep.id);
    } finally {
      release();
      await queue.close();
    }
  });

  it("lists queued and running filings so the sweep leaves their receipts alone", async () => {
    const jobs = await store();
    jobs.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-08.md#^e-cccccc", content: "x" }, "capture-3");
    jobs.enqueue("store", { content: "y" }, "capture-4");
    expect(jobs.activeFilingEvidenceRefs()).toEqual(["Log/2026-11-08.md#^e-cccccc"]);
  });

  it("serializes with a running filing: the sweep starts only after the filing finishes", async () => {
    const jobs = await store();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const engine = {
      enrichEvidence: vi.fn(async () => {
        order.push("filing:start");
        await gate;
        order.push("filing:end");
        return { evidenceRef: "Log/2026-11-08.md#^e-bbbbbb", pagesTouched: [], commitSha: "d".repeat(40), githubUrls: [], filing: "filed" as const };
      }),
      sweepTree: vi.fn(async (input?: TreeSweepInput) => {
        order.push(`sweep:${(input?.skipEvidenceRefs ?? []).length}`);
        return { committed: false, revision: null, report: { hasTree: false } } as unknown as TreeSweepResult;
      }),
    } as unknown as BrainEngine;
    const queue = new TaskJobQueue(jobs, async () => engine);
    try {
      queue.enqueue("enrich_memory", { evidenceRef: "Log/2026-11-08.md#^e-bbbbbb", content: "x" }, "capture-2");
      const sweep = queue.enqueue("tree_sweep", {});
      await waitFor(() => order.includes("filing:start"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(order).toEqual(["filing:start"]);
      release();
      await waitFor(() => jobs.get(sweep.id)?.status === "done");
      expect(order).toEqual(["filing:start", "filing:end", "sweep:0"]);
      expect((jobs.get(sweep.id)!.result as TreeSweepJobResult).status).toBe("skipped");
    } finally {
      release();
      await queue.close();
    }
  });
});
