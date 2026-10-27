# EPIC-7: Real-user production test — 5 testers on free passes

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/EPIC-7-REAL-USER-TEST.md
Spine ID: real-user-production-test-5-testers-on-free-passes
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Zenod Alpha Launch — milestone A: Zenod is production-ready](EPIC-ZENOD-ALPHA-LAUNCH.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Five real people use production Zenod as ordinary users, capped and never charged, before Zenod goes truly live.

## Serves

[Zenod Alpha Launch — milestone A: Zenod is production-ready](EPIC-ZENOD-ALPHA-LAUNCH.md): the first wave (5) of DOD-1's capped free-pass users, and the production test that has to pass before a stranger pays (DOD-2). Tracked as a milestone in agent_team.

## Done means

- [ ] E7-1 Usage caps work in production: every user's usage is counted, and a user at the cap is stopped with a clear message (shown live on a test account at T7).
- [ ] E7-2 Five invited people signed up on production with their own single-use 100% code, gave no payment details, and Stripe shows €0 charged and no card on file for each.
- [ ] E7-3 Each of the five got at least one Saved reply over WhatsApp through the Zenod production number and saw it in their console.
- [ ] E7-4 Each tester's feedback is recorded, and at each month end there is a decision per tester to extend (or end) their free month.

## Current State

Owner: Delivery manager (zenod)
Status: draft
Last attempted: 2026-10-27 created from Jordi's brief (testers = production users, not charged; caps first; 1-month free code, extended monthly, never charged; Zenod production number; start with 5)
Result: plan written, not started. Finding 2026-10-27: paid checkout is off in production (`/api/public/production-readiness` ready=false, only blocking check `backup_restore`), so no one can sign up, free code or not, until T0.
Evidence: [ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md) A0 [evidence](evidence/zal-a0-2026-10-25.md); live readiness read 2026-10-27
Waiting on: E7-A1 Jordi stamps this epic `ready`; E7-A2 the cap figure (asked at T3, not before)
Approved work: none until `ready`
Next action: once `ready`, dispatch T0 and T1 in parallel
Source revision: see git log
Verified at: 2026-10-27

## Non-Goals

- Charging testers, ever. Live €9 for a stranger stays [ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md) A5.
- A separate tester mode or tester exceptions in code: testers are ordinary production users on the normal plan and caps; only the price differs (a coupon).
- Posting a public call for testers: invites go by DM to people who already answered (zenod-social). The wider call is ZAL DOD-1's later waves.
- More than 5 testers in this wave.

## Issue Ledger

Steps: each is independently testable and closes only with evidence. T0–T6 must all pass before T7; nobody is invited before T8.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T0 | Ticket worker | unassigned | Turn checkout back on: fresh backup-restore proof so `backup_restore` passes and readiness says ready=true | draft | none | - | main | 2026-10-27 readiness: ready=false, only `backup_restore` blocking | 2026-10-27 | restore last backup into an isolated copy, verify, record the proof; read readiness live |
| T1 | Ticket worker | unassigned | Map the new-user path in code and on prod: Google signup → checkout with a 100% code (€0, no card) → tenant created → user's phone linked to their tenant on the Zenod production number (Phylax) → first Saved reply → console | draft | none | - | main | none | 2026-10-27 | read-only audit; each gap found becomes a T2 row |
| T2 | Ticket worker | unassigned | Close the gaps T1 finds (one row each, added by T1) | draft | T1 | - | main | none | 2026-10-27 | wait for T1 |
| T3 | Ticket worker | unassigned | Metering + caps per plan (was ZAL A2): every user's usage counted; a cap on the plan; at the cap Zenod stops and tells the user why | draft | T1 | - | main | builds on ZAL-10 #1076, Phylax usage ledger (root D29), per-tenant metering (root D30) | 2026-10-27 | audit what is live vs merged, then close the gap; ask E7-A2 (cap figure) with the audit's numbers |
| T4 | Ticket worker | unassigned | Tester codes (was ZAL A3): one live Stripe coupon "Zenod tester" 100% off, 1 month; one promotion code per person, single use, unused codes expire in 14 days; month-by-month extension = a fresh 100% coupon on that subscription before renewal; list of who got which code kept private on VPS1, never in a repo | draft | T0 | - | main | checkout already has `allow_promotion_codes` + `payment_method_collection: if_required` (customerBilling.ts) | 2026-10-27 | create coupon + one test code; prove a €0 checkout needs no card and what happens at renewal with no card (must never charge, must not cut the user off unannounced) |
| T5 | Ticket worker | unassigned | Tester wording: invite DM, checkout/welcome text and console say plainly: no payment details needed, you will not be charged, 1 month free, extended month by month while you test and give feedback, we will never charge you | draft | T4 | - | main | none | 2026-10-27 | draft in Jordi's voice (zenod-social message house); Jordi reviews after the fact |
| T6 | Ticket worker | unassigned | Watching testers: one place showing per tester signup, WhatsApp linked, last Saved reply, usage vs cap, errors; feedback channel named in the invite | draft | T3 | - | main | [EPIC-6](EPIC-6-HEALTH-DASHBOARD.md) health page | 2026-10-27 | reuse EPIC-6 where it fits |
| T7 | Tester | Jordi + worker | Dress rehearsal as a new user: fresh Google account, own tester code, €0 checkout, WhatsApp to the Zenod production number, 3 voice notes → 3 Saved replies, all visible in the console; a test account pushed to its cap is stopped with the message; Stripe shows €0 and no card | draft | T0–T6 | - | main | none | 2026-10-27 | worker watches logs live while Jordi runs it; also covers ZAL A0's console check |
| T8 | Operator | Jordi | Go / no-go for inviting | draft | T7 | - | - | none | 2026-10-27 | ask Jordi with T7's evidence |
| T9 | Recruiter (zenod-social) | zenod-social Responder | Invite 5 by DM, each with their own code and the T5 text, from those who already answered on Reddit (Browerma, documentordie, WillowEmberly, UpSash, Relevant-Problem-794; FragrantBox4293, Ok-Car6047 unread) | draft | T8 | - | - | zenod-social data/posts-ledger.md rows 7–21 | 2026-10-27 | signal zenod-social after T8 |
| T10 | Delivery manager | Delivery manager | Run the test: daily check per tester (T6), feedback logged, month-end extend/end decision per tester | draft | T9 | - | - | none | 2026-10-27 | starts with the first signup |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-10-27 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |
| 2026-10-27 | accepted | Jordi: caps before testers; testers are ordinary production users, just not charged; this is the production test before truly live | no tester mode; T3 gates invites | chat 2026-10-27 | never |
| 2026-10-27 | accepted | Jordi: free code lasts 1 month, extended month by month while they test and give feedback; testers are told no payment details, never charged | T4/T5 | chat 2026-10-27 | when the test ends |
| 2026-10-27 | accepted | Jordi: use the Zenod production number for WhatsApp; start with 5 users once ready | T1/T7/T9 | chat 2026-10-27 | after wave 1 |
| 2026-10-27 | accepted | ZAL A2, A3, A4 moved here as T3, T4, T9 | one place for the whole path | EPIC-ZENOD-ALPHA-LAUNCH.md | never |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
