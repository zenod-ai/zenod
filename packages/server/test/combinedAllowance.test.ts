import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  estimateTranscriptionCostUsd,
  UsageStore,
} from "../src/usageStore.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store(name: string): Promise<UsageStore> {
  const dir = await mkdtemp(join(tmpdir(), `zenod-${name}-`));
  dirs.push(dir);
  return new UsageStore(join(dir, "usage.sqlite"));
}

describe("channel transcription usage accounting", () => {
  it("books concurrent/retried transcription reports once per tenant without cross-tenant collisions", async () => {
    const alpha = await store("allowance-alpha");
    const beta = await store("allowance-beta");
    const report = {
      eventKey: "tenant-message-1",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      audioSeconds: 120,
    };
    const alphaResults = await Promise.all(
      Array.from({ length: 20 }, async () => alpha.recordTranscription(report, Date.parse("2026-08-26T12:00:00Z"))),
    );
    expect(alphaResults.filter(Boolean)).toHaveLength(1);
    expect(beta.recordTranscription(report, Date.parse("2026-08-26T12:00:00Z"))).toBe(true);
    expect(alpha.summary(0)).toMatchObject({ calls: 1, costUsd: 0.006 });
    expect(beta.summary(0)).toMatchObject({ calls: 1, costUsd: 0.006 });
    expect(alpha.timeline()[0]).toMatchObject({
      operation: "transcription.audio",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      metadata: {
        audioSeconds: 120,
        rateUsdPerMinute: 0.003,
        estimatedCostUsd: 0.006,
        estimateUnavailable: false,
      },
    });
    alpha.close();
    beta.close();
  });

  it("uses documented duration estimates and never invents provider truth for unknown pricing", () => {
    const known = estimateTranscriptionCostUsd({
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      audioSeconds: 90,
    });
    expect(known).toMatchObject({ rateUsdPerMinute: 0.003, basis: "duration_estimate" });
    expect(known.costUsd).toBeCloseTo(0.0045);
    expect(estimateTranscriptionCostUsd({
      provider: "openrouter",
      model: "openai/gpt-4o-mini-transcribe",
      audioSeconds: 90,
    })).toEqual({ costUsd: null, rateUsdPerMinute: null, basis: "unavailable" });
  });

  it("resets from the UTC month boundary and excludes prior-month events", async () => {
    const usage = await store("allowance-reset");
    usage.recordTranscription({
      eventKey: "old",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      audioSeconds: 60,
    }, Date.parse("2026-07-31T23:59:59.999Z"));
    usage.recordTranscription({
      eventKey: "new",
      provider: "openrouter",
      model: "mistralai/voxtral-mini-transcribe",
      audioSeconds: 60,
    }, Date.parse("2026-08-01T00:00:00.000Z"));
    const since = Date.parse("2026-08-01T00:00:00.000Z");
    expect(usage.summary(since)).toMatchObject({ calls: 1, costUsd: 0.003 });
    usage.close();
  });
});
