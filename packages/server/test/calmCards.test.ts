import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryEntry, MemoryTreeOutline } from "zenod";
import { CALM_HELPER_IDS, suggestionKeys } from "../src/calmCards.js";
import { InboxStore } from "../src/inboxStore.js";
import { OPEN_LOOPS, TOPIC_GARDENER, WEEKLY_RECAP } from "../src/personaCatalog.js";
import { duePersonas, runPersona, type PersonaDefinition, type PersonaModel, type PersonaRunnerDeps } from "../src/personaRunner.js";
import { PERSONA_SHOWN_MAX, PersonaStore } from "../src/personaStore.js";

/**
 * EPIC-14 S50: one calm card a day across the five memory personas, and never the same suggestion
 * twice (S45 folded in: Open loops offered the same link on 16 and 17 Nov). Made-up demo memories.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenod-calm-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = (n: number, day: string, title: string): MemoryEntry => ({
  evidenceRef: `Log/${day}.md#^e-00000${n}`, path: `Log/${day}.md`, anchor: `e-00000${n}`, title, content: `${title}, a made-up demo memory.`,
  source: "whatsapp", verbatim: true, capturedAt: `${day}T09:00:00.000Z`, url: "", provider: "github",
});

/** A made-up tree with one place, so the model helpers may suggest a change. */
const OUTLINE: MemoryTreeOutline = {
  groups: [{ id: "working", kind: "group", memory: "working", title: "Working memory", path: null, pages: 1, latest: null, url: null,
    children: [{ id: "Areas/Car.md", kind: "root", memory: "working", title: "Car", path: "Areas/Car.md", pages: 1, latest: null, url: null, children: [] }] }],
  roots: 1, placed: 1, unplaced: 0,
};

/** `replies.text` is what the model says now; a test changes it from one day to the next. */
function setup(clock: { now: Date }, entries: MemoryEntry[], replies: { text: string } = { text: "{}" }) {
  const inbox = new InboxStore(join(dir, "inbox.sqlite"), () => clock.now);
  const store = new PersonaStore(join(dir, "personas.sqlite"), () => clock.now);
  const model: PersonaModel = {
    async complete() {
      return { text: replies.text, inputTokens: 1000, outputTokens: 80, costUsd: 0.0003 };
    },
  };
  const deps: PersonaRunnerDeps = {
    memory: {
      async memoryTreeOutline() { return OUTLINE; },
      async searchEntries(query: { capturedAfter?: string } = {}) {
        return entries.filter((e) => !query.capturedAfter || e.capturedAt >= query.capturedAfter);
      },
      async search() { return []; },
      async get(): Promise<never> { throw new Error("not in this test"); },
    },
    model: () => model,
    inbox,
    store,
    writeNotes: async () => ({ id: "rev" }),
    now: () => clock.now,
  };
  return { deps, inbox, store };
}

/** A helper with a calm (or tidy) id that posts one finding a run, its title from the day. */
const poster = (id: string, name: string): PersonaDefinition => ({
  ...WEEKLY_RECAP, id, name, schedule: { every: "night" }, defaultEnabled: true, revisedAt: undefined,
  async run(ctx) {
    ctx.postFinding({ title: `${name} on ${ctx.today}` });
    return { summary: "posted one" };
  },
});

