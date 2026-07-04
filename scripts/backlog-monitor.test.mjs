import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  batchKey,
  budgetKillDecision,
  parseRunBudget,
  detectIntegrationStatus,
  ephemeralResumeDecision,
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
  shouldBlockMergeGate,
  blockMergeGateIfNeeded,
  shouldSendMergeNote,
  updateFanInBatches,
  parseTarget,
  workdirForRepo,
  dispatchedOutcome,
  shouldReportEarlyLaunchExit,
  shouldNotifyOnExecutionStart,
  earlyLaunchFailureNote,
  launchLogPath,
  targetBootstrapLabels,
  parseEphemeralTarget,
  issueUrlFromTarget,
  resolvingLinkForRun,
  composeExecutionStartNotification,
  ephemeralFinalState,
  ephemeralFallbackDecision,
  ephemeralPrompt,
  extractEvidenceClaims,
  hasCheckableEvidence,
  pickEvidenceUrl,
  tailFile,
  isPidAlive,
  summarizeHandoff,
  mergeStateLine,
  composeTerminalNotification,
  hasVerifiableDeliverable,
  manifestEvidenceUrl,
  composeActionableMessage,
  composeBlockerNotification,
  parseDeliverables,
  formatElapsed,
  derivePhase,
  phaseSummary,
  parseHeartbeatObservation,
  heartbeatStalled,
  renderHeartbeat,
  shouldUpdateHeartbeat,
  heartbeatMilestone,
  heartbeatIssueRef,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALL_MS,
  HEARTBEAT_LONGRUN_MS,
  HEARTBEAT_MARKER,
  wantsHoldForReview,
  declaresNoDeliverableExpected,
  repoFromPrUrl,
  enableAutoMergeForPr,
} from "./backlog-monitor.mjs";

test("fan-in batch keys are deterministic by issue number", () => {
  assert.equal(batchKey([52, 41, 7]), "7-41-52");
});

// --- "Merge by default" for one-off executions (controller-enforced) ---

test("merge-by-default: a normal task with a verified PR gets `gh pr merge --auto --squash`", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = enableAutoMergeForPr("https://github.com/AlfaBlok/zenod/pull/7", { hold: false, runner });
  assert.equal(r.outcome, "enabled");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "pr",
    "merge",
    "https://github.com/AlfaBlok/zenod/pull/7",
    "-R",
    "AlfaBlok/zenod",
    "--auto",
    "--squash",
  ]);
});

test("opt-out: HOLD-FOR-REVIEW suppresses auto-merge and makes no gh call", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = enableAutoMergeForPr("https://github.com/AlfaBlok/zenod/pull/7", { hold: true, runner });
  assert.equal(r.outcome, "held");
  assert.equal(calls.length, 0, "no gh pr merge is issued when the task opted out");
});

test("no-verifiable-PR: auto-merge is skipped and logged, never guessed", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  const r = enableAutoMergeForPr("", { hold: false, runner });
  assert.equal(r.outcome, "no-pr");
  assert.match(r.detail, /no verifiable PR; auto-merge skipped/);
  assert.equal(calls.length, 0);
  // a non-PR URL (e.g. a bare commit link) is also not a mergeable PR
  const r2 = enableAutoMergeForPr("https://github.com/AlfaBlok/zenod/commit/abc1234", { runner });
  assert.equal(r2.outcome, "no-pr");
  assert.equal(calls.length, 0);
});

test("already-merged PR is reported, not failed", () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "Pull request is already merged" });
  const r = enableAutoMergeForPr("https://github.com/AlfaBlok/zenod/pull/7", { runner });
  assert.equal(r.outcome, "already-merged");
});

test("gh failure surfaces as a failed outcome with detail", () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "auto-merge is not allowed for this repository" });
  const r = enableAutoMergeForPr("https://github.com/AlfaBlok/zenod/pull/7", { runner });
  assert.equal(r.outcome, "failed");
  assert.match(r.detail, /auto-merge is not allowed/);
});

test("wantsHoldForReview detects explicit opt-out markers only", () => {
  assert.equal(wantsHoldForReview("Artifact policy: HOLD-FOR-REVIEW keep it open"), true);
  assert.equal(wantsHoldForReview("please set noAutoMerge on this one"), true);
  assert.equal(wantsHoldForReview("no-auto-merge"), true);
  assert.equal(wantsHoldForReview("Just open one PR against main"), false);
  assert.equal(wantsHoldForReview(""), false);
  assert.equal(wantsHoldForReview(undefined), false);
});

test("repoFromPrUrl extracts owner/repo from a PR URL", () => {
  assert.equal(repoFromPrUrl("https://github.com/AlfaBlok/idea_scraper/pull/106"), "AlfaBlok/idea_scraper");
  assert.equal(repoFromPrUrl("https://github.com/a/b/issues/1"), null);
  assert.equal(repoFromPrUrl(""), null);
});

test("composeBlockerNotification never truncates the actionable question (R2-T4)", () => {
  const question =
    "This fan-out worker is not the VPS container: no SSH route to hetzner_vps_1, no bot secrets (TELEGRAM/OPENROUTER/OPENAI/PG/DuckDB path all unset), no docker/Dokploy, and warehouse_read.duckdb is absent. How should the agent be given host access?";
  const msg = composeBlockerNotification({ executionId: "direct-102", target: "AlfaBlok/idea_scraper#102", question });
  // The full question survives (the old .slice(0,280) cut it at "(TELEGRA").
  assert.ok(msg.includes(question), "full blocker question is present");
  assert.ok(msg.includes("(TELEGRAM/OPENROUTER/OPENAI/PG/DuckDB path all unset)"), "the truncated clause is now intact");
  assert.ok(msg.includes("direct-102"), "execution id demoted to metadata suffix");
});

