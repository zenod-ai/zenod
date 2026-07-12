import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HERALD_MAX_PROPOSAL_COUNT,
  HERALD_MIN_CADENCE_MINUTES,
  HeraldLoopScheduler,
  HeraldLoopStore,
  type HeraldBriefingContent,
  type HeraldProposalInput,
  type HeraldWakeReceipt,
} from "../src/heraldLoop.js";

const briefing: HeraldBriefingContent = {
  theme: "Build in public",
  objectives: ["Show the shipped loop"],
  tone: "specific and calm",
  replyPolicy: "few",
};

const proposal = (index = 1): HeraldProposalInput => ({
  text: `Proposal ${index}`,
  rationale: `Because filing ${index} says this worked`,
  memoryCitation: `https://zenod.dev/memory/filing-${index}`,
});

async function withStore<T>(fn: (store: HeraldLoopStore, path: string) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-herald-loop-"));
  const path = join(dir, "herald.sqlite");
  const store = new HeraldLoopStore(path);
  try {
    return await fn(store, path);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("HeraldLoopStore", () => {
  it("versions tenant briefings, enforces production floors/caps, and persists WAL data", async () => {
    await withStore((store) => {
      const first = store.approveBriefing({ tenantId: "alpha", content: briefing, cadenceMinutes: 1, proposalCount: 99 }, 100);
      const second = store.approveBriefing({ tenantId: "alpha", content: { ...briefing, tone: "direct" }, cadenceMinutes: 30 }, 200);

      expect(first.briefing).toMatchObject({
        tenantId: "alpha",
        version: 1,
        cadenceMinutes: HERALD_MIN_CADENCE_MINUTES,
        proposalCount: HERALD_MAX_PROPOSAL_COUNT,
      });
      expect(first.receipt).toMatchObject({ status: "ok", code: "briefing_approved", tenantId: "alpha" });
      expect(second.briefing).toMatchObject({ version: 2, cadenceMinutes: 30, proposalCount: 3 });

      const db = (store as unknown as { db: DatabaseSync }).db;
      const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      const timeout = db.prepare("PRAGMA busy_timeout").get() as Record<string, number>;
      expect(String(journal.journal_mode).toLowerCase()).toBe("wal");
      expect(Number(timeout.timeout ?? timeout.busy_timeout ?? Object.values(timeout)[0])).toBe(30_000);
    });
  });

  it("keeps board items, filing receipts, mutations, and reads tenant-scoped", async () => {
    await withStore((store) => {
      store.approveBriefing({ tenantId: "alpha", content: briefing, cadenceMinutes: 15 }, 10);
      const alphaWake = store.tryStartWake("alpha", "run_now", 20)!;
      const alpha = store.createProposals("alpha", alphaWake, [proposal(1)], 30);
      store.finishWake(alphaWake, {
        status: "completed",
        code: "wake_completed",
        message: "one proposal",
        proposalIds: [alpha.items[0].id],
      }, 31);

      const betaWake = store.tryStartWake("beta", "run_now", 40)!;
      const beta = store.createProposals("beta", betaWake, [proposal(2)], 50);
      store.finishWake(betaWake, {
        status: "completed",
        code: "wake_completed",
        message: "one proposal",
        proposalIds: [beta.items[0].id],
      }, 51);

      expect(store.listBoardItems("alpha")).toEqual([
        expect.objectContaining({
          tenantId: "alpha",
          state: "proposed",
          rationale: proposal(1).rationale,
          memoryCitation: proposal(1).memoryCitation,
          permalink: null,
        }),
      ]);
      expect(store.getBoardItem("alpha", beta.items[0].id)).toBeNull();
      expect(store.decideItems("alpha", {
        approveIds: [alpha.items[0].id],
        rejectIds: [beta.items[0].id],
      }, 55)).toMatchObject({ status: "error", code: "invalid_board_decision" });
      expect(store.getBoardItem("alpha", alpha.items[0].id)?.state).toBe("proposed");
      expect(store.getBoardItem("beta", beta.items[0].id)?.state).toBe("proposed");
      expect(store.approveItems("beta", [alpha.items[0].id], 60)).toMatchObject({ status: "error", code: "invalid_board_transition" });

      expect(store.approveItems("alpha", [alpha.items[0].id], 70)).toMatchObject({ status: "ok", code: "items_approved" });
      expect(store.markPosted("alpha", alpha.items[0].id, "https://x.com/zenod/status/123", 80)).toMatchObject({
        status: "ok",
        code: "item_posted",
      });
      expect(store.getBoardItem("alpha", alpha.items[0].id)).toMatchObject({
        state: "posted",
        permalink: "https://x.com/zenod/status/123",
        approvedAt: 70,
        postedAt: 80,
      });

      const filing = store.recordFiling({
        tenantId: "alpha",
        kind: "post_outcome",
        content: "Posted proposal one",
        memoryCitation: proposal(1).memoryCitation,
        commitReceipt: "abc123",
      }, 90);
      expect(filing.receipt).toMatchObject({ status: "ok", code: "filing_recorded", tenantId: "alpha" });
      expect(store.listFilings("alpha")).toEqual([expect.objectContaining({ commitReceipt: "abc123" })]);
      expect(store.listFilings("beta")).toEqual([]);
    });
  });
});

describe("HeraldLoopScheduler", () => {
  it("refuses loudly without an approved briefing and publishes the chat receipt", async () => {
    await withStore(async (store) => {
      const visible: HeraldWakeReceipt[] = [];
      const scheduler = new HeraldLoopScheduler(store, {
        runWake: async () => [proposal()],
        onReceipt: (receipt) => visible.push(receipt),
        log: { info: () => undefined, error: () => undefined },
      });

      await expect(scheduler.runNow("alpha")).resolves.toMatchObject({
        status: "refused",
        code: "briefing_required",
        message: expect.stringContaining("no approved briefing"),
      });
      expect(visible).toEqual([expect.objectContaining({ code: "briefing_required" })]);
      expect(store.recentWakeReceipts("alpha")).toEqual([expect.objectContaining({ code: "briefing_required" })]);
    });
  });

  it("uses the same wake path, caps N, and prevents proposal pile-up", async () => {
    await withStore(async (store) => {
      store.approveBriefing({ tenantId: "alpha", content: briefing, cadenceMinutes: 15, proposalCount: 99 }, 0);
      let handlerCalls = 0;
      const visible: HeraldWakeReceipt[] = [];
      const scheduler = new HeraldLoopScheduler(store, {
        now: () => 1_000_000,
        runWake: async ({ proposalCount }) => {
          handlerCalls += 1;
          expect(proposalCount).toBe(HERALD_MAX_PROPOSAL_COUNT);
          return Array.from({ length: 12 }, (_, index) => proposal(index + 1));
        },
        onReceipt: (receipt) => visible.push(receipt),
        log: { info: () => undefined, error: () => undefined },
      });

      const completed = await scheduler.runNow("alpha");
      expect(completed).toMatchObject({
        status: "completed",
        code: "wake_completed",
      });
      expect(completed.proposalIds).toHaveLength(HERALD_MAX_PROPOSAL_COUNT);
      await expect(scheduler.runNow("alpha")).resolves.toMatchObject({
        status: "skipped",
        code: "proposal_pileup",
      });
      expect(handlerCalls).toBe(1);
      expect(store.listBoardItems("alpha")).toHaveLength(HERALD_MAX_PROPOSAL_COUNT);
      expect(visible.map((receipt) => receipt.code)).toEqual(["wake_completed", "proposal_pileup"]);
    });
  });

  it("permits only one concurrent wake per tenant while other tenants remain isolated", async () => {
    await withStore(async (store) => {
      store.approveBriefing({ tenantId: "alpha", content: briefing, cadenceMinutes: 15, proposalCount: 1 }, 0);
      store.approveBriefing({ tenantId: "beta", content: briefing, cadenceMinutes: 15, proposalCount: 1 }, 0);
      let releaseAlpha!: () => void;
      const alphaGate = new Promise<void>((resolve) => { releaseAlpha = resolve; });
      const scheduler = new HeraldLoopScheduler(store, {
        now: () => 1_000_000,
        runWake: async ({ tenantId }) => {
          if (tenantId === "alpha") await alphaGate;
          return [proposal()];
        },
        onReceipt: () => undefined,
        log: { info: () => undefined, error: () => undefined },
      });

      const firstAlpha = scheduler.runNow("alpha");
      await Promise.resolve();
      await expect(scheduler.runNow("alpha")).resolves.toMatchObject({ status: "skipped", code: "wake_in_progress" });
      await expect(scheduler.runNow("beta")).resolves.toMatchObject({ status: "completed", code: "wake_completed" });
      releaseAlpha();
      await expect(firstAlpha).resolves.toMatchObject({ status: "completed", code: "wake_completed" });

      expect(store.listBoardItems("alpha")).toHaveLength(1);
      expect(store.listBoardItems("beta")).toHaveLength(1);
    });
  });

  it("ticks only after the production cadence interval and does not shorten the clock", async () => {
    await withStore(async (store) => {
      let now = 0;
      store.approveBriefing({ tenantId: "alpha", content: briefing, cadenceMinutes: 1, proposalCount: 1 }, now);
      let runs = 0;
      const scheduler = new HeraldLoopScheduler(store, {
        now: () => now,
        runWake: async () => {
          runs += 1;
          return [];
        },
        onReceipt: () => undefined,
        log: { info: () => undefined, error: () => undefined },
      });

      now = HERALD_MIN_CADENCE_MINUTES * 60_000 - 1;
      await expect(scheduler.tick()).resolves.toEqual([]);
      now += 1;
      await expect(scheduler.tick()).resolves.toEqual([expect.objectContaining({ code: "wake_completed" })]);
      await expect(scheduler.tick()).resolves.toEqual([]);
      expect(runs).toBe(1);
    });
  });
});
