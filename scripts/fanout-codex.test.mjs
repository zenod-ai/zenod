import assert from "node:assert/strict";
import test from "node:test";

import { issueStatusLabelFor, detectBlocker, clarityCheck, executionBlockedRequest } from "./fanout-codex.mjs";

test("detectBlocker does NOT block a completed handoff that merely describes status labels", () => {
  // Real regression: a worker whose change SETS status:blocked described it in prose.
  const handoff = [
    "Status: complete",
    "",
    "Changes made:",
    "- Auto-merge blockers now stop visibly: set central ticket to `status:blocked`, comment, notify.",
    "",
    "Tests run:",
    "- npm test failed in unrelated existing server test.",
    "",
    "Blockers or decisions needed: none for this issue.",
  ].join("\n");
  assert.equal(detectBlocker(handoff), null);
});

test("detectBlocker blocks on an explicit Status: blocked line", () => {
  const blocked = detectBlocker("Status: blocked\n\nQuestion: which provider should we use?");
  assert.equal(blocked?.status, "blocked");
});

test("detectBlocker blocks on a structured JSON block", () => {
  const blocked = detectBlocker('```json\n{"status":"blocked","question":"need a key"}\n```');
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.question, "need a key");
});

test("detectBlocker treats the echoed Status template as complete", () => {
  assert.equal(detectBlocker("- Status: complete | blocked | failed"), null);
});

test("worker start states map to execution issue running label", () => {
  for (const status of ["starting", "reading-context", "planning", "editing", "testing", "pushing", "opening-pr"]) {
    assert.equal(issueStatusLabelFor(status), "status:running");
  }
});

test("terminal worker states preserve execution issue completion labels", () => {
  assert.equal(issueStatusLabelFor("blocked"), "status:blocked");
  assert.equal(issueStatusLabelFor("failed"), "status:blocked");
  assert.equal(issueStatusLabelFor("complete"), "status:complete");
  assert.equal(issueStatusLabelFor("complete", { hasReviewableWork: true }), "status:needs-review");
});

test("clarityCheck keeps owner:agent mandatory for legacy queued work", () => {
  const clarity = clarityCheck({
    number: 233,
    title: "Make runner exec-lane compatible",
    body: [
      "## Objective",
      "Fix scripts/fanout-codex.mjs.",
      "## Scope",
      "Runner preflight only.",
      "## Acceptance criteria",
      "- Legacy mode still requires labels.",
      "## Source context",
      "- https://github.com/zenod-ai/zenod/issues/233",
    ].join("\n"),
    labels: [{ name: "status:queued" }],
  });
  assert.equal(clarity.ok, false);
  assert.match(clarity.failures.join("; "), /missing owner:agent label/);
});

test("clarityCheck allows exec-lane dispatches to use hydrated execution context", () => {
  const clarity = clarityCheck(
    {
      number: 233,
      title: "Make runner exec-lane compatible",
      body: [
        "## Objective",
        "Fix scripts/fanout-codex.mjs.",
        "## Scope",
        "Runner preflight only.",
        "## Acceptance criteria",
        "- Exec-lane mode passes without legacy owner label.",
      ].join("\n"),
      labels: [{ name: "status:proposed" }],
    },
    {
      execLane: true,
      executionContext: "Target URL: https://github.com/zenod-ai/zenod/issues/233\nSource context: queued by Archus.",
    },
  );
  assert.equal(clarity.ok, true);
});

test("executionBlockedRequest builds the Epaminon blocked event payload", () => {
  assert.deepEqual(
    executionBlockedRequest(
      { executionId: "104", execLaneSecret: "lane-secret", epaminonUrl: "http://epaminon.local/" },
      "Issue #103 needs clarification: missing owner:agent label",
    ),
    {
      url: "http://epaminon.local/api/exec/blocked",
      headers: { "Content-Type": "application/json", "X-Lane-Secret": "lane-secret" },
      body: {
        execution_id: "104",
        note: "Issue #103 needs clarification: missing owner:agent label",
      },
    },
  );
});

test("executionBlockedRequest is inert without an execution id or lane secret", () => {
  assert.equal(executionBlockedRequest({ execLaneSecret: "lane-secret" }, "blocked"), null);
  assert.equal(executionBlockedRequest({ executionId: "104" }, "blocked"), null);
});