test("composeActionableMessage guarantees actionable ⊆ composed for arbitrary lengths (R2-T4)", () => {
  for (const n of [1, 50, 300, 2000, 5000]) {
    const actionable = "Q".repeat(n);
    const summary = "S".repeat(400);
    const composed = composeActionableMessage({ header: "H", actionable, summary, metadata: "id-1" }, 3500);
    assert.ok(composed.includes(actionable), `actionable of length ${n} must be fully present`);
  }
  // Lower tiers yield first: a huge actionable pushes the summary out, but never itself.
  const composed = composeActionableMessage({ header: "H", actionable: "A".repeat(3600), summary: "SUM", metadata: "META" }, 3500);
  assert.ok(composed.includes("A".repeat(3600)));
  assert.ok(!composed.includes("SUM"), "summary dropped when actionable exceeds budget");
});

test("parseDeliverables reads the reportback block and handles none (R1-T4)", () => {
  const comment = [
    "Fan-out run `r` finished for #5.",
    "Status: `complete`",
    "Branch: `br`",
    "",
    "Deliverables:",
    "- src/a.ts",
    "- docs/b.md",
    "",
    "Worker handoff excerpt:",
    "did stuff",
  ].join("\n");
  assert.deepEqual(parseDeliverables(comment), ["src/a.ts", "docs/b.md"]);
  assert.deepEqual(parseDeliverables("Status: `complete`\n\nDeliverables: none\n\nWorker handoff excerpt:"), []);
  assert.deepEqual(parseDeliverables("no block here"), []);
});

test("summarizeHandoff strips the status line and headers and caps length (R1-T6)", () => {
  assert.equal(
    summarizeHandoff("Status: complete\n# Result\nProduced the decision matrix and opened a draft PR."),
    "Result Produced the decision matrix and opened a draft PR.",
  );
  assert.equal(summarizeHandoff(""), "");
  const long = summarizeHandoff("x".repeat(500), 100);
  assert.ok(long.length <= 100 && long.endsWith("…"));
});

test("mergeStateLine is honest about unmerged drafts (R1-T6)", () => {
  assert.equal(mergeStateLine({ merged: true, prUrl: "https://x/pull/1" }), "merged to main");
  assert.equal(mergeStateLine({ merged: false, prUrl: "https://x/pull/1" }), "PR open — not merged yet");
  assert.equal(mergeStateLine({}), "completed (no PR — filed artifact)");
});

test("composeTerminalNotification carries title, summary, honest state, link (R1-T6)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-123",
    target: "AlfaBlok/idea_scraper#105",
    outward: true,
    title: "Legal/commercial decision matrix",
    manifest: {
      prUrl: "https://github.com/AlfaBlok/idea_scraper/pull/106",
      merged: false,
      handoffExcerpt: "Status: complete\nProduced the matrix; opened a draft PR for review.",
    },
  });
  assert.ok(msg.includes("Legal/commercial decision matrix"), "has issue title");
  assert.ok(msg.includes("Produced the matrix"), "has handoff summary");
  assert.ok(msg.includes("not merged yet"), "states honest unmerged state");
  assert.ok(msg.includes("https://github.com/AlfaBlok/idea_scraper/pull/106"), "has PR link");
  assert.ok(msg.includes("direct-123"), "keeps execution id as suffix");
});

test("composeTerminalNotification stays plain for internal (non-outward) done with a real deliverable (R1-T6)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-9",
    target: "o/r#7",
    outward: false,
    title: "Filed note",
    manifest: { repo: "o/r", issue: 7, paths: ["Areas/Note.md"] },
  });
  assert.ok(msg.startsWith("✅ Execution done: o/r#7"));
  assert.ok(msg.includes("Filed note"));
});

test("composeTerminalNotification refuses to render done with nothing verifiable behind it (M-2, the banana9 bug)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-9",
    target: "o/r#7",
    outward: false,
    title: "Filed note",
    manifest: null,
  });
  assert.ok(!msg.includes("✅"), "never renders the done checkmark with no evidence");
  assert.ok(msg.startsWith("Finished but produced nothing verifiable — treating as failed"));
  assert.ok(msg.includes("o/r#7"));
  assert.ok(msg.includes("direct-9"));
});

test("composeTerminalNotification refuses done for a manifest with only repo/issue pointers, no paths/PR/commit (M-2)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-10",
    target: "o/r#8",
    outward: false,
    title: undefined,
    manifest: { repo: "o/r", issue: 8, handoffExcerpt: "Created the issue as requested." },
  });
  assert.ok(!msg.includes("✅"));
  assert.ok(msg.startsWith("Finished but produced nothing verifiable — treating as failed"));
});

// P-2 — the #479 replay: the M-2 completion verifier (hasVerifiableDeliverable) had its
// own evidence check, separate from the I5-2 deliverable parser (extractEvidenceClaims/
// hasCheckableEvidence) that already recognized issue URLs — so a genuinely created
// issue's URL sitting right in the worker's handoff comment still rendered as failed.
// Both now share the same extractor.
test("hasVerifiableDeliverable recognizes an issue URL in the handoff text, not just prUrl/headSha/paths (P-2, the #479 replay)", () => {
  const manifest = {
    repo: "zenod-ai/zenod",
    issue: 480,
    handoffExcerpt:
      "Status: complete\n\nCreated the issue banana9 with a comment banana8 as requested.\n\n" +
      "Created issue: https://github.com/zenod-ai/zenod/issues/479",
  };
  assert.equal(hasVerifiableDeliverable(manifest), true);
  assert.equal(manifestEvidenceUrl(manifest), "https://github.com/zenod-ai/zenod/issues/479");
});

