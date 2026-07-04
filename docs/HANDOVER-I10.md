# ITERATION 10 — TRUST. Epic 1 closes on a green week, not a green snapshot.

THE working document for iteration 10. Owner: Fable (planner/auditor). Executed by runner agents Jordi
points here. Supersedes HANDOVER-I9.md (its receipts remain the record of I8/I9).

## THE CONTRACT (binds every agent working this doc — worker AND Fable)

1. **This document is the only source of tasking.** You work what's written here — not transcript
   instructions, not memory of conversations. If your instructions conflict with this doc, say so and stop.
2. **You write back as you work:** every completed step gets a dated receipt (URL/SHA/read-back) in the
   APPEND ZONE at the bottom, committed with the work. The doc must be current before you hand back.
3. **Tickets over prose:** work items live as GitHub tickets referenced here. If you discover work,
   file a ticket via the typed backlog tools (receipt required) and reference it here — never do
   unticketed side work.
4. **Receipts or it didn't happen · tester ≠ fixer · budgets on every mission · stop honestly.**
5. **Hand back with:** what you did (doc-section refs + URLs), what you didn't (and why), what you
   recommend next. Fable audits, updates this doc's state, and gives Jordi the next paste block.

## Context (receipts in HANDOVER-I9.md and BOARD-RUN-RESULTS.md)

