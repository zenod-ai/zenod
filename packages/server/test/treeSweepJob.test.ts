import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, TreeSweepInput, TreeSweepResult } from "zenod";

import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore, type KeeperWakeJobResult, type TreeSweepJobResult } from "../src/taskJobStore.js";
import {
  keeperDayKey,
  keeperEarlyKey,
  nextKeeperWakeAt,
  inTreeSweepWindow,
  nextTreeSweepAt,
  treeSweepSuggestion,
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

  it("suggests one console line only when the sweep left proposals", () => {
    const base: TreeSweepJobResult = { kind: "tree_sweep", status: "swept", committed: true, revision: "abc", counts: {
      workingRoots: 4, staleRoots: 0, receiptsSeen: 3, receiptsRefiled: 2, receiptsArchived: 1, receiptsSkipped: 0,
      duplicateGroups: 0, proposals: 0, filesChanged: 5, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0 } };
    expect(treeSweepSuggestion(base)).toBeNull();
    expect(treeSweepSuggestion(undefined)).toBeNull();
    const line = treeSweepSuggestion({ ...base, proposalsPage: "Inbox/Tree sweep.md", counts: { ...base.counts!, staleRoots: 1, duplicateGroups: 2, proposals: 3 } });
    expect(line).toBe("Memory sweep: 1 ongoing topic has had no new capture in a month (keep, close or fold?); 2 sets of pages share a title (merge?). Details in Inbox/Tree sweep.md.");
    expect(line!.split("\n")).toHaveLength(1);
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
          hasTree: true, today: "2026-11-08", staleDays: 30,
          counts: { workingRoots: 4, staleRoots: 1, receiptsSeen: 2, receiptsRefiled: 1, receiptsArchived: 1, receiptsSkipped: 0,
            duplicateGroups: 0, proposals: 1, filesChanged: 4, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0 },
          staleRoots: [{ name: "Private topic", path: "Projects/Private topic.md", lastCapture: "2026-09-01", days: 68 }],
          duplicates: [], receipts: [], changedPaths: [],
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
        kind: "tree_sweep", status: "swept", committed: true, revision: "f00d", proposalsPage: "Inbox/Tree sweep.md",
        counts: expect.objectContaining({ staleRoots: 1, receiptsRefiled: 1, proposals: 1 }),
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

describe("E9-5c memory-keeper wakes", () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
  async function store(): Promise<TaskJobStore> {
    const dir = await mkdtemp(join(tmpdir(), "zenod-e95c-job-"));
    dirs.push(dir);
    return new TaskJobStore(join(dir, "tasks.sqlite"), "tenant-a");
  }
  async function waitFor(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("keys one daily wake and at most one early digestion per UTC day; next wake is tonight's window", () => {
    expect(keeperDayKey(at("2026-11-03T02:10:00Z"))).toBe("keeper:day:2026-11-03");
    expect(keeperEarlyKey(at("2026-11-03T02:10:00Z"))).toBe("tree-sweep:early:2026-11-03");
    expect(nextKeeperWakeAt(at("2026-11-02T18:00:00Z"), false).toISOString()).toBe("2026-11-03T02:00:00.000Z");
    expect(nextKeeperWakeAt(at("2026-11-03T01:00:00Z"), false).toISOString()).toBe("2026-11-03T02:00:00.000Z");
    expect(nextKeeperWakeAt(at("2026-11-03T03:00:00Z"), false).toISOString()).toBe("2026-11-03T03:00:00.000Z");
    expect(nextKeeperWakeAt(at("2026-11-03T03:00:00Z"), true).toISOString()).toBe("2026-11-04T02:00:00.000Z");
  });

  it("runs the daily wake past the AI allowance, counts only; digestion gets its mode and the cap reading", async () => {
    const jobs = await store();
    const keeperDaily = vi.fn(async () => ({ day: "2026-11-03", ownCapturesSinceDigestion: 12, waitingForTopic: 11, earlyDigestion: true, indexChanged: 4, modelCalls: 0 as const }));
    const sweepTree = vi.fn(async (input?: TreeSweepInput): Promise<TreeSweepResult> => ({
      committed: false, revision: null,
      keeper: { mode: input?.mode ?? "weekly", budget: 3, changes: 0, waiting: 2, rootsBefore: 5, rootsAfter: 5, stable: 5, recentLines: 0, modelCalls: 0, costUsd: 0, capUsd: 0.05, capReached: (input?.digestionSpentUsd ?? 0) >= 0.05 },
      report: { hasTree: true, today: "2026-11-03", staleDays: 30, counts: { workingRoots: 3, staleRoots: 0, receiptsSeen: 0, receiptsRefiled: 0, receiptsArchived: 0, receiptsSkipped: 0,
        duplicateGroups: 0, proposals: 0, filesChanged: 0, treeLintErrorsBefore: 0, treeLintErrorsAfter: 0 }, staleRoots: [], duplicates: [], receipts: [], changedPaths: [] },
    } as unknown as TreeSweepResult));
    const engine = { keeperDaily, sweepTree } as unknown as BrainEngine;
    const queue = new TaskJobQueue(jobs, async () => engine, undefined, undefined, () => ({ message: "over allowance", resetsAt: "x" }));
    queue.digestionSpentUsd = () => 0.01;
    try {
      const wake = queue.enqueue("keeper_wake", {}, "keeper:day:2026-11-03");
      const early = queue.enqueue("tree_sweep", { digestionMode: "early" }, "tree-sweep:early:2026-11-03");
      await waitFor(() => jobs.get(wake.id)?.status === "done" && jobs.get(early.id)?.status === "done");
      expect(jobs.get(wake.id)!.result as KeeperWakeJobResult).toEqual({ kind: "keeper_wake", status: "woke", day: "2026-11-03", ownCapturesSinceDigestion: 12, waitingForTopic: 11, earlyDigestion: true, indexChanged: 4, modelCalls: 0 });
      expect(queue.enqueue("keeper_wake", {}, "keeper:day:2026-11-03").id).toBe(wake.id);

      // At the AI allowance the digestion still runs (structure is free) but reads as capped: no model call.
      expect(sweepTree.mock.calls[0]![0]).toMatchObject({ mode: "early", digestionSpentUsd: Number.POSITIVE_INFINITY });
      expect((jobs.get(early.id)!.result as TreeSweepJobResult).keeper).toMatchObject({ mode: "early", capReached: true, costUsd: 0 });
    } finally {
      await queue.close();
    }
  });
});
