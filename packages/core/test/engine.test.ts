import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine, LONG_MEMORY_SEGMENT_CHARS } from "../src/engine/engine.js";
import { __resetApprovalTokens } from "../src/approvalTokens.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { TokenCostMeasurement } from "../src/types.js";
import type {
  AnswerInput,
  AnswerResult,
  BacklogExtractInput,
  BacklogExtractResult,
  BrainLlm,
  Classification,
  ClassifyInput,
  ComposePageInput,
  PeerTools,
  VaultReadTools,
  VaultTaskTools,
  VaultWriteTools,
  WorkLoopInput,
  WorkLoopResult,
} from "../src/llm/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/vault", import.meta.url));

/** Deterministic fake LLM: files insurance content onto Areas/Insurance.md. */
class FakeLlm implements BrainLlm {
  classifyCalls = 0;
  classifyInputs: ClassifyInput[] = [];
  failClassifyAttempts = 0;
  composeCalls = 0;
  confidence = 0.95;
  failComposeAttempts = 0;
  classifyPath: string | null = "Areas/Insurance.md";
  answerInputs: AnswerInput[] = [];
  answerOverride: ((input: AnswerInput, tools: VaultReadTools) => Promise<AnswerResult>) | null = null;
  workInputs: WorkLoopInput[] = [];

