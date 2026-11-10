import { describe, expect, it } from "vitest";
import type { BrainEngine, Hit, QuickIndexBase, QuickIndexPlace } from "zenod";
import { correctReading, countLikeSummary, emptyQuickIndexState, quickIndexView, updateQuickIndex, type QuickIndexModel } from "../src/quickIndex.js";
import { readAs, readAsLine, readAsNote, readAsQuery, shownReadings, type ReadAsIndex } from "../src/quickIndexRead.js";
import { rankWithReadings, streamAnswerFromMemory } from "../src/memoryChat.js";
import { streamTalk, talkPersona } from "../src/memoryTalk.js";

// EPIC-14 S29: chat reads the quick index. Made-up memory only.
type ViewPlace = ReadAsIndex["places"][number];
function vp(path: string, title: string, names: string[] = [], memories = 5, lineage = [title]): ViewPlace {
  return { path, title, lineage, memory: "working", summary: "", names, pages: 1, memories, week: 0, lastTouched: null };
}
const MOVE = vp("Projects/Move.md", "Moving to Valencia", ["the flat", "Ruzafa"], 12);
const ANA = vp("People/Ana.md", "Ana", [], 4, ["People", "Ana"]);
const CELLO = vp("Areas/Cello lessons.md", "Cello lessons", [], 6);
const WORK = vp("Areas/Work.md", "Work", [], 40);
const INDEX: ReadAsIndex = { places: [MOVE, ANA, CELLO, WORK] };

describe("read as (E14-S29)", () => {
  it("reads a name the person uses, a possessive person and a that-thing word", () => {
    const flat = readAs("What did the agent say about the flat?", INDEX);
    expect(flat.map((r) => [r.phrase, r.path, r.by])).toEqual([["the flat", "Projects/Move.md", "name"]]);
    const ana = readAs("and Ana's thing?", INDEX);
    expect(ana.map((r) => [r.phrase, r.path])).toEqual([["Ana's thing", "People/Ana.md"]]);
    const cello = readAs("where are we with that cello thing", INDEX);
    expect(cello.map((r) => [r.phrase, r.path, r.by])).toEqual([["that cello thing", "Areas/Cello lessons.md", "word"]]);
  });

  it("skips plain place names, short words inside other words and three-letter names said in lower case", () => {
    expect(readAs("what's on at work this week?", INDEX)).toEqual([]);
    expect(readAs("the flatmate called", INDEX)).toEqual([]);
    expect(readAs("ana said hi", INDEX)).toEqual([]);
    expect(readAs("Ana said hi", INDEX).map((r) => r.path)).toEqual(["People/Ana.md"]);
    expect(readAs("anything", { places: [] })).toEqual([]);
  });

  it("keeps one reading per place, at most three, in the order of the message", () => {
    const readings = readAs("Ruzafa and the flat, Ana's thing and that cello thing", INDEX);
    expect(readings.map((r) => r.path)).toEqual(["Projects/Move.md", "People/Ana.md", "Areas/Cello lessons.md"]);
  });

  it("a correction wins, and a no-place correction stops the words being read", () => {
    const moved: ReadAsIndex = { places: INDEX.places, corrections: { "the flat": { phrase: "the flat", path: "Areas/Cello lessons.md", at: "x" } } };
    expect(readAs("about the flat", moved).map((r) => [r.path, r.by])).toEqual([["Areas/Cello lessons.md", "correction"]]);
    const none: ReadAsIndex = { places: INDEX.places, corrections: { "the flat": { phrase: "the flat", path: null, at: "x" } } };
    expect(readAs("about the flat", none)).toEqual([]);
  });

  it("shows only what can be corrected, and says it in one line and one note", () => {
    const readings = readAs("Moving to Valencia and Ana's thing", INDEX);
    expect(readings.map((r) => r.by)).toEqual(["title", "name"]);
    expect(shownReadings(readings).map((r) => r.phrase)).toEqual(["Ana's thing"]);
    expect(readAsLine(readings)).toBe("\"Ana's thing\" → People › Ana");
    expect(readAsNote(readings)).toContain("\"Ana's thing\" means People › Ana");
    expect(readAsQuery("about the flat", readAs("about the flat", INDEX))).toBe("about the flat Moving to Valencia");
  });
});

function place(path: string, title: string, captures: Array<[string, string]>, extra: Partial<QuickIndexPlace> = {}): QuickIndexPlace {
  return {
    path, title, memory: "working", lineage: [title], root: true, summary: "", aliases: [], pages: 1,
    memories: captures.length, week: 0, lastTouched: null, captureKeys: captures.map(([key]) => key),
    captures: captures.map(([key, text]) => ({ key, date: key.slice(0, 10), text })), ...extra,
  };
}
const BASE: QuickIndexBase = {
  weekFrom: "2026-11-03",
  places: [
    place("Projects/Move.md", "Moving to Valencia", [["2026-10-01#^e-aaaaaa", "We saw the flat in Ruzafa."]], { summary: "1 page; 1 of your captures in the last 30 days" }),
    place("Projects/Boat.md", "Boat", [["2026-10-02#^e-bbbbbb", "The Laia needs a new engine."]], { summary: "Our sailing boat Laia and its repairs." }),
  ],
};

