import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import {
  checkMemoryChatAnswer,
  memoryChatAboutNotes,
  memoryChatExcerpt,
  memoryChatFocus,
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
    // Most claims unchecked: nothing is shown.
    expect(checkMemoryChatAnswer('Frog [1], pressure 2.4 [2], rear 2.6 [2].\nSOURCES\n[1] "the blue ceramic frog"', memories))
      .toMatchObject({ checked: false, reason: "citation_not_found", cited: [1] });
    expect(checkMemoryChatAnswer('Frog [7].\nSOURCES\n[7] "the blue ceramic frog"', memories)).toMatchObject({ checked: false, reason: "citation_not_found" });
    expect(checkMemoryChatAnswer("The key is in the frog.", memories)).toMatchObject({ checked: false, reason: "no_citation" });
    expect(checkMemoryChatAnswer("NO_ANSWER", memories)).toMatchObject({ checked: false, reason: "no_answer", text: "" });
    expect(checkMemoryChatAnswer("  ", memories)).toMatchObject({ checked: false, reason: "empty" });
  });

  it("removes only the claims whose citation has no quote, never shows one (E12-S1b round 2)", () => {
    // [2] is cited but not quoted: its claim goes, the checked one stays, and a claim backed by a
    // checked note keeps that note even when it also names an unchecked one.
    const output = [
      "In your notes:",
      "- The spare key is in the blue frog [1][2].",
      "- Tyre pressure is 2.4 bar [2].",
      "- It sits under the rosemary pot [1], and the car is red [2].",
      "SOURCES",
      '[1] "in the blue ceramic frog under the rosemary pot"',
    ].join("\n");
    expect(checkMemoryChatAnswer(output, memories)).toEqual({
      checked: true, reason: null, cited: [1],
      text: "In your notes:\n- The spare key is in the blue frog [1].\n- It sits under the rosemary pot [1].",
    });
    // A made-up quote is no quote: same rule.
    const madeUp = 'The key is in the frog [1]. The car is red [2].\nSOURCES\n[1] "the blue ceramic frog"\n[2] "the car is red"';
    expect(checkMemoryChatAnswer(madeUp, memories)).toMatchObject({ checked: true, text: "The key is in the frog [1].", cited: [1] });
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
    expect(prompt).toContain("QUESTION\nWhere is the spare key?\n\n");
    // E12-S32: the prompt ends by naming the parts of the reply, so the quotes are not left out.
    expect(prompt.endsWith("then the SOURCES line and one quote line for every note number you cited.")).toBe(true);
    const long = `---\ntitle: x\n---\n${"filler words here. ".repeat(300)}The boiler was serviced by Rosa for 500 euros.${" more filler.".repeat(100)}`;
    const excerpt = memoryChatExcerpt(long, "The boiler was serviced by Rosa");
    expect(excerpt.length).toBeLessThan(1_900);
    expect(excerpt).toContain("serviced by Rosa for 500 euros");
    expect(memoryChatExcerpt("---\ntitle: x\n---\nShort body.")).toBe("Short body.");
  });
});

