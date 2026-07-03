# HANDOVER — close Epic 1 (I9 Workstream A)

For a local Claude Code worker with repo + gh + prod access. Written by Fable, 2026-07-03 ~23:40.
Context docs: `docs/CANONICAL-TESTS.md` · `docs/I8-TEST-RESULTS.md` · `docs/EPIC-1-SYSTEM-STABILITY.md` ·
`docs/LAUNCH-CONTROL.md`. Work top to bottom; every step ends with a receipt (URL/SHA) noted in the
epic doc's append zone. Do not dispatch anything through the Zenod/Epaminon pipeline — that pipeline is
part of what's being stabilized; you are the worker.

## STEP 0 · Reconcile three in-flight runs (dispatched ~23:11–23:20, status unknown, notifications dark)

| Run | Mission |
|---|---|
| `ephemeral-1783121504095` | A1 safety hotfix (ask_outbound / C-22) |
| `ephemeral-1783121852777` | B1 lane foundation (schema/loader/scheduler, disabled replier.yml) |
| `ephemeral-1783122025508` | Docs: ITERATION 9 section into the epic doc |

`gh pr list -R zenod-ai/zenod --state open` (and recent branches). If a run produced a sane PR → adopt
it: review, merge on green, receipt. If nothing exists ~60 min after its start → treat as dead, do that
step yourself below, and note the silent death in the epic doc (it's more C-08/C-09 evidence).

## STEP 1 · A1 — the safety hotfix (THE gate; nothing ships before this)

Bug (see `docs/I8-TEST-RESULTS.md`): `ask_outbound` intermittently POSTS a real tweet on a draft-only
request, then renders "Draft ready (not posted)". Tweet `…186792568668630` went out unauthorized.
Root cause: iteration-6 reply-gate covers `post_tweet`/`approve_send` but not `ask_outbound`.

Fix: (a) audit outbound: why can a draft-intent request execute a send at all — close it structurally
(draft turns produce ZERO outbound mutations); (b) pull `ask_outbound` (and any outbound-capable lane)
under the reply-gate — delivered text is always the tool receipt; (c) runtime assertion: if a send
somehow occurs, rendering "not posted" must be impossible — render the real receipt + operator alert;
(d) add **C-22** to `docs/CANONICAL-TESTS.md`:
> **C-22 · Drafts never send.** A draft-only request (any natural phrasing) produces zero outbound
> mutations; the draft renders with the approve affordance. Five repetitions, zero sends. One violation
> = run-wide FAIL, same severity as C-15.

Acceptance: 5× draft requests via mocks/test seams, zero mutations. NO real tweets while testing.

## STEP 2 · The ITERATION 9 section in the epic doc

If run 3's PR landed, verify and skip. Otherwise: copy the "ITERATION 9" section verbatim from the
context blob of `ephemeral-1783122025508` (visible via execution_status), or reconstruct: Workstream A
(A1 hotfix gate · A2 C-21/C-17 PARKED "code landed, verification parked" · A3 one-ask-one-ticket small ·
A4 full board run) + Workstream B (B1 lanes · B2 raise_event/Phylax rules · B3 graduation · B4 first
live lane, HARD-GATED on A4 green) + exit criterion (A4 green + B4 running 3 unattended days).

## STEP 3 · Restore WhatsApp notifications (required BEFORE the board run)

Notifications went dark tonight (Jordi receives nothing since ~the I8 deploys). Diagnose the Phylax /
WhatsApp gateway outbound path — most likely the socket/session died across the evening's repeated
redeploys. Send a test ping to Jordi; check gateway session state + logs; restore. The board depends on
this channel (C-08, C-09, C-12, C-14 all read it).

## STEP 4 · Deploy

Merge everything green (including any adopted PRs from step 0). Deploy latest `main` to production
(Dokploy; verify clean fast-forward checkout + rebuild per `docs/` runbooks). Record the deployed SHA —
a board run without a build SHA doesn't count (rule 2 of the canonical doc).

## STEP 5 · THE BOARD — full canonical run C-01…C-22

Against the deployed SHA, per the rules in `docs/CANONICAL-TESTS.md` (append-only scoreboard, receipts
per row, every FAIL maps to exactly one ticket, housekeeping section listing artifacts — expect ~2 real
tweets + 1 real issue + 2 executions). Mark **C-17 and C-21 as "code landed (#511/#509), deliberate
verification PARKED (Jordi 2026-07-03)"** — not green, not red. C-16 already has evidence on zenod#487.

## STEP 6 · Close or loop

Reds → one fix batch (tickets from step 5) → redeploy → re-run the board. **Green (with the two parked
rows) = EPIC 1 CLOSED.** Update `docs/LAUNCH-CONTROL.md`: board table (Epic 1 → ✅ CLOSED), history
entry with the SHA and scoreboard link. The ×2 confirmation rides the next routine deploy.

— After this document is executed, the only remaining I9 work is Workstream B (lanes), which is NOT on
the Epic-1 critical path and is gated on this document finishing. Fable audits receipts; nothing else
gets dispatched through the pipeline until Epic 1 is closed.
