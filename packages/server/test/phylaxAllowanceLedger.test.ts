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
    const completed = restarted.completePaidWork({
      workId: reclaimed.id,
      tenantId: "alpha",
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
    expect(restarted.completePaidWork({
      workId: reclaimed.id,
      tenantId: "alpha",
      amountUnits: 110,
      providerEventId: "wamid.voice-1",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      costBasis: "estimated",
      idempotencyKey: "usage:voice-1",
      tariffVersion: "stt-2026-08",
      auditReason: "completed transcription",
    }).usage).toMatchObject({ replayed: true, entry: { sequence: completed.usage.entry.sequence } });
    expect(restarted.customerProjection("alpha")).toMatchObject({
      usedUnits: 110,
      reservedUnits: 0,
      remainingUnits: 90,
    });
    expect(restarted.pendingWork("alpha")).toEqual([]);
    restarted.close();
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