test("composeTerminalNotification renders done WITH the issue URL as evidence (P-2, the #479 replay)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-479",
    target: "zenod-ai/zenod#480",
    outward: false,
    title: undefined,
    manifest: {
      repo: "zenod-ai/zenod",
      issue: 480,
      handoffExcerpt:
        "Status: complete\n\nCreated the issue banana9 with a comment banana8 as requested.\n\n" +
        "Created issue: https://github.com/zenod-ai/zenod/issues/479",
    },
  });
  assert.ok(msg.startsWith("✅ Execution done"));
  assert.ok(msg.includes("https://github.com/zenod-ai/zenod/issues/479"), "shows the created issue URL as evidence");
});

test("a run with genuinely no deliverable still renders the honest failed-to-produce message (P-2 regression guard)", () => {
  const msg = composeTerminalNotification({
    executionId: "direct-481",
    target: "zenod-ai/zenod#481",
    outward: false,
    title: undefined,
    manifest: { repo: "zenod-ai/zenod", issue: 481, handoffExcerpt: "Status: complete\n\nLooked into it but there was nothing to do." },
  });
  assert.ok(!msg.includes("✅"));
  assert.ok(msg.startsWith("Finished but produced nothing verifiable — treating as failed"));
});

test("pickup notification labels the worker by engine (default Claude) with issue title and repo", () => {
  assert.equal(
    pickupNotification({ number: 56, title: "Work-started visibility", target: "zenod-ai/zenod" }),
    "🤖 Claude working on #56 — Work-started visibility (zenod-ai/zenod)",
  );
});

test("direct execution pickup notification can be suppressed for terminal-only notification requests", () => {
  assert.equal(shouldNotifyOnExecutionStart({}), true);
  assert.equal(shouldNotifyOnExecutionStart({ notify_on_start: true }), true);
  assert.equal(shouldNotifyOnExecutionStart({ notify_on_start: false }), false);
});

test("primaryStatusLabel prefers terminal worker state over stale proposed labels", () => {
  assert.equal(primaryStatusLabel(["status:proposed", "test", "status:complete"]), "status:complete");
  assert.equal(primaryStatusLabel(["status:proposed", "status:needs-review"]), "status:needs-review");
  assert.equal(primaryStatusLabel(["status:proposed", "status:running"]), "status:running");
});

