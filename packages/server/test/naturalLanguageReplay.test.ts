import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { formatConversationTranscript } from "../src/conversationTranscript.js";
import {
  extractIntakeAsks,
  prefixReplyWithIntakeAsks,
  resolveCurrentIntents,
  type CurrentIntentResolution,
  type IntakeAskActionType,
} from "../src/intakeAsks.js";
import { WhatsAppStore } from "../src/whatsappStore.js";

interface FixtureExpectation {
  name: string;
  text: string;
  actionTypes: IntakeAskActionType[];
  resolutions: CurrentIntentResolution[];
  mustContain?: string[];
}

const anchorVoiceNote = [
  "I want to make sure that this voice note was properly managed and that we can later answer what happened to it with evidence.",
  "Can you figure out what happened to that request of the backlog UI, whether it became a node, and give me a small report?",
  "I want you to use Zenod first for memory retrieval and then contrast it with direct Obsidian and GitHub search.",
  "Maybe this is a separate point: create a benchmark for Zenod retrieval with ten questions, token cost, and reliability measurement.",
  "Also prioritize the notification path test where Epaminon or Codex escalates back to Console, and Console calls Phylax when it needs me.",
  "Finally handle screenshots and follow-up comments as related evidence in the same recent conversation.",
].join(" ");

const simpleAnswerNowNote = [
  "Please summarize the current situation in plain language for me.",
  "The context is that I have been sending several long notes and I need one concise answer before we decide whether to open tickets.",
  "I do not want you to create anything, run anything, notify anyone, or store a new memory from this specific message.",
  "The useful output is a direct explanation of what the system currently understands and what remains uncertain.",
  "Keep it short, make it readable, and do not turn this into a backlog item unless I explicitly ask for that later.",
].join(" ");

const fixtures: FixtureExpectation[] = [
  {
    name: "long voice note with one answer-now ask",
    text: simpleAnswerNowNote,
    actionTypes: ["answer_now", "answer_now"],
    resolutions: ["answer_now", "answer_now"],
    mustContain: ["Answer"],
  },
  {
    name: "long voice note with multiple independent asks",
    text: anchorVoiceNote,
    actionTypes: ["research", "research", "research", "create_backlog", "notify_or_escalate", "research"],
    resolutions: [
      "query_prior_durable_work",
      "query_prior_durable_work",
      "new_current_intent",
      "propose_durable_backlog",
      "notify_or_escalate",
      "new_current_intent",
    ],
    mustContain: ["Safe action plan", "Use Zenod for memory retrieval", "Involve Phylax only with the event"],
  },
  {
    name: "that ticket reference must resolve candidates before mutation",
    text: [
      "Can you close that ticket we were discussing about the backlog system plan?",
      "Also do not mutate anything if the reference is ambiguous; show the candidates and ask me which one.",
    ].join(" "),
    actionTypes: ["create_backlog", "clarify"],
    resolutions: ["propose_durable_backlog", "awaiting_user"],
    mustContain: ["include the issue URL before saying it was created", "do not mutate any authority"],
  },
  {
    name: "create backlog and run execution request",
    text: [
      "Please create a GitHub issue in zenod-ai/zenod for the durable media follow-up flow with objective, scope, and acceptance criteria.",
      "Then run the resulting issue through Epaminon, but only after the exact issue URL exists.",
      "Notify me only after execution evidence exists or if it blocks.",
    ].join(" "),
    actionTypes: ["create_backlog", "execute", "notify_or_escalate"],
    resolutions: ["propose_durable_backlog", "delegate_execution", "notify_or_escalate"],
    mustContain: ["include the issue URL", "Involve Phylax only with the event"],
  },
  {
    name: "research-only request should not mutate",
    text: [
      "Please research the recent WhatsApp transcript and tell me whether the voice note was processed correctly.",
      "Use Zenod first and direct transcript readback second.",
      "Do not create issues, do not run anything, and do not notify me.",
    ].join(" "),
    actionTypes: ["research"],
    resolutions: ["new_current_intent"],
    mustContain: ["create no GitHub issue unless the user asks"],
  },
  {
    name: "priority change updates an existing durable work intent",
    text: [
      "Actually make the media attachment handling ticket higher priority than the benchmark ticket.",
      "Do not create a duplicate; update or comment on the existing backlog item if you can identify it.",
    ].join(" "),
    actionTypes: ["create_backlog"],
    resolutions: ["propose_durable_backlog"],
    mustContain: ["include the issue URL"],
  },
  {
    name: "blocked-agent escalation request",
    text: [
      "If Epaminon gets blocked because it needs my preference, have it escalate back through Console and Phylax.",
      "The notification should include the issue, the blocker, and what answer is needed from me.",
    ].join(" "),
    actionTypes: ["notify_or_escalate"],
    resolutions: ["notify_or_escalate"],
    mustContain: ["Involve Phylax only with the event, urgency, and source evidence"],
  },
  {
    name: "ambiguous ask must clarify before mutation",
    text: [
      "Can you handle that request from yesterday?",
      "I am not sure which repository it was in and I do not remember the issue number.",
      "Before changing anything, ask me or show candidates if there is more than one plausible match.",
    ].join(" "),
    actionTypes: ["clarify", "clarify"],
    resolutions: ["awaiting_user", "awaiting_user"],
    mustContain: ["do not mutate any authority until the user answers"],
  },
];

