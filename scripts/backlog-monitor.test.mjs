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
  mergeNoteDedupKey,
  normalizeState,
  notifyConfig,
  pickupNotification,
  primaryStatusLabel,
  recordMergeAttempt,
  reviewHeldByFanInBatch,
  shouldSendMergeNote,
  updateFanInBatches,
  parseTarget,
  workdirForRepo,
  dispatchedOutcome,
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

test("primaryStatusLabel prefers terminal worker state over stale proposed labels", () => {
  assert.equal(primaryStatusLabel(["status:proposed", "test", "status:complete"]), "status:complete");
  assert.equal(primaryStatusLabel(["status:proposed", "status:needs-review"]), "status:needs-review");
  assert.equal(primaryStatusLabel(["status:proposed", "status:running"]), "status:running");
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

test("conflict and CI-failure collapse to one alarm identity; distinct events keep theirs", () => {
  // "conflicting" and "CI failing" are the same actionable condition to the
  // owner — the PR can't merge and needs a human — so they share a dedup key.
  assert.equal(mergeNoteDedupKey("conflict"), "blocked");
  assert.equal(mergeNoteDedupKey("failed"), "blocked");
  // Genuinely distinct events keep their own identity.
  assert.equal(mergeNoteDedupKey("verify"), "verify");
  assert.equal(mergeNoteDedupKey("closed"), "closed");
  assert.equal(mergeNoteDedupKey("mergeerr"), "mergeerr");
});

test("a flapping blocked PR alarms once per cooldown, not on every reason change", () => {
  // Reproduces the real WhatsApp-spam: PR #112 re-pinged at 05:33 (conflict),
  // 12:59 (CI failing), 13:01 (conflict again) because GitHub's mergeable field
  // flapped. With the cooldown gate it must alarm exactly once.
  const bridge = { target: "zenod-ai/zenod", exec: 112, mirrored: "needs-review" };
  const HOUR = 60 * 60 * 1000;
  const cooldown = 12 * HOUR;
  const at = (h) => h * HOUR;

  // 05:33 — first discovery: CONFLICTING -> alarm fires.
  assert.equal(shouldSendMergeNote(bridge, "conflict", at(5.5), cooldown), true);
  // A transient UNKNOWN-mergeability "verify" tick is a distinct identity: it
  // pings once on its own, then goes quiet — and crucially it does NOT reset the
  // blocked alarm.
  assert.equal(shouldSendMergeNote(bridge, "verify", at(8), cooldown), true);
  assert.equal(shouldSendMergeNote(bridge, "verify", at(9), cooldown), false);
  // 12:59 — GitHub now reports CI failed (same "blocked" identity) -> suppressed.
  assert.equal(shouldSendMergeNote(bridge, "failed", at(13), cooldown), false);
  // 13:01 — flaps back to CONFLICTING -> still suppressed.
  assert.equal(shouldSendMergeNote(bridge, "conflict", at(13.03), cooldown), false);
  // Next day, still blocked -> one gentle reminder once the cooldown elapses
  // (measured from the last actual send at 05:33, not the suppressed flaps).
  assert.equal(shouldSendMergeNote(bridge, "conflict", at(18), cooldown), true);
});

test("merge-note cooldown state is per dedup key and persisted on the bridge", () => {
  const bridge = {};
  assert.equal(shouldSendMergeNote(bridge, "conflict", 1000, 10000), true);
  assert.equal(bridge.notifications.blocked, 1000);
  // A genuinely distinct event still pings even within another key's window.
  assert.equal(shouldSendMergeNote(bridge, "verify", 1500, 10000), true);
  assert.equal(bridge.notifications.verify, 1500);
});

test("merge-attempt audit is bounded so a long-blocked PR can't grow state without limit", () => {
  const state = normalizeState({ autoMerge: true });
  const bridge = { target: "zenod-ai/zenod", exec: 112, mirrored: "needs-review" };
  const issue = { number: 68, title: "blocked forever", target: "zenod-ai/zenod" };

  for (let i = 0; i < 1000; i++) {
    recordMergeAttempt(state, bridge, issue, { autoMerge: true, prUrl: "x", outcome: "failed", detail: String(i) });
  }

  // Both the global and per-bridge audit arrays are capped, not unbounded.
  assert.ok(state.mergeAttempts.length <= 200, `global capped, got ${state.mergeAttempts.length}`);
  assert.ok(bridge.mergeAttempts.length <= 30, `bridge capped, got ${bridge.mergeAttempts.length}`);
  // The TAIL is retained — the newest entry survives, the oldest is dropped.
  assert.equal(state.mergeAttempts[state.mergeAttempts.length - 1].detail, "999");
  assert.equal(bridge.mergeAttempts[bridge.mergeAttempts.length - 1].detail, "999");
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

// --- Execution lane (#194) ---

test("parseTarget splits owner/repo#N; rejects malformed", () => {
  assert.deepEqual(parseTarget("zenod-ai/zenod#42"), { repo: "zenod-ai/zenod", number: 42 });
  assert.deepEqual(parseTarget("AlfaBlok/obsidian-brain#7"), { repo: "AlfaBlok/obsidian-brain", number: 7 });
  assert.equal(parseTarget("zenod-ai/zenod"), null); // no #N
  assert.equal(parseTarget("#42"), null); // no repo
  assert.equal(parseTarget(""), null);
  assert.equal(parseTarget(null), null);
});

test("dispatchedOutcome maps target status to the exec-lane outcome (Epaminon's gate)", () => {
  // outward: a PR to merge parks at needs-review
  assert.deepEqual(dispatchedOutcome("status:needs-review", "https://pr/9"), {
    kind: "outcome",
    outward: true,
    evidenceUrl: "https://pr/9",
  });
  // complete WITH a PR is outward (reviewable); complete WITHOUT a PR is internal/done
  assert.deepEqual(dispatchedOutcome("status:complete", "https://pr/9"), {
    kind: "outcome",
    outward: true,
    evidenceUrl: "https://pr/9",
  });
  assert.deepEqual(dispatchedOutcome("status:complete", ""), { kind: "outcome", outward: false, evidenceUrl: "" });
  // blocked surfaces the blocker
  assert.deepEqual(dispatchedOutcome("status:blocked", ""), { kind: "blocked" });
  // not-terminal states keep watching
  assert.deepEqual(dispatchedOutcome("status:queued", ""), { kind: "none" });
  assert.deepEqual(dispatchedOutcome("status:running", ""), { kind: "none" });
  assert.deepEqual(dispatchedOutcome(null, ""), { kind: "none" });
});

test("normalizeState preserves the dispatched map (survives restart)", () => {
  const s = normalizeState({ dispatched: { "42": { repo: "o/r", issueN: 42, reportedStatus: null } } });
  assert.deepEqual(s.dispatched, { "42": { repo: "o/r", issueN: 42, reportedStatus: null } });
  assert.deepEqual(normalizeState({}).dispatched, {});
});

test("workdirForRepo keeps default repo stable and isolates cross-repo dispatches", () => {
  assert.equal(workdirForRepo("zenod-ai/zenod"), "/runner/work/zenod");
  assert.equal(workdirForRepo("AlfaBlok/obsidian-brain"), "/runner/work/AlfaBlok__obsidian-brain");
});

test("notifyConfig prefers Console notify route over legacy app URL", () => {
  assert.deepEqual(
    notifyConfig({
      ZENOD_APP_URL: "https://c1.zenod.dev/",
      ZENOD_API_TOKEN: "legacy",
      ZENOD_CONSOLE_URL: "http://zenod-console:8080",
      ZENOD_CONSOLE_TOKEN: "console",
    }),
    { url: "http://zenod-console:8080", token: "console" },
  );
});