test("target bootstrap labels repair owner and only add queued when no status exists", () => {
  assert.deepEqual(targetBootstrapLabels([]), ["owner:agent", "status:queued"]);
  assert.deepEqual(targetBootstrapLabels(["status:proposed"]), ["owner:agent"]);
  assert.deepEqual(targetBootstrapLabels(["owner:agent"]), ["status:queued"]);
  assert.deepEqual(targetBootstrapLabels(["owner:agent", "status:running"]), []);
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

test("hard merge blockers move manual approved-merge tickets out of the merge loop", () => {
  const manualApproval = mergeApprovalForIssue(
    normalizeState({}),
    { number: 68, title: "manual merge", status: "status:approved-merge", autoMerge: false },
  );
  assert.equal(shouldBlockMergeGate(manualApproval, "status:approved-merge"), true);

  const plainReview = mergeApprovalForIssue(
    normalizeState({}),
    { number: 69, title: "review only", status: "status:needs-review", autoMerge: false },
  );
  assert.equal(shouldBlockMergeGate(plainReview, "status:needs-review"), false);

  const autoApproval = mergeApprovalForIssue(
    normalizeState({ autoMerge: true }),
    { number: 70, title: "auto merge", status: "status:needs-review", autoMerge: false },
  );
  assert.equal(shouldBlockMergeGate(autoApproval, "status:needs-review"), true);
});

test("hard merge blockers update status even when the notification is on cooldown", () => {
  const bridge = { notifications: { blocked: 1000 } };
  const issue = { number: 68, title: "manual merge", status: "status:approved-merge", autoMerge: false };
  const approval = mergeApprovalForIssue(normalizeState({}), issue);
  const calls = [];

  const blocked = blockMergeGateIfNeeded(approval, issue, (...args) => calls.push(args));

  assert.equal(blocked, true);
  assert.equal(issue.status, "status:blocked");
  assert.deepEqual(calls, [[68, "status:approved-merge", "status:blocked"]]);
  assert.equal(shouldSendMergeNote(bridge, "conflict", 1500, 10000), false);
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

test("normalizeState preserves ephemeral execution state (survives restart)", () => {
  const s = normalizeState({
    ephemeral: {
      "ephemeral-1": {
        target: "ephemeral:ephemeral-1",
        finalPath: "/tmp/final.md",
        reportedStatus: "complete",
      },
    },
  });
  assert.equal(s.ephemeral["ephemeral-1"].reportedStatus, "complete");
  assert.equal(s.ephemeral["ephemeral-1"].target, "ephemeral:ephemeral-1");
  assert.deepEqual(normalizeState({}).ephemeral, {});
});

test("parseEphemeralTarget accepts only ephemeral execution ids", () => {
  assert.deepEqual(parseEphemeralTarget("ephemeral:ephemeral-123_abc"), { executionId: "ephemeral-123_abc" });
  assert.equal(parseEphemeralTarget("AlfaBlok/obsidian-brain#173"), null);
  assert.equal(parseEphemeralTarget("ephemeral:"), null);
});

test("ephemeralFinalState trusts the final Status line and falls back to exit code", () => {
  assert.equal(ephemeralFinalState(0, "Status: complete\nSummary: done"), "complete");
  assert.equal(ephemeralFinalState(0, "Status: blocked\nQuestion: need input"), "blocked");
  assert.equal(ephemeralFinalState(0, "Status: failed\n"), "failed");
  assert.equal(ephemeralFinalState(0, "no status line"), "complete");
  assert.equal(ephemeralFinalState(1, "no status line"), "failed");
});

test("ephemeralPrompt forbids default GitHub issue side effects and requires a status line", () => {
  const prompt = ephemeralPrompt("ephemeral-1", "Objective: summarize this");
  assert.match(prompt, /do not create, edit, close, or run a GitHub issue unless the user explicitly asked/);
  assert.match(prompt, /Status: complete/);
  assert.match(prompt, /Objective: summarize this/);
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

test("early launch exit detection reports immediate nonzero child exits only", () => {
  assert.equal(shouldReportEarlyLaunchExit(1, 250), true);
  assert.equal(shouldReportEarlyLaunchExit(null, 250), true);
  assert.equal(shouldReportEarlyLaunchExit(0, 250), false);
  assert.equal(shouldReportEarlyLaunchExit(1, 45_000, 30_000), false);
});

test("normalizeState preserves pendingReports (undelivered outcomes survive restart)", () => {
  const s = normalizeState({
    pendingReports: { "/api/exec/blocked|ephemeral-9": { path: "/api/exec/blocked", body: { execution_id: "ephemeral-9" } } },
  });
  assert.equal(s.pendingReports["/api/exec/blocked|ephemeral-9"].path, "/api/exec/blocked");
  assert.deepEqual(normalizeState({}).pendingReports, {});
});

test("extractEvidenceClaims pulls distinct commit and PR URLs from a final handoff", () => {
  const text = [
    "Status: complete",
    "Pushed commit: https://github.com/AlfaBlok/idea_scraper/commit/2ff0dfd17e6c2e72fe4738a06f2b9081d820a25e",
    "see also (https://github.com/AlfaBlok/idea_scraper/pull/42).",
    "duplicate https://github.com/AlfaBlok/idea_scraper/commit/2ff0dfd17e6c2e72fe4738a06f2b9081d820a25e",
  ].join("\n");
  const claims = extractEvidenceClaims(text);
  assert.deepEqual(claims.commitUrls, ["https://github.com/AlfaBlok/idea_scraper/commit/2ff0dfd17e6c2e72fe4738a06f2b9081d820a25e"]);
  assert.deepEqual(claims.prUrls, ["https://github.com/AlfaBlok/idea_scraper/pull/42"]);
});

test("extractEvidenceClaims returns nothing for a bare SHA with no URL (the hallucination case)", () => {
  // The run that fabricated `f5726dbc…` reported only a bare SHA — nothing verifiable,
  // so it cannot be accepted as evidence and the note must flag it as unverified.
  const claims = extractEvidenceClaims("Status: complete\nFinal commit SHA: f5726dbccd829b2be37da1d9d806f0335fbc6b37");
  assert.deepEqual(claims.commitUrls, []);
  assert.deepEqual(claims.prUrls, []);
  assert.deepEqual(claims.issueUrls, []);
});

// I5-2: iteration-4's E-4 worker dispatched cleanly for an issue-creation task but the
// evidence contract only recognized commit/PR URLs, so a real created issue still read
// as "evidence: unverified — no commit/PR URL". An issue URL must be recognized and
// pass the same claim/verify/deliverable path as a commit or PR.
test("extractEvidenceClaims pulls a distinct issue URL from a final handoff (I5-2)", () => {
  const text = [
    "Status: complete",
    "Created the issue: https://github.com/zenod-ai/zenod/issues/842",
    "duplicate https://github.com/zenod-ai/zenod/issues/842",
  ].join("\n");
  const claims = extractEvidenceClaims(text);
  assert.deepEqual(claims.issueUrls, ["https://github.com/zenod-ai/zenod/issues/842"]);
  assert.deepEqual(claims.commitUrls, []);
  assert.deepEqual(claims.prUrls, []);
});

test("hasCheckableEvidence treats a bare issue URL as checkable (I5-2)", () => {
  assert.equal(hasCheckableEvidence({ commitUrls: [], prUrls: [], issueUrls: ["https://github.com/a/b/issues/1"] }), true);
  assert.equal(hasCheckableEvidence({ commitUrls: [], prUrls: [], issueUrls: [] }), false);
});

test("pickEvidenceUrl prefers PR, then commit, then falls back to a bare issue URL (I5-2)", () => {
  const pr = "https://github.com/a/b/pull/1";
  const commit = "https://github.com/a/b/commit/abc1234";
  const issue = "https://github.com/a/b/issues/9";
  assert.equal(pickEvidenceUrl([issue, commit, pr]), pr);
  assert.equal(pickEvidenceUrl([issue, commit]), commit);
  // An issue-creation task has ONLY an issue URL — it must still be reported as the
  // deliverable, not dropped in favor of nothing.
  assert.equal(pickEvidenceUrl([issue]), issue);
});

test("tailFile returns the trailing diagnostic bytes (or empty for a missing file)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tail-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(p, "line one\nERROR something exploded\n");
  assert.match(tailFile(p), /something exploded/);
  assert.equal(tailFile(join(dir, "nope.jsonl")), "");
  writeFileSync(p, "x".repeat(50));
  assert.equal(tailFile(p, 10).startsWith("…"), true); // truncation marker when clipped
});

test("isPidAlive reports the current process alive and a bogus pid dead", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(2147483646), false); // implausibly high pid → ESRCH
});

test("early launch failure note includes target and runner log path", () => {
  const logPath = launchLogPath("zenod-ai/zenod", 296, 123);
  assert.match(logPath, /launch-123-zenod-ai-zenod-296\.log$/);
  assert.match(
    earlyLaunchFailureNote("zenod-ai/zenod", 296, 1, null, logPath),
    /fanout launcher for zenod-ai\/zenod#296 stopped immediately with exit code 1; see runner log .*296\.log/,
  );
});

// --- E-2: engine quota fallback ported to the ephemeral spawn path (mirrors W0) ---

// The exact Codex usage-limit error W0 replays (see fanout-codex.test.mjs #92 case).
const CODEX_QUOTA_ERROR =
  "You've hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Jul 26th, 2026 7:56 AM.";

test("ephemeralFallbackDecision replays the real Codex quota error on the other engine (W0 port)", () => {
  const d = ephemeralFallbackDecision({
    exitCode: 1,
    rawError: CODEX_QUOTA_ERROR,
    engine: "codex",
    alreadyFellBack: false,
    hasCommand: (c) => c === "claude", // claude CLI is installed
  });
  assert.deepEqual(d, { fallback: true, nextEngine: "claude" });
});

test("ephemeralFallbackDecision swaps claude→codex on a Claude billing failure", () => {
  const d = ephemeralFallbackDecision({
    exitCode: 1,
    rawError: "billing_error: Your credit balance is too low",
    engine: "claude",
    alreadyFellBack: false,
    hasCommand: () => true,
  });
  assert.deepEqual(d, { fallback: true, nextEngine: "codex" });
});

test("ephemeralFallbackDecision does NOT replay when the other engine's CLI is missing", () => {
  const d = ephemeralFallbackDecision({
    exitCode: 1,
    rawError: CODEX_QUOTA_ERROR,
    engine: "codex",
    alreadyFellBack: false,
    hasCommand: () => false, // no other CLI installed
  });
  assert.equal(d.fallback, false);
});

test("ephemeralFallbackDecision replays AT MOST ONCE (hard stop on second attempt)", () => {
  const d = ephemeralFallbackDecision({
    exitCode: 1,
    rawError: CODEX_QUOTA_ERROR,
    engine: "claude",
    alreadyFellBack: true, // already swapped once
    hasCommand: () => true,
  });
  assert.equal(d.fallback, false);
});

test("ephemeralFallbackDecision ignores non-quota failures and clean exits", () => {
  assert.equal(
    ephemeralFallbackDecision({ exitCode: 1, rawError: "git push failed: permission denied", engine: "codex", alreadyFellBack: false, hasCommand: () => true }).fallback,
    false,
  );
  assert.equal(
    ephemeralFallbackDecision({ exitCode: 0, rawError: null, engine: "codex", alreadyFellBack: false, hasCommand: () => true }).fallback,
    false,
  );
});

test("ephemeralFallbackDecision recognizes 429 / insufficient_quota classes (parity with fanout)", () => {
  for (const err of ["429 Too Many Requests", "insufficient_quota: you exceeded your quota", "rate limit reached, retry later"]) {
    assert.equal(
      ephemeralFallbackDecision({ exitCode: 1, rawError: err, engine: "codex", alreadyFellBack: false, hasCommand: () => true }).fallback,
      true,
      `expected fallback for: ${err}`,
    );
  }
});

test("#506: ephemeralFallbackDecision replays an out-of-credits rate_limit death on the other engine", () => {
  // The captured form of the exact 5-hour-cap rate_limit_event that died exit 1.
  const err = "rate_limit_event rejected: five_hour out_of_credits resetsAt=1783114200";
  const d = ephemeralFallbackDecision({ exitCode: 1, rawError: err, engine: "claude", alreadyFellBack: false, hasCommand: (c) => c === "codex" });
  assert.deepEqual(d, { fallback: true, nextEngine: "codex" });
  // both engines dry → no fallback (the paused-not-die path takes over in reportEphemeralFinished)
  assert.equal(ephemeralFallbackDecision({ exitCode: 1, rawError: err, engine: "claude", alreadyFellBack: false, hasCommand: () => false }).fallback, false);
});

// ---- Live-progress heartbeat (execution-progress campaign) ----

test("formatElapsed renders compact human durations", () => {
  assert.equal(formatElapsed(38_000), "38s");
  assert.equal(formatElapsed(42 * 60_000), "42m");
  assert.equal(formatElapsed(65 * 60_000), "1h05m");
});

test("parseHeartbeatObservation derives turns + last tool from a codex event stream (controller-observed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-codex-"));
  const path = join(dir, "events.jsonl");
  writeFileSync(
    path,
    [
      JSON.stringify({ type: "turn.started", timestamp: "2026-07-03T10:00:00Z" }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test" }, timestamp: "2026-07-03T10:00:10Z" }),
      JSON.stringify({ type: "item.completed", item: { type: "tool_call", name: "edit_file" }, timestamp: "2026-07-03T10:01:00Z" }),
      // A worker-prose line claiming progress must NOT be treated as a turn/tool signal.
      JSON.stringify({ type: "item.completed", item: { type: "assistant_message", text: "I'm about 50% done!" }, timestamp: "2026-07-03T10:01:30Z" }),
      "not json — ignored",
    ].join("\n") + "\n",
  );
  const obs = parseHeartbeatObservation(path, Date.parse("2026-07-03T10:02:00Z"));
  assert.equal(obs.turns, 1, "one turn.started");
  assert.equal(obs.toolCalls, 2, "command + tool_call counted, prose not");
  assert.equal(obs.lastEvent, "assistant_message", "last observed structural event");
  assert.deepEqual(
    obs.recentEvents,
    ["turn.started", "npm test", "edit_file", "assistant_message"],
    "rolling trail of the last observed event labels (S-1)",
  );
  assert.equal(obs.lastActivityMs, Date.parse("2026-07-03T10:01:30Z"), "last activity from the final parseable line");
});

test("parseHeartbeatObservation handles claude stream-json turns + tool_use", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-claude-"));
  const path = join(dir, "events.jsonl");
  writeFileSync(
    path,
    [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] }, timestamp: "2026-07-03T10:00:00Z" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] }, timestamp: "2026-07-03T10:00:30Z" }),
    ].join("\n") + "\n",
  );
  const obs = parseHeartbeatObservation(path, Date.parse("2026-07-03T10:01:00Z"));
  assert.equal(obs.turns, 2, "two assistant turns");
  assert.equal(obs.toolCalls, 1, "one tool_use");
  assert.equal(obs.lastEvent, "Edit");
});

