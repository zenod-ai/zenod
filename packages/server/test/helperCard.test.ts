import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanHelperCard, namedMemories, pictureTitle } from "../src/helperCard.js";
import { InboxStore } from "../src/inboxStore.js";

// EPIC-14 S36: the one shape of a helper's card (a picture of the change, why yes, why not).
describe("helper card (S36)", () => {
  it("keeps a card only with both reasons, and a picture only with two different ideas", () => {
    expect(cleanHelperCard({ yes: "Both are about the flat." })).toBeNull();
    expect(cleanHelperCard({ yes: " Both are\nabout the flat. ", no: "It may add little.", picture: { change: "link", from: "Boiler", to: "boiler" } }))
      .toEqual({ picture: null, yes: "Both are about the flat.", no: "It may add little." });
    expect(cleanHelperCard({ yes: "y", no: "n", picture: { change: "merge", from: "A", to: "B" } })!.picture).toBeNull();
    expect(cleanHelperCard({ yes: "y", no: "n", picture: { change: "own-place", from: "Shed", to: "anything" } })!.picture).toEqual({ change: "own-place", from: "Shed", to: null });
  });

  it("a question's card: the words with two or three meanings, and why it asks (S40 folded in)", () => {
    const which = { change: "which", from: "the flat", meanings: ["Valencia flat", "valencia flat", "Barcelona flat", "Lisbon flat", "Porto flat"] };
    expect(cleanHelperCard({ why: "You have two flats.", picture: which })).toEqual({
      picture: { change: "which", from: "the flat", to: null, meanings: ["Valencia flat", "Barcelona flat", "Lisbon flat"] }, why: "You have two flats.",
    });
    expect(cleanHelperCard({ why: "One meaning only.", picture: { change: "which", from: "the flat", meanings: ["Valencia flat"] } })).toBeNull();
    expect(cleanHelperCard({ why: "No picture." })).toBeNull();
  });

  it("says each change in plain words", () => {
    expect(pictureTitle({ change: "link", from: "Boiler", to: "Home" })).toBe('I\'d link "Boiler" with "Home".');
    expect(pictureTitle({ change: "unlink", from: "Boiler", to: "Garden" })).toBe('I\'d take the link off between "Boiler" and "Garden".');
    expect(pictureTitle({ change: "move", from: "Boiler", to: "Home" })).toBe('I\'d move "Boiler" under "Home".');
    expect(pictureTitle({ change: "rename", from: "Flat", to: "Home" })).toBe('I\'d rename "Flat" to "Home".');
    expect(pictureTitle({ change: "own-place", from: "Shed", to: null })).toBe('I\'d give "Shed" its own place at the top of your memory.');
  });

  it("names a memory the way the person knows it, never by the model's number", () => {
    const said = ["your voice note of 3 Nov", 'your note "Boiler"'];
    expect(namedMemories("Memory 1 leaves it open.", said)).toBe("Your voice note of 3 Nov leaves it open.");
    expect(namedMemories("as memories 1 and 2 say", said)).toBe('as your voice note of 3 Nov and your note "Boiler" say');
    expect(namedMemories("memory 9 is unknown", said)).toBe("memory 9 is unknown");
  });

  it("the inbox keeps the card on a suggestion, a question and a finding", () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-card-"));
    try {
      const store = new InboxStore(join(dir, "inbox.sqlite"));
      const card = { picture: { change: "link" as const, from: "Boiler", to: "Home" }, yes: "Both are about the flat.", no: "It may add little." };
      expect(store.post({ kind: "suggestion", from: "Topic gardener", title: "t", action: "Link Boiler to Home.", card }).card).toEqual(card);
      expect(store.post({ kind: "finding", from: "Weekly recap", title: "f" }).card).toBeNull();
      const asked = store.post({ kind: "question", from: "Open loops finder", title: "q", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], card: { ...card, picture: null } });
      expect(store.get(asked.id)!.card).toEqual({ ...card, picture: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
