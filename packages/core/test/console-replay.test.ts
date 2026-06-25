import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine.js";
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
  WorkLoopInput,
  WorkLoopResult,
} from "../src/llm/types.js";
import { SqliteStateStore } from "../src/state/sqlite.js";

interface ReplayAction {
  tool: string;
  input?: Record<string, unknown>;
  result: string;
}

interface ReplayCase {
  prompt: string;
  modelText: string;
  actions: ReplayAction[];
}

class ReplayLlm implements BrainLlm {
  constructor(private readonly cases: Map<string, ReplayCase>) {}

  async classify(_input: ClassifyInput): Promise<Classification> {
    throw new Error("not used by Console replay tests");
  }

  async composePage(_input: ComposePageInput): Promise<string> {
    throw new Error("not used by Console replay tests");
  }

  async describeImage(): Promise<string> {
    throw new Error("not used by Console replay tests");
  }

  async answer(input: AnswerInput, _tools: VaultReadTools): Promise<AnswerResult> {
    const replay = this.cases.get(input.question);
    if (!replay) throw new Error(`Missing replay case for ${input.question}`);
    for (const action of replay.actions) input.onPeerAction?.(action.tool, action.input ?? {}, action.result);
    return { text: replay.modelText, readPaths: [] };
  }

  async work(_input: WorkLoopInput): Promise<WorkLoopResult> {
    throw new Error("not used by Console replay tests");
  }

  async extractBacklog(_input: BacklogExtractInput): Promise<BacklogExtractResult> {
    throw new Error("not used by Console replay tests");
  }
}

function replayEngine(cases: ReplayCase[], peerTools?: PeerTools) {
  return createEngine({
    llm: new ReplayLlm(new Map(cases.map((c) => [c.prompt, c]))),
    state: new SqliteStateStore(":memory:"),
    ...(peerTools ? { peerTools } : {}),
  });
}

class RecordingLlm implements BrainLlm {
  readonly questions: string[] = [];

  constructor(
    private readonly response: string,
    private readonly actions: ReplayAction[] = [],
  ) {}

  async classify(_input: ClassifyInput): Promise<Classification> {
    throw new Error("not used by Console digest tests");
  }

  async composePage(_input: ComposePageInput): Promise<string> {
    throw new Error("not used by Console digest tests");
  }

  async describeImage(): Promise<string> {
    throw new Error("not used by Console digest tests");
  }

  async answer(input: AnswerInput, _tools: VaultReadTools): Promise<AnswerResult> {
    this.questions.push(input.question);
    for (const action of this.actions) input.onPeerAction?.(action.tool, action.input ?? {}, action.result);
    return { text: this.response, readPaths: [] };
  }

  async work(_input: WorkLoopInput): Promise<WorkLoopResult> {
    throw new Error("not used by Console digest tests");
  }

  async extractBacklog(_input: BacklogExtractInput): Promise<BacklogExtractResult> {
    throw new Error("not used by Console digest tests");
  }
}

function longVoiceLikeReflection(): string {
  return [
    "I want to think through the Idealista data product strategy.",
    "One option is to sell real estate opportunities directly, but that feels too exposed.",
    "Another option is a defensive Airbnb or Telegram product where the data gives people daily opportunities.",
    "I am not necessarily asking you to create tickets yet; I want to understand the shape and maybe decide later.",
    "There is also a wacky public infrastructure idea about decentralized listings, but it is more of a future thought.",
  ].join(" ").repeat(8);
}

