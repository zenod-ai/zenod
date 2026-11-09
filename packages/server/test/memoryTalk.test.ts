import { describe, expect, it } from "vitest";
import type { BrainEngine, Hit, MemoryEntry, MemoryTreeOutline } from "zenod";
import { memoryTalkPrompt, talkCitations } from "zenod";
import { ABOUT_ZENOD } from "../src/memoryChat.js";
import { memoryGlance, MemoryGlanceCache } from "../src/memoryGlance.js";
import { LIBRARIAN, openerMessage, parseTalkRequest, streamTalk, talkPersona } from "../src/memoryTalk.js";

// EPIC-22 E22-2: Talk it over (a read-only talk with a persona over your memory) and Memory › At a glance.

const hit = (path: string, score: number, extra: Partial<Hit> = {}): Hit => ({
  path, snippet: `about ${path}`, score, url: `https://github.com/o/r/blob/main/${encodeURI(path)}`, provider: "github", ...extra,
});

function engineFor(options: { reply?: string | null; entries?: MemoryEntry[] } = {}) {
  const calls: Array<Parameters<NonNullable<BrainEngine["talkOverMemories"]>>[0]> = [];
  const hits = [hit("Running/Autumn.md", 9, { matchPercent: 80 }), hit("Notes/Shed.md", 1, { matchPercent: 5 })];
  const engine = {
    search: async () => hits,
    searchTimed: async () => ({ hits, tier: "index" as const, ms: 1 }),
    searchEntries: async () => options.entries ?? [],
    ...(options.reply === null ? {} : {
      talkOverMemories: async (input: (typeof calls)[number], onText?: (delta: string) => void) => {
        calls.push(input);
        const text = options.reply ?? "You ran less after the move [1]. What changed?";
        onText?.(text);
        return { text, cited: talkCitations(text) };
      },
    }),
  } as unknown as BrainEngine;
  return { engine, calls };
}

const entry = (n: number, at: string, source: MemoryEntry["source"], contentType: MemoryEntry["contentType"] = "text"): MemoryEntry => ({
  evidenceRef: `Log/${at.slice(0, 10)}.md#^e-${n}`, path: `Log/${at.slice(0, 10)}.md`, anchor: `e-${n}`, title: `Entry ${n}`, content: `words ${n}`,
  source, verbatim: true, contentType, capturedAt: at, url: "", provider: "github",
});

describe("Talk it over (EPIC-22 E22-2)", () => {
  it("talks over the memories that match, cites them, and keeps nothing", async () => {
    const { engine, calls } = engineFor();
    const deltas: string[] = [];
    const reply = await streamTalk(engine, parseTalkRequest({ message: "Let's talk about my running", persona: "weekly-recap" })!, { onText: (text) => deltas.push(text) });
    expect(reply).toMatchObject({ persona: { id: "weekly-recap", name: "Weekly recap" }, talked: true, text: "You ran less after the move [1]. What changed?" });
    expect(reply.memories.map((memory) => [memory.path, memory.cited])).toEqual([["Running/Autumn.md", true]]);
    expect(deltas.join("")).toBe(reply.text);
    expect(calls[0]!.memories.map((memory) => memory.n)).toEqual([1, 2]);
    expect(calls[0]!.persona.focus).toContain("recap");
  });

  it("sends the earlier turns, and opens from a card with the newest memories", async () => {
    const { engine, calls } = engineFor({ entries: [entry(1, "2026-11-08T10:00:00Z", "whatsapp")] });
    const request = parseTalkRequest({ opener: true, persona: "Open loops finder", history: [{ role: "person", text: "hi" }, { role: "nobody", text: "x" }] })!;
    expect(request.history).toEqual([{ role: "person", text: "hi" }]);
    await streamTalk(engine, request);
    expect(calls[0]!.persona.name).toBe("Open loops finder");
    expect(calls[0]!.message).toBe(openerMessage(request.persona, ""));
    expect(calls[0]!.memories.map((memory) => memory.path)).toEqual(["Log/2026-11-08.md#^e-1"]);
    await streamTalk(engine, parseTalkRequest({ opener: true, message: "You never booked the dentist", persona: "nobody" })!);
    expect(calls[1]!.persona.name).toBe(LIBRARIAN.name);
    expect(calls[1]!.message).toBe("Let's talk about this: You never booked the dentist");
  });

  it("says plainly when there is no chat model to talk with", async () => {
    const { engine } = engineFor({ reply: null });
    expect(await streamTalk(engine, parseTalkRequest({ message: "should I move?" })!)).toMatchObject({ talked: false, memories: [] });
  });

  it("refuses an empty talk, and names the librarian when no persona is known", () => {
    expect(parseTalkRequest({ message: "  " })).toBeNull();
    expect(parseTalkRequest({ message: "x".repeat(2_001) })).toBeNull();
    expect(talkPersona(undefined)).toEqual({ ...LIBRARIAN });
  });

  it("asks the model to read only, cite, and never claim a change", () => {
    const { system, prompt } = memoryTalkPrompt({ name: "Zenod", focus: "f" }, "should I move?", [{ n: 1, title: "Flat", text: "rent 900" }], [{ role: "person", text: "earlier" }], "2026-11-09");
    expect(system).toContain("never say you saved");
    expect(prompt).toContain("[1] Flat: rent 900");
    expect(prompt).toContain("PERSON: earlier");
    expect(talkCitations("a [2] b [1] c [2] d [3](x)")).toEqual([2, 1]);
  });

  it("who are you? is answered as the librarian of your memory, with its four modes", () => {
    expect(ABOUT_ZENOD).toContain("the librarian of your memory");
    for (const mode of ["Keep", "Look up", "Talk it over", "Job on the memory"]) expect(ABOUT_ZENOD).toContain(`**${mode}**`);
  });
});

