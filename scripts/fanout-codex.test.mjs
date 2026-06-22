import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { issueStatusLabelFor, detectBlocker, clarityCheck, executionBlockedRequest, remoteMatchesRepo, resetBaseCheckout } from "./fanout-codex.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

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

test("remoteMatchesRepo accepts common GitHub remote forms and rejects wrong checkouts", () => {
  assert.equal(remoteMatchesRepo("https://github.com/AlfaBlok/obsidian-brain.git", "AlfaBlok/obsidian-brain"), true);
  assert.equal(remoteMatchesRepo("git@github.com:AlfaBlok/obsidian-brain.git", "AlfaBlok/obsidian-brain"), true);
  assert.equal(remoteMatchesRepo("https://github.com/zenod-ai/zenod.git", "AlfaBlok/obsidian-brain"), false);
  assert.equal(remoteMatchesRepo("", "AlfaBlok/obsidian-brain"), false);
});

test("resetBaseCheckout heals dirty stale runner cache checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "zenod-fanout-reset-"));
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  const work = join(root, "work");
  try {
    git(root, ["init", "--bare", origin]);
    git(root, ["init", seed]);
    git(seed, ["config", "user.email", "test@example.com"]);
    git(seed, ["config", "user.name", "Test"]);
    writeFileSync(join(seed, "tracked.txt"), "v1\n");
    git(seed, ["add", "tracked.txt"]);
    git(seed, ["commit", "-m", "v1"]);
    git(seed, ["branch", "-M", "main"]);
    git(seed, ["remote", "add", "origin", origin]);
    git(seed, ["push", "-u", "origin", "main"]);

    git(root, ["clone", origin, work]);
    writeFileSync(join(seed, "tracked.txt"), "v2\n");
    git(seed, ["commit", "-am", "v2"]);
    git(seed, ["push", "origin", "main"]);
    git(work, ["fetch", "origin", "main"]);
    writeFileSync(join(work, "tracked.txt"), "dirty local residue\n");

    resetBaseCheckout(work, "main");

    assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "v2\n");
    assert.equal(git(work, ["status", "--porcelain"]), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
