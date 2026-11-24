import { describe, expect, it } from "vitest";
import { terminalCaptureReceipt } from "../src/phylaxChannels.js";
import { longNoteNotice } from "../src/centralTranscription.js";
import { voiceNotTranscribedReply, voiceTranscriptionRetryReply } from "../src/phylaxPortedRuntime.js";
import {
  entryLink,
  entryLinkBase,
  entryLinkIn,
  VOICE_EMPTY_TRANSCRIPT_REPLY,
  VOICE_RECEIVED_REPLY,
  VOICE_STILL_WORKING_REPLY,
  voiceOverLimitReply,
} from "../src/voiceReplyWords.js";

// E7-S35 (Jordi, 24 Nov 2026): "I get a lot of long messages ... if I want to access the full transcript just give me a link".
const words = (text: string) => text.trim().split(/\s+/).length;

function captureDone(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: "done" }],
    structuredContent: { ticket_id: "job-1", state: "done", result: payload },
  } as Parameters<typeof terminalCaptureReceipt>[0];
}

describe("E7-S35 voice note replies", () => {
  it("links a captured note to its entry view in the app, never a public or raw path", () => {
    expect(entryLink("Log/2026-11-24.md#^e-798779", "https://cloud.zenod.dev"))
      .toBe("https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-798779");
    expect(entryLink(null)).toBeNull();
    expect(entryLink("   ")).toBeNull();
    expect(entryLinkBase({})).toBe("https://cloud.zenod.dev");
    expect(entryLinkBase({ PHYLAX_ENTRY_LINK_BASE: "https://app.example.test/" })).toBe("https://app.example.test");
    expect(entryLinkBase({ PHYLAX_ENTRY_LINK_BASE: "javascript:alert(1)" })).toBe("https://cloud.zenod.dev");
    const reply = "Saved ✓ Full text: https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-1";
    expect(entryLinkIn(reply)).toBe("https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-1");
    expect(entryLinkIn("Voice handled.")).toBeNull();
  });

  it("answers a transcribed voice note with one line and the full-text link, not the transcript", () => {
    const transcript = "word ".repeat(2000).trim();
    const receipt = terminalCaptureReceipt(
      captureDone({
        evidenceRef: "Log/2026-11-24.md#^e-798779",
        filing: "pending",
        pagesTouched: ["Projects/Zenod.md"],
        rawArtifact: { archiveUrl: "https://drive.google.com/file/d/abc/view" },
        extraction: { transcriptionStatus: "transcribed" },
      }),
      "job-1",
      "ingest_memory",
      { text_transcript: transcript } as never,
    );
    expect(receipt?.text).toBe("Saved ✓ Full text: https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-798779");
    expect(receipt?.text).not.toContain("\n");
    expect(receipt?.text).not.toContain("word word");
    expect(receipt?.text).not.toContain("drive.google.com");
    expect(receipt?.evidenceRef).toBe("Log/2026-11-24.md#^e-798779");
  });

  it("still says saved in one line when the note has no entry yet", () => {
    const receipt = terminalCaptureReceipt(captureDone({ filing: "filed" }), "job-1", "store_memory");
    expect(receipt?.text).toBe("Saved ✓");
  });

  it("keeps a note over the limit to one line: audio saved, not transcribed, and its link", () => {
    const receipt = terminalCaptureReceipt(
      captureDone({ evidenceRef: "Log/2026-11-24.md#^e-x", extraction: { transcriptionStatus: "skipped_duration_limit" } }),
      "job-1",
      "ingest_memory",
    );
    expect(receipt?.text).toBe("Audio saved, not transcribed (over 12 hours). Note: https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-x");
  });

  it("keeps every at-once, progress and failure reply to one short line", () => {
    const failure = { code: "timeout", reason: "timeout", message: "aborted", attempts: 5 };
    const replies = [
      VOICE_RECEIVED_REPLY,
      VOICE_STILL_WORKING_REPLY,
      longNoteNotice(7086),
      voiceOverLimitReply("12 hours"),
      voiceTranscriptionRetryReply(failure, 5 * 60_000),
      voiceNotTranscribedReply(failure),
      VOICE_EMPTY_TRANSCRIPT_REPLY,
    ];
    expect(replies).toEqual([
      "Got it, on it.",
      "Still on it.",
      "Got it, long note, about 36 min.",
      "Got it. Over 12 hours, so the audio is saved, not transcribed.",
      "⚠️ Not transcribed yet: transcription ran out of time (ZT-TIMEOUT). Audio kept, retrying in about 5 min.",
      "⚠️ Not transcribed: transcription ran out of time after 5 tries (ZT-TIMEOUT). Audio kept.",
      "⚠️ Not transcribed: the transcript came back empty. Audio kept.",
    ]);
    for (const reply of replies) {
      expect(reply).not.toContain("\n");
      expect(words(reply)).toBeLessThanOrEqual(18);
    }
  });

  it("puts the note's link on the not-transcribed line", () => {
    const link = "https://cloud.zenod.dev/#memory?path=Log%2F2026-11-24.md%23%5Ee-2";
    expect(voiceNotTranscribedReply({ code: "no_speech", reason: "no_speech", message: "" }, link))
      .toBe(`⚠️ Not transcribed: no speech was found in it (ZT-SPEECH). Audio kept. Note: ${link}`);
  });
});
