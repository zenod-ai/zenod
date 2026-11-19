import { describe, expect, it } from "vitest";

import { linksOf, notesFor, SAMPLE_LINKS, SAMPLE_NOTES, SAMPLE_THOUGHTS, sampleStrengthLook } from "./sample-memory";

describe("sample memory (E26-S35)", () => {
  it("every thought comes from at least one of Sara's voice notes, and every note is used", () => {
    for (const thought of SAMPLE_THOUGHTS) expect(notesFor(thought.id).length).toBeGreaterThan(0);
    const used = new Set(SAMPLE_THOUGHTS.flatMap((thought) => thought.notes));
    expect(SAMPLE_NOTES.every((note) => used.has(note.id))).toBe(true);
  });
  it("links join drawn thoughts, strongest first, with the app's strength look", () => {
    const ids = new Set(SAMPLE_THOUGHTS.map((thought) => thought.id));
    for (const link of SAMPLE_LINKS) expect(ids.has(link.a) && ids.has(link.b)).toBe(true);
    expect(linksOf("bday")[0].thought.id).toBe("tickets");
    expect(sampleStrengthLook(0.3).weak).toBe(true);
    expect(sampleStrengthLook(0.95).width).toBeGreaterThan(sampleStrengthLook(0.5).width);
  });
});
