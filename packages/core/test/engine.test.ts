import { cp, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type {
  AnswerInput,
  AnswerResult,
  BrainLlm,
  Classification,
  ClassifyInput,
  ComposePageInput,
  VaultReadTools,
  VaultWriteTools,
  WorkLoopInput,
  WorkLoopResult,
} from "../src/llm/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/vault", import.meta.url));

/** Deterministic fake LLM: files insurance content onto Areas/Insurance.md. */
class FakeLlm implements BrainLlm {
  classifyCalls = 0;
  composeCalls = 0;
  confidence = 0.95;
  failComposeAttempts = 0;

  async classify(_input: ClassifyInput): Promise<Classification> {
    this.classifyCalls++;
    return {
      confidence: this.confidence,
      summary: "note new insurance fact",
      tags: ["insurance"],
      pages: [{ path: "Areas/Insurance.md", action: "update", title: "Insurance" }],
      ...(this.confidence < 0.7 ? { question: "Which area does this belong to?" } : {}),
    };
  }

  async composePage(input: ComposePageInput): Promise<string> {
    this.composeCalls++;
    if (this.composeCalls <= this.failComposeAttempts) {
      return "# Broken page without frontmatter\n"; // fails lint
    }
    const today = input.today;
    return [
      "---",
      "title: Insurance",
      "type: area",
      "tags: [insurance]",
      "created: 2026-06-10",
      `updated: ${today}`,
      "summary: Active insurance policies and renewal dates for the user.",
      "---",
      "",
      "# Insurance",
      "",
      `- New fact recorded (${input.citation}).`,
      "- Travel insurance with [[Notes/Axa|Axa]], policy ends March 2027 ([[2026-06-10#^e-7f3a2c]]).",
      "",
    ].join("\n");
  }

  async answer(input: AnswerInput, tools: VaultReadTools): Promise<AnswerResult> {
    await tools.searchVault(input.question);
    const note = await tools.readNote("Areas/Insurance.md");
    return { text: `You have travel insurance with Axa. (${note.length} chars read)`, readPaths: ["Areas/Insurance.md"] };
  }

  /** Scripted work behavior, set per test. */
  workScript: ((tools: VaultReadTools, writeTools: VaultWriteTools) => Promise<string>) | null = null;
  workCalls = 0;

  async work(input: WorkLoopInput, tools: VaultReadTools, writeTools?: VaultWriteTools): Promise<WorkLoopResult> {
    this.workCalls++;
    if (!writeTools) {
      return { text: `PLAN for "${input.objective}":\n- delete Inbox/junk.md — test scratch` };
    }
    const text = this.workScript ? await this.workScript(tools, writeTools) : "did nothing";
    return { text };
  }
}

