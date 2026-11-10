import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { MemoryIndex } from "../src/vault/memoryIndex.js";
import { buildWeightedLinks } from "../src/vault/memoryWeights.js";
import { isVoiceCapture, recentIntent } from "../src/vault/recentIntent.js";
import { LAST_VOICE_NOTE_VAULT, LATEST_VOICE_NOTE, OLDER_VOICE_NOTE, UNLINKED_VOICE_NOTE } from "./fixtures/lastVoiceNoteVault.js";

// EPIC-12 S3c round 2: "what was in my last vn?" ranks the latest voice note first, then the pages
// it was filed into by their graph connection; no identical percents for unrelated tree roots.
const dirs: string[] = [];
const open: MemoryIndex[] = [];
afterEach(async () => {
  for (const index of open.splice(0)) index.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-11-08T07:30:00Z");

async function indexOf(files: Record<string, string>): Promise<MemoryIndex> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-recent-"));
  dirs.push(dir);
  const vault = join(dir, "vault");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
  const index = MemoryIndex.open({ path: join(dir, "index.sqlite"), vaultPath: vault, tenantId: "t", now: () => NOW });
  open.push(index);
  return index;
}

describe("recent-note intent", () => {
  it("reads time words next to a note word, and nothing else", () => {
    expect(recentIntent("what was in my last vn?", NOW)).toMatchObject({ window: { kind: "latest" }, voice: true, topic: "" });
    expect(recentIntent("What was my latest voice note about?", NOW)).toMatchObject({ voice: true, topic: "" });
    expect(recentIntent("yesterday's voice note", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-07" }, voice: true });
    expect(recentIntent("what did I say about the boat today", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-08" }, voice: false, topic: "boat" });
    expect(recentIntent("¿qué dije en mi última nota de voz?", NOW)).toMatchObject({ voice: true, topic: "" });
    expect(recentIntent("Porto boatyard quote", NOW)).toBeNull();
    expect(recentIntent("what did we decide last time about the notes", NOW)).toBeNull();
    expect(recentIntent("what is the latest on the cabin decision", NOW)).toBeNull();
  });

  it("reads a named day in English and Spanish, and whether one note or the whole day is asked (E12-S35)", () => {
    const day = (question: string) => recentIntent(question, NOW)?.window;
    for (const question of ["what did I send on November 6?", "what did I say on 6 Nov", "what did I say on the 6th?", "what did I send 2 days ago?",
      "what did I say the day before yesterday?", "¿qué mandé el 6 de noviembre?", "qué dije el día 6", "qué grabé anteayer", "¿qué envié hace 2 días?",
      "what did I say on 2026-11-06"]) {
      expect(day(question), question).toEqual({ kind: "day", date: "2026-11-06" });
    }
    expect(day("qué grabé el 1ro de noviembre")).toEqual({ kind: "day", date: "2026-11-01" });
    expect(day("qué mandé el viernes")).toEqual({ kind: "day", date: "2026-11-06" });
    expect(day("what did I say on December 6")).toEqual({ kind: "day", date: "2025-12-06" });
    expect(recentIntent("what did I say about the boat on the 2nd of November", NOW)).toMatchObject({ window: { date: "2026-11-02" }, topic: "boat" });
    expect(recentIntent("what did I send on November 6?", NOW)).toMatchObject({ topic: "", one: false });
    expect(recentIntent("what did I say in my voice notes yesterday?", NOW)).toMatchObject({ one: false });
    expect(recentIntent("what was in yesterday's vn?", NOW)).toMatchObject({ one: true });
    expect(recentIntent("¿qué dije en la nota de voz del 6 de noviembre?", NOW)).toMatchObject({ one: true });
  });

  it("knows a voice note by its content type, or by the words of an older entry", () => {
    expect(isVoiceCapture("voice_note", "x", "y")).toBe(true);
    expect(isVoiceCapture("audio/ogg", "x", "y")).toBe(true);
    expect(isVoiceCapture("text", "Voice note", "y")).toBe(false);
    expect(isVoiceCapture(null, 'Voice note "a.ogg" ingested through Zenod', "")).toBe(true);
  });

  it("weighs a page by how it is tied to the note, in the weighted graph (E18-W1)", () => {
    const note = "Log/2026-11-08.md#^e-000001";
    const strength = (ties: Parameters<typeof buildWeightedLinks>[0], to: string) =>
      buildWeightedLinks(ties, { now: NOW, noteTime: () => NOW }).find((link) => link.src === note && link.dst === to)!.strength;
    const both = strength([{ from: "A.md", to: note, kind: "cites" }, { from: note, to: "A.md", kind: "filed" }], "A.md");
    expect(both).toBeGreaterThan(strength([{ from: "A.md", to: note, kind: "cites" }], "A.md"));
    expect(strength([{ from: note, to: "A.md", kind: "filed", weight: 0.6 }], "A.md")).toBe(0.6);
    expect(both).toBeLessThanOrEqual(1);
  });
});

describe("what was in my last vn? (E12-S3c round 2)", { timeout: 30_000 }, () => {
  it("puts the latest voice note first, then the pages it was filed into, at their path strength", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("what was in my last vn?", 5);
    expect(hits[0]).toMatchObject({ path: LATEST_VOICE_NOTE, relation: "note", matchPercent: 100 });
    expect(hits[0]!.unlinked).toBeUndefined();
    expect(hits[0]!.unwritten).toBe(1); // Animations was planned and never written
    const filed = hits.slice(1).filter((hit) => hit.relation === "filed");
    expect(filed.map((hit) => hit.title).sort()).toEqual(["Brand identity", "Branded screenshots", "Explainer videos"]);
    for (const hit of filed) {
      expect(hit.via).toBe(LATEST_VOICE_NOTE);
      expect(hit.matchPercent).toBeGreaterThanOrEqual(80);
      expect(hit.matchPercent).toBeLessThan(100);
    }
    // The page whose lines repeat the most of the note leads; each shows the line the filing wrote.
    expect(filed.map((hit) => hit.title)).toEqual(["Explainer videos", "Branded screenshots", "Brand identity"]);
    expect(filed[1]!.snippet).toContain("polished and uncluttered");
    // Each percent is the note's times the path strength from the note in the weighted graph (E18-W1).
    for (const hit of filed) expect(hit.matchPercent).toBe(Math.round(100 * hit.pathStrength!));
    // Roots that only say "last" are gone; the agent report and the typed note are not voice notes.
    const titles = hits.map((hit) => hit.title);
    for (const root of ["Agent Team", "Hair transplant", "Travel", "EpicSpine"]) expect(titles).not.toContain(root);
    expect(hits.map((hit) => hit.path)).not.toContain("Log/2026-11-08.md#^e-a9e044");
    expect(hits.map((hit) => hit.path)).not.toContain("Log/2026-11-08.md#^e-c0ffee");
    // The ranked list reads top-down.
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.matchPercent).toBeLessThanOrEqual(hits[i - 1]!.matchPercent);
  });

  it("brings the parent topic and the older notes after the filed pages", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("what was in my last voice note", 10);
    const parent = hits.find((hit) => hit.relation === "parent" && hit.title === "Epic Social");
    expect(parent).toBeDefined();
    const older = hits.find((hit) => hit.path === OLDER_VOICE_NOTE);
    expect(older).toMatchObject({ relation: "note", matchPercent: 50 });
    expect(hits.find((hit) => hit.path === UNLINKED_VOICE_NOTE)).toMatchObject({ relation: "note", unlinked: true, matchPercent: 25 });
  });

  it("answers yesterday's and today's note questions by day, and a topic within the day", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    expect((await index.search("what was in yesterday's voice note?", 5))[0]).toMatchObject({ path: OLDER_VOICE_NOTE, relation: "note" });
    const travel = await index.search("what did I say yesterday", 5);
    expect(travel[0]!.path).toBe(OLDER_VOICE_NOTE);
    expect(travel.find((hit) => hit.title === "Travel")).toMatchObject({ relation: "filed" });
    const today = await index.search("what did I say about explainer videos today", 5);
    expect(today[0]).toMatchObject({ path: LATEST_VOICE_NOTE, relation: "note" });
  });

  it("lists every note of a day asked as a whole, the ones that say the most first (E12-S35)", async () => {
    const spoken = (time: string, anchor: string, words: string) => [
      `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}`, "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note", "",
      `> Voice note "${anchor}.ogg" ingested through Zenod media seam.`, "> Transcribed by demo transcriber.", ">", `> ${words}`, ""].join("\n");
    const long = (topic: string) => `${topic}. ${"We went over the plan step by step and agreed on what comes next. ".repeat(12)}`;
    const index = await indexOf({
      ...LAST_VOICE_NOTE_VAULT,
      "Log/2026-11-04.md": ["# 2026-11-04", "", spoken("07:00", "e-4a0001", long("A research ask on market entry days")),
        spoken("07:10", "e-4a0002", long("The landing pages need a visual for every benefit")),
        spoken("07:20", "e-4a0003", "Are you alive?"), spoken("07:21", "e-4a0004", "Are you alive now?"),
        spoken("07:30", "e-4a0005", "Short one about the gym."), spoken("07:40", "e-4a0006", "Another quick one about lunch."),
        "## 07:50 agent report  ^e-4a0007", "- source: agent:watcher", "", "An agent's report.", ""].join("\n"),
    });
    const hits = await index.search("what did I send on November 4?", 5);
    expect(hits.every((hit) => hit.relation === "note")).toBe(true);
    expect(hits.slice(0, 2).map((hit) => hit.path).sort()).toEqual(["Log/2026-11-04.md#^e-4a0001", "Log/2026-11-04.md#^e-4a0002"]);
    expect(hits.map((hit) => hit.path)).not.toContain("Log/2026-11-04.md#^e-4a0007");
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.matchPercent).toBeLessThanOrEqual(hits[i - 1]!.matchPercent);
    // One note of that day is still the newest one.
    expect((await index.search("what was in the voice note on November 4?", 5))[0]!.path).toBe("Log/2026-11-04.md#^e-4a0006");
  });

  it("keeps only the note's pages about the topic when the question names one", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("what did I say about explainer videos today", 5);
    expect(hits.map((hit) => hit.title)).toEqual(["Screenshots, demos and explainer videos", "Explainer videos"]);
  });

  it("brings the pages under a clear best hit ahead of pages that share only a word", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("tell me about Epic Social", 5);
    expect(hits[0]!.title).toBe("Epic Social");
    const children = hits.filter((hit) => hit.relation === "child");
    expect(children.map((hit) => [hit.title, hit.via])).toEqual([
      ["Branded screenshots", "Projects/Epic Social.md"],
      ["Explainer videos", "Projects/Epic Social.md"],
    ]);
    // EpicSpine and Epic Team share only the word "epic": they fall below Epic Social's own pages.
    const lastChild = hits.findLastIndex((hit) => hit.relation === "child");
    for (const title of ["EpicSpine", "Epic Team"]) {
      const at = hits.findIndex((hit) => hit.title === title);
      if (at >= 0) expect(at, title).toBeGreaterThan(lastChild);
    }
    // The agent's deploy note is not the person's memory (E12-S15): it no longer takes a place.
    expect(hits.map((hit) => hit.title)).not.toContain("zenod-social, EPIC-12 deploy note");
    for (let i = 1; i < hits.length; i++) expect(hits[i]!.matchPercent).toBeLessThanOrEqual(hits[i - 1]!.matchPercent);
  });

  it("reads 'voice note' as the kind of capture, not its subject", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("what was my voice note about the garden fence", 5);
    expect(hits.map((hit) => hit.title)).toEqual(["A thought about the garden fence"]);
  });

  it("gives a cited memory its own percentage, also outside the ranked list", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const vn = await index.matchFor("what was in my last vn?", [LATEST_VOICE_NOTE, "Log/2026-11-07.md"]);
    expect(vn.get(LATEST_VOICE_NOTE)).toBe(100);
    expect(vn.get("Log/2026-11-07.md")).toBe(50);
    const words = await index.matchFor("train to the coast", ["Areas/Travel.md", "Missing.md"]);
    expect(words.get("Areas/Travel.md")).toBeGreaterThan(1);
    expect(words.has("Missing.md")).toBe(false);
  });

  it("counts voice notes not yet linked to topics", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    expect(await index.noteLinks()).toEqual({ voiceNotes: 3, unlinked: 1, evidenceOnly: 0, partial: 1, unlinkedPaths: [UNLINKED_VOICE_NOTE] });
  });

  it("counts a point rescued onto a leaf as written, and a test recording kept as evidence as not unlinked (E12-S20)", async () => {
    const receipt = (evidenceRef: string, classification: unknown, outcomes: unknown[]) => [
      "---", "status: filing-record", `evidence: ${JSON.stringify(evidenceRef)}`, "---", "", "# Topic filing receipt", "",
      "```json", JSON.stringify({ version: 1, evidenceRef, phase: "ready", classification, outcomes, files: {} }, null, 2), "```", ""].join("\n");
    const leaf = "Notes/Gate sticks.md";
    const index = await indexOf({
      ...LAST_VOICE_NOTE_VAULT,
      [leaf]: "---\ntitle: Gate sticks\ntype: note\nprovisional: true\n---\n\n# Gate sticks\n\n> the gate sticks [[2026-11-06#^e-6b0e33]]\n",
      // The fence note: its one point was rejected for Travel and rescued onto a leaf.
      "Inbox/filing-2026-11-06-e-6b0e33.md": receipt(UNLINKED_VOICE_NOTE,
        { topics: [{ ideaId: "f1", topic: "Gate", disposition: "append_compact_note", pages: [{ path: "Areas/Travel.md" }] }] },
        [{ ideaId: "f1", status: "uncertain", reason: "provisional_leaf: reconciliation_needs_clarification", pages: [leaf], filedPages: [leaf], reroutedFrom: ["Areas/Travel.md"] }]),
      "Log/2026-11-05.md": ["# 2026-11-05", "", "## 09:00 Voice test  ^e-7e5700", "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note", "", "> Testing, say banana.", ""].join("\n"),
      "Inbox/filing-2026-11-05-e-7e5700.md": receipt("Log/2026-11-05.md#^e-7e5700",
        { disposition: "evidence_only", topics: [{ ideaId: "t1", topic: "Voice test", disposition: "evidence_only", pages: [] }] },
        [{ ideaId: "t1", status: "filed", filedPages: [] }]),
    });
    expect(await index.noteLinks()).toEqual({ voiceNotes: 4, unlinked: 0, evidenceOnly: 1, partial: 1, unlinkedPaths: [] });
  });

  it("leaves subject questions to the word search, and roots no longer match by being roots", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("branded screenshots", 5);
    expect(hits[0]!.title).toBe("Branded screenshots");
    expect(hits.some((hit) => hit.relation === "note" || hit.relation === "filed")).toBe(false);
    // What the page's strong paths reach may follow it (E18-W1), never anything weaker than 0.8.
    for (const hit of hits.filter((hit) => hit.relation)) expect(hit.pathStrength).toBeGreaterThanOrEqual(0.8);
    // Only the tree path says "long term": whatever is kept reads weak (E12-S3c round 1).
    for (const hit of await index.search("long term", 5)) expect(hit.matchPercent).toBeLessThanOrEqual(5);
  });
});

