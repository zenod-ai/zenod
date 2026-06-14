import assert from "node:assert/strict";
import test from "node:test";

import { issueStatusLabelFor, detectBlocker } from "./fanout-codex.mjs";

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