describe("never the same suggestion twice (EPIC-14 S50, S45)", () => {
  it("reproduces the 16/17 Nov Open loops repeat and leaves the second card out", async () => {
    const clock = { now: new Date("2026-11-16T03:00:00Z") };
    const entries = [entry(1, "2026-11-10", "Renew the car insurance"), entry(2, "2026-11-14", "Paid the car insurance renewal")];
    const sameLink = (title: string, action: string) => JSON.stringify({
      loops: [{ title: "Renew the car insurance", sources: [1] }],
      suggestion: { title, action, why: "The second note closes the first.", sources: [1, 2] },
    });
    const model = { text: sameLink("Link the insurance renewal to its payment", "Link the memory about renewing the car insurance to the memory where it was paid.") };
    const { deps, inbox } = setup(clock, entries, model);
    const first = await runPersona(OPEN_LOOPS, deps, "schedule");
    expect(first, first!.summary).toMatchObject({ status: "done" });
    expect(inbox.list().map((i) => i.kind), first!.summary).toContain("suggestion");
    expect(inbox.list().filter((item) => item.kind === "suggestion")).toHaveLength(1);

    clock.now = new Date("2026-11-17T03:00:00Z");
    entries.push(entry(3, "2026-11-16", "Book the dentist"));
    // 17 Nov: the same link pair in other words, as the model gave it (the memories shift by one).
    model.text = sameLink("Connect the car insurance note with the payment", "Connect the car insurance renewal memory with the later payment memory.").replace('"sources": [1, 2]', '"sources": [2, 3]').replace('"sources":[1,2]', '"sources":[2,3]');
    const second = await runPersona(OPEN_LOOPS, deps, "schedule");
    expect(second).toMatchObject({ status: "done", summary: "Left out a card already shown once, posted nothing", inboxItemIds: [] });
    expect(second!.modelCalls).toBeGreaterThan(0);
    expect(inbox.list().filter((item) => item.kind === "suggestion")).toHaveLength(1);
  });

  it("never brings back a card put away with Not now, even once it has left the inbox; Bring it back reopens that same card", async () => {
    const clock = { now: new Date("2026-11-16T10:00:00Z") };
    const { deps, inbox, store } = setup(clock, [entry(1, "2026-11-15", "Flat and apartment")]);
    const gardener: PersonaDefinition = {
      ...TOPIC_GARDENER,
      async run(ctx) {
        ctx.postSuggestion({ title: "Flat and Apartment are the same place", action: "Join Apartment into Flat." });
        return { summary: "one suggestion" };
      },
    };
    await runPersona(gardener, deps, "manual");
    const card = inbox.list().find((item) => item.kind === "suggestion")!;
    inbox.declineSuggestion(card.id, "Two different flats");
    clock.now = new Date("2026-11-17T10:00:00Z");
    expect(await runPersona(gardener, deps, "manual")).toMatchObject({ status: "done", inboxItemIds: [] });
    // A fresh inbox (the card gone from it): the user's store still remembers it was shown.
    const fresh = { ...deps, inbox: new InboxStore(join(dir, "inbox-2.sqlite")) };
    expect(await runPersona(gardener, fresh, "manual")).toMatchObject({ status: "done", inboxItemIds: [] });
    expect(fresh.inbox.list()).toHaveLength(0);
    expect(store.wasShown(suggestionKeys({ title: "Flat and Apartment are the same place" }))).toBe(true);
    // Only the user brings it back, on the card itself.
    expect(inbox.reopenSuggestion(card.id).status).toBe("open");
  });

  it("keys a card by its words, its change and its pair of memories; the helper's own notes and one memory alone are no pair", () => {
    expect(suggestionKeys({
      title: "Link A, to B!", action: "Link A to B",
      links: [{ label: "b", path: "Log/2026-11-14.md" }, { label: "a", path: "Log/2026-11-10.md" }, { label: "notes", path: "Personas/open-loops/2026-11-16.md" }],
    })).toEqual(["title:link a to b", "action:link a to b", "links:Log/2026-11-10.md|Log/2026-11-14.md"]);
    expect(suggestionKeys({ title: "Is this still open? Call mum", links: [{ label: "a", path: "Log/2026-11-10.md" }, { label: "notes", path: "Personas/open-loops/x.md" }] }))
      .toEqual(["title:is this still open call mum"]);
  });

  it("keeps what was shown small: only the newest keys stay", () => {
    let t = Date.parse("2026-11-01T00:00:00Z");
    const store = new PersonaStore(join(dir, "personas.sqlite"), () => new Date((t += 1000)));
    for (let i = 0; i < PERSONA_SHOWN_MAX + 50; i += 1) store.rememberShown("open-loops", [`title:card ${i}`]);
    expect(store.wasShown(["title:card 0"])).toBe(false);
    expect(store.wasShown([`title:card ${PERSONA_SHOWN_MAX + 49}`])).toBe(true);
  });
});

