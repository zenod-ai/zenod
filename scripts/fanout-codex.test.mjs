import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { issueStatusLabelFor, detectBlocker, clarityCheck, executionBlockedRequest, remoteMatchesRepo, resetBaseCheckout, branchName, extractWorkerError, classifyWorkerError, isQuotaError, parseResetsAt, formatResetsAt, isPausedQuota, pauseMessage, fallbackEngine, finalComment, deliverablePaths, deliverablesBlock, buildPrCreateArgs, prChangedFiles, resolveEngine, resolveModel, resolveEffort, buildWorkerSpawn, extractFinalFromEvents } from "./fanout-codex.mjs";
import { enableAutoMergeForPr, wantsHoldForReview } from "./backlog-monitor.mjs";

test("isQuotaError recognizes the quota/limit error class across both engines (W0)", () => {
  // The exact codex error that killed executions on 2026-07-02:
  assert.ok(isQuotaError("You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Jul 26th, 2026 7:56 AM."));
  assert.ok(isQuotaError("insufficient_quota: You exceeded your current quota"));
  assert.ok(isQuotaError("429 Too Many Requests"));
  assert.ok(isQuotaError("Your credit balance is too low"));
  assert.ok(isQuotaError("rate limit reached, retry later"));
  // Non-quota failures must NOT trigger the engine fallback:
  assert.ok(!isQuotaError("TypeError: cannot read properties of undefined"));
  assert.ok(!isQuotaError("git push failed: permission denied"));
  assert.ok(!isQuotaError(""));
  assert.ok(!isQuotaError(null));
});

test("fallbackEngine swaps codex↔claude (W0)", () => {
  assert.equal(fallbackEngine("codex"), "claude");
  assert.equal(fallbackEngine("claude"), "codex");
});

test("classifyWorkerError still names quota failures plainly (W0 regression guard)", () => {
  const msg = classifyWorkerError("You've hit your usage limit. Upgrade to Plus to continue using Codex.");
  assert.ok(msg.includes("out of quota"));
  assert.equal(classifyWorkerError(null), null);
});

test("deliverablePaths normalizes git status --short lines including renames (R1-T4)", () => {
  assert.deepEqual(
    deliverablePaths([" M src/a.ts", "?? docs/new.md", "A  pkg/b.ts", "R  old.ts -> src/renamed.ts"]),
    ["src/a.ts", "docs/new.md", "pkg/b.ts", "src/renamed.ts"],
  );
});

test("deliverablesBlock renders a parseable list or 'none' (R1-T4)", () => {
  assert.equal(deliverablesBlock([]), "Deliverables: none");
  assert.equal(deliverablesBlock([" M a.ts", " M b.ts"]), "Deliverables:\n- a.ts\n- b.ts");
});

test("finalComment embeds the Deliverables block (R1-T4)", () => {
  const c = finalComment("run1", 5, "complete", "br", "did work", "https://x/pull/9", null, [" M a.ts"]);
  assert.ok(c.includes("Deliverables:\n- a.ts"));
  const none = finalComment("run1", 5, "complete-no-commits", "br", "did work");
  assert.ok(none.includes("Deliverables: none"));
});

test("resolveEngine defaults to claude, honors explicit flag, and infers from model", () => {
  assert.equal(resolveEngine({}), "claude");
  assert.equal(resolveEngine({ engine: "codex" }), "codex");
  assert.equal(resolveEngine({ model: "gpt-5-codex" }), "codex");
  assert.equal(resolveEngine({ model: "claude-sonnet-4-6" }), "claude");
  assert.equal(resolveEngine({ model: "o3" }), "codex");
});

test("resolveModel defaults Claude to Opus 4.8 and leaves Codex to its own config", () => {
  assert.equal(resolveModel("claude", {}), "claude-opus-4-8");
  assert.equal(resolveModel("claude", { model: "claude-sonnet-4-6" }), "claude-sonnet-4-6");
  assert.equal(resolveModel("codex", {}), null);
  assert.equal(resolveModel("codex", { model: "gpt-5-codex" }), "gpt-5-codex");
});