describe("Memory › At a glance (EPIC-22 E22-2)", () => {
  const outline = {
    roots: 2, placed: 5, unplaced: 1,
    groups: [{ id: "working", kind: "group", memory: "working", title: "Working", path: null, pages: 6, latest: null, url: null, children: [
      { id: "Work.md", kind: "root", memory: "working", title: "Work", path: "Work.md", pages: 4, latest: { date: "2026-11-08", title: "x", path: "x" }, url: null, children: [] },
      { id: "Home.md", kind: "root", memory: "working", title: "Home", path: "Home.md", pages: 1, latest: null, url: null, children: [] },
    ] }],
  } as unknown as MemoryTreeOutline;

  it("counts totals, weeks, places and sources from what Zenod stores", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const glance = memoryGlance([
      entry(1, "2026-11-09T08:00:00Z", "whatsapp", "voice_note"),
      entry(2, "2026-11-03T08:00:00Z", "web"),
      entry(3, "2026-11-02T08:00:00Z", "whatsapp"),
      entry(4, "2025-01-01T08:00:00Z", "mcp"),
      entry(5, "2026-11-09T08:00:00Z", "selftest"),
    ], outline, now);
    expect(glance.totals).toEqual({ memories: 4, voiceNotes: 1, pages: 6, places: 2, thisWeek: 1 });
    expect(glance.weeks).toHaveLength(12);
    expect(glance.weeks.at(-1)).toEqual({ week: "2026-11-09", kept: 1 });
    expect(glance.weeks.at(-2)).toEqual({ week: "2026-11-02", kept: 2 });
    expect(glance.places.map((place) => [place.title, place.pages, place.latest])).toEqual([["Work", 4, "2026-11-08"], ["Home", 1, null]]);
    expect(glance.sources).toEqual([
      { source: "whatsapp", label: "WhatsApp", count: 2 },
      { source: "web", label: "Zenod app", count: 1 },
      { source: "mcp", label: "AI apps", count: 1 },
    ]);
  });

  it("reads the Log once a minute per tenant", async () => {
    let now = 0;
    const cache = new MemoryGlanceCache(() => now);
    let loads = 0;
    const load = async () => { loads += 1; return memoryGlance([], null); };
    await cache.get("t1", load);
    await cache.get("t1", load);
    await cache.get("t2", load);
    now = 61_000;
    await cache.get("t1", load);
    expect(loads).toBe(3);
  });
});
