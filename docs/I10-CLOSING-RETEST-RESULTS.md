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
