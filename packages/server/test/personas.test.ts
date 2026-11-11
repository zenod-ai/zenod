import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine, SqliteStateStore, VaultRepo, type BrainEngine, type BrainLlm, type MemoryEntry, type MemoryTreeOutline } from "zenod";
import { InboxStore } from "../src/inboxStore.js";
import { answerDeskQuestion } from "../src/memoryDesk.js";
import {
  BUILT_IN_PERSONAS,
  IDEAS_DIGEST,
  MEMORY_HEALTH,
  memoryTitle,
  memoryWords,
  OPEN_LOOPS,
  parseRecapReply,
  PEOPLE_FOLLOW_UPS,
  PATTERNS_AND_IDEAS,
  SOMETHING_TO_TRY,
  TOPIC_GARDENER,
  WEEKLY_RECAP,
} from "../src/personaCatalog.js";
import { registerPersonaRoutes } from "../src/personaRoutes.js";
import { isProjectWork, isTeamRecord, OUT_OF_SCOPE_REASON, putAwayProjectSuggestions } from "../src/helperScope.js";
import {
  duePersonas,
  nextPersonaWakeAt,
  personaEnabled,
  personaPeriodKey,
  personaView,
  runPersona,
  type PersonaDefinition,
  type PersonaModel,
  type PersonaRunnerDeps,
} from "../src/personaRunner.js";
import { closePersonasFor, PersonaStore, personasFor, WEEKLY_RECAP_OFF_SINCE } from "../src/personaStore.js";
import type { TeamAsk } from "../src/teamAsk.js";

/**
 * EPIC-14 S4: the persona runner on stub model replies and a made-up demo vault (no real notes).
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenod-personas-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const STUB_REPLY = JSON.stringify({
  recap: ["You planned the garden beds.", "You asked about the boat insurance twice."],
  finding: { title: "You mentioned booking the dentist twice this week and have not booked yet.", detail: "Both notes say next week.", sources: [1, 2] },
});

function stubModel(reply = STUB_REPLY, costUsd = 0.0004) {
  const calls: Array<{ system: string; prompt: string }> = [];
  const model: PersonaModel = {
    async complete(input) {
      calls.push(input);
      return { text: reply, inputTokens: 1200, outputTokens: 90, costUsd };
    },
  };
  return { calls, model };
}

const entry = (n: number, day: string, title: string): MemoryEntry => ({
  evidenceRef: `Log/${day}.md#^e-00000${n}`, path: `Log/${day}.md`, anchor: `e-00000${n}`, title, content: `${title}, a made-up demo memory.`,
  source: "whatsapp", verbatim: true, capturedAt: `${day}T09:00:00.000Z`, url: "", provider: "github",
});

/** A made-up tree outline (S27): two places, one loose page. */
const OUTLINE: MemoryTreeOutline = {
  groups: [
    {
      id: "working", kind: "group", memory: "working", title: "Working memory", path: null, pages: 3, latest: null, url: null,
      children: [
        { id: "Areas/Home.md", kind: "root", memory: "working", title: "Home", path: "Areas/Home.md", summary: "The flat and its repairs.", pages: 2, latest: null, url: null,
          children: [{ id: "Notes/Boiler.md", kind: "page", memory: "working", title: "Boiler", path: "Notes/Boiler.md", pages: 1, latest: null, url: null, children: [] }] },
        { id: "Areas/Garden.md", kind: "root", memory: "working", title: "Garden", path: "Areas/Garden.md", pages: 1, latest: null, url: null, children: [] },
      ],
    },
    { id: "long-term", kind: "group", memory: "long-term", title: "Long-term memory", path: null, pages: 0, latest: null, url: null, children: [] },
  ],
  roots: 2, placed: 3, unplaced: 4,
  unplacedPages: [{ title: "Dentist", path: "Notes/Dentist.md" }, { title: "Compost", path: "Notes/Compost.md" }, { title: "Ana", path: "People/Ana.md" }, { title: "Shed", path: "Notes/Shed.md" }],
};

function fakeMemory(entries: MemoryEntry[], outline: MemoryTreeOutline | null = null) {
  return {
    async memoryTreeOutline() { return outline; },
    async searchEntries(query: { capturedAfter?: string; limit?: number | null } = {}) {
      return entries.filter((e) => !query.capturedAfter || e.capturedAt >= query.capturedAfter).slice(0, query.limit ?? undefined);
    },
    async search() { return []; },
    async get(): Promise<never> { throw new Error("not in this test"); },
  };
}

function deps(over: Partial<PersonaRunnerDeps> & { entries?: MemoryEntry[]; outline?: MemoryTreeOutline | null; model?: () => PersonaModel; now?: () => Date }) {
  const written: Array<{ personaId: string; files: Array<{ name: string; content: string }>; message: string }> = [];
  const inbox = new InboxStore(join(dir, "inbox.sqlite"));
  const store = new PersonaStore(join(dir, "personas.sqlite"), over.now);
  const base: PersonaRunnerDeps = {
    memory: fakeMemory(over.entries ?? [entry(1, "2026-11-07", "Dentist next week"), entry(2, "2026-11-04", "Call the dentist")], over.outline ?? null),
    model: over.model ?? (() => stubModel().model),
    inbox,
    store,
    writeNotes: async (input) => { written.push(input); return { id: `rev-${written.length}` }; },
    now: over.now ?? (() => new Date("2026-11-08T10:00:00Z")),
  };
  return { deps: { ...base, ...over }, written, inbox, store };
}

