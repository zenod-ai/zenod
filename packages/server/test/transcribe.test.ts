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
