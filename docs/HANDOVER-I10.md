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

### 2026-07-04 · W1-3 · THE CLOSING RUN — ❌ FAIL (2 reds) · tester = Claude (live, not dispatched)

- **Scoreboard:** docs/CANONICAL-TESTS.md, run `bf03939`. **Board: 21 ✅ · 2 ❌. RUN = ❌ FAIL.** Zero not-runs (all 23 scored). Opened via draft PR (the C-20 specimen).
- **Step 0 (credit pre-flight):** LLM ledger shows **zero claude/opus calls in 7 days** on the chat lane — the Console answers on **OpenRouter grok-4.3** (live, funded, ~$1.7/day steady). Execution workers run **claude-sonnet-5** (per #544/#547 transcripts) and completed fine → runner claude tank healthy. Jordi's ruling: I am the tester (Claude) running the tests **against** Z0, not dispatching a run **with** Z0 — so no claude-tank dependency for the suite; proceeded.
- **The two reds (both SAFE-direction composer/verifier defects — C-15 stays clean):**
  - **C-23 ❌ → zenod-ai/zenod#548.** Spurious correction banner on read-only "what did I work on"/"summarize today" turns — 3 fires (C-11, repro-1, C-14) vs 1 clean + 3 clean simple reads. Disclaims correctly-cited past-work issues ("ignore the issue details below") and invents create-intent. #258 not fully fixed; composer-layer leak → the **hard reply-gate route** (Fable's standing fallback) is now indicated. Not a fabrication ("nothing filed" is true).
  - **C-07(a) ❌ → zenod-ai/zenod#549.** Verifier false-negative: exec `…549284` produced a **real PR #547** (fix #532, 11 files) + issue #545, yet was marked `blocked`/"failed: produced nothing verifiable." Deliverable extractor reads the final message, not the run journal (which logs `PR created: #547`). Under-claim (safe) but violates "real deliverable renders done WITH the URL." (Opposite of old #485, now FIXED — C-07c passed via #544.)
- **Everything else green (21/23):** outbound A-suite 6/6 (real tweets …808259/…808153/…343759-image/…071772; honest block; honest image-FAIL), C-06 (#544/#545), C-08 (start-ping link #266), C-09 (real 14.6-min run + mid-run status), C-10* (fallback engine; *forced-selection not induced quota-death), C-11–C-14 memory+reads grounded, C-15 clean (4th+ fabrication-free run), C-16 (#544 model-id + #487), C-18 (#264/#265 typed receipts), C-19 (paraphrase routed), C-20 (this PR + #531 auto-merge), C-17/C-21 banked, C-22 drafts-never-send.
- **Doc discrepancy for record:** docs/BOARD-RUN.md still reads C-01…C-22 / build `6559e87`; the binding HANDOVER tasking (23 rows, C-23, `bf03939`) governs per CONTRACT rule 1. BOARD-RUN.md should be refreshed to 23 rows.

**Hand-back (CONTRACT rule 5):**
- **Did:** W1-3 closing run — all 23 rows scored live with receipts. Two reds ticketed (#548, #549). Scoreboard appended via draft PR (C-20 specimen). This receipt.
- **Didn't (tester ≠ fixer):** fixed nothing; did not merge the fixes. Could not force true quota-death (C-10 scored on forced engine-selection + live chat-lane fallback). Could not endpoint-confirm the SHA (#532 open). Did not restore the reverted Fable-audit APPEND-ZONE block (not mine).
- **Recommend next:** ONE fix batch — #548 (banner gated on real this-turn create/mutate intent; strongly consider the hard reply-gate route per Fable's fallback) + #549 (deliverable extractor reads the run journal) — each with its regression test. Redeploy → re-run **only C-07 + C-23** (plus a C-15 sweep); the other 21 are banked at `bf03939`. Then the board bar is met and W3 soak can start. Epic 1 formal close still waits on the soak.
