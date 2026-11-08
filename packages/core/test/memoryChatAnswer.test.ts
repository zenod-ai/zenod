import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import {
  checkMemoryChatAnswer,
  memoryChatExcerpt,
  memoryChatPrompt,
  memoryChatStreamFilter,
  quoteFound,
  type MemoryChatContext,
} from "../src/llm/memoryChatAnswer.js";
import type { BrainLlm } from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";

// EPIC-12 E12-S1b: the web app's fast chat answer: one streamed call over the ranked memories,
// cited by number, every citation checked against the memory it names.
const memories: MemoryChatContext[] = [
  { n: 1, path: "Notes/Home/Spare key.md", title: "Spare key", text: "# Spare key\n\nThe spare house key is in the blue ceramic frog under the rosemary pot." },
  { n: 2, path: "Notes/Car.md", title: "Car", text: "# Car\n\nTyre pressure: 2.4 bar front, 2.6 bar rear." },
];

const streamed = (deltas: string[]) => {
  const shown: string[] = [];
  const filter = memoryChatStreamFilter((text) => shown.push(text));
  for (const delta of deltas) filter.push(delta);
  const full = filter.end();
  return { shown: shown.join(""), full };
};

describe("memory chat answer protocol (E12-S1b)", () => {
  it("checks an answer whose every citation is backed by a quote found in that memory", () => {
    const output = 'The spare key is in the blue frog under the rosemary pot [1].\nSOURCES\n[1] "in the blue ceramic frog under the rosemary pot"';
    expect(checkMemoryChatAnswer(output, memories)).toEqual({
      checked: true, reason: null, text: "The spare key is in the blue frog under the rosemary pot [1].", cited: [1],
    });
  });

  it("refuses an answer with a made-up quote, a citation without a quote, a number not given, or none at all", () => {
    expect(checkMemoryChatAnswer('It is under the doormat [1].\nSOURCES\n[1] "the key is under the doormat"', memories))
      .toMatchObject({ checked: false, reason: "citation_not_found" });
    expect(checkMemoryChatAnswer('Frog [1], pressure 2.4 [2].\nSOURCES\n[1] "the blue ceramic frog"', memories))
      .toMatchObject({ checked: false, reason: "citation_not_found", cited: [1] });
    expect(checkMemoryChatAnswer('Frog [7].\nSOURCES\n[7] "the blue ceramic frog"', memories)).toMatchObject({ checked: false, reason: "citation_not_found" });
    expect(checkMemoryChatAnswer("The key is in the frog.", memories)).toMatchObject({ checked: false, reason: "no_citation" });
    expect(checkMemoryChatAnswer("NO_ANSWER", memories)).toMatchObject({ checked: false, reason: "no_answer", text: "" });
    expect(checkMemoryChatAnswer("  ", memories)).toMatchObject({ checked: false, reason: "empty" });
  });

  it("finds a quote despite case, punctuation and accents, but not a one-word or invented one", () => {
    expect(quoteFound("Tyre pressure: 2.4 bar front", memories[1]!.text)).toBe(true);
    expect(quoteFound("TYRE PRESSURE 2.4 BAR FRONT, 2.6 bar rear", memories[1]!.text)).toBe(true);
    expect(quoteFound("Óakmere is lakeside", "Oakmere is lakeside, 185,000 euros")).toBe(true);
    expect(quoteFound("frog", memories[0]!.text)).toBe(false);
    expect(quoteFound("the key is under the red doormat by the gate", memories[0]!.text)).toBe(false);
  });

  it("streams only the prose: never a NO_ANSWER, never the SOURCES block", () => {
    expect(streamed(["The key is", " in the frog [1].\nSOU", "RCES\n[1] \"blue ceramic frog\""]).shown.trim()).toBe("The key is in the frog [1].");
    expect(streamed(["NO_", "ANSWER"]).shown).toBe("");
    expect(streamed(["**SOURCES**\n[1] \"x\""]).shown).toBe("");
    expect(streamed(["No, ", "you never wrote that down [1]."]).shown).toBe("No, you never wrote that down [1].");
    // A held-back line that turns out not to be SOURCES is shown.
    expect(streamed(["Ana [1].\nSou", "th of the river."]).shown).toBe("Ana [1].\nSouth of the river.");
  });

  it("numbers the memories for the model and keeps long ones near the matching part", () => {
    const { system, prompt } = memoryChatPrompt("Where is the spare key?", memories);
    expect(system).toContain("NO_ANSWER");
    expect(prompt).toContain("[1] Spare key (Notes/Home/Spare key.md)");
    expect(prompt).toContain("[2] Car (Notes/Car.md)");
    expect(prompt.endsWith("QUESTION\nWhere is the spare key?")).toBe(true);
    const long = `---\ntitle: x\n---\n${"filler words here. ".repeat(300)}The boiler was serviced by Rosa for 500 euros.${" more filler.".repeat(100)}`;
    const excerpt = memoryChatExcerpt(long, "The boiler was serviced by Rosa");
    expect(excerpt.length).toBeLessThan(1_900);
    expect(excerpt).toContain("serviced by Rosa for 500 euros");
    expect(memoryChatExcerpt("---\ntitle: x\n---\nShort body.")).toBe("Short body.");
  });
});