test("resolveEffort defaults Claude to low, honors override, leaves Codex to thinking", () => {
  assert.equal(resolveEffort("claude", {}), "low");
  assert.equal(resolveEffort("claude", { effort: "high" }), "high");
  assert.equal(resolveEffort("codex", {}), null);
  assert.equal(resolveEffort("codex", { thinking: "high" }), "high");
});

test("buildWorkerSpawn produces correct headless flags per engine", () => {
  const claude = buildWorkerSpawn({ engine: "claude", worktree: "/wt", finalPath: "/f.md", model: "claude-opus-4-8", effort: "low" });
  assert.equal(claude.bin, "claude");
  assert.equal(claude.capturesFinalToFile, false);
  assert.deepEqual(claude.args, ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--model", "claude-opus-4-8", "--effort", "low"]);
  assert.equal(claude.env?.IS_SANDBOX, "1"); // root container needs the sandbox escape hatch

  const codex = buildWorkerSpawn({ engine: "codex", worktree: "/wt", finalPath: "/f.md", model: null });
  assert.equal(codex.bin, "codex");
  assert.equal(codex.capturesFinalToFile, true);
  assert.ok(codex.args.includes("--output-last-message") && codex.args.includes("/f.md"));
  assert.ok(codex.args.includes("--cd") && codex.args.includes("/wt"));
});

test("extractFinalFromEvents pulls the Claude result event's final text", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-final-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(
    p,
    [
      '{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}}',
      '{"type":"result","session_id":"s1","result":"Status: complete\\nDid the work; commit https://github.com/o/r/commit/abc1234.","total_cost_usd":0.004}',
      "",
    ].join("\n"),
  );
  assert.match(extractFinalFromEvents(p), /Status: complete/);
  assert.match(extractFinalFromEvents(p), /commit https/);
  rmSync(dir, { recursive: true, force: true });
});

test("extractWorkerError catches a Claude billing/credit failure too", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-err-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(p, '{"type":"system","subtype":"api_retry","error":"billing_error","error_status":402}\n');
  assert.match(extractWorkerError(p), /billing_error/);
  assert.match(classifyWorkerError(extractWorkerError(p)), /out of quota \/ credit|usage limit/i);
  rmSync(dir, { recursive: true, force: true });
});

test("extractWorkerError recovers the real cause from the events stream (the #92 quota case)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-events-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(
    p,
    [
      '{"type":"thread.started","thread_id":"x"}',
      '{"type":"turn.started"}',
      '{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Jul 26th, 2026 7:56 AM."}',
      '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Jul 26th, 2026 7:56 AM."}}',
      "",
    ].join("\n"),
  );
  assert.match(extractWorkerError(p), /usage limit/);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(extractWorkerError(join(dir, "missing.jsonl")), null);
});

// ── #506: out-of-credits rate_limit_event capture + pause (5-hour cap replay) ──────────
// The exact stream line that killed the worker exit 1 on 2026-07-02:
const OUT_OF_CREDITS_EVENT =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"out_of_credits","resetsAt":1783114200}}';

test("#506: extractWorkerError captures a rejected rate_limit_event (was null → skipped fallback)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rate-limit-"));
  const p = join(dir, "events.jsonl");
  writeFileSync(p, [
    '{"type":"system","subtype":"init","model":"claude-opus-4-8"}',
    OUT_OF_CREDITS_EVENT,
    "",
  ].join("\n"));
  const err = extractWorkerError(p);
  assert.ok(err, "a pure rate_limit rejection must NOT yield null");
  assert.match(err, /rate_limit_event rejected/);
  assert.match(err, /five_hour/);
  assert.match(err, /out_of_credits/);
  assert.match(err, /resetsAt=1783114200/);
  assert.ok(isQuotaError(err), "the captured message must classify as a quota error");
  rmSync(dir, { recursive: true, force: true });
});

