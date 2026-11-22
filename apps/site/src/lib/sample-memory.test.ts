import { describe, expect, it } from "vitest";

import { linksOf, notesFor, SAMPLE_FIRST_WEEK, SAMPLE_WEEKS, sampleStrengthLook, sampleWeek } from "./sample-memory";

describe("sample memory (E26-S35, E26-S38)", () => {
  it("shows Sara's week first, then two more weeks of other kinds of people", () => {
    expect(SAMPLE_FIRST_WEEK).toBe("sara");
    expect(SAMPLE_WEEKS.map((week) => week.id)).toEqual(["sara", "dan", "priya"]);
    expect(new Set(SAMPLE_WEEKS.map((week) => week.who)).size).toBe(3);
  });
  for (const week of SAMPLE_WEEKS) {
    it(`${week.name}: every thought comes from a voice note, every note is used, links join drawn thoughts`, () => {
      for (const thought of week.thoughts) expect(notesFor(week, thought.id).length).toBeGreaterThan(0);
      const used = new Set(week.thoughts.flatMap((thought) => thought.notes));
      expect(week.notes.every((note) => used.has(note.id))).toBe(true);
      const ids = new Set(week.thoughts.map((thought) => thought.id));
      for (const link of week.links) expect(ids.has(link.a) && ids.has(link.b)).toBe(true);
      expect(ids.has(week.start)).toBe(true);
      expect(week.thoughts.length).toBe(7);
      // each thought has a line to the rest, so nothing floats alone
      for (const thought of week.thoughts) expect(linksOf(week, thought.id).length).toBeGreaterThan(0);
    });
    it(`${week.name}: invented and plain, no real people and no words Jordi hates`, () => {
      const text = week.notes.map((note) => note.words).join(" ") + week.thoughts.map((t) => t.label).join(" ");
      expect(text).not.toMatch(/garden|\bshed\b|westcomb|cabin|@|https?:|\d{6,}/i);
    });
  }
  it("links come strongest first, with the app's strength look", () => {
    expect(linksOf(sampleWeek("sara"), "bday")[0].thought.id).toBe("tickets");
    expect(sampleStrengthLook(0.3).weak).toBe(true);
    expect(sampleStrengthLook(0.95).width).toBeGreaterThan(sampleStrengthLook(0.5).width);
  });
});