test("parseHeartbeatObservation zeroes out for a missing log (degrade-safe)", () => {
  const obs = parseHeartbeatObservation("/no/such/events.jsonl", 1000);
  assert.deepEqual(obs, { turns: 0, toolCalls: 0, lastEvent: "", lastPartial: "", lastActivityMs: null, recentEvents: [] });
});

test("heartbeatStalled flips only after the threshold, and never on unknown activity", () => {
  const now = 1_000_000;
  assert.equal(heartbeatStalled(now - 5 * 60_000, now, 10 * 60_000), false, "5m < 10m threshold");
  assert.equal(heartbeatStalled(now - 11 * 60_000, now, 10 * 60_000), true, "11m > 10m threshold");
  assert.equal(heartbeatStalled(null, now, 10 * 60_000), false, "unknown → not stalled (no false alarm)");
});

test("renderHeartbeat carries controller-observed fields + the edit-in-place marker", () => {
  const body = renderHeartbeat({ elapsedMs: 42 * 60_000, turns: 187, toolCalls: 40, lastEvent: "edit_file", stalled: false, now: 0 });
  assert.ok(body.startsWith(HEARTBEAT_MARKER), "hidden marker enables edit-in-place lookup");
  assert.ok(body.includes("42m elapsed"), "elapsed");
  assert.ok(body.includes("187 turns"), "turn count");
  assert.ok(body.includes("last: edit_file"), "last observed tool");
  assert.ok(body.includes("no terminal yet"), "honest non-terminal state");
  assert.ok(body.includes("not worker self-report"), "provenance disclaimer");
});