function replay(text: string) {
  const asks = extractIntakeAsks(text);
  const intents = resolveCurrentIntents(asks);
  const reply = prefixReplyWithIntakeAsks("Replay answer body.", asks);
  return { asks, intents, reply };
}

describe("natural-language intake replay suite", () => {
  it.each(fixtures)("$name", (fixture) => {
    const { asks, intents, reply } = replay(fixture.text);
    const evidenceText = [
      reply,
      ...asks.map((ask) => `${ask.summary}\n${ask.sourceText}`),
      ...intents.map((intent) => `${intent.reason}\n${intent.safeAction}`),
    ].join("\n");

    expect(asks.map((ask) => ask.actionType)).toEqual(fixture.actionTypes);
    expect(intents.map((intent) => intent.resolution)).toEqual(fixture.resolutions);
    expect(asks.every((ask) => ask.sourceText.length > 0)).toBe(true);
    for (const expected of fixture.mustContain ?? []) {
      expect(evidenceText).toContain(expected);
    }
  });

  it("keeps fake receipt words out of a provider-credit failure response", () => {
    const providerFailureReply = "Platform capacity failure: OpenRouter needs credit before the agent can continue.";
    const { asks, intents } = replay(
      [
        "The model provider says there is no OpenRouter credit, so treat this as a platform capacity failure.",
        "Please do not confuse it with a backlog, GitHub, Zenod memory, or Epaminon execution failure.",
        "Tell me that the provider needs credit before the agent can continue.",
      ].join(" "),
    );

    expect(providerFailureReply).not.toMatch(/\b(?:created|queued|running|stored|notified|closed)\b/i);
    expect(providerFailureReply).toMatch(/platform capacity/i);
    expect(intents.every((intent) => intent.resolution !== "delegate_execution" && intent.resolution !== "propose_durable_backlog")).toBe(true);
    expect(asks.every((ask) => ask.actionType !== "execute" && ask.actionType !== "create_backlog")).toBe(true);
  });

  it("exposes media plus immediate text comments in transcript evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-natural-replay-media-"));
    const store = new WhatsAppStore(join(dir, "whatsapp.sqlite"));
    try {
      const imageEvent = {
        messageId: "image-natural-1",
        chatId: "34611111111@s.whatsapp.net",
        senderId: "34611111111@s.whatsapp.net",
        senderName: "Tester",
        chatName: "Tester",
        isGroup: false,
        timestamp: 1_800_000_000,
        body: "",
        hasMedia: true,
        mediaType: "image",
        mimeType: "image/png",
        fileName: "screenshot.png",
        mediaRaw: {},
        raw: { key: { id: "image-natural-1" } },
      };
      const commentEvent = {
        ...imageEvent,
        messageId: "comment-natural-1",
        body: "this comment is related to the picture, did this happen already?",
        hasMedia: false,
        mediaType: null,
        mimeType: null,
        fileName: null,
        mediaRaw: undefined,
        raw: { key: { id: "comment-natural-1" } },
      };

      store.recordInbound(imageEvent as never);
      store.markMessageStatus("image-natural-1", "digest_queued");
      store.recordInbound(commentEvent as never);
      const link = store.linkRecentMediaFollowUp(commentEvent as never);

      expect(link).toMatchObject({ mediaMessageId: "image-natural-1", followupMessageId: "comment-natural-1" });
      const transcript = formatConversationTranscript(store.recentTranscript({ messageId: "image-natural-1" }));
      expect(transcript).toContain("media=image");
      expect(transcript).toContain("status=digest_queued");
      expect(transcript).toContain("Linked follow-up comment(s):");
      expect(transcript).toContain("did this happen already");
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
