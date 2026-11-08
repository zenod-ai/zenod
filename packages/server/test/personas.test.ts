import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine, SqliteStateStore, VaultRepo, type BrainEngine, type BrainLlm, type MemoryEntry } from "zenod";
import { InboxStore } from "../src/inboxStore.js";
import { BUILT_IN_PERSONAS, memoryTitle, memoryWords, parseRecapReply, WEEKLY_RECAP } from "../src/personaCatalog.js";
import { registerPersonaRoutes } from "../src/personaRoutes.js";
import {
  duePersonas,
  nextPersonaWakeAt,
  personaPeriodKey,
  runPersona,
  type PersonaDefinition,
  type PersonaModel,
  type PersonaRunnerDeps,
} from "../src/personaRunner.js";
import { closePersonasFor, PersonaStore, personasFor } from "../src/personaStore.js";

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

function fakeMemory(entries: MemoryEntry[]) {
  return {
    async searchEntries(query: { capturedAfter?: string; limit?: number | null } = {}) {
      return entries.filter((e) => !query.capturedAfter || e.capturedAt >= query.capturedAfter).slice(0, query.limit ?? undefined);
    },
    async search() { return []; },
    async get(): Promise<never> { throw new Error("not in this test"); },
  };
}

function deps(over: Partial<PersonaRunnerDeps> & { entries?: MemoryEntry[]; model?: () => PersonaModel; now?: () => Date }) {
  const written: Array<{ personaId: string; files: Array<{ name: string; content: string }>; message: string }> = [];
  const inbox = new InboxStore(join(dir, "inbox.sqlite"));
  const store = new PersonaStore(join(dir, "personas.sqlite"), over.now);
  const base: PersonaRunnerDeps = {
    memory: fakeMemory(over.entries ?? [entry(1, "2026-11-07", "Dentist next week"), entry(2, "2026-11-04", "Call the dentist")]),
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
      ...WEEKLY_RECAP, id: "greedy", limits: { ...WEEKLY_RECAP.limits, maxSteps: 3 },
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
    expect(await runPersona(WEEKLY_RECAP, c.deps, "manual")).toMatchObject({ status: "capped", summary: "The personas' monthly budget is used up" });
    expect(stub.calls).toHaveLength(0);
  });

  it("does not start when the tenant's AI allowance is used up", async () => {
    const stub = stubModel();
    const { deps: d } = deps({ model: () => stub.model, aiAllowanceBlock: () => ({ message: "used up" }) });
    expect(await runPersona(WEEKLY_RECAP, d, "manual")).toMatchObject({ status: "skipped", summary: "The AI allowance for this month is used up" });
    expect(stub.calls).toHaveLength(0);
  });

  it("logs a persona's own error as a failed run instead of throwing", async () => {
    const broken: PersonaDefinition = { ...WEEKLY_RECAP, id: "broken", async run() { throw new Error("boom"); } };
    const { deps: d } = deps({});
    expect(await runPersona(broken, d, "manual")).toMatchObject({ status: "failed", summary: "Failed: boom" });
  });

  it("wakes a persona that is on and never ran at once, then only in the off-peak window, once per period", () => {
    const store = new PersonaStore(join(dir, "personas.sqlite"), () => new Date("2026-11-08T20:00:00Z"));
    const noon = new Date("2026-11-08T21:00:00Z");
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon).map((p) => p.id)).toEqual(["weekly-recap"]);
    const run = store.start("weekly-recap", "manual")!;
    store.finish(run.id, { status: "done", steps: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, summary: "", inboxItemIds: [], revision: null, fingerprint: "x" });
    expect(duePersonas(BUILT_IN_PERSONAS, store, noon)).toEqual([]);
    const night = new Date("2026-11-09T03:00:00Z");
    expect(duePersonas(BUILT_IN_PERSONAS, store, night).map((p) => p.id)).toEqual(["weekly-recap"]);
    store.start("weekly-recap", "schedule", personaPeriodKey(WEEKLY_RECAP, night));
    expect(duePersonas(BUILT_IN_PERSONAS, store, night)).toEqual([]);
    store.setEnabled("weekly-recap", false);
    expect(duePersonas(BUILT_IN_PERSONAS, store, new Date("2026-11-16T03:00:00Z"))).toEqual([]);
    expect(nextPersonaWakeAt({ every: "week" }, night, true).toISOString()).toBe("2026-11-15T02:00:00.000Z");
    expect(nextPersonaWakeAt({ every: "night" }, noon, false).toISOString()).toBe("2026-11-09T02:00:00.000Z");
  });

  it("wakes a revised persona once more at once, in its own period, even with nothing new", async () => {
    let clock = new Date("2026-11-08T12:00:00Z");
    const stub = stubModel();
    const { deps: d, store } = deps({ model: () => stub.model, now: () => clock });
    const v1: PersonaDefinition = { ...WEEKLY_RECAP, revisedAt: undefined };
    expect(duePersonas([v1], store, clock).length).toBe(1);
    expect(await runPersona(v1, d, "schedule")).toMatchObject({ status: "done", periodKey: "week:2026-11-08" });
    expect(duePersonas([v1], store, clock)).toEqual([]);
    clock = new Date("2026-11-08T20:00:00Z");
    const v2: PersonaDefinition = { ...WEEKLY_RECAP, revisedAt: "2026-11-08T19:30:00.000Z" };
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
      const first = await (await app.request("/api/console/personas")).json() as { personas: Array<{ id: string; enabled: boolean; lastRun: unknown; permissions: string[] }>; budget: { capUsd: number } };
      expect(first.personas.map((p) => [p.id, p.enabled, p.lastRun])).toEqual([["weekly-recap", true, null]]);
      expect(first.personas[0]!.permissions).toContain("Writes only into its own folder");
      expect(first.budget.capUsd).toBe(1);

      const ran = await (await app.request("/api/console/personas/weekly-recap/run", { method: "POST" })).json() as { run: { status: string }; personas: Array<{ lastRun: { summary: string } | null; budget: { totalUsd: number } }> };
      expect(ran.run.status).toBe("done");
      expect(ran.personas[0]!.lastRun?.summary).toBe("Read 4 memories");
      expect(ran.personas[0]!.budget.totalUsd).toBeCloseTo(0.0003);

      const off = await (await app.request("/api/console/personas/weekly-recap", { method: "POST", body: JSON.stringify({ enabled: false }), headers: { "content-type": "application/json" } })).json() as { personas: Array<{ enabled: boolean; nextWakeAt: string | null }> };
      expect(off.personas[0]).toMatchObject({ enabled: false, nextWakeAt: null });

      expect((await app.request("/api/console/personas/nobody/run", { method: "POST" })).status).toBe(404);
      expect((await app.request("/api/console/personas/weekly-recap", { method: "POST", body: "{}" })).status).toBe(400);
      signedIn = false;
      expect((await app.request("/api/console/personas")).status).toBe(401);
      expect(runtime.runs).toBe(1);
    } finally {
      closePersonasFor(runtime);
    }
  });
});