test("renderHeartbeat flips to a stalled warning when quiet (watchdog reuse)", () => {
  const body = renderHeartbeat({ elapsedMs: 61 * 60_000, turns: 187, lastEvent: "edit_file", stalled: true, staleMs: 12 * 60_000, now: 0 });
  assert.ok(body.includes("⚠️ Possibly stalled"), "stalled lead");
  assert.ok(body.includes("no activity for 12m"), "stale duration");
});

test("shouldUpdateHeartbeat: first post, interval gate, and immediate state-flip", () => {
  const now = 10_000_000;
  assert.equal(shouldUpdateHeartbeat(null, now, false, HEARTBEAT_INTERVAL_MS), true, "first post");
  assert.equal(shouldUpdateHeartbeat({ lastPostedAt: now - 1000, stalled: false }, now, false, HEARTBEAT_INTERVAL_MS), false, "within interval → skip (no comment spam)");
  assert.equal(shouldUpdateHeartbeat({ lastPostedAt: now - HEARTBEAT_INTERVAL_MS, stalled: false }, now, false, HEARTBEAT_INTERVAL_MS), true, "interval elapsed → update");
  assert.equal(shouldUpdateHeartbeat({ lastPostedAt: now - 1000, stalled: false }, now, true, HEARTBEAT_INTERVAL_MS), true, "stalled flip lands immediately");
});

test("heartbeatMilestone fires start/longrun/stalled once each — never per interval", () => {
  // start fires first, once
  assert.equal(heartbeatMilestone({ elapsedMs: 60_000, stalled: false, fired: {} }, HEARTBEAT_LONGRUN_MS), "start");
  assert.equal(heartbeatMilestone({ elapsedMs: 60_000, stalled: false, fired: { start: "x" } }, HEARTBEAT_LONGRUN_MS), null, "no repeat ping mid-run");
  // longrun fires once the 30m mark is crossed, after start
  assert.equal(heartbeatMilestone({ elapsedMs: 31 * 60_000, stalled: false, fired: { start: "x" } }, 30 * 60_000), "longrun");
  assert.equal(heartbeatMilestone({ elapsedMs: 45 * 60_000, stalled: false, fired: { start: "x", longrun: "x" } }, 30 * 60_000), null, "longrun only once");
  // stalled takes priority and fires once
  assert.equal(heartbeatMilestone({ elapsedMs: 45 * 60_000, stalled: true, fired: { start: "x", longrun: "x" } }, 30 * 60_000), "stalled");
  assert.equal(heartbeatMilestone({ elapsedMs: 45 * 60_000, stalled: true, fired: { start: "x", longrun: "x", stalled: "x" } }, 30 * 60_000), null, "stalled only once");
});

test("heartbeatIssueRef resolves a dispatched target, an in-context issue URL, else null", () => {
  assert.deepEqual(heartbeatIssueRef({ target: "zenod-ai/zenod#476" }), { repo: "zenod-ai/zenod", number: 476 });
  assert.deepEqual(
    heartbeatIssueRef({ target: "ephemeral:abc-123", context: "see https://github.com/zenod-ai/zenod/issues/512 for scope" }),
    { repo: "zenod-ai/zenod", number: 512 },
  );
  assert.equal(heartbeatIssueRef({ target: "ephemeral:abc-123", context: "no ticket here" }), null, "degrade gracefully — no issue");
});

