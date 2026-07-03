# Iteration 2 — Phase 1 Run Log

Run date: 2026-07-02
Driver: Council chat lane (`chat_with_console`, `surface=web`, `conversationKey=council-iter2-phase1`).
Instruction: **file AND dispatch** the Phase-1 fixes. M1 (GitHub App on `zenod-ai/zenod`) is **not done**
and will not be done for now, so all `zenod-ai/zenod` execution is expected to block — reported honestly,
not retried into fake success.

## What actually happened (one line)

All 5 epics were **filed** as central tracking issues in `AlfaBlok/obsidian-brain` (#228–#232).
**No code fix could be dispatched** — every `zenod-ai/zenod` execution is blocked on M1, and the ephemeral
lane is dead on codex quota until Jul 26. **One fix was actually landed:** E5-T3 (the dead
`Areas/Insurance.md` citation is repaired and now resolves).

## The routing reality we learned this run

Archus can write **only** the central backlog repo (`AlfaBlok/obsidian-brain`). Code/product tickets are
tracked there with a `target:zenod-ai/zenod` marker; Epaminon/Codex is what executes against the target repo.
So "filing" a zenod fix = a tracking issue in obsidian-brain. "Dispatching" it = an Epaminon run that needs
M1. The bundled `console_create_issue_then_run` validates target-repo access **first**, so it blocks before
it even writes the tracking item — you must file tracking-only, separately from any dispatch.

---

## Per-epic outcome

| Epic | Repo (routing) | Filed | Dispatched | Status |
|------|----------------|-------|-----------|--------|
| M1 (manual) | zenod-ai/zenod | n/a | n/a | **Not done** (only Jordi can). Blocks all execution below. |
| E-1 · Receipts or silence (P0) | brain → target:zenod | **#228** | Blocked | Journey `e8aa2cb9` rejected: GitHub App not installed on zenod-ai/zenod |
| E-2 · W0 ephemeral fallback (P0) | brain → target:zenod | **#229** | Blocked | Same M1 block + codex quota dead (the very bug E-2 fixes) |
| E-3 · Research journey (P1) | brain → target:zenod | **#230** | Blocked | M1 block |
| E-4 · Routing round 2 (P1) | brain → target:zenod | **#231** | Blocked | M1 block |
| E-5 · Memory & notif hygiene (P2) | split | **#232** | Partial | E5-T3 **landed** (brain); E5-T1/T2/T5 blocked on M1 (zenod); E5-T4 deliberately not auto-done |

Tracking issues (all in `AlfaBlok/obsidian-brain`):
[#228](https://github.com/AlfaBlok/obsidian-brain/issues/228) ·
[#229](https://github.com/AlfaBlok/obsidian-brain/issues/229) ·
[#230](https://github.com/AlfaBlok/obsidian-brain/issues/230) ·
[#231](https://github.com/AlfaBlok/obsidian-brain/issues/231) ·
[#232](https://github.com/AlfaBlok/obsidian-brain/issues/232)

---

## The one fix that landed: E5-T3 (repair dead citation)

- Stored the known fact (AXA travel insurance, coverage ends March 2027) targeted at the missing meaning page.
- Async job `4d94712e…` finished **done**: evidence `Log/2026-07-02.md#^e-3c1418`, page `Areas/Insurance.md`
  created, commit `358e4707d3f7cc2ce7e5aa04daa423d7d27352fd`.
- **Verified:** `get_memory Areas/Insurance.md` now returns 200 with frontmatter, body, and the evidence
  anchor `[[2026-07-02#^e-3c1418]]`. The B2 dead-citation failure is closed for this page.
- Caveat: the Console's *synchronous* reply wrongly said "Areas/Insurance.md was never written" while the
  async job was still running — a live instance of the **E5-T5 / E1-T2** confirmation-timing + false-negative
  bug. (Filed under #232; noted below.)

## E5-T4 — deliberately not auto-completed

Hydrating R1/H1/S0/W0 and the canonical roster requires authoritative definitions I don't have. Writing them
from guesswork would reproduce exactly the fabrication these epics exist to kill, so I left E5-T4 as tracked
work in #232 rather than inventing content. Needs the source (`THE-COUNCIL-NAMING` / the epic definitions)
before it can be hydrated honestly.

---

## Bugs the filing run itself reproduced (bonus evidence for the epics)

The act of filing these tickets triggered three of the very defects they target — useful live repros:

1. **E1-T6 (spurious "⚠️ Correction" prefix):** the E-3 filing reply opened with
   "⚠️ Correction — I couldn't confirm execution state for #230…" on a plain create. → repro for #230's parent E-1/E1-T6.
2. **E1-T2 / E1-T5 (contradictory state claim):** the first E-5 filing reply said **both** "no GitHub issue was
   created … #232 was not filed" **and** "Created tracking epic #232" with an **empty action log**. I did not
   trust it and re-filed to get a real receipt (`toolEvents:2`). Textbook case for E-1.
3. **E5-T5 (store confirmation timing):** the E5-T3 store returned "never written" synchronously while the
   async write in fact succeeded — the confirmation didn't wait for / reflect the where-filed result.

These are recorded on the relevant tracking issues as reproduction notes.

---

## What's needed to actually dispatch the fixes (blockers, in order)

1. **M1** — install the GitHub App on `zenod-ai/zenod` (~2 min, Jordi only). Unblocks all E-1..E-4 and
   E5-T1/T2/T5 execution, plus D1 routing and any zenod PR.
2. **Codex quota** — dead until **Jul 26**; and the ephemeral lane has no fallback (that's E-2 itself). Even
   with M1, ephemeral fixes will fail until either quota resets or E-2 lands. The fanout/direct lane survives
   quota but produced no commits in iteration 1 (#227), so it's not a reliable substitute yet.

Net: with M1 done, the tracking epics can be dispatched to Epaminon; without it, Phase-1 execution cannot
proceed and the honest state is "filed, blocked."

## Summary

- **Filed:** 5/5 epics (#228–#232) in the central backlog, correctly routed with `target:` markers.
- **Dispatched a working fix:** 1 (E5-T3, verified landed).
- **Blocked on M1:** all zenod code work (E-1, E-2, E-3, E-4, E5-T1/T2/T5).
- **Blocked on source material:** E5-T4 (won't fabricate).
- **Free bonus:** the run reproduced 3 of the target bugs live (correction-prefix, contradictory state claim,
  store-confirmation timing) — attached as evidence.
- **Next action owned by you:** M1. Everything P0/P1 waits on it.