describe("engine.answerFromMemories (E12-S1b)", () => {
  let dir: string;
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function vault() {
    dir = await mkdtemp(join(tmpdir(), "zenod-chat-answer-"));
    const seed = join(dir, "seed");
    await mkdir(join(seed, "Notes"), { recursive: true });
    await mkdir(join(seed, "Log"), { recursive: true });
    await writeFile(join(seed, "Notes", "Car.md"), "---\ntitle: Car\n---\n# Car\n\nTyre pressure: 2.4 bar front, 2.6 bar rear.\n");
    await writeFile(join(seed, "Log", "2026-11-01.md"), "# 2026-11-01\n\n## 09:00 note ^e-aaaaaa\n\n> Ran 5 km.\n\n## 12:00 note ^e-bbbbbb\n\n> The plumber is Ana.\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: seed, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "seed");
    execFileSync("git", ["clone", "-q", "--bare", seed, join(dir, "origin.git")]);
    return VaultRepo.open({ workdir: join(dir, "vault"), remoteUrl: join(dir, "origin.git") });
  }

  it("reads each memory (a Log entry by its anchor), streams the prose and checks the quotes, in one call", async () => {
    const prompts: string[] = [];
    const llm = {
      streamMemoryChat: async (input: { system: string; prompt: string }, onText: (delta: string) => void) => {
        prompts.push(input.prompt);
        const out = 'Ana is your plumber [2].\nSOURCES\n[2] "The plumber is Ana"';
        for (const part of [out.slice(0, 10), out.slice(10)]) onText(part);
        return out;
      },
    } as unknown as BrainLlm;
    const engine = createEngine({ repo: await vault(), llm, state: new SqliteStateStore(":memory:") });
    const shown: string[] = [];
    const check = await engine.answerFromMemories!("Who is the plumber?", [
      { n: 1, path: "Notes/Car.md", title: "Car" },
      { n: 2, path: "Log/2026-11-01.md#^e-bbbbbb", title: "note" },
      { n: 3, path: "Notes/Missing.md", title: "Missing" },
    ], (text) => shown.push(text));
    expect(check).toEqual({ checked: true, reason: null, text: "Ana is your plumber [2].", cited: [2] });
    expect(shown.join("").trim()).toBe("Ana is your plumber [2].");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Tyre pressure");
    expect(prompts[0]).toContain("The plumber is Ana");
    expect(prompts[0]).not.toContain("Ran 5 km"); // only the anchored entry, not the whole day
    expect(prompts[0]).not.toContain("Missing");
  });

  it("returns null when the model has no streaming chat call, so the caller uses the ask loop", async () => {
    const engine = createEngine({ repo: await vault(), llm: {} as BrainLlm, state: new SqliteStateStore(":memory:") });
    expect(await engine.answerFromMemories!("q", [{ n: 1, path: "Notes/Car.md", title: "Car" }])).toBeNull();
  });
});