describe("one calm card a day across the five personas (EPIC-14 S50)", () => {
  const openLoops = poster("open-loops", "Open loops finder");
  const ideas = poster("ideas-digest", "Ideas digest");
  const tryIt = poster("something-to-try", "Something to try");
  const gardener = poster("topic-gardener", "Topic gardener");
  const all = [openLoops, ideas, tryIt, gardener];

  async function night(deps: PersonaRunnerDeps, store: PersonaStore, at: Date) {
    const ran: Array<{ id: string; status: string; posted: number }> = [];
    for (const persona of duePersonas(all, store, at)) {
      const run = await runPersona(persona, deps, "schedule");
      if (run) ran.push({ id: persona.id, status: run.status, posted: run.inboxItemIds.length });
    }
    return ran;
  }

  it("lets one calm card land a night; the rest wait (no read, no spend) and go first the next night; tidy helpers do not count", async () => {
    const clock = { now: new Date("2026-11-16T03:00:00Z") };
    const entries = [entry(1, "2026-11-15", "Garden beds")];
    const { deps, store, inbox } = setup(clock, entries);
    // Something to try posted last week: it has waited least of the three calm ones.
    clock.now = new Date("2026-11-12T03:00:00Z");
    store.finish(store.start("something-to-try", "manual")!.id, { status: "done", steps: 1, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, summary: "", inboxItemIds: ["old"], revision: null, fingerprint: null });
    clock.now = new Date("2026-11-16T03:00:00Z");

    const n16 = await night(deps, store, clock.now);
    expect(n16.map((r) => r.id)).toEqual(["topic-gardener", "open-loops", "ideas-digest", "something-to-try"]);
    expect(n16).toEqual([
      { id: "topic-gardener", status: "done", posted: 1 },
      { id: "open-loops", status: "done", posted: 1 },
      { id: "ideas-digest", status: "skipped", posted: 0 },
      { id: "something-to-try", status: "skipped", posted: 0 },
    ]);
    expect(store.runs("ideas-digest", 1)[0]!.summary).toBe("Waits for tomorrow: one card a day, today's came from open-loops");
    // Later the same night nothing more runs: those that waited wait once.
    clock.now = new Date("2026-11-16T04:00:00Z");
    expect(await night(deps, store, clock.now)).toEqual([]);

    clock.now = new Date("2026-11-17T03:00:00Z");
    entries.push(entry(2, "2026-11-16", "Compost"));
    const n17 = await night(deps, store, clock.now);
    // Those that waited go first; the one that posted yesterday waits now.
    expect(n17.filter((r) => r.posted > 0).map((r) => r.id)).toEqual(["topic-gardener", "ideas-digest"]);
    expect(n17.find((r) => r.id === "open-loops")).toEqual({ id: "open-loops", status: "skipped", posted: 0 });
    const calmCards = inbox.list().filter((item) => item.sourceKey && [...CALM_HELPER_IDS].some((id) => item.sourceKey!.startsWith(`persona:${id}:`)));
    const perDay = new Map<string, number>();
    for (const card of calmCards) perDay.set(card.createdAt.slice(0, 10), (perDay.get(card.createdAt.slice(0, 10)) ?? 0) + 1);
    expect([...perDay.values()].every((n) => n <= 1)).toBe(true);
  });

  it("a calm helper posts at most one card a run, and Run now (the user's ask) is not held back", async () => {
    const clock = { now: new Date("2026-11-16T03:00:00Z") };
    const { deps, inbox } = setup(clock, [entry(1, "2026-11-15", "Garden beds")]);
    const twice: PersonaDefinition = {
      ...openLoops,
      async run(ctx) {
        ctx.postFinding({ title: "First loose end" });
        ctx.postFinding({ title: "Second loose end" });
        return { summary: "two" };
      },
    };
    expect(await runPersona(twice, deps, "schedule")).toMatchObject({ status: "capped", summary: "Stopped at one card a day" });
    expect(inbox.list()).toHaveLength(1);
    clock.now = new Date("2026-11-16T09:00:00Z");
    expect(await runPersona(ideas, deps, "manual")).toMatchObject({ status: "done", inboxItemIds: [expect.any(String)] });
  });
});