describe("corrections and summaries (E14-S29)", () => {
  it("a correction teaches the new place the words and takes them from the old one", () => {
    let state = { ...emptyQuickIndexState(), nicknames: { "Projects/Move.md": [{ name: "the flat", from: "2026-10-01#^e-aaaaaa", at: "x" }] } };
    state = correctReading(state, "the flat", "Projects/Boat.md", Date.parse("2026-11-10T00:00:00Z"));
    expect(state.nicknames["Projects/Move.md"]).toEqual([]);
    expect(state.nicknames["Projects/Boat.md"]?.map((n) => [n.name, n.from])).toEqual([["the flat", "correction"]]);
    expect(state.corrections["the flat"]?.path).toBe("Projects/Boat.md");
    const view = quickIndexView(BASE, state);
    expect(view.places.find((p) => p.path === "Projects/Boat.md")?.names).toContain("the flat");
    expect(correctReading(state, "the flat", null).nicknames["Projects/Boat.md"]).toEqual([]);
  });

  it("writes a summary only for a place whose tree line is counts, once, under the day cap", async () => {
    expect(countLikeSummary("1 page; 6 of your captures in the last 30 days")).toBe(true);
    expect(countLikeSummary("Our sailing boat Laia and its repairs.")).toBe(false);
    const prompts: string[] = [];
    const model: QuickIndexModel = {
      complete: async ({ system, prompt }) => {
        prompts.push(prompt);
        return system.includes("one plain line")
          ? { text: "{\"summaries\":[{\"place\":1,\"summary\":\"Moving to a flat in Valencia, the Ruzafa viewings.\"}]}", inputTokens: 900, outputTokens: 40, costUsd: 0.0002 }
          : { text: "{\"names\":[]}", inputTokens: 900, outputTokens: 10, costUsd: 0.0002 };
      },
    };
    const now = Date.parse("2026-11-10T12:00:00Z");
    const first = await updateQuickIndex(BASE, emptyQuickIndexState(), { model, now });
    expect(first.state.summaries["Projects/Move.md"]?.text).toBe("Moving to a flat in Valencia, the Ruzafa viewings.");
    expect(first.state.summaries["Projects/Boat.md"]).toBeUndefined();
    expect(first.state.calls.map((c) => c.pass)).toEqual(["first", "summary"]);
    expect(quickIndexView(BASE, first.state).places[0]?.summary).toBe("Moving to a flat in Valencia, the Ruzafa viewings.");
    const again = await updateQuickIndex(BASE, first.state, { model, now: now + 60_000 });
    expect(again.state.calls.filter((c) => c.pass === "summary")).toHaveLength(1);
    const capped = { ...emptyQuickIndexState(), firstBuiltAt: "x", seen: ["2026-10-01#^e-aaaaaa", "2026-10-02#^e-bbbbbb"], calls: [{ at: "2026-11-10T01:00:00.000Z", pass: "filing" as const, places: 1, inputTokens: 0, outputTokens: 0, costUsd: 0.06, ok: true, names: 0 }] };
    const none = await updateQuickIndex(BASE, capped, { model, now });
    expect(none.state.summaries).toEqual({});
  });
});

function hit(path: string, score: number): Hit {
  return { path, title: path, snippet: "", score, url: "", provider: "github" } as Hit;
}
function engine(byQuery: Record<string, string[]>, extra: Partial<BrainEngine> = {}): BrainEngine & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    search: async (query: string) => (byQuery[query] ?? []).map((path, i) => hit(path, 10 - i)),
    ...extra,
  } as unknown as BrainEngine & { asked: string[] };
}

describe("chat reads the index (E14-S29)", () => {
  const readings = readAs("what did the agent say about the flat?", INDEX);
  it("keeps the question's own top matches, mixes in the place's search and pins the place page", async () => {
    const own = Array.from({ length: 10 }, (_, i) => `Log/own-${i}.md`);
    const e = engine({ "what did the agent say about the flat?": own, "what did the agent say about the flat? Moving to Valencia": ["Log/move-note.md"] });
    const ranked = await rankWithReadings(e, "what did the agent say about the flat?", readings, 20, 16);
    const paths = ranked.results.map((m) => m.path);
    expect(paths.slice(0, 3)).toEqual(own.slice(0, 3));
    expect(paths[3]).toBe("Projects/Move.md");
    expect(paths.slice(4, 9)).toEqual(own.slice(3, 8));
    expect(paths).toContain("Log/move-note.md");
    expect(ranked.results.map((m) => m.rank)).toEqual(paths.map((_, i) => i + 1));
  });

  it("the answer carries its Read as line and tells the model; without readAs nothing changes (WhatsApp, Telegram)", async () => {
    const questions: string[] = [];
    const e = engine({ "about the flat": ["Projects/Move.md"], "about the flat Moving to Valencia": ["Projects/Move.md"] }, {
      answerFromMemories: async (question: string) => { questions.push(question); return { checked: true, text: "Free until the 20th [1].", cited: [1], context: [] }; },
    } as Partial<BrainEngine>);
    const read = await streamAnswerFromMemory(e, "about the flat", { readAs: async (q) => readAs(q, INDEX) });
    expect(read.readAs?.map((r) => r.phrase)).toEqual(["the flat"]);
    expect(questions[0]).toContain("\"the flat\" means Moving to Valencia");
    const plain = await streamAnswerFromMemory(e, "about the flat");
    expect(plain.readAs).toBeUndefined();
    expect(questions[1]).toBe("about the flat");
  });

  it("Talk it over reads the index too", async () => {
    const e = engine({ "about the flat Moving to Valencia": ["Projects/Move.md"] }, {
      talkOverMemories: async (input: { message: string }) => ({ text: `ok ${input.message.includes("means Moving to Valencia")}`, cited: [] }),
    } as Partial<BrainEngine>);
    const reply = await streamTalk(e, { message: "about the flat", persona: talkPersona(null), history: [], opener: false }, { readAs: async (q) => readAs(q, INDEX) });
    expect(reply.text).toBe("ok true");
    expect(reply.readAs?.map((r) => r.path)).toEqual(["Projects/Move.md"]);
  });
});
