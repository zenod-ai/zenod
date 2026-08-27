import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PhylaxAllowanceLedger,
  PhylaxLedgerConflictError,
} from "../src/phylaxAllowanceLedger.js";

const dirs: string[] = [];
const JULY_START = Date.parse("2026-07-01T00:00:00.000Z");
const AUGUST_START = Date.parse("2026-08-01T00:00:00.000Z");
const SEPTEMBER_START = Date.parse("2026-09-01T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function ledger(
  name: string,
  now: () => number = () => AUGUST_START + 1,
): Promise<{ store: PhylaxAllowanceLedger; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), `phylax-ledger-${name}-`));
  dirs.push(dir);
  const path = join(dir, "phylax-allowance.sqlite");
  return { store: new PhylaxAllowanceLedger(path, now), path };
}

function grant(
  store: PhylaxAllowanceLedger,
  tenantId: string,
  amountUnits = 10_000,
  periodId = "2026-08",
) {
  return store.grantAllowance({
    tenantId,
    periodId,
    startsAt: AUGUST_START,
    endsAt: SEPTEMBER_START,
    amountUnits,
    source: "zenod",
    idempotencyKey: `grant:${tenantId}:${periodId}`,
    tariffVersion: "phylax-2026-08",
    auditReason: "host plan channel allocation",
  });
}

