import { describe, expect, it } from "vitest";
import {
  coerceEditIssueLabelsForUserRequest,
  peerMutationGuardFailure,
  reconcileTaskingReply,
  summarizeActionsForReply,
  type RecordedAction,
} from "../src/taskingPolicy.js";

const created = (n: number, repo = "AlfaBlok/obsidian-brain"): RecordedAction => ({
  tool: "createIssue",
  result: `Created issue #${n}: https://github.com/${repo}/issues/${n}`,
});

describe("reconcileTaskingReply", () => {
  it("rewrites a fabricated creation that no tool performed (the WhatsApp #58 bug)", () => {
    const fabricated =
      "Done. Created:\n• #58 — Market research on idealista_scraper repo\n" +
      "https://github.com/AlfaBlok/obsidian-brain/issues/58\nStatus: proposed (not queued).";
    const out = reconcileTaskingReply(fabricated, []);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no GitHub issue was created");
    expect(out).toContain("#58");
    expect(out).toContain("want me to create it now");
  });

  it("surfaces the real error when create_issue failed", () => {
    const actions: RecordedAction[] = [{ tool: "createIssue", result: "ERROR: GitHub returned 403: forbidden" }];
    const out = reconcileTaskingReply("Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58", actions);
    expect(out).toContain("The create step failed: GitHub returned 403: forbidden");
  });

  it("surfaces the real error when peer open_issue failed", () => {
    const actions: RecordedAction[] = [{ tool: "open_issue", result: "ERROR: GitHub returned 403: forbidden" }];
    const out = reconcileTaskingReply("Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58", actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no GitHub issue was created");
    expect(out).toContain("The create step failed: GitHub returned 403: forbidden");
  });

  it("surfaces the real error when canonical Archus backlog action failed", () => {
    const actions: RecordedAction[] = [{ tool: "archus_request_backlog_action", result: "ERROR: GitHub returned 403: forbidden" }];
    const out = reconcileTaskingReply("Created issue #58: https://github.com/AlfaBlok/obsidian-brain/issues/58", actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no GitHub issue was created");
    expect(out).toContain("The create step failed: GitHub returned 403: forbidden");
  });

  it("corrects a fabricated multi-issue success after the create 404'd on a phantom repo (the zenod/zenod #1..#5 bug)", () => {
    // create_issue targeted a non-existent repo (zenod/zenod). GitHub 404'd, so the
    // tool recorded an ERROR — but the model still narrated success with invented
    // numbers and cross-links, using a verb ("placed") the completion list omits.
    const reply =
      "All five tickets placed in zenod/zenod:\n" +
      "- zenod/zenod#1 — Foo\n- zenod/zenod#2 — Bar\n- zenod/zenod#3 — Baz\n" +
      "- zenod/zenod#4 — Qux\n- zenod/zenod#5 — Quux\nCross-links added between them.";
    const actions: RecordedAction[] = [
      { tool: "createIssue", result: "ERROR: GitHub returned 404: Not Found" },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no GitHub issue was created");
    expect(out).toContain("The create step failed: GitHub returned 404: Not Found");
    // every invented number is named so the reader ignores them
    for (const n of [1, 2, 3, 4, 5]) expect(out).toContain(`#${n}`);
  });

  it("corrects a 'placed' creation claim that no tool performed", () => {
    const out = reconcileTaskingReply("Done — placed the ticket in the backlog.", []);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no GitHub issue was created");
  });

  it("does not correct a partial result: leaves the genuinely-created issue when another create failed", () => {
    const reply = "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
    const actions: RecordedAction[] = [
      created(25, "zenod-ai/zenod"),
      { tool: "createIssue", result: "ERROR: GitHub returned 404: Not Found" },
    ];
    // #25 is real and backed; the failed-create guard must not fire on it.
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("leaves a genuine creation backed by a tool result untouched", () => {
    const reply = "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
    expect(reconcileTaskingReply(reply, [created(25, "zenod-ai/zenod")])).toBe(reply);
  });

  it("adds the direct issue URL when a genuine creation reply only cites the number", () => {
    const reply = "Done — created issue #25 for you.";
    const out = reconcileTaskingReply(reply, [created(25, "zenod-ai/zenod")]);
    expect(out).toBe(`Created issue [#25](https://github.com/zenod-ai/zenod/issues/25)\n\n${reply}`);
  });

  it("adds the direct issue URL when a genuine creation reply omits the number", () => {
    const reply = "Done — created the ticket.";
    const out = reconcileTaskingReply(reply, [created(25, "zenod-ai/zenod")]);
    expect(out).toBe(`Created issue [#25](https://github.com/zenod-ai/zenod/issues/25)\n\n${reply}`);
  });

  it("adds the direct issue URL from a peer open_issue receipt when Console prose omits it", () => {
    const reply = "Issue created: AlfaBlok/obsidian-brain#120 (status:proposed, type:bug). Not queued/executed.";
    const actions: RecordedAction[] = [
      {
        tool: "open_issue",
        result:
          "Created [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120) (labels: status:proposed, type:bug). Not queued/executed.",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toBe(`Created issue [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120)\n\n${reply}`);
  });

  it("adds the direct issue URL from a canonical Archus backlog-action receipt when Console prose omits it", () => {
    const reply = "Issue created: AlfaBlok/obsidian-brain#120 (status:proposed, type:bug). Not queued/executed.";
    const actions: RecordedAction[] = [
      {
        tool: "archus_request_backlog_action",
        result:
          "Created [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120) (labels: status:proposed, type:bug). Not queued/executed.",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toBe(`Created issue [#120](https://github.com/AlfaBlok/obsidian-brain/issues/120)\n\n${reply}`);
  });

  it("adds the direct issue URL from a close_issue receipt when Console prose omits it", () => {
    const reply = "Closed #121 as completed.";
    const actions: RecordedAction[] = [
      {
        tool: "close_issue",
        result: "Closed #121: https://github.com/AlfaBlok/obsidian-brain/issues/121",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toBe(`Closed issue [#121](https://github.com/AlfaBlok/obsidian-brain/issues/121)\n\n${reply}`);
  });

  it("adds the direct issue URL from an edit_issue receipt when Console prose omits it", () => {
    const reply = "Updated #121 with the smoke-test comment.";
    const actions: RecordedAction[] = [
      {
        tool: "edit_issue",
        result: "Edited #121 (comment): https://github.com/AlfaBlok/obsidian-brain/issues/121",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toBe(`Edited issue [#121](https://github.com/AlfaBlok/obsidian-brain/issues/121)\n\n${reply}`);
  });

  it("corrects a creation that cites the wrong number", () => {
    const reply = "Done — created issue #58 for you.";
    const out = reconcileTaskingReply(reply, [created(61)]);
    expect(out).toContain("the number cited in the text is wrong");
    expect(out).toContain("#61");
  });

  it("does not touch offers to create (future tense, no completion verb)", () => {
    const reply = "Want me to create the ticket? I can open issue for the idealista work.";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not touch read-only mentions of an issue number", () => {
    const reply = "#58 is the auto-merge ticket and it's still open.";
    expect(reconcileTaskingReply(reply, [{ tool: "queryBacklog", result: "Open issues: 1\n#58 Runner auto-merge mode" }])).toBe(reply);
  });

  it("does not touch vault captures that happen to use a completion verb", () => {
    const reply = "Logged this to your vault under Areas/Insurance.md.";
    expect(reconcileTaskingReply(reply, [{ tool: "capture", result: "Filed: Log/2026-06-14.md#^e-1" }])).toBe(reply);
  });

  it("flags a queue/merge receipt that no tool produced", () => {
    const reply = "Queued #99 — the monitor will pick it up.";
    const out = reconcileTaskingReply(reply, [{ tool: "approveQueue", result: "Queued #51 — the monitor will pick them up." }]);
    expect(out).toContain("couldn't confirm #99");
  });

  it("does not correct a status confirmation with an adverb between be-verb and participle (the #76 false positive)", () => {
    const reply =
      "#76 is indeed approved/queued.\n\n" +
      "#80 is explicitly a research spike / plan ticket, not a code-merge ticket. There is no PR planned for #80.";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("corrects an ungrounded execution status denial (the #108/#109 pickup bug)", () => {
    const reply = "No. #108 / #109 were not created or queued. The plan-generation execution ticket did not run.";
    const out = reconcileTaskingReply(reply, []);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("couldn't confirm execution state for #108, #109");
    expect(out).toContain("live execution_status");
  });

  it("does not correct an execution status answer backed by execution_status", () => {
    const reply = "#109 is running for AlfaBlok/obsidian-brain#108.";
    const actions: RecordedAction[] = [
      {
        tool: "execution_status",
        result: "Execution 109: exec:running target AlfaBlok/obsidian-brain#108 started 2026-06-19T14:25:28Z",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not correct an execution status answer backed by the Console-facing Epaminon status tool", () => {
    const reply = "#109 is needs-review for AlfaBlok/obsidian-brain#108.";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_read_issue_execution_status",
        result: "#109 — AlfaBlok/obsidian-brain#108 — needs-review — evidence: https://github.com/AlfaBlok/obsidian-brain/pull/110",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not treat proposed workflow text about an execution ticket as an execution claim", () => {
    const reply = [
      "Got it.",
      "",
      "- Your entire voice note has been queued for storage + ingestion (raw audio + transcript → project memory).",
      "- Research-style questions → single lightweight execution ticket (no extra epic) → Codex works → answer lands in memory/ticket → you get a short receipt.",
      "- Follow-ups reopen the same ticket to keep context.",
      "",
      "Do you want me to open one clean investigation ticket now?",
    ].join("\n");
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("corrects a positive execution narrative when Epaminon found no execution for that issue", () => {
    const reply =
      "AlfaBlok/obsidian-brain#107 ran via child #108, completed successfully, opened PR #110, and changed docs/BACKLOG-SYSTEM-PLAN.md.";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_read_issue_execution_status",
        input: { input: "AlfaBlok/obsidian-brain#107" },
        result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
      },
      {
        tool: "archus_read_exact_github_issue",
        input: { input: "AlfaBlok/obsidian-brain#107" },
        result: "Issue body mentions child #108 and PR #110.",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("no execution ticket for #107");
    expect(out).toContain("Do not treat issue-body comments");
  });

  it("allows a no-execution answer for the parent while separately naming child execution evidence", () => {
    const reply =
      "No execution is recorded for AlfaBlok/obsidian-brain#107 itself. Related child #108 has execution #109 in needs-review with PR #110.";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_read_issue_execution_status",
        input: { input: "AlfaBlok/obsidian-brain#107" },
        result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
      },
      {
        tool: "epaminon_read_issue_execution_status",
        input: { input: "AlfaBlok/obsidian-brain#108" },
        result: "#109 — AlfaBlok/obsidian-brain#108 — needs-review — evidence: https://github.com/AlfaBlok/obsidian-brain/pull/110",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not treat a backed negative execution answer as an unconfirmed queue claim", () => {
    const reply = "No execution ticket exists for AlfaBlok/obsidian-brain#107 (none queued/running/etc.).";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_read_issue_execution_status",
        input: { input: "AlfaBlok/obsidian-brain#107" },
        result: "No execution tickets currently queued, running, blocked, awaiting review, approved, done, or failed.",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not warn when a same-turn create receipt says it was not queued or run by this request", () => {
    const reply =
      "Created: [AlfaBlok/obsidian-brain#119](https://github.com/AlfaBlok/obsidian-brain/issues/119) (labels applied; not queued or run).";
    expect(reconcileTaskingReply(reply, [created(119)])).toBe(reply);
  });

  it("does not treat quoted issue instructions like 'do not run' as execution-status claims", () => {
    const reply =
      "**Closed** (smoke test passed; “do not run”).\n" +
      "AlfaBlok/obsidian-brain#121 — “Console post266 link smoke”. Labels: `status:proposed`, `type:bug`.";
    const actions: RecordedAction[] = [
      {
        tool: "archus_read_exact_github_issue",
        input: { target: "AlfaBlok/obsidian-brain#121" },
        result:
          "AlfaBlok/obsidian-brain#121 - Console post266 link smoke - state: closed - https://github.com/AlfaBlok/obsidian-brain/issues/121\nBody: Temporary smoke test. Do not run this issue.",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not correct a queue receipt backed by queue_execution", () => {
    const reply = "Execution ticket opened and queued: [#108](https://github.com/AlfaBlok/obsidian-brain/issues/108), live execution #109.";
    const actions: RecordedAction[] = [
      {
        tool: "queueExecution",
        result:
          "Minted execution ticket AlfaBlok/obsidian-brain#108 (exec:queued) for AlfaBlok/obsidian-brain#107; Epaminon execution 109 dispatched.",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("adds the execution ticket URL when a queue_execution receipt is present but Console prose omits it", () => {
    const reply = "Queued execution ticket #104 for zenod-ai/fixture#103.";
    const actions: RecordedAction[] = [
      {
        tool: "queueExecution",
        result:
          "Minted execution ticket owner/central#104 (exec:queued) for zenod-ai/fixture#103 and dispatched to Epaminon: https://github.com/owner/central/issues/104",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toBe(`Queued execution [owner/central#104](https://github.com/owner/central/issues/104)\n\n${reply}`);
  });

  it("surfaces the queue_execution error when the model claims the run was queued", () => {
    const reply = "Queued execution ticket #104 for zenod-ai/fixture#103.";
    const actions: RecordedAction[] = [
      {
        tool: "queueExecution",
        result: "ERROR: target zenod-ai/fixture#103 is not runnable: missing acceptance criteria",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("couldn't confirm execution state for #104, #103");
    expect(out).toContain("The queue step failed: target zenod-ai/fixture#103 is not runnable");
  });

  it("does not correct coordinated participles joined by 'and' under a be-verb", () => {
    const reply = "#51 was already filed and queued earlier this week.";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("still flags an active-voice receipt even when other lines describe status", () => {
    const reply = "#76 is already queued.\nQueued #99 — the monitor will pick it up.";
    const out = reconcileTaskingReply(reply, []);
    const banner = out.split("\n")[0];
    expect(banner).toContain("couldn't confirm #99");
    expect(banner).not.toContain("#76"); // the descriptive #76 is not flagged
  });

  it("treats a queryBacklog result as backing for a referenced number", () => {
    const reply = "Queued #51 as you asked.";
    const out = reconcileTaskingReply(reply, [{ tool: "approveQueue", result: "Queued #51 — the monitor will pick them up." }]);
    expect(out).toBe(reply);
  });

  it("does not flag a status summary whose numbers are all backed by query_backlog (the Telegram #86 false positive)", () => {
    const reply =
      "**State of execution — 2026-06-15**\n\n" +
      "| # | Title | Status | Key Notes |\n" +
      "|---|-------|--------|-----------|\n" +
      "| 86 | Re-implement selector | needs-review | Just created & queued |\n" +
      "| 76 | Fallback chain | needs-review | Blocked dependency for #86 |\n\n" +
      "1 new issue (#86) is queued and ready for the runner.";
    const backlog: RecordedAction = {
      tool: "queryBacklog",
      result:
        "Open issues: 2\n" +
        "#86 Re-implement selector [status:queued] — updated 2026-06-15 — https://github.com/AlfaBlok/obsidian-brain/issues/86\n" +
        "#76 Fallback chain [status:needs-review] — updated 2026-06-15 — https://github.com/AlfaBlok/obsidian-brain/issues/76",
    };
    expect(reconcileTaskingReply(reply, [backlog])).toBe(reply);
  });

  it("still flags a fabricated creation when the cited number is not backed by any tool", () => {
    const reply = "Done — just created issue #58 for you. https://github.com/AlfaBlok/obsidian-brain/issues/58";
    const out = reconcileTaskingReply(reply, [{ tool: "queryBacklog", result: "Open issues: 1\n#42 Something else — https://github.com/AlfaBlok/obsidian-brain/issues/42" }]);
    expect(out).toContain("no GitHub issue was created");
    expect(out).toContain("#58");
    expect(out).not.toContain("#42");
  });

  it("does not correct a capabilities description that names verbs and example numbers", () => {
    const reply =
      "Here's what I can do with issues:\n\n" +
      "- create_issue: Create a new GitHub issue. Issues are created with status:proposed by default.\n" +
      "- query_backlog: Check status of open issues (e.g. proposed, queued, in-progress, needs-review).\n" +
      "- approve_queue: Move specific proposed issues to queued — only when you approve by number (e.g. \"queue #62 and #63\").";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not correct a quoted past receipt from chat history", () => {
    const reply =
      "Yes, the chat log shows my first reply was:\n\n" +
      "> Created issue #62: https://github.com/AlfaBlok/obsidian-brain/issues/62\n\n" +
      "So that was the one. (I later second-guessed myself and corrected it.)";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });
});

describe("peerMutationGuardFailure", () => {
  it("blocks mutating peer tools during an explicit read-only issue lookup", () => {
    const failure = peerMutationGuardFailure(
      "close_issue",
      "V5 read-only test. What is issue 108? Resolve it before answering, and include the issue link.",
    );

    expect(failure).toContain("read-only/status-oriented");
  });

  it("blocks mutating peer tools when the user did not ask for a write", () => {
    const failure = peerMutationGuardFailure("close_issue", "I need context on issue 108.");

    expect(failure).toContain("require an explicit write/run/send instruction");
  });

  it("allows explicit backlog writes", () => {
    expect(peerMutationGuardFailure("close_issue", "Close AlfaBlok/obsidian-brain#121 after the smoke test.")).toBeNull();
    expect(peerMutationGuardFailure("open_issue", "Create a bug issue for the transcript receipt regression.")).toBeNull();
    expect(peerMutationGuardFailure("archus_request_backlog_action", "Update issue #121 with this comment.")).toBeNull();
  });

  it("allows explicit writes whose issue body mentions read-only safety checks", () => {
    const request =
      "Open a central brain backlog issue titled \"V5: complete controlled Archus write sweep\". " +
      "The body should include done criteria covering cleanup so read-only turns do not even try write tools.";

    expect(peerMutationGuardFailure("archus_request_backlog_action", request)).toBeNull();
  });

  it("does not let ask_archus become the write-tool bypass", () => {
    const request = "Please ask Archus to open a central brain backlog issue titled \"V5: complete controlled Archus write sweep\".";

    expect(peerMutationGuardFailure("ask_archus", request)).toContain("dedicated Archus write/run tool");
  });

  it("keeps execution status questions read-only but allows explicit runs", () => {
    expect(peerMutationGuardFailure("archus_run_issue", "Did AlfaBlok/obsidian-brain#121 run?")).toContain(
      "require an explicit write/run/send instruction",
    );
    expect(peerMutationGuardFailure("archus_run_issue", "Run AlfaBlok/obsidian-brain#121 now.")).toBeNull();
    expect(
      peerMutationGuardFailure(
        "archus_run_issue",
        "Run exact issue AlfaBlok/obsidian-brain#138 with Epaminon now. This is an explicit execution request for #138 only.",
      ),
    ).toBeNull();
  });
});

describe("coerceEditIssueLabelsForUserRequest", () => {
  it("treats model labelsSet as labelsAdd when the user asked to add labels", () => {
    expect(coerceEditIssueLabelsForUserRequest("Update #129: add labels test and v5.", null, ["test", "v5"])).toEqual({
      labelsAdd: ["test", "v5"],
      labelsSet: null,
    });
  });

  it("preserves labelsSet when the user explicitly asked to set labels exactly", () => {
    expect(
      coerceEditIssueLabelsForUserRequest("Update #129: set labels exactly to status:proposed, test, v5.", null, [
        "status:proposed",
        "test",
        "v5",
      ]),
    ).toEqual({
      labelsAdd: null,
      labelsSet: ["status:proposed", "test", "v5"],
    });
  });
});

describe("summarizeActionsForReply", () => {
  it("returns the real tool receipts when the model produced no text", () => {
    const actions: RecordedAction[] = [created(25, "zenod-ai/zenod"), { tool: "labelIssue", result: "Labeled issue #25" }];
    expect(summarizeActionsForReply(actions)).toContain("Created issue #25");
  });

  it("skips errors and returns null when nothing useful happened", () => {
    expect(summarizeActionsForReply([{ tool: "createIssue", result: "ERROR: boom" }])).toBeNull();
    expect(summarizeActionsForReply([])).toBeNull();
  });
});
