import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(hits.map((hit) => hit.title)).not.toContain("EpicSpine");
    expect(hits.map((hit) => hit.title)).not.toContain("Epic Team");
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
    expect(await index.noteLinks()).toEqual({ voiceNotes: 3, unlinked: 1, partial: 1, unlinkedPaths: [UNLINKED_VOICE_NOTE] });
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
