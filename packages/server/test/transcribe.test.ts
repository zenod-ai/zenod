import { afterEach, describe, expect, it } from "vitest";

import { NO_SPEECH_MESSAGE, transcribeAudio } from "../src/transcribe.js";

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