describe("PhylaxAllowanceLedger", () => {
  it("enumerates every ledger-backed tenant without relying on customer accounts", async () => {
    const { store } = await ledger("tenant-inventory");
    grant(store, "management-provisioned");
    grant(store, "native-checkout");

    expect(store.tenantIds()).toEqual(["management-provisioned", "native-checkout"]);

    store.close();
  });

  it("keeps issuer grants tenant-isolated, append-only and collision-safe", async () => {
    const { store } = await ledger("grants");
    const alpha = grant(store, "alpha", 10_000);
    const replay = grant(store, "alpha", 10_000);
    const beta = grant(store, "beta", 4_000);

    expect(alpha.replayed).toBe(false);
    expect(replay).toEqual({ entry: alpha.entry, replayed: true });
    expect(beta.replayed).toBe(false);
    expect(store.customerProjection("alpha")).toMatchObject({
      state: "active",
      allocatedUnits: 10_000,
      remainingUnits: 10_000,
      usageBasisPoints: 0,
    });
    expect(store.customerProjection("beta")).toMatchObject({
      allocatedUnits: 4_000,
      remainingUnits: 4_000,
    });
    expect(() => store.grantAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      startsAt: AUGUST_START,
      endsAt: SEPTEMBER_START,
      amountUnits: 9_999,
      source: "zenod",
      idempotencyKey: "grant:alpha:2026-08",
      tariffVersion: "phylax-2026-08",
      auditReason: "conflicting replay",
    })).toThrow(PhylaxLedgerConflictError);

    store.close();
  });

  it("records stable provider usage exactly once across retries and ledger instances", async () => {
    const { store: first, path } = await ledger("usage");
    grant(first, "alpha", 10_000);
    const second = new PhylaxAllowanceLedger(path, () => AUGUST_START + 1);
    const report = (store: PhylaxAllowanceLedger, idempotencyKey: string) => store.recordUsage({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 1_250,
      providerEventId: "wamid.voice-42",
      operation: "transcription.audio",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey,
      tariffVersion: "stt-2026-08",
      auditReason: "two minute transcription",
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => Promise.resolve()
        .then(() => report(index % 2 === 0 ? first : second, `retry-${index}`))),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entry.sequence))).toEqual(new Set([2]));
    expect(first.customerProjection("alpha")).toMatchObject({
      usedUnits: 1_250,
      remainingUnits: 8_750,
      usageBasisPoints: 1_250,
    });
    expect(first.operatorProjection("alpha", "2026-08").byUsage).toEqual([{
      operation: "transcription.audio",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      tariffVersion: "stt-2026-08",
      costBasis: "estimated",
      events: 1,
      units: 1_250,
    }]);
    expect(Object.keys(first.customerProjection("alpha"))).not.toContain("provider");
    expect(Object.keys(first.customerProjection("alpha"))).not.toContain("model");
    expect(Object.keys(first.customerProjection("alpha"))).not.toContain("costUsd");

    expect(() => first.recordUsage({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 1_251,
      providerEventId: "wamid.voice-42",
      operation: "transcription.audio",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey: "conflicting-provider-replay",
      tariffVersion: "stt-2026-08",
      auditReason: "conflicting report",
    })).toThrow(PhylaxLedgerConflictError);

    second.close();
    first.close();
  });

  it("rejects direct usage above currently unreserved allowance without inserting an entry", async () => {
    const { store } = await ledger("direct-cap");
    grant(store, "alpha", 100);
    const usage = {
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 101,
      providerEventId: "direct-cap-provider",
      operation: "whatsapp.delivery",
      provider: "whatsapp",
      costBasis: "actual" as const,
      idempotencyKey: "direct-cap-usage",
      tariffVersion: "delivery-v1",
      auditReason: "direct allowance cap regression",
    };

    expect(() => store.recordUsage(usage)).toThrow("currently unreserved allowance");
    expect(store.operatorProjection("alpha", "2026-08")).toMatchObject({
      usedUnits: 0,
      entries: [expect.objectContaining({ kind: "grant" })],
    });
    expect(store.customerProjection("alpha")).toMatchObject({ remainingUnits: 100, usedUnits: 0 });

    const allowed = store.recordUsage({ ...usage, amountUnits: 100 });
    expect(allowed.replayed).toBe(false);
    expect(store.recordUsage({ ...usage, amountUnits: 100 })).toMatchObject({
      replayed: true,
      entry: { sequence: allowed.entry.sequence },
    });
    expect(store.customerProjection("alpha")).toMatchObject({ remainingUnits: 0, usedUnits: 100 });
    store.close();
  });

  it("keeps customer credit reads non-mutating across an expired period and revision", async () => {
    let now = AUGUST_START + 1;
    const { store } = await ledger("read-only-expired-projection", () => now);
    store.grantAllowance({
      tenantId: "alpha",
      periodId: "short-period",
      startsAt: AUGUST_START,
      endsAt: AUGUST_START + 2,
      amountUnits: 100,
      source: "zenod",
      idempotencyKey: "grant:alpha:short-period",
      tariffVersion: "phylax-2026-08",
      auditReason: "short read-only projection regression period",
    });
    store.admitPaidWork({
      tenantId: "alpha",
      periodId: "short-period",
      idempotencyKey: "short-period-work",
      providerEventId: "short-period-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/short-period",
      estimatedUnits: 40,
    });
    now = AUGUST_START + 2;
    const revisionBeforeRead = store.revision("alpha");
    const workBeforeRead = store.pendingWork("alpha");

    expect(store.customerProjection("alpha", now)).toMatchObject({
      tenantId: "alpha",
      periodId: null,
      state: "unavailable",
    });
    expect(store.revision("alpha")).toBe(revisionBeforeRead);
    expect(store.operatorProjection("alpha", "short-period").expiredUnits).toBe(0);
    expect(store.pendingWork("alpha")).toEqual(workBeforeRead);

    expect(store.reconcileExpiredPeriods(now)).toBe(1);
    expect(store.revision("alpha")).not.toBe(revisionBeforeRead);
    expect(store.operatorProjection("alpha", "short-period").expiredUnits).toBe(100);
    expect(store.pendingWork("alpha")).toEqual([
      expect.objectContaining({ state: "paused", pauseReason: "period_inactive", reservedUnits: 0 }),
    ]);
    store.close();
  });

  it("rejects direct usage before its allowance period starts", async () => {
    let now = AUGUST_START - 1;
    const { store } = await ledger("usage-pre-start", () => now);
    grant(store, "alpha", 100);
    const usage = {
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 10,
      providerEventId: "pre-start-provider",
      operation: "whatsapp.delivery",
      provider: "whatsapp",
      costBasis: "actual" as const,
      idempotencyKey: "pre-start-usage",
      tariffVersion: "delivery-v1",
      auditReason: "period boundary regression",
    };

    expect(() => store.recordUsage(usage)).toThrow("active allowance period");
    expect(store.operatorProjection("alpha", "2026-08")).toMatchObject({
      grantedUnits: 100,
      usedUnits: 0,
      expiredUnits: 0,
    });
    expect(store.customerProjection("alpha", now)).toMatchObject({ state: "unavailable", periodId: null });
    now = AUGUST_START;
    expect(() => store.recordUsage({ ...usage, occurredAt: AUGUST_START - 1 })).toThrow("active allowance period");
    expect(store.recordUsage(usage).replayed).toBe(false);
    store.close();
  });

  it("makes exact-boundary and post-close direct usage independent of projection order and restart", async () => {
    let beforeProjectionNow = AUGUST_START + 1;
    const { store: beforeProjection, path } = await ledger(
      "usage-boundary-before-projection",
      () => beforeProjectionNow,
    );
    grant(beforeProjection, "alpha", 100);
    const usage = {
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 10,
      providerEventId: "closed-period-provider",
      operation: "whatsapp.delivery",
      provider: "whatsapp",
      costBasis: "actual" as const,
      idempotencyKey: "closed-period-usage",
      tariffVersion: "delivery-v1",
      auditReason: "closed period ordering regression",
    };
    beforeProjectionNow = SEPTEMBER_START;

    expect(() => beforeProjection.recordUsage(usage)).toThrow("active allowance period");
    expect(beforeProjection.operatorProjection("alpha", "2026-08")).toMatchObject({
      grantedUnits: 100,
      usedUnits: 0,
      expiredUnits: 100,
    });
    const beforeEntries = beforeProjection.operatorProjection("alpha", "2026-08").entries
      .map((item) => ({ kind: item.kind, amountUnits: item.amountUnits }));
    beforeProjection.close();

    beforeProjectionNow += 1;
    const restarted = new PhylaxAllowanceLedger(path, () => beforeProjectionNow);
    expect(() => restarted.recordUsage(usage)).toThrow("active allowance period");
    expect(restarted.reconcileExpiredPeriods(beforeProjectionNow)).toBe(0);
    expect(restarted.operatorProjection("alpha", "2026-08").expiredUnits).toBe(100);
    restarted.close();

    let afterProjectionNow = AUGUST_START + 1;
    const { store: afterProjection } = await ledger(
      "usage-boundary-after-projection",
      () => afterProjectionNow,
    );
    grant(afterProjection, "alpha", 100);
    afterProjectionNow = SEPTEMBER_START;
    expect(afterProjection.customerProjection("alpha", afterProjectionNow)).toMatchObject({
      state: "unavailable",
      periodId: null,
    });
    expect(() => afterProjection.recordUsage(usage)).toThrow("active allowance period");
    expect(afterProjection.operatorProjection("alpha", "2026-08").entries
      .map((item) => ({ kind: item.kind, amountUnits: item.amountUnits }))).toEqual(beforeEntries);
    afterProjection.close();
  });

  it("never lets an adjustment delete usage or reclaim reserved allowance", async () => {
    const { store } = await ledger("adjustments");
    grant(store, "alpha", 10_000);
    store.recordUsage({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 3_000,
      providerEventId: "provider-message-1",
      operation: "whatsapp.delivery",
      provider: "whatsapp",
      costBasis: "actual",
      idempotencyKey: "usage-1",
      tariffVersion: "delivery-v1",
      auditReason: "delivered message",
    });
    store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "work-1",
      providerEventId: "provider-message-2",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/raw/audio-2",
      estimatedUnits: 2_000,
    });
    expect(store.customerProjection("alpha").remainingUnits).toBe(5_000);
    expect(() => store.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: -5_001,
      source: "zenod",
      idempotencyKey: "reclaim-too-much",
      tariffVersion: "phylax-2026-08",
      auditReason: "operator correction",
    })).toThrow("reclaim only unused allowance");
    store.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: -5_000,
      source: "zenod",
      idempotencyKey: "reclaim-unused",
      tariffVersion: "phylax-2026-08",
      auditReason: "operator correction",
    });
    expect(store.operatorProjection("alpha", "2026-08")).toMatchObject({
      grantedUnits: 10_000,
      adjustedUnits: -5_000,
      usedUnits: 3_000,
    });
    expect(store.customerProjection("alpha")).toMatchObject({
      usedUnits: 3_000,
      reservedUnits: 2_000,
      remainingUnits: 0,
      state: "paused",
    });

    store.close();
  });

  it("serializes opposing adjustments from independent connections without losing an entry", async () => {
    const { store: first, path } = await ledger("opposing-adjustments");
    const second = new PhylaxAllowanceLedger(path, () => AUGUST_START + 1);
    grant(first, "alpha", 1_000);
    await Promise.all([
      Promise.resolve().then(() => first.adjustAllowance({
        tenantId: "alpha",
        periodId: "2026-08",
        amountUnits: 500,
        source: "zenod",
        idempotencyKey: "adjust-up",
        tariffVersion: "phylax-2026-08",
        auditReason: "add capacity",
      })),
      Promise.resolve().then(() => second.adjustAllowance({
        tenantId: "alpha",
        periodId: "2026-08",
        amountUnits: -400,
        source: "zenod",
        idempotencyKey: "adjust-down",
        tariffVersion: "phylax-2026-08",
        auditReason: "reclaim unused capacity",
      })),
    ]);
    expect(first.customerProjection("alpha")).toMatchObject({
      allocatedUnits: 1_100,
      remainingUnits: 1_100,
    });
    const keys = first.operatorProjection("alpha", "2026-08").entries.map((item) => item.idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(expect.arrayContaining(["grant:alpha:2026-08", "adjust-up", "adjust-down"]));
    second.close();
    first.close();
  });

  it("journals custody before pausing, resumes deterministically, and reclaims expired leases after restart", async () => {
    let now = AUGUST_START + 1;
    const { store: first, path } = await ledger("custody", () => now);
    grant(first, "alpha", 100);
    const paused = first.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "paid:voice-1",
      providerEventId: "wamid.voice-1",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/raw/voice-1",
      estimatedUnits: 120,
    });
    expect(paused).toMatchObject({
      state: "paused",
      work: {
        custodyRef: "artifact://alpha/raw/voice-1",
        pauseReason: "insufficient_allowance",
        reservedUnits: 0,
      },
    });
    expect(first.pendingWork("alpha")).toHaveLength(1);
    first.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 100,
      source: "zenod",
      idempotencyKey: "top-up-1",
      tariffVersion: "phylax-2026-08",
      auditReason: "bounded channel top-up",
    });
    expect(first.resumePaused("alpha")).toBe(1);
    expect(first.customerProjection("alpha")).toMatchObject({ reservedUnits: 120, remainingUnits: 80 });
    const claimed = first.claimNextPaidWork("alpha", "worker-a", 1_000, now)!;
    expect(claimed).toMatchObject({ state: "processing", leaseOwner: "worker-a" });
    first.close();

    const restarted = new PhylaxAllowanceLedger(path, () => now);
    expect(restarted.claimNextPaidWork("alpha", "worker-b", 1_000, now)).toBeNull();
    now += 1_001;
    const reclaimed = restarted.claimNextPaidWork("alpha", "worker-b", 1_000, now)!;
    expect(reclaimed).toMatchObject({ id: claimed.id, state: "processing", leaseOwner: "worker-b" });
    expect(reclaimed.leaseToken).not.toBe(claimed.leaseToken);
    expect(() => restarted.completePaidWork({
      workId: claimed.id,
      tenantId: "alpha",
      leaseOwner: claimed.leaseOwner!,
      leaseToken: claimed.leaseToken!,
      amountUnits: 110,
      providerEventId: "wamid.voice-1",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey: "usage:voice-1",
      tariffVersion: "stt-2026-08",
      auditReason: "completed transcription",
    })).toThrow(PhylaxLedgerConflictError);
    const completed = restarted.completePaidWork({
      workId: reclaimed.id,
      tenantId: "alpha",
      leaseOwner: reclaimed.leaseOwner!,
      leaseToken: reclaimed.leaseToken!,
      amountUnits: 110,
      providerEventId: "wamid.voice-1",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey: "usage:voice-1",
      tariffVersion: "stt-2026-08",
      auditReason: "completed transcription",
    });
    expect(completed.work).toMatchObject({ state: "done", reservedUnits: 0 });
    expect(completed.usage.replayed).toBe(false);
    restarted.close();

    const afterCompletionRestart = new PhylaxAllowanceLedger(path, () => now);
    expect(afterCompletionRestart.completePaidWork({
      workId: reclaimed.id,
      tenantId: "alpha",
      leaseOwner: reclaimed.leaseOwner!,
      leaseToken: reclaimed.leaseToken!,
      amountUnits: 110,
      providerEventId: "wamid.voice-1",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey: "usage:voice-1",
      tariffVersion: "stt-2026-08",
      auditReason: "completed transcription",
    }).usage).toMatchObject({ replayed: true, entry: { sequence: completed.usage.entry.sequence } });
    expect(afterCompletionRestart.customerProjection("alpha")).toMatchObject({
      usedUnits: 110,
      reservedUnits: 0,
      remainingUnits: 90,
    });
    expect(afterCompletionRestart.pendingWork("alpha")).toEqual([]);
    afterCompletionRestart.close();
  });

  it("re-evaluates an expired restart lease against suspension before another claim", async () => {
    let now = AUGUST_START + 1;
    const { store: first, path } = await ledger("restart-suspend", () => now);
    grant(first, "alpha", 500);
    first.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "suspended-work",
      providerEventId: "suspended-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/suspended",
      estimatedUnits: 200,
    });
    const claimed = first.claimNextPaidWork("alpha", "worker-a", 1_000, now)!;
    first.close();

    const restarted = new PhylaxAllowanceLedger(path, () => now);
    restarted.suspendTenant({
      tenantId: "alpha",
      source: "zenod",
      idempotencyKey: "suspend-during-restart",
      auditReason: "subscription suspended during worker restart",
    });
    now += 1_001;
    expect(restarted.claimNextPaidWork("alpha", "worker-b", 1_000, now)).toBeNull();
    expect(restarted.pendingWork("alpha")).toEqual([
      expect.objectContaining({
        id: claimed.id,
        state: "paused",
        pauseReason: "suspended",
        reservedUnits: 0,
        leaseOwner: null,
        leaseToken: null,
        custodyRef: "artifact://alpha/suspended",
      }),
    ]);
    expect(restarted.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);
    restarted.close();
  });

  it("re-evaluates an expired lease against period expiry and expires its released reservation", async () => {
    let now = AUGUST_START + 1;
    const { store } = await ledger("lease-period-expiry", () => now);
    grant(store, "alpha", 500);
    store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "period-work",
      providerEventId: "period-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/period",
      estimatedUnits: 200,
    });
    const claimed = store.claimNextPaidWork(
      "alpha",
      "worker-a",
      SEPTEMBER_START - now + 1_000,
      now,
    )!;
    now = SEPTEMBER_START;
    expect(store.reconcileExpiredPeriods(now)).toBe(1);
    expect(store.operatorProjection("alpha", "2026-08").expiredUnits).toBe(300);
    now += 1_001;

    expect(store.claimNextPaidWork("alpha", "worker-b", 1_000, now)).toBeNull();
    expect(store.pendingWork("alpha")).toEqual([
      expect.objectContaining({
        id: claimed.id,
        state: "paused",
        pauseReason: "period_inactive",
        reservedUnits: 0,
        leaseOwner: null,
        leaseToken: null,
      }),
    ]);
    expect(store.operatorProjection("alpha", "2026-08")).toMatchObject({
      grantedUnits: 500,
      usedUnits: 0,
      expiredUnits: 500,
    });
    store.close();
  });

  it("re-evaluates an expired lease without letting direct usage consume its reservation", async () => {
    let now = AUGUST_START + 1;
    const { store } = await ledger("lease-cap", () => now);
    grant(store, "alpha", 200);
    store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "cap-work",
      providerEventId: "cap-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/cap",
      estimatedUnits: 120,
    });
    const claimed = store.claimNextPaidWork("alpha", "worker-a", 1_000, now)!;
    const directUsage = {
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 81,
      providerEventId: "delivery-before-recovery",
      operation: "whatsapp.delivery",
      provider: "whatsapp",
      costBasis: "actual" as const,
      idempotencyKey: "usage-before-recovery",
      tariffVersion: "delivery-v1",
      auditReason: "other paid work consumed the remaining cap",
    };
    expect(() => store.recordUsage(directUsage)).toThrow("currently unreserved allowance");
    store.recordUsage({ ...directUsage, amountUnits: 80 });
    now += 1_001;

    const reclaimed = store.claimNextPaidWork("alpha", "worker-b", 1_000, now)!;
    expect(reclaimed).toMatchObject({ id: claimed.id, state: "processing", reservedUnits: 120 });
    expect(store.pendingWork("alpha")).toEqual([
      expect.objectContaining({
        id: claimed.id,
        state: "processing",
        pauseReason: null,
        reservedUnits: 120,
        leaseOwner: "worker-b",
        custodyRef: "artifact://alpha/cap",
      }),
    ]);
    expect(store.customerProjection("alpha")).toMatchObject({ usedUnits: 80, reservedUnits: 120, remainingUnits: 0 });
    store.close();
  });

  it("rejects paused and stale claim completions while allowing only the current token and its exact replay", async () => {
    let now = AUGUST_START + 1;
    const { store } = await ledger("completion-fence", () => now);
    grant(store, "alpha", 100);
    const paused = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "paused-completion",
      providerEventId: "paused-completion-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/paused-completion",
      estimatedUnits: 120,
    }).work;
    const completion = {
      workId: paused.id,
      tenantId: "alpha",
      leaseOwner: "worker-a",
      leaseToken: "not-a-valid-claim",
      amountUnits: 90,
      providerEventId: "paused-completion-provider",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "paused-completion-usage",
      tariffVersion: "stt-v1",
      auditReason: "completion fencing regression",
    };
    expect(() => store.completePaidWork(completion)).toThrow("not actively leased");
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);

    store.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 100,
      source: "zenod",
      idempotencyKey: "completion-top-up",
      tariffVersion: "phylax-2026-08",
      auditReason: "make the captured work claimable",
    });
    expect(store.resumePaused("alpha", now)).toBe(1);
    const firstClaim = store.claimNextPaidWork("alpha", "shared-worker", 1_000, now)!;
    now += 1_001;
    const staleCompletion = {
      ...completion,
      leaseOwner: firstClaim.leaseOwner!,
      leaseToken: firstClaim.leaseToken!,
    };
    expect(() => store.completePaidWork(staleCompletion)).toThrow("lease expired");
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);
    const reassigned = store.claimNextPaidWork("alpha", "shared-worker", 1_000, now)!;
    expect(reassigned.leaseToken).not.toBe(firstClaim.leaseToken);

    expect(() => store.completePaidWork(staleCompletion)).toThrow(PhylaxLedgerConflictError);
    expect(() => store.completePaidWork({
      ...completion,
      leaseOwner: "different-worker",
      leaseToken: reassigned.leaseToken!,
    })).toThrow(PhylaxLedgerConflictError);
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);

    const currentCompletion = {
      ...completion,
      leaseOwner: reassigned.leaseOwner!,
      leaseToken: reassigned.leaseToken!,
    };
    const completed = store.completePaidWork(currentCompletion);
    expect(completed).toMatchObject({
      work: { state: "done", leaseOwner: null, leaseToken: null },
      usage: { replayed: false },
    });
    expect(store.completePaidWork(currentCompletion).usage).toMatchObject({
      replayed: true,
      entry: { sequence: completed.usage.entry.sequence },
    });
    expect(() => store.completePaidWork(staleCompletion)).toThrow(PhylaxLedgerConflictError);
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(90);
    store.close();
  });

  it("applies the same exact period boundary to completion while preserving an earlier exact replay", async () => {
    let now = AUGUST_START + 1;
    const { store, path } = await ledger("completion-boundary", () => now);
    grant(store, "alpha", 100);
    const alphaWork = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "completion-boundary-alpha",
      providerEventId: "completion-boundary-alpha-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/completion-boundary",
      estimatedUnits: 100,
    }).work;
    const alphaClaim = store.claimNextPaidWork(
      "alpha",
      "worker-alpha",
      SEPTEMBER_START - now + 1_000,
      now,
    )!;
    const alphaCompletion = {
      workId: alphaWork.id,
      tenantId: "alpha",
      leaseOwner: alphaClaim.leaseOwner!,
      leaseToken: alphaClaim.leaseToken!,
      amountUnits: 100,
      providerEventId: "completion-boundary-alpha-provider",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "completion-boundary-alpha-usage",
      tariffVersion: "stt-v1",
      auditReason: "completion period boundary regression",
    };

    grant(store, "beta", 100);
    const betaWork = store.admitPaidWork({
      tenantId: "beta",
      periodId: "2026-08",
      idempotencyKey: "completion-boundary-beta",
      providerEventId: "completion-boundary-beta-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://beta/completion-boundary",
      estimatedUnits: 100,
    }).work;
    const betaClaim = store.claimNextPaidWork("beta", "worker-beta", 10_000, now)!;
    const betaCompletion = {
      workId: betaWork.id,
      tenantId: "beta",
      leaseOwner: betaClaim.leaseOwner!,
      leaseToken: betaClaim.leaseToken!,
      amountUnits: 100,
      providerEventId: "completion-boundary-beta-provider",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "completion-boundary-beta-usage",
      tariffVersion: "stt-v1",
      auditReason: "completion replay boundary regression",
    };
    const betaCompleted = store.completePaidWork(betaCompletion);
    expect(betaCompleted.usage.replayed).toBe(false);

    now = SEPTEMBER_START;
    const alphaCompleted = store.completePaidWork(alphaCompletion);
    expect(alphaCompleted.usage.replayed).toBe(false);
    expect(store.pendingWork("alpha")).toEqual([]);
    expect(store.operatorProjection("alpha", "2026-08")).toMatchObject({ usedUnits: 100, expiredUnits: 0 });
    expect(store.completePaidWork(betaCompletion).usage).toMatchObject({
      replayed: true,
      entry: { sequence: betaCompleted.usage.entry.sequence },
    });
    store.close();

    const restarted = new PhylaxAllowanceLedger(path, () => now);
    expect(restarted.completePaidWork(alphaCompletion).usage).toMatchObject({
      replayed: true,
      entry: { sequence: alphaCompleted.usage.entry.sequence },
    });
    expect(restarted.operatorProjection("alpha", "2026-08")).toMatchObject({
      usedUnits: 100,
      expiredUnits: 0,
    });
    restarted.close();
  });

  it("rejects actual settlement above its reservation when no unreserved allowance remains", async () => {
    const { store } = await ledger("settlement-cap");
    grant(store, "alpha", 100);
    const admitted = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "settlement-cap-work",
      providerEventId: "settlement-cap-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/settlement-cap",
      estimatedUnits: 100,
    }).work;
    const claimed = store.claimNextPaidWork("alpha", "worker-a", 10_000)!;
    const settlement = {
      workId: admitted.id,
      tenantId: "alpha",
      leaseOwner: claimed.leaseOwner!,
      leaseToken: claimed.leaseToken!,
      amountUnits: 120,
      providerEventId: "settlement-cap-provider",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "settlement-cap-usage",
      tariffVersion: "stt-v1",
      auditReason: "actual settlement cap regression",
    };

    expect(() => store.completePaidWork(settlement)).toThrow("currently unreserved allowance");
    expect(store.pendingWork("alpha")).toEqual([
      expect.objectContaining({
        id: admitted.id,
        state: "processing",
        reservedUnits: 100,
        leaseOwner: "worker-a",
        leaseToken: claimed.leaseToken,
      }),
    ]);
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);

    const completed = store.completePaidWork({
      ...settlement,
      amountUnits: 100,
      idempotencyKey: "settlement-equal-usage",
    });
    expect(completed).toMatchObject({ work: { state: "done" }, usage: { replayed: false } });
    expect(store.customerProjection("alpha")).toMatchObject({ usedUnits: 100, reservedUnits: 0, remainingUnits: 0 });
    store.close();
  });

  it("allows actual settlement above its reservation only when the extra is unreserved and funded", async () => {
    const { store } = await ledger("settlement-funded");
    grant(store, "alpha", 150);
    const admitted = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "settlement-funded-work",
      providerEventId: "settlement-funded-provider",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/settlement-funded",
      estimatedUnits: 100,
    }).work;
    const claimed = store.claimNextPaidWork("alpha", "worker-a", 10_000)!;
    const settlement = {
      workId: admitted.id,
      tenantId: "alpha",
      leaseOwner: claimed.leaseOwner!,
      leaseToken: claimed.leaseToken!,
      amountUnits: 120,
      providerEventId: "settlement-funded-provider",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "settlement-funded-usage",
      tariffVersion: "stt-v1",
      auditReason: "actual settlement used funded headroom",
    };

    const completed = store.completePaidWork(settlement);
    expect(completed).toMatchObject({ work: { state: "done" }, usage: { replayed: false } });
    expect(store.completePaidWork(settlement).usage).toMatchObject({
      replayed: true,
      entry: { sequence: completed.usage.entry.sequence },
    });
    expect(store.customerProjection("alpha")).toMatchObject({ usedUnits: 120, reservedUnits: 0, remainingUnits: 30 });
    store.close();
  });

  it("never lets one concurrent settlement consume another work item's reservation", async () => {
    const { store, path } = await ledger("concurrent-settlement");
    const peer = new PhylaxAllowanceLedger(path, () => AUGUST_START + 1);
    grant(store, "alpha", 200);
    const first = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "concurrent-work-a",
      providerEventId: "concurrent-provider-a",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/concurrent-a",
      estimatedUnits: 100,
    }).work;
    const second = store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "concurrent-work-b",
      providerEventId: "concurrent-provider-b",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/concurrent-b",
      estimatedUnits: 100,
    }).work;
    const firstClaim = store.claimNextPaidWork("alpha", "worker-a", 10_000)!;
    const secondClaim = peer.claimNextPaidWork("alpha", "worker-b", 10_000)!;
    expect(new Set([firstClaim.id, secondClaim.id])).toEqual(new Set([first.id, second.id]));
    const claims = new Map([firstClaim, secondClaim].map((claim) => [claim.id, claim]));
    const firstLease = claims.get(first.id)!;
    const secondLease = claims.get(second.id)!;
    expect(store.customerProjection("alpha")).toMatchObject({ reservedUnits: 200, remainingUnits: 0 });

    const firstSettlement = {
      workId: first.id,
      tenantId: "alpha",
      leaseOwner: firstLease.leaseOwner!,
      leaseToken: firstLease.leaseToken!,
      amountUnits: 120,
      providerEventId: "concurrent-provider-a",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual" as const,
      idempotencyKey: "concurrent-usage-a",
      tariffVersion: "stt-v1",
      auditReason: "concurrent reservation isolation",
    };
    expect(() => store.completePaidWork(firstSettlement)).toThrow("currently unreserved allowance");
    expect(store.operatorProjection("alpha", "2026-08").usedUnits).toBe(0);
    expect(store.customerProjection("alpha")).toMatchObject({ reservedUnits: 200, remainingUnits: 0 });

    peer.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 20,
      source: "zenod",
      idempotencyKey: "concurrent-top-up",
      tariffVersion: "phylax-2026-08",
      auditReason: "fund actual settlement headroom",
    });
    expect(store.completePaidWork(firstSettlement).work.state).toBe("done");
    expect(store.customerProjection("alpha")).toMatchObject({ usedUnits: 120, reservedUnits: 100, remainingUnits: 0 });
    expect(store.pendingWork("alpha")).toEqual([
      expect.objectContaining({ id: second.id, state: "processing", reservedUnits: 100 }),
    ]);
    expect(peer.completePaidWork({
      workId: second.id,
      tenantId: "alpha",
      leaseOwner: secondLease.leaseOwner!,
      leaseToken: secondLease.leaseToken!,
      amountUnits: 100,
      providerEventId: "concurrent-provider-b",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "actual",
      idempotencyKey: "concurrent-usage-b",
      tariffVersion: "stt-v1",
      auditReason: "second reserved settlement",
    }).work.state).toBe("done");
    expect(store.customerProjection("alpha")).toMatchObject({ usedUnits: 220, reservedUnits: 0, remainingUnits: 0 });
    peer.close();
    store.close();
  });

  it("makes suspension tenant-scoped and append-only without discarding pending custody", async () => {
    const { store } = await ledger("suspension");
    grant(store, "alpha", 1_000);
    grant(store, "beta", 1_000);
    store.admitPaidWork({
      tenantId: "alpha",
      periodId: "2026-08",
      idempotencyKey: "alpha-work",
      providerEventId: "alpha-provider-1",
      operation: "transcription.audio",
      custodyRef: "artifact://alpha/1",
      estimatedUnits: 300,
    });
    store.suspendTenant({
      tenantId: "alpha",
      source: "zenod",
      idempotencyKey: "suspend-alpha",
      auditReason: "subscription suspended",
    });
    expect(store.customerProjection("alpha")).toMatchObject({
      state: "suspended",
      reservedUnits: 0,
      remainingUnits: 1_000,
    });
    expect(store.pendingWork("alpha")[0]).toMatchObject({
      state: "paused",
      pauseReason: "suspended",
      custodyRef: "artifact://alpha/1",
    });
    expect(store.customerProjection("beta").state).toBe("active");
    store.resumeTenant({
      tenantId: "alpha",
      source: "zenod",
      idempotencyKey: "resume-alpha",
      auditReason: "subscription restored",
    });
    expect(store.resumePaused("alpha")).toBe(1);
    expect(store.pendingWork("alpha")[0]).toMatchObject({ state: "ready", reservedUnits: 300 });
    expect(store.operatorProjection("alpha").entries.map((item) => item.kind)).toEqual([
      "grant",
      "suspend",
      "resume",
    ]);

    store.close();
  });

  it("expires only unused allocation once at the UTC boundary and preserves historical usage across restart", async () => {
    let now = JULY_START + 1;
    const { store: first, path } = await ledger("expiry", () => now);
    first.grantAllowance({
      tenantId: "alpha",
      periodId: "2026-07",
      startsAt: JULY_START,
      endsAt: AUGUST_START,
      amountUnits: 1_000,
      source: "zenod",
      idempotencyKey: "grant-july",
      tariffVersion: "phylax-2026-07",
      auditReason: "July allocation",
    });
    first.recordUsage({
      tenantId: "alpha",
      periodId: "2026-07",
      amountUnits: 400,
      providerEventId: "july-event",
      operation: "transcription.audio",
      provider: "openrouter",
      costBasis: "estimated",
      idempotencyKey: "july-usage",
      tariffVersion: "stt-2026-07",
      auditReason: "July transcription",
    });
    now = AUGUST_START;
    expect(first.reconcileExpiredPeriods(now)).toBe(1);
    expect(first.reconcileExpiredPeriods(now)).toBe(0);
    expect(first.operatorProjection("alpha", "2026-07")).toMatchObject({
      grantedUnits: 1_000,
      usedUnits: 400,
      expiredUnits: 600,
    });
    first.close();

    const restarted = new PhylaxAllowanceLedger(path, () => now);
    expect(restarted.reconcileExpiredPeriods(now)).toBe(0);
    expect(() => restarted.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-07",
      amountUnits: 1,
      source: "zenod",
      idempotencyKey: "late-july-adjustment",
      tariffVersion: "phylax-2026-07",
      auditReason: "late adjustment",
    })).toThrow("allowance period is closed");
    expect(restarted.customerProjection("alpha", now)).toMatchObject({
      state: "unavailable",
      periodId: null,
    });
    grant(restarted, "alpha", 2_000);
    expect(restarted.customerProjection("alpha", now)).toMatchObject({
      state: "active",
      periodId: "2026-08",
      allocatedUnits: 2_000,
      usedUnits: 0,
      resetsAt: SEPTEMBER_START,
    });
    expect(restarted.operatorProjection("alpha").usedUnits).toBe(400);
    restarted.close();
  });

  it("retains truthful actual, estimated, included and unavailable operator cost bases in one ledger", async () => {
    const { store } = await ledger("cost-bases");
    grant(store, "alpha", 20_000);
    const bases = ["actual", "estimated", "service_included", "unavailable"] as const;
    bases.forEach((costBasis, index) => store.recordUsage({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: costBasis === "unavailable" ? 0 : (index + 1) * 100,
      providerEventId: `provider-${index}`,
      operation: index % 2 === 0 ? "whatsapp.delivery" : "transcription.audio",
      provider: index % 2 === 0 ? "whatsapp" : "openrouter",
      model: index % 2 === 0 ? null : "example/model",
      costBasis,
      idempotencyKey: `usage-${index}`,
      tariffVersion: "tariff-v1",
      auditReason: `cost basis ${costBasis}`,
    }));
    expect(store.operatorProjection("alpha", "2026-08").byUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ costBasis: "actual", events: 1, units: 100 }),
      expect.objectContaining({ costBasis: "estimated", events: 1, units: 200 }),
      expect.objectContaining({ costBasis: "service_included", events: 1, units: 300 }),
      expect.objectContaining({ costBasis: "unavailable", events: 1, units: 0 }),
    ]));
    expect(store.customerProjection("alpha").usedUnits).toBe(600);
    store.close();
  });
});