describe("persona runner (EPIC-14 S4)", () => {
  it("runs Weekly recap: one model call, one note in its own folder, one finding in the inbox, logged with tokens and cost", async () => {
    const stub = stubModel();
    const { deps: d, written, inbox, store } = deps({ model: () => stub.model });
    const run = await runPersona(WEEKLY_RECAP, d, "manual");
    expect(run).toMatchObject({ status: "done", modelCalls: 1, inputTokens: 1200, outputTokens: 90, revision: "rev-1", trigger: "manual" });
    expect(run!.costUsd).toBeCloseTo(0.0004);
    expect(run!.steps).toBeLessThanOrEqual(WEEKLY_RECAP.limits.maxSteps);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.prompt).toContain("Dentist next week");
    expect(written).toHaveLength(1);
    expect(written[0]!.personaId).toBe("weekly-recap");
    expect(written[0]!.files.map((f) => f.name)).toEqual(["2026-11-08.md"]);
    expect(written[0]!.files[0]!.content).toContain("- You planned the garden beds.");
    const items = inbox.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "finding", from: "Weekly recap", title: "You mentioned booking the dentist twice this week and have not booked yet." });
    expect(items[0]!.links.map((l) => l.path)).toEqual(["Log/2026-11-07.md", "Log/2026-11-04.md", "Personas/weekly-recap/2026-11-08.md"]);
    expect(run!.inboxItemIds).toEqual([items[0]!.id]);
    expect(store.runs("weekly-recap")).toHaveLength(1);
  });

  it("reads the user's feedback on its cards in its next run, once, and new feedback is reason to wake (EPIC-14 S2 round 3)", async () => {
    let clock = new Date("2026-11-08T03:00:00Z");
    const stub = stubModel();
    const { deps: d, inbox } = deps({ model: () => stub.model, now: () => clock });
    const nightly: PersonaDefinition = { ...WEEKLY_RECAP, schedule: { every: "night" } };
    await runPersona(nightly, d, "schedule");
    expect(stub.calls[0]!.system).not.toContain("wrote back");
    const finding = inbox.list().find((item) => item.kind === "finding")!;
    inbox.addReply(finding.id, { kind: "feedback", text: "I booked it yesterday, stop flagging the dentist", readAt: null });
    clock = new Date("2026-11-09T03:00:00Z");
    const run = await runPersona(nightly, d, "schedule");
    expect(run).toMatchObject({ status: "done", modelCalls: 1 });
    expect(stub.calls[1]!.system).toContain("I booked it yesterday, stop flagging the dentist");
    expect(stub.calls[1]!.system).toContain(finding.title);
    expect(inbox.get(finding.id)!.replies[0]!.readAt).toBeTruthy();
    // Read once: the next night, same memories and no new words, it sleeps.
    clock = new Date("2026-11-10T03:00:00Z");
    expect(await runPersona(nightly, d, "schedule")).toMatchObject({ status: "skipped" });
    await runPersona(nightly, d, "manual");
    expect(stub.calls.at(-1)!.system).not.toContain("wrote back");
  });

  it("posts a suggestion only with its skill, and reads a Not now reason on its next run (EPIC-14 S26)", async () => {
    let clock = new Date("2026-11-08T03:00:00Z");
    const stub = stubModel();
    const { deps: d, inbox } = deps({ model: () => stub.model, now: () => clock });
    const gardener: PersonaDefinition = {
      ...WEEKLY_RECAP, id: "gardener-test", name: "Gardener test", skills: ["read", "propose-desk-job"], schedule: { every: "night" },
      async run(ctx) {
        await ctx.think({ system: "Look for tangled topics.", prompt: "notes" });
        ctx.postSuggestion({ title: "Flat and Apartment are the same place", action: "Join Apartment into Flat." });
        return { summary: "one suggestion" };
      },
    };
    expect(await runPersona(gardener, d, "manual")).toMatchObject({ status: "done" });
    const card = inbox.list().find((item) => item.kind === "suggestion")!;
    expect(card).toMatchObject({ from: "Gardener test", status: "open", action: "Join Apartment into Flat." });
    inbox.declineSuggestion(card.id, "They are two different flats");
    clock = new Date("2026-11-09T03:00:00Z");
    await runPersona(gardener, d, "manual");
    expect(stub.calls.at(-1)!.system).toContain("Not now: They are two different flats");
    expect(inbox.get(card.id)!.replies[0]!.readAt).toBeTruthy();
    // Without the skill it may not suggest.
    const noSkill: PersonaDefinition = { ...gardener, id: "no-skill", name: "No skill", skills: ["read"] };
    expect(await runPersona(noSkill, d, "manual")).toMatchObject({ status: "failed" });
  });

  it("skips with no model call when there is nothing to read, or nothing new since the last real run", async () => {
    const empty = stubModel();
    const a = deps({ entries: [], model: () => empty.model });
    expect(await runPersona(WEEKLY_RECAP, a.deps, "manual")).toMatchObject({ status: "skipped", modelCalls: 0 });
    expect(empty.calls).toHaveLength(0);

    let clock = new Date("2026-11-08T03:00:00Z");
    const stub = stubModel();
    const b = deps({ model: () => stub.model, now: () => clock });
    b.deps.store = new PersonaStore(join(dir, "personas-b.sqlite"));
    expect(await runPersona(WEEKLY_RECAP, b.deps, "schedule")).toMatchObject({ status: "done", periodKey: `week:2026-11-08@${WEEKLY_RECAP.revisedAt}` });
    // The same period never runs twice.
    expect(await runPersona(WEEKLY_RECAP, b.deps, "schedule")).toBeNull();
    // A nightly persona the next night, same memories: skipped, no call.
    const nightly: PersonaDefinition = { ...WEEKLY_RECAP, schedule: { every: "night" } };
    clock = new Date("2026-11-09T03:00:00Z");
    expect(await runPersona(nightly, b.deps, "schedule")).toMatchObject({ status: "skipped", summary: "Nothing new since the last run" });
    expect(stub.calls).toHaveLength(1);
  });

  it("stops at its step cap and keeps the run logged as capped", async () => {
    const greedy: PersonaDefinition = {
      ...WEEKLY_RECAP, id: "greedy", skills: [...WEEKLY_RECAP.skills, "search"], limits: { ...WEEKLY_RECAP.limits, maxSteps: 3 },
      async run(ctx) {
        for (let i = 0; i < 10; i += 1) await ctx.search(`q${i}`);
        return { summary: "never" };
      },
    };
    const { deps: d } = deps({});
    expect(await runPersona(greedy, d, "manual")).toMatchObject({ status: "capped", steps: 3, summary: "Stopped at its 3 steps" });
  });

  it("stops at the spend caps: per run, per persona per month, and all personas together", async () => {
    const twoCalls: PersonaDefinition = {
      ...WEEKLY_RECAP, id: "two-calls",
      async run(ctx) {
        await ctx.think({ system: "s", prompt: "p" });
        await ctx.think({ system: "s", prompt: "p" });
        return { summary: "two" };
      },
    };
    const pricey = stubModel(STUB_REPLY, 0.03);
    const a = deps({ model: () => pricey.model });
    expect(await runPersona(twoCalls, a.deps, "manual")).toMatchObject({ status: "capped", modelCalls: 1, summary: "Stopped at its spend cap for one run" });

    // This month's spend already at the persona's cap: no call at all.
    const stub = stubModel();
    const b = deps({ model: () => stub.model });
    b.deps.store = new PersonaStore(join(dir, "personas-b.sqlite"), () => new Date("2026-11-03T03:00:00Z"));
    const old = b.deps.store.start("weekly-recap", "manual")!;
    b.deps.store.finish(old.id, { status: "done", steps: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.1, summary: "", inboxItemIds: [], revision: null, fingerprint: "x" });
    expect(await runPersona(WEEKLY_RECAP, b.deps, "manual")).toMatchObject({ status: "capped", summary: "Weekly recap's monthly budget is used up" });
    expect(stub.calls).toHaveLength(0);

    // All personas together at $1.
    const c = deps({ model: () => stub.model, totalMonthUsd: 0.05 });
    c.deps.store = new PersonaStore(join(dir, "personas-c.sqlite"), () => new Date("2026-11-03T03:00:00Z"));
    const other = c.deps.store.start("someone-else", "manual")!;
    c.deps.store.finish(other.id, { status: "done", steps: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.05, summary: "", inboxItemIds: [], revision: null, fingerprint: "x" });
    expect(await runPersona(WEEKLY_RECAP, c.deps, "manual")).toMatchObject({ status: "capped", summary: "The helpers' monthly budget is used up" });
    expect(stub.calls).toHaveLength(0);
  });

  it("does not start when the tenant's AI allowance is used up", async () => {
    const stub = stubModel();
    const { deps: d } = deps({ model: () => stub.model, aiAllowanceBlock: () => ({ message: "used up" }) });
    // The run log says why, in the limits model's words (limits.ts).
    expect(await runPersona(WEEKLY_RECAP, d, "manual")).toMatchObject({ status: "skipped", summary: "used up" });
    expect(stub.calls).toHaveLength(0);
  });

  it("logs a persona's own error as a failed run instead of throwing", async () => {
    const broken: PersonaDefinition = { ...WEEKLY_RECAP, id: "broken", async run() { throw new Error("boom"); } };
    const { deps: d } = deps({});
    expect(await runPersona(broken, d, "manual")).toMatchObject({ status: "failed", summary: "Failed: boom" });
  });

  it("fails the run when the model's answer is empty, instead of writing that nothing was found (S5)", async () => {
    const stub = stubModel("   ");
    const { deps: d, written, inbox } = deps({ model: () => stub.model });
    const run = await runPersona(OPEN_LOOPS, d, "manual");
    expect(run).toMatchObject({ status: "failed", summary: "Failed: The model gave no answer", modelCalls: 1 });
    expect(run!.costUsd).toBeCloseTo(0.0004);
    expect(written).toHaveLength(0);
    expect(inbox.list()).toHaveLength(0);
  });

  it("wakes a persona that is on and never ran at once, then only in the off-peak window, once per period", () => {
    const store = new PersonaStore(join(dir, "personas.sqlite"), () => new Date("2026-11-10T20:00:00Z"));
    const noon = new Date("2026-11-10T21:00:00Z");
    // E23-A2: off by default; switched on, it wakes at once.
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon)).toEqual([]);
    store.setEnabled("weekly-recap", true);
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon).map((p) => p.id)).toEqual(["weekly-recap"]);
    const run = store.start("weekly-recap", "manual")!;
    store.finish(run.id, { status: "done", steps: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, summary: "", inboxItemIds: [], revision: null, fingerprint: "x" });
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon)).toEqual([]);
    const night = new Date("2026-11-11T03:00:00Z");
    expect(duePersonas(BUILT_IN_PERSONAS, store, night).map((p) => p.id)).toEqual(["weekly-recap"]);
    store.start("weekly-recap", "schedule", personaPeriodKey(WEEKLY_RECAP, night));
    expect(duePersonas(BUILT_IN_PERSONAS, store, night)).toEqual([]);
    store.setEnabled("weekly-recap", false);
    expect(duePersonas(BUILT_IN_PERSONAS, store, new Date("2026-11-16T03:00:00Z"))).toEqual([]);
    expect(nextPersonaWakeAt({ every: "week" }, night, true).toISOString()).toBe("2026-11-15T02:00:00.000Z");
    expect(nextPersonaWakeAt({ every: "night" }, noon, false).toISOString()).toBe("2026-11-11T02:00:00.000Z");
  });

  it("wakes a revised persona once more at once, in its own period, even with nothing new", async () => {
    let clock = new Date("2026-11-08T12:00:00Z");
    const stub = stubModel();
    const { deps: d, store } = deps({ model: () => stub.model, now: () => clock });
    const v1: PersonaDefinition = { ...WEEKLY_RECAP, defaultEnabled: true, revisedAt: undefined };
    expect(duePersonas([v1], store, clock).length).toBe(1);
    expect(await runPersona(v1, d, "schedule")).toMatchObject({ status: "done", periodKey: "week:2026-11-08" });
    expect(duePersonas([v1], store, clock)).toEqual([]);
    clock = new Date("2026-11-08T20:00:00Z");
    const v2: PersonaDefinition = { ...WEEKLY_RECAP, defaultEnabled: true, revisedAt: "2026-11-08T19:30:00.000Z" };
    expect(duePersonas([v2], store, clock).length).toBe(1);
    expect(await runPersona(v2, d, "schedule")).toMatchObject({ status: "done", periodKey: "week:2026-11-08@2026-11-08T19:30:00.000Z" });
    expect(duePersonas([v2], store, clock)).toEqual([]);
    expect(stub.calls).toHaveLength(2);
  });

  it("reads memories spread over the 7 days, so a busy day does not crowd out the week", async () => {
    const busy = Array.from({ length: 60 }, (_, i) => entry(i, "2026-11-08", `Busy day ${i}`)).map((e, i) => ({ ...e, capturedAt: `2026-11-08T0${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}:00.000Z` }));
    const older = [entry(91, "2026-11-04", "Mid-week memory"), entry(92, "2026-11-02", "Early-week memory")];
    const stub = stubModel();
    const { deps: d } = deps({ entries: [...busy, ...older], model: () => stub.model });
    await runPersona(WEEKLY_RECAP, d, "manual");
    const prompt = stub.calls[0]!.prompt;
    expect(prompt).toContain("Mid-week memory");
    expect(prompt).toContain("Early-week memory");
    expect(prompt.split("\n").filter((line) => line.startsWith("[")).length).toBeLessThanOrEqual(40);
  });

  it("gives the model what was said, not a voice note's capture header", () => {
    const voice = 'Voice note "AB12.ogg" ingested through Zenod media seam.\nRaw artifact: drive://file/x\nTranscribed by someone.\n\nI still have not booked the dentist.';
    expect(memoryWords(voice)).toBe("I still have not booked the dentist.");
    expect(memoryWords("Note: buy milk\n\nand eggs")).toBe("Note: buy milk and eggs");
    expect(memoryWords("Plain words.")).toBe("Plain words.");
    expect(memoryTitle(entry(1, "2026-11-06", 'Audio "AC60.ogg" ingested thr...'))).toBe("Audio");
    expect(memoryTitle(entry(2, "2026-11-06", 'Voice note "AB12.ogg" ingeste...'))).toBe("Voice note");
    expect(memoryTitle(entry(3, "2026-11-06", "Dentist next week"))).toBe("Dentist next week");
  });

  it("marks runs a restart interrupted as failed so their period can run again", () => {
    const store = new PersonaStore(join(dir, "personas.sqlite"));
    store.start("weekly-recap", "schedule", "week:2026-11-08");
    expect(store.recoverInterrupted()).toBe(1);
    expect(store.hasRunForPeriod("weekly-recap", "week:2026-11-08")).toBe(false);
    expect(store.runs("weekly-recap")[0]).toMatchObject({ status: "failed", summary: "Stopped by a restart" });
  });

  it("reads a model reply that is not JSON as one recap line", () => {
    expect(parseRecapReply("A quiet week.")).toEqual({ recap: ["A quiet week."], finding: null });
    expect(parseRecapReply("```json\n" + STUB_REPLY + "\n```").finding?.sources).toEqual([1, 2]);
  });
});

