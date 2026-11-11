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
import { recentIntent, validTimeZone, zoneDayStartMs, zoneOffsetMs } from "../src/vault/recentIntent.js";

// E12-S38: "today" and "yesterday" are the person's days. Jordi is in Mexico City: at 19:00 there on
// Tuesday 10 Nov it is already 01:00 on Wednesday 11 Nov in UTC, and Log files are named by UTC day.
// Made-up notes throughout.
const MX = "America/Mexico_City";
const EVENING = Date.parse("2026-11-11T01:00:00Z"); // 10 Nov 19:00 in Mexico City
const dirs: string[] = [];
const open: MemoryIndex[] = [];
afterEach(async () => {
  for (const index of open.splice(0)) index.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const vn = (day: string, time: string, anchor: string, words: string) => [
  `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}`, "- source: whatsapp", "- verbatim: yes", "- content-type: voice_note",
  `- captured-at: ${day}T${time}:00.000Z`, "", `> ${words}`, "",
].join("\n");

// Each note's day in Mexico City is in its comment.
const VAULT = {
  "Log/2026-11-09.md": ["# 2026-11-09", "", vn("2026-11-09", "20:00", "e-0c0901", "The shed roof leaks again near the door.")].join("\n"), // 9 Nov 14:00
  "Log/2026-11-10.md": ["# 2026-11-10", "",
    vn("2026-11-10", "03:00", "e-0c1001", "Ana said the boat quote from Porto came in high."), // 9 Nov 21:00
    vn("2026-11-10", "15:00", "e-0c1002", "Testers for Zenod: start with five people I know.")].join("\n"), // 10 Nov 09:00
  "Log/2026-11-11.md": ["# 2026-11-11", "", vn("2026-11-11", "00:30", "e-0c1101", "The app should open on a chat first.")].join("\n"), // 10 Nov 18:30
};

async function indexOf(timeZone: string | null): Promise<MemoryIndex> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-local-day-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(VAULT)) {
    await mkdir(dirname(join(dir, "vault", path)), { recursive: true });
    await writeFile(join(dir, "vault", path), content);
  }
  const index = MemoryIndex.open({ path: join(dir, "index.sqlite"), vaultPath: join(dir, "vault"), tenantId: "t", now: () => EVENING, timeZone: () => timeZone });
  open.push(index);
  return index;
}

const notesFor = async (index: MemoryIndex, question: string) =>
  (await index.search(question)).filter((hit) => hit.path.startsWith("Log/")).map((hit) => hit.path).sort();

describe("day words in the person's time zone (E12-S38)", () => {
  it("reads the zone's clock, and UTC without one", () => {
    expect(zoneOffsetMs(EVENING, MX)).toBe(-6 * 3_600_000);
    expect(zoneOffsetMs(EVENING, null)).toBe(0);
    expect(zoneOffsetMs(EVENING, "Not/AZone")).toBe(0);
    expect(zoneDayStartMs("2026-11-10", MX)).toBe(Date.parse("2026-11-10T06:00:00Z"));
    expect(validTimeZone("America/Mexico_City")).toBe(MX);
    expect(validTimeZone("Not/AZone")).toBeNull();
    expect(validTimeZone(42)).toBeNull();
  });

  it("names the person's days at 19:00 in Mexico City", () => {
    expect(recentIntent("what did I say yesterday?", EVENING, MX)).toMatchObject({ window: { kind: "day", date: "2026-11-09" } });
    expect(recentIntent("what did I say today?", EVENING, MX)).toMatchObject({ window: { kind: "day", date: "2026-11-10" } });
    expect(recentIntent("what did I say this morning?", EVENING, MX)).toMatchObject({ window: { kind: "day", date: "2026-11-10" } });
    // It is still Tuesday there: "last Tuesday" is a week back. In UTC it is Wednesday, so a day back.
    expect(recentIntent("what did I say last Tuesday?", EVENING, MX)).toMatchObject({ window: { kind: "day", date: "2026-11-03" } });
    expect(recentIntent("what did I say last Tuesday?", EVENING)).toMatchObject({ window: { kind: "day", date: "2026-11-10" } });
    expect(recentIntent("what did I say yesterday?", EVENING)).toMatchObject({ window: { kind: "day", date: "2026-11-10" } });
  });

  it("answers his question about yesterday from his yesterday, across two UTC files", async () => {
    const index = await indexOf(MX);
    expect(await notesFor(index, "what did I say in my voice notes yesterday?")).toEqual(["Log/2026-11-09.md#^e-0c0901", "Log/2026-11-10.md#^e-0c1001"]);
    expect(await notesFor(index, "what did I say in my voice notes today?")).toEqual(["Log/2026-11-10.md#^e-0c1002", "Log/2026-11-11.md#^e-0c1101"]);
  });

  it("keeps UTC days when the zone is unknown", async () => {
    const index = await indexOf(null);
    expect(await notesFor(index, "what did I say in my voice notes yesterday?")).toEqual(["Log/2026-11-10.md#^e-0c1001", "Log/2026-11-10.md#^e-0c1002"]);
  });

  it("tells the answer the person's date, clock and note times", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-local-day-engine-"));
    dirs.push(dir);
    const seed = join(dir, "seed");
    for (const [path, content] of Object.entries(VAULT)) {
      await mkdir(dirname(join(seed, path)), { recursive: true });
      await writeFile(join(seed, path), content);
    }
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
        return 'The boat quote came in high [1].\nSOURCES\n[1] "the boat quote from Porto came in high"';
      },
    } as unknown as BrainLlm;
    const engine = createEngine({
      repo, llm, state: new SqliteStateStore(":memory:"),
      memoryIndex: { path: join(dir, "index.sqlite"), tenantId: "t" }, now: () => new Date(EVENING), timeZone: () => MX,
    });
    await engine.answerFromMemories!("what did I say yesterday?", [{ n: 1, path: "Log/2026-11-10.md#^e-0c1001", title: "Voice note" }]);
    expect(prompts[0]).toContain(`TODAY\n2026-11-10 (Tuesday), now 19:00 ${MX}`);
    expect(prompts[0]).toContain(`captured 2026-11-09 21:00 ${MX}, voice note`);
  });
});
