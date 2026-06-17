import { afterEach, describe, expect, it } from "vitest";

import { transcribeChannelAudio } from "../src/channelAudio.js";
import { NO_SPEECH_MESSAGE } from "../src/transcribe.js";
import type { Settings } from "../src/settings.js";

const settings = {
  whisperModel: () => "small",
  get: () => null,
  openrouterTranscriptionModel: () => "openai/whisper-large-v3-turbo",
  longTranscriptionProvider: () => "local",
  useOpenAiForLongTranscription: () => false,
} as unknown as Settings;

describe("transcribeChannelAudio", () => {
  afterEach(() => {
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
});