  async classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls++;
    this.classifyInputs.push(input);
    if (this.classifyCalls <= this.failClassifyAttempts) throw new Error("empty structured classification");
    return {
      confidence: this.confidence,
      summary: "note new insurance fact",
      tags: ["insurance"],
      pages: this.classifyPath
        ? [{ path: this.classifyPath, action: "update", title: "Insurance" }]
        : [],
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

  async answer(input: AnswerInput, tools: VaultReadTools, taskTools?: VaultTaskTools, _driveTools?: unknown, peerTools?: PeerTools): Promise<AnswerResult> {
    this.answerInputs.push(input);
    if (this.answerOverride) return this.answerOverride(input, tools);
    if (taskTools && input.question.startsWith("BACKLOG:")) {
      const result = await taskTools.digestBacklog({
        rawText: input.question.slice(8).trim(),
        sourceRefs: [{ path: "Log/2026-06-13.md#^e-chat", githubUrl: "" }],
      });
      return { text: `Backlog candidates: ${result.candidates.map((c) => c.title).join(", ")}`, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("CREATEISSUE:")) {
      const url = await taskTools.createIssue({
        repo: "zenod-ai/zenod",
        title: input.question.slice("CREATEISSUE:".length).trim(),
        body: "Created from tasking test.",
        labels: ["from-tasking"],
      });
      return { text: url, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("EMPTYAFTERCREATE:")) {
      // The model ran a tool but produced no closing text (exhausted its step
      // budget mid-tool-call) — generateText returns "" here.
      await taskTools.createIssue({
        repo: "zenod-ai/zenod",
        title: input.question.slice("EMPTYAFTERCREATE:".length).trim(),
        body: "Created from tasking test.",
        labels: ["from-tasking"],
      });
      return { text: "", readPaths: [] };
    }
    if (taskTools && input.question.startsWith("EMPTYNOOP:")) {
      return { text: "   ", readPaths: [] };
    }
    if (taskTools && input.question.startsWith("FABRICATECREATE:")) {
      // Reproduce the real bug: the create call fails, but the model swallows the
      // error and narrates a confident, fully-fabricated success (number + url).
      try {
        await taskTools.createIssue({
          repo: "zenod-ai/zenod",
          title: input.question.slice("FABRICATECREATE:".length).trim(),
          body: "Created from tasking test.",
          labels: ["from-tasking"],
        });
      } catch {
        // swallowed — exactly the failure mode we're guarding against
      }
      return {
        text: "Done. Created:\n• #58 — Market research on idealista_scraper repo\nhttps://github.com/AlfaBlok/obsidian-brain/issues/58\nStatus: proposed (not queued).",
        readPaths: [],
      };
    }
    if (taskTools && input.question.startsWith("CREATEQUEUEDISSUE:")) {
      const url = await taskTools.createIssue({
        repo: "zenod-ai/zenod",
        title: input.question.slice("CREATEQUEUEDISSUE:".length).trim(),
        body: "Created from tasking test.",
        labels: ["owner:agent", "status:queued"],
      });
      return { text: url, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("LABELQUEUEDISSUE")) {
      const text = await taskTools.labelIssue({
        repo: "zenod-ai/zenod",
        issueNumber: 52,
        labels: ["status:queued", "owner:agent"],
      });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("EDITISSUE:")) {
      const text = await taskTools.editIssue({
        repo: "zenod-ai/zenod",
        issueNumber: 90,
        body: "## Objective\nBroadened scope: also convert the SVG to PNG before attaching.",
        status: "needs-update",
      });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("EDITISSUEBLANKS:")) {
      const text = await taskTools.editIssue({
        repo: "zenod-ai/zenod",
        issueNumber: 91,
        title: "",
        body: "",
        labelsAdd: ["codex-live-test"],
        comment: "post the smoke-test comment",
        status: "",
      });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("DUPLICATEEDIT:")) {
      const edit = {
        repo: "zenod-ai/zenod",
        issueNumber: 92,
        comment: "post the smoke-test comment once",
      };
      const first = await taskTools.editIssue(edit);
      const second = await taskTools.editIssue(edit);
      return { text: `${first}\n${second}`, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("QUERYBACKLOG")) {
      const text = await taskTools.queryBacklog("open issues");
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("SERVICEBACKLOG")) {
      const text = await taskTools.serviceBacklog("ready");
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("APPROVEQUEUE:")) {
      const numbers = input.question
        .slice("APPROVEQUEUE:".length)
        .trim()
        .split(/\s+/)
        .map((n) => Number(n));
      const text = await taskTools.approveQueue({ repo: "zenod-ai/fixture", issueNumbers: numbers });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("LABELAPPROVEDMERGE")) {
      const text = await taskTools.labelIssue({
        repo: "zenod-ai/zenod",
        issueNumber: 44,
        labels: ["status:approved-merge", "owner:agent"],
      });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("APPROVEMERGE:")) {
      const numbers = input.question
        .slice("APPROVEMERGE:".length)
        .trim()
        .split(/\s+/)
        .map((n) => Number(n));
      const text = await taskTools.approveMerge({ repo: "zenod-ai/fixture", issueNumbers: numbers });
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("EXEC:")) {
      const text = await taskTools.executeTask(input.question.slice(5).trim(), "approved plan");
      return { text, readPaths: [] };
    }
    if (taskTools && input.question.startsWith("CAPTURE:")) {
      const result = await taskTools.captureNote(input.question.slice("CAPTURE:".length).trim());
      // A real model would see the queued tool result and acknowledge without
      // claiming a commit; mirror that here.
      return { text: result.queued ? "Got it — capturing that in the background." : `Filed: ${result.evidenceRef}`, readPaths: [] };
    }
    if (peerTools && input.question.startsWith("PEEREXECSTATUS:")) {
      const tool = peerTools.epaminon_read_issue_execution_status;
      if (!tool) {
        throw new Error("missing execution status peer tool");
      }
      const toolInput = { target: input.question.slice("PEEREXECSTATUS:".length).trim() };
      const result = await tool.run(toolInput);
      input.onPeerAction?.("epaminon_read_issue_execution_status", toolInput, result);
      return { text: result, readPaths: [] };
    }
    if (peerTools && input.question.startsWith("TRANSCRIPTSTATUS:")) {
      // P-3 — a multi-task status summary that reads the conversation transcript (the
      // outbound message log) but still narrates one task as "unexecuted" even though
      // its send is right there in the transcript result.
      const tool = peerTools.get_recent_conversation_transcript;
      if (!tool) {
        throw new Error("missing conversation transcript peer tool");
      }
      const toolInput = { windowMinutes: 240 };
      const result = await tool.run(toolInput);
      input.onPeerAction?.("get_recent_conversation_transcript", toolInput, result);
      return {
        text: "Task 1: created the issue, done.\nTask 2: send the WhatsApp update to Jordi via Phylax — unexecuted.\nTask 3: still queued.",
        readPaths: [],
      };
    }
    if (input.question.startsWith("READRECAP:")) {
      // FP4 · #548 ledger invariant — a read tool (search_chats) runs and reports its
      // result via onReadAction exactly as aisdk now does. The engine must record it in
      // the actions array reconcile receives; the model then enumerates existing issue
      // numbers as a recap. If the read were NOT recorded, reconcile would see empty
      // actions and slap a spurious "no GitHub issue was created" banner on the recap.
      input.onReadAction?.("search_chats", { query: "recent work" }, "conversation hits about the tickets");
      return { text: "Earlier we discussed #601 and #602; you also opened #588 last week.", readPaths: [] };
    }
    await tools.searchVault(input.question);
    const note = await tools.readNote("Areas/Insurance.md");
    const text = `You have travel insurance with Axa. (${note.length} chars read)`;
    if (input.onTextDelta) {
      // Emit in two chunks to mirror a real streaming response.
      const mid = Math.floor(text.length / 2);
      input.onTextDelta(text.slice(0, mid));
      input.onTextDelta(text.slice(mid));
    }
    return { text, readPaths: ["Areas/Insurance.md"] };
  }

  /** Scripted work behavior, set per test. */
  workScript: ((tools: VaultReadTools, writeTools: VaultWriteTools) => Promise<string>) | null = null;
  workCalls = 0;

  async work(input: WorkLoopInput, tools: VaultReadTools, writeTools?: VaultWriteTools): Promise<WorkLoopResult> {
    this.workCalls++;
    this.workInputs.push(input);
    if (!writeTools) {
      return { text: `PLAN for "${input.objective}":\n- delete Inbox/junk.md — test scratch` };
    }
    const text = this.workScript ? await this.workScript(tools, writeTools) : "did nothing";
    return { text };
  }

  async extractBacklog(input: BacklogExtractInput): Promise<BacklogExtractResult> {
    const refs = input.sourceRefs.length > 0 ? input.sourceRefs : [{ path: "Log/2026-06-13.md", githubUrl: "" }];
    const lower = input.content.toLowerCase();
    const make = (
      title: string,
      type: "action" | "question-action" | "blocker" | "roadmap" | "follow-up",
      extras: Partial<BacklogExtractResult["candidates"][number]> = {},
    ): BacklogExtractResult["candidates"][number] => ({
      title,
      type,
      owner: "agent",
      priority: type === "blocker" ? "P0" : "P1",
      status: type === "question-action" ? "needs-clarification" : type === "blocker" ? "blocked" : "ready",
      source_refs: refs,
      summary: "Extracted from the supplied memory.",
      context: "The source names the next step explicitly.",
      acceptance_criteria: ["The next step is captured with evidence."],
      dependencies: [],
      open_questions: type === "question-action" ? ["Clarify the next executable step."] : [],
      difficulty: "medium",
      suggested_labels: ["backlog", "digested"],
      target_repo: "zenod-ai/zenod",
      ...extras,
    });

    if (lower.includes("zenod 3 voice note")) {
      return {
        candidates: [
          make("Extract launch blockers into backlog", "blocker"),
          make("Build clean-slate onboarding", "action"),
          make("Design two-phase ingestion UX", "action"),
          make("Draft launch writing", "action"),
          make("Review public UX and docs", "follow-up"),
          make("Write proposed backlog records or GitHub issues", "action"),
        ],
      };
    }

    if (lower.includes("zenod 4 voice note")) {
      return {
        candidates: [
          make("Improve object handling for source artifacts", "action"),
          make("Create proposed backlog UI", "roadmap"),
          make("Model difficulty and dependencies", "action", { dependencies: ["Backlog candidate schema"] }),
          make("Capture scoping question-actions", "question-action"),
          make("Answer agent orchestration ownership questions", "question-action"),
        ],
      };
    }

    return {
      candidates: [
        {
          title: lower.includes("question") ? "Answer launch orchestration question" : "Renew travel insurance",
          type: lower.includes("blocker") ? "blocker" : lower.includes("question") ? "question-action" : "action",
          owner: lower.includes("human") ? "human" : "agent",
          priority: lower.includes("launch") || lower.includes("blocker") ? "P0" : "P1",
          status: lower.includes("question") ? "needs-clarification" : "ready",
          source_refs: refs,
          summary: "Extracted from the supplied memory.",
          context: "The source names the next step explicitly.",
          acceptance_criteria: ["The next step is captured with evidence."],
          dependencies: lower.includes("dependency") ? ["Resolve dependency"] : [],
          open_questions: lower.includes("question") ? ["Which agent should own orchestration?"] : [],
          difficulty: "medium",
          suggested_labels: ["backlog", "digested"],
          target_repo: "zenod-ai/zenod",
        },
      ],
    };
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

    expect(result.filing).toBe("filed");
    expect(result).not.toHaveProperty("question");
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.evidenceRef).toMatch(/^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[0-9a-f]{6}$/);
    expect(result.evidenceUrl).toBe(`https://github.com/zenod-ai/fixture/blob/${result.commitSha}/Log/${result.evidenceRef.slice(4, 14)}.md${new URL(result.evidenceUrl!).hash}`);
    expect(result.evidenceUrl).toMatch(/\/blob\/[0-9a-f]{40}\/Log\/\d{4}-\d{2}-\d{2}\.md#L\d+$/);
    expect(result.pageUrls).toEqual([`https://github.com/zenod-ai/fixture/blob/${result.commitSha}/Areas/Insurance.md`]);
    expect(result.githubUrls.some((u) => u.includes("Areas/Insurance.md"))).toBe(true);

    // evidence is verbatim and anchored
    const log = await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8");
    const linkedLine = Number(new URL(result.evidenceUrl!).hash.match(/^#L(\d+)$/)?.[1]);
    expect(log.split("\n")[linkedLine - 1]).toContain(result.evidenceRef.split("#^")[1]);
    expect(log).toContain("verbatim: yes");
    expect(log).toContain("> I just got travel insurance with Axa");

    // vault stays lint-clean and the commit is pushed
    const report = await engine().lint();
    expect(report.errors).toEqual([]);
    const verify = await VaultRepo.open({ workdir: join(dir, "verify"), remoteUrl: join(dir, "origin.git") });
    expect(await verify.headSha()).toBe(result.commitSha);
  });

  it("normalizes classifier meaning-page paths to .md before writing", async () => {
    llm.classifyPath = "Areas/Insurance";
    const result = await engine().store({
      content: "I just got travel insurance with Axa, policy ends March 2027.",
      source: "cli",
    });

    expect(result.filing).toBe("filed");
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    await expect(readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).resolves.toContain("# Insurance");
    await expect(readFile(join(repo.path, "Areas/Insurance"), "utf8")).rejects.toThrow();
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("low confidence with a candidate appends a searchable, removable, lint-clean uncertainty block (DoD #6)", async () => {
    llm.confidence = 0.3;
    const pagePath = "Areas/Insurance.md";
    const originalPage = await readFile(join(repo.path, pagePath), "utf8");
    const result = await engine().store({ content: "something cryptic", source: "mcp" });

    expect(result.filing).toBe("uncertain");
    expect(result).not.toHaveProperty("question");
    expect(result.pagesTouched).toEqual([pagePath]);
    expect(llm.composeCalls).toBe(0);

    const page = await readFile(join(repo.path, pagePath), "utf8");
    expect(page).toMatch(/## Unverified capture — \d{4}-\d{2}-\d{2}  \^uc-e-[0-9a-f]{6}/);
    expect(page).toContain("#filing/uncertain");
    expect(page).toContain("> [!question] Which area does this belong to?");
    expect(page).toMatch(/> Evidence: \[\[\d{4}-\d{2}-\d{2}#\^e-[0-9a-f]{6}\]\] · confidence 0\.30/);
    expect(page).toContain("> something cryptic");
    expect((await engine().lint()).errors).toEqual([]);

    const byContent = await engine().search("something cryptic");
    expect(byContent.some((hit) => hit.path === pagePath)).toBe(true);
    const byTag = await engine().search("filing/uncertain");
    expect(byTag.some((hit) => hit.path === pagePath)).toBe(true);

    await writeFile(join(repo.path, pagePath), originalPage);
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("low confidence without candidates lands as an Inbox stub", async () => {
    llm.confidence = 0.3;
    llm.classifyPath = null;
    const result = await engine().store({ content: "something with no candidate", source: "mcp" });

    expect(result.filing).toBe("inbox");
    expect(result).not.toHaveProperty("question");
    expect(result.pagesTouched[0]).toMatch(/^Inbox\/needs-filing-/);
    const stub = await readFile(join(repo.path, result.pagesTouched[0]!), "utf8");
    expect(stub).toContain("status: needs-filing");
    expect(stub).toContain("Which area does this belong to?");
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("retries an unparsable classification, then saves the raw capture to Inbox", async () => {
    llm.failClassifyAttempts = 99;
    const content = "Remember the image text exactly: FyLax launch label.";
    const result = await engine().store({ content, source: "whatsapp", contentType: "image", verbatim: true });

    expect(llm.classifyCalls).toBe(2);
    expect(result.filing).toBe("inbox");
    const log = await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8");
    const inbox = await readFile(join(repo.path, result.pagesTouched[0]!), "utf8");
    expect(log).toContain(content);
    expect(inbox).toContain(content);
    expect(inbox).toContain("Saved, but automatic filing is pending");
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("classifies a long voice note in bounded segments while retaining source entity spellings", async () => {
    const content = [
      `Alpha topic PhylaxBridge ${"a".repeat(8_500)}`,
      `Beta topic ZedNaught ${"b".repeat(8_500)}`,
      `Gamma topic FilexDirect ${"c".repeat(8_500)}`,
    ].join("\n\n");
    const result = await engine().store({ content, source: "whatsapp", contentType: "voice_note", verbatim: true });

    expect(result.filing).toBe("filed");
    expect(llm.classifyInputs.length).toBe(3);
    expect(llm.classifyInputs.every((input) => input.content.length <= LONG_MEMORY_SEGMENT_CHARS)).toBe(true);
    expect(llm.classifyInputs.map((input) => input.content).join("\n\n")).toContain("Gamma topic FilexDirect");
    expect(llm.classifyInputs[0]?.hints.join(" ")).toContain("PhylaxBridge");
    expect(llm.composeCalls).toBe(1);
    const log = await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8");
    expect(log).toContain("ZedNaught");
    expect(log).toContain("FilexDirect");
  });

  it("retries failed validation, then succeeds (validate-with-retry)", async () => {
    llm.failComposeAttempts = 1;
    const result = await engine().store({ content: "insurance detail", source: "cli" });
    expect(result.filing).toBe("filed");
    expect(llm.composeCalls).toBe(2);
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("falls back to Inbox after exhausting retries — never half-applies", async () => {
    llm.failComposeAttempts = 99;
    const result = await engine().store({ content: "insurance detail", source: "cli" });

    expect(result.filing).toBe("inbox");
    expect(result.pagesTouched[0]).toMatch(/^Inbox\//);
    const stub = await readFile(join(repo.path, result.pagesTouched[0]!), "utf8");
    expect(stub).toContain("could not file it");
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

  it("grounds ask contextRefs on the exact evidence block first", async () => {
    const logPath = "Log/2026-07-29.md";
    const contextRef = `${logPath}#^e-a1b2c3`;
    await writeFile(
      join(repo.path, logPath),
      [
        "# 2026-07-29",
        "",
        "## 10:00 Mechanical capture ^e-a1b2c3",
        "- source: whatsapp",
        "",
        "> The launch code is Quartz-417.",
        "",
        "## 10:05 Unrelated entry ^e-d4e5f6",
        "",
        "> The distractor code is Onyx-999.",
        "",
      ].join("\n"),
    );
    llm.answerOverride = async (input, tools) => {
      expect(input.vaultBriefing).toMatch(/^PINNED EVIDENCE CONTEXT/);
      expect(input.vaultBriefing).toContain("Quartz-417");
      expect(input.vaultBriefing).not.toContain("Onyx-999");
      expect(input.vaultBriefing).not.toContain("Active insurance policies");
      expect(input.hostInstruction).toContain("answer directly from the pinned evidence");
      const reread = await tools.readNote!(logPath);
      expect(reread).toContain("Quartz-417");
      expect(reread).not.toContain("Onyx-999");
      return {
        text: "The launch code is Quartz-417. [[2026-07-29#^e-a1b2c3]]",
        readPaths: [],
      };
    };

    const answer = await engine().ask("What does that say?", { contextRefs: [contextRef] });

    expect(answer.text).toContain("Quartz-417");
    expect(answer.text).toContain("^e-a1b2c3");
    expect(answer.sources[0]).toEqual({
      path: contextRef,
      githubUrl: expect.stringContaining("Log/2026-07-29.md"),
    });
  });

  it("keeps multiple pinned anchors from the same daily log in the grounding corpus", async () => {
    const logPath = "Log/2026-07-29.md";
    const firstRef = `${logPath}#^e-a1b2c3`;
    const secondRef = `${logPath}#^e-d4e5f6`;
    await writeFile(
      join(repo.path, logPath),
      [
        "# 2026-07-29",
        "",
        "## 10:00 First capture ^e-a1b2c3",
        "",
        "> The first code is Quartz-417.",
        "",
        "## 10:05 Second capture ^e-d4e5f6",
        "",
        "> The second code is Cobalt-318.",
        "",
        "## 10:10 Distractor ^e-abcdef",
        "",
        "> The unrelated code is Onyx-999.",
        "",
      ].join("\n"),
    );
    llm.answerOverride = async (input) => {
      expect(input.vaultBriefing).not.toContain("Onyx-999");
      return {
        text: "Quartz-417 [[2026-07-29#^e-a1b2c3]] and Cobalt-318 [[2026-07-29#^e-d4e5f6]].",
        readPaths: [],
      };
    };

    const answer = await engine().ask("Compare those two captures.", {
      contextRefs: [firstRef, secondRef],
    });

    expect(answer.text).toContain("Quartz-417");
    expect(answer.text).toContain("Cobalt-318");
    expect(answer.text).toContain("^e-a1b2c3");
    expect(answer.text).toContain("^e-d4e5f6");
    expect(answer.sources.map((source) => source.path)).toEqual([firstRef, secondRef]);
  });

  it("fails honestly when a context ref is invalid, missing, or absent from this vault", async () => {
    const e = engine();

    await expect(e.ask("What does it say?", { contextRefs: ["../other-tenant/Log.md#^e-a1b2c3"] }))
      .rejects.toThrow(/invalid evidence context ref/i);
    await expect(e.ask("What does it say?", { contextRefs: ["Log/2026-07-29.md#^e-a1b2c3"] }))
      .rejects.toThrow(/unavailable in this tenant/i);
  });

  it("resolves a colliding context ref only inside the current tenant vault", async () => {
    const contextRef = "Log/2026-07-29.md#^e-a1b2c3";
    await writeFile(
      join(repo.path, "Log/2026-07-29.md"),
      "# 2026-07-29\n\n## Tenant A capture ^e-a1b2c3\n\n> Alpha-111 belongs only to tenant A.\n",
    );

    const tenantBBare = join(dir, "tenant-b.git");
    await simpleGit().init(["--bare", "--initial-branch=main", tenantBBare]);
    const tenantBSeed = join(dir, "tenant-b-seed");
    await simpleGit().clone(tenantBBare, tenantBSeed);
    await rm(join(tenantBSeed, ".git"), { recursive: false, force: true }).catch(() => {});
    await cp(FIXTURE, tenantBSeed, { recursive: true });
    await writeFile(
      join(tenantBSeed, "Log/2026-07-29.md"),
      "# 2026-07-29\n\n## Tenant B capture ^e-a1b2c3\n\n> Beta-222 belongs only to tenant B.\n",
    );
    const tenantBGit = simpleGit(tenantBSeed);
    await tenantBGit.addConfig("user.name", "tenant-b").addConfig("user.email", "tenant-b@test");
    await tenantBGit.add(["-A"]);
    await tenantBGit.commit("seed tenant B vault");
    await tenantBGit.push("origin", "main");
    const tenantBRepo = await VaultRepo.open({ workdir: join(dir, "tenant-b-work"), remoteUrl: tenantBBare });
    const tenantBLlm = new FakeLlm();
    const tenantBState = new SqliteStateStore(":memory:");
    tenantBLlm.answerOverride = async (input) => {
      expect(input.vaultBriefing).toContain("Beta-222");
      expect(input.vaultBriefing).not.toContain("Alpha-111");
      return { text: "The tenant-local code is Beta-222.", readPaths: [] };
    };

    try {
      const tenantBEngine = createEngine({
        repo: tenantBRepo,
        llm: tenantBLlm,
        state: tenantBState,
        location: { repo: "zenod-ai/tenant-b" },
      });
      const answer = await tenantBEngine.ask("What is the tenant-local code?", {
        contextRefs: [contextRef],
      });
      expect(answer.text).toContain("Beta-222");
      expect(answer.text).not.toContain("Alpha-111");
    } finally {
      tenantBState.close();
    }
  });

  it("keeps quoted mutation words intact in a read-only model answer", async () => {
    llm.answerOverride = async (_input, tools) => {
      await tools.readNote!("Areas/Insurance.md");
      return {
        text: "Done. I saved it and posted the update.",
        readPaths: ["Areas/Insurance.md"],
      };
    };

    const answer = await engine().ask("What insurance do I have?");

    expect(answer.text).toBe("Done. I saved it and posted the update.");
  });

  it("removes an invented exact literal and invalid anchor from a same-log distractor replay", async () => {
    const logPath = "Log/2026-07-11.md";
    await writeFile(
      join(repo.path, logPath),
      [
        "# 2026-07-11",
        "",
        "## 01:10 Aurora Kestrel fixture ^e-06dada",
        "- source: mcp",
        "",
        "> ZNMT-I1-20260711-A-L2 says Aurora Kestrel uses Amber-902.",
        "",
        "## 01:20 Later distractor ^e-c0ba17",
        "- source: mcp",
        "",
        "> An unrelated L3 fixture mentions Cobalt-471.",
        "",
      ].join("\n"),
    );
    llm.answerOverride = async (_input, tools) => {
      await tools.readNote!(logPath);
      return {
        text: [
          "Aurora Kestrel uses Amber-902. [[2026-07-11#^e-06dada]]",
          "It also uses Cobalt-471. [[2026-07-11#^e-06cada]]",
        ].join("\n"),
        readPaths: [logPath],
      };
    };

    const answer = await engine().ask("For ZNMT-I1-20260711-A-L2, what code belongs to Aurora Kestrel?");

    expect(answer.text).toContain("Amber-902");
    expect(answer.text).toContain("^e-06dada");
    expect(answer.text).not.toContain("Cobalt-471");
    expect(answer.text).not.toContain("^e-06cada");
    expect(answer.text).not.toContain("It also uses");
    expect(answer.sources).toEqual([
      expect.objectContaining({ path: logPath, githubUrl: expect.stringContaining(logPath) }),
    ]);
  });

  it("retains supported exact literals and valid evidence links from the scoped entry", async () => {
    const logPath = "Log/2026-07-11.md";
    await writeFile(
      join(repo.path, logPath),
      [
        "# 2026-07-11",
        "",
        "## 01:10 Aurora Kestrel fixture ^e-06dada",
        "",
        "> Aurora Kestrel uses Amber-902.",
        "",
      ].join("\n"),
    );
    llm.answerOverride = async (_input, tools) => {
      await tools.readNote!(logPath);
      return {
        text: "Aurora Kestrel uses Amber-902 ([evidence](https://github.com/zenod-ai/fixture/blob/main/Log/2026-07-11.md#^e-06dada)).",
        readPaths: [logPath],
      };
    };

    const answer = await engine().ask("What code belongs to Aurora Kestrel?");

    expect(answer.text).toContain("Amber-902");
    expect(answer.text).toContain("https://github.com/zenod-ai/fixture/blob/main/Log/2026-07-11.md#^e-06dada");
  });

  it("bounds vaultBriefing and reports briefing token cost separately", async () => {
    await mkdir(join(repo.path, "Notes"), { recursive: true });
    await mkdir(join(repo.path, "Log"), { recursive: true });
    await mkdir(join(repo.path, "_attachments/generated"), { recursive: true });

    for (let i = 1; i <= 100; i++) {
      const n = String(i).padStart(3, "0");
      await writeFile(
        join(repo.path, `Notes/Generated-${n}.md`),
        [
          "---",
          `title: Generated ${n}`,
          "type: note",
          "tags: []",
          "created: 2026-06-13",
          "updated: 2026-06-13",
          `summary: ${"Long generated summary ".repeat(30)}${n}.`,
          "---",
          "",
          `# Generated ${n}`,
          "",
          "Synthetic content for briefing cap tests. Related: [[Notes/Axa|Axa]]",
          "",
        ].join("\n"),
      );
    }
    for (let i = 1; i <= 30; i++) {
      const day = String(i).padStart(2, "0");
      await writeFile(join(repo.path, `Log/2026-07-${day}.md`), `# 2026-07-${day}\n\nentry ^e-${String(i).padStart(6, "0")}\n`);
    }
    for (let i = 1; i <= 50; i++) {
      await writeFile(join(repo.path, `_attachments/generated/file-${String(i).padStart(3, "0")}.txt`), "artifact\n");
    }
    await simpleGit(repo.path).add(["-A"]).commit("seed large vault").push("origin", "main");

    const measurements: TokenCostMeasurement[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      onTokenCost: (measurement) => measurements.push(measurement),
    });

    await e.ask("what is in generated note 99?");

    const briefing = llm.answerInputs.at(-1)?.vaultBriefing ?? "";
    expect(briefing).toContain("MAP — meaning pages (80/");
    expect(briefing).toContain("MAP — recent evidence logs (20/");
    expect(briefing).toContain("MAP — recent attachments (40/");
    expect(briefing).not.toContain("Generated 099");
    expect(briefing).not.toContain("Log/2026-07-01.md");
    expect(briefing).not.toContain("_attachments/generated/file-001.txt");

    const askCost = measurements.find((m) => m.operation === "ask");
    expect(askCost?.estimatedBriefingTokens).toBeGreaterThan(0);
    expect(askCost?.estimatedInputTokens).toBeGreaterThan(askCost?.estimatedBriefingTokens ?? 0);
    expect(askCost?.briefingSections?.meaningPages.included).toBe(80);
    expect(askCost?.briefingSections?.meaningPages.omitted).toBeGreaterThan(0);
    expect(askCost?.briefingSections?.evidenceLogs.included).toBe(20);
    expect(askCost?.briefingSections?.attachments.included).toBe(40);
  });

  it("digests raw transcript text into structured backlog candidates with source refs", async () => {
    const result = await engine().digestBacklog({
      rawText: "Launch blocker: question for orchestration ownership has a dependency.",
      sourceRefs: [{ path: "Log/2026-06-13.md#^e-test01", githubUrl: "https://github.com/zenod-ai/fixture/blob/main/Log/2026-06-13.md" }],
    });

    expect(result.written).toEqual([]);
    expect(result.candidates[0]?.type).toBe("blocker");
    expect(result.candidates[0]?.priority).toBe("P0");
    expect(result.candidates[0]?.source_refs[0]?.path).toBe("Log/2026-06-13.md#^e-test01");
    expect(result.candidates[0]?.acceptance_criteria).toContain("The next step is captured with evidence.");
    expect(result.skipped[0]?.reason).toMatch(/write not requested/);
  });

  it("can materialize proposed backlog records when explicitly requested", async () => {
    const result = await engine().digestBacklog({
      rawText: "Remember to renew travel insurance.",
      sourceRefs: [{ path: "Log/2026-06-13.md#^e-test02", githubUrl: "" }],
      write: true,
    });

    expect(result.written).toHaveLength(1);
    expect(result.written[0]?.path).toMatch(/^Backlog\/.*renew-travel-insurance\.md$/);
    const record = await readFile(join(repo.path, result.written[0]!.path), "utf8");
    expect(record).toContain("## Acceptance Criteria");
    expect(record).toContain("Log/2026-06-13.md#^e-test02");
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("proactively proposes backlog candidates after task-like Drive ingestion", async () => {
    const result = await engine().store({
      content: "Voice note from Drive. Launch blocker: question for agent orchestration ownership.",
      source: "drive",
      verbatim: true,
    });

    expect(result.backlog?.written).toEqual([]);
    expect(result.backlog?.candidates[0]?.status).toBe("needs-clarification");
    expect(result.backlog?.candidates[0]?.source_refs[0]?.path).toBe(result.evidenceRef);
    expect(result.backlog?.skipped[0]?.reason).toMatch(/proposal-only/);
  });

  it("proactively proposes backlog candidates after task-like WhatsApp ingestion", async () => {
    const result = await engine().store({
      content: "WhatsApp voice note transcript. Launch blocker: question for agent orchestration ownership.",
      source: "whatsapp",
      verbatim: true,
    });

    expect(result.backlog?.written).toEqual([]);
    expect(result.backlog?.candidates[0]?.type).toBe("blocker");
    expect(result.backlog?.candidates[0]?.source_refs[0]?.path).toBe(result.evidenceRef);
  });

  it("fixture: Zenod 3 extracts launch backlog themes with citations", async () => {
    const transcript = await readFile(join(FIXTURE, "../backlog/zenod-3-transcript.txt"), "utf8");
    const result = await engine().digestBacklog({
      rawText: transcript,
      sourceRefs: [{ path: "Log/2026-06-13.md#^e-zenod3", githubUrl: "https://github.com/zenod-ai/fixture/blob/main/Log/2026-06-13.md" }],
    });

    expect(result.candidates.map((c) => c.title)).toEqual([
      "Extract launch blockers into backlog",
      "Build clean-slate onboarding",
      "Design two-phase ingestion UX",
      "Draft launch writing",
      "Review public UX and docs",
      "Write proposed backlog records or GitHub issues",
    ]);
    expect(result.candidates.some((c) => c.type === "blocker" && c.priority === "P0")).toBe(true);
    expect(result.candidates.every((c) => c.source_refs[0]?.path === "Log/2026-06-13.md#^e-zenod3")).toBe(true);
  });

  it("fixture: Zenod 4 extracts object handling, dependencies, question-actions, and orchestration", async () => {
    const transcript = await readFile(join(FIXTURE, "../backlog/zenod-4-transcript.txt"), "utf8");
    const result = await engine().digestBacklog({
      rawText: transcript,
      sourceRefs: [{ path: "Log/2026-06-13.md#^e-zenod4", githubUrl: "https://github.com/zenod-ai/fixture/blob/main/Log/2026-06-13.md" }],
    });

    expect(result.candidates.map((c) => c.title)).toContain("Improve object handling for source artifacts");
    expect(result.candidates.some((c) => c.type === "roadmap" && c.title === "Create proposed backlog UI")).toBe(true);
    expect(result.candidates.find((c) => c.title === "Model difficulty and dependencies")?.dependencies).toContain(
      "Backlog candidate schema",
    );
    expect(result.candidates.filter((c) => c.type === "question-action")).toHaveLength(2);
    expect(result.candidates.every((c) => c.source_refs[0]?.path === "Log/2026-06-13.md#^e-zenod4")).toBe(true);
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

  it("chat can execute approved vault work through its task tools", async () => {
    await writeFile(join(repo.path, "Inbox/junk.md"), "scratch\n");
    await simpleGit(repo.path).add(["-A"]).commit("seed junk").push("origin", "main");
    llm.workScript = async (_tools, writeTools) => {
      await writeTools.deleteNote("Inbox/junk.md");
      return "sweep: deleted Inbox/junk.md";
    };

    const reply = await engine().chat("EXEC: sweep the junk", "web");

    expect(reply.text).toContain("Done — the change was verified.");
    expect(reply.text).toMatch(/Commit: `[0-9a-f]{40}`/);
    await expect(readFile(join(repo.path, "Inbox/junk.md"), "utf8")).rejects.toThrow();
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("chat can invoke the backlog digester through its task tools", async () => {
    const reply = await engine().chat("BACKLOG: Launch blocker: question for agent orchestration ownership.", "web");

    expect(reply.text).toContain("Backlog candidates:");
    expect(reply.text).toContain("Answer launch orchestration question");
  });

  it("chat grounds peer-tool execution status replies before reconciliation", async () => {
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      peerTools: {
        epaminon_read_issue_execution_status: {
          description: "Read execution status for an issue.",
          async run(input) {
            expect(input).toEqual({ target: "AlfaBlok/obsidian-brain#122" });
            return "No execution tickets found for AlfaBlok/obsidian-brain#122 (nothing queued/running/done/failed).";
          },
        },
      },
    });

    const reply = await e.chat("PEEREXECSTATUS: AlfaBlok/obsidian-brain#122", "web");

    expect(reply.text).toContain("No execution tickets found");
    expect(reply.text).not.toContain("Correction");
    expect(reply.text).not.toContain("couldn't confirm execution state");
  });

  it("FP4 · #548 ledger invariant: a read-tool (search_chats) result is recorded in actions, so a recap draws no spurious banner", async () => {
    const reply = await engine().chat("READRECAP: what did I work on", "web");
    expect(reply.text).toContain("#601");
    expect(reply.text).not.toContain("⚠️ Correction");
    expect(reply.text).not.toContain("no GitHub issue was created");
  });

  it("P-3: corrects a multi-task status summary that calls a sent task 'unexecuted' using the outbound transcript log", async () => {
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      peerTools: {
        get_recent_conversation_transcript: {
          description: "Read recent WhatsApp transcript.",
          async run() {
            return "[2026-07-03T11:17:00.000Z] outbound Zenod; message=wamid.ABC123; status=sent; chars=42\nHere's your update, Jordi.";
          },
        },
      },
    });

    const reply = await e.handleTasking({ text: "TRANSCRIPTSTATUS: status of my 3 tasks", surface: "web", conversationKey: "p3" });

    expect(reply.text).toMatch(/^⚠️ Correction/);
    expect(reply.text).toContain("actually sent this turn");
    expect(reply.text).toContain("2026-07-03T11:17:00.000Z");
    expect(reply.text).toContain("wamid.ABC123");
  });

  it("handleTasking records digest actions with the selftest surface conversation key", async () => {
    const reply = await engine().handleTasking({
      text: "BACKLOG: Launch blocker: question for agent orchestration ownership.",
      surface: "selftest",
      conversationKey: "issue-25",
    });

    expect(reply.text).toContain("Backlog candidates:");
    expect(reply.actions.map((action) => action.tool)).toEqual(["runDigest"]);
    expect(reply.actions[0]?.result).toContain("Backlog candidates: 1");
    expect((await state.recentWindow("selftest:issue-25")).map((m) => m.text)).toEqual([
      "BACKLOG: Launch blocker: question for agent orchestration ownership.",
      reply.text,
    ]);
  });

  it("handleTasking reaches issue and backlog tools through injected tasking tools", async () => {
    const calls: string[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue(input) {
          calls.push(`create:${input.repo}:${input.title}:${input.labels?.join(",")}`);
          return "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
        },
        async labelIssue(input) {
          calls.push(`label:${input.repo}:${input.issueNumber}:${input.labels.join(",")}`);
          return "labeled";
        },
        async editIssue(input) {
          calls.push(`edit:${input.repo}:${input.issueNumber}:${input.status}:${(input.body ?? "").slice(0, 6)}`);
          return `Edited #${input.issueNumber}`;
        },
        async queryBacklog(query) {
          calls.push(`query:${query}`);
          return "Open issues: #25 tasking";
        },
        async serviceBacklog(query) {
          calls.push(`service:${query}`);
          return "Eligible set: #25";
        },
        async approveQueue(input) {
          calls.push(`approve:${input.issueNumbers.join(",")}`);
          return `Queued ${input.issueNumbers.map((n) => `#${n}`).join(", ")}`;
        },
      },
    });

    const issue = await e.handleTasking({ text: "CREATEISSUE: Task from WhatsApp", surface: "web", conversationKey: "same" });
    const edit = await e.handleTasking({ text: "EDITISSUE: broaden #90", surface: "whatsapp", conversationKey: "same" });
    const query = await e.handleTasking({ text: "QUERYBACKLOG", surface: "whatsapp", conversationKey: "same" });
    const service = await e.handleTasking({ text: "SERVICEBACKLOG", surface: "web", conversationKey: "same" });

    expect(issue.actions.map((action) => action.tool)).toEqual(["createIssue"]);
    expect(edit.actions.map((action) => action.tool)).toEqual(["editIssue"]);
    expect(query.actions.map((action) => action.tool)).toEqual(["queryBacklog"]);
    expect(service.actions.map((action) => action.tool)).toEqual(["serviceBacklog"]);
    expect(calls).toEqual([
      "create:zenod-ai/zenod:Task from WhatsApp:from-tasking,status:proposed",
      "edit:zenod-ai/zenod:90:needs-update:## Obj",
      "query:open issues",
      "service:ready",
    ]);
  });

  it("omits blank edit_issue fields before calling the external GitHub editor", async () => {
    const calls: unknown[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "created";
        },
        async labelIssue() {
          return "labeled";
        },
        async editIssue(input) {
          calls.push(input);
          return "edited";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
      },
    });

    const reply = await e.handleTasking({ text: "EDITISSUEBLANKS: comment and label #91", surface: "web", conversationKey: "blank-edit" });

    expect(reply.actions.map((action) => action.tool)).toEqual(["editIssue"]);
    expect(calls).toEqual([
      {
        repo: "zenod-ai/zenod",
        issueNumber: 91,
        labelsAdd: ["codex-live-test"],
        comment: "post the smoke-test comment",
      },
    ]);
  });

  it("deduplicates identical mutation calls within one tasking turn", async () => {
    const calls: unknown[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "created";
        },
        async labelIssue() {
          return "labeled";
        },
        async editIssue(input) {
          calls.push(input);
          return "Edited #92: https://github.com/zenod-ai/zenod/issues/92";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
      },
    });

    const reply = await e.handleTasking({ text: "DUPLICATEEDIT: comment #92", surface: "web", conversationKey: "duplicate-edit" });

    expect(calls).toEqual([
      {
        repo: "zenod-ai/zenod",
        issueNumber: 92,
        comment: "post the smoke-test comment once",
      },
    ]);
    expect(reply.actions).toEqual([
      {
        tool: "editIssue",
        input: {
          repo: "zenod-ai/zenod",
          issueNumber: 92,
          comment: "post the smoke-test comment once",
        },
        result: "Edited #92: https://github.com/zenod-ai/zenod/issues/92",
        mutationAttempt: true,
      },
    ]);
  });

  it("captureNote files in the background — never blocks the tasking reply", async () => {
    const e = engine();
    // Poll the ORIGIN bare repo: it only gains the commit once the background
    // push has fully landed, so awaiting it also rules out a teardown race.
    const originMemoryCommits = async () =>
      (await simpleGit(join(dir, "origin.git")).log()).all.filter((c) => c.message.startsWith("memory:")).length;
    expect(await originMemoryCommits()).toBe(0);

    const reply = await e.handleTasking({
      text: "CAPTURE: I just got travel insurance with Axa, policy ends March 2027",
      surface: "whatsapp",
      conversationKey: "cap",
    });

    // The reply comes back queued — the librarian pipeline did NOT run on the
    // hot path, so nothing is committed yet and the reply claims no commit.
    const capture = reply.actions.find((action) => action.tool === "capture");
    expect(capture?.result).toMatch(/^Queued:/);
    expect(reply.text).not.toMatch(/Filed:|Commit:/);

    // ...but the note is still filed, just in the background.
    await vi.waitFor(async () => expect(await originMemoryCommits()).toBe(1), { timeout: 5000, interval: 50 });
    expect((await engine().lint()).errors).toEqual([]);
  });

  it("M-5: fires onFilingComplete with the real StoreResult once the background filing lands", async () => {
    const filed: unknown[] = [];
    const e = createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" }, onFilingComplete: (result) => filed.push(result) });

    await e.handleTasking({
      text: "CAPTURE: I just got home insurance with Axa, policy ends March 2028",
      surface: "whatsapp",
      conversationKey: "cap-onfilingcomplete",
    });

    await vi.waitFor(() => expect(filed).toHaveLength(1), { timeout: 5000, interval: 50 });
    expect(filed[0]).toMatchObject({
      pagesTouched: expect.arrayContaining([expect.any(String)]),
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      evidenceRef: expect.stringMatching(/^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[0-9a-f]{6}$/),
    });
  });

  it("never returns an empty WhatsApp reply — falls back to the real tool results", async () => {
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
        },
        async labelIssue() {
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
      },
    });

    const reply = await e.handleTasking({ text: "EMPTYAFTERCREATE: Real task", surface: "whatsapp", conversationKey: "empty1" });

    expect(reply.text.trim()).not.toBe("");
    expect(reply.text).toContain("Done — the change was verified.");
    expect(reply.text).toContain("https://github.com/zenod-ai/zenod/issues/25");
  });

  it("never returns an empty reply even when no tools ran — sends a retry notice", async () => {
    const reply = await engine().handleTasking({ text: "EMPTYNOOP: nothing", surface: "whatsapp", conversationKey: "empty2" });

    expect(reply.text.trim()).not.toBe("");
    expect(reply.text).toMatch(/rephrasing|try|again/i);
  });

  it("host-renders a genuine createIssue receipt", async () => {
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
        },
        async labelIssue() {
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
      },
    });

    const reply = await e.handleTasking({ text: "CREATEISSUE: Real task", surface: "whatsapp", conversationKey: "ok" });

    expect(reply.text).not.toContain("Correction");
    expect(reply.text).toContain("Done — the change was verified.");
    expect(reply.text).toContain("https://github.com/zenod-ai/zenod/issues/25");
  });

  it("fails honestly when a createIssue call fails and the model fabricates success", async () => {
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        // The create hits a non-existent repo and GitHub 404s — the tool throws,
        // exactly as runtime.createIssue does. The model still narrates success.
        async createIssue() {
          throw new Error("GitHub returned 404: Not Found");
        },
        async labelIssue() {
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
      },
    });

    const reply = await e.handleTasking({ text: "FABRICATECREATE: Phantom task", surface: "whatsapp", conversationKey: "fab" });

    expect(reply.text).toBe("Nothing was changed: no verified same-turn mutation receipt was returned.");
    expect(reply.text).not.toContain("404");
    expect(reply.text).not.toContain("#58");
  });

  it("forces agent-created GitHub issues to proposed instead of queued", async () => {
    const calls: string[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue(input) {
          calls.push(`create:${input.labels?.join(",")}`);
          return "Created issue #52: https://github.com/zenod-ai/zenod/issues/52";
        },
        async labelIssue(input) {
          calls.push(`label:${input.labels.join(",")}`);
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue(input) {
          calls.push(`approve:${input.issueNumbers.join(",")}`);
          return "queued";
        },
        async approveMerge(input) {
          calls.push(`approveMerge:${input.issueNumbers.join(",")}`);
          return "approved-merge";
        },
      },
    });

    const issue = await e.handleTasking({ text: "CREATEQUEUEDISSUE: Human-only queue gate", surface: "web", conversationKey: "same" });
    const label = await e.handleTasking({ text: "LABELQUEUEDISSUE", surface: "web", conversationKey: "same" });
    const mergeLabel = await e.handleTasking({ text: "LABELAPPROVEDMERGE", surface: "web", conversationKey: "same" });

    expect(issue.actions[0]?.input.labels).toEqual(["owner:agent", "status:proposed"]);
    expect(label.actions[0]?.input.labels).toEqual(["status:proposed", "owner:agent"]);
    // The generic label tool can never set status:approved-merge either — it is
    // rewritten to proposed, exactly like status:queued. Only approve_merge sets it.
    expect(mergeLabel.actions[0]?.input.labels).toEqual(["status:proposed", "owner:agent"]);
    expect(calls).toEqual([
      "create:owner:agent,status:proposed",
      "label:status:proposed,owner:agent",
      "label:status:proposed,owner:agent",
    ]);
  });

  it("approveQueue is the one path that promotes to queued (human approval relayed by chat)", async () => {
    const calls: string[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "Created issue #1";
        },
        async labelIssue() {
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue(input) {
          calls.push(`approve:${input.repo}:${input.issueNumbers.join(",")}`);
          return `Queued ${input.issueNumbers.map((n) => `#${n}`).join(", ")}`;
        },
        async approveMerge(input) {
          calls.push(`approveMerge:${input.repo}:${input.issueNumbers.join(",")}`);
          return `Approved merge ${input.issueNumbers.map((n) => `#${n}`).join(", ")}`;
        },
      },
    });

    const res = await e.handleTasking({ text: "APPROVEQUEUE: 51 53", surface: "web", conversationKey: "same" });

    expect(res.actions.map((action) => action.tool)).toEqual(["approveQueue"]);
    expect(res.actions[0]?.input.issueNumbers).toEqual([51, 53]);
    expect(calls).toEqual(["approve:zenod-ai/fixture:51,53"]);
  });

  it("approveMerge is the one path that approves a merge (human approval relayed by chat)", async () => {
    const calls: string[] = [];
    const e = createEngine({
      repo,
      llm,
      state,
      location: { repo: "zenod-ai/fixture" },
      taskingTools: {
        async createIssue() {
          return "Created issue #1";
        },
        async labelIssue() {
          return "labeled";
        },
        async queryBacklog() {
          return "";
        },
        async serviceBacklog() {
          return "";
        },
        async approveQueue() {
          return "queued";
        },
        async approveMerge(input) {
          calls.push(`approveMerge:${input.repo}:${input.issueNumbers.join(",")}`);
          return `Approved merge ${input.issueNumbers.map((n) => `#${n}`).join(", ")}`;
        },
      },
    });

    const res = await e.handleTasking({ text: "APPROVEMERGE: 44", surface: "web", conversationKey: "same" });

    expect(res.actions.map((action) => action.tool)).toEqual(["approveMerge"]);
    expect(res.actions[0]?.input.issueNumbers).toEqual([44]);
    expect(calls).toEqual(["approveMerge:zenod-ai/fixture:44"]);
  });

  it("P-1: a bare affirmative that resolves nothing this turn renders the deterministic zero-state, never the model's own prose", async () => {
    __resetApprovalTokens();
    const res = await engine().handleTasking({ text: "approved", surface: "web", conversationKey: "fresh" });

    expect(res.actions).toEqual([]);
    expect(res.text).toBe("Nothing pending to approve.");
  });

  it("chat persists the conversation window and can trigger a store", async () => {
    const e = engine();
    const reply = await e.chat("please remember this: I renewed my insurance today", "web");
    expect(reply.stored).toBeDefined();
    expect(reply.text).toBeTruthy();

    const window = await state.recentWindow("web:default");
    expect(window.length).toBe(2);
    expect(window[0]?.role).toBe("user");
    expect(window[1]?.role).toBe("assistant");
  });

  it("chat can isolate conversation history with a conversation key", async () => {
    const e = engine();
    await e.chat("hello from first sender", "whatsapp", { conversationKey: "34600000001" });
    await e.chat("hello from second sender", "whatsapp", { conversationKey: "34600000002" });

    expect((await state.recentWindow("whatsapp:34600000001")).map((m) => m.text)).toEqual([
      "hello from first sender",
      expect.stringContaining("Axa"),
    ]);
    expect((await state.recentWindow("whatsapp:34600000002")).map((m) => m.text)).toEqual([
      "hello from second sender",
      expect.stringContaining("Axa"),
    ]);
    expect(await state.recentWindow("web:default")).toEqual([]);
  });

  it("chat streams deltas to onDelta and the joined text equals reply.text", async () => {
    const deltas: string[] = [];
    const reply = await engine().chat("what about my insurance?", "web", (d) => deltas.push(d));

    expect(deltas.length).toBeGreaterThan(1); // streamed in chunks, not one blob
    expect(deltas.join("")).toBe(reply.text); // no tokens dropped or duplicated
    expect(reply.sources[0]?.path).toBe("Areas/Insurance.md"); // sources still resolve at the end

    // The streamed turn is persisted just like a non-streamed one.
    const window = await state.recentWindow("web:default");
    expect(window[window.length - 1]?.text).toBe(reply.text);
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

describe("SqliteStateStore.searchConversations", () => {
  it("finds matches across channels, grouped and ranked by relevance then recency", async () => {
    const store = new SqliteStateStore(":memory:");
    await store.appendMessage("whatsapp:34600", "user", "should we open an issue in the AlfaBlok repo?", "whatsapp");
    await store.appendMessage("whatsapp:34600", "assistant", "yes — tracking the Idealista scraper source repo gap", "whatsapp");
    await store.appendMessage("web:default", "user", "we were speaking about adding an issue in that repo", "web");
    await store.appendMessage("web:default", "assistant", "no GitHub issue was created in the conversation", "web");
    await store.appendMessage("cli:default", "user", "unrelated weather chatter", "cli");

    const hits = await store.searchConversations("issue repo");

    // Both the whatsapp and web conversations matched; the cli one did not.
    expect(hits.map((h) => h.conversationId).sort()).toEqual(["web:default", "whatsapp:34600"]);
    const wa = hits.find((h) => h.surface === "whatsapp");
    expect(wa?.matchCount).toBe(2);
    expect(wa?.messages.map((m) => m.text)).toEqual([
      "should we open an issue in the AlfaBlok repo?",
      "yes — tracking the Idealista scraper source repo gap",
    ]);

    store.close();
  });

  it("can restrict to specific channels and ignores too-short query terms", async () => {
    const store = new SqliteStateStore(":memory:");
    await store.appendMessage("whatsapp:1", "user", "the launch post draft", "whatsapp");
    await store.appendMessage("web:default", "user", "the launch post draft", "web");

    const onlyWeb = await store.searchConversations("launch", { surfaces: ["web"] });
    expect(onlyWeb.map((h) => h.surface)).toEqual(["web"]);

    // Single-character terms are dropped; "a" alone yields no usable query.
    expect(await store.searchConversations("a")).toEqual([]);

    store.close();
  });
});
