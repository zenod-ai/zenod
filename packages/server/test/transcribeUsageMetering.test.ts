import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmUsageReport } from "zenod";
import { transcribeAudio } from "../src/transcribe.js";
import { UsageStore } from "../src/usageStore.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("transcription writes llm_usage rows", () => {
  let dir: string;
  let audio: Buffer;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "zenod-transcribe-usage-"));
    const wav = join(dir, "tone.wav");
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", wav]);
    audio = readFileSync(wav);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.unstubAllGlobals());

  const run = (onUsage: (r: LlmUsageReport) => void) =>
    transcribeAudio(audio, "note.wav", {
      openrouterApiKey: "sk-or-test",
      openrouterUser: "tenant-a",
      openrouterModel: "openai/whisper-large-v3-turbo",
      allowLocalFallback: false,
      onUsage,
    });

  it("records the real provider cost and header generation id in the live OpenRouter response shape", async () => {
    // Captured from the live API: no `id` in the body, `usage: { seconds, cost }`, id in `x-generation-id`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ text: "hello there world", usage: { seconds: 2, cost: 0.0123 } }), {
          status: 200,
          headers: { "x-generation-id": "gen-9" },
        })),
    );
    const reports: LlmUsageReport[] = [];
    await run((r) => reports.push(r));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ providerCostUsd: 0.0123, generationId: "gen-9" });
  });

  it("records real provider cost in the supplied ledger only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "gen-9", text: "hello there world", usage: { cost: 0.0123 } }), { status: 200 })),
    );
    const tenantA = new UsageStore(":memory:");
    const tenantB = new UsageStore(":memory:");
    try {
      const result = await run((r) => tenantA.record(r));
      expect(result.success).toBe(true);
      const [row] = tenantA.timeline({});
      expect(row).toMatchObject({
        operation: "transcribe",
        provider: "openrouter",
        model: "openai/whisper-large-v3-turbo",
        status: "succeeded",
        errorCode: null,
      });
      expect(row!.providerCostUsd).toBeCloseTo(0.0123, 9);
      expect(tenantA.spendSince(0)).toBeCloseTo(0.0123, 9);
      expect(tenantB.timeline({})).toHaveLength(0);
    } finally {
      tenantA.close();
      tenantB.close();
    }
  });

  it("falls back to a per-minute estimate when OpenRouter reports no cost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "hello there world" }), { status: 200 })));
    const reports: LlmUsageReport[] = [];
    await run((r) => reports.push(r));
    expect(reports).toHaveLength(1);
    expect(reports[0]!.providerCostUsd).toBeUndefined();
    expect(reports[0]!.estimatedCostUsd).toBeGreaterThan(0);
    const store = new UsageStore(":memory:");
    try {
      store.record(reports[0]!);
      expect(store.timeline({})[0]!.costUsd).toBeGreaterThan(0);
      expect(store.spendSince(0)).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("records a failed row with an error code and no cost on provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 402, message: "no credits" } }), { status: 402 })),
    );
    const store = new UsageStore(":memory:");
    try {
      const result = await run((r) => store.record(r));
      expect(result.success).toBe(false);
      const [row] = store.timeline({});
      expect(row).toMatchObject({ operation: "transcribe", provider: "openrouter", status: "failed" });
      expect(row!.errorCode).toBeTruthy();
      expect(row!.costUsd).toBe(0);
      expect(store.spendSince(0)).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("transcribe rows in UsageStore", () => {
  it("keeps the recorded estimate across the boot-time cost backfill", () => {
    const d = mkdtempSync(join(tmpdir(), "zenod-usage-"));
    const path = join(d, "usage.sqlite");
    try {
      const first = new UsageStore(path);
      first.record({
        operation: "transcribe",
        provider: "groq",
        model: "whisper-large-v3-turbo",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        estimatedCostUsd: 0.01,
      });
      first.close();
      const second = new UsageStore(path);
      expect(second.timeline({})[0]!.costUsd).toBeCloseTo(0.01, 9);
      second.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
