import { describe, expect, it } from "vitest";
import { paginateMemoryEntries, memoryEntrySummaries } from "../src/engine/entryPagination.js";
import { selectMemoryEntries } from "../src/engine/evidence.js";
import { fromAppLabel, originLabel, readableTitle, sourceAppOf, SPOKEN_TO_ZENOD } from "../src/engine/entryLabel.js";
import type { MemoryEntry } from "../src/types.js";

// EPIC-21 V9: team test notes only, never a person's own words.
const header = (file: string, extra: string[] = []) => [
  `Voice note "${file}" ingested through Zenod media seam.`,
  "Raw artifact: drive://file/demo", "Media type: audio/webm", "Source: EpicTeam Chat voice note", ...extra,
  "Transcribed by whisper.cpp base.", "",
].join("\n");

const entry = (n: number, over: Partial<MemoryEntry>): MemoryEntry => ({
  evidenceRef: `Log/2026-11-23.md#^e-00000${n}`, path: "Log/2026-11-23.md", anchor: `e-00000${n}`, title: "t", content: "", source: "mcp",
  verbatim: true, capturedAt: `2026-11-23T10:0${n}:00Z`, provider: "google_drive", url: "https://example.test", ...over,
});

const chat = entry(1, {
  title: 'Voice note "epicteam-chat-voice-note-2026-11-23T00-57-38-983Z.webm" ingeste...', contentType: "voice_note",
  content: header("epicteam-chat-voice-note-2026-11-23T00-57-38-983Z.webm", ["Source app: EpicTeam Chat"]) + "\nCheck the demo notes for the alpha test and send them over",
});
const card = entry(2, {
  title: 'Voice note "epicteam-card-answer-voice-note.webm" ingeste...', contentType: "voice_note",
  content: header("epicteam-card-answer-voice-note.webm", ["Source app: EpicTeam card answer"]) + "\nYes go ahead with the second option",
});
const social = entry(3, {
  title: 'Voice note "epicsocial-voice-note.ogg" ingeste...', contentType: "voice_note",
  content: header("epicsocial-voice-note.ogg", ["Source app: EpicSocial"]) + "\nPost it on Friday morning",
});
const whatsapp = entry(4, {
  source: "whatsapp", title: 'Voice note "ABCD1234.ogg" ingeste...', contentType: "voice_note",
  content: header("ABCD1234.ogg").replace("EpicTeam Chat voice note", "WhatsApp voice note") + "\nRemember to buy lamp oil",
});
const legacyNoType = entry(5, {
  title: 'Voice note "legacy.ogg" ingeste...', content: header("legacy.ogg").replace("EpicTeam Chat voice note", "WhatsApp voice note") + "\nOld note without a content type",
});
const text = entry(6, { source: "whatsapp", contentType: "text", title: "Buy milk", content: "Buy milk on the way home" });
const all = [chat, card, social, whatsapp, legacyNoType, text];

describe("EPIC-21 V9 label and title", () => {
  it("reads the app from the stored Source app line, in the header only", () => {
    expect(sourceAppOf(chat.content)).toBe("EpicTeam Chat");
    expect(sourceAppOf(whatsapp.content)).toBeNull();
    // A person saying it in their own words is not the stored line.
    expect(sourceAppOf(`${header("a.ogg")}\nSource app: EpicTeam Chat`)).toBeNull();
  });

  it("labels app notes by their app and everything else spoken as Spoken to Zenod", () => {
    expect(all.map((e) => originLabel(e))).toEqual([
      "From EpicTeam Chat", "From an EpicTeam card answer", "From EpicSocial", SPOKEN_TO_ZENOD, SPOKEN_TO_ZENOD, null,
    ]);
    expect(fromAppLabel("EpicTeam card answer")).toBe("From an EpicTeam card answer");
    // A capture receipt names the app before the vault entry holds the line.
    expect(originLabel({ content: "", contentType: "voice_note", sourceApp: "EpicTeam Chat" })).toBe("From EpicTeam Chat");
  });

  it("gives a voice note a real title and leaves other titles and the stored text alone", () => {
    expect(readableTitle(chat)).toBe("Check the demo notes for the alpha test");
    expect(readableTitle(whatsapp)).toBe("Remember to buy lamp oil");
    expect(readableTitle(text)).toBe("Buy milk");
    expect(readableTitle({ ...chat, content: header("x.webm") })).toBe("Voice note, 2026-11-23");
    expect(chat.content).toContain('Voice note "epicteam-chat-voice-note-');
    for (const e of all) expect(readableTitle(e)).not.toMatch(/\.(webm|ogg)/);
  });

  it("shows the label and title in the summaries", () => {
    const [first, , , fourth, , last] = memoryEntrySummaries(all);
    expect(first).toMatchObject({ label: "From EpicTeam Chat", title: "Check the demo notes for the alpha test" });
    expect(fourth).toMatchObject({ label: SPOKEN_TO_ZENOD });
    expect(last).toMatchObject({ label: null, title: "Buy milk" });
  });

  it("filters by label (any case) and by origin, and pages the same way", () => {
    const refs = (q: Parameters<typeof selectMemoryEntries>[1]) => selectMemoryEntries(all, { order: "oldest", ...q }).map((e) => e.anchor);
    expect(refs({ label: "from epicteam chat" })).toEqual(["e-000001"]);
    expect(refs({ label: "From an EpicTeam card answer" })).toEqual(["e-000002"]);
    expect(refs({ origin: "app" })).toEqual(["e-000001", "e-000002", "e-000003"]);
    expect(refs({ origin: "zenod" })).toEqual(["e-000004", "e-000005"]);
    expect(refs({ label: SPOKEN_TO_ZENOD, origin: "app" })).toEqual([]);
    const first = paginateMemoryEntries(all, { origin: "app", limit: 2 }, "t");
    expect(first.entries).toHaveLength(2);
    expect(first.matchedEntries).toBe(3);
    // A cursor made for one filter is refused under another.
    expect(() => paginateMemoryEntries(all, { origin: "zenod", limit: 2 }, "t", first.nextCursor!)).toThrow("Invalid entry cursor");
  });
});
