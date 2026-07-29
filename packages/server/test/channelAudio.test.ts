import { afterEach, describe, expect, it } from "vitest";

import { transcribeChannelAudio } from "../src/channelAudio.js";
import { NO_SPEECH_MESSAGE } from "../src/transcribe.js";
import type { Settings } from "../src/settings.js";

function settingsWith(openrouterApiKey: string | null): Settings {
  return {
    whisperModel: () => "small",
    get: (key: string) => key === "openrouter_api_key" ? openrouterApiKey : null,
    openrouterTranscriptionModel: () => "openai/whisper-large-v3-turbo",
    longTranscriptionProvider: () => openrouterApiKey ? "openrouter" : "local",
    useOpenAiForLongTranscription: () => false,
  } as unknown as Settings;
}

const settings = settingsWith("sk-or-test");

describe("transcribeChannelAudio", () => {
  afterEach(() => {
    delete process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS;
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("uses the shared transcription settings path and returns clean transcript text", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "can you hear me";
    const result = await transcribeChannelAudio(settings, Buffer.from("audio"), "voice.ogg");
    expect(result).toMatchObject({ success: true, transcript: "can you hear me" });
  });

  it("preserves no-speech failures from the transcription layer", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "thank you";
    const result = await transcribeChannelAudio(settings, Buffer.from("audio"), "voice.ogg");
    expect(result).toMatchObject({ success: false, noSpeech: true, error: NO_SPEECH_MESSAGE });
  });

  it("fails immediately when the configured cloud provider fails instead of falling back to local Whisper", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "unused";
    process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS = "openrouter";
    const startedAt = Date.now();

    const result = await transcribeChannelAudio(settings, Buffer.from("audio"), "voice.ogg");

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toMatchObject({
      success: false,
      provider: "openrouter",
      error: "openrouter transcription failed",
    });
    expect(result.provider).not.toMatch(/whisper\.cpp/);
  });

  it("fails immediately when no cloud provider is configured instead of starting local Whisper", async () => {
    const startedAt = Date.now();

    const result = await transcribeChannelAudio(settingsWith(null), Buffer.from("audio"), "voice.ogg");

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toEqual({
      success: false,
      error: "no cloud transcription provider is configured for this channel",
    });
  });
});
