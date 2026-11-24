import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmUsageReport } from "zenod";
import {
  ELEVENLABS_STT_DEFAULT_MODEL,
  ELEVENLABS_STT_DEFAULT_URL,
  elevenLabsFailureFromResponse,
  elevenLabsSttConfig,
  estimateElevenLabsUsd,
  transcribeElevenLabsFirst,
  type ElevenLabsSttConfig,
} from "../src/elevenlabsTranscription.js";
import { transcribeAudio, type TranscriptionEnvelope } from "../src/transcribe.js";

/** A fake ElevenLabs speech-to-text server: answers from `reply`, records each request. */
interface Seen {
  key: string | undefined;
  body: string;
}
let server: Server;
let url: string;
let seen: Seen[] = [];
let reply: (body: string) => { status: number; json: unknown } = () => ({ status: 200, json: { text: "hello from eleven" } });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ key: req.headers["xi-api-key"] as string | undefined, body });
    const { status, json } = reply(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/speech-to-text`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  vi.unstubAllEnvs();
  seen = [];
  reply = () => ({ status: 200, json: { text: "hello from eleven" } });
});

const cfg = (): ElevenLabsSttConfig => ({ apiKey: "el-test-key", url, model: "scribe_v1", baseTimeoutMs: 10_000 });

function switchOn(): void {
  vi.stubEnv("ELEVENLABS_API_KEY", "el-test-key");
  vi.stubEnv("ZENOD_ELEVENLABS_STT_URL", url);
  // Today's chain behind it answers with the test hook (whisper.cpp label, no keys configured).
  vi.stubEnv("ZENOD_WHISPER_FAKE_TRANSCRIPT", "hello from today's chain");
}

describe("EPIC-20 A10: ElevenLabs settings", () => {
  it("is off without the shared key, and off with ZENOD_ELEVENLABS_STT=0 even with it", () => {
    expect(elevenLabsSttConfig({})).toBeNull();
    expect(elevenLabsSttConfig({ ELEVENLABS_API_KEY: "  " })).toBeNull();
    expect(elevenLabsSttConfig({ ELEVENLABS_API_KEY: "k", ZENOD_ELEVENLABS_STT: "0" })).toBeNull();
  });

  it("defaults to the public API and Scribe", () => {
    expect(elevenLabsSttConfig({ ELEVENLABS_API_KEY: "k" })).toMatchObject({
      apiKey: "k",
      url: ELEVENLABS_STT_DEFAULT_URL,
      model: ELEVENLABS_STT_DEFAULT_MODEL,
    });
  });

  it("reads a quota refusal as credit and a bad key as auth", () => {
    const quota = elevenLabsFailureFromResponse(401, JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }));
    expect(quota).toMatchObject({ provider: "elevenlabs", failureReason: "provider_credit_exhausted", providerCode: "quota_exceeded", httpStatus: 401 });
    expect(quota.error).toContain("elevenlabs transcription failed (401 quota_exceeded)");
    expect(elevenLabsFailureFromResponse(401, JSON.stringify({ detail: { status: "invalid_api_key" } })).failureReason).toBe("provider_auth_failed");
    expect(elevenLabsFailureFromResponse(503, "upstream down").failureReason).toBe("provider_unavailable");
  });

  it("estimates 0.40 USD per audio hour", () => {
    expect(estimateElevenLabsUsd(3600)).toBeCloseTo(0.4);
    expect(estimateElevenLabsUsd(null)).toBe(0);
  });
});

describe("EPIC-20 A10: ElevenLabs first in transcribeAudio", () => {
  it("key unset: ElevenLabs is never called and the note takes today's path", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ZENOD_ELEVENLABS_STT_URL", url);
    vi.stubEnv("ZENOD_WHISPER_FAKE_TRANSCRIPT", "hello from today's chain");
    const result = await transcribeAudio(Buffer.from("short-note"), "note.ogg", { durationSeconds: 12 });
    expect(seen).toHaveLength(0);
    expect(result).toMatchObject({ success: true, transcript: "hello from today's chain" });
    expect(result.provider).toMatch(/^whisper\.cpp/);
  });

  it("key set: ElevenLabs writes the note, with the shared key, and the tenant's ledger gets one row", async () => {
    switchOn();
    const usage: LlmUsageReport[] = [];
    const result = await transcribeAudio(Buffer.from("short-note"), "note.ogg", { durationSeconds: 60, onUsage: (r) => usage.push(r) });
    expect(result).toMatchObject({ success: true, transcript: "hello from eleven", provider: "elevenlabs scribe_v1" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe("el-test-key");
    expect(seen[0]!.body).toContain('name="model_id"');
    expect(seen[0]!.body).toContain("scribe_v1");
    expect(usage).toEqual([
      expect.objectContaining({ operation: "transcribe", provider: "elevenlabs", model: "scribe_v1", status: "succeeded" }),
    ]);
    expect(usage[0]!.estimatedCostUsd).toBeCloseTo(0.4 / 60);
  });

  it.each([
    [500, { detail: "internal error" }],
    [401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }],
    [429, { detail: { status: "too_many_concurrent_requests" } }],
  ])("ElevenLabs %i: the note falls back down today's chain, the failed call costs nothing", async (status, json) => {
    switchOn();
    reply = () => ({ status, json });
    const usage: LlmUsageReport[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await transcribeAudio(Buffer.from("short-note"), "note.ogg", { durationSeconds: 30, onUsage: (r) => usage.push(r) });
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({ success: true, transcript: "hello from today's chain" });
    expect(result.provider).toMatch(/^whisper\.cpp/);
    expect(usage[0]).toMatchObject({ provider: "elevenlabs", status: "failed", estimatedCostUsd: 0 });
    // The line the health page's AI credit row reads, with no key in it.
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("elevenlabs transcription failed"));
    expect(line).toContain(`(${status}`);
    expect(line).not.toContain("el-test-key");
    warn.mockRestore();
  });

  it("an unreachable ElevenLabs also falls back", async () => {
    switchOn();
    vi.stubEnv("ZENOD_ELEVENLABS_STT_URL", "http://127.0.0.1:1/v1/speech-to-text");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await transcribeAudio(Buffer.from("short-note"), "note.ogg", { durationSeconds: 30 });
    expect(result).toMatchObject({ success: true, transcript: "hello from today's chain" });
    vi.mocked(console.warn).mockRestore();
  });
});

describe("EPIC-20 A10: a long note goes to ElevenLabs in parts", () => {
  const parts = [1, 2, 3].map((n) => ({ data: Buffer.from(`PART-${n}-audio`), filename: `seg000${n}.mp3` }));
  const split = vi.fn(async () => parts);

  function memoryCache() {
    const store = new Map<string, string>();
    return {
      store,
      cache: {
        get: async (i: number, n: number) => store.get(`${n}-${i}`) ?? null,
        put: async (i: number, n: number, text: string) => void store.set(`${n}-${i}`, text),
        clear: async () => store.clear(),
      },
    };
  }

  it("every part on ElevenLabs, in order, one ledger row per part", async () => {
    reply = (body) => ({ status: 200, json: { text: `text ${/PART-(\d)/.exec(body)?.[1]}` } });
    const usage: LlmUsageReport[] = [];
    const fallback = vi.fn(async (): Promise<TranscriptionEnvelope> => ({ success: true, transcript: "never", provider: "x" }));
    const result = await transcribeElevenLabsFirst(cfg(), {
      data: Buffer.from("whole"), filename: "long.ogg", durationSeconds: 900, chunkSeconds: 300, split, fallback,
      onUsage: (r) => usage.push(r),
    });
    expect(result).toEqual({ success: true, transcript: "text 1 text 2 text 3", provider: "elevenlabs scribe_v1" });
    expect(fallback).not.toHaveBeenCalled();
    expect(usage.map((u) => u.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(usage.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0)).toBeCloseTo(estimateElevenLabsUsd(900));
  });

  it("a part ElevenLabs fails goes down the chain on its own; the others stay ElevenLabs'", async () => {
    reply = (body) => (body.includes("PART-2") ? { status: 503, json: { detail: "busy" } } : { status: 200, json: { text: `text ${/PART-(\d)/.exec(body)?.[1]}` } });
    const fallback = vi.fn(async (data: Buffer): Promise<TranscriptionEnvelope> => ({ success: true, transcript: `central for ${data.toString()}`, provider: "central faster-whisper small" }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await transcribeElevenLabsFirst(cfg(), {
      data: Buffer.from("whole"), filename: "long.ogg", durationSeconds: 900, chunkSeconds: 300, split, fallback,
    });
    vi.mocked(console.warn).mockRestore();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]![0].toString()).toBe("PART-2-audio");
    expect(result).toMatchObject({ success: true, transcript: "text 1 central for PART-2-audio text 3" });
    expect(result.provider).toBe("elevenlabs scribe_v1 (1 of 3 parts via central)");
  });

  it("parts kept from an earlier try are not sent again; a part the chain also fails ends the try with the rest kept", async () => {
    const { store, cache } = memoryCache();
    reply = (body) => (body.includes("PART-3") ? { status: 500, json: {} } : { status: 200, json: { text: `text ${/PART-(\d)/.exec(body)?.[1]}` } });
    const down = vi.fn(async (): Promise<TranscriptionEnvelope> => ({ success: false, provider: "openai", error: "no credit", failureReason: "provider_credit_exhausted" }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = await transcribeElevenLabsFirst(cfg(), {
      data: Buffer.from("whole"), filename: "long.ogg", durationSeconds: 900, chunkSeconds: 300, split, fallback: down, partCache: cache,
    });
    expect(first).toMatchObject({ success: false, failureReason: "provider_credit_exhausted" });
    expect(store.size).toBe(2);

    seen = [];
    reply = (body) => ({ status: 200, json: { text: `text ${/PART-(\d)/.exec(body)?.[1]}` } });
    const second = await transcribeElevenLabsFirst(cfg(), {
      data: Buffer.from("whole"), filename: "long.ogg", durationSeconds: 900, chunkSeconds: 300, split, fallback: down, partCache: cache,
    });
    vi.mocked(console.warn).mockRestore();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toContain("PART-3");
    expect(second).toMatchObject({ success: true, transcript: "text 1 text 2 text 3" });
    expect(store.size).toBe(0);
  });

  it("a note up to 1.2 parts long is one call and never cut", async () => {
    split.mockClear();
    const result = await transcribeElevenLabsFirst(cfg(), {
      data: Buffer.from("whole"), filename: "n.ogg", durationSeconds: 350, chunkSeconds: 300, split,
      fallback: async () => ({ success: false }),
    });
    expect(split).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, transcript: "hello from eleven" });
  });
});