class NoLlm implements BrainLlm {
  async classify(): Promise<never> { throw new Error("no LLM in this test"); }
  async composePage(): Promise<never> { throw new Error("no LLM in this test"); }
  async answer(): Promise<never> { throw new Error("no LLM in this test"); }
  async describeImage(): Promise<string> { return ""; }
  async work(): Promise<never> { throw new Error("no LLM in this test"); }
  async extractBacklog(): Promise<never> { throw new Error("no LLM in this test"); }
}

const logEntry = (time: string, anchor: string, text: string) =>
  `## ${time} ${text.slice(0, 30)}  ^${anchor}\n- source: whatsapp\n- verbatim: yes\n\n> ${text}\n`;

/** A made-up demo vault: three memories this week, one older. */
const DEMO_VAULT: Record<string, string> = {
  ".brain/config.yml": "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n",
  "Index.md": "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n",
  "Log/2026-10-20.md": `# 2026-10-20\n\n${logEntry("09:00", "e-aaaaa1", "Old note about tomato seeds")}`,
  "Log/2026-11-04.md": `# 2026-11-04\n\n${logEntry("10:00", "e-bbbbb2", "Call the dentist about the crown")}`,
  "Log/2026-11-06.md": `# 2026-11-06\n\n${logEntry("18:30", "e-ccccc3", "Garden beds: buy compost on Saturday")}`,
  "Log/2026-11-07.md": `# 2026-11-07\n\n${logEntry("08:15", "e-ddddd4", "Dentist next week, still not booked")}`,
};