describe("answers stay on the asked note (E12-S16)", () => {
  const notes: MemoryChatContext[] = [
    { n: 1, path: "Notes/NYC.md", title: "NYC Real Estate", text: "Lofts in Hell's Kitchen sell for about 400,000 dollars.", kind: "page" },
    { n: 2, path: "Log/2026-11-08.md#^e-aaaaaa", title: "Voice note \"AC8C.ogg\" ingested", text: "For Airbnb I want the price of one night, one week and one month.", kind: "voice", when: "2026-11-08 15:37 UTC, voice note" },
    { n: 3, path: "Log/2026-08-02.md#^e-bbbbbb", title: "Jordi wants the São Paulo option", text: "São Paulo: a budget of 300,000 euros near Paulista.", kind: "note" },
  ];

  it("drops a claim that rests only on a note outside the ABOUT line", () => {
    const output = [
      "ABOUT [2]",
      "You wanted Airbnb prices:",
      "- One night, one week and one month [2].",
      "- Hell's Kitchen lofts sell for about 400,000 dollars [1].",
      "- In São Paulo, 300,000 euros near Paulista [3][2].",
      "SOURCES",
      '[1] "Lofts in Hell\'s Kitchen sell for about 400,000 dollars"',
      '[2] "the price of one night, one week and one month"',
      '[3] "a budget of 300,000 euros near Paulista"',
    ].join("\n");
    expect(checkMemoryChatAnswer(output, notes)).toEqual({
      checked: true, reason: null, cited: [2],
      text: "You wanted Airbnb prices:\n- One night, one week and one month [2].\n- In São Paulo, 300,000 euros near Paulista [2].",
    });
  });

  it("narrows an ABOUT line that names a neighbouring note to the asked one (E12-S32)", () => {
    const output = [
      "ABOUT [1], [2], [3]",
      "You wanted Airbnb prices for one night, one week and one month [2].",
      "",
      "Regarding prices, you also said:",
      "- Hell's Kitchen lofts sell for about 400,000 dollars [1].",
      "- In São Paulo, 300,000 euros near Paulista [3].",
      "SOURCES",
      '[1] "Lofts in Hell\'s Kitchen sell for about 400,000 dollars"',
      '[2] "the price of one night, one week and one month"',
      '[3] "a budget of 300,000 euros near Paulista"',
    ].join("\n");
    // A question about what the person wanted: their own voice note, and the lead-in left with no points goes.
    expect(checkMemoryChatAnswer(output, notes, { question: "What Airbnb prices did I want to know?" })).toEqual({
      checked: true, reason: null, cited: [2], text: "You wanted Airbnb prices for one night, one week and one month [2].",
    });
    // The note the host read whole wins over the model's first; with no scope the ABOUT line stands as written.
    expect(memoryChatAboutNotes([1, 3], notes, { question: "What do lofts cost?", picks: [3] })).toEqual([3]);
    expect(memoryChatAboutNotes([1, 3], notes, { question: "What do lofts cost?" })).toEqual([1]);
    expect(checkMemoryChatAnswer(output, notes).text).toContain("Hell's Kitchen");
    // Questions over many notes keep every note named; the same note captured twice stays.
    expect(memoryChatAboutNotes([1, 3], notes, { question: "What were my top topics?" })).toEqual([1, 3]);
    const twice: MemoryChatContext[] = [...notes, { ...notes[1]!, n: 4, path: "Log/2026-11-08.md#^e-cccccc" }];
    expect(memoryChatAboutNotes([2, 4], twice, { question: "What Airbnb prices did I want?" })).toEqual([2, 4]);
  });

  it("asks for one ABOUT note and fuller answers (E12-S32)", () => {
    const { system } = memoryChatPrompt("How did I feel?", notes);
    expect(system).toContain("almost always ONE note");
    expect(system).toContain("four to eight points");
  });

  it("keeps the answer when the ABOUT line names no note the answer rests on, and reads NO_ANSWER after it", () => {
    const output = 'ABOUT [3]\nLofts sell for about 400,000 dollars [1].\nSOURCES\n[1] "Lofts in Hell\'s Kitchen sell for about 400,000 dollars"';
    expect(checkMemoryChatAnswer(output, notes)).toMatchObject({ checked: true, text: "Lofts sell for about 400,000 dollars [1].", cited: [1] });
    expect(checkMemoryChatAnswer("ABOUT\nNO_ANSWER", notes)).toMatchObject({ checked: false, reason: "no_answer" });
    expect(checkMemoryChatAnswer("ABOUT [2]", notes)).toMatchObject({ checked: false, reason: "no_answer" });
  });

  it("never streams the ABOUT line", () => {
    expect(streamed(["AB", "OUT [2", "]\n", "One night [2].\nSOURCES\n[2] \"x\""]).shown.trim()).toBe("One night [2].");
    expect(streamed(["ABOUT [2][3]\n\n", "- One week [2]."]).shown).toBe("- One week [2].");
    expect(streamed(["ABOUT [2]\nNO_", "ANSWER"]).shown).toBe("");
    // Prose that starts like ABOUT is shown once it is clearly not the line.
    expect(streamed(["Ab", "out a week [2]."]).shown).toBe("About a week [2].");
  });

  it("tells the model what each note is, and asks for the ABOUT line", () => {
    const { system, prompt } = memoryChatPrompt("What Airbnb prices did I want to know?", notes);
    expect(system).toContain("ABOUT");
    expect(system).toContain("Never mix their points in");
    expect(prompt).toContain("[1] topic page: NYC Real Estate (Notes/NYC.md)");
    expect(prompt).toContain("[2] your voice note (Log/2026-11-08.md#^e-aaaaaa) captured 2026-11-08 15:37 UTC, voice note");
    expect(prompt).toContain("[3] note: Jordi wants the São Paulo option (Log/2026-08-02.md#^e-bbbbbb)");
  });

  it("reads whole the note with one passage that holds the question, the person's own first", () => {
    const filler = "Other things came up that day, none of them about this. ".repeat(40);
    const candidates = [
      { n: 1, title: "Housing", text: `Airbnb listings are many. ${filler} Prices of flats went up.`, own: false },
      { n: 2, title: "Voice note", text: `${filler} For Airbnb I want to know the prices for one night and one month.`, own: true },
      { n: 3, title: "Car", text: "Tyre pressure: 2.4 bar front.", own: false },
    ];
    expect(memoryChatFocus("What Airbnb prices did I want to know?", candidates)).toEqual([2]);
    // Questions over many notes, or that no passage holds, read nothing whole.
    expect(memoryChatFocus("What were my top topics?", candidates)).toEqual([]);
    expect(memoryChatFocus("What did I say about the boiler?", candidates)).toEqual([]);
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
    expect(check).toMatchObject({ checked: true, reason: null, text: "Ana is your plumber [2].", cited: [2] });
    // Every memory read, numbered, so the app can show a cited one (E12-S1b round 2).
    expect(check!.context!.map((memory) => memory.path)).toEqual(["Notes/Car.md", "Log/2026-11-01.md#^e-bbbbbb"]);
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
