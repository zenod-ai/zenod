import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyProviderFailure,
  fetchRetryingNetworkErrors,
  groqTranscribeFileWithRetry,
  NO_SPEECH_MESSAGE,
  transcribeAudio,
  transcriptionFailureFromResponse,
  transcriptionFailureFromThrown,
} from "../src/transcribe.js";

// Real OpenRouter 402 body from the incident log that motivated typed codes.
const OPENROUTER_402_BODY = JSON.stringify({
  error: {
    message: "This request requires at least $0.50 in balance for audio",
    code: 402,
    metadata: { limit_source: "openrouter_credits" },
  },
});

describe("transcription failure classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the OpenRouter 402 body as provider credit exhaustion with the HTTP status", () => {
    const envelope = transcriptionFailureFromResponse("openrouter", 402, OPENROUTER_402_BODY);
    expect(envelope).toMatchObject({
      success: false,
      provider: "openrouter",
      failureReason: "provider_credit_exhausted",
      httpStatus: 402,
    });
    expect(envelope.error).toContain("requires at least $0.50");
    expect(JSON.stringify(envelope)).not.toContain("sk-");
  });

  it.each([
    [401, "{}", "provider_auth_failed"],
    [403, "{}", "provider_auth_failed"],
    [429, JSON.stringify({ error: { message: "slow down" } }), "provider_rate_limited"],
    [500, "upstream exploded", "provider_unavailable"],
    [503, "", "provider_unavailable"],
    [429, JSON.stringify({ error: { code: "insufficient_quota" } }), "provider_credit_exhausted"],
    [400, JSON.stringify({ error: { message: "insufficient credits; add more credits" } }), "provider_credit_exhausted"],
  ] as const)("classifies provider HTTP failure (status %i)", (status, body, expected) => {
    expect(classifyProviderFailure(status, undefined, body)).toBe(expected);
  });

  it("classifies a thrown fetch failure via its cause code and preserves it", () => {
    const thrown = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    const envelope = transcriptionFailureFromThrown("openrouter", thrown);
    expect(envelope).toMatchObject({
      failureReason: "network_error",
      providerCode: "UND_ERR_CONNECT_TIMEOUT",
    });
    expect(envelope.error).toContain("UND_ERR_CONNECT_TIMEOUT");
  });

  it("does not retry a Groq 402 credit failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-groq-test-"));
    const file = join(dir, "a.flac");
    await writeFile(file, Buffer.from("audio"));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(OPENROUTER_402_BODY, { status: 402 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(groqTranscribeFileWithRetry(file, "gsk-test")).rejects.toMatchObject({
        status: 402,
        reason: "provider_credit_exhausted",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not retry a Groq 401 auth failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-groq-test-"));
    const file = join(dir, "a.flac");
    await writeFile(file, Buffer.from("audio"));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid API Key" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(groqTranscribeFileWithRetry(file, "gsk-test")).rejects.toMatchObject({
        status: 401,
        reason: "provider_auth_failed",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retries a bounded network error up to 3 attempts and reports attempts + cause", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const thrown = await fetchRetryingNetworkErrors("https://example.test/audio", {}).catch((err) => err);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transcriptionFailureFromThrown("openrouter", thrown)).toMatchObject({
      failureReason: "network_error",
      providerCode: "ETIMEDOUT",
      attempts: 3,
    });
  }, 15_000);
});

// The fake-transcript hook (ZENOD_WHISPER_FAKE_TRANSCRIPT) short-circuits the
// provider cascade in test env, so these exercise the post-transcription
// hallucination guard without touching ffmpeg/whisper.
describe("transcribeAudio anti-hallucination guard", () => {
  afterEach(() => {
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  const run = () => transcribeAudio(Buffer.from(""), "note.ogg");

  it.each(["you", "You.", "thank you", "Thanks for watching!", "you you you", "  .  "])(
    "treats silence-hallucination filler %j as no-speech",
    async (filler) => {
      process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = filler;
      const result = await run();
      expect(result.success).toBe(false);
      expect(result.noSpeech).toBe(true);
      expect(result.error).toBe(NO_SPEECH_MESSAGE);
    },
  );

  it("passes through a real transcript untouched", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "renew the travel insurance before Friday";
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.transcript).toBe("renew the travel insurance before Friday");
    expect(result.noSpeech).toBeUndefined();
  });
});

// Whisper.cpp is no longer shipped in the image (build: stop compiling whisper), so cloud
// STT MUST cover every case. The regression that shipped: a SHORT voice note with only an
// OpenRouter key configured (the deployed reality) fell through to local whisper and errored
// "whisper-cli is not installed". The routing must send short audio to whatever cloud key
// exists (groq → openrouter → openai) before whisper.
describe("transcribeAudio provider routing (cloud covers short audio without whisper)", () => {
  afterEach(() => {
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("short audio with only an OpenRouter key targets OpenRouter, never local whisper", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "hello this is a short voice note";
    const result = await transcribeAudio(Buffer.from("x"), "note.m4a", {
      openrouterApiKey: "sk-or-test",
      durationSeconds: 5,
    });
    expect(result.success).toBe(true);
    expect(result.provider).toMatch(/^openrouter/);
    // (the OpenRouter STT model is *named* whisper-large-v3-turbo — that's fine; what must
    // never happen is the LOCAL whisper.cpp binary, which the image no longer ships.)
    expect(result.provider).not.toMatch(/whisper\.cpp/);
  });

  it("short audio with a Groq key still prefers Groq", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "hello this is a short voice note";
    const result = await transcribeAudio(Buffer.from("x"), "note.m4a", {
      groqApiKey: "gsk-test",
      openrouterApiKey: "sk-or-test",
      durationSeconds: 5,
    });
    expect(result.provider).toMatch(/^groq/);
  });

  it("long audio explicitly assigned to Groq stays on Groq instead of silently selecting local", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "this is a long voice note";
    const result = await transcribeAudio(Buffer.from("x"), "note.m4a", {
      groqApiKey: "gsk-test",
      longTranscriptionProvider: "groq",
      durationSeconds: 1_200,
    });
    expect(result.provider).toMatch(/^groq/);
    expect(result.provider).not.toMatch(/whisper\.cpp/);
  });
});
