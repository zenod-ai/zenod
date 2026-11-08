import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { memoryChatExcerpt } from "../src/llm/memoryChatAnswer.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { MemoryIndex } from "../src/vault/memoryIndex.js";
import { recentIntent } from "../src/vault/recentIntent.js";
import { LAST_VOICE_NOTE_VAULT, LATEST_VOICE_NOTE, OLDER_VOICE_NOTE, UNLINKED_VOICE_NOTE } from "./fixtures/lastVoiceNoteVault.js";

// EPIC-12 S1b round 2 (Jordi 2026-11-08: "Speed is important but what about accuracy??"): the chat
// answers periods and dates from the notes captured then, reads the person's own notes beside the
// ranked list (also when the transcriber misspells a name), and reads long voice notes by the
// passages that match. Made-up notes throughout.
const NOW = Date.parse("2026-11-08T16:00:00Z");
const dirs: string[] = [];
const open: MemoryIndex[] = [];
afterEach(async () => {
  for (const index of open.splice(0)) index.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function write(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

async function indexOf(files: Record<string, string>): Promise<MemoryIndex> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-accuracy-"));
  dirs.push(dir);
  await write(join(dir, "vault"), files);
  const index = MemoryIndex.open({ path: join(dir, "index.sqlite"), vaultPath: join(dir, "vault"), tenantId: "t", now: () => NOW });
  open.push(index);
  return index;
}

const voice = (time: string, anchor: string, words: string) => [
  `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}`, "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note",
  `- captured-at: 2026-11-0${anchor.endsWith("1") ? 5 : 7}T${time}:00.000Z`, "",
  `> Voice note "${anchor}.ogg" ingested through Zenod media seam.`, "> Raw artifact: drive://file/demo", "> Media type: audio/ogg",
  "> Transcribed by demo transcriber.", ">", `> ${words}`, "",
].join("\n");

describe("time words (E12-S1b round 2)", () => {
  it("reads periods, named days and weekdays next to a say/talk word", () => {
    expect(recentIntent("what are the top five topics I talked about in the last week?", NOW))
      .toEqual({ window: { kind: "range", from: "2026-11-02", to: "2026-11-08" }, voice: false, topic: "" });
    expect(recentIntent("what did I say in the past 3 days about the fence", NOW))
      .toMatchObject({ window: { kind: "range", from: "2026-11-06", to: "2026-11-08" }, topic: "fence" });
    expect(recentIntent("what did I send on November 6?", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-06" }, topic: "" });
    expect(recentIntent("what did I say on 6 Nov", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-06" } });
    expect(recentIntent("voice notes from 2026-11-05", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-05" }, voice: true });
    // 2026-11-08 is a Sunday: "on Friday" is two days back; a later date than today is last year's.
    expect(recentIntent("what did I say on Friday", NOW)).toMatchObject({ window: { kind: "day", date: "2026-11-06" } });
    expect(recentIntent("what did I say on December 24", NOW)).toMatchObject({ window: { kind: "day", date: "2025-12-24" } });
    // Still subject questions: no time word, or a time word with no note or say word.
    expect(recentIntent("which cities did I want the observatory to cover?", NOW)).toBeNull();
    expect(recentIntent("what is the latest on the cabin decision", NOW)).toBeNull();
    expect(recentIntent("what did we decide last time about the notes", NOW)).toBeNull();
  });

  it("answers a period with every note the person sent in it, newest first, no agent reports and no pages", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    const hits = await index.search("what are the top five topics I talked about in the last week?", 20);
    expect(hits.map((hit) => hit.path)).toEqual([LATEST_VOICE_NOTE.replace("e-5c0e11", "e-c0ffee"), LATEST_VOICE_NOTE, OLDER_VOICE_NOTE, UNLINKED_VOICE_NOTE]);
    expect(hits.every((hit) => hit.relation === "note")).toBe(true);
    expect(hits.map((hit) => hit.matchPercent)).toEqual([...hits.map((hit) => hit.matchPercent)].sort((a, b) => b - a));
    expect((await index.search("what did I send on November 6?", 5))[0]!.path).toBe(UNLINKED_VOICE_NOTE);
  });
});

describe("the person's own notes beside the ranked list (E12-S1b round 2)", () => {
  it("finds the notes the person sent that hold the question's words, never an agent's report", async () => {
    const index = await indexOf(LAST_VOICE_NOTE_VAULT);
    expect(await index.ownNotes("what did I say about the garden fence paint?")).toEqual([UNLINKED_VOICE_NOTE]);
    expect(await index.ownNotes("what was deployed for EPIC-12 S3c?")).toEqual([]);
    expect(await index.ownNotes("what do I know")).toEqual([]);
  });

  it("also finds them under the transcriber's spelling of a name the vault writes another way", async () => {
    const page = (title: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\nZenod is the memory app. Zenod files notes.\n`;
    const index = await indexOf({
      "Projects/Zenod.md": page("Zenod"),
      "Projects/Zenod/Landing.md": page("Landing"),
      "Projects/Zenod/Testers.md": page("Testers"),
      "Log/2026-11-05.md": ["# 2026-11-05", "", voice("09:00", "e-aaaaa1", "Zenot needs testers now, five of them, from Reddit.")].join("\n"),
      "Log/2026-11-07.md": ["# 2026-11-07", "", voice("10:00", "e-bbbbb2", "When you land on Zenot you see a chat box first."),
        voice("11:00", "e-ccccc2", "The fence gate sticks again.")].join("\n"),
    });
    const own = await index.ownNotes("why should Zenod get testers now?");
    expect(own[0]).toBe("Log/2026-11-05.md#^e-aaaaa1");
    expect(own).not.toContain("Log/2026-11-07.md#^e-ccccc2");
    // A word the person does say is never respelled.
    expect(await index.ownNotes("what did I say about the fence gate")).toEqual(["Log/2026-11-07.md#^e-ccccc2"]);
  });
});

describe("reading a long voice note (E12-S1b round 2)", () => {
  it("drops the ingest lines and keeps the passages that hold the question, deep in the note", () => {
    const filler = "We walked along the river and talked about nothing much at all. ".repeat(60);
    const body = [
      '> Voice note "x.ogg" ingested through Zenod media seam.', "> Raw artifact: drive://file/abc", "> Raw artifact sha256: 0123", "> Media type: audio/ogg",
      "> Transcribed by demo.", `> ${filler}In Hell's Kitchen a flat costs about 400,000 dollars, and monthly rents are high. ${filler}`,
    ].join("\n");
    const excerpt = memoryChatExcerpt(body, "how much does an apartment in Hell's Kitchen cost?", 1_800);
    expect(excerpt).not.toMatch(/Raw artifact|sha256|Media type|Transcribed by|ingested through/);
    expect(excerpt).toContain("400,000 dollars");
    expect(excerpt.length).toBeLessThan(1_900);
  });
});

describe("engine.answerFromMemories reads more than the ranked list (E12-S1b round 2)", () => {
  it("adds the person's own matching note, with its capture time, its topics and today's date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-accuracy-engine-"));
    dirs.push(dir);
    const seed = join(dir, "seed");
    await write(seed, {
      "Notes/Car.md": "---\ntitle: Car\n---\n# Car\n\nTyre pressure: 2.4 bar front.\n",
      "Log/2026-11-05.md": ["# 2026-11-05", "", voice("09:00", "e-aaaaa1", "The observatory should cover Mexico City and Sao Paulo first."),
        "- filed: [[Projects/Observatory]] (Working › Observatory)", ""].join("\n"),
    });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: seed, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "seed");
    execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
    const repo = await VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
    const prompts: string[] = [];
    const llm = {
      streamMemoryChat: async (input: { system: string; prompt: string }) => {
        prompts.push(input.prompt);
        return 'Mexico City and Sao Paulo [2].\nSOURCES\n[2] "cover Mexico City and Sao Paulo first"';
      },
    } as unknown as BrainLlm;
    const engine = createEngine({
      repo, llm, state: new SqliteStateStore(":memory:"),
      memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "t" }, now: () => new Date(NOW),
    });
    const check = await engine.answerFromMemories!("which cities should the observatory cover?", [{ n: 1, path: "Notes/Car.md", title: "Car" }]);
    expect(check).toMatchObject({ checked: true, cited: [2] });
    expect(check!.context!.map((memory) => memory.path)).toEqual(["Notes/Car.md", "Log/2026-11-05.md#^e-aaaaa1"]);
    expect(prompts[0]).toContain("TODAY\n2026-11-08 (Sunday)");
    expect(prompts[0]).toContain("[2] your voice note (Log/2026-11-05.md#^e-aaaaa1) captured 2026-11-05 09:00 UTC, voice note");
    expect(prompts[0]).toContain("Filed into: Observatory");
    expect(prompts[0]).not.toContain("Raw artifact");
  });
});