// ---- F-1 (C-08): every start notification carries a resolving link ----

test("issueUrlFromTarget resolves a dispatched target to its issue URL, null for ephemeral", () => {
  assert.equal(issueUrlFromTarget("zenod-ai/zenod#476"), "https://github.com/zenod-ai/zenod/issues/476");
  assert.equal(issueUrlFromTarget("ephemeral:abc-123"), null);
  assert.equal(issueUrlFromTarget(""), null);
});

test("resolvingLinkForRun prefers the target ticket, else an in-context issue URL, else null", () => {
  // dispatched run — the target IS the link
  assert.equal(resolvingLinkForRun({ target: "owner/repo#7" }), "https://github.com/owner/repo/issues/7");
  // issue-less ephemeral whose context embeds a tracking issue URL
  assert.equal(
    resolvingLinkForRun({ target: "ephemeral:xyz", context: "Tracking issue: https://github.com/zenod-ai/zenod/issues/900." }),
    "https://github.com/zenod-ai/zenod/issues/900",
  );
  // genuinely issue-less ephemeral — caller must mint one
  assert.equal(resolvingLinkForRun({ target: "ephemeral:xyz", context: "just do the thing" }), null);
});

test("composeExecutionStartNotification ALWAYS includes the link when one is resolvable (C-08)", () => {
  const dispatched = composeExecutionStartNotification({
    executionId: "e-1",
    target: "owner/repo#7",
    link: resolvingLinkForRun({ target: "owner/repo#7" }),
    worker: "Epaminon",
  });
  assert.ok(dispatched.includes("https://github.com/owner/repo/issues/7"), "dispatched start ping resolves");

  // issue-less ephemeral: once a tracking issue is minted the ping resolves too
  const ephemeral = composeExecutionStartNotification({
    executionId: "e-2",
    target: "ephemeral:xyz",
    link: "https://github.com/zenod-ai/zenod/issues/901",
    worker: "Epaminon",
  });
  assert.ok(ephemeral.includes("https://github.com/zenod-ai/zenod/issues/901"), "ephemeral start ping resolves via tracking issue");
});

// ---- F-2 (C-09): heartbeat phase/partials + mid-run status ----

test("derivePhase maps the last observed tool to a coarse phase (never worker self-report)", () => {
  assert.equal(derivePhase("apply_patch"), "editing");
  assert.equal(derivePhase("str_replace_editor"), "editing");
  assert.equal(derivePhase("grep"), "exploring");
  assert.equal(derivePhase("read_file"), "exploring");
  assert.equal(derivePhase("npm test"), "testing");
  assert.equal(derivePhase("git commit"), "committing");
  assert.equal(derivePhase("gh pr create"), "reviewing");
  assert.equal(derivePhase(""), "starting up");
  assert.equal(derivePhase("some_unknown_tool"), "working");
});

test("parseHeartbeatObservation captures a coarse last-partial from assistant/message text", () => {
  const dir = mkdtempSync(join(tmpdir(), "hb-partial-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(
    p,
    [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Refactoring the auth guard now" }] } }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test" } }),
    ].join("\n"),
  );
  const obs = parseHeartbeatObservation(p, 1000);
  assert.equal(obs.lastPartial, "Refactoring the auth guard now");
  assert.equal(derivePhase(obs.lastEvent), "testing", "phase reflects the LAST observed tool");
});

test("renderHeartbeat leads with the phase and surfaces the last partial (C-09, not just turns)", () => {
  const body = renderHeartbeat({
    elapsedMs: 42 * 60_000,
    turns: 187,
    toolCalls: 40,
    lastEvent: "apply_patch",
    lastPartial: "wiring the new endpoint",
    stalled: false,
    now: 0,
  });
  assert.ok(body.includes("editing"), "phase is present, derived from apply_patch");
  assert.ok(body.includes("wiring the new endpoint"), "last partial is surfaced");
  assert.ok(body.includes("42m elapsed"));
});

test("phaseSummary is a compact phase+elapsed line for the mid-run channel update (C-09)", () => {
  const line = phaseSummary({ elapsedMs: 65 * 60_000, phase: "testing", turns: 90, lastEvent: "npm test", lastPartial: "running the suite" });
  assert.ok(line.startsWith("testing · 1h05m elapsed"));
  assert.ok(line.includes("90 turns"));
  assert.ok(line.includes("running the suite"));
});

// ---- #485 / C-07c: declared-no-deliverable smoke runs complete, never fail ----

test("declaresNoDeliverableExpected detects a smoke/no-op policy, not an ordinary task", () => {
  // the real exec-smoke.mjs policy/instructions
  assert.equal(declaresNoDeliverableExpected("artifact policy: return summary only"), true);
  assert.equal(declaresNoDeliverableExpected("This is a no-op smoke test. Return the result only."), true);
  assert.equal(declaresNoDeliverableExpected("make no code or file changes"), true);
  assert.equal(declaresNoDeliverableExpected("NO-DELIVERABLE-EXPECTED"), true);
  // an ordinary deliverable-bearing task carries none of these markers
  assert.equal(declaresNoDeliverableExpected("Fix the login bug and open a PR against main"), false);
  assert.equal(declaresNoDeliverableExpected("Create a GitHub issue in o/r and report its URL"), false);
  assert.equal(declaresNoDeliverableExpected(""), false);
  assert.equal(declaresNoDeliverableExpected(undefined), false);
});

