import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  batchKey,
  detectIntegrationStatus,
  ensureFanInBatch,
  integrationPrompt,
  mergeApprovalForIssue,
  normalizeState,
  pickupNotification,
  recordMergeAttempt,
  reviewHeldByFanInBatch,
  updateFanInBatches,
} from "./backlog-monitor.mjs";

test("fan-in batch keys are deterministic by issue number", () => {
  assert.equal(batchKey([52, 41, 7]), "7-41-52");
});

test("pickup notification says Codex is working with issue title and repo", () => {
  assert.equal(
    pickupNotification({ number: 56, title: "Work-started visibility", target: "zenod-ai/zenod" }),
    "🤖 Codex working on #56 — Work-started visibility (zenod-ai/zenod)",
  );
});

test("ensureFanInBatch records only multi-issue launches", () => {
  const state = normalizeState({});

  assert.equal(ensureFanInBatch(state, [41]), null);
  const batch = ensureFanInBatch(state, [52, 41]);

  assert.equal(batch.key, "41-52");
  assert.deepEqual(batch.issues, [41, 52]);
  assert.equal(batch.status, "waiting");
  assert.equal(state.fanInBatches["41-52"], batch);
});

test("auto-merge is opt-in and manual approval stays eligible", () => {
  const manualState = normalizeState({});
  const reviewIssue = { number: 93, title: "auto merge", status: "status:needs-review", autoMerge: false };
  const approvedIssue = { number: 94, title: "manual merge", status: "status:approved-merge", autoMerge: false };

  assert.deepEqual(mergeApprovalForIssue(manualState, reviewIssue), {
    eligible: false,
    autoMerge: false,
    fromStatus: "status:needs-review",
  });
  assert.deepEqual(mergeApprovalForIssue(manualState, approvedIssue), {
    eligible: true,
    autoMerge: false,
    fromStatus: "status:approved-merge",
  });

  const globalAutoState = normalizeState({ autoMerge: true });
  assert.deepEqual(mergeApprovalForIssue(globalAutoState, reviewIssue), {
    eligible: true,
    autoMerge: true,
    fromStatus: "status:needs-review",
  });

  const perTicketIssue = { ...reviewIssue, autoMerge: true };
  assert.deepEqual(mergeApprovalForIssue(manualState, perTicketIssue), {
    eligible: true,
    autoMerge: true,
    fromStatus: "status:needs-review",
  });
});

test("merge attempts are recorded in monitor state and bridge audit", () => {
  const state = normalizeState({ autoMerge: true });
  const bridge = { target: "zenod-ai/zenod", exec: 93, mirrored: "needs-review" };
  const issue = { number: 58, title: "runner auto merge", target: "zenod-ai/zenod" };

  const entry = recordMergeAttempt(state, bridge, issue, {
    autoMerge: true,
    prUrl: "https://github.test/zenod-ai/zenod/pull/93",
    outcome: "update-branch",
    detail: "refreshing against main",
  });

  assert.equal(state.autoMerge, true);
  assert.equal(state.mergeAttempts.length, 1);
  assert.equal(state.mergeAttempts[0], entry);
  assert.equal(bridge.autoMerge, true);
  assert.deepEqual(bridge.mergeAttempts, [entry]);
  assert.equal(entry.outcome, "update-branch");
  assert.equal(entry.detail, "refreshing against main");
});

test("updateFanInBatches launches integration only after every branch reaches needs-review", () => {
  const state = normalizeState({});
  ensureFanInBatch(state, [41, 52]);
  const launches = [];
  const issues = [
    { number: 41, title: "fan-in", status: "status:needs-review" },
    { number: 52, title: "approval gate", status: "status:running" },
  ];

  updateFanInBatches(state, issues, {
    launchIntegration(batch, issuesByNumber) {
      launches.push({ batch, issuesByNumber });
    },
  });
  assert.equal(launches.length, 0);
  assert.equal(state.fanInBatches["41-52"].status, "waiting");

  issues[1].status = "status:needs-review";
  updateFanInBatches(state, issues, {
    launchIntegration(batch, issuesByNumber) {
      launches.push({ batch, titles: batch.issues.map((number) => issuesByNumber.get(number).title) });
      batch.status = "running";
    },
  });

  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].titles, ["fan-in", "approval gate"]);
  assert.equal(state.fanInBatches["41-52"].status, "running");
});

test("status:complete counts as a terminal fan-out state for fan-in scheduling", () => {
  const state = normalizeState({});
  ensureFanInBatch(state, [41, 52]);
  let launched = false;

  updateFanInBatches(
    state,
    [
      { number: 41, title: "fan-in", status: "status:needs-review" },
      { number: 52, title: "approval gate", status: "status:complete" },
    ],
    {
      launchIntegration(batch) {
        launched = true;
        batch.status = "running";
      },
    },
  );

  assert.equal(launched, true);
  assert.equal(state.fanInBatches["41-52"].status, "running");
});

test("blocked fan-out worker blocks the integration batch instead of dropping it", () => {
  const state = normalizeState({});
  ensureFanInBatch(state, [41, 52]);

  updateFanInBatches(state, [
    { number: 41, title: "fan-in", status: "status:needs-review" },
    { number: 52, title: "approval gate", status: "status:blocked" },
  ]);

  assert.equal(state.fanInBatches["41-52"].status, "blocked");
  assert.match(state.fanInBatches["41-52"].blocker, /blocked/);
});

test("running integration batches are classified from final handoff text", () => {
  const dir = mkdtempSync(join(tmpdir(), "zenod-monitor-"));
  const finalPath = join(dir, "final.md");
  writeFileSync(finalPath, 'Status: blocked\n\n```json\n{"status":"blocked","reason":"semantic-conflict"}\n```\n');
  const state = normalizeState({
    fanInBatches: {
      "41-52": { key: "41-52", issues: [41, 52], status: "running", finalPath },
    },
  });

  updateFanInBatches(state, []);

  assert.equal(state.fanInBatches["41-52"].status, "blocked");
  assert.equal(detectIntegrationStatus("Status: complete\n"), "complete");
  assert.equal(detectIntegrationStatus("Status: failed\n"), "failed");
});

test("review notifications are held for batches with an integration result", () => {
  const state = normalizeState({});
  const batch = ensureFanInBatch(state, [41, 52]);

  assert.equal(reviewHeldByFanInBatch(state, 41), true);
  batch.status = "complete";
  assert.equal(reviewHeldByFanInBatch(state, 41), true);
  batch.status = "blocked";
  assert.equal(reviewHeldByFanInBatch(state, 41), false);
});

test("integration prompt distinguishes textual and semantic conflicts and lists every branch", () => {
  const batch = {
    key: "41-52",
    issues: [41, 52],
    integrationBranch: "codex/integration-fanout-41-52",
    integrationWorktree: "/tmp/integration",
  };
  const prompt = integrationPrompt(batch, [
    { issue: 41, title: "fan-in", branch: "codex/issue-41-fan-in", prUrl: "https://github.test/pr/41" },
    { issue: 52, title: "approval", branch: "codex/issue-52-approval", prUrl: "https://github.test/pr/52" },
  ]);

  assert.match(prompt, /Merge branches in the exact order/);
  assert.match(prompt, /Do not drop, skip, squash away, or silently ignore any listed branch/);
  assert.match(prompt, /textual conflicts/i);
  assert.match(prompt, /semantic conflicts/i);
  assert.match(prompt, /codex\/issue-41-fan-in/);
  assert.match(prompt, /codex\/issue-52-approval/);
});
