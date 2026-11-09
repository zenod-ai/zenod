import { describe, expect, it, vi } from "vitest";
import type { BrainEngine, Hit, SendRoute } from "zenod";
import { channelSourceTitle, channelTurn, CHANNEL_ANSWER_MAX_CHARS, formatChannelAnswer, type ChannelBrainDeps } from "../src/channelBrain.js";
import type { MemoryChatAnswer } from "../src/memoryChat.js";
import type { TaskJob } from "../src/taskJobStore.js";

// EPIC-20 A1: a typed WhatsApp message gets the cloud chat's brain.
const hit = (n: number): Hit => ({ path: `Areas/Note ${n}.md`, snippet: `about note ${n}`, score: 10 - n, url: `https://github.com/o/r/blob/main/Areas/Note%20${n}.md`, provider: "github" });

function engineWith(route: Omit<SendRoute, "by">, answer = "Your renewal is in October [1], paid by card [2] [3].", checked = true): BrainEngine & { asked: string[] } {
  const hits = [1, 2, 3, 4, 5].map(hit);
  const engine = {
    asked: [] as string[],
    routeSend: async () => ({ ...route, by: "model" as const }),
    search: async () => hits,
    searchTimed: async () => ({ hits, tier: "index" as const, ms: 1 }),
    answerFromMemories: async (question: string) => {
      engine.asked.push(question);
      return checked ? { checked: true, reason: null, text: answer, cited: [1, 2, 3] } : { checked: false, reason: "no_answer", text: "", cited: [] };
    },
    chat: async () => { throw new Error("the old chat loop must not answer WhatsApp"); },
  };
  return engine as unknown as BrainEngine & { asked: string[] };
}

function deps(status: TaskJob["status"] = "done") {
  const kept: string[] = [];
  const offered: Array<[string, string]> = [];
  const d: ChannelBrainDeps = {
    keep: (content) => { kept.push(content); return { id: "store-1", status: "queued" } as TaskJob; },
    job: () => ({ id: "store-1", status }) as TaskJob,
    offerJob: (captureId, request) => { offered.push([captureId, request]); },
    appUrl: "https://cloud.zenod.dev",
    wait: async () => {},
    keepWaitMs: 50,
  };
  return { d, kept, offered };
}