test("#506: isQuotaError matches the underscore out_of_credits / rate_limit_event tokens", () => {
  assert.ok(isQuotaError("rate_limit_event rejected: five_hour out_of_credits resetsAt=1783114200"));
  assert.ok(isQuotaError("out_of_credits")); // underscore form the old regex missed
  assert.ok(isQuotaError("five_hour"));
  assert.ok(isQuotaError("overageDisabledReason: out_of_credits"));
});

test("#506: parseResetsAt / formatResetsAt recover a retry-after time from the message", () => {
  assert.equal(parseResetsAt("rate_limit_event rejected: five_hour out_of_credits resetsAt=1783114200"), 1783114200);
  assert.equal(parseResetsAt("no timestamp here"), null);
  assert.equal(formatResetsAt(1783114200), "21:30 UTC"); // 2026-07-03T21:30:00Z
  assert.equal(formatResetsAt(null), null);
});

test("#506: fallback FIRES when the other engine exists (capture unblocks the W0/E-2 path)", () => {
  const err = "rate_limit_event rejected: five_hour out_of_credits resetsAt=1783114200";
  // both dry → paused, not failed; other engine present → NOT paused (fallback fires)
  assert.equal(isPausedQuota(err, "claude", () => false), true, "both engines dry → paused");
  assert.equal(isPausedQuota(err, "claude", (c) => c === "codex"), false, "fallback engine present → fall back, don't pause");
});

test("#506: pauseMessage renders an honest ⏸️ paused state with retry-after, never ⛔ failed", () => {
  const err = "rate_limit_event rejected: five_hour out_of_credits resetsAt=1783114200";
  const msg = pauseMessage("104", err, { target: "zenod-ai/zenod#506" });
  assert.match(msg, /⏸️/);
  assert.match(msg, /paused: out of credits/);
  assert.match(msg, /retry after 21:30 UTC/);
  assert.doesNotMatch(msg, /⛔|failed|produced nothing verifiable/);
  // no resetsAt → still paused, just without the retry clause
  assert.match(pauseMessage("104", "out_of_credits"), /paused: out of credits/);
});

test("classifyWorkerError names a quota failure plainly and actionably", () => {
  const friendly = classifyWorkerError("You've hit your usage limit. Upgrade to Plus ... try again at Jul 26th.");
  assert.match(friendly, /out of quota|usage limit/i);
  assert.match(friendly, /re-run|wait|Top up/i);
  assert.equal(classifyWorkerError(null), null);
  assert.equal(classifyWorkerError("some unknown crash"), "some unknown crash");
});

test("finalComment shows the worker error instead of '(no final handoff captured)' when there is no handoff", () => {
  const withErr = finalComment("run1", 92, "failed", "br", "", null, "Codex is out of quota — no work done.");
  assert.match(withErr, /Worker error: Codex is out of quota/);
  assert.doesNotMatch(withErr, /no final handoff captured/);
  assert.match(finalComment("run1", 92, "failed", "br", ""), /no final handoff captured/);
});

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