describe("BrainEngine", () => {
  let dir: string;
  let repo: VaultRepo;
  let llm: FakeLlm;
  let state: SqliteStateStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-engine-"));
    const bare = join(dir, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    await rm(join(seed, ".git"), { recursive: false, force: true }).catch(() => {});
    await cp(FIXTURE, seed, { recursive: true });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "seed").addConfig("user.email", "seed@test");
    await git.add(["-A"]);
    await git.commit("seed vault");
    await git.push("origin", "main");

    repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    llm = new FakeLlm();
    state = new SqliteStateStore(":memory:");
  });

  afterEach(async () => {
    state.close();
    await rm(dir, { recursive: true, force: true });
  });

  function engine() {
    return createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" } });
  }

  it("stores a memory: evidence entry, meaning page, lint-clean commit (DoD #1 shape)", async () => {
    const result = await engine().store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
    });

    expect(result.question).toBeUndefined();
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.evidenceRef).toMatch(/^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[0-9a-f]{6}$/);
    expect(result.githubUrls.some((u) => u.includes("Areas/Insurance.md"))).toBe(true);

    // evidence is verbatim and anchored
    const log = await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8");
    expect(log).toContain("verbatim: yes");
    expect(log).toContain("> I just got travel insurance with Axa");

    // vault stays lint-clean and the commit is pushed
    const report = await engine().lint();
    expect(report.errors).toEqual([]);
    const verify = await VaultRepo.open({ workdir: join(dir, "verify"), remoteUrl: join(dir, "origin.git") });
    expect(await verify.headSha()).toBe(result.commitSha);
  });

  it("low confidence lands as an Inbox stub with a question (DoD #6)", async () => {
    llm.confidence = 0.3;
    const result = await engine().store({ content: "something cryptic", source: "mcp" });

    expect(result.question).toBeTruthy();
    expect(result.pagesTouched[0]).toMatch(/^Inbox\/needs-filing-/);
    const stub = await readFile(join(repo.path, result.pagesTouched[0]!), "utf8");
    expect(stub).toContain("status: needs-filing");
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("retries failed validation, then succeeds (validate-with-retry)", async () => {
    llm.failComposeAttempts = 1;
    const result = await engine().store({ content: "insurance detail", source: "cli" });
    expect(result.question).toBeUndefined();
    expect(llm.composeCalls).toBe(2);
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("falls back to Inbox after exhausting retries — never half-applies", async () => {
    llm.failComposeAttempts = 99;
    const result = await engine().store({ content: "insurance detail", source: "cli" });

    expect(result.question).toContain("could not file it");
    expect(result.pagesTouched[0]).toMatch(/^Inbox\//);
    // the meaning page was NOT half-modified
    const page = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
    expect(page).not.toContain("Broken page");
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("serializes concurrent stores into clean commits (DoD #4)", async () => {
    const e = engine();
    const [a, b] = await Promise.all([
      e.store({ content: "insurance fact one", source: "cli" }),
      e.store({ content: "insurance fact two", source: "mcp" }),
    ]);
    expect(a.commitSha).not.toBe(b.commitSha);

    const log = await simpleGit(repo.path).log();
    const memories = log.all.filter((c) => c.message.startsWith("memory:"));
    expect(memories.length).toBe(2);
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("read path pulls from origin: a search sees pages pushed by another clone", async () => {
    const e = createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" }, readSyncTtlMs: 0 });

    // someone else (laptop, another Zenod) pushes a new page to the vault remote
    const other = join(dir, "other");
    await simpleGit().clone(join(dir, "origin.git"), other);
    const otherGit = simpleGit(other);
    await otherGit.addConfig("user.name", "other").addConfig("user.email", "other@test");
    await writeFile(
      join(other, "Notes/Padel.md"),
      "---\ntitle: Padel\ntype: note\ntags: []\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Padel racket research.\n---\n\n# Padel\n\nBought a padel racket.\n",
    );
    await otherGit.add(["-A"]);
    await otherGit.commit("add padel note");
    await otherGit.push("origin", "main");

    const hits = await e.search("padel");
    expect(hits.map((h) => h.path)).toContain("Notes/Padel.md");
  });

  it("read sync is throttled: within the TTL no pull happens", async () => {
    const e = createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" }, readSyncTtlMs: 60_000 });
    await e.search("insurance"); // first read syncs

    const other = join(dir, "other");
    await simpleGit().clone(join(dir, "origin.git"), other);
    const otherGit = simpleGit(other);
    await otherGit.addConfig("user.name", "other").addConfig("user.email", "other@test");
    await writeFile(join(other, "Notes/Squash.md"), "---\ntitle: Squash\ntype: note\ntags: []\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Squash gear.\n---\n\n# Squash\n\nSquash racket.\n");
    await otherGit.add(["-A"]);
    await otherGit.commit("add squash note");
    await otherGit.push("origin", "main");

    const hits = await e.search("squash");
    expect(hits.map((h) => h.path)).not.toContain("Notes/Squash.md");
  });

  it("answers with citations from the read paths (DoD #2 shape)", async () => {
    const answer = await engine().ask("what do I know about my insurance?");
    expect(answer.text).toContain("Axa");
    expect(answer.sources[0]?.path).toBe("Areas/Insurance.md");
    expect(answer.sources[0]?.githubUrl).toContain("github.com/zenod-ai/fixture");
  });

  it("work without a plan proposes and commits nothing", async () => {
    const before = await repo.headSha();
    const result = await engine().work({ objective: "sweep the Inbox" });

    expect(result.mode).toBe("proposal");
    expect(result.committed).toBe(false);
    expect(result.text).toContain("PLAN");
    expect(await repo.headSha()).toBe(before);
  });

  it("work with an approved plan executes, validates, and lands one commit", async () => {
    // seed a junk file the librarian will sweep
    await writeFile(join(repo.path, "Inbox/junk.md"), "scratch\n");
    await simpleGit(repo.path).add(["-A"]).commit("seed junk").push("origin", "main");

    llm.workScript = async (_tools, writeTools) => {
      await writeTools.deleteNote("Inbox/junk.md");
      await writeTools.writeNote(
        "Notes/Swept.md",
        "---\ntitle: Swept\ntype: note\ntags: []\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Filed from the Inbox sweep.\n---\n\n# Swept\n\nContent rescued from junk. Related: [[Notes/Axa|Axa]]\n",
      );
      return "sweep the Inbox: deleted junk.md, filed Swept.md\ndetails...";
    };
    const result = await engine().work({ objective: "sweep the Inbox", plan: "- delete Inbox/junk.md\n- file Notes/Swept.md" });

    expect(result.mode).toBe("executed");
    expect(result.committed).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.changedPaths).toContain("Notes/Swept.md");
    await expect(readFile(join(repo.path, "Inbox/junk.md"), "utf8")).rejects.toThrow();
    expect((await engine().lint()).errors).toEqual([]);

    // one commit, pushed, message from the loop summary
    const log = await simpleGit(repo.path).log();
    expect(log.latest?.message).toBe("work: sweep the Inbox: deleted junk.md, filed Swept.md");
    const verify = await VaultRepo.open({ workdir: join(dir, "verify-work"), remoteUrl: join(dir, "origin.git") });
    expect(await verify.headSha()).toBe(result.commitSha);
  });

  it("work tools reject the evidence tier and path escapes", async () => {
    const errors: string[] = [];
    llm.workScript = async (_tools, writeTools) => {
      for (const attempt of [
        () => writeTools.deleteNote("Log/2026-06-10.md"),
        () => writeTools.writeNote("Log/2026-06-10.md", "tampered"),
        () => writeTools.moveNote("Log/2026-06-10.md", "Notes/Stolen.md"),
        () => writeTools.writeNote("../outside.md", "escape"),
      ]) {
        await attempt().catch((err: Error) => errors.push(err.message));
      }
      return "could not touch evidence";
    };
    const result = await engine().work({ objective: "tamper", plan: "tamper with the log" });

    expect(errors.length).toBe(4);
    expect(result.mode).toBe("executed");
    expect(result.committed).toBe(false); // nothing changed, nothing committed
    const log = await readFile(join(repo.path, "Log/2026-06-10.md"), "utf8");
    expect(log).not.toContain("tampered");
  });

  it("work rolls back fully when validation keeps failing", async () => {
    llm.workScript = async (_tools, writeTools) => {
      await writeTools.writeNote("Notes/Broken.md", "# no frontmatter at all\n");
      return "wrote a broken page";
    };
    const result = await engine().work({ objective: "break things", plan: "write a broken page" });

    expect(result.mode).toBe("failed");
    expect(result.committed).toBe(false);
    expect(llm.workCalls).toBe(3); // initial + 2 retries
    await expect(readFile(join(repo.path, "Notes/Broken.md"), "utf8")).rejects.toThrow();
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("chat persists the conversation window and can trigger a store", async () => {
    const e = engine();
    const reply = await e.chat("please remember this: I renewed my insurance today", "web");
    expect(reply.stored).toBeDefined();
    expect(reply.text).toBeTruthy();

    const window = await state.recentWindow("default:web");
    expect(window.length).toBe(2);
    expect(window[0]?.role).toBe("user");
    expect(window[1]?.role).toBe("assistant");
  });
});

describe("SqliteStateStore window", () => {
  it("caps the window at 20 messages", async () => {
    const store = new SqliteStateStore(":memory:");
    for (let i = 0; i < 30; i++) await store.appendMessage("c", "user", `m${i}`, "cli");
    const window = await store.recentWindow("c");
    expect(window.length).toBe(20);
    expect(window.at(-1)?.text).toBe("m29");
    store.close();
  });
});
