import assert from "node:assert/strict";
import test from "node:test";

import { issueStatusLabelFor } from "./fanout-codex.mjs";

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
