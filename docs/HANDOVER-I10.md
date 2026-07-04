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