describe("channelTurn: the cloud chat's one Send, on WhatsApp", () => {
  it("keeps new information and says Saved once its Log entry is there", async () => {
    const { d, kept } = deps();
    const reply = await channelTurn(engineWith({ action: "keep", keep: "Ana's birthday is May 3", question: null }), "Remember Ana's birthday is May 3", "chat-1", d);
    expect(reply).toMatchObject({ outcome: "keep", text: "Saved ✓" });
    expect(kept).toEqual(["Ana's birthday is May 3"]);
  });

  it("answers a question from memory with the checked answer, at most two sources, nothing kept", async () => {
    const { d, kept } = deps();
    const engine = engineWith({ action: "answer", keep: null, question: "when is my insurance renewal?" });
    const reply = await channelTurn(engine, "when is my insurance renewal?", "chat-1", d);
    expect(reply.outcome).toBe("answer");
    expect(kept).toEqual([]);
    expect(engine.asked).toEqual(["when is my insurance renewal?"]);
    expect(reply.text).toContain("Your renewal is in October [1], paid by card [2].");
    expect(reply.text).toContain("[1] Note 1 https://cloud.zenod.dev/#memory?path=Areas%2FNote%201.md");
    expect(reply.text).not.toContain("[3]");
    expect(reply.sources).toHaveLength(2);
  });

  it("does both: keeps, then answers", async () => {
    const { d, kept } = deps();
    const reply = await channelTurn(engineWith({ action: "both", keep: "Paid the plumber", question: "when is the boiler service?" }), "Paid the plumber, when is the boiler service?", "chat-1", d);
    expect(reply.outcome).toBe("both");
    expect(kept).toEqual(["Paid the plumber"]);
    expect(reply.text.startsWith("Saved ✓\n\nYour renewal")).toBe(true);
  });

  it("never runs a job on the memory: it waits in the inbox as Run it? and the reply says so", async () => {
    const { d, kept, offered } = deps();
    const reply = await channelTurn(engineWith({ action: "job", keep: null, question: null, job: "untangle Idealista and Poly-Maker" } as Omit<SendRoute, "by">), "untangle Idealista and Poly-Maker", "chat-9", d);
    expect(reply.outcome).toBe("job");
    expect(kept).toEqual([]);
    expect(offered).toEqual([["chat-9", "untangle Idealista and Poly-Maker"]]);
    expect(reply.text).toContain("Run it?");
    expect(reply.text).toContain("https://cloud.zenod.dev/#inbox");
  });

  it("when unsure it keeps the note and offers the job under the kept message, so the desk does not post twice", async () => {
    const { d, kept, offered } = deps();
    const reply = await channelTurn(engineWith({ action: "unsure", keep: null, question: null, job: "move the shed notes under House" } as Omit<SendRoute, "by">), "move the shed notes under House", "chat-9", d);
    expect(reply.outcome).toBe("unsure");
    expect(kept).toEqual(["move the shed notes under House"]);
    expect(offered).toEqual([["store-1", "move the shed notes under House"]]);
    expect(reply.text.startsWith("Saved ✓")).toBe(true);
  });

  it("greets without a model call or a save", async () => {
    const { d, kept } = deps();
    const engine = engineWith({ action: "answer", keep: null, question: "x" });
    const route = vi.spyOn(engine, "routeSend");
    const reply = await channelTurn(engine, "Thanks!", "chat-1", d);
    expect(reply.outcome).toBe("hello");
    expect(route).not.toHaveBeenCalled();
    expect(kept).toEqual([]);
  });

  it("says plainly when a save failed or is still going", async () => {
    expect((await channelTurn(engineWith({ action: "keep", keep: "x note", question: null }), "x note", "c", deps("error").d)).text).toContain("could not save");
    expect((await channelTurn(engineWith({ action: "keep", keep: "x note", question: null }), "x note", "c", deps("running").d)).text).toBe("Saving it now ✓");
  });

  it("says when no note answers, naming the closest", async () => {
    const reply = await channelTurn(engineWith({ action: "answer", keep: null, question: "what is my blood type?" }, "", false), "what is my blood type?", "c", deps().d);
    expect(reply.text).toContain("no note that answers this directly");
    expect(reply.text).toContain("· Note 1");
  });
});

describe("formatChannelAnswer", () => {
  it("cuts a long answer at a sentence near the WhatsApp limit and keeps it plain", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i} is **here** [1].`).join(" ");
    const answer = { answered: true, answer: `## Heading\n${long}`, memories: [{ rank: 1, path: "Areas/A.md", title: "A", cited: true, url: "u", provider: "github" }] } as unknown as MemoryChatAnswer;
    const out = formatChannelAnswer(answer, "https://cloud.zenod.dev");
    const body = out.text.split("\n\n[1]")[0]!;
    expect(body.length).toBeLessThanOrEqual(CHANNEL_ANSWER_MAX_CHARS);
    expect(body.endsWith(".")).toBe(true);
    expect(body).not.toContain("**");
    expect(body).not.toContain("##");
  });
});

describe("channelSourceTitle", () => {
  it("names a captured entry by kind and day, and keeps a page's title", () => {
    expect(channelSourceTitle("Log/2026-11-08.md#^e-eca5f6", 'Voice note "AC9D2840EB2A2B1FE525279C8CF99AEB.ogg" ingeste...')).toBe("Your voice note, 8 Nov");
    expect(channelSourceTitle("Log/2026-07-04.md#^e-9bcb92", "WhatsApp voice-note raw transcript.")).toBe("Your voice note, 4 Jul");
    expect(channelSourceTitle("Log/2026-11-04.md#^e-8cd832", 'Screenshot/image "3BA1.jpg" ingested')).toBe("Your screenshot, 4 Nov");
    expect(channelSourceTitle("Log/2026-11-02.md#^e-1", "Paid the plumber")).toBe("Your note, 2 Nov");
    expect(channelSourceTitle("Notes/Zenod pill counter discrepancy report.md", "Zenod pill counter discrepancy report")).toBe("Zenod pill counter discrepancy report");
  });
});
