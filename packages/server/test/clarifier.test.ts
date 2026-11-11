import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryEntry, MemoryTreeOutline } from "zenod";
import { CLARIFIER_ID, clarifierCard, memoryKind, parseClarifications, switchOnClarifierForOwner } from "../src/clarifier.js";
import { SqliteCredentialVault } from "../src/credentialVault.js";
import { InboxStore, inboxAnswerContent } from "../src/inboxStore.js";
import { CLARIFIER } from "../src/personaCatalog.js";
import { duePersonas, runPersona, type PersonaModel, type PersonaRunnerDeps } from "../src/personaRunner.js";
import { PersonaStore } from "../src/personaStore.js";
import { SubscriberStore } from "../src/subscribers.js";

/** EPIC-14 S37: the Clarifier on stub model replies and made-up memories (no real notes). */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenod-clarifier-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = (n: number, day: string, content: string): MemoryEntry => ({
  evidenceRef: `Log/${day}.md#^e-00000${n}`, path: `Log/${day}.md`, anchor: `e-00000${n}`, title: `Note ${n}`, content,
  source: "whatsapp", verbatim: true, capturedAt: `${day}T09:00:00.000Z`, url: "", provider: "github",
});

const ENTRIES = [
  entry(1, "2026-11-10", "Went to see the flat again, Ana says the boiler is fine."),
  entry(2, "2026-11-09", "Lunch with Ana about the garden plans."),
];

const OUTLINE: MemoryTreeOutline = {
  groups: [{
    id: "working", kind: "group", memory: "working", title: "Working memory", path: null, pages: 2, latest: null, url: null,
    children: [
      { id: "Areas/Valencia flat.md", kind: "root", memory: "working", title: "Valencia flat", path: "Areas/Valencia flat.md", pages: 1, latest: null, url: null, children: [] },
      { id: "Areas/Barcelona flat.md", kind: "root", memory: "working", title: "Barcelona flat", path: "Areas/Barcelona flat.md", pages: 1, latest: null, url: null, children: [] },
    ],
  }],
  roots: 2, placed: 2, unplaced: 0,
};

const REPLY = JSON.stringify({
  questions: [
    { source: 1, quote: "the flat", question: "by \"the flat\", which one did you mean?", options: ["Valencia flat", "Barcelona flat"], why: "You have two flats in your memory." },
    { source: 2, quote: "Ana", question: "which Ana was at lunch?", options: ["Ana the neighbour", "Ana from work", "ana from work"], why: "Two people called Ana." },
    { source: 1, quote: "boiler", question: "which boiler?", options: ["Only one"], why: "" },
  ],
});

function stubModel(reply = REPLY) {
  const calls: Array<{ system: string; prompt: string }> = [];
  const model: PersonaModel = {
    async complete(input) {
      calls.push(input);
      return { text: reply, inputTokens: 900, outputTokens: 120, costUsd: 0.0003 };
    },
  };
  return { calls, model };
}

function deps(model: PersonaModel, entries = ENTRIES) {
  const inbox = new InboxStore(join(dir, "inbox.sqlite"));
  const store = new PersonaStore(join(dir, "personas.sqlite"));
  const written: Array<{ files: Array<{ name: string; content: string }> }> = [];
  const d: PersonaRunnerDeps = {
    memory: {
      async memoryTreeOutline() { return OUTLINE; },
      async searchEntries() { return entries; },
      async search() { return []; },
      async get(): Promise<never> { throw new Error("not in this test"); },
    },
    model: () => model,
    inbox,
    store,
    writeNotes: async (input) => { written.push(input); return { id: `rev-${written.length}` }; },
    now: () => new Date("2026-11-11T03:00:00Z"),
  };
  return { d, inbox, store, written };
}