test("composeTerminalNotification renders 'completed (no deliverable expected)' for a declared smoke run (C-07c)", () => {
  const msg = composeTerminalNotification({
    executionId: "smoke-1",
    target: "ephemeral:smoke-1",
    outward: false,
    manifest: { handoffExcerpt: "ephemeral smoke observed" }, // no PR/commit/issue/paths
    context: "This is a no-op smoke test. artifact policy: return summary only",
  });
  assert.ok(msg.includes("completed (no deliverable expected)"), "smoke run reads completed");
  assert.ok(!msg.includes("treating as failed"), "never the failed-to-produce message");
});

test("C-07b unchanged: a deliverable-EXPECTED run with nothing verifiable still fails honestly", () => {
  const msg = composeTerminalNotification({
    executionId: "real-1",
    target: "zenod-ai/zenod#5",
    outward: false,
    manifest: { handoffExcerpt: "I finished the work" }, // claims done, no evidence
    context: "Fix the auth guard and open a PR against main", // NOT a no-op
  });
  assert.ok(msg.startsWith("Finished but produced nothing verifiable — treating as failed"));
});

test("C-07a unchanged: a run WITH a real deliverable still renders done with the URL", () => {
  const msg = composeTerminalNotification({
    executionId: "real-2",
    target: "zenod-ai/zenod#6",
    outward: false,
    manifest: { handoffExcerpt: "opened https://github.com/zenod-ai/zenod/issues/6" },
    context: "return summary only", // even a no-op marker must not suppress a REAL deliverable
  });
  assert.ok(msg.startsWith("✅ Execution done"));
  assert.ok(msg.includes("https://github.com/zenod-ai/zenod/issues/6"));
});

// I8-2 (C-21): durable resume decision — a run killed mid-flight by a redeploy is
// resumed, not reported dead; a run that finished is reported; the ceiling holds.
test("ephemeralResumeDecision resumes a run with no terminal outcome under the ceiling", () => {
  const d = ephemeralResumeDecision({ hasTerminal: false, attempts: 1, maxAttempts: 3 });
  assert.equal(d.action, "resume");
});

test("ephemeralResumeDecision reports (does not resume) a run that reached a terminal outcome", () => {
  const d = ephemeralResumeDecision({ hasTerminal: true, attempts: 1, maxAttempts: 3 });
  assert.equal(d.action, "report");
});

test("ephemeralResumeDecision stops resuming once the attempt ceiling is reached", () => {
  const d = ephemeralResumeDecision({ hasTerminal: false, attempts: 3, maxAttempts: 3 });
  assert.equal(d.action, "report");
  assert.match(d.reason, /giving up/);
});

test("ephemeralResumeDecision resumes on the last allowed attempt", () => {
  const d = ephemeralResumeDecision({ hasTerminal: false, attempts: 2, maxAttempts: 3 });
  assert.equal(d.action, "resume");
});

// S-7 / C-17: hard per-run budget kill — wall-clock OR turns, whichever trips first.
test("budgetKillDecision kills a run past the wall-clock ceiling", () => {
  const d = budgetKillDecision({ elapsedMs: 61 * 60 * 1000, turns: 10, maxMs: 60 * 60 * 1000, maxTurns: 200 });
  assert.equal(d.kill, true);
  assert.match(d.reason, /wall-clock budget exceeded/);
});

test("budgetKillDecision kills a run past the turn ceiling", () => {
  const d = budgetKillDecision({ elapsedMs: 60000, turns: 201, maxMs: 60 * 60 * 1000, maxTurns: 200 });
  assert.equal(d.kill, true);
  assert.match(d.reason, /turn budget exceeded/);
});

test("budgetKillDecision leaves a run within budget alone", () => {
  const d = budgetKillDecision({ elapsedMs: 30 * 60 * 1000, turns: 150, maxMs: 60 * 60 * 1000, maxTurns: 200 });
  assert.equal(d.kill, false);
});

test("budgetKillDecision: exactly at the ceiling is not yet a breach", () => {
  const d = budgetKillDecision({ elapsedMs: 60 * 60 * 1000, turns: 200, maxMs: 60 * 60 * 1000, maxTurns: 200 });
  assert.equal(d.kill, false);
});

// C-17 / B1: per-run budget override parsed from task context; env fallback otherwise.
test("parseRunBudget reads minutes + turns only when 'budget' is present", () => {
  assert.deepEqual(parseRunBudget("budget: 3 min / 10 turns"), { maxMs: 180000, maxTurns: 10 });
  assert.deepEqual(parseRunBudget("run with budget {minutes: 5, turns: 40}"), { maxMs: 300000, maxTurns: 40 });
  assert.deepEqual(parseRunBudget("budget 2 minutes"), { maxMs: 120000 });
});

test("parseRunBudget ignores durations when 'budget' is not mentioned (no accidental cap)", () => {
  assert.deepEqual(parseRunBudget("please wait 5 minutes then do 3 turns of review"), {});
  assert.deepEqual(parseRunBudget(""), {});
  assert.deepEqual(parseRunBudget(undefined), {});
});

test("budgetKillDecision honours a per-run override tighter than the env default", () => {
  // 4 min elapsed under a 3-min per-run ceiling → kill, even though the 60-min env default wouldn't.
  const d = budgetKillDecision({ elapsedMs: 4 * 60 * 1000, turns: 5, maxMs: 3 * 60 * 1000, maxTurns: 10 });
  assert.equal(d.kill, true);
  assert.match(d.reason, /wall-clock budget exceeded/);
});
