import { describe, expect, it } from "vitest";
import { extractIntakeAsks, formatIntakeAsks, intakeAsksContextNote } from "../src/intakeAsks.js";

describe("intake ask extraction", () => {
  it("extracts the anchor voice-note asks into visible classified items", () => {
    const transcript = [
      "I want to make sure that this voice note is properly managed, meaning that it will be understood and handled.",
      "Can you figure out what happened to that request of the UI, did it ever become a node, can you find it in the transcripts and give me a small report?",
      "I want you to use Zenod to research memory and then contrast it by just searching directly into the Obsidian brain and GitHub.",
      "Maybe this is a separate point. I want to do a series of benchmarks against Zenod with ten questions, token cost, and reliability measurement.",
      "I will be sending WhatsApp messages with screenshots and whatever, so maybe handle those screenshots as related evidence.",
      "The notification path is incredibly powerful: Epaminon or Codex should escalate to Console, and Console should call Phylax to tell me when it needs me.",
    ].join(" ");

    const asks = extractIntakeAsks(transcript);
    const formatted = formatIntakeAsks(asks);

    expect(asks.length).toBeGreaterThanOrEqual(6);
    expect(formatted).toContain("Audit whether the voice note was properly processed");
    expect(formatted).toContain("prior backlog UI request");
    expect(formatted).toContain("Use Zenod for memory retrieval");
    expect(formatted).toContain("Zenod retrieval benchmark");
    expect(formatted).toContain("screenshots and follow-up comments");
    expect(formatted).toContain("escalation path");
    expect(new Set(asks.map((ask) => ask.id)).size).toBe(asks.length);
    expect(asks.every((ask) => ask.sourceText.length > 0)).toBe(true);
  });

  it("keeps an explicit separate point as a separate ask", () => {
    const asks = extractIntakeAsks(
      [
        "Can you look up whether the screenshot was stored and tell me what happened?",
        "Maybe this is a separate point: create a benchmark for Zenod retrieval and measure token cost.",
      ].join(" "),
    );

    expect(asks.length).toBeGreaterThanOrEqual(2);
    expect(formatIntakeAsks(asks)).toContain("Zenod retrieval benchmark");
  });

  it("formats a context note that tells the model not to flatten asks", () => {
    const asks = extractIntakeAsks(
      "Can you research the prior backlog UI request? Also create a benchmark for Zenod retrieval with token cost and reliability measurement.",
    );

    const note = intakeAsksContextNote(asks);
    expect(note).toContain("Treat them as separate asks");
    expect(note).toContain("Source snippets:");
  });
});
