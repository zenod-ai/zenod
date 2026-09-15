import { branchContext, BRANCH_CONTEXT_MAX_CHARS } from "../src/engine/meaningNotes.js";
import { scanVault } from "../src/vault/pages.js";
import { withVaultWriteLock } from "../src/git/vaultWriteLock.js";
import { sealFilingReceipt, renderFilingReceipt, filingReceiptPath, filingInputFingerprint } from "../src/engine/filingReceipt.js";
import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine, LONG_MEMORY_SEGMENT_CHARS } from "../src/engine/engine.js";
import { sourceWindows } from "../src/engine/sourcePassages.js";
import { __resetApprovalTokens } from "../src/approvalTokens.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import { appendMemoryFacts } from "../src/engine/temporalFacts.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import type { FileChange, VaultRepository, VaultRevision } from "../src/index.js";
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
  classifyFailureMessage = "empty structured classification";
  composeCalls = 0;
  confidence = 0.95;
  disposition: Classification["disposition"] = "integrate_page";
  failComposeAttempts = 0;
  classifyPath: string | null = "Areas/Insurance.md";
  answerInputs: AnswerInput[] = [];
  answerOverride: ((input: AnswerInput, tools: VaultReadTools, taskTools?: VaultTaskTools) => Promise<AnswerResult>) | null = null;
  workInputs: WorkLoopInput[] = [];

  async classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls++;
    this.classifyInputs.push(input);
    if (this.classifyCalls <= this.failClassifyAttempts) throw new Error(this.classifyFailureMessage);
    return {
      disposition: this.disposition,
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
    if (input.focusedUpdate && input.currentContent) {
      const { frontmatter, body } = parseNote(input.currentContent);
      return serializeNote(frontmatter!, body + `\n- New fact recorded (${input.citation}).\n`);
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
    if (this.answerOverride) return this.answerOverride(input, tools, taskTools);
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

/** Non-git repository proof: local Markdown snapshots with Drive-shaped durable revisions. */
class FakeDriveVaultRepository implements VaultRepository {
  readonly provider = "google_drive" as const;
  private baseline = new Map<string, string>();
  private revisionNumber = 0;
  private revision: VaultRevision = {
    provider: "google_drive",
    id: "drive-revision-0",
    committedAt: "2026-08-29T10:00:00.000Z",
    urls: [],
  };

  private constructor(
    readonly path: string,
    private readonly makeUrl: (path: string, anchor?: string) => string = (path, anchor) => {
      const suffix = anchor ? `#${encodeURIComponent(anchor)}` : "";
      return `https://drive.google.com/drive/zenod-vault/${path.split("/").map(encodeURIComponent).join("/")}${suffix}`;
    },
  ) {}

  static async open(
    path: string,
    makeUrl?: (path: string, anchor?: string) => string,
  ): Promise<FakeDriveVaultRepository> {
    const repository = new FakeDriveVaultRepository(path, makeUrl);
    await repository.captureBaseline();
    return repository;
  }

  private async captureBaseline(): Promise<void> {
    this.baseline = new Map(await Promise.all(
      (await listMarkdownFiles(this.path)).map(async (path) => [path, await readFile(join(this.path, path), "utf8")] as const),
    ));
  }

  async pull(): Promise<void> {}

  async currentRevision(): Promise<VaultRevision> {
    return { ...this.revision, urls: [...this.revision.urls] };
  }

  async trackedFiles(): Promise<string[]> {
    return [...this.baseline.keys()].sort();
  }

  async contentAtHead(path: string): Promise<string | null> {
    return this.baseline.get(path) ?? null;
  }

  async pendingChanges(): Promise<FileChange[]> {
    const currentPaths = await listMarkdownFiles(this.path);
    const paths = [...new Set([...this.baseline.keys(), ...currentPaths])].sort();
    const changes: FileChange[] = [];
    for (const path of paths) {
      const before = this.baseline.get(path) ?? null;
      const after = await readFile(join(this.path, path), "utf8").catch(() => null);
      if (before !== after) changes.push({ path, before, after });
    }
    return changes;
  }

  async discardChanges(): Promise<void> {
    const currentPaths = await listMarkdownFiles(this.path);
    for (const path of currentPaths) {
      if (!this.baseline.has(path)) await rm(join(this.path, path), { force: true });
    }
    for (const [path, content] of this.baseline) {
      await mkdir(dirname(join(this.path, path)), { recursive: true });
      await writeFile(join(this.path, path), content);
    }
  }

  async commitAndPublish(_message: string): Promise<VaultRevision> {
    const changes = await this.pendingChanges();
    if (changes.length === 0) throw new Error("no pending vault changes to publish");
    this.revisionNumber += 1;
    this.revision = {
      provider: "google_drive",
      id: `drive-revision-${this.revisionNumber}`,
      committedAt: `2026-08-29T10:${String(this.revisionNumber).padStart(2, "0")}:00.000Z`,
      urls: changes.map((change) => this.urlFor(change.path)!).filter(Boolean),
    };
    await this.captureBaseline();
    return this.currentRevision();
  }

  urlFor(path: string, anchor?: string): string {
    return this.makeUrl(path, anchor);
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

  it("keeps a raw-only qualified hypothesis alongside a requested current fact without injecting other page facts", async () => {
    const e = engine();
    const hypothesis = "Orchid hypothesis: a shadow display might improve spatial learning; this remains unverified.";
    const restriction = "Orchid workshop does not repair batteries.";
    const unrelated = "Orchid workshop capacity is eight seats.";
    const oldClaim = "Orchid workshop repairs batteries.";
    const content = [hypothesis, restriction, unrelated, oldClaim].join("\n\n");
    const capture = await e.captureEvidence!({ content, source: "selftest" });
    const [path, anchor] = capture.evidenceRef.split("#^");
    const page = "Notes/Orchid.md";
    const raw = serializeNote({ title: "Orchid", type: "note", summary: "Orchid workshop" }, "# Orchid\n");
    const entry = { evidenceRef: capture.evidenceRef, path: path!, anchor: anchor!, title: "Orchid", content, source: "selftest", verbatim: true, capturedAt: new Date().toISOString(), url: capture.evidenceUrl!, provider: "github" as const, revisionId: "fixture" };
    const facts = [restriction, unrelated].map((statement, i) => ({ key: `orchid.fact${i}`, statement, effectiveDate: null, effectiveDateQuote: null, correctionQuote: null, supersedesQuotes: [], verificationQuote: null }));
    await writeFile(join(repo.path, page), appendMemoryFacts(raw, raw, facts, entry));
    const git = simpleGit(repo.path); await git.add(page); await git.commit("generic mixed answer fixture"); await git.push();
    const modelAnswer = `Unverified hypothesis: "${hypothesis}" (${capture.evidenceRef})\nBattery restriction: "${restriction}" (${capture.evidenceRef})`;
    llm.answerOverride = async (_input, tools) => {
      const discovery = await tools.searchVault!("Orchid");
      expect(discovery).toContain(page);
      expect(discovery).not.toContain("answerSupports");
      expect(discovery).not.toContain("Source-backed fact candidates");
      // Discovery must not spend the bounded fact-read allowance. All four
      // explicit reads remain available and verify source-backed current facts.
      let lastExplicit: any;
      for (let attempt = 0; attempt < 4; attempt++) {
        const explicit = lastExplicit = JSON.parse(await tools.readFacts!({ path: page }));
        expect(explicit.facts.find((fact: any) => fact.key === "orchid.fact0").source.path).toBe(capture.evidenceRef);
        expect(explicit.answerSupports.find((support: any) => support.key === "orchid.fact0").modes).toContain("current");
      }
      const pageRead = JSON.parse(await tools.readNote!(page));
      expect(pageRead.factView).toBeUndefined(); // Explicit scope remains authoritative.
      const sourceRead = JSON.parse(await tools.readNote!(capture.evidenceRef));
      return { text: modelAnswer, readPaths: [page, capture.evidenceRef], supportSelections: [
        { id: sourceRead.answerSupports.find((support: any) => support.excerpt.startsWith("Orchid hypothesis")).id, mode: "raw_report" },
        { id: lastExplicit.answerSupports.find((support: any) => support.key === "orchid.fact0").id, mode: "current" },
      ] };
    };
    const result = await e.ask("What is the Orchid hypothesis and what batteries does the workshop not repair?");
    expect(modelAnswer).toContain(hypothesis);
    expect(result.text).toContain(hypothesis);
    expect(result.text).toContain(restriction);
    expect(result.text).not.toContain(unrelated);
    expect(result.text).toContain(capture.evidenceRef);
    llm.answerOverride = async (_input, tools) => {
      await tools.readNote!(page); const sourceRead = JSON.parse(await tools.readNote!(capture.evidenceRef));
      return { text: `"${hypothesis}" (${capture.evidenceRef})`, readPaths: [page, capture.evidenceRef], supportSelections: [{ id: sourceRead.answerSupports.find((support: any) => support.excerpt.startsWith("Orchid hypothesis")).id, mode: "raw_report" }] };
    };
    const rawOnly = await e.ask("What is the unverified Orchid workshop hypothesis?");
    expect(rawOnly.text).toContain(hypothesis);
    expect(rawOnly.text).not.toContain(restriction);
    expect(rawOnly.text).not.toContain(unrelated);
    llm.answerOverride = async (_input, tools) => {
      const pageRead = JSON.parse(await tools.readNote!(page)); await tools.readNote!(capture.evidenceRef);
      return { text: `Currently: "${oldClaim}" (${capture.evidenceRef})`, readPaths: [page, capture.evidenceRef], supportSelections: [{ id: pageRead.factView.answerSupports.find((support: any) => support.key === "orchid.fact0").id, mode: "current" }] };
    };
    const stale = await e.ask("Does the Orchid workshop repair batteries currently?");
    expect(stale.text).toContain(restriction);
    expect(stale.text).not.toContain(oldClaim);
    // Even a synonym-only display miss must never bypass host temporal authority.
    const synonym = await e.ask("¿Qué trabajo rechaza el taller Orchid?");
    expect(synonym.text).toContain(restriction);
    expect(synonym.text).not.toContain(oldClaim);
    const mixedTime = await e.ask("What is the current workshop policy, and what was it before?");
    expect(mixedTime.text).toContain(restriction);
    expect(mixedTime.text).not.toContain(oldClaim);
    llm.answerOverride = async input => {
      const pinned = JSON.parse(input.vaultBriefing.split("Pinned source support IDs: ")[1]!);
      return { text: "Unused model prose", readPaths: [], supportSelections: [{ id: pinned[0].answerSupports[0].id, mode: "raw_report" }] };
    };
    expect((await e.ask("Explain this pinned hypothesis", { contextRefs: [capture.evidenceRef] })).text).toContain(hypothesis);
    llm.answerOverride = async input => {
      const pinned = JSON.parse(input.vaultBriefing.split("Pinned source support IDs: ")[1]!);
      return { text: "", readPaths: [], supportSelections: [{ id: pinned[0].answerSupports[0].id, mode: "raw_report", summaryText: "The workshop hypothesis remains unverified." }] };
    };
    const summary = await e.ask("Summarize this uncertain hypothesis", { contextRefs: [capture.evidenceRef] });
    expect(summary.text).toContain("The workshop hypothesis remains unverified.");
    expect(summary.text).toContain(capture.evidenceRef);
    expect(summary.text).not.toContain(unrelated);

    llm.answerOverride = async (_input, tools) => {
      const first = JSON.parse(await tools.readNote!(page));
      const selected = first.factView.answerSupports.find((support: any) => support.key === "orchid.fact0");
      const changed = parseNote(await readFile(join(repo.path, page), "utf8"));
      (changed.frontmatter!.memoryFacts as any[])[0].statement = oldClaim;
      await writeFile(join(repo.path, page), serializeNote(changed.frontmatter!, changed.body));
      await tools.readFacts!({ path: page }); // New explicit view must not hide stale selected automatic view.
      return { text: restriction, readPaths: [page], supportSelections: [{ id: selected.id, mode: "current" }] };
    };
    const staleSelection = await e.ask("What is the current workshop policy?");
    expect(staleSelection.text).toContain("snapshot changed");
    expect(staleSelection.text).not.toContain(restriction);
  }, 15_000);

  it("rejects a complete-source summary when its selected source changes before finalization",async()=>{
    const e=engine();const capture=await e.captureEvidence!({content:"An option remains tentative and requires inspection.",source:"selftest"});
    llm.answerOverride=async (_input,tools)=>{
      const read=JSON.parse(await tools.readNote!(capture.evidenceRef));
      const support=read.answerSupports.find((hint:any)=>hint.kind==="source_summary");expect(support).toBeDefined();
      const path=capture.evidenceRef.split("#")[0]!;
      await writeFile(join(repo.path,path),(await readFile(join(repo.path,path),"utf8"))+"\nChanged source snapshot.\n");
      return {text:"",readPaths:[capture.evidenceRef],supportSelections:[{id:support.id,mode:"raw_report",summaryText:"The option remains tentative."}]};
    };
    const result=await e.ask("Summarize the source");expect(result.text).toContain("snapshot changed");expect(result.text).not.toContain("The option remains tentative.");
  });

  it("preserves explicit protocol failure across ask, chat and tasking instead of projecting unrelated facts", async()=>{
    const e=engine();const capture=await e.captureEvidence!({content:"A complete source statement.",source:"selftest"});
    llm.answerOverride=async (input,tools)=>{
      if(input.answerSupportRead) expect(input.answerSupportScope).toBe("memory_only");
      await tools.readNote!(capture.evidenceRef);
      return {text:"",readPaths:[capture.evidenceRef],supportProtocolError:"missing_submission"};
    };
    const answers=[await e.ask("What is the statement?"),await e.ask("Explain this",{contextRefs:[capture.evidenceRef]}),
      await e.chat("What is the statement?","web"),await e.handleTasking({text:"What is the statement?",surface:"web",conversationKey:"protocol-failure"})];
    for(const answer of answers){expect(answer.text).toContain("did not submit");expect(answer.text).not.toContain("unknown, unavailable");expect(answer.text).not.toContain("No structured current fact");}
  });

  it("exposes substantive small-page supports in one read without mode promotion", async () => {
    const path="Projects/Small Workshop.md";
    await mkdir(join(repo.path,"Projects"),{recursive:true});
    await writeFile(join(repo.path,path),"---\ntitle: Small Workshop\n---\n\n# Small Workshop\n\n## Responsibilities\nMina checks brakes. Pavel checks wheels.\n\n## Scope\nWe do not repair batteries.\n");
    await repo.commitAndPush("small headed page");
    const e=engine();let mode: "raw_report"|"current"="raw_report";
    llm.answerOverride=async (_input,tools)=>{
      const packet=JSON.parse(await tools.readNote!(path));
      const selected=packet.answerSupports.find((h:any)=>h.granularity==="paragraph" && h.excerpt?.includes("Mina checks"));
      expect(selected).toBeDefined();
      expect(packet.passages.length).toBeGreaterThan(1);
      expect(packet.readPartial).toBe(false);expect(packet.nextCursor).toBeNull();
      expect(selected.modes).toEqual(["raw_report"]);
      expect(packet.answerInstruction).not.toContain('"mode":"current"');
      return {text:"",readPaths:[path],supportSelections:[{id:selected.id,mode}]};
    };
    const answer=await e.ask("Who checks brakes and wheels at Small Workshop?");
    expect(answer.text).toContain("Mina checks brakes. Pavel checks wheels.");
    expect(answer.text).not.toContain("We do not repair batteries.");
    mode="current";
    expect((await e.ask("Who checks brakes and wheels?")).text).toContain("temporally incompatible");
  });

  it("keeps the per-read support hint budget when packing many sections", async () => {
    const path="Projects/Many claims.md";
    await mkdir(join(repo.path,"Projects"),{recursive:true});
    await writeFile(join(repo.path,path),Array.from({length:8},(_,i)=>`# Topic ${i}\n\n`+Array.from({length:8},(_,j)=>`Recorded statement ${i}-${j}.\n\n`).join("")).join(""));
    await repo.commitAndPush("bounded support fixture");
    llm.answerOverride=async (_input,tools)=>{
      const packet=JSON.parse(await tools.readNote!(path));
      expect(packet.answerSupports).toHaveLength(32);
      expect(packet.answerSupportPartial).toBe(true);
      expect(packet.readPartial).toBe(false);
      const targeted=JSON.parse(await tools.readNote!(path,{query:"Recorded statement 7-7"}));
      const recovered=targeted.answerSupports.find((h:any)=>h.excerpt?.includes("Recorded statement 7-7"));
      expect(recovered).toBeDefined();
      return {text:"",readPaths:[path],supportSelections:[{id:recovered.id,mode:"raw_report"}]};
    };
    expect((await engine().ask("What statements are recorded?")).text).toContain("Recorded statement 7-7.");
  });

  function engine() {
    return createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" } });
  }

  it("uses the shared typed-entry catalog for ask, chat and tasking, with per-ask override", async () => {
    const page = {
      entries: [], pagination: { hasMore: false, nextCursor: null, snapshot: "receipt-catalog",
        matchedEntries: 0, scannedEntries: 14, scannedVaultEntries: 14, scannedReceiptJobs: 14,
        receiptEnrichmentAvailable: true, scope: "all-local-vault-evidence-and-retained-tenant-receipts" },
    };
    const entrySearch = vi.fn(async () => page);
    const override = vi.fn(async () => ({ ...page, pagination: { ...page.pagination, snapshot: "override" } }));
    let expectedSnapshot = "receipt-catalog";
    llm.answerOverride = async (_input, tools) => {
      const result = JSON.parse(await tools.searchEntries!({ contentType: "voice_note", order: "newest" }));
      expect(result.pagination.snapshot).toBe(expectedSnapshot);
      expect(result.pagination.receiptEnrichmentAvailable).toBe(true);
      return { text: "Checked the requested catalog.", readPaths: [] };
    };
    const e = createEngine({ repo, llm, state, entrySearch });
    await e.ask("List recent voice notes");
    await e.chat("List recent voice notes", "whatsapp");
    await e.handleTasking({ text: "List recent voice notes", surface: "web", conversationKey: "catalog" });
    expect(entrySearch).toHaveBeenCalledWith(expect.objectContaining({ contentType: "voice_note", order: "newest" }));
    expect(entrySearch.mock.calls.length).toBeGreaterThanOrEqual(3);
    const priorCalls = entrySearch.mock.calls.length;
    expectedSnapshot = "override";
    await e.ask("List recent voice notes", { entrySearch: override });
    expect(override).toHaveBeenCalled();
    expect(entrySearch).toHaveBeenCalledTimes(priorCalls);
  });

  it.each(["voice_note", "document"] as const)("reads catalog-selected %s text and grounds short category questions without neighboring evidence", async (contentType) => {
    const path = "Log/2026-09-08.md";
    const ref = `${path}#^e-123abc`;
    await writeFile(join(repo.path, path), "# Log\n\n## 14:16 Capture ^e-123abc\n> Keep the ORCHID-8120 launch private.\n\n## 14:17 Other ^e-456def\n> DISTRACTOR-9120 is unrelated.\n");
    const entry = { evidenceRef: ref, capturedAt: "2026-09-08T14:15:00Z", contentType, source: "whatsapp" };
    const entrySearch = vi.fn(async () => ({ entries: [entry], pagination: { hasMore: false, nextCursor: null, snapshot: "stable", matchedEntries: 1, scannedEntries: 2, scannedVaultEntries: 2, scannedReceiptJobs: 1, receiptEnrichmentAvailable: true, scope: "test" } } as any));
    llm.answerOverride = async (_input, tools) => {
      const result = JSON.parse(await tools.searchEntries!({ contentType, order: "newest", limit: 5 }));
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].capture.capturedAt).toBe(entry.capturedAt);
      expect(result.evidence[0].passage.body).toContain("14:16"); // Original evidence stays unchanged.
      expect(result.evidence[0].passage.body).not.toContain("DISTRACTOR");
      expect(result.coverage.passageReadAttempts).toBe(1);
      return { text: `ORCHID-8120 (${ref}). DISTRACTOR-9120 (${path}#^e-456def).`, readPaths: [] };
    };
    const reply = await createEngine({ repo, llm, state, entrySearch }).chat(contentType === "voice_note" ? "What are my latest VNs?" : "What are my latest documents?", "whatsapp");
    expect(reply.text).toContain("ORCHID-8120");
    expect(reply.text).toContain(ref);
    expect(reply.text).not.toContain("DISTRACTOR-9120");
    expect(reply.text).not.toContain("e-456def");
    expect(reply.sources).toHaveLength(1);
    expect(reply.coverage?.successfulReads).toHaveLength(1);
  });

  it.each([17300,25000])("shares the automatic allowance with one exact entry and preserves complete/partial coverage (%s chars)",async chars=>{
    const path="Log/2026-09-08.md",ref=path+"#^e-123abc";
    const raw="## 14:16 Capture ^e-123abc\n> "+"An option is tentative. ".repeat(Math.ceil(chars/24));
    await writeFile(join(repo.path,path),"# Log\n\n"+raw+"\n\n## 14:17 Other ^e-456def\n> Neighbor must not leak.\n");
    const {readNotePassage}=await import("../src/ops/passage.js");
    const first=await readNotePassage(repo.path,ref,{maxChars:8000});
    const exact=(await readFile(join(repo.path,path),"utf8")).slice(first.extent.sectionStart,first.extent.sectionEnd);
    const entrySearch=vi.fn(async()=>({entries:[{evidenceRef:ref,capturedAt:"2026-09-08T14:15:00Z",contentType:"voice_note",source:"whatsapp"}],pagination:{hasMore:false,nextCursor:null,snapshot:"stable",matchedEntries:1,scannedEntries:1,scannedVaultEntries:1,scannedReceiptJobs:0,receiptEnrichmentAvailable:false,scope:"test"}} as any));
    llm.answerOverride=async(_input,tools)=>{
      const result=JSON.parse(await tools.searchEntries!({contentType:"voice_note",order:"newest",limit:1}));
      const packet=result.evidence[0].passage,pieces=packet.passages;
      expect(packet.readPath).toBe(ref);expect(pieces).toHaveLength(3);expect(pieces.every((piece:any)=>piece.body.length<=8000&&piece.identity===ref&&piece.version===first.version)).toBe(true);
      const text=pieces.map((piece:any)=>piece.body).join("");expect(text.length).toBeLessThanOrEqual(20000);expect(text).toBe(exact.slice(0,text.length));expect(text).not.toContain("Neighbor must not leak");
      const summary=pieces.flatMap((piece:any)=>piece.answerSupports).find((hint:any)=>hint.kind==="source_summary");
      if(chars<20000){expect(text).toBe(exact);expect(packet.nextCursor).toBeNull();expect(packet.readPartial).toBe(false);expect(summary).toBeDefined();}
      else {expect(text.length).toBe(20000);expect(packet.nextCursor).toBeTruthy();expect(packet.readPartial).toBe(true);expect(summary).toBeUndefined();}
      const repeated=JSON.parse(await tools.searchEntries!({contentType:"voice_note",order:"newest",limit:1}));expect(repeated.evidence).toEqual(result.evidence);expect(repeated.coverage.passageReadAttempts).toBe(3);
      return {text:"",readPaths:[],supportSelections:summary?[{id:summary.id,mode:"raw_report",summaryText:"The source repeatedly describes a tentative option."}]:[]};
    };
    const reply=await createEngine({repo,llm,state,entrySearch}).ask("Summarize the latest voice note");
    if(chars<20000)expect(reply.text).toContain("The source repeatedly describes a tentative option.");
    else expect(reply.coverage?.continuation).toContainEqual(expect.objectContaining({tool:"read_note",input:expect.objectContaining({path:ref})}));
  });

  it("does not multiply automatic character allowances across concurrent searches",async()=>{
    const path="Log/2026-09-08.md",refs=[path+"#^e-123abc",path+"#^e-456def"];
    await writeFile(join(repo.path,path),"# Log\n\n"+refs.map(ref=>`## 14:16 Capture ^${ref.split("#^")[1]}\n> ${"A complete report. ".repeat(1600)}\n\n`).join(""));
    const entrySearch=vi.fn(async(input:any)=>({entries:[{evidenceRef:refs[input.query==="second"?1:0],capturedAt:"2026-09-08T14:15:00Z",contentType:"voice_note",source:"whatsapp"}],pagination:{hasMore:false,nextCursor:null,snapshot:"stable",matchedEntries:1,scannedEntries:1,scannedVaultEntries:2,scannedReceiptJobs:0,receiptEnrichmentAvailable:false,scope:"test"}} as any));
    llm.answerOverride=async(_input,tools)=>{
      const results=await Promise.all([tools.searchEntries!({query:"first",limit:1}),tools.searchEntries!({query:"second",limit:1})]);
      const evidence=results.flatMap(value=>JSON.parse(value).evidence),pieces=evidence.flatMap((entry:any)=>entry.passage?.passages??(entry.passage?[entry.passage]:[]));
      expect(pieces.reduce((sum:number,piece:any)=>sum+piece.body.length,0)).toBeLessThanOrEqual(20000);
      const repeated=JSON.parse(await tools.searchEntries!({query:"second",limit:1}));expect(repeated.coverage.passageReadAttempts).toBe(3);expect(repeated.coverage.searches.some((search:any)=>search.unreadEvidenceRefs.includes(refs[1]))).toBe(true);
      return {text:"",readPaths:[],supportSelections:[]};
    };
    await createEngine({repo,llm,state,entrySearch}).ask("Read selected recordings");
  });

  it("retains successful automatic pieces and failed coverage when continuation becomes stale",async()=>{
    const path="Log/2026-09-08.md",ref=path+"#^e-123abc",raw="# Log\n\n## 14:16 Capture ^e-123abc\n> "+"A tentative claim. ".repeat(1000);
    await writeFile(join(repo.path,path),raw);
    const entrySearch=vi.fn(async()=>({entries:[{evidenceRef:ref,capturedAt:"2026-09-08T14:15:00Z",contentType:"voice_note",source:"whatsapp"}],pagination:{hasMore:false,nextCursor:null,snapshot:"stable",matchedEntries:1,scannedEntries:1,scannedVaultEntries:1,scannedReceiptJobs:0,receiptEnrichmentAvailable:false,scope:"test"}} as any));
    llm.answerOverride=async(_input,tools)=>{
      const revision=repo.currentRevision.bind(repo);let calls=0;
      const spy=vi.spyOn(repo,"currentRevision").mockImplementation(async()=>{if(++calls===2)await writeFile(join(repo.path,path),raw+" Changed.");return revision();});
      try{
        const result=JSON.parse(await tools.searchEntries!({limit:1,exhaustive:true}));
        expect(result.evidence[0].passage.body).toHaveLength(8000);expect(result.evidence[0].error).toBeTruthy();expect(result.coverage.failedReads).toContain(ref);
        expect(result.evidence[0].passage.answerSupports.some((hint:any)=>hint.kind==="source_summary")).toBe(false);
      }finally{spy.mockRestore();}
      return {text:"",readPaths:[],supportSelections:[]};
    };
    const reply=await createEngine({repo,llm,state,entrySearch}).ask("Read the latest source");expect(reply.coverage?.status).toBe("partial");
  });

  it("keeps automatic catalog reads bounded across repeated searches and reports truncated passages", async () => {
    const path = "Log/2026-09-08.md";
    const refs = Array.from({ length: 6 }, (_, i) => `${path}#^e-${String(i + 1).padStart(6, "0")}`);
    await writeFile(join(repo.path, path), "# Log\n\n" + refs.map((ref, i) => `## 14:16 Capture ^${ref.split("#^")[1]}\n> ${i === 0 ? "x".repeat(9000) : "Ordinary transcript."}\n\n`).join(""));
    const entries = refs.map(evidenceRef => ({ evidenceRef, capturedAt: "2026-09-08T14:15:00Z", contentType: "voice_note", source: "whatsapp" }));
    const entrySearch = vi.fn(async () => ({ entries, pagination: { hasMore: false, nextCursor: null, snapshot: "stable", matchedEntries: 6, scannedEntries: 6, scannedVaultEntries: 6, scannedReceiptJobs: 0, receiptEnrichmentAvailable: false, scope: "test" } } as any));
    llm.answerOverride = async (_input, tools) => {
      for (let i = 0; i < 2; i++) {
        const result = JSON.parse(await tools.searchEntries!({ contentType: "voice_note", limit: 6 }));
        expect(result.evidence).toHaveLength(5);
        expect(result.coverage.passageReadAttempts).toBe(5);
        expect(result.evidence[0].passage.body.length).toBeLessThanOrEqual(4000);
        expect(result.evidence[0].passage.nextCursor).toBeTruthy();
        expect(result.coverage.continuation).toContainEqual(expect.objectContaining({ tool: "read_note", input: expect.objectContaining({ path: refs[0] }) }));
        expect(result.coverage.searches[0].unreadEvidenceRefs).toContain(refs[5]);
      }
      return { text: "Only the returned passage prefixes were read.", readPaths: [] };
    };
    await createEngine({ repo, llm, state, entrySearch }).ask("Recent recordings");
  });

  it("does not reuse automatic passages after the catalog snapshot changes", async () => {
    const path = "Log/2026-09-08.md";
    const ref = `${path}#^e-123abc`;
    await writeFile(join(repo.path, path), "# Log\n\n## 14:16 Capture ^e-123abc\n> Earlier statement.\n");
    let snapshot = "before";
    const entrySearch = vi.fn(async () => ({ entries: [{ evidenceRef: ref, capturedAt: "2026-09-08T14:15:00Z", contentType: "text", source: "web" }], pagination: { hasMore: false, nextCursor: null, snapshot, matchedEntries: 1, scannedEntries: 1, scannedVaultEntries: 1, scannedReceiptJobs: 0, receiptEnrichmentAvailable: false, scope: "test" } } as any));
    llm.answerOverride = async (_input, tools) => {
      const first = JSON.parse(await tools.searchEntries!({ order: "newest" }));
      expect(first.evidence[0].passage.body).toContain("Earlier statement");
      snapshot = "after";
      const changed = JSON.parse(await tools.searchEntries!({ order: "newest" }));
      expect(changed.evidence[0].passage).toBeUndefined();
      expect(changed.evidence[0].error).toContain("snapshot changed");
      expect(changed.coverage.passageReadAttempts).toBe(1);
      return { text: "Earlier statement is current.", readPaths: [] };
    };
    const reply = await createEngine({ repo, llm, state, entrySearch }).ask("Recent captures");
    expect(reply.coverage?.status).toBe("partial");
    expect(reply.text).not.toContain("Earlier statement is current");
  });

  it("keeps failed automatic source reads visible and does not promote catalog snippets to evidence", async () => {
    const ref = "Log/2026-09-08.md#^e-000001";
    const entrySearch = vi.fn(async () => ({ entries: [{ evidenceRef: ref, capturedAt: "2026-09-08T14:15:00Z", contentType: "voice_note", source: "whatsapp", snippet: "UNREAD-1234" }], pagination: { hasMore: false, nextCursor: null, snapshot: "stable", matchedEntries: 1, scannedEntries: 1, scannedVaultEntries: 0, scannedReceiptJobs: 1, receiptEnrichmentAvailable: true, scope: "test" } } as any));
    llm.answerOverride = async (_input, tools) => {
      const result = JSON.parse(await tools.searchEntries!({ contentType: "voice_note" }));
      expect(result.evidence[0].error).toBeTruthy();
      expect(result.evidence[0].passage).toBeUndefined();
      expect(result.coverage.failedReads).toContain(ref);
      return { text: `UNREAD-1234 ${ref}`, readPaths: [] };
    };
    const reply = await createEngine({ repo, llm, state, entrySearch }).ask("Latest captures");
    expect(reply.sources).toHaveLength(0);
    expect(reply.text).toContain("couldn't verify");
    expect(reply.text).not.toContain("UNREAD-1234");
  });

  it("returns typed GitHub connection-required denial without an external mutation", async () => {
    const reply = await engine().handleTasking({
      text: "CREATEISSUE: This must not leave the vault",
      surface: "web",
      conversationKey: "drive-only-github-denial",
    });

    expect(reply.actions).toHaveLength(1);
    expect(reply.actions[0]).toMatchObject({ tool: "createIssue", mutationAttempt: true });
    expect(JSON.parse(reply.actions[0]!.result)).toEqual({
      error: {
        code: "github_connection_required",
        message: "Connect GitHub before using createIssue. Memory and local Markdown backlog tools remain available.",
      },
    });
  });

  it("runs the complete core memory loop through a non-git VaultRepository without GitHub leakage", async () => {
    const vaultPath = join(dir, "drive-vault");
    await cp(FIXTURE, vaultPath, { recursive: true });
    const driveRepository = await FakeDriveVaultRepository.open(vaultPath);
    const driveEngine = createEngine({ repo: driveRepository, llm, state, readSyncTtlMs: 0 });
    const noGitFields = (value: unknown) => {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain("commitSha");
      expect(serialized).not.toContain("githubUrl");
      expect(serialized).not.toContain("github.com");
    };

    const stored = await driveEngine.store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
    });
    expect(stored.revision).toMatchObject({ provider: "google_drive", id: "drive-revision-1" });
    expect(stored.urls?.every((url) => url.startsWith("https://drive.google.com/"))).toBe(true);
    noGitFields(stored);

    const hits = await driveEngine.search("insurance");
    expect(hits[0]).toMatchObject({ provider: "google_drive", path: "Areas/Insurance.md" });
    expect(hits[0]?.url).toContain("drive.google.com");
    noGitFields(hits);

    const note = await driveEngine.get("Areas/Insurance.md");
    expect(note).toMatchObject({ provider: "google_drive", path: "Areas/Insurance.md" });
    noGitFields(note);

    const answer = await driveEngine.ask("What insurance do I have?");
    expect(answer.text).toContain("Axa");
    expect(answer.sources).toEqual([
      expect.objectContaining({ provider: "google_drive", path: "Areas/Insurance.md" }),
    ]);
    noGitFields(answer);

    const captured = await driveEngine.captureEvidence!({
      content: "Voice note transcript: Blue Lantern.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "drive-blue-lantern",
      verbatim: true,
    });
    const replay = await driveEngine.captureEvidence!({
      content: "Voice note transcript: Blue Lantern.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "drive-blue-lantern",
      verbatim: true,
    });
    expect(replay.evidenceRef).toBe(captured.evidenceRef);
    expect(replay.revision?.id).toBe(captured.revision?.id);
    noGitFields(captured);
    noGitFields(replay);

    const enriched = await driveEngine.enrichEvidence!({
      content: "Voice note transcript: Blue Lantern.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "drive-blue-lantern",
      verbatim: true,
      evidenceRef: captured.evidenceRef,
    });
    expect(enriched.revision?.provider).toBe("google_drive");
    noGitFields(enriched);

    llm.workScript = async (_tools, writeTools) => {
      await writeTools.writeNote(
        "Notes/Drive Work.md",
        "---\ntitle: Drive Work\ntype: note\ntags: []\ncreated: 2026-08-29\nupdated: 2026-08-29\nsummary: Provider-neutral work proof.\n---\n\n# Drive Work\n\nSaved through the repository boundary. Related: [[Areas/Insurance|Insurance]].\n",
      );
      return "write provider-neutral work proof";
    };
    const workResult = await driveEngine.work({ objective: "write proof", plan: "- write Notes/Drive Work.md" });
    expect(workResult.mode, workResult.text).toBe("executed");
    expect(workResult).toMatchObject({ committed: true, revision: { provider: "google_drive" } });
    noGitFields(workResult);

    const backlog = await driveEngine.digestBacklog({
      rawText: "Remember to renew travel insurance.",
      sourceRefs: [{
        path: captured.evidenceRef,
        url: captured.evidenceUrl ?? "",
        provider: "google_drive",
        revisionId: captured.revision?.id,
      }],
      write: true,
    });
    expect(backlog).toMatchObject({ revision: { provider: "google_drive" }, written: [{ provider: "google_drive" }] });
    noGitFields(backlog);
    expect((await driveEngine.lint()).errors).toEqual([]);
  });

  it("rejects GitHub-hosted URLs returned by a Google Drive repository across publication and reads", async () => {
    const hostileUrl = (path: string, anchor?: string) =>
      `https://raw.githubusercontent.com/hostile/vault/main/${path}${anchor ? `#${anchor}` : ""}`;

    const publicationPath = join(dir, "hostile-drive-publication");
    await cp(FIXTURE, publicationPath, { recursive: true });
    const publicationRepo = await FakeDriveVaultRepository.open(publicationPath, hostileUrl);
    const publicationEngine = createEngine({ repo: publicationRepo, llm, state, readSyncTtlMs: 0 });
    await expect(publicationEngine.store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
    })).rejects.toThrow("Google Drive vault URL must not reference a GitHub host");

    const explicitGithubUrlsPath = join(dir, "hostile-drive-github-urls");
    await cp(FIXTURE, explicitGithubUrlsPath, { recursive: true });
    const explicitGithubUrlsRepo = await FakeDriveVaultRepository.open(explicitGithubUrlsPath);
    const publish = explicitGithubUrlsRepo.commitAndPublish.bind(explicitGithubUrlsRepo);
    explicitGithubUrlsRepo.commitAndPublish = async (message) => ({
      ...await publish(message),
      githubUrls: ["https://github.com/hostile/vault"],
    });
    const explicitGithubUrlsEngine = createEngine({ repo: explicitGithubUrlsRepo, llm, state, readSyncTtlMs: 0 });
    await expect(explicitGithubUrlsEngine.store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
    })).rejects.toThrow("published Google Drive revision must not contain GitHub URLs");

    const readPath = join(dir, "hostile-drive-reads");
    await cp(FIXTURE, readPath, { recursive: true });
    const readRepo = await FakeDriveVaultRepository.open(readPath, hostileUrl);
    const readEngine = createEngine({ repo: readRepo, llm, state, readSyncTtlMs: 0 });
    await expect(readEngine.search("insurance")).rejects.toThrow("Google Drive vault URL must not reference a GitHub host");
    await expect(readEngine.get("Areas/Insurance.md")).rejects.toThrow("Google Drive vault URL must not reference a GitHub host");
    await expect(readEngine.ask("What insurance do I have?")).rejects.toThrow("Google Drive vault URL must not reference a GitHub host");
  });

  it("rejects Drive backlog source and candidate githubUrl fields before publication", async () => {
    const sourcePath = join(dir, "hostile-drive-backlog-source");
    await cp(FIXTURE, sourcePath, { recursive: true });
    const sourceRepo = await FakeDriveVaultRepository.open(sourcePath);
    const sourceEngine = createEngine({ repo: sourceRepo, llm, state, readSyncTtlMs: 0 });
    await expect(sourceEngine.digestBacklog({
      rawText: "Remember to renew travel insurance.",
      sourceRefs: [{
        path: "Log/2026-06-13.md#^e-hostile",
        url: "https://drive.google.com/file/d/source/view",
        provider: "google_drive",
        githubUrl: "https://github.com/hostile/vault/blob/main/Log/2026-06-13.md",
      }],
      write: true,
    })).rejects.toThrow("Google Drive backlog sources must not contain GitHub compatibility URLs");
    expect((await sourceRepo.currentRevision()).id).toBe("drive-revision-0");

    const candidatePath = join(dir, "hostile-drive-backlog-candidate");
    await cp(FIXTURE, candidatePath, { recursive: true });
    const candidateRepo = await FakeDriveVaultRepository.open(candidatePath);
    const candidateEngine = createEngine({ repo: candidateRepo, llm, state, readSyncTtlMs: 0 });
    const extractBacklog = llm.extractBacklog.bind(llm);
    llm.extractBacklog = async (input) => {
      const result = await extractBacklog(input);
      return {
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          source_refs: [{
            path: "Log/2026-06-13.md#^e-hostile-candidate",
            url: "https://drive.google.com/file/d/candidate/view",
            provider: "google_drive",
            githubUrl: "https://github.com/hostile/vault/blob/main/Log/2026-06-13.md",
          }],
        })),
      };
    };
    await expect(candidateEngine.digestBacklog({
      rawText: "Remember to renew travel insurance.",
      sourceRefs: [{
        path: "Log/2026-06-13.md#^e-safe",
        url: "https://drive.google.com/file/d/safe/view",
        provider: "google_drive",
      }],
      write: true,
    })).rejects.toThrow("Google Drive backlog sources must not contain GitHub compatibility URLs");
    expect((await candidateRepo.currentRevision()).id).toBe("drive-revision-0");
  });

  it("stores a memory: evidence entry, meaning page, lint-clean commit (DoD #1 shape)", async () => {
    const result = await engine().store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
    });

    expect(result.filing).toBe("filed");
    expect(result).not.toHaveProperty("question");
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.revision).toMatchObject({
      provider: "github",
      id: result.commitSha,
      commitSha: result.commitSha,
    });
    expect(Number.isNaN(Date.parse(result.revision!.committedAt))).toBe(false);
    expect(result.urls).toEqual([result.evidenceUrl, ...(result.pageUrls ?? [])]);
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

  it("capture-first commits immutable evidence without invoking classifier or composer", async () => {
    const e = engine();
    const result = await e.captureEvidence!({
      content: "Voice note transcript: Blue Lantern.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-blue-lantern",
      verbatim: true,
    });

    expect(result).toMatchObject({ filing: "pending", pagesTouched: [] });
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(llm.classifyCalls).toBe(0);
    expect(llm.composeCalls).toBe(0);
    const entry = await e.getEntry(result.evidenceRef);
    expect(entry).toMatchObject({ sourceId: "wa-blue-lantern", contentType: "voice_note" });
    expect(entry.content).toContain("Blue Lantern");

    const replay = await e.captureEvidence!({
      content: "Voice note transcript: Blue Lantern.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-blue-lantern",
      verbatim: true,
    });
    expect(replay.evidenceRef).toBe(result.evidenceRef);
    expect(replay.commitSha).toBe(result.commitSha);
  });

  it("typed evidence-only enrichment never spends a full-page compose call", async () => {
    const e = engine();
    const captured = await e.captureEvidence!({
      content: "Voice note transcript: quick Blue Lantern microphone check.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-evidence-only",
      verbatim: true,
    });
    llm.disposition = "evidence_only";

    const result = await e.enrichEvidence!({
      evidenceRef: captured.evidenceRef,
      content: "Voice note transcript: quick Blue Lantern microphone check.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-evidence-only",
      verbatim: true,
    });

    expect(result).toMatchObject({ filing: "filed", pagesTouched: [], commitSha: captured.commitSha });
    expect(llm.classifyCalls).toBe(1);
    expect(llm.composeCalls).toBe(0);
  });

  it("typed compact enrichment appends one cited update without full-page composition", async () => {
    const e = engine();
    const captured = await e.captureEvidence!({
      content: "Insurance renewal moved to April 2027.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-compact",
      verbatim: true,
    });
    llm.disposition = "append_compact_note";

    const result = await e.enrichEvidence!({
      evidenceRef: captured.evidenceRef,
      content: "Insurance renewal moved to April 2027.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-compact",
      verbatim: true,
    });

    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(llm.composeCalls).toBe(0);
    const page = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
    expect(page).toContain("## Captured update");
    const anchor = captured.evidenceRef.split("#^")[1];
    expect(page).toContain(`[[${captured.evidenceRef.slice(4, 14)}#^${anchor}]]`);
  });

  it("typed semantic integration composes only after capture has committed", async () => {
    const e = engine();
    const captured = await e.captureEvidence!({
      content: "Integrate the renewed insurance policy into the insurance page.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-integrate",
      verbatim: true,
    });
    llm.disposition = "integrate_page";

    const result = await e.enrichEvidence!({
      evidenceRef: captured.evidenceRef,
      content: "Integrate the renewed insurance policy into the insurance page.",
      source: "whatsapp",
      contentType: "voice_note",
      sourceId: "wa-integrate",
      verbatim: true,
    });

    expect(result.filing).toBe("filed");
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(result.commitSha).not.toBe(captured.commitSha);
    expect(llm.composeCalls).toBe(1);
  });

  function topicLlm(content: string, failingPath?: string) {
    const parts = content.split("\n\n");
    llm.classify = vi.fn(async () => ({ confidence: 0.2, summary: "mixed capture", tags: [], pages: [], topics: [
      { topic: "Insurance", summary: "renewal", evidenceQuotes: [parts[0]!], confidence: 0.95, disposition: "integrate_page" as const,
        pages: [{ path: "Areas/Insurance", title: "Insurance", action: "update" as const }, { path: "Areas/Insurance.md", title: "Insurance", action: "update" as const }] },
      { topic: "Axa", summary: "Axa update", evidenceQuotes: [parts[1]!], confidence: 0.9, disposition: "integrate_page" as const,
        pages: [{ path: "Notes/Axa.md", title: "Axa", action: "update" as const }] },
      { topic: "Znot or Zenod?", summary: "uncertain spelling", evidenceQuotes: [parts[2]!], confidence: 0.2, disposition: "needs_clarification" as const,
        pages: [{ path: "Projects/Sample Project.md", title: "Project", action: "update" as const }], question: "Which name was intended?" },
    ] }));
    llm.composePage = vi.fn(async (input: ComposePageInput) => {
      if (input.path === failingPath) throw new Error("synthetic provider failure");
      return `${input.currentContent}\n\n> ${input.evidenceEntry.replaceAll("\n", "\n> ")}\n\n${input.citation}\n`;
    });
  }


  it.each([false, true])("repairs empty topic destinations within the existing retry while preserving siblings (exhausted: %s)", async (exhausted) => {
    const content = "Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content);
    const original = llm.classify.bind(llm);
    const inputs: ClassifyInput[] = [];
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      inputs.push(input);
      const result = await original(input);
      result.pages = [{ path: "Areas/Insurance.md", action: "update", title: "Insurance" }];
      if (exhausted || inputs.length === 1) result.topics![0]!.pages = [];
      if(input.retryDecisions) result.topics = result.topics!.flatMap(topic=>{
        const decision=input.retryDecisions!.find(item=>item.topic.topic===topic.topic);
        return decision?[{...topic,retryId:decision.id}]:[];
      });
      return result;
    });
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "selftest" });
    const result = await e.enrichEvidence!({ content, source: "selftest", evidenceRef: captured.evidenceRef });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.hints.join(" ")).not.toContain("Structural correction:");
    expect(inputs[0]!.hints.join(" ")).toContain("organizing this evidence is NOT complete");
    expect(inputs[1]!.hints.join(" ")).toContain("Top-level pages do not route topics");
    expect(result.topics!.find(topic => topic.topic === "Axa")!.status).toBe("filed");
    expect(result.topics!.find(topic => topic.topic === "Insurance")!.status).toBe(exhausted ? "pending" : "filed");
    if (exhausted) {
      expect(result.topics!.find(topic => topic.topic === "Insurance")!.reason).toContain("classification_topic_destination_missing");
      expect(result.pagesTouched).not.toContain("Areas/Insurance.md");
    }
    expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
  });

  it.each([{exhausted:false,empty:false},{exhausted:true,empty:false},{exhausted:false,empty:true},{exhausted:true,empty:true}])("retries wrong source addresses within the existing budget and preserves valid siblings ($exhausted/$empty)", async ({exhausted,empty}) => {
    const content = "Insurance update.\n\nAxa update.\n\nZnot uncertain. " + "Context filler. ".repeat(100).trimEnd();
    topicLlm(content);
    const original = llm.classify.bind(llm);
    const inputs: ClassifyInput[] = [];
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      inputs.push(input);
      const result = await original(input);
      result.topics!.forEach((topic, index) => {
        topic.evidenceAssignments = [{ quote: topic.evidenceQuotes[0]!, occurrence: 0,
          passageId: index === 0 && (exhausted || inputs.length === 1) ? input.sourcePassages!.at(-1)!.id : input.sourcePassages![0]!.id }];
        if (empty && index === 0 && (exhausted || inputs.length === 1)) topic.evidenceAssignments=[];
      });
      if(input.retryDecisions) result.topics = result.topics!.flatMap(topic=>{
        const decision=input.retryDecisions!.find(item=>item.topic.topic===topic.topic);
        return decision?[{...topic,retryId:decision.id}]:[];
      });
      return result;
    });
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "selftest" });
    const result = await e.enrichEvidence!({ content, source: "selftest", evidenceRef: captured.evidenceRef });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.sourcePassages!.length).toBeGreaterThan(1);
    expect(inputs[0]!.hints.join(" ")).not.toContain("Structural correction:");
    expect(inputs[0]!.hints.join(" ")).toContain("organizing this evidence is NOT complete");
    expect(inputs[1]!.hints.join(" ")).toContain("each evidence assignment must use a supplied passage ID");
    expect(result.topics!.find(topic => topic.topic === "Axa")!.status).toBe("filed");
    expect(result.topics!.find(topic => topic.topic === "Insurance")!.status).toBe(exhausted ? "pending" : "filed");
    if (exhausted) expect(result.pagesTouched).not.toContain("Areas/Insurance.md");
    expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
  });

  it("persists accepted classification siblings across malformed repair and a fresh-engine pending receipt retry", async () => {
    const content="Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content);
    const original=llm.classify.bind(llm), inputs:ClassifyInput[]=[];
    llm.classify=vi.fn(async(input:ClassifyInput)=>{
      inputs.push(input);
      if(inputs.length===2) throw new Error("classify: structured_output_invalid");
      const result=await original(input);
      if(inputs.length===1) result.topics![1]!.evidenceQuotes=["Source text that does not exist."];
      if(input.retryDecisions){
        // An attempted rewrite of the accepted sibling is not an owned target.
        result.topics=result.topics!.flatMap(topic=>{
          const decision=input.retryDecisions!.find(item=>item.topic.topic===topic.topic);
          return decision?[{...topic,topic:"Renamed Axa idea",retryId:decision.id}]:[];
        });
      }
      return result;
    });
    const e=engine(),captured=await e.captureEvidence!({content,source:"selftest"});
    const input={content,source:"selftest",evidenceRef:captured.evidenceRef};
    const first=await e.enrichEvidence!(input);
    expect(first.topics!.find(t=>t.topic==="Insurance")!.status).toBe("filed");
    const failed=first.topics!.find(t=>t.topic==="Axa")!;
    expect(failed.status).toBe("pending");expect(failed.reason).toContain("classification_source_address_invalid");expect(failed.reason).toContain("structured_output_invalid");
    expect(inputs[1]!.retryDecisions!.map(d=>d.topic.topic)).not.toContain("Insurance");
    const insurance=await readFile(join(repo.path,"Areas/Insurance.md"),"utf8");
    const second=await engine().enrichEvidence!(input);
    expect(inputs).toHaveLength(3);expect(inputs[2]!.retryDecisions!.map(d=>d.topic.topic)).toEqual(["Axa"]);
    expect(second.topics!.find(t=>t.topic==="Insurance")!.status).toBe("filed");
    expect(second.topics!.find(t=>t.topic==="Renamed Axa idea")!.ideaId).toBe(failed.ideaId);
    expect(second.topics!.find(t=>t.topic==="Renamed Axa idea")!.status).toBe("filed");
    expect(await readFile(join(repo.path,"Areas/Insurance.md"),"utf8")).toBe(insurance);
    expect(vi.mocked(llm.composePage).mock.calls.filter(([i])=>i.path==="Areas/Insurance.md")).toHaveLength(1);
    const before=await repo.currentRevision(),calls=vi.mocked(llm.composePage).mock.calls.length;
    await engine().enrichEvidence!(input);
    expect(inputs).toHaveLength(3);expect(vi.mocked(llm.composePage).mock.calls).toHaveLength(calls);
    expect(await repo.currentRevision()).toEqual(before);expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
  });

  it("resumes an old whole-window receipt with multiple new decisions and keeps the original capture",async()=>{
    const content="Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content);const original=llm.classify.bind(llm);
    llm.classify=vi.fn(async(input:ClassifyInput)=>{
      expect(input.retryDecisions).toHaveLength(1);expect(input.retryDecisions![0]!.scope).toBe("source_window");
      const result=await original(input);result.topics=result.topics!.map(topic=>({...topic,retryId:input.retryDecisions![0]!.id}));return result;
    });
    const e=engine(),captured=await e.captureEvidence!({content,source:"selftest"});
    const input={content,source:"selftest",evidenceRef:captured.evidenceRef};
    const receipt=sealFilingReceipt({version:1,evidenceRef:captured.evidenceRef,inputFingerprint:filingInputFingerprint(input),phase:"ready",baseRevision:await repo.currentRevision(),files:{},
      classification:{pages:[],confidence:0,summary:"pending",tags:[],topics:[{ideaId:"legacy",topic:"Unclassified segment 1",summary:"classification pending",evidenceQuotes:[content],sourceRange:{start:0,end:content.length},classificationFailed:true,pages:[],confidence:0,disposition:"needs_clarification"}]},
      outcomes:[{ideaId:"legacy",topic:"Unclassified segment 1",evidenceRef:captured.evidenceRef,status:"pending",sourceSpans:[{start:0,end:content.length}],confidence:0,disposition:"needs_clarification",pages:[],filedPages:[],reason:"classification_unavailable"}]});
    await writeFile(join(repo.path,filingReceiptPath(captured.evidenceRef)),renderFilingReceipt(receipt));await repo.commitAndPublish("old receipt");
    const result=await engine().enrichEvidence!(input);expect(result.topics!.filter(t=>t.status==="filed")).toHaveLength(2);
    expect(result.topics!.find(t=>t.topic==="Znot or Zenod?")!.status).toBe("uncertain");expect(llm.classify).toHaveBeenCalledTimes(1);
    expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
    await engine().enrichEvidence!(input);expect(llm.classify).toHaveBeenCalledTimes(1);
  });

  it("retains catalog safety and explicit missing coverage when corrective discovery fails",async()=>{
    const content="Insurance update. " + "First context. ".repeat(130) + "\n\nAxa later update.";
    const inputs:ClassifyInput[]=[];
    llm.classify=vi.fn(async(input:ClassifyInput)=>{
      inputs.push(input);if(inputs.length>1)throw new Error("classify: structured_output_invalid");
      return {pages:[],summary:"mixed",confidence:.9,tags:[],passageReviews:input.sourcePassages!.map(p=>({passageId:p.id,status:"assigned" as const})),topics:[
        {topic:"Insurance",summary:"update",evidenceQuotes:[],evidenceAssignments:[{passageId:input.sourcePassages![0]!.id,quote:"Insurance update.",occurrence:0}],confidence:.9,disposition:"append_compact_note" as const,pages:[{path:"Areas/Insurance",title:"Insurance",action:"update" as const}]},
        {topic:"Unknown destination",summary:"uncertain",evidenceQuotes:[],evidenceAssignments:[{passageId:input.sourcePassages![0]!.id,quote:"Insurance update.",occurrence:0}],confidence:.4,disposition:"needs_clarification" as const,pages:[{path:"Projects/Invented.md",title:"Invented",action:"create" as const}],question:"Which project?"}
      ]};
    });
    const e=engine(),captured=await e.captureEvidence!({content,source:"selftest"});
    const result=await e.enrichEvidence!({content,source:"selftest",evidenceRef:captured.evidenceRef});
    expect(inputs).toHaveLength(2);expect(inputs[1]!.retryDecisions!.every(d=>d.scope==="source_window")).toBe(true);
    expect(inputs[1]!.retryDecisions!.map(d=>d.topic.topic)).not.toContain("Insurance");
    expect(result.topics!.find(t=>t.topic==="Insurance")!.status).toBe("filed");
    expect(result.topics!.find(t=>t.topic==="Unknown destination")!.pages).toEqual([]);
    expect(result.topics!.some(t=>t.reason?.includes("classification_assigned_passage_unsupported")&&t.status==="pending")).toBe(true);
    expect(result.pagesTouched).not.toContain("Projects/Invented.md");
    expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
  });

  it("an invalid optional catalog refinement cannot erase accepted or source-backed uncertain decisions",async()=>{
    await Promise.all(Array.from({length:25},(_,i)=>writeFile(join(repo.path,`Notes/Extra ${i}.md`),`# Extra ${i}\n\nUnrelated catalog page.\n`)));
    await repo.commitAndPublish("large catalog");
    const content="Insurance update.\n\nAxa update.";const inputs:ClassifyInput[]=[];
    llm.classify=vi.fn(async(input:ClassifyInput)=>{
      inputs.push(input);
      const base={pages:[],confidence:.9,summary:"mixed",tags:[]};
      const good={topic:"Insurance",summary:"update",evidenceQuotes:["Insurance update."],confidence:.95,disposition:"append_compact_note" as const,pages:[{path:"Areas/Insurance.md",title:"Insurance",action:"update" as const}]};
      const uncertain={topic:"Axa",summary:"uncertain route",evidenceQuotes:["Axa update."],confidence:.4,disposition:"needs_clarification" as const,pages:[],question:"Which project?"};
      if(!input.retryDecisions)return {...base,topics:[good,uncertain]};
      expect(input.retryDecisions.map(d=>d.topic.topic)).toEqual(["Axa"]);
      return {...base,topics:[{...uncertain,evidenceQuotes:["Fabricated text"],retryId:input.retryDecisions[0]!.id},{...good,topic:"Rewrite accepted sibling",retryId:"unknown-id"}]};
    });
    const e=engine(),capture=await e.captureEvidence!({content,source:"selftest"});
    const result=await e.enrichEvidence!({content,source:"selftest",evidenceRef:capture.evidenceRef});
    expect(inputs).toHaveLength(2);expect(inputs[1]!.hints.join(" ")).toContain("fallback search");
    expect(result.topics!.map(t=>[t.topic,t.status])).toEqual([["Insurance","filed"],["Axa","uncertain"]]);
    expect(result.topics![1]!.reason).toBe("Which project?");
  });

  it("discovers a pending label across languages but requires the exact raw read for answer support", async () => {
    const e = engine(), content = "La actividad sigue siendo provisional.";
    const capture = await e.captureEvidence!({content, source:"selftest"});
    const path=filingReceiptPath(capture.evidenceRef);
    const receipt=sealFilingReceipt({version:1,evidenceRef:capture.evidenceRef,inputFingerprint:"discovery-only",phase:"ready",baseRevision:await repo.currentRevision(),files:{},
      classification:{topics:[{ideaId:"pending",topic:"Library reading proposal",summary:"internal",evidenceQuotes:[content],evidenceAssignments:[],confidence:.9,disposition:"needs_clarification",pages:[]}]} as any,
      outcomes:[{ideaId:"pending",topic:"Library reading proposal",evidenceRef:capture.evidenceRef,status:"uncertain",sourceSpans:[{start:0,end:content.length}]}] as any});
    await writeFile(join(repo.path,path),renderFilingReceipt(receipt));await repo.commitAndPublish("pending fixture");
    llm.answerOverride=async (_input,tools)=>{
      const search=await tools.searchVault!("library reading");
      expect(search).toContain(capture.evidenceRef);expect(search).toContain("Pending topic discovery");
      expect(search).not.toContain("answerSupports");expect(search).not.toContain("Verified fact context");
      const read=JSON.parse(await tools.readNote!(capture.evidenceRef));
      expect(read.answerSupports.length).toBeGreaterThan(0);
      return {text:"ignored",readPaths:[capture.evidenceRef],supportSelections:[{id:read.answerSupports[0].id,mode:"raw_report"}]};
    };
    const answer=await e.ask("Is the library reading decided?");expect(answer.text).toContain(content);expect(answer.text).not.toContain("inputFingerprint");
  });

  it("passes the declared specific branch scope when shared emotions do not establish its subject",async()=>{
    const path="Areas/Relatives.md",scope="Father, sister, inheritance and arrangements within the family.";
    const raw=serializeNote({title:"Family arrangements",type:"area",tags:[],summary:scope,created:"2026-09-01",updated:"2026-09-01"},"# Family arrangements\nFinding peace is important.\n[[Index]]\n");
    await writeFile(join(repo.path,path),raw);await repo.commitAndPublish("declared family scope");
    const content="I may rent near a quiet studio because I want peace; I have not decided.";
    llm.classify=vi.fn(async()=>({confidence:.95,summary:"Quiet studio",tags:[],pages:[],topics:[{topic:"Quiet studio",summary:content,evidenceQuotes:[content],confidence:.95,disposition:"integrate_page" as const,pages:[{path,title:"Family arrangements",action:"update" as const}]}]}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      expect(request.branch).toEqual({title:"Family arrangements",scope});
      expect(JSON.stringify({branch:request.branch,statements:request.statements}).length).toBeLessThanOrEqual(8000);
      return [{kind:"clarify" as const,ideaIds:[request.ideas[0]!.id],sourceIds:request.ideas[0]!.sourceIds,sourceQuote:content,targetId:null,factKey:null,correctionQuote:null,reason:"The studio proposal does not establish a relationship to the declared relatives and inheritance subject."}];
    });Object.assign(llm,{reconcile});
    const result=await engine().store({content,source:"selftest"});
    expect(reconcile).toHaveBeenCalledOnce();expect(result.topics![0]!.status).toBe("pending");
    expect(await readFile(join(repo.path,path),"utf8")).toBe(raw);
  });

  it.each([false,true])("reconstructs owned ADD candidates across destinations and pending receipt retry without copying model quotes (sourceUnits=%s)",async sourceUnits=>{
    const paths=["Projects/SharedA.md","Projects/SharedB.md"];
    for(const path of paths)await writeFile(join(repo.path,path),`# Shared\nPreserved history.\n[[Index]]\n`);
    await repo.commitAndPublish("seed shared destinations");
    const quote="Only if approved, Mina checks the drain. No decision has been made.";
    const content="This remains provisional. "+quote+" A separate option exists.";
    const {classificationSourceUnits}=await import("../src/llm/classificationSourceUnits.js");
    llm.classify=vi.fn(async(input:ClassifyInput)=>({confidence:.95,summary:"Shared qualification",tags:[],pages:[],passageReviews:[{passageId:input.sourcePassages![0]!.id,status:"assigned" as const}],topics:paths.map(path=>({topic:path,summary:quote,evidenceQuotes:[],evidenceAssignments:sourceUnits?classificationSourceUnits(input.sourcePassages!,input.sourceRange).assignments(["u2","u3"]):[{passageId:input.sourcePassages![0]!.id,quote,occurrence:0}],confidence:.95,disposition:"integrate_page" as const,pages:[{path,title:"Shared",action:"update" as const}]}))}));
    let rejectB=true;
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      expect(request.ideas).toHaveLength(1);
      expect(request.addCandidates).toHaveLength(1);
      const candidate=request.addCandidates![0]!;
      expect(candidate.text).toBe(quote);expect(candidate.ideaIds).toEqual([request.ideas[0]!.id]);
      expect(candidate.start).toBe(content.indexOf(quote));
      expect(request.sources.map(source=>source.text).join("")).toContain("No decision has been made.");
      return [{kind:"add" as const,ideaIds:[request.ideas[0]!.id],sourceIds:[request.path===paths[1]&&rejectB?"missing":candidate.id],sourceQuote:"Mina checks the drain. Invented punctuation!",targetId:null,factKey:null,correctionQuote:null,reason:null}];
    });Object.assign(llm,{reconcile});
    const e=engine(),captured=await e.captureEvidence!({content,source:"whatsapp"});
    const request={content,source:"whatsapp" as const,evidenceRef:captured.evidenceRef};
    const first=await e.enrichEvidence!(request);expect(first.topics!.map(topic=>topic.status)).toEqual(["filed","pending"]);
    const firstPage=await readFile(join(repo.path,paths[0]!),"utf8");expect(firstPage).toContain(quote);expect(firstPage).not.toContain("Invented punctuation");
    rejectB=false;
    const reopened=createEngine({repo:await VaultRepo.open({workdir:repo.path}),state,llm,readSyncTtlMs:0});
    const second=await reopened.enrichEvidence!(request);expect(second.filing).toBe("filed");
    expect(reconcile).toHaveBeenCalledTimes(3);expect(llm.classify).toHaveBeenCalledOnce();
    expect(await readFile(join(repo.path,paths[0]!),"utf8")).toBe(firstPage);
    expect((await readFile(join(repo.path,paths[1]!),"utf8")).split(quote)).toHaveLength(2);
    await reopened.enrichEvidence!(request);expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it("gives each destination its own bounded context instead of starving sibling branches",async()=>{
    const names=["BranchA","BranchB","BranchC"];
    const pages=names.map(name=>({path:`Projects/${name}.md`,title:name,action:"update" as const}));
    for(const page of pages)await writeFile(join(repo.path,page.path),`# ${page.title}\n\n`+[0,1,2].map(n=>`## ${page.title} policy ${n}\n\n${page.title} baseline rule ${n}.\n`+`${page.title} supporting background.\n`.repeat(90)).join("\n")+"\n[[Index]]\n");
    await repo.commitAndPublish("large independent branches");
    const parts=pages.flatMap(page=>Array.from({length:8},(_,i)=>({page,text:`${page.title} topic ${i} adds a fact.`,topic:`${page.title} proposition ${i}`})));
    const content=parts.map(part=>part.text).join("\n\n");
    const snapshot=await scanVault(repo.path);
    const queries=parts.map(part=>({topic:part.topic,query:part.text,paths:[part.page.path]}));
    const aggregate=await branchContext(repo.path,snapshot,queries);
    expect(aggregate.branches.length).toBeLessThan(3); // The former shared packet really loses targets.
    for(const page of pages){
      const packet=await branchContext(repo.path,snapshot,queries.filter(query=>query.paths[0]===page.path));
      expect(packet.branches.map(branch=>branch.path)).toEqual([page.path]);
      expect(JSON.stringify(packet).length).toBeLessThanOrEqual(BRANCH_CONTEXT_MAX_CHARS);
    }
    llm.classify=vi.fn(async()=>({pages:[],confidence:.95,summary:"Independent branches",tags:[],topics:parts.map(part=>({topic:part.topic,summary:part.topic,evidenceQuotes:[part.text],confidence:.95,disposition:"append_compact_note" as const,pages:[part.page]}))}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      const name=pages.find(page=>page.path===request.path)!.title;
      expect(request.statements.some(statement=>statement.text===`${name} baseline rule 0.`)).toBe(true);
      expect(request.statements.every(statement=>!names.filter(other=>other!==name).some(other=>statement.text.includes(other)))).toBe(true);
      return request.ideas.map(idea=>({kind:"add" as const,ideaIds:[idea.id],sourceIds:idea.sourceIds,sourceQuote:request.sources.find(source=>source.id===idea.sourceIds[0])!.text,targetId:null,factKey:null,correctionQuote:null,reason:null}));
    });Object.assign(llm,{reconcile});
    const result=await engine().store({content,source:"selftest"});
    expect(reconcile).toHaveBeenCalledTimes(3);expect(llm.classify).toHaveBeenCalledTimes(1);
    expect(result.topics).toHaveLength(24);expect(result.topics!.every(topic=>topic.status==="filed")).toBe(true);
    expect(result.pagesTouched.sort()).toEqual(pages.map(page=>page.path).sort());
  });

  it("uses atomic reconciliation for legacy store and compact captured enrichment without page composition", async () => {
    const path="Projects/Legacy.md"; const raw="# Legacy\n\nUnrelated preserved history.\n[[Index]]\n";
    await writeFile(join(repo.path,path),raw); await repo.commitAndPublish("seed plain legacy project");
    llm.classifyPath=path; llm.disposition="append_compact_note";
    const reconcile=vi.fn(async (value:import("../src/engine/reconciliation.js").ReconciliationInput) => value.ideas.map(idea=>({kind:"add" as const,ideaIds:[idea.id],sourceIds:idea.sourceIds,sourceQuote:value.sources.find(source=>source.id===idea.sourceIds[0])!.text,statement:null,targetId:null,factKey:null,correctionQuote:null,reason:null})));
    Object.assign(llm,{reconcile});
    const e=engine(); const first=await e.store({content:"The video explains logarithms.",source:"mcp"});
    expect(first.filing).toBe("filed");expect(llm.composeCalls).toBe(0);
    expect(await readFile(join(repo.path,path),"utf8")).toContain(raw);
    const captured=await e.captureEvidence!({content:"The video also explains network effects.",source:"whatsapp",sourceId:"atomic-fixture"});
    const filed=await e.enrichEvidence!({content:"The video also explains network effects.",source:"whatsapp",evidenceRef:captured.evidenceRef});
    expect(filed.filing).toBe("filed"); expect(reconcile).toHaveBeenCalledTimes(2); expect(llm.composeCalls).toBe(0);
    expect(filed.topics![0]!.ideaId).toMatch(/^idea-/); expect(filed.topics![0]!.appliedOperationIds).toHaveLength(1);
  });

  it("routes explicit known evidence-only destinations to source-native reconciliation without guessing missing destinations",async()=>{
    const path="Projects/Teaching.md";
    await writeFile(join(repo.path,path),"# Teaching\nTeach using scale models.\n[[Index]]\n");await repo.commitAndPublish("seed teaching");
    const parts=["Seguimos enseñando con modelos de escala.","Tengo una hipótesis sin verificar. No lo doy por probado.","Un colega propone otra fecha. No está confirmada.","Reserve two places for teachers."];
    const content=parts.join("\n\n");
    llm.classify=vi.fn(async()=>({confidence:0.95,summary:"Teaching ideas",tags:[],pages:[],topics:parts.map((quote,i)=>({topic:["Scale","Hypothesis","Report","Unrouted"][i]!,summary:quote,evidenceQuotes:[quote],confidence:0.95,disposition:"evidence_only" as const,pages:i===3?[]:[{path,title:"Teaching",action:"update" as const}]}))}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      expect(request.ideas.map(idea=>idea.topic)).toEqual(["Scale","Hypothesis","Report"]);
      return request.ideas.map(idea=>({kind:idea.topic==="Scale"?"link_source" as const:idea.topic==="Report"?"conflict" as const:"add" as const,
        ideaIds:[idea.id],sourceIds:idea.sourceIds,sourceQuote:request.sources.find(source=>source.id===idea.sourceIds[0])!.text,
        targetId:idea.topic==="Scale"?request.statements.find(statement=>statement.text==="Teach using scale models.")!.id:null,
        statement:"This generated paraphrase must never be stored.",factKey:null,correctionQuote:null,reason:null}));
    });Object.assign(llm,{reconcile});
    const e=engine();const captured=await e.captureEvidence!({content,source:"whatsapp"});
    const request={content,source:"whatsapp" as const,evidenceRef:captured.evidenceRef};
    const result=await e.enrichEvidence!(request);
    expect(result.topics!.find(topic=>topic.topic==="Scale")).toMatchObject({confidence:0.95,filedPages:[path]});
    expect(result.topics!.find(topic=>topic.topic==="Report")).toMatchObject({status:"uncertain",filedPages:[path],uncertainPages:[path]});
    expect(result.topics!.find(topic=>topic.topic==="Unrouted")).toMatchObject({pages:[],filedPages:[]});
    const raw=await readFile(join(repo.path,path),"utf8");expect(raw).toContain(parts[1]);expect(raw).toContain(parts[2]);expect(raw).not.toContain("This generated paraphrase");expect(raw).not.toContain(parts[3]);
    const replay=await e.enrichEvidence!(request);expect(replay.commitSha).toBe(result.commitSha);expect(reconcile).toHaveBeenCalledTimes(1);
    llm.answerOverride=async(_input,tools)=>{
      const view=JSON.parse(await tools.readFacts!({path}));
      const report=view.facts.find((fact:{key:string})=>fact.key.startsWith("report."));
      expect(report.status).toBe("conflict");expect(report.supersedes).toEqual([]);
      const support=view.answerSupports.find((item:{factId:string})=>item.factId===report.id);
      expect(support.modes).toEqual(["conflict"]);
      return {text:"",readPaths:[path],supportSelections:[{id:support.id,mode:"conflict"}]};
    };
    expect((await e.ask("What was the unconfirmed report?")).text).toContain(parts[2]);
  });

  it("unions overlapping ASR context envelopes without losing independent ideas",async()=>{
    const lead="The room opens in the morning. ";
    const first="Each visitor receives a chart. ";
    const second="Each teacher receives a pen. ";
    const tail="The room closes in the evening.";
    const content=Array.from({length:100},(_,i)=>`Background observation ${i} is recorded. `).join("")+lead+first+second+tail;
    llm.classify=vi.fn(async()=>({confidence:0.95,summary:"ASR recipients",tags:[],pages:[],topics:[
      {topic:"Visitors",summary:"Visitors",evidenceQuotes:[lead+first+second]},
      {topic:"Teachers",summary:"Teachers",evidenceQuotes:[first+second+tail]},
    ].map(topic=>({...topic,confidence:0.95,disposition:"integrate_page" as const,pages:[{path:"Areas/Insurance.md",title:"Insurance",action:"update" as const}]}))}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      expect(request.sources).toHaveLength(1);
      expect(request.ideas).toHaveLength(2);
      return request.ideas.map(idea=>({kind:"add" as const,ideaIds:[idea.id],sourceIds:request.addCandidates!.filter(candidate=>candidate.ideaIds.includes(idea.id)).map(candidate=>candidate.id),sourceQuote:idea.topic==="Visitors"?first.trim():second.trim(),statement:null,targetId:null,factKey:null,correctionQuote:null,reason:null}));
    });
    Object.assign(llm,{reconcile});const e=engine();const captured=await e.captureEvidence!({content,source:"whatsapp"});
    const result=await e.enrichEvidence!({content,source:"whatsapp",evidenceRef:captured.evidenceRef});
    expect(result.filing).not.toBe("pending");expect(result.topics!.filter(topic=>topic.status==="filed")).toHaveLength(2);
  });

  it("files a complete proposition crossing the host source chunk boundary",async()=>{
    const quote="Each visitor must receive a durable chart printed on waterproof paper before leaving.";
    const content="Background. ".repeat(131)+quote;
    llm.classify=vi.fn(async(input:ClassifyInput)=>({confidence:.95,summary:"Visitor chart",tags:[],pages:[],passageReviews:input.sourcePassages!.map(p=>({passageId:p.id,status:p.end>content.indexOf(quote)?"assigned" as const:"evidence_only" as const})),topics:[{topic:"Visitor chart",summary:quote,evidenceQuotes:[],evidenceAssignments:[{passageId:input.sourcePassages!.find(p=>p.start<=content.indexOf(quote)&&p.end>content.indexOf(quote))!.id,quote,occurrence:0}],confidence:.95,disposition:"integrate_page" as const,pages:[{path:"Areas/Insurance.md",title:"Insurance",action:"update" as const}]}]}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      expect(request.sources).toHaveLength(2);
      expect(request.sources.some(source=>source.text.includes(quote))).toBe(false);
      return [{kind:"add" as const,ideaIds:[request.ideas[0]!.id],sourceIds:[request.addCandidates!.find(candidate=>candidate.text===quote)!.id],sourceQuote:"-",statement:quote,targetId:null,factKey:null,correctionQuote:null,reason:null}];
    });
    Object.assign(llm,{reconcile});const e=engine();
    const captured=await e.captureEvidence!({content,source:"whatsapp"});
    const result=await e.enrichEvidence!({content,source:"whatsapp",evidenceRef:captured.evidenceRef});
    expect(result.filing).toBe("filed");
    expect(await readFile(join(repo.path,"Areas/Insurance.md"),"utf8")).toContain(quote);
  });

  it.each([false,true])("files a coarse idea as reinforcement plus a new condition and replays the completed receipt (legacy summary: %s)", async(longSummary)=>{
    const path="Projects/Garden.md",existing="Mina waters on Tuesday.",condition="If it rains, Mina checks the drain before watering.";
    const oldSummary="Existing garden context. ".repeat(30).trim();
    const body=`# Garden\n${existing}\n[[Index]]\n`;
    const raw=longSummary?serializeNote({title:"Garden",type:"project",tags:[],created:"2026-09-01",updated:"2026-09-01",summary:oldSummary},body):body;
    await writeFile(join(repo.path,path),raw);await repo.commitAndPublish("seed garden");
    const content=existing+" "+condition;
    llm.classify=vi.fn(async()=>({confidence:0.95,summary:"Garden",tags:[],pages:[],topics:[{topic:"Watering assignment and new rain procedure",summary:content,evidenceQuotes:[existing,condition],confidence:0.95,disposition:"integrate_page" as const,pages:[{path,title:"Garden",action:"update" as const}]}]}));
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      const common={ideaIds:[request.ideas[0]!.id],sourceIds:request.ideas[0]!.sourceIds,factKey:null,correctionQuote:null,reason:null};
      return [{...common,kind:"link_source" as const,sourceQuote:existing,targetId:request.statements.find(s=>s.text===existing)!.id},{...common,kind:"add" as const,sourceIds:[request.addCandidates!.find(candidate=>candidate.text===condition)!.id],sourceQuote:"ignored generated words",targetId:null}];
    });
    Object.assign(llm,{reconcile});const e=engine(),captured=await e.captureEvidence!({content,source:"whatsapp"});
    const request={content,source:"whatsapp" as const,evidenceRef:captured.evidenceRef};
    const first=await e.enrichEvidence!(request);expect(first.filing).toBe("filed");
    expect(first.topics![0]!.appliedOperationIds).toHaveLength(2);
    const page=await readFile(join(repo.path,path),"utf8");expect(page.split(existing)).toHaveLength(2);expect(page.split(condition)).toHaveLength(2);
    if(longSummary){
      expect(String(parseNote(page).frontmatter!.summary).length).toBeLessThanOrEqual(480);
      expect(page).toContain(`## Previous summary\n\n${oldSummary}`);
      expect(page).toContain("[[Index]]");expect((await e.lint()).errors).toEqual([]);
    }
    const reopened=createEngine({repo:await VaultRepo.open({workdir:repo.path}),state,llm,readSyncTtlMs:0});
    const replay=await reopened.enrichEvidence!(request);expect(replay.commitSha).toBe(first.commitSha);
    expect(await readFile(join(repo.path,path),"utf8")).toBe(page);expect(reconcile).toHaveBeenCalledOnce();expect(llm.classify).toHaveBeenCalledOnce();
  });

  it("retries only unfinished atomic ideas after rejecting a mixed recorded-style plan", async () => {
    const path="Projects/Workshop.md";
    await writeFile(join(repo.path,path),"# Workshop\nCapacity is 6.\nOpening is on 12.\n[[Index]]\n");
    await repo.commitAndPublish("seed workshop");
    const parts=["Capacity is 6.","Correction: opening moves to 19.","Tools are inspected."];
    const content=parts.join("\n\n");
    llm.classify=vi.fn(async()=>({confidence:0.95,summary:"Workshop update",tags:[],pages:[],topics:parts.map((quote,i)=>({topic:["Capacity","Opening","Tools"][i]!,summary:quote,evidenceQuotes:[quote],confidence:0.95,disposition:"integrate_page" as const,pages:[{path,title:"Workshop",action:"update" as const}]}))}));
    let attempt=0;
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      attempt++;
      const decision=(topic:string,kind:"add"|"link_source"|"supersede",quote:string,target:string|null=null,statement:string|null=null)=>{
        const idea=request.ideas.find(idea=>idea.topic===topic)!;
        return {kind,ideaIds:[idea.id],sourceIds:kind==="add"&&quote==="Invented support."?["missing-candidate"]:idea.sourceIds,sourceQuote:quote,targetId:target,statement,factKey:null,correctionQuote:kind==="supersede"?parts[1]!:null,reason:null};
      };
      if(attempt===1) return [decision("Capacity","add",parts[0]!),decision("Capacity","link_source",":123:456",request.statements.find(s=>s.text===parts[0])!.id),decision("Opening","supersede","opening moves to 19",request.statements.find(s=>s.text==="Opening is on 12.")!.id,"Opening moves to 19."),decision("Tools","add","Invented support.")];
      expect(request.ideas.map(idea=>idea.topic)).toEqual(["Capacity","Tools"]);
      expect(request.ideas[0]!.priorFailure).toContain("source_support_invalid");
      return [decision("Capacity","link_source",parts[0]!,request.statements.find(s=>s.text===parts[0])!.id),decision("Tools","add",parts[2]!,null,"We inspect tools.")];
    });
    Object.assign(llm,{reconcile});const e=engine();
    const captured=await e.captureEvidence!({content,source:"whatsapp"});
    const input={content,source:"whatsapp" as const,evidenceRef:captured.evidenceRef};
    const first=await e.enrichEvidence!(input);
    expect(first.topics!.find(t=>t.topic==="Opening")).toMatchObject({status:"filed",filedPages:[path]});
    expect(first.topics!.find(t=>t.topic==="Capacity")!.appliedOperationIds).toEqual([]);
    const firstPage=await readFile(join(repo.path,path),"utf8");
    expect(parseNote(firstPage).body.match(/Capacity is 6\./g)).toHaveLength(1);
    const reopened=createEngine({repo:await VaultRepo.open({workdir:repo.path}),state,llm,readSyncTtlMs:0});
    const second=await reopened.enrichEvidence!(input);
    expect(second.filing).toBe("filed");
    const page=await readFile(join(repo.path,path),"utf8");
    expect(parseNote(page).body.match(/Correction: opening moves to 19\./g)).toHaveLength(1);
    expect(parseNote(page).body.match(/Capacity is 6\./g)).toHaveLength(1);
    expect(parseNote(page).frontmatter!.memoryFacts).toHaveLength(1);
    expect(llm.classify).toHaveBeenCalledTimes(1);
    const replay=await reopened.enrichEvidence!(input);
    expect(replay.commitSha).toBe(second.commitSha);expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("files a conflict once while retrying the same idea's other destination", async()=>{
    const paths=["Projects/First.md","Projects/Second.md"];
    for(const path of paths) await writeFile(join(repo.path,path),"# Workshop\nOpening is on 12.\n[[Index]]\n");
    await repo.commitAndPublish("seed conflict destinations");
    const content="A colleague reports opening is on 19.";
    llm.classify=vi.fn(async()=>({confidence:0.95,summary:"Conflicting date",tags:[],pages:[],topics:[{topic:"Opening report",summary:content,evidenceQuotes:[content],confidence:0.95,disposition:"integrate_page" as const,pages:paths.map(path=>({path,title:"Workshop",action:"update" as const}))}]}));
    let secondCalls=0;
    const reconcile=vi.fn(async(request:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      if(request.path===paths[1] && ++secondCalls===1) throw new Error("synthetic model failure");
      return [{kind:"conflict" as const,ideaIds:[request.ideas[0]!.id],sourceIds:request.ideas[0]!.sourceIds,sourceQuote:content,statement:content,targetId:request.statements[0]!.id,factKey:null,correctionQuote:null,reason:null}];
    });
    Object.assign(llm,{reconcile});const e=engine();const captured=await e.captureEvidence!({content,source:"whatsapp"});
    const input={content,source:"whatsapp" as const,evidenceRef:captured.evidenceRef};
    const first=await e.enrichEvidence!(input);expect(first.filing).toBe("pending");
    expect(first.topics![0]).toMatchObject({filedPages:[paths[0]],uncertainPages:[paths[0]]});
    const before=await readFile(join(repo.path,paths[0]!),"utf8");
    const second=await e.enrichEvidence!(input);expect(second.filing).toBe("uncertain");
    expect(second.topics![0]).toMatchObject({status:"uncertain",filedPages:paths,uncertainPages:paths});
    expect(await readFile(join(repo.path,paths[0]!),"utf8")).toBe(before);
    const replay=await e.enrichEvidence!(input);expect(replay.commitSha).toBe(second.commitSha);
    expect(reconcile.mock.calls.map(([request])=>request.path)).toEqual([paths[0],paths[1],paths[1]]);
  });

  it.each(["before-page", "after-page", "before-push", "after-push"] as const)("recovers exact atomic filing at %s without regenerating an applied idea", async (crash) => {
    const content = "Insurance renewal is in October.";
    const reconcile = vi.fn(async (value: import("../src/engine/reconciliation.js").ReconciliationInput) => value.ideas.map(idea => ({ kind: "add" as const, ideaIds: [idea.id], sourceIds: idea.sourceIds, sourceQuote: value.sources.find(source => source.id === idea.sourceIds[0])!.text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
    Object.assign(llm, { reconcile });
    const e = engine(); const captured = await e.captureEvidence!({ content, source: "whatsapp" });
    const rawBefore = await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8");
    const input = { content, source: "whatsapp" as const, evidenceRef: captured.evidenceRef };
    const originalPublish = repo.commitAndPublish.bind(repo);
    let calls = 0;
    if (crash === "before-push" || crash === "after-push") {
      vi.spyOn(repo, "commitAndPublish").mockImplementationOnce(async (message, guard) => {
        if (crash === "before-push") await repo.commit(message);
        else await originalPublish(message, guard);
        throw new Error("synthetic crash");
      });
    }
    await expect(e.enrichEvidence!({ ...input, assertActive: () => {
      calls++;
      if ((crash === "before-page" && calls >= 5) || (crash === "after-page" && calls >= 6)) throw new Error("synthetic crash");
    } })).rejects.toThrow("synthetic crash");
    const beforeRetryCalls = llm.classifyCalls;
    if (crash === "before-push") {
      const localHead = await repo.headSha();
      const reopened = createEngine({ repo: await VaultRepo.open({ workdir: repo.path }), state, llm, readSyncTtlMs: 0 });
      await reopened.search("Insurance");
      expect(await repo.headSha()).toBe(localHead);
      await expect(reopened.captureEvidence!({ content: "unrelated new capture", source: "selftest" })).rejects.toThrow("filing_recovery_pending");
    }
    const recovered = await e.enrichEvidence!(input);
    expect(recovered.filing).toBe("filed");
    expect(reconcile).toHaveBeenCalledTimes(1); expect(llm.classifyCalls).toBe(beforeRetryCalls);
    expect(recovered.topics![0]!.appliedOperationIds).toHaveLength(1);
    const page = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
    expect(page.match(/<!-- zenod-op:/g)).toHaveLength(1);
    expect(await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8")).toBe(rawBefore);
    const replay = await e.enrichEvidence!(input);
    expect(replay.commitSha).toBe(recovered.commitSha); expect(reconcile).toHaveBeenCalledTimes(1);
    expect((await repo.currentPublishedRevision()).id).toBe(recovered.revision!.id);
  });

  it("recovers a checkpointed no-op without inventing an unchanged file publication", async () => {
    const content = "Insurance renewal is in October.";
    const reconcile = vi.fn(async (request: import("../src/engine/reconciliation.js").ReconciliationInput) => request.ideas.map(idea => ({ kind: "add" as const, ideaIds: [idea.id], sourceIds: idea.sourceIds,
      sourceQuote: request.sources.find(source => source.id === idea.sourceIds[0])!.text, statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null })));
    Object.assign(llm, { reconcile }); const e = engine();
    const stored = await e.store({ content, source: "selftest" });
    const before = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
    const input = { content, source: "selftest" as const, evidenceRef: stored.evidenceRef }; let checks = 0;
    await expect(e.enrichEvidence!({ ...input, assertActive: () => { if (++checks >= 5) throw new Error("crash after no-op checkpoint"); } })).rejects.toThrow("crash after no-op checkpoint");
    expect((await e.enrichEvidence!(input)).filing).toBe("filed");
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(await readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).toBe(before);
  });

  it("rejects a stale atomic page revision while preserving the concurrent edit", async () => {
    const path=join(repo.path,"Areas/Insurance.md"); const original=await readFile(path,"utf8");
    Object.assign(llm,{reconcile:async(value:import("../src/engine/reconciliation.js").ReconciliationInput)=>{
      await writeFile(path,original+"\nConcurrent owner edit.\n");
      return [{kind:"add" as const,ideaIds:[value.ideas[0]!.id],sourceIds:[value.sources[0]!.id],sourceQuote:value.sources[0]!.text,statement:null,targetId:null,factKey:null,correctionQuote:null,reason:null}];
    }});
    const result=await engine().store({content:"New atomic evidence.",source:"mcp"});
    expect(result.filing).toBe("pending"); expect(result.topics![0]!.reason).toBe("reconciliation_revision_changed");
    expect(await readFile(path,"utf8")).toBe(original+"\nConcurrent owner edit.\n");
  });

  it("files clear topics independently, preserves mangled names and exact spans, and composes duplicate paths once", async () => {
    const content = "Insurance renews in April.\n\nAxa telephone is unchanged.\n\nZnot or Zenod should handle the unnamed thing.";
    topicLlm(content);
    const e = engine();
    const originalAmbiguousPage = await readFile(join(repo.path, "Projects/Sample Project.md"), "utf8");
    const result = await e.store({ content, source: "mcp", verbatim: true });
    expect(result.filing).toBe("uncertain");
    expect(result.topics!.map((topic) => topic.status)).toEqual(["filed", "filed", "uncertain"]);
    expect(new URL(result.evidenceUrl!).hash).toMatch(/^#L\d+$/);
    expect(llm.composePage).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(llm.composePage).mock.calls.map(([input]) => input);
    expect(calls.find((input) => input.path === "Areas/Insurance.md")!.evidenceEntry).toBe(content.split("\n\n")[0]);
    expect(calls.find((input) => input.path === "Notes/Axa.md")!.evidenceEntry).toBe(content.split("\n\n")[1]);
    expect((await e.getEntry(result.evidenceRef)).content).toBe(content);
    for (const [index, topic] of result.topics!.entries()) {
      expect(topic.evidenceRef).toBe(result.evidenceRef);
      expect(topic.sourceSpans.map((span) => content.slice(span.start, span.end)).join("")).toBe(content.split("\n\n")[index]);
    }
    expect(await readFile(join(repo.path, "Projects/Sample Project.md"), "utf8")).toBe(originalAmbiguousPage);
    const record = result.pagesTouched.find((path) => path.startsWith("Inbox/"))!;
    expect(await readFile(join(repo.path, record), "utf8")).toContain("Znot or Zenod");
    expect((await e.lint()).errors).toEqual([]);
  });

  it("keeps long meaning history intact through repeated stores while sending only a bounded section", async () => {
    const path = join(repo.path, "Areas/Insurance.md");
    const original = parseNote(await readFile(path, "utf8"));
    const mortgage = `## Mortgage\n\n${"Separate mortgage policy retained. ".repeat(1000)} [[2026-06-10#^e-7f3a2c]]\n`;
    await writeFile(path, serializeNote(original.frontmatter!, original.body + "\n" + mortgage));
    await repo.commitAndPublish("seed synthetic long meaning page");
    llm.classify = vi.fn(async (value: ClassifyInput) => ({ confidence: 0.95, summary: "Travel", tags: [], pages: [], topics: [{
      topic: "Travel", summary: "Travel", confidence: 0.95, disposition: "integrate_page", evidenceQuotes: [value.content],
      pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" }],
    }] }));
    llm.composePage = vi.fn(async (value: ComposePageInput) => {
      expect(value.currentContent!.length).toBeLessThan(6500);
      expect(value.currentContent).not.toContain("Mortgage");
      const projected = parseNote(value.currentContent!);
      return serializeNote(projected.frontmatter!, projected.body + `\n- ${value.evidenceEntry} (${value.citation})\n`);
    });
    const e = engine();
    for (let n = 1; n <= 3; n++) {
      const content = `Travel insurance update number ${n}.`;
      const result = await e.store({ content, source: "mcp", verbatim: true });
      expect(result.filing).toBe("filed");
      expect((await e.getEntry(result.evidenceRef)).content).toBe(content);
      const changed = parseNote(await readFile(path, "utf8"));
      expect(changed.body).toContain(mortgage);
      expect(changed.body).toContain("policy ends March 2027");
      expect(String(changed.frontmatter!.summary).length).toBeLessThanOrEqual(480);
    }
    expect(llm.composePage).toHaveBeenCalledTimes(3);
  });

  it("keeps successful topic filing and immutable evidence when another composer fails", async () => {
    const content = "Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content, "Notes/Axa.md");
    const original = await readFile(join(repo.path, "Notes/Axa.md"), "utf8");
    const e = engine();
    const result = await e.store({ content, source: "mcp" });
    expect(result.filing).toBe("pending");
    expect(result.topics!.map((topic) => topic.status)).toEqual(["filed", "pending", "uncertain"]);
    expect(result.pagesTouched).toContain("Areas/Insurance.md");
    expect(result.pagesTouched).not.toContain("Notes/Axa.md");
    expect(await readFile(join(repo.path, "Notes/Axa.md"), "utf8")).toBe(original);
    expect((await e.getEntry(result.evidenceRef)).content).toBe(content);
    expect((await e.searchEntries({ source: "mcp", limit: 100 })).filter((entry) => entry.content === content)).toHaveLength(1);
  });

  it("enriches captured evidence using the same topic assignments without changing its identity", async () => {
    const content = "Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content);
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "whatsapp", sourceId: "topic-capture" });
    const before = await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8");
    const result = await e.enrichEvidence!({ content, source: "whatsapp", evidenceRef: captured.evidenceRef });
    expect(result.evidenceRef).toBe(captured.evidenceRef);
    expect(result.topics!.map((topic) => topic.status)).toEqual(["filed", "filed", "uncertain"]);
    expect(await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8")).toBe(before);
  });

  it("classifies semantic transcript without media wrapper and addresses repeated occurrences independently", async () => {
    // Synthetic, hand-reviewed ideas: educational video, network effects, uncertain name.
    // The repeated sentence supports two distinct ideas, not a deduplication key.
    const transcript = "PatronBTC explica Bitcoin.\r\nLa red crece. La red crece.\r\nQuizás Znot. 👩🏽‍💻 café";
    const prefix = 'Voice note "demo.ogg" ingested through Zenod media seam.\nRaw artifact: drive://synthetic\n\n';
    const content = prefix + transcript;
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      expect(input.content).toBe(transcript);
      const passages = (input as ClassifyInput & { sourcePassages?: Array<{ id: string; text: string }> }).sourcePassages;
      expect(passages?.length).toBeGreaterThan(0);
      const passage = passages!.find((part) => part.text.includes("La red crece. La red crece."))!;
      return { confidence: 0.9, summary: "three ideas", tags: [], pages: [], topics: [
        ...["Network adoption", "Network feedback"].map((topic, occurrence) => ({
          topic, summary: topic, confidence: 0.9, disposition: "evidence_only" as const, pages: [], evidenceQuotes: [],
          evidenceAssignments: [{ passageId: passage.id, quote: "La red crece.", occurrence }],
        })),
        { topic: "Educational video", summary: "video", confidence: 0.9, disposition: "evidence_only" as const, pages: [], evidenceQuotes: ["PatronBTC explica Bitcoin."] },
        { topic: "Uncertain name", summary: "Znot", confidence: 0.1, disposition: "needs_clarification" as const, pages: [], evidenceQuotes: ["Quizás Znot."] },
      ] };
    });
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "whatsapp", sourceId: "synthetic-multi-idea" });
    const before = await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8");
    const result = await e.enrichEvidence!({ content, source: "whatsapp", evidenceRef: captured.evidenceRef,
      ...{ semanticRange: { start: prefix.length, end: content.length } } });
    expect(result.topics?.slice(0, 4).map((topic) => [topic.topic, topic.status])).toEqual([
      ["Network adoption", "filed"], ["Network feedback", "filed"], ["Educational video", "filed"], ["Uncertain name", "uncertain"],
    ]);
    const spans = result.topics!.slice(0, 2).flatMap((topic) => topic.sourceSpans);
    expect(spans.map((span) => content.slice(span.start, span.end))).toEqual(["La red crece.", "La red crece."]);
    expect(spans[0]!.start).not.toBe(spans[1]!.start);
    expect(result.topics!.flatMap((topic) => topic.sourceSpans).every((span) => span.start >= prefix.length)).toBe(true);
    expect(await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8")).toBe(before);
  });

  it("keeps beginning and tail ideas when middle classification fails and source identity is retried", async () => {
    // Ground truth is three independent ideas; the middle one must remain pending.
    const beginning = "El vídeo explica efectos de red.";
    const tail = "Final decision: release the English captions on Friday.";
    const content = beginning + " a".repeat(6500) + " MIDDLE_OUTAGE: discutir presupuesto." + " b".repeat(6500) + tail;
    let outage = true;
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      if (input.content.includes("MIDDLE_OUTAGE") && outage) throw new Error("synthetic middle outage");
      const quote = input.content.includes("MIDDLE_OUTAGE") ? "discutir presupuesto." : input.content.includes(beginning) ? beginning : tail;
      const passage = input.sourcePassages!.find(p => p.text.includes(quote))!;
      return { confidence: 0.9, summary: "known idea", tags: [], pages: [], topics: [{
        ...(input.retryDecisions?{retryId:input.retryDecisions[0]!.id}:{}),
        topic: quote === beginning ? "Network education" : quote === tail ? "English caption release" : "Budget", summary: "known idea", confidence: 0.9,
        disposition: "evidence_only" as const, pages: [], evidenceQuotes: [],
        evidenceAssignments: [{ passageId: passage.id, quote, occurrence: 0 }],
      }] };
    });
    const e = engine();
    const input = { content, source: "whatsapp" as const, sourceId: "synthetic-partial-voice-note", verbatim: true };
    const captured = await e.captureEvidence!(input);
    expect((await e.captureEvidence!(input)).evidenceRef).toBe(captured.evidenceRef);
    const before = await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8");
    const result = await e.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
    expect(result.topics?.filter(t => t.status === "filed").map(t => t.topic)).toEqual(["Network education", "English caption release"]);
    expect(result.topics?.filter(t => t.reason === "classification_unavailable")).toHaveLength(1);
    expect(result.topics?.filter(t => t.status === "filed").flatMap(t => t.sourceSpans).map(s => content.slice(s.start, s.end))).toEqual([beginning, tail]);
    expect(llm.classify).toHaveBeenCalledTimes(4); // Three bounded windows, one middle retry.
    expect(llm.composeCalls).toBe(0);
    outage = false;
    const resumed = await e.enrichEvidence!({ ...input, evidenceRef: captured.evidenceRef });
    expect(llm.classify).toHaveBeenCalledTimes(5); // Only the failed middle window is revisited.
    expect(resumed.topics!.some(topic => topic.reason === "classification_unavailable")).toBe(false);
    expect(resumed.topics!.filter(topic => topic.status === "filed").map(topic => topic.topic)).toEqual(["Network education", "English caption release", "Budget"]);
    for (const previous of result.topics!.filter(topic => topic.status === "filed")) expect(resumed.topics!.find(topic => topic.ideaId === previous.ideaId)).toEqual(previous);
    expect(await readFile(join(repo.path, captured.evidenceRef.split("#")[0]!), "utf8")).toBe(before);
  });

  it.each([true, false])("separates minimal support from passage review coverage (addressed review: %s)", async (reviewed) => {
    const content = "Bueno, pensando en lo que hablamos, la decisión es: publish captions on Friday. Eso era todo, gracias.";
    const quote = "publish captions on Friday";
    llm.classify = vi.fn(async (input: ClassifyInput) => ({
      confidence: 0.9, summary: "Caption schedule", tags: [], pages: [],
      ...(reviewed ? { passageReviews: [{ passageId: input.sourcePassages![0]!.id, status: "assigned" as const }] } : {}),
      topics: [{ topic: "Caption schedule", summary: "Caption schedule", confidence: 0.9, disposition: "evidence_only" as const,
        pages: [], evidenceQuotes: [], evidenceAssignments: [{ passageId: input.sourcePassages![0]!.id, quote, occurrence: 0 }] }],
    }));
    const result = await engine().store({ content, source: "whatsapp", verbatim: true });
    expect(result.topics![0]!.sourceSpans.map(span => content.slice(span.start, span.end))).toEqual([quote]);
    expect(result.topics?.some(topic => topic.reason === "source_not_assigned")).toBe(!reviewed);
    expect(result.filing).toBe(reviewed ? "filed" : "uncertain");
    expect(result.pagesTouched.some(path => path.startsWith("Inbox/"))).toBe(!reviewed);
  });

  it("passes complete recipient and qualified reported propositions to reconciliation while unknown routing stays uncertain", async () => {
    const delivery = "For Insurance, each visitor should receive a reusable waterproof guide.";
    const report = "A collaborator reports Friday for Insurance. It is unconfirmed and does not change our agreed Thursday.";
    const content = delivery + "\n\n" + report + "\n\nMarta changed it, but the project and change are unknown.";
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      const passage = input.sourcePassages![0]!;
      return { confidence: 0.95, summary: "three independent ideas", tags: [], pages: [],
        passageReviews: [{ passageId: passage.id, status: "assigned" as const }],
        topics: [
          ...[["Visitor delivery", delivery], ["Unconfirmed report", report]].map(([topic, quote]) => ({
            topic: topic!, summary: topic!, confidence: 0.95, disposition: "append_compact_note" as const,
            pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" as const }], evidenceQuotes: [],
            evidenceAssignments: [{ passageId: passage.id, quote: quote!, occurrence: 0 }],
          })),
          { topic: "Unknown destination", summary: "unknown change", confidence: 0.2, disposition: "needs_clarification" as const,
            pages: [], evidenceQuotes: [], evidenceAssignments: [{ passageId: passage.id, quote: "Marta changed it", occurrence: 0 }] },
        ] };
    });
    const reconcile = vi.fn(async (request: import("../src/engine/reconciliation.js").ReconciliationInput) => {
      const support = request.sources.map(source => source.text).join("\n");
      expect(support).toContain(delivery);
      expect(support).toContain(report);
      expect(support).not.toContain("Marta");
      expect(request.ideas).toHaveLength(2);
      expect(new Set(request.ideas.map(idea => idea.id)).size).toBe(2);
      return request.ideas.map(idea => ({ kind: "add" as const, ideaIds: [idea.id], sourceIds: idea.sourceIds,
        sourceQuote: request.sources.find(source => source.id === idea.sourceIds[0])!.text,
        statement: null, targetId: null, factKey: null, correctionQuote: null, reason: null }));
    });
    Object.assign(llm, { reconcile });
    const result = await engine().store({ content, source: "whatsapp", verbatim: true });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result.topics!.map(topic => topic.status)).toEqual(["filed", "filed", "uncertain"]);
    const page = await readFile(join(repo.path, "Areas/Insurance.md"), "utf8");
    expect(page).toContain(delivery);
    expect(page).toContain(report);
  });

  it.each([false, true])("omits valid neighbor-only duplicates while malformed neighbor assignments remain visible (%s)", async malformed => {
    const content = Array.from({ length: 420 }, (_, i) => `Background sentence number ${i} is recorded.\n\n`).join("");
    const windows = sourceWindows({ content });
    const owner = windows[0]!.passages.filter(p => p.end <= windows[0]!.range.end).at(-1)!;
    const quote = owner.text.trim();
    llm.classify = vi.fn(async (input: ClassifyInput) => ({ confidence: 0.95, summary: "source review", tags: [], pages: [],
      passageReviews: input.sourcePassages!.filter(p => p.start >= input.sourceRange!.start && p.end <= input.sourceRange!.end)
        .map(p => ({ passageId: p.id, status: "evidence_only" as const })),
      topics: input.sourcePassages!.some(p => p.id === owner.id) ? [{ topic: "Independent owned idea", summary: "source check",
        confidence: 0.95, disposition: "evidence_only" as const, pages: [], evidenceQuotes: [],
        evidenceAssignments: [{ passageId: owner.id, quote, occurrence: 0 },
          ...(malformed && input.sourceRange!.start > owner.start ? [{ passageId: "wrong-id", quote, occurrence: 0 }] : [])] }] : [],
    }));
    const result = await engine().store({ content, source: "whatsapp", verbatim: true });
    expect(result.topics!.filter(topic => topic.status === "filed")).toHaveLength(1);
    expect(result.topics!.filter(topic => topic.reason?.includes("classification_source_address_invalid") && topic.status === "pending")).toHaveLength(malformed ? 1 : 0);
    expect(result.topics!.some(topic => topic.reason === "source_not_assigned")).toBe(false);
  });

  it.each([false, true])("retries assigned reviews backed by empty quote arrays without inventing topics (%s)", async exhausted => {
    const content = "Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content);
    const original = llm.classify.bind(llm);
    const inputs: ClassifyInput[] = [];
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      inputs.push(input);
      const result = await original(input);
      if (exhausted || inputs.length === 1) result.topics = [{ ...result.topics![0]!, evidenceQuotes: [], evidenceAssignments: [] }];
      if(input.retryDecisions) result.topics=result.topics!.map((topic,index)=>({...topic,retryId:input.retryDecisions!.find(d=>index===0?d.scope==="decision":d.scope==="source_window")!.id}));
      return { ...result, passageReviews: input.sourcePassages!.map(passage => ({ passageId: passage.id, status: "assigned" as const })) };
    });
    const result = await engine().store({ content, source: "selftest", verbatim: true });
    expect(inputs).toHaveLength(2);
    // Empty explicit addresses are rejected before the broader passage coverage check.
    expect(inputs[1]!.hints.join(" ")).toContain("each evidence assignment must use a supplied passage ID");
    expect(result.topics!.some(topic => topic.reason === "source_not_assigned")).toBe(exhausted);
    expect(result.pagesTouched.includes("Areas/Insurance.md")).toBe(!exhausted);
  });

  it.each([false, true])("retries false assigned coverage from a neighbor-only result and leaves exhausted owned source unassigned (%s)", async exhausted => {
    const content = Array.from({ length: 420 }, (_, i) => `Background sentence number ${i} is recorded.\n\n`).join("").trimEnd();
    const windows = sourceWindows({ content });
    expect(windows).toHaveLength(2);
    const neighbor = windows[0]!.passages.filter(p => p.end <= windows[0]!.range.end).at(-1)!;
    const inputs: ClassifyInput[] = [];
    let tailCalls = 0;
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      inputs.push(input);
      const owned = input.sourcePassages!.filter(p => p.start >= input.sourceRange!.start && p.end <= input.sourceRange!.end);
      const tail = input.sourceRange!.start > 0;
      if (tail) tailCalls++;
      const repaired = tail && !exhausted && tailCalls > 1;
      const makeTopic = (passage: typeof neighbor, name: string) => ({ topic: name, summary: name, confidence: 0.95,
        disposition: "evidence_only" as const, pages: [], evidenceQuotes: [],
        evidenceAssignments: [{ passageId: passage.id, quote: passage.text.trim(), occurrence: 0 }] });
      return { confidence: 0.95, summary: "source review", tags: [], pages: [],
        passageReviews: owned.map(p => ({ passageId: p.id,
          status: tail && !repaired ? "assigned" as const : "evidence_only" as const })),
        topics: input.retryDecisions
          ? (repaired ? [{...makeTopic(owned[0]!, "Tail owned idea"),retryId:input.retryDecisions.find(d=>d.topic.retrySourceRange?.start===owned[0]!.start)!.id}] : [])
          : [makeTopic(neighbor, "First owned idea")],
      };
    });
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "selftest", verbatim: true });
    const result = await e.enrichEvidence!({ content, evidenceRef: captured.evidenceRef, source: "selftest", verbatim: true });
    expect(inputs).toHaveLength(3);
    expect(tailCalls).toBe(2);
    expect(inputs[1]!.hints.join(" ")).not.toContain("every owned passage marked assigned");
    expect(inputs[2]!.hints.join(" ")).toContain("every owned passage marked assigned");
    expect(result.topics!.filter(topic => topic.topic === "First owned idea" && topic.status === "filed")).toHaveLength(1);
    expect(result.topics!.some(topic => topic.topic === "Tail owned idea")).toBe(!exhausted);
    expect(result.topics!.some(topic => topic.reason === "source_not_assigned")).toBe(exhausted);
    expect(llm.composeCalls).toBe(0);
    expect((await e.getEntry(captured.evidenceRef)).content).toBe(content);
  });

  it("records invalid and omitted source assignments without handing invented text to the composer", async () => {
    llm.classify = vi.fn(async () => ({ confidence: 0.99, summary: "bad quote", tags: [], pages: [], topics: [
      { topic: "invented", summary: "invented", confidence: 0.99, disposition: "integrate_page", evidenceQuotes: ["not in the capture"],
        pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" }] },
    ] }));
    const result = await engine().store({ content: "Actual source spelling is Znot.", source: "mcp" });
    expect(llm.composeCalls).toBe(0);
    expect(result.topics![0]!.status).toBe("pending");
    expect(result.topics![0]!.reason).toContain("classification_source_address_invalid");
    expect(result.topics![1]!.reason).toBe("source_not_assigned");
  });

  it("joins a topic across exact segment boundaries and provides neighboring context without unrelated evidence", async () => {
    const content = `Insurance context ${"A".repeat(LONG_MEMORY_SEGMENT_CHARS - 100)}. Continuation refers to that policy. ${"B".repeat(150)}.`;
    llm.classify = vi.fn(async (input: ClassifyInput) => ({ confidence: 0.95, summary: "Insurance", tags: [], pages: [], topics: [
      { topic: "Insurance", summary: "Insurance", confidence: 0.95, disposition: "integrate_page", evidenceQuotes: [input.content],
        pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" }] },
    ] }));
    llm.composePage = vi.fn(async (input: ComposePageInput) => `${input.currentContent}\n\n${input.citation}\n`);
    const result = await engine().store({ content, source: "mcp" });
    expect(result.filing).toBe("filed");
    expect(llm.composePage).toHaveBeenCalledTimes(1);
    const classificationInputs = vi.mocked(llm.classify).mock.calls.map(([input]) => input);
    expect(classificationInputs.length).toBeGreaterThan(1);
    expect(classificationInputs[1]!.context).toContain("Continuation");
    expect(result.topics!.flatMap((topic) => topic.sourceSpans).map((span) => content.slice(span.start, span.end)).join("")).toBe(content);
  });

  it("persists evidence-only completion once and replays without classifier or composer calls", async () => {
    const content = "Microphone check.";
    const e = engine();
    const captured = await e.captureEvidence!({ content, source: "whatsapp" });
    llm.classify = vi.fn(async () => ({ confidence: 0.9, summary: "check", tags: [], pages: [], topics: [
      { topic: "check", summary: "check", confidence: 0.9, disposition: "evidence_only", evidenceQuotes: [content], pages: [] },
    ] }));
    const result = await e.enrichEvidence!({ content, source: "whatsapp", evidenceRef: captured.evidenceRef });
    expect(result.filing).toBe("filed");
    expect(result.commitSha).not.toBe(captured.commitSha);
    expect(result.topics![0]!.status).toBe("filed");
    expect(llm.composeCalls).toBe(0);
    const replay = await e.enrichEvidence!({ content, source: "whatsapp", evidenceRef: captured.evidenceRef });
    expect(replay.commitSha).toBe(result.commitSha);
    expect(llm.classify).toHaveBeenCalledTimes(1);
  });

  it("preserves classified topics when a later segment classifier is unavailable", async () => {
    const content = `${"Insurance ".repeat(1300)}FAILED classification segment.`;
    llm.classify = vi.fn(async (input: ClassifyInput) => {
      if (input.content.includes("FAILED")) throw new Error("synthetic classifier outage");
      return { confidence: 0.9, summary: "Insurance", tags: [], pages: [{ path: "Areas/Insurance.md", title: "Insurance", action: "update" }] };
    });
    const result = await engine().store({ content, source: "mcp" });
    expect(result.filing).toBe("pending");
    expect(result.topics!.map((topic) => topic.status)).toEqual(["filed", "pending", "uncertain"]);
    expect(result.topics![1]!.reason).toBe("classification_unavailable");
    // An unclassified-window placeholder is not proof that the source was reviewed.
    expect(result.topics![2]!.reason).toBe("source_not_assigned");
    expect(result.topics![2]!.sourceSpans).toEqual(result.topics![1]!.sourceSpans);
    expect(result.topics![2]!.sourceSpans.map(span=>content.slice(span.start,span.end)).join("")).toContain("FAILED classification segment.");
    expect(result.pagesTouched).toContain("Areas/Insurance.md");
    expect(llm.composeCalls).toBe(1);
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

  it("returns an explicit retry response promptly when a writer holds the vault lock", async () => {
    const e=engine();let release!:()=>void;let locked!:()=>void;
    const ready=new Promise<void>(r=>{locked=r;});const hold=new Promise<void>(r=>{release=r;});
    // Separate async chain: the read must not inherit the writer's ownership.
    const writer=withVaultWriteLock(repo.path,async()=>{locked();await hold;});await ready;
    llm.answerOverride=async (_input,tools)=>{
      await expect(tools.readNote!("Areas/Insurance.md")).rejects.toThrow("filing_in_progress");
      return {text:"Invented answer must not escape the busy guard",readPaths:[]};
    };
    try {
      const answer=await Promise.race([e.ask("What does my insurance note say?"),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("read blocked behind filing")),2000))]);
      expect(answer.text).toBe("Memory filing is in progress. Please retry your question shortly.");expect(answer.sources).toEqual([]);
    } finally {release();await writer;}
  });

  it.each(["classify: structured_output_invalid", "classify: provider_error"])("keeps the existing window/retry budget and compacts only malformed output (%s)", async error => {
    const content="Insurance update.\n\nAxa update.\n\nZnot uncertain.";
    topicLlm(content); const original=llm.classify.bind(llm); const inputs:ClassifyInput[]=[];
    llm.classify=vi.fn(async input=>{inputs.push(input);if(inputs.length===1)throw new Error(error);return original(input);});
    const e=engine();const capture=await e.captureEvidence!({content,source:"selftest"});
    const result=await e.enrichEvidence!({content,source:"selftest",evidenceRef:capture.evidenceRef});
    expect(inputs).toHaveLength(2);expect(inputs[1]!.content).toBe(inputs[0]!.content);
    expect(inputs[1]!.sourcePassages).toEqual(inputs[0]!.sourcePassages);
    expect(inputs[1]!.sourceRange).toEqual(inputs[0]!.sourceRange);
    expect(inputs[0]!.hints.join(" ")).not.toContain("compact valid JSON");
    expect(inputs[1]!.hints.join(" ").includes("compact valid JSON")).toBe(error.endsWith("structured_output_invalid"));
    expect(result.topics!.find(t=>t.topic==="Insurance")!.status).toBe("filed");
    expect((await e.getEntry(capture.evidenceRef)).content).toBe(content);
  });

  it("files a valid first result when optional catalog refinement fails without restarting classification", async () => {
    const note = parseNote(await readFile(join(repo.path, "Areas/Insurance.md"), "utf8"));
    for (let n = 0; n < 26; n++) await writeFile(join(repo.path, `Notes/Extra${n}.md`), serializeNote({ ...note.frontmatter, title: `Extra${n}`, type: "note" }, "Other topic."));
    await repo.commitAndPublish("test: seed wider candidate catalog");
    llm.classify = vi.fn().mockResolvedValueOnce({ confidence: 0.95, summary: "Insurance preference", tags: ["insurance"], disposition: "append_compact_note",
      pages: [{ path: "Notes/insurance.md", title: "Insurance", action: "create" }] }).mockRejectedValue(new Error("classify: structured_output_invalid"));
    const content = "Travel insurance renews in April.";
    const result = await engine().store({ content, source: "mcp" });
    expect(llm.classify).toHaveBeenCalledTimes(2);
    expect(result.filing).toBe("filed");
    expect(result.pagesTouched).toEqual(["Areas/Insurance.md"]);
    expect(await readFile(join(repo.path, "Areas/Insurance.md"), "utf8")).toContain(result.evidenceRef.split("#^")[1]!);
    expect(await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8")).toContain(content);
    expect(result.pagesTouched.some(path => path.startsWith("Inbox/"))).toBe(false);
  });

  it("retries an unparsable classification, then saves the raw capture to Inbox", async () => {
    llm.failClassifyAttempts = 99;
    llm.classifyFailureMessage = "MCP bearer secret-internal-token; Ring schema dump: {prompt: hostile}";
    const content = "Remember the image text exactly: FyLax launch label.";
    const result = await engine().store({ content, source: "whatsapp", contentType: "image", verbatim: true });

    expect(llm.classifyCalls).toBe(2);
    expect(result.filing).toBe("inbox");
    const log = await readFile(join(repo.path, result.evidenceRef.split("#")[0]!), "utf8");
    const inbox = await readFile(join(repo.path, result.pagesTouched[0]!), "utf8");
    expect(log).toContain(content);
    expect(inbox).toContain(content);
    expect(inbox).toContain("Saved, but automatic filing is pending");
    expect(inbox).toContain("classification_unavailable");
    expect(inbox).not.toContain("secret-internal-token");
    expect(inbox).not.toContain("Ring schema dump");
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
      provider: "github",
      url: expect.stringContaining("Log/2026-07-29.md"),
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

  it("honors exact pinned anchors and bounded options without leaking other pinned or neighboring entries", async () => {
    const logPath = "Log/2026-07-29.md";
    const firstRef = `${logPath}#^e-a1b2c3`;
    const lastRef = `${logPath}#^e-abcdef`;
    await writeFile(join(repo.path, logPath), [
      "# Log", "", "## 10:00 First capture ^e-a1b2c3", "",
      `> ${"padding ".repeat(300)} The first code is Quartz-417.`, "",
      "## 10:05 Unpinned neighbor ^e-d4e5f6", "", "> Unpinned code Onyx-999.", "",
      "## 10:10 Last pinned capture ^e-abcdef", "", "> Last code Cobalt-318.", "",
    ].join("\n"));
    llm.answerOverride = async (_input, tools) => {
      const legacy = await tools.readNote!(logPath);
      expect(legacy).toContain("Quartz-417"); expect(legacy).toContain("Cobalt-318");
      expect(legacy).not.toContain("Onyx-999");
      await expect(tools.readNote!(`${logPath}#^e-ffffff`)).rejects.toThrow("not found");
      const query = JSON.parse(await tools.readNote!(firstRef, { query: "Quartz-417", maxChars: 256 }));
      expect(query.body).toContain("Quartz-417"); expect(query.body.length).toBeLessThanOrEqual(256);
      expect(query.body).not.toContain("Cobalt-318");
      for (const readPath of [firstRef, logPath]) {
        let cursor: string | undefined; let body = ""; let rounds = 0;
        do {
          const page = JSON.parse(await tools.readNote!(readPath, { maxChars: 256, cursor }));
          expect(page.body.length).toBeLessThanOrEqual(256);
          expect(page.body).not.toContain("Onyx-999");
          if (readPath === firstRef) expect(page.body).not.toContain("Cobalt-318");
          body += page.body; cursor = page.nextCursor ?? undefined;
          expect(++rounds).toBeLessThan(20);
        } while (cursor);
        expect(body).toContain("Quartz-417");
        if (readPath === logPath) expect(body).toContain("Cobalt-318");
      }
      return { text: "Quartz-417 and Cobalt-318.", readPaths: [] };
    };
    const answer = await engine().ask("Compare these pinned captures.", { contextRefs: [firstRef, lastRef] });
    expect(answer.text).toContain("Quartz-417"); expect(answer.text).toContain("Cobalt-318");
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
        "> ZNMT-I1-20260711-A-L2 says Aurora Kestrel has the following code:",
        `> ${"neutral padding ".repeat(200)}`,
        "> Amber-902.",
        "",
        "## 01:20 Later distractor ^e-c0ba17",
        "- source: mcp",
        "",
        "> An unrelated L3 fixture mentions Cobalt-471.",
        "",
      ].join("\n"),
    );
    llm.answerOverride = async (_input, tools) => {
      let cursor: string | undefined; let read = ""; let rounds = 0;
      do {
        const page = JSON.parse(await tools.readNote!(logPath, { cursor, maxChars: 512 }));
        read += page.body; cursor = page.nextCursor ?? undefined;
        expect(++rounds).toBeLessThan(20);
      } while (cursor);
      expect(read).toContain("Amber-902"); expect(read).toContain("Cobalt-471");
      return {
        text: [
          "Aurora Kestrel uses Amber-902. [[2026-07-11#^e-06dada]]",
          "It also uses Cobalt-471. [[2026-07-11#^e-c0ba17]]",
        ].join("\n"),
        readPaths: [logPath],
      };
    };

    const answer = await engine().ask("For ZNMT-I1-20260711-A-L2, what code belongs to Aurora Kestrel?");

    expect(answer.text).toContain("Amber-902");
    expect(answer.text).toContain("^e-06dada");
    expect(answer.text).not.toContain("Cobalt-471");
    expect(answer.text).not.toContain("^e-c0ba17");
    expect(answer.text).not.toContain("It also uses");
    expect(answer.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `${logPath}#^e-06dada`, githubUrl: expect.stringContaining(logPath) }),
    ]));
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
      await tools.readNote!(logPath, { query: "Aurora Kestrel" });
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
    const legacyGithubUrl = "https://github.com/external/source/blob/main/Log/source.md#legacy-anchor";
    const result = await engine().digestBacklog({
      rawText: "Remember to renew travel insurance.",
      sourceRefs: [{ path: "Log/2026-06-13.md#^e-test02", githubUrl: legacyGithubUrl }],
      write: true,
    });

    expect(result.written).toHaveLength(1);
    expect(result.written[0]?.path).toMatch(/^Backlog\/.*renew-travel-insurance\.md$/);
    const currentRevision = await repo.currentRevision();
    expect(result.revision).toMatchObject({
      provider: "github",
      id: result.commitSha,
      commitSha: result.commitSha,
      urls: result.urls,
      githubUrls: result.githubUrls,
    });
    expect(result.revision?.committedAt).toEqual(expect.any(String));
    expect(result.revision?.id).toBe(currentRevision.id);
    expect(result.revision?.committedAt).toBe(currentRevision.committedAt);
    expect(result.written[0]?.revisionId).toBe(result.revision?.id);
    expect(result.written[0]?.url).toContain(`/blob/${result.revision?.id}/`);
    expect(result.source_refs[0]?.revisionId).toBe(result.revision?.id);
    expect(result.source_refs[0]?.url).toContain(`/blob/${result.revision?.id}/`);
    expect(result.source_refs[0]?.githubUrl).toBe(legacyGithubUrl);
    expect(result.candidates[0]?.source_refs[0]).toEqual(result.source_refs[0]);
    expect(result.candidates[0]?.source_refs[0]?.githubUrl).toBe(legacyGithubUrl);
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
    expect(result.revision).toMatchObject({ provider: "github", id: result.commitSha, commitSha: result.commitSha });
    expect(result.urls?.length).toBeGreaterThan(0);
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

  it("queued and vaultless capture placeholders omit durable and Git-only provenance", async () => {
    const placeholders: unknown[] = [];
    llm.answerOverride = async (_input, _tools, taskTools) => {
      placeholders.push(await taskTools!.captureNote("queued placeholder"));
      return { text: "queued", readPaths: [] };
    };
    const filed = new Promise<void>((resolve) => {
      void createEngine({ repo, llm, state, location: { repo: "zenod-ai/fixture" }, onFilingComplete: () => resolve() })
        .handleTasking({ text: "queue it", surface: "web", conversationKey: "placeholder-queued" });
    });
    await vi.waitFor(() => expect(placeholders).toHaveLength(1));
    expect(placeholders[0]).toMatchObject({ evidenceRef: "(queued)", queued: true, filing: "pending" });
    expect(placeholders[0]).not.toHaveProperty("revision");
    expect(placeholders[0]).not.toHaveProperty("commitSha");
    expect(placeholders[0]).not.toHaveProperty("githubUrls");
    await filed;

    llm.answerOverride = async () => {
      return { text: "unavailable", readPaths: [] };
    };
    const vaultless = await createEngine({ llm, state }).handleTasking({ text: "save it", surface: "web", conversationKey: "placeholder-vaultless" });
    expect(vaultless.actions).toEqual([]);
    expect(JSON.stringify(vaultless)).not.toMatch(/commitSha|githubUrls|revision/);
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