describe("Clarifier (EPIC-14 S37)", () => {
  it("is off by default and asks at most two questions a night, each about a different memory, as question cards", async () => {
    expect(CLARIFIER.defaultEnabled).toBe(false);
    expect(CLARIFIER.skills).not.toContain("propose-desk-job");
    const stub = stubModel();
    const { d, inbox, written } = deps(stub.model);
    const run = await runPersona(CLARIFIER, d, "manual");
    expect(run).toMatchObject({ status: "done", modelCalls: 1 });
    expect(stub.calls[0]!.prompt).toContain("Valencia flat");
    expect(stub.calls[0]!.prompt).toContain("the flat again");
    const items = inbox.list().filter((item) => item.kind === "question");
    expect(items).toHaveLength(2);
    const flat = items.find((item) => item.title.includes("the flat"))!;
    expect(flat).toMatchObject({ from: "Clarifier", status: "open", title: "In your note of 10 Nov you said \"the flat\": by \"the flat\", which one did you mean?" });
    expect(flat.options.map((o) => o.label)).toEqual(["Valencia flat", "Barcelona flat"]);
    expect(flat.body).toBe("You have two flats in your memory. Pick one, or answer in your own words.");
    expect(flat.links[0]).toEqual({ label: "Your note of 10 Nov", path: "Log/2026-11-10.md" });
    const ana = items.find((item) => item.title.includes("Ana"))!;
    // A repeated meaning is dropped; one with a single meaning is no question.
    expect(ana.options.map((o) => o.label)).toEqual(["Ana the neighbour", "Ana from work"]);
    expect(written[0]!.files[0]!.content).toContain("Asked about");
    // The answer is filed with the question first, so the memory knows what it answers.
    expect(inboxAnswerContent(flat, "Valencia flat")).toMatch(/^In your note of 10 Nov you said "the flat": by "the flat", which one did you mean\?\n\nMy answer: Valencia flat/);
  });

  it("never asks about the same memory twice and stays quiet while two questions wait", async () => {
    const { d, inbox } = deps(stubModel().model);
    await runPersona(CLARIFIER, d, "manual");
    expect(inbox.list().filter((item) => item.kind === "question")).toHaveLength(2);
    // Two wait: the next run asks nothing and makes no model call.
    const quiet = stubModel();
    const second = await runPersona(CLARIFIER, { ...d, model: () => quiet.model }, "manual");
    expect(second!.summary).toContain("still wait");
    expect(quiet.calls).toHaveLength(0);
    // One answered: room for one more, but both memories were asked about already, so they are left out.
    const open = inbox.list().find((item) => item.kind === "question" && item.status === "open")!;
    inbox.answer(open.id, open.options[0]!.id);
    const third = stubModel();
    const run = await runPersona(CLARIFIER, { ...d, model: () => third.model }, "manual");
    expect(run!.summary).toBe("Nothing new to read");
    expect(third.calls).toHaveLength(0);
    expect(inbox.list().filter((item) => item.kind === "question")).toHaveLength(2);
  });

  it("asks nothing when nothing is confusing", async () => {
    const { d, inbox } = deps(stubModel(JSON.stringify({ questions: [] })).model);
    const run = await runPersona(CLARIFIER, d, "manual");
    expect(run!.summary).toContain("nothing confusing");
    expect(inbox.list()).toHaveLength(0);
  });

  it("checks what the model found: a real memory, two or three meanings, no project work", () => {
    const found = parseClarifications({
      questions: [
        { source: 9, question: "which?", options: ["a", "b"] },
        { source: 1, question: "which release did you mean for the deploy?", options: ["v1", "v2"], why: "two releases" },
        { source: 1, question: "which Marta?", options: ["Marta", "Marta B", "Marta C", "Marta D"] },
        "nonsense",
      ],
    }, 2);
    expect(found).toHaveLength(1);
    expect(found[0]!.options).toEqual(["Marta", "Marta B", "Marta C"]);
    expect(parseClarifications(null, 2)).toEqual([]);
    expect(clarifierCard(found[0]!, memoryKind("Voice note"), "2026-11-03T10:00:00Z").title).toBe("In your voice note of 3 Nov: which Marta?");
    expect(memoryKind("Lunch with Ana about the garden")).toBe("note");
  });

  it("is switched on once for the account that owns the team, never for a tester, and the person's choice stands", () => {
    const vault = new SqliteCredentialVault({ dataDir: dir, tenantId: "t", masterKey: "1".repeat(64) });
    const personas = new PersonaStore(join(dir, "personas.sqlite"));
    // A tester: no Team connection, it stays off.
    expect(switchOnClarifierForOwner(personas, null)).toBe(false);
    const empty = new SubscriberStore(join(dir, "empty.sqlite"), vault);
    expect(switchOnClarifierForOwner(personas, empty)).toBe(false);
    expect(personas.enabled(CLARIFIER_ID)).toBeNull();
    expect(duePersonas([CLARIFIER], personas, new Date("2026-11-11T03:00:00Z"))).toHaveLength(0);
    // The owner: a Team connection made before it came.
    const subscribers = new SubscriberStore(join(dir, "subscribers.sqlite"), vault, () => Date.parse("2026-11-02T21:00:00Z"));
    subscribers.create({ name: "Epic Team", kind: "agent_team", url: "https://hooks.alpha9.io/api/hooks/zenod/zcn_abc", event: "voice_note.captured", via: "manual" });
    expect(switchOnClarifierForOwner(personas, subscribers)).toBe(true);
    expect(personas.enabled(CLARIFIER_ID)).toBe(true);
    expect(duePersonas([CLARIFIER], personas, new Date("2026-11-11T03:00:00Z")).map((p) => p.id)).toEqual([CLARIFIER_ID]);
    // Switched off later: it stays off.
    personas.setEnabled(CLARIFIER_ID, false);
    expect(switchOnClarifierForOwner(personas, subscribers)).toBe(false);
    expect(personas.enabled(CLARIFIER_ID)).toBe(false);
  });
});