test("branchName stays issue-readable but unique per fanout run", () => {
  const issue = { number: 168, title: "Journey ladder L2 run routing smoke" };
  const first = branchName(issue, "fanout-20260623T154337Z");
  const second = branchName(issue, "fanout-20260623T154437Z");
  assert.equal(first, "codex/issue-168-journey-ladder-l2-run-routing-smoke-20260623t154337z");
  assert.equal(second, "codex/issue-168-journey-ladder-l2-run-routing-smoke-20260623t154437z");
  assert.notEqual(first, second);
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

// ── C-20: fan-out PRs open ready + auto-merge on green, honor HOLD opt-out ──────────

test("C-20: fan-out PR opens READY (no --draft) by default so auto-merge can land it", () => {
  const args = buildPrCreateArgs({ repo: "AlfaBlok/obsidian-brain", base: "main", branch: "b", title: "t", bodyPath: "/p" });
  assert.ok(!args.includes("--draft"), "default PR must NOT be a draft (a draft can never auto-merge — the #246/#247/#249 bug)");
});

test("C-20: HOLD-FOR-REVIEW opt-out opens the PR as a draft", () => {
  const args = buildPrCreateArgs({ repo: "zenod-ai/zenod", base: "main", branch: "b", title: "t", bodyPath: "/p", hold: true });
  assert.ok(args.includes("--draft"), "hold-for-review must keep the PR a draft");
});

test("C-20: controller enables auto-merge on a ready PR (both repos)", () => {
  for (const url of [
    "https://github.com/zenod-ai/zenod/pull/9",
    "https://github.com/AlfaBlok/obsidian-brain/pull/250",
  ]) {
    const calls = [];
    const runner = (a) => { calls.push(a); return { status: 0, stdout: "", stderr: "" }; };
    const r = enableAutoMergeForPr(url, { hold: false, runner });
    assert.equal(r.outcome, "enabled");
    assert.deepEqual(calls[0].slice(0, 2), ["pr", "merge"]);
    assert.ok(calls[0].includes("--auto") && calls[0].includes("--squash"));
  }
});

test("C-20: HOLD opt-out never enables auto-merge and makes no gh call", () => {
  const calls = [];
  const runner = (a) => { calls.push(a); return { status: 0, stdout: "", stderr: "" }; };
  const r = enableAutoMergeForPr("https://github.com/zenod-ai/zenod/pull/9", { hold: true, runner });
  assert.equal(r.outcome, "held");
  assert.equal(calls.length, 0, "held PR must not call gh pr merge");
});

test("C-20: holdForReview signal detected from goal/context (shared with #480)", () => {
  assert.ok(wantsHoldForReview("Do the thing.\nHOLD-FOR-REVIEW please"));
  assert.ok(wantsHoldForReview("context: noAutoMerge"));
  assert.ok(!wantsHoldForReview("Just a normal research goal, no markers here."));
});

// ── C-20 item 2: deliverables summary lists the PR's real files, never "none" ───────

test("C-20: deliverablePaths passes through already-clean paths (README.md not mangled)", () => {
  // The old greedy prefix regex ate "REA" out of "README.md"; the porcelain-shaped
  // prefix strip must leave code-less paths (from `gh pr diff --name-only`) intact.
  assert.deepEqual(deliverablePaths(["README.md", "docs/a.md", "src/b.ts"]), ["README.md", "docs/a.md", "src/b.ts"]);
});

test("C-20: deliverables list the PR's real files (never 'none' when files exist)", () => {
  const runner = () => ({ status: 0, stdout: "docs/a.md\nsrc/b.ts\nREADME.md\n", stderr: "" });
  const files = prChangedFiles("AlfaBlok/obsidian-brain", "https://github.com/AlfaBlok/obsidian-brain/pull/250", { runner });
  assert.deepEqual(files, ["docs/a.md", "src/b.ts", "README.md"]);
  const block = deliverablesBlock(files);
  assert.ok(block.startsWith("Deliverables:"));
  assert.ok(block.includes("- docs/a.md") && block.includes("- src/b.ts") && block.includes("- README.md"));
  assert.ok(!/Deliverables: none/.test(block), "must not say none for a 3-file PR");
});

test("C-20: deliverables fall back / say 'none' only when there genuinely are no files", () => {
  // gh failure → [] so caller falls back to the worktree dirty capture (no fabrication)
  const failRunner = () => ({ status: 1, stdout: "", stderr: "not found" });
  assert.deepEqual(prChangedFiles("a/b", "https://github.com/a/b/pull/1", { runner: failRunner }), []);
  // genuinely-empty PR diff → [] → "Deliverables: none"
  const emptyRunner = () => ({ status: 0, stdout: "\n\n", stderr: "" });
  assert.deepEqual(prChangedFiles("a/b", "https://github.com/a/b/pull/1", { runner: emptyRunner }), []);
  assert.equal(deliverablesBlock([]), "Deliverables: none");
});