describe("Console behavior replay harness", () => {
  const cases: ReplayCase[] = [
    {
      prompt: "what is the status of #108?",
      actions: [
        {
          tool: "archus_read_exact_github_issue",
          input: { target: "AlfaBlok/obsidian-brain#108" },
          result:
            "AlfaBlok/obsidian-brain#108 - Zenod teaser tweet - state: open - https://github.com/AlfaBlok/obsidian-brain/issues/108",
        },
      ],
      modelText:
        "AlfaBlok/obsidian-brain#108 is open: [#108](https://github.com/AlfaBlok/obsidian-brain/issues/108).",
    },
    {
      prompt: "what is the status of #999?",
      actions: [
        {
          tool: "archus_read_exact_github_issue",
          input: { target: "AlfaBlok/obsidian-brain#999" },
          result: "Issue not found in searched scope: repo AlfaBlok/obsidian-brain, target #999.",
        },
      ],
      modelText: "I could not find #999 in AlfaBlok/obsidian-brain.",
    },
    {
      prompt: "what is issue 108?",
      actions: [
        {
          tool: "archus_search_github_issues",
          input: { reference: "issue 108" },
          result:
            "Resolved unique issue: AlfaBlok/obsidian-brain#108 - Zenod teaser tweet - https://github.com/AlfaBlok/obsidian-brain/issues/108",
        },
        {
          tool: "archus_read_exact_github_issue",
          input: { target: "AlfaBlok/obsidian-brain#108" },
          result:
            "AlfaBlok/obsidian-brain#108 - Zenod teaser tweet - state: open - https://github.com/AlfaBlok/obsidian-brain/issues/108",
        },
      ],
      modelText: "Issue 108 resolves to [#108](https://github.com/AlfaBlok/obsidian-brain/issues/108), currently open.",
    },
    {
      prompt: "search for issues about the backlog system plan",
      actions: [
        {
          tool: "archus_search_github_issues",
          input: { reference: "backlog system plan" },
          result:
            "Candidates:\n#108 Produce Backlog System Plan — https://github.com/AlfaBlok/obsidian-brain/issues/108\n#109 Produce Backlog System Plan — https://github.com/AlfaBlok/obsidian-brain/issues/109\nChoose one before mutating anything.",
        },
      ],
      modelText:
        "I found two candidates: [#108](https://github.com/AlfaBlok/obsidian-brain/issues/108) and [#109](https://github.com/AlfaBlok/obsidian-brain/issues/109). Which one should I use?",
    },
    {
      prompt: "did #107 run?",
      actions: [
        {
          tool: "epaminon_read_issue_execution_status",
          input: { input: "AlfaBlok/obsidian-brain#107" },
          result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
        },
      ],
      modelText: "No execution ticket exists for AlfaBlok/obsidian-brain#107.",
    },
    {
      prompt: "what is #108 execution status?",
      actions: [
        {
          tool: "epaminon_read_issue_execution_status",
          input: { input: "AlfaBlok/obsidian-brain#108" },
          result:
            "#109 — AlfaBlok/obsidian-brain#108 — needs-review — evidence: https://github.com/AlfaBlok/obsidian-brain/pull/110",
        },
      ],
      modelText:
        "Execution [#109](https://github.com/AlfaBlok/obsidian-brain/issues/109) for AlfaBlok/obsidian-brain#108 is needs-review, with PR #110 as evidence.",
    },
    {
      prompt: "run zenod-ai/fixture#103",
      actions: [
        {
          tool: "queueExecution",
          input: { target: "zenod-ai/fixture#103" },
          result:
            "Minted execution ticket owner/central#104 (exec:queued) for zenod-ai/fixture#103 and dispatched to Epaminon: https://github.com/owner/central/issues/104",
        },
      ],
      modelText: "Queued execution ticket #104 for zenod-ai/fixture#103.",
    },
    {
      prompt: "run zenod-ai/fixture#103 but queue fails",
      actions: [
        {
          tool: "queueExecution",
          input: { target: "zenod-ai/fixture#103" },
          result: "ERROR: target zenod-ai/fixture#103 is not runnable: missing acceptance criteria",
        },
      ],
      modelText: "Queued execution ticket #104 for zenod-ai/fixture#103.",
    },
    {
      prompt: "summarize what happened when #107 was executed",
      actions: [
        {
          tool: "epaminon_read_issue_execution_status",
          input: { input: "AlfaBlok/obsidian-brain#107" },
          result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
        },
        {
          tool: "archus_read_exact_github_issue",
          input: { target: "AlfaBlok/obsidian-brain#107" },
          result: "Issue body mentions child #108 and PR #110.",
        },
      ],
      modelText:
        "AlfaBlok/obsidian-brain#107 ran via child #108, completed successfully, opened PR #110, and changed docs/BACKLOG-SYSTEM-PLAN.md.",
    },
    {
      prompt: "what is the status of #121?",
      actions: [
        {
          tool: "archus_read_exact_github_issue",
          input: { target: "AlfaBlok/obsidian-brain#121" },
          result:
            "AlfaBlok/obsidian-brain#121 - Console post266 link smoke - state: closed - https://github.com/AlfaBlok/obsidian-brain/issues/121\nBody: Temporary smoke test. Do not run this issue.",
        },
      ],
      modelText:
        "**Closed**: [#121](https://github.com/AlfaBlok/obsidian-brain/issues/121), Console post266 link smoke. Body says “Do not run this issue.”",
    },
    {
      prompt: "did #121 run?",
      actions: [
        {
          tool: "epaminon_read_issue_execution_status",
          input: { input: "AlfaBlok/obsidian-brain#121" },
          result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
        },
      ],
      modelText: "No execution ticket exists for AlfaBlok/obsidian-brain#121.",
    },
    {
      prompt: "create a bug issue for the smoke",
      actions: [
        {
          tool: "open_issue",
          input: { title: "Console link smoke" },
          result:
            "Created [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120) (labels: status:proposed, type:bug). Not queued/executed.",
        },
      ],
      modelText: "Issue created: AlfaBlok/obsidian-brain#120 (status:proposed, type:bug). Not queued/executed.",
    },
    {
      prompt: "create a bug issue but GitHub fails",
      actions: [{ tool: "createIssue", input: {}, result: "ERROR: GitHub returned 403: forbidden" }],
      modelText: "Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58",
    },
    {
      prompt: "open a bug issue but Archus GitHub write fails",
      actions: [{ tool: "open_issue", input: {}, result: "ERROR: GitHub returned 403: forbidden" }],
      modelText: "Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58",
    },
    {
      prompt: "create a bug issue through canonical Archus backlog action",
      actions: [
        {
          tool: "archus_request_backlog_action",
          input: { message: "create a bug issue" },
          result:
            "Created [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120) (labels: status:proposed, type:bug). Not queued/executed.",
        },
      ],
      modelText: "Issue created: AlfaBlok/obsidian-brain#120 (status:proposed, type:bug). Not queued/executed.",
    },
    {
      prompt: "canonical Archus backlog action fails",
      actions: [{ tool: "archus_request_backlog_action", input: {}, result: "ERROR: GitHub returned 403: forbidden" }],
      modelText: "Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58",
    },
    {
      prompt: "close issue #121 after smoke",
      actions: [
        {
          tool: "close_issue",
          input: { message: "close AlfaBlok/obsidian-brain#121 after smoke" },
          result: "Closed #121: https://github.com/AlfaBlok/obsidian-brain/issues/121",
        },
      ],
      modelText: "Closed #121 after the smoke test.",
    },
    {
      prompt: "close the backlog system plan issue",
      actions: [
        {
          tool: "archus_search_github_issues",
          input: { reference: "backlog system plan" },
          result:
            "Candidates:\n#108 Produce Backlog System Plan — https://github.com/AlfaBlok/obsidian-brain/issues/108\n#109 Produce Backlog System Plan — https://github.com/AlfaBlok/obsidian-brain/issues/109\nChoose one before mutating anything.",
        },
      ],
      modelText:
        "I found two possible issues, [#108](https://github.com/AlfaBlok/obsidian-brain/issues/108) and [#109](https://github.com/AlfaBlok/obsidian-brain/issues/109). I did not close anything; which one do you mean?",
    },
  ];

  it.each(cases)("$prompt", async (replay) => {
    const engine = replayEngine([replay]);
    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: replay.prompt });

    expect(reply.actions).toEqual(replay.actions);
    expect(reply.text).toContain(replay.modelText);
  });

  it("corrects narrative drift when issue text conflicts with the execution ledger", async () => {
    const replay = cases.find((c) => c.prompt === "summarize what happened when #107 was executed")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "narrative-drift" });

    expect(reply.text).toMatch(/^⚠️ Correction/);
    expect(reply.text).toContain("no execution ticket for #107");
    expect(reply.text).toContain("Do not treat issue-body comments");
  });

  it("adds the real GitHub URL when a create receipt is present but model prose omits it", async () => {
    const replay = cases.find((c) => c.prompt === "create a bug issue for the smoke")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "create-link" });

    expect(reply.text).toMatch(/^Created issue \[#120\]\(https:\/\/github\.com\/AlfaBlok\/obsidian-brain\/issues\/120\)/);
  });

  it("does not let a failed create turn into a fake success", async () => {
    const replay = cases.find((c) => c.prompt === "create a bug issue but GitHub fails")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "create-failure" });

    expect(reply.text).toMatch(/^⚠️ Correction/);
    expect(reply.text).toContain("no GitHub issue was created");
    expect(reply.text).toContain("GitHub returned 403: forbidden");
  });

  it("does not let a failed Archus open_issue turn into a fake success", async () => {
    const replay = cases.find((c) => c.prompt === "open a bug issue but Archus GitHub write fails")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "open-issue-failure" });

    expect(reply.text).toMatch(/^⚠️ Correction/);
    expect(reply.text).toContain("no GitHub issue was created");
    expect(reply.text).toContain("GitHub returned 403: forbidden");
  });

  it("adds the real execution ticket URL when queue_execution succeeds but model prose omits it", async () => {
    const replay = cases.find((c) => c.prompt === "run zenod-ai/fixture#103")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "queue-link" });

    expect(reply.text).toMatch(/^Queued execution \[owner\/central#104\]\(https:\/\/github\.com\/owner\/central\/issues\/104\)/);
  });

  it("does not let a failed queue_execution turn into a fake queued claim", async () => {
    const replay = cases.find((c) => c.prompt === "run zenod-ai/fixture#103 but queue fails")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "queue-failure" });

    expect(reply.text).toMatch(/^⚠️ Correction/);
    expect(reply.text).toContain("couldn't confirm execution state");
    expect(reply.text).toContain("The queue step failed: target zenod-ai/fixture#103 is not runnable");
  });

  it("adds the real GitHub URL when a close receipt is present but model prose omits it", async () => {
    const replay = cases.find((c) => c.prompt === "close issue #121 after smoke")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "close-link" });

    expect(reply.text).toMatch(/^Closed issue \[#121\]\(https:\/\/github\.com\/AlfaBlok\/obsidian-brain\/issues\/121\)/);
  });

  it("keeps ambiguous write turns non-mutating", async () => {
    const replay = cases.find((c) => c.prompt === "close the backlog system plan issue")!;
    const engine = replayEngine([replay]);

    const reply = await engine.handleTasking({ text: replay.prompt, surface: "selftest", conversationKey: "ambiguous-write" });

    expect(reply.actions.map((action) => action.tool)).toEqual(["archus_search_github_issues"]);
    expect(reply.text).toContain("I did not close anything");
    expect(reply.text).toContain("which one do you mean");
  });

  it("routes long reflective voice-note text through Zenod digestion before Console answers", async () => {
    const transcript = longVoiceLikeReflection();
    const digestCalls: string[] = [];
    const peerTools: PeerTools = {
      zenod_digest_message: {
        description: "digest long messages",
        run: async (input) => {
          digestCalls.push(String(input));
          return JSON.stringify({
            receipt: { source: "whatsapp:test-vn", rawAudio: "drive:file-1", transcriptRef: "Log/test.md#^e-vn" },
            interpretation:
              "This is a strategy reflection about monetizing Idealista/Airbnb analytics, with some possible future product ideas.",
            intentList: [
              {
                type: "reflection",
                text: "Think through product positioning before filing work.",
                confidence: 0.91,
                suggestedOwner: "console",
                requiresConfirmation: false,
              },
              {
                type: "possible_backlog",
                text: "Explore an Airbnb/Telegram product concept later.",
                confidence: 0.64,
                suggestedOwner: "archus",
                requiresConfirmation: true,
              },
            ],
          });
        },
      },
    };
    const llm = new RecordingLlm(
      "I understand this as a strategy reflection about Idealista/Airbnb analytics. I have not filed or run anything; I can turn the Airbnb/Telegram concept into a ticket if you want.",
    );
    const engine = createEngine({ llm, state: new SqliteStateStore(":memory:"), peerTools });

    const reply = await engine.handleTasking({ text: transcript, surface: "whatsapp", conversationKey: "long-vn" });

    expect(digestCalls).toHaveLength(1);
    expect(digestCalls[0]).toContain("Return ONLY compact JSON");
    expect(digestCalls[0]).toContain("User message/transcript:");
    expect(llm.questions[0]).toContain("ZENOD DIGESTION RECEIVED");
    expect(llm.questions[0]).toContain("Interpretation: This is a strategy reflection");
    expect(llm.questions[0]).toContain("Original user message:");
    expect(reply.actions[0]).toMatchObject({ tool: "zenod_digest_message" });
    expect(reply.text).not.toContain("Detected asks");
    expect(reply.text).not.toContain("Current intent ledger");
    expect(reply.text).not.toContain("Safe action plan");
    expect(reply.text).toContain("I have not filed or run anything");
  });

  it("strips internal intent ledgers from long-message digest replies", async () => {
    const transcript = longVoiceLikeReflection();
    const peerTools: PeerTools = {
      zenod_digest_message: {
        description: "digest long messages",
        run: async () =>
          JSON.stringify({
            receipt: { source: "whatsapp:test-vn", transcriptRef: "Log/test.md#^e-vn" },
            interpretation: "Smoke test for digest-first path on long voice notes.",
            intentList: [
              {
                type: "route_only",
                text: "Show interpreted routing without mutating anything.",
                confidence: 0.92,
                suggestedOwner: "console",
                requiresConfirmation: false,
              },
            ],
          }),
      },
    };
    const leakedScaffold = [
      "Detected asks:",
      "1. [answer_now] Answer: I want you to digest this before deciding what to do.",
      "2. [execute] Execute: store raw voice-note evidence.",
      "",
      "Current intent ledger:",
      "1. [open -> answer_now] Answer: I want you to digest this before deciding what to do.",
      "2. [open -> delegate_execution] Execute: store raw voice-note evidence.",
      "",
      "Safe action plan:",
      "1. Answer: I want you to digest this before deciding what to do. — Answer directly.",
      "2. Execute: store raw voice-note evidence. — Delegate only after approval.",
      "",
      "**Understood:** Stabilize digest-first handling for long voice notes. No mutation requested for this smoke test.",
      "",
      "**Routing:**",
      "- Raw evidence -> Zenod.",
      "- Potential backlog item -> Archus only after approval.",
      "- Execution -> Epaminon only after explicit run approval.",
    ].join("\n");
    const llm = new RecordingLlm(leakedScaffold);
    const engine = createEngine({ llm, state: new SqliteStateStore(":memory:"), peerTools });

    const reply = await engine.handleTasking({ text: transcript, surface: "whatsapp", conversationKey: "long-vn-scaffold" });

    expect(reply.actions[0]).toMatchObject({ tool: "zenod_digest_message" });
    expect(reply.text).not.toContain("Detected asks");
    expect(reply.text).not.toContain("Current intent ledger");
    expect(reply.text).not.toContain("Safe action plan");
    expect(reply.text).toContain("**Understood:**");
    expect(reply.text).toContain("Raw evidence -> Zenod");
  });

  it("does not force Zenod digestion for short direct execution commands", async () => {
    const peerTools: PeerTools = {
      zenod_digest_message: {
        description: "digest long messages",
        run: async () => {
          throw new Error("short direct commands should not be digested");
        },
      },
    };
    const llm = new RecordingLlm("Queued execution [owner/central#104](https://github.com/owner/central/issues/104).", [
      {
        tool: "queueExecution",
        input: { target: "zenod-ai/fixture#103" },
        result:
          "Minted execution ticket owner/central#104 (exec:queued) for zenod-ai/fixture#103 and dispatched to Epaminon: https://github.com/owner/central/issues/104",
      },
    ]);
    const engine = createEngine({ llm, state: new SqliteStateStore(":memory:"), peerTools });

    const reply = await engine.handleTasking({
      text: "run zenod-ai/fixture#103",
      surface: "whatsapp",
      conversationKey: "short-run",
    });

    expect(llm.questions).toEqual(["run zenod-ai/fixture#103"]);
    expect(reply.actions.map((action) => action.tool)).toEqual(["queueExecution"]);
    expect(reply.text).toContain("Queued execution");
  });

  it("lets Console route an explicit backlog intent from Zenod digestion to Archus evidence", async () => {
    const transcript = `${longVoiceLikeReflection()} Also, create a task to explore this as a Telegram product with acceptance criteria.`;
    const peerTools: PeerTools = {
      zenod_digest_message: {
        description: "digest long messages",
        run: async () =>
          JSON.stringify({
            receipt: { source: "whatsapp:test-vn", transcriptRef: "Log/test.md#^e-create" },
            interpretation: "This is strategy reflection plus one explicit request to create a task.",
            intentList: [
              {
                type: "create_backlog",
                text: "Create a task to explore the Telegram product concept with acceptance criteria.",
                confidence: 0.88,
                suggestedOwner: "archus",
                requiresConfirmation: false,
              },
            ],
          }),
      },
    };
    const llm = new RecordingLlm("Created [#400](https://github.com/zenod-ai/zenod/issues/400) for the Telegram product exploration.", [
      {
        tool: "archus_request_backlog_action",
        input: { message: "Create a task to explore the Telegram product concept with acceptance criteria." },
        result: "Created [#400](https://github.com/zenod-ai/zenod/issues/400) (status:proposed).",
      },
    ]);
    const engine = createEngine({ llm, state: new SqliteStateStore(":memory:"), peerTools });

    const reply = await engine.handleTasking({ text: transcript, surface: "whatsapp", conversationKey: "long-create" });

    expect(reply.actions.map((action) => action.tool)).toEqual(["zenod_digest_message", "archus_request_backlog_action"]);
    expect(reply.text).toContain("[#400](https://github.com/zenod-ai/zenod/issues/400)");
    expect(reply.text).not.toContain("Detected asks");
  });
});
