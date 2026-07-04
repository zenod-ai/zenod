import { describe, expect, it } from "vitest";
import {
  extractIntakeAsks,
  formatCurrentIntentLedger,
  formatIntakeAsks,
  formatSafeActionPlan,
  intakeAsksContextNote,
  isExecuteDirective,
  resolveCurrentIntents,
  shouldDecomposeIntake,
} from "../src/intakeAsks.js";

// Soak finding #1 / C-26 — images are filed, not interrogated; internal ask-ledger
// language never surfaces (doctrine rule 5).
describe("C-26 · intake provenance + surface language (#565)", () => {
  // A screenshot's described contents often LOOK like a multi-ask message. This is the
  // exact leak text shape: a long block with several ask-signals.
  const embeddedImageText =
    "WhatsApp image from +123:\n\nThe screenshot shows a chat: can you research the idealista scraper, " +
    "also please file a ticket for the benchmark, and notify me when the runner finishes. " +
    "Another thing — investigate what happened to the prior backlog UI request and look up its status.";

  it("PART 1: embedded (image-derived) content is NOT decomposed into asks", () => {
    // The bare text WOULD decompose (it's full of ask-signals)…
    expect(extractIntakeAsks(embeddedImageText).length).toBeGreaterThan(1);
    // …but as embedded context on the Console it must not.
    expect(shouldDecomposeIntake({ agentName: "console", text: embeddedImageText, embeddedContext: true })).toBe(false);
    // A normal typed multi-ask message still decomposes.
    expect(shouldDecomposeIntake({ agentName: "console", text: embeddedImageText })).toBe(true);
    // Execute directives and non-Console agents never decompose.
    expect(shouldDecomposeIntake({ agentName: "console", text: "have Epaminon run this and push it" })).toBe(false);
    expect(shouldDecomposeIntake({ agentName: "zenod", text: embeddedImageText })).toBe(false);
  });

  it("PART 2: the intake context note forbids surfacing internal ask-ledger language", () => {
    const asks = extractIntakeAsks(embeddedImageText);
    const note = intakeAsksContextNote(asks);
    // It must instruct the model to keep the decomposition internal (doctrine rule 5).
    expect(note.toLowerCase()).toContain("doctrine rule 5");
    expect(note.toLowerCase()).toContain("never render it to the user");
    // The exact leaked phrasings are named as forbidden.
    expect(note).toContain("no durable backlog request");
    expect(note).toContain("no Phylax event/urgency provided");
  });
});

describe("execute fast-lane (isExecuteDirective)", () => {
  it("recognizes a codex/Epaminon task directive, tolerating voice-transcription mangling", () => {
    // The real research VN that shattered into 6: 'panminon' and 'codec' are mishearings.
    const researchVn =
      "I want to give a task to a panminon to run a codec's task to look at this idealista scraper repo and this Twitter bot. And I wanted to do like a small research job that culminates into a research document in Markdown, which it can commit to the repo.";
    expect(isExecuteDirective(researchVn)).toBe(true);
    expect(isExecuteDirective("this is a task for codex which I believe is controlled by Epaminon")).toBe(true);
    expect(isExecuteDirective("have Epaminon run this and push it")).toBe(true);
  });

  it("does not fire for non-execute capabilities (so they still route/decompose normally)", () => {
    expect(isExecuteDirective("remember that my flight is at 3pm tomorrow")).toBe(false);
    expect(isExecuteDirective("can you post a tweet saying hello world")).toBe(false);
    expect(isExecuteDirective("what's the status of that request from yesterday?")).toBe(false);
    expect(isExecuteDirective("create a backlog ticket to improve onboarding")).toBe(false);
  });
});

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

  it("resolves prior-work questions as queries before proposing new durable work", () => {
    const asks = extractIntakeAsks(
      "Can you investigate what happened to the prior backlog UI request and tell me whether it became a ticket? Also open a ticket for implementing the Zenod retrieval benchmark.",
    );
    const intents = resolveCurrentIntents(asks);
    const formatted = formatCurrentIntentLedger(intents);

    expect(intents[0]).toMatchObject({
      actionType: "research",
      resolution: "query_prior_durable_work",
      status: "open",
    });
    expect(formatted).toContain("[open -> query_prior_durable_work]");
    expect(formatted).toContain("[open -> propose_durable_backlog]");
    expect(intents[0]?.safeAction).toContain("Search existing memory/issues first");
    expect(intents[1]?.safeAction).toContain("include the issue URL");
  });

  it("builds a safe action plan with receipt and clarification boundaries", () => {
    const asks = extractIntakeAsks(
      [
        "Can you investigate what happened to the prior backlog UI request?",
        "Also open a ticket for implementing the Zenod retrieval benchmark.",
        "Finally run the resulting ticket through Epaminon and notify me only when it needs my review.",
      ].join(" "),
    );

    const plan = formatSafeActionPlan(resolveCurrentIntents(asks));

    expect(plan).toContain("Search existing memory/issues first");
    expect(plan).toContain("include the issue URL before saying it was created");
    expect(plan).toContain("Delegate to Epaminon only with an exact target");
    expect(plan).toContain("after execution evidence exists, involve Phylax");
  });

  it("treats no-mutation instructions as constraints and keeps later screenshot asks", () => {
    const asks = extractIntakeAsks(
      [
        "Please do not create issues, run tickets, store memory, or notify me. This is a read-only test.",
        "Can you investigate what happened to the prior backlog UI request?",
        "Also, use Zenod memory first and contrast it with direct Obsidian or GitHub search.",
        "Maybe this is a separate point: design a small benchmark for Zenod retrieval with token cost and reliability measurement.",
        "Also handle screenshots and follow-up comments as related evidence in the same recent conversation.",
        "Finally, think about the Epaminon to Console to Phylax escalation path and tell me what would need to be tested there.",
      ].join(" "),
    );
    const formatted = formatIntakeAsks(asks);

    expect(formatted).not.toContain("do not create");
    expect(formatted).toContain("Handle screenshots and follow-up comments");
    expect(formatted).toContain("escalation path");
  });

  it("formats a context note that tells the model not to flatten asks", () => {
    const asks = extractIntakeAsks(
      "Can you research the prior backlog UI request? Also create a benchmark for Zenod retrieval with token cost and reliability measurement.",
    );

    const note = intakeAsksContextNote(asks);
    expect(note).toContain("Treat them as separate asks");
    expect(note).toContain("Current intent ledger decisions:");
    expect(note).toContain("Safe action plan:");
    expect(note).toContain("Receipt rule: never say created, filed, queued, running, stored, notified, or closed");
    expect(note).toContain("Source snippets:");
  });
});
