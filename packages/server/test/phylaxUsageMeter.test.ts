import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhylaxAllowanceLedger } from "../src/phylaxAllowanceLedger.js";
import { PhylaxUsageMeter } from "../src/phylaxUsageMeter.js";

const dirs: string[] = [];
const START = Date.parse("2026-08-01T00:00:00.000Z");
const END = Date.parse("2026-09-01T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(name: string) {
  const dir = await mkdtemp(join(tmpdir(), `phylax-usage-${name}-`));
  dirs.push(dir);
  let current = START + 1_000;
  const now = () => current;
  const ledger = new PhylaxAllowanceLedger(join(dir, "phylax-allowance.sqlite"), now);
  const meter = new PhylaxUsageMeter(dir, ledger, {
    PHYLAX_TARIFF_VERSION: "test-v1",
    PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    PHYLAX_INBOUND_MESSAGE_UNITS: "3",
  }, { workerId: "worker-a", now });
  return { dir, ledger, meter, now, advance: (milliseconds: number) => { current += milliseconds; } };
}

function grant(ledger: PhylaxAllowanceLedger, tenantId = "alpha", amountUnits = 10_000) {
  ledger.grantAllowance({
    tenantId,
    periodId: "2026-08",
    startsAt: START,
    endsAt: END,
    amountUnits,
    source: "zenod",
    idempotencyKey: `grant:${tenantId}`,
    tariffVersion: "test-v1",
    auditReason: "test allowance",
  });
}

