import { describe, expect, it, beforeEach } from "vitest";
import {
  coerceEditIssueLabelsForUserRequest,
  isAffirmativeApproval,
  NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL,
  peerMutationGuardFailure,
  reconcileTaskingReply,
  summarizeActionsForReply,
  type RecordedAction,
} from "../src/taskingPolicy.js";
import { __resetApprovalTokens } from "../src/approvalTokens.js";

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

  it("does not emit a creation correction for a read reply that only says a topic was raised", () => {
    const reply = [
      "Point 6: The benchmark epic can be turned into a tracked journey once the notification-flow test is prioritised.",
      "Point 7: You flagged the notification path test as higher priority. I’ve raised that as the immediate focus.",
    ].join("\n");
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not treat 'never filed' status reports as this-turn creation claims", () => {
    const reply = [
      "Point 2: Voice-note request never became a node.",
      "Point 3: Status = never filed, never actioned. Recommended next step: file focused Nearchus ticket if desired.",
      "Point 6: Benchmark epic (10-question battery, token counting) queued behind the notification-path test.",
    ].join("\n\n");
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not correct explicit no-op planning replies that say nothing was filed", () => {
    const reply = [
      "Nothing was filed — want me to create it now?",
      "",
      "Archus owns the central backlog item.",
      "The target repo must be named explicitly inside the central issue.",
    ].join("\n");
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not treat negative creation statements as fabricated creation claims", () => {
    const replies = [
      "No GitHub issue was created by this request.",
      "No backlog item was opened.",
      "None of the tickets were filed.",
      "I did not create an issue.",
    ];
    for (const reply of replies) expect(reconcileTaskingReply(reply, [])).toBe(reply);
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

  it("expands a terse exact-not-found answer with the checked GitHub target", () => {
    const reply = "**No.**";
    const actions: RecordedAction[] = [
      {
        tool: "archus_read_exact_github_issue",
        input: { target: "zenod-ai/zenod#99999" },
        result: "zenod-ai/zenod#99999 was not found in GitHub.",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe("zenod-ai/zenod#99999 was not found in GitHub.");
  });

  it("expands an exact issue status answer that collapsed to only the URL", () => {
    const reply = "https://github.com/zenod-ai/zenod/issues/314";
    const actions: RecordedAction[] = [
      {
        tool: "archus_read_exact_github_issue",
        input: { target: "zenod-ai/zenod#314" },
        result:
          "zenod-ai/zenod#314 - [Epic] Stabilize cross-agent work via durable user journeys - state: open; labels: stability, owner:agent, status:proposed, suite-v2; updated: 2026-06-22T22:39:14Z - https://github.com/zenod-ai/zenod/issues/314\nBody: ...",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(
      "zenod-ai/zenod#314 is open. [Epic] Stabilize cross-agent work via durable user journeys. Labels: stability, owner:agent, status:proposed, suite-v2. https://github.com/zenod-ai/zenod/issues/314",
    );
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

  it("does not treat read-only candidate lists plus no-side-effect disclaimers as execution claims", () => {
    const reply = [
      '**Candidates for "journey ledger" (none matched exactly):**',
      "- AlfaBlok/obsidian-brain#140 - Bug: completed Epaminon fan-out leaves execution ticket stuck running — https://github.com/AlfaBlok/obsidian-brain/issues/140",
      "- AlfaBlok/obsidian-brain#143 - Bug: Phylax cannot access notification ledger for audit questions — https://github.com/AlfaBlok/obsidian-brain/issues/143",
      "",
      "No issues were edited or run.",
    ].join("\n");
    const actions: RecordedAction[] = [
      { tool: "archus_search_github_issues", input: { reference: "journey ledger" }, result: "No issue matched journey ledger." },
      {
        tool: "archus_search_github_issues",
        input: { reference: "ledger" },
        result: "Found candidates #140 and #143; choose one before mutating anything.",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not treat explicit read-only/no-mutation confirmations as execution claims", () => {
    const reply = [
      "Per your explicit read-only instruction, I did not create issues, run tickets, store memory, or notify anyone.",
      "",
      "Detected asks:",
      "1. [research] Investigate what happened to the prior backlog UI request.",
      "2. [create_backlog] Design a Zenod retrieval benchmark.",
      "",
      "Current intent ledger:",
      "1. [open -> query_prior_durable_work] Investigate what happened to the prior backlog UI request.",
      "2. [open -> propose_durable_backlog] Design a Zenod retrieval benchmark.",
    ].join("\n");

    expect(reconcileTaskingReply(reply, [])).toBe(reply);
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

  it("does not treat tool inventory bullets as execution claims", () => {
    const reply = [
      "**Console-owned workflow tools (read-only list):**",
      "",
      "- `console_create_issue_then_run`: Creates a durable journey for requests that need BOTH filing a new GitHub issue and then immediately running/executing it.",
      "- `console_create_issues`: Creates a durable journey for requests needing multiple independent GitHub issues created in parallel.",
      "- `console_run_ephemeral_task`: Creates a durable journey for one-off execution/research/ops work.",
    ].join("\n");
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not treat runnable execution-label metadata as an execution claim", () => {
    const reply = [
      "**Read results (no mutations performed):**",
      "",
      "- **zenod-ai/zenod#296** — state: open; labels: none of the runnable execution labels (`owner:agent`, `execution`, etc.) present; link: https://github.com/zenod-ai/zenod/issues/296",
      "- **AlfaBlok/obsidian-brain#146** — state: open; labels: bug, status:proposed, execution, central, archus, permissions; link: https://github.com/AlfaBlok/obsidian-brain/issues/146",
      "",
      "**Runnable status:** #296 is **not runnable** by Archus.",
      "**Exact reason:** it lacks the required execution labels (`owner:agent` etc.).",
      "**Durable tracker:** AlfaBlok/obsidian-brain#146 tracks the missing bootstrap/repair path.",
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

  it("does not correct a direct Epaminon run receipt as unconfirmed execution state", () => {
    const reply = "Queued execution direct-1782228836750-46a6500e for AlfaBlok/obsidian-brain#168: running.";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_run_existing_issue",
        input: { target: "AlfaBlok/obsidian-brain#168" },
        result: "Queued execution direct-1782228836750-46a6500e for AlfaBlok/obsidian-brain#168: running",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("does not correct a create-then-run journey receipt as unconfirmed execution state", () => {
    const reply = "Created AlfaBlok/obsidian-brain#169 and dispatched execution direct-1782230500486-18e3cdb1 running.";
    const actions: RecordedAction[] = [
      {
        tool: "console_create_issue_then_run",
        input: { issue: { title: "Journey ladder L2 create then run smoke" } },
        result:
          "Journey bd2c6f32-589a-4424-955a-b530fd3905b4: completed.\n" +
          "Created AlfaBlok/obsidian-brain#169 (https://github.com/AlfaBlok/obsidian-brain/issues/169) and dispatched execution direct-1782230500486-18e3cdb1 (running).\n" +
          "Execution: direct-1782230500486-18e3cdb1 for AlfaBlok/obsidian-brain#169 (running)",
      },
    ];
    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
  });

  it("corrects a successful-looking answer when a Console journey blocked", () => {
    const reply = "ephemeral smoke sentinel-1782246200 observed";
    const actions: RecordedAction[] = [
      {
        tool: "console_run_ephemeral_task",
        input: { objective: "return a short summary saying `ephemeral smoke sentinel-1782246200 observed`" },
        result:
          "Journey a5e7b87c-e982-41f2-bd2d-4a5cc82ebf45: blocked.\n" +
          "Epaminon blocked ephemeral execution ephemeral-1782247229818-840d40a0: bad execution target \"ephemeral:ephemeral-1782247229818-840d40a0\"; expected owner/repo#N\n" +
          "Execution: ephemeral-1782247229818-840d40a0 for ephemeral:ephemeral-1782247229818-840d40a0 (blocked)",
      },
    ];

    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("the Console journey blocked");
    expect(out).toContain("Epaminon blocked ephemeral execution");
    expect(out).not.toContain(reply);
  });

  it("corrects a final-looking ephemeral answer backed only by a running receipt", () => {
    const reply = "ephemeral smoke sentinel-1782249200 observed";
    const actions: RecordedAction[] = [
      {
        tool: "console_run_ephemeral_task",
        input: { objective: "return a short summary saying `ephemeral smoke sentinel-1782249200 observed`" },
        result:
          "Journey ad32205e-7741-4e52-9a9c-d5364b714dcf: completed.\n" +
          "Queued ephemeral execution ephemeral-1782249088537-c4e9f1e9 (running).\n" +
          "Execution: ephemeral-1782249088537-c4e9f1e9 for ephemeral:ephemeral-1782249088537-c4e9f1e9 (running)",
      },
    ];

    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("one-off execution is running");
    expect(out).toContain("Queued ephemeral execution");
    expect(out).not.toContain(reply);
  });

  it("corrects a terminal execution claim backed only by a queue receipt", () => {
    const reply =
      "Done. Created + executed zenod-ai/zenod#303 (no-op verified, no changes). Execution complete.";
    const actions: RecordedAction[] = [
      {
        tool: "queueExecution",
        result:
          "Minted execution ticket AlfaBlok/obsidian-brain#151 (exec:queued) for zenod-ai/zenod#303 and dispatched to Epaminon: https://github.com/AlfaBlok/obsidian-brain/issues/151",
      },
    ];
    const out = reconcileTaskingReply(reply, actions);
    expect(out).toMatch(/^⚠️ Correction/);
    expect(out).toContain("could not confirm a terminal execution state");
    expect(out).toContain("queue or dispatch receipt only proves");
  });

  // E1-T6 / #234: an answer that already OWNS the honesty gap ("I couldn't confirm…")
  // must NOT get a redundant ⚠️ Correction stacked on top of it.
  it("does not stack a spurious ⚠️ Correction when the reply already says it couldn't confirm", () => {
    const reply =
      "I couldn't confirm the execution status for #303 this turn — the execution_status read came back empty, so I can't tell you whether the run finished.";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("does not stack a spurious ⚠️ Correction on an honest 'couldn't read' terminal answer", () => {
    const reply = "I wasn't able to read whether execution #151 completed, so treat its done/failed state as unknown.";
    expect(reconcileTaskingReply(reply, [])).toBe(reply);
  });

  it("allows a terminal execution answer backed by live execution_status", () => {
    const reply = "Execution #151 is done for zenod-ai/zenod#303.";
    const actions: RecordedAction[] = [
      {
        tool: "epaminon_read_issue_execution_status",
        result: "#151 — zenod-ai/zenod#303 — done — evidence: https://github.com/zenod-ai/zenod/pull/303",
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

  it("does not apply create-claim correction to close/update turns whose comment mentions old issue refs", () => {
    const reply =
      "Unable to close AlfaBlok/obsidian-brain#137 (403: insufficient permissions). No close action performed.\n\n" +
      "Requested closing comment mentioned: created #129, #135, #108, #109, #287, #288, and #133.";
    const actions: RecordedAction[] = [
      {
        tool: "close_issue",
        result: "Unable to close #137: GitHub returned 403: insufficient permissions",
      },
    ];

    expect(reconcileTaskingReply(reply, actions)).toBe(reply);
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

  it("allows read-only ask_archus judgment questions that mention create/open behavior", () => {
    const request =
      "Read-only probe: if I ask to open a high-level central backlog bug through Archus, which repo should Archus use? Do not create or edit anything.";

    expect(peerMutationGuardFailure("ask_archus", request)).toBeNull();
  });

  it("still blocks ask_archus when the current request actually asks it to create", () => {
    const request = "Ask Archus to create a central backlog bug for the permission issue.";

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

  it("blocks archus_run_issue when a create-and-run request has no exact existing issue", () => {
    const failure = peerMutationGuardFailure(
      "archus_run_issue",
      "Please create a temporary live verification issue in zenod-ai/zenod and run it with Epaminon.",
    );

    expect(failure).toContain("running requires an exact work issue");
    expect(failure).toContain("create-and-run");
  });

  describe("M-1 — stateful approval token for outbound sends", () => {
    beforeEach(() => __resetApprovalTokens());

    it("still blocks a bare 'approved' with no conversation context (unchanged, no context passed)", () => {
      expect(peerMutationGuardFailure("post_tweet", "approved")).toContain("require an explicit write/run/send instruction");
    });

    it("issuing a block on a real draft registers a token that a later affirmative on the SAME draft resolves", () => {
      const args = { text: "Hello world" };
      const blocked = peerMutationGuardFailure("post_tweet", "Here's the tweet I drafted: Hello world", {
        conversationId: "c1",
        args,
      });
      expect(blocked).toBe("Blocked post_tweet: mutating peer tools require an explicit write/run/send instruction from the user's current message.");

      const resolved = peerMutationGuardFailure("post_tweet", "Tweet approved", { conversationId: "c1", args });
      expect(resolved).toBeNull();
    });

    it("a token is one-time use — a second affirmative after consumption has nothing pending", () => {
      const args = { text: "Hello world" };
      peerMutationGuardFailure("post_tweet", "Here's the tweet I drafted: Hello world", { conversationId: "c2", args });
      expect(peerMutationGuardFailure("post_tweet", "approved", { conversationId: "c2", args })).toBeNull();
      expect(peerMutationGuardFailure("post_tweet", "approved", { conversationId: "c2", args })).toBe(
        NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL,
      );
    });

    it("a bare affirmative with no standing draft resolves to the nothing-pending sentinel, never a silent allow", () => {
      expect(peerMutationGuardFailure("post_tweet", "approved", { conversationId: "c3", args: {} })).toBe(
        NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL,
      );
    });

    it("an affirmative for a different tool than the standing token still has nothing pending", () => {
      const args = { text: "Hello world" };
      peerMutationGuardFailure("post_tweet", "Here's the tweet I drafted: Hello world", { conversationId: "c4", args });
      expect(peerMutationGuardFailure("post_reddit", "approved", { conversationId: "c4", args })).toBe(
        NOTHING_PENDING_TO_APPROVE_GUARD_SENTINEL,
      );
    });

    it("an explicit write verb never needs a token", () => {
      expect(peerMutationGuardFailure("post_tweet", "Post this tweet: Hello world", { conversationId: "c5", args: { text: "Hello world" } })).toBeNull();
    });

    it("a negated reply never reads as an explicit verb OR an affirmative", () => {
      expect(peerMutationGuardFailure("send_email", "don't send it")).toContain("require an explicit write/run/send instruction");
      expect(isAffirmativeApproval("don't send it")).toBe(false);
      expect(isAffirmativeApproval("no, cancel that")).toBe(false);
    });
  });
});

describe("isAffirmativeApproval", () => {
  it("matches short natural-language affirmatives", () => {
    expect(isAffirmativeApproval("approved")).toBe(true);
    expect(isAffirmativeApproval("Tweet approved")).toBe(true);
    expect(isAffirmativeApproval("yes")).toBe(true);
    expect(isAffirmativeApproval("send it")).toBe(true);
    expect(isAffirmativeApproval("go ahead")).toBe(true);
  });

  it("does not match full sentences or unrelated content", () => {
    expect(isAffirmativeApproval("What is the status of issue 108?")).toBe(false);
    expect(isAffirmativeApproval("Please create a new issue for the login bug")).toBe(false);
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
