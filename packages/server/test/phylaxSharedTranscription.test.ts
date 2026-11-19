import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PhylaxSharedTranscriptionBudget } from "../src/phylaxSharedTranscription.js";
import { phylaxTranscriptionOptions } from "../src/phylaxUnit.js";
import { transcribeAudio } from "../src/transcribe.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("EPIC-20 A4: Phylax shared OpenAI transcription with a monthly stop", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "phylax-shared-stt-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.unstubAllGlobals());

  it("is off without the key or with PHYLAX_SHARED_STT=0", () => {
    expect(new PhylaxSharedTranscriptionBudget(join(dir, "off"), {}).route()).toBeNull();
    expect(
      new PhylaxSharedTranscriptionBudget(join(dir, "off"), { PHYLAX_SHARED_OPENAI_API_KEY: "sk-x", PHYLAX_SHARED_STT: "0" }).route(),
    ).toBeNull();
  });

  it("counts cost, stops at the cap, survives a restart and reopens when the month turns", () => {
    let now = new Date("2026-11-19T02:00:00Z");
    const env = { PHYLAX_SHARED_OPENAI_API_KEY: "sk-x", PHYLAX_SHARED_STT_MONTHLY_USD: "0.05" };
    const budget = new PhylaxSharedTranscriptionBudget(join(dir, "cap"), env, () => now);
    const route = budget.route();
    expect(route).toMatchObject({ key: "sk-x", model: "gpt-4o-mini-transcribe" });
    route!.record({ estimatedCostUsd: 0.03, status: "succeeded" });
    route!.record({ estimatedCostUsd: 0, status: "failed" });
    expect(budget.snapshot()).toMatchObject({ month: "2026-11", notes: 1, failures: 1, capUsd: 0.05 });
    expect(budget.route()).not.toBeNull();
    route!.record({ estimatedCostUsd: 0.03, status: "succeeded" });
    expect(budget.route()).toBeNull();
    // A restart reads the same month's spend back.
    const restarted = new PhylaxSharedTranscriptionBudget(join(dir, "cap"), env, () => now);
    expect(restarted.snapshot().spentUsd).toBeCloseTo(0.06, 9);
    expect(restarted.route()).toBeNull();
    now = new Date("2026-12-01T00:00:01Z");
    expect(restarted.route()).not.toBeNull();
    expect(restarted.snapshot()).toMatchObject({ month: "2026-12", spentUsd: 0, notes: 0 });
  });

  it("routes local and platform-OpenRouter tenants to the shared key; own Groq/OpenAI keys stay", () => {
    const budget = new PhylaxSharedTranscriptionBudget(join(dir, "route"), { PHYLAX_SHARED_OPENAI_API_KEY: "sk-shared" });
    const signal = new AbortController().signal;
    for (const provider of ["local", "openrouter"] as const) {
      const options = phylaxTranscriptionOptions({ provider, model: null, key: "sk-or-tenant" }, {}, signal, budget.route());
      expect(options).toMatchObject({
        openaiApiKey: "sk-shared",
        openaiModel: "gpt-4o-mini-transcribe",
        openrouterApiKey: "",
        groqApiKey: "",
        longTranscriptionProvider: "openai",
        allowLocalFallback: true,
      });
      expect(typeof options.onUsage).toBe("function");
    }
    const own = phylaxTranscriptionOptions({ provider: "groq", model: null, key: "gsk-own" }, {}, signal, budget.route());
    expect(own).toMatchObject({ groqApiKey: "gsk-own", openaiApiKey: "" });
    expect(own.onUsage).toBeUndefined();
    // At the stop (no route) the tenant's own configuration applies as before.
    expect(phylaxTranscriptionOptions({ provider: "local", model: null, key: null }, {}, signal, null)).toMatchObject({
      openaiApiKey: "",
    });
  });

  describe.skipIf(!hasFfmpeg)("through transcribeAudio", () => {
    const tone = (seconds: number) => {
      const wav = join(dir, `tone-${seconds}.wav`);
      spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, wav]);
      return readFileSync(wav);
    };

    it("transcribes on OpenAI gpt-4o-mini-transcribe, long notes in 5-minute parts, and meters the cost", async () => {
      const models: string[] = [];
      const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        models.push(String((init?.body as FormData).get("model")));
        return new Response("hola mundo, esto es una nota de voz", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const budget = new PhylaxSharedTranscriptionBudget(join(dir, "live"), { PHYLAX_SHARED_OPENAI_API_KEY: "sk-shared" });
      const options = phylaxTranscriptionOptions(
        { provider: "openrouter", model: null, key: "sk-or-402" },
        {},
        new AbortController().signal,
        budget.route(),
      );
      const result = await transcribeAudio(tone(610), "voice.ogg", options);
      expect(result).toMatchObject({ success: true, provider: "openai gpt-4o-mini-transcribe" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(new Set(models)).toEqual(new Set(["gpt-4o-mini-transcribe"]));
      const snap = budget.snapshot();
      expect(snap.notes).toBe(1);
      expect(snap.spentUsd).toBeCloseTo((610 / 60) * 0.003, 3);
    }, 60_000);

    it("falls back to local whisper.cpp when OpenAI errors", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"boom"}}', { status: 500 })));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const budget = new PhylaxSharedTranscriptionBudget(join(dir, "fallback"), { PHYLAX_SHARED_OPENAI_API_KEY: "sk-shared" });
      const result = await transcribeAudio(tone(3), "voice.ogg", phylaxTranscriptionOptions(
        { provider: "local", model: null, key: null },
        { PHYLAX_LOCAL_WHISPER_MODEL: "base" },
        new AbortController().signal,
        budget.route(),
      ));
      // The local step ran (here it has no model to download, so it reports whisper.cpp).
      expect(result.provider?.startsWith("whisper.cpp")).toBe(true);
      expect(warn.mock.calls.some(([line]) => String(line).includes("openai failed, falling back to whisper.cpp"))).toBe(true);
      expect(budget.snapshot()).toMatchObject({ failures: 1, spentUsd: 0 });
    }, 60_000);
  });
});