describe("PhylaxUsageMeter", () => {
  it("reserves and books concurrent voice notes against their exact provider identities", async () => {
    const { ledger, meter } = await fixture("concurrent");
    grant(ledger);
    const claims = ["voice-a", "voice-b", "voice-c"].map((providerMessageId, index) =>
      meter.beginTranscription({
        tenantId: "alpha",
        providerMessageId,
        custodyRef: `sha256:${index}`,
        durationSeconds: index + 1,
        provider: "openrouter",
        model: "voxtral",
      }));

    expect(claims.map((claim) => claim.state)).toEqual(["processing", "processing", "processing"]);
    expect(new Set(claims.map((claim) => claim.work?.providerEventId))).toEqual(
      new Set(["voice-a", "voice-b", "voice-c"]),
    );
    claims.forEach((claim) => meter.completeTranscription(claim, true));

    expect(ledger.operatorProjection("alpha", "2026-08").byUsage).toEqual([{
      operation: "transcription.audio",
      provider: "openrouter",
      model: "voxtral",
      tariffVersion: "test-v1",
      costBasis: "estimated",
      events: 3,
      units: 12,
    }]);
    expect(meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-a",
      custodyRef: "sha256:0",
      durationSeconds: 1,
      provider: "openrouter",
      model: "voxtral",
    }).state).toBe("already_booked");

    meter.close();
    ledger.close();
  });

  it("pauses consumer-first mixed-version paid work until a grant exists", async () => {
    const { ledger, meter } = await fixture("rolling-upgrade");
    const claim = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-before-grant",
      custodyRef: "sha256:before",
      durationSeconds: 4,
      provider: "local",
      model: "base",
    });
    expect(claim.state).toBe("paused");
    expect(meter.pending("alpha")).toBe(0);

    grant(ledger);
    const admitted = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-before-grant",
      custodyRef: "sha256:before",
      durationSeconds: 4,
      provider: "local",
      model: "base",
    });
    expect(admitted.state).toBe("processing");
    meter.completeTranscription(admitted, true);
    expect(ledger.operatorProjection("alpha", "2026-08")).toMatchObject({ usedUnits: 8 });

    meter.close();
    ledger.close();
  });

  it("terminalizes an intentionally raw-forwarded paused STT admission without reserving a later grant", async () => {
    const { ledger, meter } = await fixture("abandoned-paused-stt");
    grant(ledger, "alpha", 1);
    const claim = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "telegram-raw-forward",
      custodyRef: "sha256:raw-forward",
      durationSeconds: 30,
      provider: "telegram",
      model: null,
    });
    expect(claim).toMatchObject({ state: "paused", work: { state: "paused", reservedUnits: 0 } });
    meter.completeTranscription(claim, false);
    expect(ledger.pendingWork("alpha")).toEqual([]);

    ledger.adjustAllowance({
      tenantId: "alpha",
      periodId: "2026-08",
      amountUnits: 100,
      source: "zenod",
      idempotencyKey: "adjust:after-raw-forward",
      tariffVersion: "test-v1",
      auditReason: "make later allowance available",
    });
    expect(ledger.resumePaused("alpha")).toBe(0);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 0 });

    meter.close();
    ledger.close();
  });

  it("books provider-first mixed-version usage immediately when the grant already exists", async () => {
    const { ledger, meter } = await fixture("provider-first-rolling-upgrade");
    grant(ledger);
    const claim = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-after-grant",
      custodyRef: "sha256:after",
      durationSeconds: 4,
      provider: "local",
      model: "base",
    });
    expect(claim.state).toBe("processing");
    meter.completeTranscription(claim, true);
    expect(meter.pending("alpha")).toBe(0);
    expect(ledger.operatorProjection("alpha", "2026-08")).toMatchObject({ usedUnits: 8 });
    expect(meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-after-grant",
      custodyRef: "sha256:after",
      durationSeconds: 4,
      provider: "local",
      model: "base",
    }).state).toBe("already_booked");

    meter.close();
    ledger.close();
  });

  it("settles a persisted transcript after a process crash without calling or charging twice", async () => {
    const first = await fixture("crash-seam");
    grant(first.ledger);
    const original = first.meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-crash",
      custodyRef: "sha256:crash",
      durationSeconds: 7,
      provider: "groq",
      model: "whisper-large-v3-turbo",
    });
    expect(original.state).toBe("processing");
    first.meter.close();
    first.ledger.close();
    const restartedLedger = new PhylaxAllowanceLedger(
      join(first.dir, "phylax-allowance.sqlite"),
      first.now,
    );
    const restarted = new PhylaxUsageMeter(first.dir, restartedLedger, {
      PHYLAX_TARIFF_VERSION: "test-v1",
      PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    }, { workerId: "worker-after-restart", now: first.now });
    const recovered = restarted.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-crash",
      custodyRef: "sha256:crash",
      durationSeconds: 7,
      provider: "groq",
      model: "whisper-large-v3-turbo",
      persistedResult: true,
    });
    expect(recovered).toMatchObject({ state: "processing", work: { id: original.work?.id } });
    restarted.completeTranscription(recovered, true);
    expect(restartedLedger.operatorProjection("alpha", "2026-08")).toMatchObject({ usedUnits: 14 });
    expect(restarted.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-crash",
      custodyRef: "sha256:crash",
      durationSeconds: 7,
      provider: "groq",
      model: "whisper-large-v3-turbo",
    }).state).toBe("already_booked");

    restarted.close();
    restartedLedger.close();
  });

  it("reclaims an orphaned voice lease after its bounded restart lease expires", async () => {
    const first = await fixture("restart-orphaned-lease");
    grant(first.ledger);
    const original = first.meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-before-runtime-crash",
      custodyRef: "sha256:before-runtime-crash",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(original).toMatchObject({ state: "processing", work: { leaseOwner: "worker-a" } });
    first.meter.close();
    first.ledger.close();

    const restartedLedger = new PhylaxAllowanceLedger(
      join(first.dir, "phylax-allowance.sqlite"),
      first.now,
    );
    const restarted = new PhylaxUsageMeter(first.dir, restartedLedger, {
      PHYLAX_TARIFF_VERSION: "test-v1",
      PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    }, { workerId: "worker-after-immediate-restart", now: first.now });
    const recovered = restarted.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-before-runtime-crash",
      custodyRef: "sha256:before-runtime-crash",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(recovered).toMatchObject({ state: "paused", work: { leaseOwner: "worker-a" } });
    let woke = 0;
    first.advance(61_000);
    restarted.setWorkReadyCallback(() => { woke += 1; });
    expect(woke).toBe(1);
    const reclaimed = restarted.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-before-runtime-crash",
      custodyRef: "sha256:before-runtime-crash",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(reclaimed).toMatchObject({
      state: "processing",
      work: { id: original.work?.id, leaseOwner: "worker-after-immediate-restart" },
    });
    restarted.completeTranscription(reclaimed, false);
    expect(restartedLedger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 0 });
    expect(restartedLedger.pendingWork("alpha")).toEqual([]);

    restarted.close();
    restartedLedger.close();
  });

  it("never lets a second live runtime steal an unexpired provider lease", async () => {
    const first = await fixture("two-live-runtimes");
    grant(first.ledger);
    const original = first.meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-live-owner",
      custodyRef: "sha256:live-owner",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(original.state).toBe("processing");
    const peer = new PhylaxUsageMeter(first.dir, first.ledger, {
      PHYLAX_TARIFF_VERSION: "test-v1",
      PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    }, { workerId: "worker-b", now: first.now });
    const duplicate = peer.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-live-owner",
      custodyRef: "sha256:live-owner",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(duplicate).toMatchObject({ state: "paused", work: { leaseOwner: "worker-a" } });

    peer.close();
    first.meter.close();
    first.ledger.close();
  });

  it("renews a live long-running transcription lease before it can be reclaimed", async () => {
    vi.useFakeTimers();
    const active = await fixture("long-running-renewal");
    try {
      grant(active.ledger, "alpha", 20_000);
      const claim = active.meter.beginTranscription({
        tenantId: "alpha",
        providerMessageId: "voice-long-running",
        custodyRef: "sha256:long-running",
        durationSeconds: 7_200,
        provider: "openrouter",
        model: "voxtral",
      });
      expect(claim.state).toBe("processing");
      const initialLeaseUntil = claim.work!.leaseUntil!;
      const stop = active.meter.maintainTranscriptionLease(claim);
      active.advance(20_001);
      await vi.advanceTimersByTimeAsync(20_001);
      stop();
      const replay = active.meter.beginTranscription({
        tenantId: "alpha",
        providerMessageId: "voice-long-running",
        custodyRef: "sha256:long-running",
        durationSeconds: 7_200,
        provider: "openrouter",
        model: "voxtral",
      });
      expect(replay).toMatchObject({ state: "paused", work: { leaseOwner: "worker-a" } });
      expect(replay.work!.leaseUntil).toBeGreaterThan(initialLeaseUntil);
    } finally {
      active.meter.close();
      active.ledger.close();
      vi.useRealTimers();
    }
  });

  it("cancels a paused replay even while the original runtime still owns its lease", async () => {
    const { ledger, meter } = await fixture("cancel-active-controller-race");
    grant(ledger);
    const original = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cancel-race",
      custodyRef: "sha256:cancel-race",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(original.state).toBe("processing");
    const cancellationReplay = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cancel-race",
      custodyRef: "sha256:cancel-race",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(cancellationReplay).toMatchObject({ state: "paused", work: { state: "processing" } });
    meter.completeTranscription(cancellationReplay, false);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 40 });
    // The active owner observes the abort and settles its exact lease. A crash
    // instead is handled by the persisted cancellation request at lease expiry.
    meter.completeTranscription(original, false);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 0 });
    expect(ledger.pendingWork("alpha")).toEqual([]);

    meter.close();
    ledger.close();
  });

  it("persists cancellation across restart and clears an orphan when its lease expires", async () => {
    const first = await fixture("cancel-restart-stale-lease");
    grant(first.ledger);
    const original = first.meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cancel-after-crash",
      custodyRef: "sha256:cancel-after-crash",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(original.state).toBe("processing");
    first.meter.close();
    first.ledger.close();

    const restartedLedger = new PhylaxAllowanceLedger(join(first.dir, "phylax-allowance.sqlite"), first.now);
    const restarted = new PhylaxUsageMeter(first.dir, restartedLedger, {
      PHYLAX_TARIFF_VERSION: "test-v1",
      PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    }, { workerId: "worker-after-cancel-crash", now: first.now });
    const cancellation = restarted.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cancel-after-crash",
      custodyRef: "sha256:cancel-after-crash",
      durationSeconds: 20,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(cancellation).toMatchObject({ state: "paused", work: { state: "processing" } });
    restarted.completeTranscription(cancellation, false);
    expect(restartedLedger.customerProjection("alpha")).toMatchObject({ reservedUnits: 40 });

    first.advance(61_000);
    let woke = 0;
    restarted.setWorkReadyCallback(() => { woke += 1; });
    expect(woke).toBe(1);
    expect(restartedLedger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 0 });
    expect(restartedLedger.pendingWork("alpha")).toEqual([]);

    restarted.close();
    restartedLedger.close();
  });

  it("books inbound channel events locally and idempotently", async () => {
    const { ledger, meter } = await fixture("channel");
    grant(ledger);
    meter.recordInboundMessage({ tenantId: "alpha", providerMessageId: "wamid-1", channel: "whatsapp" });
    meter.recordInboundMessage({ tenantId: "alpha", providerMessageId: "wamid-1", channel: "whatsapp" });
    expect(ledger.operatorProjection("alpha", "2026-08").byUsage).toEqual([{
      operation: "channel.inbound.whatsapp",
      provider: "whatsapp",
      model: "unknown",
      tariffVersion: "test-v1",
      costBasis: "estimated",
      events: 1,
      units: 3,
    }]);
    meter.close();
    ledger.close();
  });

  it("admits outbound delivery before the provider call and books the exact provider receipt once", async () => {
    const { ledger, meter } = await fixture("outbound-channel");
    grant(ledger);
    const claim = meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "wa-intent-1",
      custodyRef: "outbound-intent:one",
      channel: "whatsapp",
    });
    expect(claim.state).toBe("processing");
    const booked = meter.completeDelivery(claim, "wamid-provider-1");
    expect(booked?.entry).toMatchObject({ providerEventId: "wamid-provider-1" });
    expect(ledger.operatorProjection("alpha", "2026-08").byUsage).toEqual([{
      operation: "channel.outbound.whatsapp",
      provider: "whatsapp",
      model: "unknown",
      tariffVersion: "test-v1",
      costBasis: "estimated",
      events: 1,
      units: 1,
    }]);
    expect(meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "wa-intent-1",
      custodyRef: "outbound-intent:one",
      channel: "whatsapp",
    })).toMatchObject({ state: "already_booked", providerReceiptId: "wamid-provider-1" });
    meter.close();
    ledger.close();
  });

  it("suppresses delivery replay while a provider receipt waits for ledger reconciliation", async () => {
    const { ledger, meter } = await fixture("outbound-settlement-recovery");
    grant(ledger);
    const claim = meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "wa-intent-recovery",
      custodyRef: "outbound-intent:recovery",
      channel: "whatsapp",
    });
    expect(claim.state).toBe("processing");
    const complete = ledger.completePaidWorkFromDurableReceipt.bind(ledger);
    ledger.completePaidWorkFromDurableReceipt = () => { throw new Error("temporary ledger outage"); };
    meter.completeDelivery(claim, "wamid-recovery");
    expect(meter.pending("alpha")).toBe(1);
    expect(ledger.customerProjection("alpha")).toMatchObject({ reservedUnits: 1 });
    expect(meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "wa-intent-recovery",
      custodyRef: "outbound-intent:recovery",
      channel: "whatsapp",
    })).toMatchObject({ state: "already_booked", providerReceiptId: "wamid-recovery" });

    ledger.completePaidWorkFromDurableReceipt = complete;
    expect(meter.reconcilePending("alpha")).toBe(1);
    expect(meter.pending("alpha")).toBe(0);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 1, reservedUnits: 0 });
    meter.close();
    ledger.close();
  });

  it("releases a failed delivery attempt so the same durable intent can retry", async () => {
    const { ledger, meter } = await fixture("outbound-provider-failure");
    grant(ledger);
    const first = meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "tg-intent-retry",
      custodyRef: "outbound-intent:retry",
      channel: "telegram",
    });
    expect(first.state).toBe("processing");
    meter.completeDelivery(first, null);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 1 });
    expect(meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "tg-intent-retry",
      custodyRef: "outbound-intent:retry",
      channel: "telegram",
    }).state).toBe("processing");
    meter.close();
    ledger.close();
  });

  it("terminalizes an abandoned delivery representation before a distinct fallback intent", async () => {
    const { ledger, meter } = await fixture("outbound-representation-fallback");
    grant(ledger);
    const rich = meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "tg-reply:rich",
      custodyRef: "telegram-reply:rich",
      channel: "telegram",
    });
    expect(rich.state).toBe("processing");
    meter.abandonDelivery(rich);
    expect(ledger.pendingWork("alpha")).toEqual([]);
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 0 });
    expect(meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "tg-reply:rich",
      custodyRef: "telegram-reply:rich",
      channel: "telegram",
    }).state).toBe("abandoned");

    const plain = meter.beginDelivery({
      tenantId: "alpha",
      providerMessageId: "tg-reply:plain:0",
      custodyRef: "telegram-reply:plain:0",
      channel: "telegram",
    });
    expect(plain.state).toBe("processing");
    meter.completeDelivery(plain, "telegram-receipt-1");
    expect(ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 1, reservedUnits: 0 });

    meter.close();
    ledger.close();
  });

  it("settles admitted transcription across an allowance boundary without losing the durable result", async () => {
    const { ledger, meter, advance } = await fixture("period-rollover");
    grant(ledger);
    advance(END - (START + 1_000) - 1_000);
    const claim = meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cross-period",
      custodyRef: "sha256:cross-period",
      durationSeconds: 30,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(claim.state).toBe("processing");
    advance(2_000);
    meter.completeTranscription(claim, true);
    expect(ledger.operatorProjection("alpha", "2026-08")).toMatchObject({ usedUnits: 60 });
    meter.close();
    ledger.close();
  });

  it("reconciles a cancelled voice's durable STT settlement after a ledger outage and restart", async () => {
    const first = await fixture("cancelled-settlement-restart");
    grant(first.ledger);
    const claim = first.meter.beginTranscription({
      tenantId: "alpha",
      providerMessageId: "voice-cancelled-after-stt",
      custodyRef: "sha256:cancelled-after-stt",
      durationSeconds: 3,
      provider: "openrouter",
      model: "voxtral",
    });
    expect(claim.state).toBe("processing");
    const complete = first.ledger.completePaidWork.bind(first.ledger);
    first.ledger.completePaidWork = () => { throw new Error("temporary ledger outage after STT"); };

    // Runtime cancellation after STT must not leak this already-incurred
    // reservation even though the cancelled channel job will not be claimed
    // again. The meter persists exact settlement identity before returning.
    first.meter.completeTranscription(claim, true);
    expect(first.meter.pending("alpha")).toBe(1);
    expect(first.ledger.customerProjection("alpha")).toMatchObject({ usedUnits: 0, reservedUnits: 6 });
    first.ledger.completePaidWork = complete;
    first.meter.close();
    first.ledger.close();

    const restartedLedger = new PhylaxAllowanceLedger(
      join(first.dir, "phylax-allowance.sqlite"),
      first.now,
    );
    const restarted = new PhylaxUsageMeter(first.dir, restartedLedger, {
      PHYLAX_TARIFF_VERSION: "test-v1",
      PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND: "2",
    }, { workerId: "worker-after-cancel", now: first.now });
    expect(restarted.pending("alpha")).toBe(0);
    expect(restartedLedger.customerProjection("alpha")).toMatchObject({ usedUnits: 6, reservedUnits: 0 });
    expect(restartedLedger.pendingWork("alpha")).toEqual([]);

    restarted.close();
    restartedLedger.close();
  });
});