async function demoEngine(): Promise<{ engine: BrainEngine; repo: VaultRepo; bare: string }> {
  const bare = join(dir, "origin.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);
  const seed = join(dir, "seed");
  await simpleGit().clone(bare, seed);
  for (const [path, content] of Object.entries(DEMO_VAULT)) {
    await mkdir(dirname(join(seed, path)), { recursive: true });
    await writeFile(join(seed, path), content);
  }
  const git = simpleGit(seed);
  await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
  await git.add(["-A"]);
  await git.commit("demo vault");
  await git.push("origin", "main");
  const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
  const engine = createEngine({ repo, llm: new NoLlm(), state: new SqliteStateStore(":memory:"), now: () => new Date("2026-11-08T10:00:00Z") });
  return { engine, repo, bare };
}

describe("persona runner on a demo vault (EPIC-14 S4)", { timeout: 60_000 }, () => {
  it("reads the last 7 days, publishes ONE commit only under its own folder and posts the finding", async () => {
    const { engine, repo, bare } = await demoEngine();
    const work = simpleGit(repo.path);
    const before = (await work.revparse(["HEAD"])).trim();
    const stub = stubModel(JSON.stringify({
      recap: ["Dentist and garden this week."],
      finding: { title: "The dentist came up twice and is still not booked.", detail: "", sources: [1, 3] },
    }));
    const inbox = new InboxStore(join(dir, "inbox.sqlite"));
    const store = new PersonaStore(join(dir, "personas.sqlite"));
    const run = await runPersona(WEEKLY_RECAP, {
      memory: engine, model: () => stub.model, inbox, store,
      writeNotes: (input) => engine.writePersonaNotes!(input),
      now: () => new Date("2026-11-08T10:00:00Z"),
    }, "manual");
    expect(run).toMatchObject({ status: "done", modelCalls: 1 });
    // The old memory is outside the 7 days.
    expect(stub.calls[0]!.prompt).toContain("Dentist next week");
    expect(stub.calls[0]!.prompt).toContain("Call the dentist");
    expect(stub.calls[0]!.prompt).not.toContain("tomato");
    const after = (await work.revparse(["HEAD"])).trim();
    expect(run!.revision).toBe(after);
    expect((await work.raw(["rev-list", "--count", `${before}..${after}`])).trim()).toBe("1");
    expect((await work.raw(["diff", "--name-only", before, after])).trim()).toBe("Personas/weekly-recap/2026-11-08.md");
    expect((await simpleGit(bare).revparse(["main"])).trim()).toBe(after);
    const note = await readFile(join(repo.path, "Personas/weekly-recap/2026-11-08.md"), "utf8");
    expect(note).toContain("type: persona-note");
    expect(note).toContain("[[Log/2026-11-07#^e-ddddd4|");
    const item = inbox.list()[0]!;
    expect(item).toMatchObject({ kind: "finding", from: "Weekly recap", title: "The dentist came up twice and is still not booked." });
    expect(item.links.map((l) => l.path)).toEqual(["Log/2026-11-07.md", "Log/2026-11-04.md", "Personas/weekly-recap/2026-11-08.md"]);
  });

  it("refuses a note outside the persona's folder and leaves the vault clean", async () => {
    const { engine, repo } = await demoEngine();
    const work = simpleGit(repo.path);
    const before = (await work.revparse(["HEAD"])).trim();
    await expect(engine.writePersonaNotes!({ personaId: "weekly-recap", files: [{ name: "../../Log/2026-11-08.md", content: "x" }], message: "m" })).rejects.toThrow("persona_notes_bad_path");
    await expect(engine.writePersonaNotes!({ personaId: "../Areas", files: [{ name: "a.md", content: "x" }], message: "m" })).rejects.toThrow("persona_notes_bad_id");
    await expect(engine.writePersonaNotes!({ personaId: "weekly-recap", files: [{ name: "a.txt", content: "x" }], message: "m" })).rejects.toThrow("persona_notes_bad_path");
    expect((await work.revparse(["HEAD"])).trim()).toBe(before);
    expect((await work.status()).files).toEqual([]);
  });
});

describe("persona settings routes (EPIC-14 S4)", () => {
  it("lists personas with their last run and spend, switches one off and runs it now", async () => {
    const runtime = {
      dataDir: dir,
      runs: 0,
      async runPersona(persona: PersonaDefinition, trigger: "schedule" | "manual") {
        this.runs += 1;
        const store = personasFor(this);
        const run = store.start(persona.id, trigger)!;
        return store.finish(run.id, { status: "done", steps: 3, modelCalls: 1, inputTokens: 900, outputTokens: 80, costUsd: 0.0003, summary: "Read 4 memories", inboxItemIds: [], revision: "abc", fingerprint: "f" });
      },
    };
    const app = new Hono();
    let signedIn = true;
    registerPersonaRoutes(app, async (c) => (signedIn ? { runtime } : { response: c.json({ error: "unauthorized" }, 401) }));
    try {
      const first = await (await app.request("/api/console/personas")).json() as { personas: Array<{ id: string; enabled: boolean; lastRun: unknown; skills: Array<{ label: string }> }>; budget: { capUsd: number }; skills: unknown[] };
      expect(first.personas.map((p) => [p.id, p.enabled, p.lastRun])).toEqual([
        ["weekly-recap", false, null], ["open-loops", false, null], ["people-follow-ups", false, null],
        ["topic-gardener", false, null], ["ideas-digest", false, null], ["something-to-try", false, null], ["patterns-and-ideas", false, null], ["memory-health", false, null], ["clarifier", false, null],
      ]);
      // E23-A2: a new account starts with every helper off; the user switches one on.
      const on = await (await app.request("/api/console/personas/weekly-recap", { method: "POST", body: JSON.stringify({ enabled: true }), headers: { "content-type": "application/json" } })).json() as { personas: Array<{ enabled: boolean }> };
      expect(on.personas[0]).toMatchObject({ enabled: true });
      expect(first.personas[0]!.skills.map((skill) => skill.label)).toContain("Write only into its own folder");
      expect(first.skills).toHaveLength(6);
      expect(first.budget.capUsd).toBe(1);

      const ran = await (await app.request("/api/console/personas/weekly-recap/run", { method: "POST" })).json() as { run: { status: string }; personas: Array<{ lastRun: { summary: string } | null; budget: { totalUsd: number } }> };
      expect(ran.run.status).toBe("done");
      expect(ran.personas[0]!.lastRun?.summary).toBe("Read 4 memories");
      expect(ran.personas[0]!.budget.totalUsd).toBeCloseTo(0.0003);

      const off = await (await app.request("/api/console/personas/weekly-recap", { method: "POST", body: JSON.stringify({ enabled: false }), headers: { "content-type": "application/json" } })).json() as { personas: Array<{ enabled: boolean; nextWakeAt: string | null }> };
      expect(off.personas[0]).toMatchObject({ enabled: false, nextWakeAt: null });

      expect((await app.request("/api/console/personas/nobody/run", { method: "POST" })).status).toBe(404);
      expect((await app.request("/api/console/personas/weekly-recap", { method: "POST", body: "{}" })).status).toBe(400);

      // A persona that is off never runs, not even with Run now.
      expect((await app.request("/api/console/personas/open-loops/run", { method: "POST" })).status).toBe(409);
      // Its cadence: every 3 days; setting it leaves the switch alone; nonsense is refused; null goes back to its default.
      const post = (body: unknown) => app.request("/api/console/personas/open-loops", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      type Listed = { personas: Array<{ id: string; enabled: boolean; schedule: string; cadence: unknown }> };
      const every3 = await (await post({ cadence: { every: "days", days: 3 } })).json() as Listed;
      expect(every3.personas[1]).toMatchObject({ id: "open-loops", enabled: false, schedule: "Every 3 days, at night", cadence: { every: "days", days: 3 } });
      expect((await post({ cadence: { every: "days", days: 1 } })).status).toBe(400);
      expect((await post({ cadence: { every: "hourly" } })).status).toBe(400);
      const weekly = await (await post({ enabled: true, cadence: { every: "week" } })).json() as Listed;
      expect(weekly.personas[1]).toMatchObject({ enabled: true, schedule: "Weekly, Sunday night" });
      // S27: Open loops finder's default is every night.
      const back = await (await post({ cadence: null })).json() as Listed;
      expect(back.personas[1]).toMatchObject({ enabled: true, schedule: "Daily, at night" });
      expect((await app.request("/api/console/personas/open-loops/run", { method: "POST" })).status).toBe(200);
      signedIn = false;
      expect((await app.request("/api/console/personas")).status).toBe(401);
      expect(runtime.runs).toBe(2);
    } finally {
      closePersonasFor(runtime);
    }
  });
});

describe("persona catalog (EPIC-14 S4 round 2)", () => {
  const fourWeeks = [
    ...[1, 2, 3, 4, 5, 6].map((n) => entry(n, "2026-10-14", `Older memory ${n}`)),
    ...[7, 8, 9, 10, 11].map((n) => entry(n, "2026-10-21", `Older memory ${n}`)),
    ...[12, 13, 14, 15].map((n) => entry(n, "2026-10-28", `Older memory ${n}`)),
    entry(16, "2026-11-06", "Only one this week"),
  ].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  it("lists nine personas with a purpose and their skills; all start off (E23-A2), so none wakes until switched on", () => {
    expect(BUILT_IN_PERSONAS.map((p) => p.name)).toEqual(["Weekly recap", "Open loops finder", "People and follow-ups", "Topic gardener", "Ideas digest", "Something to try", "Patterns and ideas", "Health of your memory", "Clarifier"]);
    expect(BUILT_IN_PERSONAS.filter((p) => p.defaultEnabled).map((p) => p.id)).toEqual([]);
    for (const persona of BUILT_IN_PERSONAS) {
      expect(persona.purpose.length).toBeGreaterThan(10);
      expect(persona.skills).toContain("read");
      expect(persona.limits.maxMonthUsd).toBeLessThanOrEqual(0.1);
    }
    const store = new PersonaStore(join(dir, "catalog.sqlite"));
    const noon = new Date("2026-11-08T12:00:00Z");
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon)).toEqual([]);
    // Switched on: it wakes at once, the same day.
    store.setEnabled("weekly-recap", true);
    store.setEnabled("ideas-digest", true);
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon).map((p) => p.id)).toEqual(["weekly-recap", "ideas-digest"]);
    // All of them together stay within the $1 for personas.
    expect(BUILT_IN_PERSONAS.reduce((sum, p) => sum + p.limits.maxMonthUsd, 0)).toBeLessThanOrEqual(1);
  });

  it("keeps the weekly recap on for an account that used helpers before it went off by default (E23-A2)", () => {
    const at = (iso: string) => () => new Date(iso);
    const earlier = new PersonaStore(join(dir, "earlier.sqlite"), at("2026-11-09T12:00:00Z"));
    earlier.setEnabled("open-loops", true);
    expect(earlier.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE)).toBe(true);
    expect(earlier.enabled("weekly-recap")).toBe(true);
    const ran = new PersonaStore(join(dir, "ran.sqlite"), at("2026-11-08T03:00:00Z"));
    ran.start("weekly-recap", "schedule", "week:2026-11-08");
    expect(ran.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE)).toBe(true);
    // A choice the user made stays as it is.
    const chose = new PersonaStore(join(dir, "chose.sqlite"), at("2026-11-09T12:00:00Z"));
    chose.setEnabled("weekly-recap", false);
    expect(chose.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    expect(chose.enabled("weekly-recap")).toBe(false);
    // A new account, or one whose first helper came later, starts with it off.
    const fresh = new PersonaStore(join(dir, "fresh.sqlite"), at("2026-11-12T12:00:00Z"));
    expect(fresh.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    fresh.setEnabled("open-loops", true);
    expect(fresh.keepOnIfUsedBefore("weekly-recap", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    expect(personaEnabled(fresh, WEEKLY_RECAP)).toBe(false);
  });

  it("keeps a cadence per persona: every 3 days runs once per 3-day period, the switch untouched", async () => {
    const store = new PersonaStore(join(dir, "cadence.sqlite"));
    store.setCadence("open-loops", { every: "days", days: 3 }, false);
    expect(store.enabled("open-loops")).toBe(false);
    const view = personaView(OPEN_LOOPS, store, new Date("2026-11-08T12:00:00Z"));
    expect(view).toMatchObject({ schedule: "Every 3 days, at night", enabled: false, nextWakeAt: null });
    store.setEnabled("open-loops", true);
    expect(store.cadence("open-loops")).toEqual({ every: "days", days: 3 });
    const a = personaPeriodKey(OPEN_LOOPS, new Date("2026-11-08T03:00:00Z"), { every: "days", days: 3 });
    const b = personaPeriodKey(OPEN_LOOPS, new Date("2026-11-09T03:00:00Z"), { every: "days", days: 3 });
    const c = personaPeriodKey(OPEN_LOOPS, new Date("2026-11-11T03:00:00Z"), { every: "days", days: 3 });
    expect(new Set([a, b, c]).size).toBe(2);
    expect(a.startsWith("days3:")).toBe(true);
    store.start("open-loops", "schedule", a);
    const next = personaView(OPEN_LOOPS, store, new Date("2026-11-08T03:30:00Z")).nextWakeAt!;
    expect(Date.parse(next)).toBeGreaterThan(Date.parse("2026-11-08T03:30:00Z"));
    expect(next.endsWith("T02:00:00.000Z")).toBe(true);
  });

  it("Open loops finder asks about the top loop in the inbox; a persona without a skill cannot use it", async () => {
    const stub = stubModel(JSON.stringify({ loops: [{ title: "Book the dentist", sources: [1] }, { title: "Renew the boat insurance", sources: [2] }] }));
    const { deps: d, written, inbox } = deps({ model: () => stub.model });
    expect(await runPersona(OPEN_LOOPS, d, "manual")).toMatchObject({ status: "done", modelCalls: 1, summary: "Read 2 memories, found 2 open loops and asked about one" });
    expect(written[0]!.personaId).toBe("open-loops");
    expect(written[0]!.files[0]!.content).toContain("- Renew the boat insurance");
    expect(inbox.list()[0]).toMatchObject({ kind: "question", from: "Open loops finder", title: "Is this still open? Book the dentist" });

    // Ideas digest has no "ask" skill: a question from it fails the run, nothing reaches the inbox.
    const sneaky: PersonaDefinition = { ...IDEAS_DIGEST, id: "sneaky", async run(ctx) { ctx.postQuestion({ title: "?", options: [{ id: "a", label: "A" }] }); return { summary: "" }; } };
    const e = deps({ model: () => stubModel().model });
    e.deps.store = new PersonaStore(join(dir, "sneaky.sqlite"));
    expect(await runPersona(sneaky, e.deps, "manual")).toMatchObject({ status: "failed", summary: 'Failed: It does not have the skill "Ask you a question"' });
  });

  it("People and follow-ups and Ideas digest post one finding each", async () => {
    const people = deps({ model: () => stubModel(JSON.stringify({ people: [{ name: "Ana", followUp: "", sources: [] }, { name: "Marc", followUp: "Send him the photos", sources: [2] }] })).model });
    expect(await runPersona(PEOPLE_FOLLOW_UPS, people.deps, "manual")).toMatchObject({ status: "done" });
    expect(people.inbox.list()[0]).toMatchObject({ kind: "finding", from: "People and follow-ups", title: "Marc: Send him the photos" });

    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const ideas = deps({ model: () => stubModel(JSON.stringify({ ideas: [{ title: "A shed for the bikes", sources: [1] }] })).model });
    expect(await runPersona(IDEAS_DIGEST, ideas.deps, "manual")).toMatchObject({ status: "done" });
    expect(ideas.inbox.list()[0]!.title).toBe("1 ideas this fortnight. Most on your mind: A shed for the bikes");
  });

  it("Something to try posts one thing to try from his voice notes, with the notes it came from, and never repeats yesterday's (S38)", async () => {
    const voice = (n: number, day: string, words: string): MemoryEntry => ({ ...entry(n, day, `Voice note "a${n}.ogg" ingested`), contentType: "voice_note", content: `Voice note "a${n}.ogg" ingested through Zenod media seam.\nSource: WhatsApp voice note\n\n${words}` });
    const entries = [voice(1, "2026-11-07", "I keep sleeping badly before the long rides."), entry(2, "2026-11-07", "Buy milk"), voice(3, "2026-11-06", "The ride on Sunday wrecked me again.")];
    const reply = JSON.stringify({ try: { title: "Try a short walk instead of the screen in the hour before bed on Saturday.", why: "You said twice that you sleep badly before the long rides.", sources: [1, 2] } });
    const stub = stubModel(reply);
    const { deps: d, inbox, written } = deps({ model: () => stub.model, entries, now: () => new Date("2026-11-08T03:00:00Z") });
    expect(await runPersona(SOMETHING_TO_TRY, d, "manual")).toMatchObject({ status: "done", modelCalls: 1, summary: "Read 2 notes and posted one thing to try" });
    // Voice notes first: the typed note is left out when there are voice notes, and the header is gone.
    expect(stub.calls[0]!.prompt).toContain("I keep sleeping badly");
    expect(stub.calls[0]!.prompt).not.toContain("Buy milk");
    expect(stub.calls[0]!.prompt).not.toContain("ingested through");
    expect(stub.calls[0]!.system).toContain("Never suggest a task");
    const card = inbox.list()[0]!;
    expect(card).toMatchObject({ kind: "finding", from: "Something to try", title: "Try a short walk instead of the screen in the hour before bed on Saturday.", body: "You said twice that you sleep badly before the long rides." });
    expect(card.links.map((l) => l.path)).toEqual(["Log/2026-11-07.md", "Log/2026-11-06.md", "Personas/something-to-try/2026-11-08.md"]);
    expect(written[0]!.files[0]!.content).toContain("## Try\n\nTry a short walk");

    // The next day it reads what it offered yesterday and is told to suggest something different.
    const memory = { ...fakeMemory(entries), async get(path: string) {
      if (path === "Personas/something-to-try/2026-11-08.md") return { path, frontmatter: {}, body: written[0]!.files[0]!.content, url: "", provider: "github" as const };
      throw new Error("no note");
    } };
    const next = stubModel(JSON.stringify({ try: null }));
    const again = deps({ model: () => next.model, entries, memory, now: () => new Date("2026-11-09T03:00:00Z") });
    expect(await runPersona(SOMETHING_TO_TRY, again.deps, "manual")).toMatchObject({ status: "done", summary: "Read 2 notes, nothing to try" });
    expect(next.calls[0]!.prompt).toContain("Suggest something different:\n- Try a short walk instead of the screen in the hour before bed on Saturday.");

    // Project work never reaches the inbox.
    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const work = deps({ entries, model: () => stubModel(JSON.stringify({ try: { title: "Try closing three tickets before lunch.", why: "", sources: [1] } })).model });
    expect(await runPersona(SOMETHING_TO_TRY, work.deps, "manual")).toMatchObject({ status: "done", summary: "Read 2 notes, nothing to try; left out one idea about project work" });
    expect(work.inbox.list()).toHaveLength(0);
  });

  it("Something to try says it in the helpers' card: what you keep saying, the thing to try, why yes and why not (S36)", async () => {
    const entries = [entry(1, "2026-11-07", "Slept badly before the long ride"), entry(2, "2026-11-06", "Sunday ride wrecked me")];
    const reply = JSON.stringify({ try: {
      title: "Try a short walk instead of the screen in the hour before bed on Saturday.", short: "a walk before bed", topic: "sleeping badly before rides",
      why: "Memory 1 and memory 2 both say the night before a ride goes badly.", whyNot: "If the rides are what tire you, a walk may change little.", sources: [1, 2] } });
    const { deps: d, inbox, written } = deps({ model: () => stubModel(reply).model, entries, now: () => new Date("2026-11-08T03:00:00Z") });
    await runPersona(SOMETHING_TO_TRY, d, "manual");
    const card = inbox.list()[0]!;
    expect(card).toMatchObject({ kind: "finding", title: "Try a short walk instead of the screen in the hour before bed on Saturday.", body: null });
    expect(card.card).toMatchObject({
      picture: { change: "try", from: "sleeping badly before rides", to: "a walk before bed" },
      no: "If the rides are what tire you, a walk may change little.",
    });
    expect(card.card!.yes).toMatch(/^Your note ".+" and your note ".+" both say/);
    expect(written[0]!.files[0]!.content).toContain("Why not: If the rides are what tire you");
  });

  it("Something to try is off for a new account and on for an account that used helpers before (S38)", () => {
    expect(SOMETHING_TO_TRY.defaultEnabled).toBe(false);
    const fresh = new PersonaStore(join(dir, "fresh.sqlite"));
    expect(fresh.keepOnIfUsedBefore("something-to-try", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    expect(fresh.enabled("something-to-try")).toBeNull();
    const owner = new PersonaStore(join(dir, "owner.sqlite"), () => new Date("2026-11-05T03:00:00Z"));
    owner.setEnabled("open-loops", true);
    expect(owner.keepOnIfUsedBefore("something-to-try", WEEKLY_RECAP_OFF_SINCE)).toBe(true);
    expect(owner.enabled("something-to-try")).toBe(true);
    // His later choice stands.
    owner.setEnabled("something-to-try", false);
    expect(owner.keepOnIfUsedBefore("something-to-try", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    expect(owner.enabled("something-to-try")).toBe(false);
  });

  it("Patterns and ideas names one pattern gently with one idea research supports, as a why yes, why not card (S41)", async () => {
    const voice = (n: number, day: string, words: string): MemoryEntry => ({ ...entry(n, day, `Voice note "p${n}.ogg" ingested`), contentType: "voice_note", content: `Voice note "p${n}.ogg" ingested through Zenod media seam.\nSource: WhatsApp voice note\n\n${words}` });
    const entries = [
      voice(1, "2026-11-07", "Lying awake again going over the launch."),
      voice(2, "2026-11-04", "I keep replaying the call with the bank at night."),
      entry(3, "2026-11-03", "Buy milk"),
      voice(4, "2026-10-30", "Same thing, my head runs through tomorrow when I try to sleep."),
    ];
    const pattern = { noticed: "Your worries seem to visit at bedtime, when you try to sleep.", topic: "plans at bedtime", idea: "Try writing tomorrow's worries on paper for ten minutes in the early evening.", known: "a worry window", source: "Studied by Borkovec and colleagues in the 1980s.", yes: "It gives the thoughts a time and place that is not your pillow.", no: "If the evenings are already full, it may feel like one more chore.", sources: [1, 2, 3] };
    const stub = stubModel(JSON.stringify({ pattern }));
    const { deps: d, inbox, written } = deps({ model: () => stub.model, entries, now: () => new Date("2026-11-08T03:00:00Z") });
    expect(await runPersona(PATTERNS_AND_IDEAS, d, "manual")).toMatchObject({ status: "done", modelCalls: 1, summary: "Read 3 notes and offered one idea" });
    // Voice notes first, two weeks back; it is told to stay gentle and quiet on distress.
    expect(stub.calls[0]!.prompt).toContain("my head runs through tomorrow");
    expect(stub.calls[0]!.prompt).not.toContain("Buy milk");
    expect(stub.calls[0]!.system).toContain("Never diagnose");
    expect(stub.calls[0]!.system).toContain("real distress");
    const card = inbox.list()[0]!;
    expect(card).toMatchObject({ kind: "finding", from: "Patterns and ideas", title: pattern.idea, body: `${pattern.noticed}\n\nKnown as a worry window. ${pattern.source}`, card: { picture: { change: "try", from: "plans at bedtime", to: "a worry window" }, yes: pattern.yes, no: pattern.no } });
    expect(card.links.map((l) => l.path)).toEqual(["Log/2026-11-07.md", "Log/2026-11-04.md", "Log/2026-10-30.md", "Personas/patterns-and-ideas/2026-11-08.md"]);
    expect(written[0]!.files[0]!.content).toContain("## Idea\n\nTry writing tomorrow's worries");

    // The next day it waits: at most one card every few days, even when run by hand.
    const memory = { ...fakeMemory(entries), async get(path: string) {
      if (path === "Personas/patterns-and-ideas/2026-11-08.md") return { path, frontmatter: {}, body: written[0]!.files[0]!.content, url: "", provider: "github" as const };
      throw new Error("no note");
    } };
    const soon = stubModel(JSON.stringify({ pattern }));
    const next = deps({ model: () => soon.model, entries, memory, now: () => new Date("2026-11-09T03:00:00Z") });
    expect(await runPersona(PATTERNS_AND_IDEAS, next.deps, "manual")).toMatchObject({ status: "done", summary: "Posted a card 1 day ago, waits" });
    expect(soon.calls).toHaveLength(0);
    // Three days on it reads again and is told to offer a different idea.
    const later = stubModel(JSON.stringify({ pattern: null }));
    const again = deps({ model: () => later.model, entries, memory, now: () => new Date("2026-11-11T03:00:00Z") });
    expect(await runPersona(PATTERNS_AND_IDEAS, again.deps, "manual")).toMatchObject({ status: "done", summary: "Read 3 notes, no pattern" });
    expect(later.calls[0]!.prompt).toContain("Offer a different one:\n- Try writing tomorrow's worries");
  });

  it("Patterns and ideas stays quiet on distress and leaves out clinical words (S41)", async () => {
    const voice = (n: number, day: string, words: string): MemoryEntry => ({ ...entry(n, day, `Voice note "q${n}.ogg" ingested`), contentType: "voice_note", content: words });
    const hard = [voice(1, "2026-11-07", "Some days it feels hopeless."), voice(2, "2026-11-05", "Busy week."), voice(3, "2026-11-04", "Long ride.")];
    const quiet = stubModel(JSON.stringify({ pattern: null }));
    const one = deps({ model: () => quiet.model, entries: hard });
    expect(await runPersona(PATTERNS_AND_IDEAS, one.deps, "manual")).toMatchObject({ status: "done", summary: "Read 3 notes, stayed quiet" });
    expect(quiet.calls).toHaveLength(0);
    expect(one.inbox.list()).toHaveLength(0);
    expect(one.written[0]!.files[0]!.content).not.toContain("hopeless");

    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const calm = [voice(1, "2026-11-07", "Lying awake again."), voice(2, "2026-11-05", "Awake at 3am."), voice(3, "2026-11-04", "Bad sleep.")];
    const clinical = { noticed: "This looks like an anxiety pattern.", idea: "Try a breathing exercise.", known: "box breathing", source: "Used widely.", yes: "Calming.", no: "Takes practice.", sources: [1, 2] };
    const two = deps({ entries: calm, model: () => stubModel(JSON.stringify({ pattern: clinical })).model });
    expect(await runPersona(PATTERNS_AND_IDEAS, two.deps, "manual")).toMatchObject({ status: "done", summary: "Read 3 notes, no pattern; left out one because the words were too clinical" });
    expect(two.inbox.list()).toHaveLength(0);
  });

  it("Patterns and ideas is off for a new account and on for an account that used helpers before (S41)", () => {
    expect(PATTERNS_AND_IDEAS.defaultEnabled).toBe(false);
    expect(PATTERNS_AND_IDEAS.schedule).toEqual({ every: "days", days: 3 });
    const fresh = new PersonaStore(join(dir, "fresh.sqlite"));
    expect(fresh.keepOnIfUsedBefore("patterns-and-ideas", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    const owner = new PersonaStore(join(dir, "owner.sqlite"), () => new Date("2026-11-05T03:00:00Z"));
    owner.setEnabled("open-loops", true);
    expect(owner.keepOnIfUsedBefore("patterns-and-ideas", WEEKLY_RECAP_OFF_SINCE)).toBe(true);
    owner.setEnabled("patterns-and-ideas", false);
    expect(owner.keepOnIfUsedBefore("patterns-and-ideas", WEEKLY_RECAP_OFF_SINCE)).toBe(false);
    expect(owner.enabled("patterns-and-ideas")).toBe(false);
  });

  it("Topic gardener suggests one tidy-up as a suggestion card and changes nothing itself (S27)", async () => {
    const reply = JSON.stringify({ looked: "Home and Garden", suggestion: { title: "Boiler is filed under Garden", why: "Every boiler note is about the flat.", action: "Move Boiler under Home.", sources: [1] } });
    const stub = stubModel(reply);
    const { deps: d, inbox, written } = deps({ model: () => stub.model, outline: OUTLINE });
    expect(await runPersona(TOPIC_GARDENER, d, "manual")).toMatchObject({ status: "done", summary: "Read 2 memories and suggested one tidy-up" });
    const card = inbox.list()[0]!;
    expect(card).toMatchObject({ kind: "suggestion", status: "open", from: "Topic gardener", title: "Boiler is filed under Garden", body: "Every boiler note is about the flat.", action: "Move Boiler under Home." });
    expect(card.links.map((l) => l.path)).toEqual(["Log/2026-11-07.md", "Personas/topic-gardener/2026-11-08.md"]);
    expect(written[0]!.files[0]!.content).toContain("Proposed: Move Boiler under Home.");
    // It saw the tree and what the desk can do.
    expect(stub.calls[0]!.prompt).toContain("- Home: The flat and its repairs.");
    expect(stub.calls[0]!.prompt).toContain("  - Boiler");
    expect(stub.calls[0]!.system).toContain("The memory desk can do only these changes");
    // Without a tree there is nothing a desk job could change: no suggestion is asked for, no card.
    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const bare = stubModel(reply);
    const none = deps({ model: () => bare.model });
    expect(await runPersona(TOPIC_GARDENER, none.deps, "manual")).toMatchObject({ status: "done", summary: "Read 2 memories, nothing to tidy" });
    expect(bare.calls[0]!.prompt).not.toContain('"suggestion"');
    expect(none.inbox.list()).toHaveLength(0);
  });

  it("a new link reads the way Jordi asked: the two ideas, why yes, why not, never a memory's number (S36)", async () => {
    const reply = JSON.stringify({ looked: "Home", suggestion: {
      title: "Link memory 1 to Home", action: "Link Boiler to Home so each shows the other.",
      picture: { change: "link", from: "Boiler", to: "Home" },
      yes: "Memory 1 is about the flat's boiler, and Home is where the flat lives.",
      no: "Boiler already sits under Home, so the link may add little.", sources: [1] } });
    const stub = stubModel(reply);
    const { deps: d, inbox, written } = deps({ model: () => stub.model, outline: OUTLINE });
    await runPersona(TOPIC_GARDENER, d, "manual");
    const card = inbox.list()[0]!;
    expect(card).toMatchObject({ kind: "suggestion", title: 'I\'d link "Boiler" with "Home".', body: null, action: "Link Boiler to Home so each shows the other." });
    expect(card.card).toEqual({
      picture: { change: "link", from: "Boiler", to: "Home" },
      yes: expect.stringMatching(/^Your note ".+" is about the flat's boiler/),
      no: "Boiler already sits under Home, so the link may add little.",
    });
    expect(card.card!.yes).not.toMatch(/memory 1/i);
    expect(written[0]!.files[0]!.content).toContain("- Why not: Boiler already sits under Home, so the link may add little.");
    expect(written[0]!.files[0]!.content).toContain("- Picture: Boiler, new link, Home");
    // The model is asked for the picture and both reasons, in plain words.
    expect(stub.calls[0]!.prompt).toContain('"picture"');
    expect(stub.calls[0]!.prompt).toContain('"no"');
    expect(stub.calls[0]!.system).toContain("never by a number");
  });

  it("a suggestion without why not keeps the old card, and Health's filing card says both sides (S36)", async () => {
    const reply = JSON.stringify({ looked: "Home", suggestion: { title: "Boiler is filed under Garden", why: "Every boiler note is about the flat.", action: "Move Boiler under Home.", picture: { change: "move", from: "Boiler", to: "Home" }, sources: [1] } });
    const { deps: d, inbox } = deps({ model: () => stubModel(reply).model, outline: OUTLINE });
    await runPersona(TOPIC_GARDENER, d, "manual");
    expect(inbox.list()[0]).toMatchObject({ title: "Boiler is filed under Garden", body: "Every boiler note is about the flat.", card: null });
    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const health = deps({ outline: OUTLINE });
    await runPersona(MEMORY_HEALTH, health.deps, "manual");
    const filing = health.inbox.list()[0]!;
    expect(filing.kind).toBe("suggestion");
    expect(filing.card).toMatchObject({ picture: null, yes: expect.stringContaining("harder to find"), no: expect.stringContaining("Undo puts it back") });
  });

  it("the helpers post at most one suggestion a run, never the same waiting change twice, and read what became of earlier ones (S27)", async () => {
    let clock = new Date("2026-11-08T03:00:00Z");
    const reply = JSON.stringify({ loops: [{ title: "Book the dentist", sources: [1] }], suggestion: { title: "Link the dentist notes", why: "Both say next week.", action: "Link Dentist to Home.", sources: [1, 2] } });
    const stub = stubModel(reply);
    const { deps: d, inbox } = deps({ model: () => stub.model, outline: OUTLINE, now: () => clock });
    expect(await runPersona(OPEN_LOOPS, d, "manual")).toMatchObject({ status: "done", summary: "Read 2 memories, found 1 open loops and suggested one change" });
    expect(inbox.list().map((item) => item.kind)).toEqual(["suggestion"]);
    // Again, the same change still waiting: no second card.
    clock = new Date("2026-11-08T04:00:00Z");
    await runPersona(OPEN_LOOPS, d, "manual");
    expect(inbox.list()).toHaveLength(1);
    expect(stub.calls[1]!.prompt).toContain("- waiting: Link Dentist to Home.");
    // Not now with a reason: the next run sees it as an earlier suggestion and in its system words.
    inbox.declineSuggestion(inbox.list()[0]!.id, "Dentist is not about the flat");
    clock = new Date("2026-11-08T05:00:00Z");
    await runPersona(OPEN_LOOPS, d, "manual");
    expect(stub.calls[2]!.prompt).toContain("- not now (Dentist is not about the flat): Link Dentist to Home.");
    expect(stub.calls[2]!.system).toContain("Not now: Dentist is not about the flat");
    // A helper that tries two suggestions in one run is stopped at the first.
    const greedy: PersonaDefinition = {
      ...OPEN_LOOPS, id: "greedy", name: "Greedy",
      async run(ctx) {
        ctx.postSuggestion({ title: "One", action: "Move Boiler under Home." });
        ctx.postSuggestion({ title: "Two", action: "Rename Garden to Allotment." });
        return { summary: "two" };
      },
    };
    expect(await runPersona(greedy, d, "manual")).toMatchObject({ status: "capped", summary: "Stopped at one suggestion a run" });
    expect(inbox.list().filter((item) => item.from === "Greedy").map((item) => item.title)).toEqual(["One"]);
  });

  it("People and follow-ups and Ideas digest each offer one change when the tree allows it (S27)", async () => {
    const people = deps({ outline: OUTLINE, model: () => stubModel(JSON.stringify({ people: [{ name: "Ana", followUp: "Send her the notebook", sources: [1] }], suggestion: { title: "Ana keeps coming up", why: "Three notes about her this fortnight.", action: "Link the notebook note to Ana.", sources: [1] } })).model });
    expect(await runPersona(PEOPLE_FOLLOW_UPS, people.deps, "manual")).toMatchObject({ status: "done", summary: "Read 2 memories, 1 people, suggested one change" });
    expect(people.inbox.list()[0]).toMatchObject({ kind: "suggestion", from: "People and follow-ups", action: "Link the notebook note to Ana." });

    rmSync(join(dir, "inbox.sqlite"), { force: true });
    rmSync(join(dir, "personas.sqlite"), { force: true });
    const ideas = deps({ outline: OUTLINE, model: () => stubModel(JSON.stringify({ ideas: [{ title: "A shed for the bikes", sources: [1] }], suggestion: { title: "The shed has come up three times", why: "", action: "Give Shed its own place.", sources: [1] } })).model });
    expect(await runPersona(IDEAS_DIGEST, ideas.deps, "manual")).toMatchObject({ status: "done" });
    expect(ideas.inbox.list()[0]).toMatchObject({ kind: "suggestion", from: "Ideas digest", action: "Give Shed its own place." });
    expect(ideas.inbox.list()[0]!.body).toBeNull();
  });

  it("Health of your memory suggests filing loose pages, by name, with no model call (S27)", async () => {
    const noModel = () => { throw new Error("no model for this persona"); };
    const { deps: d, inbox, written } = deps({ model: noModel, outline: OUTLINE });
    expect(await runPersona(MEMORY_HEALTH, d, "manual")).toMatchObject({ status: "done", modelCalls: 0, costUsd: 0, summary: "Counted 2 memories and 4 loose pages, suggested filing them" });
    expect(written[0]!.files[0]!.content).toContain("- Pages under no place in the tree: 4");
    expect(inbox.list()[0]).toMatchObject({
      kind: "suggestion", from: "Health of your memory", title: "4 pages in your memory are not under any place yet.",
      action: 'Move these pages, which are under no place in the tree yet, each under the place it belongs to: "Dentist", "Compost", "Ana", "Shed".',
    });
  });

  it("Health of your memory makes no model call and posts only when saving has gone quiet", async () => {
    const noModel = () => { throw new Error("no model for this persona"); };
    const quiet = deps({ entries: fourWeeks, model: noModel });
    const run = await runPersona(MEMORY_HEALTH, quiet.deps, "manual");
    expect(run).toMatchObject({ status: "done", modelCalls: 0, costUsd: 0 });
    expect(quiet.written[0]!.files[0]!.content).toContain("- Saved this week: 1, the three weeks before: 4, 5, 6");
    expect(quiet.inbox.list()[0]!.title).toBe("You saved 1 memories this week, against about 5 a week before.");

    const calm = deps({ model: noModel });
    calm.deps.store = new PersonaStore(join(dir, "calm.sqlite"));
    calm.deps.inbox = new InboxStore(join(dir, "calm-inbox.sqlite"));
    expect(await runPersona(MEMORY_HEALTH, calm.deps, "manual")).toMatchObject({ status: "done", summary: "Counted 2 memories, all looks normal" });
    expect(calm.deps.inbox.list()).toHaveLength(0);
  });

  // S27 round 2: Jordi, 2026-11-10: "His job should be to work on the memory, and the memory is not the repos, it's my memory."
  describe("the helpers keep to the memory, never project work (S27 round 2)", () => {
    const record = (n: number, title: string): MemoryEntry => ({ ...entry(n, "2026-11-07", title), source: "mcp", contentType: "text" });

    it("tells a work-tracking record an agent saved from what the person said", () => {
      expect(isTeamRecord(record(1, "agent_team E84-S17 (2026-11-10, in review): hero journey"))).toBe(true);
      expect(isTeamRecord(record(2, "deal-funnels: EPIC-1 stamped ready"))).toBe(true);
      expect(isTeamRecord(record(3, "Jordi to give budget for the trip (open ask E0-A1)"))).toBe(true);
      // Typed in by the person over MCP with no work code, a voice note, or a WhatsApp message: theirs.
      expect(isTeamRecord(record(4, "Remember Ana's birthday is on the 12th"))).toBe(false);
      expect(isTeamRecord({ ...record(5, "EpicTeam card answer E14-S27"), contentType: "voice_note" })).toBe(false);
      expect(isTeamRecord({ ...entry(6, "2026-11-07", "E14-S27 looks good"), source: "whatsapp" })).toBe(false);
      expect(isProjectWork("Dispatch the next ticket")).toBe(true);
      expect(isProjectWork("Move the notes under Launching Epic Social")).toBe(false);
      expect(isProjectWork("Link the dentist note to Health")).toBe(false);
    });

    it("leave out agents' project records, say memory only, and drop a suggestion about project work", async () => {
      const entries = [entry(1, "2026-11-07", "Call mum about Sunday"), record(2, "market-bots E1-S1 (2026-11-10): airdrop angles researched"), entry(3, "2026-11-06", "Dentist next week")];
      const reply = JSON.stringify({ loops: [{ title: "Call mum about Sunday", sources: [1] }, { title: "Answer ask E0-A1 on the hair project", sources: [2] }], suggestion: { title: "Close the open ask E0-A1", why: "No later memory answers it.", action: "Link the hair_flow EPIC-1 memory to Zenod.", sources: [1] } });
      const stub = stubModel(reply);
      const { deps: d, inbox, written } = deps({ model: () => stub.model, outline: OUTLINE, entries });
      const run = await runPersona(OPEN_LOOPS, d, "manual");
      expect(run!.summary).toBe("Read 2 memories, found 1 open loops and asked about one; left out one suggestion about project work");
      expect(stub.calls[0]!.prompt).not.toContain("market-bots");
      expect(stub.calls[0]!.system).toContain("You are not a project manager");
      expect(inbox.list().map((item) => item.kind)).toEqual(["question"]);
      expect(inbox.list()[0]!.title).toBe("Is this still open? Call mum about Sunday");
      const note = written[0]!.files[0]!.content;
      expect(note).not.toContain("E0-A1");
      expect(note).toContain("_This run: 1 AI call, 1200 / 90 tokens, $0.00040._");
      // Weekly recap's finding about project work is left out too; its recap lines stay.
      rmSync(join(dir, "inbox.sqlite"), { force: true });
      rmSync(join(dir, "personas.sqlite"), { force: true });
      const recap = stubModel(JSON.stringify({ recap: ["You called mum."], finding: { title: "Dispatch the next ticket on EPIC-14", detail: "", sources: [1] } }));
      const r = deps({ model: () => recap.model, entries });
      expect(await runPersona(WEEKLY_RECAP, r.deps, "manual")).toMatchObject({ summary: "Read 2 memories and wrote a recap, no finding" });
      expect(r.inbox.list()).toHaveLength(0);
    });

    it("put away the earlier project suggestions once, as Not now with a reason, and Bring it back undoes it", () => {
      const inbox = new InboxStore(join(dir, "scope-inbox.sqlite"), () => new Date("2026-11-10T01:40:00Z"));
      const project = inbox.post({ kind: "suggestion", from: "Open loops finder", title: "The hair project waits on ask E0-A1", action: "Link the hair_flow EPIC-1 memory to Zenod." });
      const memory = inbox.post({ kind: "suggestion", from: "Topic gardener", title: "Voice notes deserve their own place", action: "Give the voice-note pages their own place." });
      const other = inbox.post({ kind: "suggestion", from: "Memory desk", title: "Deploy notes", action: "Link EPIC-2 to EPIC-3." });
      const helpers = BUILT_IN_PERSONAS.map((p) => p.name);
      expect(putAwayProjectSuggestions(inbox, helpers)).toBe(1);
      expect(inbox.get(project.id)).toMatchObject({ status: "declined" });
      expect(inbox.get(project.id)!.replies[0]).toMatchObject({ kind: "notnow", text: OUT_OF_SCOPE_REASON });
      expect(inbox.get(memory.id)).toMatchObject({ status: "open" });
      expect(inbox.get(other.id)).toMatchObject({ status: "open" });
      // Bring it back: open again, the reason kept, and never put away a second time.
      expect(inbox.reopenSuggestion(project.id)).toMatchObject({ status: "open" });
      expect(putAwayProjectSuggestions(inbox, helpers)).toBe(0);
      expect(inbox.get(project.id)).toMatchObject({ status: "open" });
      expect(() => inbox.reopenSuggestion(memory.id)).toThrow(/only a suggestion put away/);
      // Cards posted after the helpers kept to the memory are not touched.
      expect(putAwayProjectSuggestions(inbox, helpers, "2026-11-10T01:00:00Z")).toBe(0);
    });
  });

  // S35: Jordi, closing S27: "The memory guy can ask ... questions to the team desk to see how things are connecting ... but not pick directly."
  describe("a helper may ask the Team desk one question a run, read only (S35)", () => {
    const QUESTION_REPLY = JSON.stringify({
      loops: [{ title: "Decide on the flat", sources: [1] }],
      suggestion: { title: "Link the flat notes", why: "Both are about the flat.", action: "Link Dentist to Home.", sources: [1] },
      teamQuestion: "Which of my plans does the flat decision connect to?",
    });
    const SECOND_REPLY = JSON.stringify({
      loops: [{ title: "Decide on the flat", sources: [1] }],
      suggestion: { title: "Link the flat notes", why: "Both are about the flat.", action: "Link Dentist to Home.", sources: [1] },
      usedTeamAnswer: true,
    });
    function twoReplies(first: string, second: string) {
      const calls: Array<{ system: string; prompt: string }> = [];
      const model: PersonaModel = {
        async complete(input) {
          calls.push(input);
          return { text: calls.length === 1 ? first : second, inputTokens: 1000, outputTokens: 80, costUsd: 0.0004 };
        },
      };
      return { calls, model };
    }
    function fakeTeam(answer: () => Promise<{ answer: string; refs: string[]; model: string; costUsd: number }>) {
      const asked: Array<{ question: string; helper: string; run: string }> = [];
      const team: TeamAsk = { async ask(input) { asked.push(input); return answer(); } };
      return { asked, team };
    }

    it("is off by default: no question asked for, no call to the team", async () => {
      const stub = stubModel(QUESTION_REPLY);
      const { asked, team } = fakeTeam(async () => ({ answer: "x", refs: [], model: "none", costUsd: 0 }));
      const { deps: d } = deps({ model: () => stub.model, outline: OUTLINE, teamAsk: team });
      const run = await runPersona(OPEN_LOOPS, d, "manual");
      expect(run).toMatchObject({ status: "done", modelCalls: 1 });
      expect(stub.calls[0]!.prompt).not.toContain("teamQuestion");
      expect(stub.calls[0]!.system).not.toContain("team desk ONE question");
      expect(asked).toHaveLength(0);
      expect(personaView(OPEN_LOOPS, d.store, new Date("2026-11-08T12:00:00Z")).askTeam).toBe(false);
      expect(personaView(WEEKLY_RECAP, d.store, new Date("2026-11-08T12:00:00Z")).askTeam).toBeNull();
    });

    it("switched on: asks once, uses the answer in a second call and says so on the card, cost counted", async () => {
      const stub = twoReplies(QUESTION_REPLY, SECOND_REPLY);
      const { asked, team } = fakeTeam(async () => ({ answer: "It connects to the milestone House decision, which is stuck.", refs: ["House decision"], model: "gpt-4o-mini", costUsd: 0.0007 }));
      const { deps: d, inbox, store, written } = deps({ model: () => stub.model, outline: OUTLINE, teamAsk: team });
      store.setAskTeam("open-loops", true, false);
      const run = await runPersona(OPEN_LOOPS, d, "manual");
      expect(run).toMatchObject({ status: "done", modelCalls: 2, summary: "Read 2 memories, found 1 open loops and suggested one change; asked the team one question and used the answer" });
      expect(run!.costUsd).toBeCloseTo(0.0015, 6);
      expect(run!.steps).toBeLessThanOrEqual(OPEN_LOOPS.limits.maxSteps);
      expect(asked).toEqual([{ question: "Which of my plans does the flat decision connect to?", helper: "open-loops", run: run!.id }]);
      expect(stub.calls[0]!.prompt).toContain('"teamQuestion"');
      expect(stub.calls[0]!.system).toContain("ask the person's team desk ONE question");
      expect(stub.calls[1]!.prompt).toContain("Answer: It connects to the milestone House decision, which is stuck. (about: House decision)");
      expect(stub.calls[1]!.prompt).not.toContain('"teamQuestion"');
      const card = inbox.list()[0]!;
      expect(card.kind).toBe("suggestion");
      expect(card.body).toContain("Asked the team: Which of my plans does the flat decision connect to? They said: It connects to the milestone House decision");
      expect(written[0]!.files[0]!.content).toContain("Asked the team:");
    });

    it("a refusal or a slow team never fails the run: it goes on without the answer", async () => {
      const stub = stubModel(QUESTION_REPLY);
      const { team } = fakeTeam(async () => { throw new Error("daily_cap"); });
      const { deps: d, inbox, store } = deps({ model: () => stub.model, outline: OUTLINE, teamAsk: team });
      store.setAskTeam("open-loops", true, false);
      const run = await runPersona(OPEN_LOOPS, d, "manual");
      expect(run).toMatchObject({ status: "done", modelCalls: 1, summary: "Read 2 memories, found 1 open loops and suggested one change; the team gave no answer" });
      expect(inbox.list()[0]!.body).not.toContain("Asked the team");
    });

    it("an answer the helper did not use stays off the card; a second question in one run is refused", async () => {
      const stub = twoReplies(QUESTION_REPLY, JSON.stringify({ ...JSON.parse(SECOND_REPLY), usedTeamAnswer: false }));
      const { asked, team } = fakeTeam(async () => ({ answer: "Nothing connects.", refs: [], model: "none", costUsd: 0 }));
      const greedy: PersonaDefinition = {
        ...OPEN_LOOPS,
        async run(ctx) {
          const first = await ctx.askTeam("Which plan does the flat connect to?");
          const second = await ctx.askTeam("And the garden?");
          return { summary: `${first ? "first" : "none"} ${second ? "second" : "none"}` };
        },
      };
      const { deps: d, inbox, store } = deps({ model: () => stub.model, outline: OUTLINE, teamAsk: team });
      store.setAskTeam("open-loops", true, false);
      await runPersona(OPEN_LOOPS, d, "manual");
      expect(inbox.list()[0]!.body).toBe("Both are about the flat.");
      expect((await runPersona(greedy, d, "manual"))!.summary).toBe("first none");
      expect(asked).toHaveLength(2);
    });

    it("switching it on wakes the helper once more, never switches it on, and only helpers that can ask may", async () => {
      // S36: after the helpers' last wake for their new cards (23:45Z).
      let now = new Date("2026-11-11T00:00:00Z");
      const { deps: d, store } = deps({ now: () => now });
      store.setEnabled("open-loops", true);
      store.start("open-loops", "schedule", "x");
      now = new Date("2026-11-11T00:05:00Z");
      expect(duePersonas([OPEN_LOOPS], store, now)).toHaveLength(0);
      store.setAskTeam("open-loops", true, false);
      expect(duePersonas([OPEN_LOOPS], store, now).map((p) => p.id)).toEqual(["open-loops"]);
      store.setAskTeam("people-follow-ups", true, false);
      expect(store.enabled("people-follow-ups")).toBe(false);
      expect(d.store.askTeam("people-follow-ups")).toBe(true);
      store.setAskTeam("people-follow-ups", false, false);
      expect(store.askTeam("people-follow-ups")).toBe(false);
    });
  });
});