describe("the chat's index reads the day on the engine's clock (E12-S36)", () => {
  // The bench pins the engine to 8 Nov; the index read "yesterday" on the wall clock and missed 7 Nov,
  // so the answer came from an older note. Made-up notes on the days of his real questions.
  const vn = (day: string, time: string, anchor: string, words: string) => [
    `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}`, "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note",
    `- captured-at: ${day}T${time}:00.000Z`, "", `> ${words}`, "",
  ].join("\n");
  const AT = Date.parse("2026-11-08T16:00:00Z");

  async function engineAt(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), "zenod-recent-engine-"));
    dirs.push(dir);
    const seed = join(dir, "seed");
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(seed, path)), { recursive: true });
      await writeFile(join(seed, path), content);
    }
    const git = (...args: string[]) => execFileSync("git", args, { cwd: seed, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "seed");
    execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
    const repo = await VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
    return createEngine({ repo, llm: {} as BrainLlm, state: new SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "t" }, now: () => new Date(AT) });
  }

  const VAULT = {
    "Log/2026-10-02.md": ["# 2026-10-02", "", vn("2026-10-02", "10:00", "e-0c0201", "I said the volatility clusters model tested live and was well calibrated.")].join("\n"),
    "Log/2026-11-06.md": ["# 2026-11-06", "", vn("2026-11-06", "09:00", "e-0b0601", "The shed roof leaks again near the door."),
      vn("2026-11-06", "18:00", "e-0b0602", "Ana said the boat quote from Porto came in high, we should ask a second yard.")].join("\n"),
    "Log/2026-11-07.md": ["# 2026-11-07", "", vn("2026-11-07", "21:00", "e-0b0701", "How I work now: the VPS, T3, the personas and goals, and getting testers for Zenod."),
      vn("2026-11-07", "22:30", "e-0b0702", "The Zenod app should open on a chat first, with the memory graph lighting up.")].join("\n"),
  };

  it("answers his question about yesterday from 7 Nov when the engine says it is 8 Nov", async () => {
    const engine = await engineAt(VAULT);
    const hits = await engine.search("what did I say in my voice notes yesterday?");
    const notes = hits.filter((hit) => hit.path.startsWith("Log/")).map((hit) => hit.path);
    expect(notes.slice(0, 2).sort()).toEqual(["Log/2026-11-07.md#^e-0b0701", "Log/2026-11-07.md#^e-0b0702"]);
    expect(notes).not.toContain("Log/2026-10-02.md#^e-0c0201");
  });

  it("still lists a named day's notes", async () => {
    const engine = await engineAt(VAULT);
    const notes = (await engine.search("what did I send on November 6?")).filter((hit) => hit.path.startsWith("Log/")).map((hit) => hit.path);
    expect(notes.slice(0, 2).sort()).toEqual(["Log/2026-11-06.md#^e-0b0601", "Log/2026-11-06.md#^e-0b0602"]);
  });
});
