import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { memoryChatPrompt } from "../src/llm/memoryChatAnswer.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { ASKED_NOTE_LIFT, MemoryIndex } from "../src/vault/memoryIndex.js";

// EPIC-12 S19: the note a question asks about is read, also when BM25 ranks it low (a long voice note
// that mentions everything ties with the one that says it), when the question is put loosely ("did I
// ever mention…"), and when the note is in the person's other language. S18: the answer gives every
// point that note makes. Made-up notes throughout.
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
  const dir = await mkdtemp(join(tmpdir(), "zenod-asked-"));
  dirs.push(dir);
  await write(join(dir, "vault"), files);
  const index = MemoryIndex.open({ path: join(dir, "index.sqlite"), vaultPath: join(dir, "vault"), tenantId: "t", now: () => NOW });
  open.push(index);
  return index;
}

const voice = (day: string, time: string, anchor: string, words: string) => [
  `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}`, "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note",
  `- captured-at: ${day}T${time}:00.000Z`, "",
  `> Voice note "${anchor}.ogg" ingested through Zenod media seam.`, "> Raw artifact: drive://file/demo", "> Media type: audio/ogg",
  "> Transcribed by demo transcriber.", ">", `> ${words}`, "",
].join("\n");

const page = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
const filler = (n: number) => "We walked along the river and talked about the weather and the week ahead. ".repeat(n);

// A long note that says "landing", "cloud", "first" and "chat" far apart, and a short one that says them together.
const SCATTERED = `The landing pages need work. ${filler(40)} The cloud bill came in. ${filler(40)} First we fix the boat. ${filler(40)} The chat with Ana went well.`;
const TOGETHER = "When people land on cloud Zenod the first thing they see is a chat box, then the memory graph.";
const VAULT = {
  "Projects/Landing pages.md": page("Landing pages", "Landing pages for the cloud app: first screen, chat, sign up. The landing page copy."),
  "Projects/Cloud.md": page("Cloud", "The cloud app runs on the VPS. First deploy in June. Landing and chat live there."),
  "Log/2026-11-01.md": ["# 2026-11-01", "", voice("2026-11-01", "09:00", "e-aaaaa1", SCATTERED)].join("\n"),
  "Log/2026-11-07.md": ["# 2026-11-07", "", voice("2026-11-07", "22:00", "e-bbbbb2", TOGETHER),
    voice("2026-11-07", "23:00", "e-ccccc3", "Hay este tweet que dice que ya no hay fosos defensivos en un negocio, todo se copia. Yo creo que los network effects son la excepción.")].join("\n"),
  "Log/2026-11-06.md": ["# 2026-11-06", "", voice("2026-11-06", "08:00", "e-ddddd4", "The garden shed roof leaks again near the door.")].join("\n"),
};

describe("the note the question asks about (E12-S19)", () => {
  it("is the person's note that holds the question in one passage, not a long note that mentions each word somewhere", async () => {
    const index = await indexOf(VAULT);
    const asked = await index.askedNotes("what should people see first when they land on cloud Zenod?", 2);
    expect(asked[0]).toMatchObject({ path: "Log/2026-11-07.md#^e-bbbbb2" });
    expect(asked[0]!.share).toBeGreaterThanOrEqual(ASKED_NOTE_LIFT);
    expect(asked.find((note) => note.path === "Log/2026-11-01.md#^e-aaaaa1")?.share ?? 0).toBeLessThan(asked[0]!.share);
  });

  it("joins the top of the ranked list next to the best word match, and the topic pages stay", async () => {
    const index = await indexOf(VAULT);
    const hits = await index.search("what should people see first when they land on cloud Zenod?", 5);
    const at = hits.findIndex((hit) => hit.path === "Log/2026-11-07.md#^e-bbbbb2");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(1);
    expect(hits.map((hit) => hit.matchPercent)).toEqual([...hits.map((hit) => hit.matchPercent)].sort((a, b) => b - a));
    expect(hits.some((hit) => hit.path === "Projects/Landing pages.md")).toBe(true);
  });

  it("is found from an English question when the person spoke Spanish", async () => {
    const index = await indexOf(VAULT);
    const asked = await index.askedNotes("What did I think about the tweet saying businesses have no moats any more?", 1);
    expect(asked).toEqual([{ path: "Log/2026-11-07.md#^e-ccccc3", share: 1 }]);
    const hits = await index.search("What did I think about the tweet saying businesses have no moats any more?", 5);
    expect(hits[0]!.path).toBe("Log/2026-11-07.md#^e-ccccc3");
  });

  it("is found when the question is put loosely", async () => {
    const index = await indexOf(VAULT);
    for (const question of ["did I ever mention the shed roof?", "what was that thing about the shed roof?", "what did I ask about the shed roof"]) {
      expect((await index.askedNotes(question, 1))[0]?.path, question).toBe("Log/2026-11-06.md#^e-ddddd4");
    }
  });

  it("is never an agent's report, and a question of only generic words has none", async () => {
    const index = await indexOf({
      ...VAULT,
      "Log/2026-11-05.md": ["# 2026-11-05", "", "## 10:00 Shed roof report  ^e-eeeee5", "- source: agent:watcher", "", "The shed roof was checked by the agent.", ""].join("\n"),
    });
    expect((await index.askedNotes("what about the shed roof", 3)).map((note) => note.path)).not.toContain("Log/2026-11-05.md#^e-eeeee5");
    expect(await index.askedNotes("what do I know", 3)).toEqual([]);
  });
});

describe("the chat reads the asked note whole and answers it completely (E12-S19, E12-S18)", () => {
  it("reads the asked note whole, even when the ranked list did not reach it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-asked-engine-"));
    dirs.push(dir);
    const seed = join(dir, "seed");
    const deep = `${filler(70)}About the hedging: first we clarify the mechanics, then we try it and learn the sizing from the distribution of outcomes.`;
    await write(seed, {
      "Notes/Car.md": "---\ntitle: Car\n---\n# Car\n\nTyre pressure: 2.4 bar front.\n",
      "Log/2026-09-25.md": ["# 2026-09-25", "", voice("2026-09-25", "18:00", "e-fffff6", deep)].join("\n"),
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
        return "ABOUT [2]\nClarify the mechanics, then try it [2].\nSOURCES\n[2] \"first we clarify the mechanics\"";
      },
    } as unknown as BrainLlm;
    const engine = createEngine({ repo, llm, state: new SqliteStateStore(":memory:"), memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "t" }, now: () => new Date(NOW) });
    const check = await engine.answerFromMemories!("what did I say about hedging?", [{ n: 1, path: "Notes/Car.md", title: "Car" }]);
    expect(check).toMatchObject({ checked: true, cited: [2] });
    expect(prompts[0]).toContain("(Log/2026-09-25.md#^e-fffff6)");
    // Read whole: the river walk before it is kept, not cut down to the passage that matches.
    expect(prompts[0]).toContain("learn the sizing from the distribution of outcomes");
    expect(prompts[0]!.split("We walked along the river").length - 1).toBe(70);
  });

  it("asks for every point the note makes on the question, with its reasons and next step", () => {
    const { system } = memoryChatPrompt("what did I say about hedging?", []);
    expect(system).toContain("list for yourself every point it makes on the question");
    expect(system).toContain("never stop at the first point");
    expect(system).toContain("At most about 12 lines");
  });
});
