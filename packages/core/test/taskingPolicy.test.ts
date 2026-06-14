import { describe, expect, it } from "vitest";
import { reconcileTaskingReply, summarizeActionsForReply, type RecordedAction } from "../src/taskingPolicy.js";

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

  it("leaves a genuine creation backed by a tool result untouched", () => {
    const reply = "Created issue #25: https://github.com/zenod-ai/zenod/issues/25";
    expect(reconcileTaskingReply(reply, [created(25, "zenod-ai/zenod")])).toBe(reply);
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

  it("treats a queryBacklog result as backing for a referenced number", () => {
    const reply = "Queued #51 as you asked.";
    const out = reconcileTaskingReply(reply, [{ tool: "approveQueue", result: "Queued #51 — the monitor will pick them up." }]);
    expect(out).toBe(reply);
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