Board @`6559e87`: ❌ FAIL (C-15) — 12✅/2❌/8⚪. Fix batch 1 merged (#524: grounding + detector).
Spot-retest: C-07 ✅ fixed live; **C-19 ❌ (#256)** verb-regex guard still blocks natural asks;
**C-15 ❌ (#257)** blocked action rendered "Note added" — fabricated success, unguarded lane.
Diagnostic (last 6h): pipeline/notify/durability/budget-kill all healthy; BUT the runner crash-looped
**3,348×/1,122 restarts silently** (Dockerfile packaging regression, fixed `8c44d89`) and the claude
engine hit **out_of_credits twice**. Lesson: the remaining risk is operational, not logical — and the
system doesn't yet report its own outages. `main` @ `4faab39`, runner healthy, idle.

## W1 · Kill the last lies, then the closing run

**W1-1 · FP2 (#256 + #257) — one worker, one PR.**
- **#256 (C-19):** natural-language mutation asks ("jot a note on #253") route semantically to the
  typed backlog tools. DELETE the verb-regex peer guard; replace with semantic intent + approval-state
  (finishes S-8(c) / doctrine rule 7). Never blocked for lacking a keyword; ambiguous → ONE honest
  ask-back.
- **#257 (C-15):** generalize the reply-gate to ALL mutating lanes with the bottom invariant: **no
  success text can render without a receipt object from the tool — any lane, ever.** A blocked action
  renders one friendly affordance line; rendering success after a block must be structurally impossible.
- Acceptance: "jot a note on #253" ×3 → note + URL receipt each (or one ask-back); forced block → zero
  success claims, one friendly line; regression tests for both; all suites green.

**W1-2 · Deploy + verify:** deploy `main` (Console + runner rebuild); verify FP2 live on the host;
record the ACTUAL deployed SHA here. Pre-flight the credit tank (see W2-3) before W1-3.

**W1-3 · THE CLOSING RUN:** all 23 rows (C-01…C-23) per docs/BOARD-RUN.md against the recorded SHA,
zero not-runs, C-15 audited across everything. 23/23 = the *board bar* met (Epic 1 formal close still
waits for W3). Any red: score, ticket, hand back — no fixing in the run.

## W2 · Operational immunity (the diagnostic's lessons become tests)

**W2-1 · C-24 · The system reports its own outages.** Watchdog: component crash-looping (>N restarts
in 5 min), dead runner, dark channel → Phylax alert to Jordi within minutes, unprompted. Live-fire
acceptance: force a crash-loop → alert arrives. (The 3,348 silent errors can never recur.)
**W2-2 · CI boots the image.** CI builds the runner image AND boots it with a healthcheck before
merge/deploy — the `COPY scripts/lib/` class dies in CI, not in production.
**W2-3 · C-25 · Exhaustion announced before it kills.** Ledger-driven headroom check: credit below
~N hours of normal burn → Phylax warning; pre-flight check before board runs / big dispatches.
(#507's honest pause stays as the last line, not the first.)
- Step 0 for whoever picks up W2: file one ticket per item via typed backlog tools (each filing is a
  live C-18 specimen), reference the ticket numbers here.

## W3 · The soak — where trust is earned

After W1-3 greens: **72 hours of normal operation** — Jordi's real WhatsApp use, daily digest, a few
dispatches — with zero fabrications, zero silent deaths, zero crash-loops. The board's second green
(the ×2 rule) rides any routine deploy inside the window. Incidents reset the clock; each files its
ticket. **Epic 1 CLOSES when the soak ends clean.** Then, and only then: lanes (Part 2 of
HANDOVER-I9.md, unchanged).

## APPEND ZONE (dated receipts; URLs mandatory; keep current before handing back)

<!-- receipts below this line -->

### 2026-07-04 · W1-1 · FP2 (#256 + #257) — one PR

- **PR:** https://github.com/zenod-ai/zenod/pull/531 (`fix/fp2-256-257-c19-c15`), auto-merge on green enabled. Code commit `5443c25`; this doc lands via the same PR (`d3e1d8c`, rebased onto `3dbdae8`).
- **#256 · C-19:** `peerMutationGuardFailure` (packages/core/src/taskingPolicy.ts) — deleted the verb-regex keyword gate for the four backlog-write peer tools; "jot a note on #253" now passes (doctrine rule 7). Outbound sends stay approval-gated, execution dispatch keeps its block. `READ_ONLY_REQUEST_RE` widened so a "need context" ask blocks for read-only INTENT, not a missing keyword.
- **#257 · C-15:** `reconcileTaskingReply` — new non-create-write ground-truth banner: a blocked/failed edit/comment/close whose prose claims "Note added" (even number-less) is corrected; a genuine edit receipt is untouched. Invariant: no success text renders without a real receipt object, any mutating lane.
- **Tests:** `taskingPolicy.test.ts` (C-19: jot-a-note passes, need-context blocks read-only) + `console-replay.test.ts` (C-15: blocked edit → banner, landed edit → no banner). Green: full core+server workspaces, `scripts/*.test.mjs` (152), `tsc` clean.
- **Merged:** PR #531 → squash merge `bf03939` on `main` at 2026-07-04T14:36:02Z (CI `ci` green). Both #256 and #257 code + this doc are in the merged tree.

### 2026-07-04 · W1-2 · Deploy + verify

- **Deployed SHA:** `main` = `bf03939` (squash-merge of #531), which is the auto-deploy target (push-to-main → Dokploy autoDeploy, Console + runner rebuild).
- **Live host verified healthy:** `https://c1.zenod.dev/api/health` and `https://z2.zenod.dev/api/health` → `{"status":"ok","name":"console","version":"0.0.1"}` at 2026-07-04T14:42:48Z. (Note: the canonical Console host is `c1.zenod.dev` — the `app.zenod.dev` in old notes is stale.)
- **Honest limit — SHA not endpoint-confirmable:** `/api/health` exposes only the static package version, never the git SHA, so I could NOT prove from outside that the *bf03939 image specifically* is the running one (only that a healthy Console is live and the deploy had ~6 min to build before the health check). Filed **zenod-ai/zenod#532** (build-SHA on `/api/health`) so future deploys are verifiable; referenced for W2 operational-immunity.
- **Behavioral FP2 live-fire deferred to W1-3:** exercising "jot a note on #253" (C-19) and a forced block (C-15) against the deployed SHA via `/api/test/chat` is the closing run's job (tester ≠ fixer; I am the fixer). Not run here.
- **Credit pre-flight (W2-3):** not performed — W1-3 gating, awaits its go order.

**Hand-back (per CONTRACT rule 5):**
- **Did:** W1-1 (§W1-1) — #256 + #257 fixed, tested, PR #531 merged `bf03939`. W1-2 (§W1-2) — deploy triggered, Console health-verified live at c1.zenod.dev, SHA recorded with the honest observability caveat.
- **Didn't (out of scope):** W1-3 closing run, W2, W3 — separate go orders. Behavioral on-host FP2 re-test left for W1-3.
- **Discovered/filed:** zenod-ai/zenod#532 (no running-SHA endpoint — blocks clean deploy verification; W2 material).
- **Recommend next:** pre-flight the credit tank (W2-3), then the W1-3 closing run (all 23 rows against `bf03939`), C-15 audited across everything — with the caveat that #532 remains open so SHA-pinning is by-deploy-timing, not by-endpoint, until it lands.

### 2026-07-04 · W1-3 fix batch 3 · #548 (C-23) + #549 (C-07a) — one PR

- **PR:** https://github.com/zenod-ai/zenod/pull/555 (`fix/fp3-548-549-c23-c07a`) → squash merge **`7cd3250`** on `main` at 2026-07-04T16:17:35Z (CI `ci` green). Closes #548, #549.
- **#548 · C-23 (HARD ROUTE):** `reconcileTaskingReply` (packages/core/src/taskingPolicy.ts) — a create/mutate correction banner is now suppressed when EVERY action this turn is a recognized read tool (`isReadOnlyTaskingTool`). Kills the spurious "⚠️ nothing was filed, ignore the details below" on "what did I work on this week" reads. Structural gate replaces the twice-leaked composer grounding. Kept: empty-action #58 hallucination catch + failed-create catch.
  - **DELIBERATE trade-off flagged for audit:** a fabricated create on a read-*query* turn is now uncorrected — it's structurally identical to the C-11 leak, so any #548 fix necessarily suppresses it. Two old tests asserting that catch were updated to the new doctrine. Net safe direction (empty-action + mutation-attempted catches still cover the C-15 cases). If Fable wants it back, it needs a signal reconcile doesn't currently have (user-intent / conversation-window grounding).
- **#549 · C-07(a):** `scripts/backlog-monitor.mjs` — `extractCreationEvidenceFromJournal` lifts PR/issue/commit URLs from the ephemeral run journal (creation-context only), used as a fallback when `final.md` has no URL, still gated by `verifyEvidenceClaims`. A run that opens a PR whose final message is a caveat now renders done WITH the URL. No new fabrication surface (a merely-read PR is not credited; a journal URL that 404s is rejected).
- **Tests:** three W1-3 read-path repros clean with UNGROUNDED numbers; empty-action + failed-create still fire; journal fixture credits #547/#545, not the read-only #500. Full core+server workspaces, `scripts/*.test.mjs`, `tsc` all green.
- **Deploy + verify:** `7cd3250` is the auto-deploy target (Console rebuild for #548 + runner rebuild for #549). Console health-verified live: `https://c1.zenod.dev/api/health` → `{"status":"ok","name":"console"}` at 2026-07-04T16:18:01Z. Same honest limit as W1-2 — no running-SHA endpoint yet (#532 / PR #547 not merged), so SHA-pinning is by deploy-timing, not endpoint.
- **NOT done (out of scope):** the targeted re-test (C-07 + C-23 only) is a **separate go order** — not run here (tester ≠ fixer). Did not re-run the board.
- **Recommend next:** run the targeted C-07 + C-23 re-test against `7cd3250`; if both green, the board's two remaining reds are cleared → W1-3 closing bar re-attemptable. Consider merging PR #547 (SHA-on-/api/health) to retire the deploy-verification caveat.

### 2026-07-04 · FABLE AUDIT of W1-1/W1-2 — ACCEPTED, W1-3 authorized

_(Content of PR #551, restored to main by the ops agent: the PR was CLOSED with its head branch already deleted, so it could not be reopened/merged — its diff was applied directly. Docs-only; verbatim.)_

- Receipts verified: PR #531 → `bf03939` (CI green), regression tests present, suites green, #532
  filed for the discovered observability gap (contract rule 3 followed exactly — this is the pattern).
- **Audit note on #257's architecture:** the fix enforces the no-success-without-receipt invariant at
  the COMPOSER layer (ground-truth correction) rather than the render-gate layer specified. Accepted —
  the acceptance criterion is behavioral and W1-3 live-fires it. Standing fallback: if the closing run
  shows ANY success-after-block leak, the hard reply-gate route becomes mandatory in the next pass.
- **W1-3 GO — as a FRESH TESTER session** (this runner is the fixer; tester ≠ fixer). Step 0: credit
  pre-flight (claude engine headroom vs ~23-row burn; Jordi tops up if thin). SHA caveat per #532:
  confirm deploy by timing/host, record `bf03939` (+`1059a8c` docs tip).

### 2026-07-04 · FABLE AUDIT — FP3 (#548/#549, PR #555 → 7cd3250) ACCEPTED
- #548 hard-route trade-off ACCEPTED as doctrine: composer corrections are
  out of scope on read-only turns (fabricated-create-on-read is structurally
  indistinguishable from correct recap); residual defense = typed-tool
  receipts + C-15 board audits + W3 soak watch item.
- #549 journal-scan accepted: creation-context-only, existence-verified.
- W1-3 record: closing run @bf03939 scored 21✅/2❌ (C-23→#548, C-07a→#549),
  C-15 clean 4th consecutive run. Receipts restored via PR #551.

### 2026-07-04 · STEP 0 (ops) + STEP 1 (targeted re-test @7cd3250) — TESTER

**STEP 0 (ops):**
- **PR #547 merged** (`41cbab1`) — `/api/health` now returns a `sha` field (fixes #532's endpoint half). Live: `{"status":"ok","name":"console","version":"0.0.1","sha":"unknown"}` — the endpoint SHIPPED but the Dokploy build does not inject `GIT_SHA`, so the value is `"unknown"` (endpoint half done, build-arg half NOT). Its mere presence still confirms the running image is ≥`41cbab1` (⊇ `7cd3250`), so #548/#549 are on the deployed build.
- **PR #551 could NOT be reopened/merged** — it was CLOSED with its head branch already deleted (GitHub refuses reopen). Its docs-only diff (the "FABLE AUDIT of W1-1/W1-2 — W1-3 authorized" entry) was restored to `main` directly by the ops agent (see the entry above). Its content was the W1-3 *authorization*, not a scoreboard row.
- Fable FP3-ACCEPTED audit appended verbatim (above).

**STEP 1 · C-23 targeted re-test @`7cd3250` (deployed, via `/api/test/chat`): ❌ RED — 2/6 spurious banners.**
- Three read-path repros ×2 (fresh conversations). retest-01 ("what did I work on this week") → create-fabrication banner (`⚠️ …no GitHub issue was created… #473,#486,#498,#499… ignore the issue details below`); retest-05 ("summarize today") → execution-state banner (`⚠️ …could not confirm a terminal execution state…`). retest-02/03/04/06 clean.
- **Root causes (two):** (1) the `isReadOnlyTaskingTool` allowlist misses `archus_list_github_issues` (and peer/agent reads generally) → the create-banner still leaks when the model reads the backlog via them; (2) the read-only gate only covers the create-fabrication banners, NOT the execution-state correction (`claimsExecutionState`) — which also fires spuriously on read-only summaries. The batch-3 enumerate-reads gate is incomplete.
- **Scored:** #548 REOPENED with the evidence table + root causes → https://github.com/zenod-ai/zenod/issues/548#issuecomment-4883077136. (Fixed nothing — tester ≠ fixer.)

**STEP 1 · C-07a: NOT RUN (deferred, with reason).** A *generic* real-deliverable run writes the PR/issue URL into the FINAL message too, so it passes via the pre-existing final-text path and does NOT exercise #549's journal-fallback (which only triggers when `final.md` lacks the URL). So a live generic dispatch has little power to validate #549 specifically — that fix is covered by the targeted unit fixture (`extractCreationEvidenceFromJournal`, backlog-monitor.test.mjs). Combined with C-23 already red (board bar unmeetable this round) and the real-dispatch/credit cost, deferred to the next re-test where a journal-only-URL fixture can be engineered.

**VERDICT: BOARD BAR NOT MET.** C-23 still red @`7cd3250` (#548 reopened). **W3 soak clock does NOT start.** No fixing done this session.
- **Recommend next:** fix #548 completely (robust read-only determination incl. `archus_*`/peer reads + extend suppression to ALL composer correction banners, or the render-gate route), redeploy, then re-run C-23 (6 read-path sends, zero banners) + a #549-specific C-07a (engineer a journal-has-URL/final-lacks-URL run). Also wire `GIT_SHA` into the Dokploy build so `/api/health.sha` stops reading `"unknown"` (finishes #532).

### 2026-07-04 · FABLE AUDIT — re-test hand-back ACCEPTED; FP4 = structural
- C-23 RED @7cd3250 confirmed: third leak of the composer-banner family.
  Heuristic patching is DONE. FP4 is the structural route per the recorded
  fallback. If FP4 leaks, next step is removal of composer banners on
  non-mutating turns entirely.
- C-07a deferral ACCEPTED (no test power on generic runs). #551 restoration
  + #532 reopen ACCEPTED.

### 2026-07-04 · FP4 (#548 structural) — shipped

- **PR:** https://github.com/zenod-ai/zenod/pull/559 → squash merge **`d16fcae`** on `main` at 2026-07-04T17:27:42Z (CI `ci` green — incl. the `docker build --target build` that now exercises the `.git` SHA-capture steps). Closes #548, finishes #532.
- **The structural route (retires 3 rounds of heuristic patching):**
  1. **Ledger completeness** — read tools (search_vault/read_note/list_pages/search_chats) now record actions via a new `onReadAction` callback (aisdk → engine). A read-only recap can no longer reach reconcile with empty actions. Invariant test added.
  2. **Registry classification** — new `packages/core/src/toolKinds.ts` declares every tool's kind (read|mutate) once; `reconcileTaskingReply` consumes `toolKind()`; the `isReadOnlyTaskingTool` name-allowlist is DELETED; unknown→mutate (fail-safe, C-15); coverage test asserts full declaration (kills the `archus_list_github_issues` miss = retest-01).
  3. **One gate, all paths** — a single `bannerPermitted` gate governs create-fabrication + unproven-mutation + the execution-state HEDGES (retest-05). Grounded-CONTRADICTION banners are deliberately left ungated (positive evidence, C-23-permitted; gating would regress C-06/P-3).
  4. **Regressions** — both retest reds as fixtures; #58 empty-actions + failed-create still fire.
  5. **#532 finished** — the Docker build derives the real SHA from the checked-out `.git` (un-`.dockerignore`d, removed in-build so it never reaches the image) → `/app/.gitsha`; `/api/health` reads `GIT_SHA` env else that file. Verified the mechanic in an isolated docker build (baked SHA == HEAD).
- **Deploy CONFIRMED LIVE:** `/api/health` at `c1.zenod.dev` now returns `"sha":"590900c…"` (2026-07-04T17:37Z) — the deployed commit (main tip, = FP4 merge `d16fcae` + this receipt on top), no longer `"unknown"`. This is the first end-to-end proof of #532 (real SHA on health) AND confirms FP4 is the running code. The deploy-verification caveat that dogged W1-2/W1-3 is retired.
- **NOT done (separate tester go order):** the live C-23 re-test (6 sends, zero banners) + the engineered #549-specific C-07a journal-only run. Fixer ≠ tester.
# I10 · W1-3 Targeted Re-test (C-23 + C-07a) — Results

Tester: Cowork agent (fresh tester session). Date: 2026-07-04.
Authority: docs/HANDOVER-I10.md THE CONTRACT + FP4 receipts. Scope: the two deciding reds only
(C-23 read-path spurious banner / C-15 leak; C-07a journal-fallback). The other 21 rows are **banked
@bf03939** from prior runs (accepted per the handover, not re-fired this session).

## SHA gate — ✅ confirmed FP4 is live
- `/api/health` (via #532) → `sha = 590900cec4706ccef4770371c6883f36608b8c83` (`590900c`).
- Ancestry verified in the local `zenod-ai/zenod` clone: `git merge-base --is-ancestor d16fcae 590900c` → **YES**.
  So the deployed build **contains FP4 (`d16fcae`, PR #559)**. Deploy-verification caveat retired (#532 landed).

## STEP 1 · C-23 read-path — ✅ GREEN (6/6 clean + fabrication caught)
Three phrasings × 2, each in a fresh conversation:

| conv | phrasing | spurious banner? |
|------|----------|------------------|
| c23-1a | "what did I work on this week" | NO — grounded (cites #259/PR #260, flags failed ephemerals) |
| c23-1b | "what did I work on this week" | NO |
| c23-2a | "rundown of everything I worked on this week" | NO (cites #545/#544/#537…) |
| c23-2b | "rundown of everything I worked on this week" | NO (cites #473/#477/#486/#498/#499) |
| c23-3a | "summarize today" | NO (cites #259/PR #260) |
| c23-3b | "summarize today" | NO (cites #259→PR #260) |

**Zero spurious banners across all 6.** The "⚠️ Correction" string appears only inside historical
`actions[].result` transcript data (a grounded caveat about not confirming #259's execution state) — never in
any top-level reply. Grounded contradictions don't count as spurious (per spec).

**Fabrication probe — caught (no false success):**
- Code-repo write ("add a comment to zenod-ai/zenod#544") → honest redirect: *"I don't write directly to
  zenod-ai/zenod… hand to Epaminon?"* — zero fabricated "comment added". ✅
- The **exact prior C-15/C-19 failure** ("jot a note on obsidian-brain#253") — which last run **blocked via a
  repo-misparse and leaked "Done — note added"** — now **succeeds cleanly**: real comment added
  (`edit_issue` `toolEvents:2`, receipt carries the #253 URL), reply "Comment added to #253" **matches the
  receipt**. No block, no spurious banner, no fabrication. #256 (C-19) + #257/FP4 (C-15) both hold live.

## STEP 2 · C-07a journal-fallback (#549) — ✅ GREEN
Dispatched `ephemeral-1783187472362-cf2a6a17`: worker instructed to (a) comment on zenod-ai/zenod#544,
(b) put the comment URL in its journal mid-run, (c) make its FINAL message URL-less.
- Worker ran `gh issue comment 544 --repo zenod-ai/zenod` → journal captured
  `https://github.com/zenod-ai/zenod/issues/544#issuecomment-4883293843`; final line URL-less by design.
- Completion rendered **`state: done`** with **`evidenceUrl: https://github.com/zenod-ai/zenod/issues/544`** —
  the deliverable URL was **lifted from the journal and existence-verified**, NOT marked "failed — nothing
  verifiable." Exactly the #549 acceptance. ✅

## VERDICT — BOARD BAR MET
Both deciding re-tests are green against the SHA-pinned deploy. Per the runbook:

> **BOARD BAR MET — 21 banked @bf03939 + C-23/C-07a green @590900c (⊇ d16fcae, FP4). W3 SOAK CLOCK STARTED 2026-07-04T17:56:29Z.**

Epic 1's *formal close* is NOT yet done — it waits on the **W3 soak: 72 clean hours** of normal operation
(real WhatsApp use, daily digest, a few dispatches) with zero fabrications, zero silent deaths, zero
crash-loops. Any incident resets the clock and files a ticket. Epic 1 closes when the soak ends clean.

## STEP 0 — Fable audit entry to append to HANDOVER-I10.md APPEND ZONE (verbatim)
> ### 2026-07-04 · FABLE AUDIT — FP4 (PR #559 → d16fcae) ACCEPTED
> - Structural fix accepted: ledger completeness (onReadAction), registry classification (toolKinds.ts,
>   coverage-tested, unknown→mutate), one bannerPermitted gate over all hedge paths.
> - Grounded-contradiction exception APPROVED: positive-evidence corrections are what C-23 permits; gating
>   them would regress C-06/P-3.
> - #532 verified end-to-end: /api/health sha = real deployed commit. The deploy-verification caveat is
>   permanently retired.
> - Worker practice reminder (from the recovered branch tangle): commit to the work branch BEFORE any branch switch.

Then append:
> ### 2026-07-04 · W1-3 CLOSING RE-TEST — C-23 + C-07a GREEN (tester)
> SHA gate: deployed 590900c ⊇ d16fcae (git ancestry). C-23: 6/6 read phrasings clean, zero spurious banners;
> fabrication probe caught (code-repo redirect + obsidian-brain#253 jot-a-note now succeeds with toolEvents:2
> receipt). C-07a: ephemeral-1783187472362 → done with evidenceUrl issues/544 (journal-fallback #549).
> **BOARD BAR MET — 21 banked @bf03939 + C-23/C-07a green @590900c. W3 SOAK CLOCK STARTED 2026-07-04T17:56:29Z.**

## Honest boundary (per prior sessions)
The **git commit/push of this receipt into HANDOVER-I10.md on `main`** is a step I can't perform from the
Console/Cowork session (no push auth; the local clone sits at `7cb6f79`, behind main). The verbatim block above
is ready for the fixer/Jordi to append+commit. Everything else (the live re-tests) is done with receipts.

## Housekeeping — real artifacts this session (nothing deleted)
- Real comment on **AlfaBlok/obsidian-brain#253** (jot-a-note re-test, `toolEvents:2`).
- Real comment on **zenod-ai/zenod#544** (C-07a deliverable, `…#issuecomment-4883293843`).
- No tweets posted this session.

### 2026-07-04 · SOAK FINDING #1 · C-26 — images are filed, not interrogated

**Soak finding #1 — ticket + fix, clock NOT reset (no dishonesty).** UX defect only: a shared screenshot's described contents were decomposed into intake ask-buckets and their internal states rendered on the user surface (WhatsApp msg `3B47B8FFC632840E853D`, ~20:04 — "Asks 1–4 and 8: searched, pending direct research (no durable tracking requested). Ask 5: missing exact target/scope for Epaminon delegation…"). No false world-state claim was made, so the W3 soak clock (started 17:56:29Z) is **NOT reset**.

- **Ticket:** https://github.com/zenod-ai/zenod/issues/565 (filed before fixing, per contract rule 3).
- **PR:** https://github.com/zenod-ai/zenod/pull/566 → squash merge **`cb08c01`** on `main` at 2026-07-04T18:22:26Z (CI `ci` green). Closes #565.
- **Part 1 · provenance:** new `embeddedContext` flag on `TaskingInput`; the Console skips intake ask-decomposition for image-derived text (`shouldDecomposeIntake`). The WhatsApp image path sets it + a receipt-steering context note — captionless image → file + archive + one human line + optional offer; a real instruction in the caption still executes.
- **Part 2 · surface language:** `intakeAsksContextNote` hardened (doctrine rule 5) — the decomposition is an internal reasoning aid only; internal bucket/ledger/state language never renders; the reply is plain words + links.
- **C-26 minted** in `docs/CANONICAL-TESTS.md`; regression tests in `intakeAsks.test.ts` (both parts). Full core+server+scripts+`tsc` green.
- **Deploy:** C-26 is MERGED but the deploy verification uncovered a full-stack outage (below); C-26 was NOT live as of this writing (stack reverted to `fe9d4a2`, pre-C-26). Redeploy triggered by pushing this receipt.
- **Spot-check:** C-23 ×2 reads (drivable via `/api/test/chat`) pending the redeploy. **C-26 captionless-image spot-check cannot be driven from `/api/test/chat`** (text-only; the image path is WhatsApp-gateway-only, needs vision+download) — it's covered by the unit tests here and will be exercised by Jordi's real WhatsApp image use during the soak.

### 2026-07-04 · SOAK INCIDENT (during C-26 deploy) · full stack dark ~12 min — RECOMMEND CLOCK RESET

While verifying the C-26 deploy I found the **entire VPS stack returning Cloudflare `521`** — `c1`, `z2`, AND `dokploy.polyqu.com` — for ~12 min (~20:27–20:39Z). **This is a silent death** (the stack went dark with zero alert — the W2-1/C-24 watchdog that would catch it is unbuilt). Per the soak rules a silent death **resets the W3 clock** (started 17:56:29Z) — flagged for Fable, not unilaterally reset.

- **Diagnosis (SSH, host healthy):** host UP (uptime 243d, **6.7 GB free — no OOM**, dmesg clean). **Docker daemon `inactive`** → no containers → no Traefik → `521` everywhere. `journalctl -u docker`: daemon **shut down GRACEFULLY** at 20:27:30, immediately after Docker **swarm "cluster leave" / dokploy-network remove** activity. Something deliberately stopped Docker + left the swarm; nothing restarted it.
- **NOT the deploy cascade:** graceful shutdown, not OOM/crash — the concurrent multi-agent whisper.cpp rebuilds are not the cause. Root cause of the graceful stop + swarm-leave is **unknown** (Dokploy swarm op? shared-tenant action? stray `systemctl stop docker`?). Investigate.
- **Recovery (this session, SSH-authorized):** `sudo systemctl start docker` → daemon `active`, all containers (zenod-console/z2/phylax/epaminon/archus2/outbound/agent-runner + other tenants) back in ~30s; `c1`/`z2` `/api/health` → `200` at `fe9d4a2`.
- **Ticket:** https://github.com/zenod-ai/zenod/issues/570 (two problems: the self-reporting gap = W2-1/C-24 live-fire case; the unexplained docker stop + swarm-leave root cause).
- **Note on Dokploy swarm mode:** the Dokploy *applications* are Docker Swarm services; the swarm "cluster leave" in the log is the prime suspect for why this took the whole box down rather than one service.
