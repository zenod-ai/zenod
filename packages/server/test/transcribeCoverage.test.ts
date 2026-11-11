import { describe, expect, it } from "vitest";
import {
  countTranscriptWords,
  TRANSCRIPT_COVERAGE_MIN_SECONDS,
  TRANSCRIPT_MIN_WORDS_PER_MINUTE,
  transcriptCoverage,
} from "../src/transcribe.js";

// EPIC-24 M13: a provider that stops early still answers 200 with clean text.
// Words per probed minute far below speech rate must trigger a segmented re-run.

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("transcript coverage", () => {
  it("counts words across any whitespace", () => {
    expect(countTranscriptWords("  one two\nthree\tfour  ")).toBe(4);
    expect(countTranscriptWords("")).toBe(0);
  });

  it("passes a normal speech rate", () => {
    // Jordi's one-hour note: 9,623 words for about an hour, ~160 words a minute.
    const coverage = transcriptCoverage(words(9_623), 3_600);
    expect(coverage.low).toBe(false);
    expect(Math.round(coverage.wordsPerMinute ?? 0)).toBe(160);
  });

  it("flags text that covers a fraction of a long recording", () => {
    // 600 words for 30 minutes: 20 words a minute, the model stopped early.
    expect(transcriptCoverage(words(600), 1_800).low).toBe(true);
  });

  it("does not judge short notes, where a pause swings the rate", () => {
    expect(transcriptCoverage("yes", TRANSCRIPT_COVERAGE_MIN_SECONDS - 1).low).toBe(false);
  });

  it("does not judge without a probed duration", () => {
    expect(transcriptCoverage(words(3), null)).toMatchObject({ low: false, wordsPerMinute: null, seconds: null });
  });

  it("uses a floor far below normal speech", () => {
    expect(TRANSCRIPT_MIN_WORDS_PER_MINUTE).toBeLessThanOrEqual(60);
    expect(TRANSCRIPT_MIN_WORDS_PER_MINUTE).toBeGreaterThan(0);
  });
});
