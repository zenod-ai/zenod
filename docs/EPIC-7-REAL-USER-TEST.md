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
Status: active
Last attempted: 2026-10-31 T0 (run_af659956) and T1 (run_b7be352f) finished and integrated; before: 2026-10-31 Delivery Manager wake run_b793ac36 dispatched T0 (run_af659956) and T1 (run_b7be352f) in parallel on seat1; before: 2026-10-27 created from Jordi's brief (testers = production users, not charged; caps first; 1-month free code, extended monthly, never charged; Zenod production number; start with 5)
Result: T1 done 2026-10-31 ([map](evidence/epic7-t1-new-user-path-2026-10-31.md)): signup, €0 checkout and tenant creation work live (2 €0 subscriptions); phone link, Saved reply and console view never seen for a checkout-created user; renewal with no card bills €9 then suspends silently; AI spend cap is log-only and the Phylax allowance is effectively uncapped (T3 input). 7 gaps added as draft T2.1–T2.7. T0 done 2026-10-31 ([proof](evidence/epic7-t0-2026-10-31.md)): fresh backup-restore drill, live readiness ready=true, checkout open again (until the proof expires 2026-12-01, tracked in T2.3). Finding 2026-10-27: paid checkout is off in production (`/api/public/production-readiness` ready=false, only blocking check `backup_restore`), so no one can sign up, free code or not, until T0.
Evidence: [T0 proof](evidence/epic7-t0-2026-10-31.md), [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md); live readiness ready=true read 2026-10-31
Waiting on: Jordi, ask E7-A3 (below)
Approved work: T0..T9 as planned (Jordi readied the epic 2026-10-31)
Next action: on E7-A3, dispatch T2.x and T3 (T3 starts from the T1 metering findings)
Source revision: see git log
Verified at: 2026-10-31 (readiness ready=true and backup_restore ok read live; health sha ae3e77a)

## Waiting on

- [answered E7-A3 2026-11-01 @Jordi] Stamp T2.1–T2.7 and T3 `ready` so workers can start them — context: T1 mapped the signup path and found 7 gaps (renewal with no card, the open free-forever code, checkout closing again on 2026-11-28, phone link/Saved never proven, console has no list of saved replies, raw-JSON closed page, backups pausing WhatsApp); they and T3 (caps) are draft, and only you can ready a row — impact: T0 and T1 are done, so nothing in EPIC-7 can run until these are ready; each day waiting delays the tester invites — risk: low, each row is reversible code/docs work; live Stripe changes (T2.2) still come back as their own ask — recommend: ready all eight now; T2.5 can wait for your call on what 'visible in console' means — why Jordi: only Jordi stamps rows ready — details: [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md) — answer: APPROVED — Approved by the agent_team manager thread on Jordi's word 2026-10-31 ("mark ready whatever needs to be marked ready"; EPIC-7 Approved work T0..T9). Stamp T2.1-T2.7 and T3 ready and dispatch them. T2.5 too, with the reading "saved replies listed in the console". Live Stripe changes (T2.2) still come back as their own ask. (given in the console 2026-11-01, written in by Unblocker)

## Non-Goals

- Charging testers, ever. Live €9 for a stranger stays [ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md) A5.
- A separate tester mode or tester exceptions in code: testers are ordinary production users on the normal plan and caps; only the price differs (a coupon).
- Posting a public call for testers: invites go by DM to people who already answered (zenod-social). The wider call is ZAL DOD-1's later waves.
- More than 5 testers in this wave.

## Issue Ledger

Steps: each is independently testable and closes only with evidence. T0–T6 must all pass before T7; nobody is invited before T8.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| T0 | Ticket worker | worker run_af659956 | Turn checkout back on: fresh backup-restore proof so `backup_restore` passes and readiness says ready=true | done | none | - | main | [T0 proof](evidence/epic7-t0-2026-10-31.md) 6cf5d28: two-volume backup + isolated restore verified, off-host copy byte-checked, `ZENOD_BACKUP_RESTORE_VERIFIED_AT=2026-10-31T23:23:49Z`; live readiness ready=true (read by DM 2026-10-31) | 2026-10-31 | proof expires 2026-12-01 23:23Z → T2.3 |
| T1 | Ticket worker | worker run_b7be352f | Map the new-user path in code and on prod: Google signup → checkout with a 100% code (€0, no card) → tenant created → user's phone linked to their tenant on the Zenod production number (Phylax) → first Saved reply → console | done | none | - | main | [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md) da4f983, e53e1d4: signup, €0 checkout, tenant work; phone link, Saved, console never seen for a checkout user; 7 gaps → T2.1–T2.7 | 2026-10-31 | none |
| T2 | Ticket worker | unassigned | Close the gaps T1 finds (one row each, added by T1) | draft | T1 | - | main | [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md): split into T2.1–T2.7 | 2026-10-31 | Jordi stamps T2.x ready (E7-A3) |
| T2.1 | Ticket worker | unassigned | Renewal with no card never charges and never cuts a tester off without a Zenod message | draft | T4 | - | main | T1 step 2b: month 2 bills €9, past_due, then cancel + suspend silently | 2026-10-31 | test-mode proof €0 renews at €0; extension procedure written |
| T2.2 | Ticket worker | unassigned | Retire or limit the existing live 100%-off-forever promotion code (unlimited, no expiry, used twice) | draft | T4 | - | main | T1 other findings | 2026-10-31 | live Stripe change: ask tier when next |
| T2.3 | Ticket worker | unassigned | Keep checkout open for the whole test: alerts/renewal for backup_restore (31 d), Drive login check (expires 2026-11-28), stripe_profile (2026-12-14) | draft | T0 | - | main | T1 step 0; T0: backup proof expires 2026-12-01, no scheduled drill; off-host copy not in `zenod-prod-crypt:` (only on Jordi's Mac) | 2026-10-31 | or testers on the existing checkout allowlist |
| T2.4 | Ticket worker | unassigned | Prove vault → phone link → Saved for a checkout-created €0 tenant | draft | T0, T2.1 | - | main | T1 steps 4–5 unverified | 2026-10-31 | may merge into T7 |
| T2.5 | Ticket worker | unassigned | Console shows the user their Saved replies (today only 'Last message' time) | draft | none | - | main | T1 step 6 | 2026-10-31 | build, or Jordi redefines E7-3 'saw it in their console' |
| T2.6 | Ticket worker | unassigned | Closed checkout shows a readable 'signup paused' page, not raw JSON | draft | none | - | main | T1 step 0 | 2026-10-31 | - |
| T2.7 | Ticket worker | unassigned | Backups pause the live Phylax WhatsApp receiver (~5 min seen 2026-10-31 23:17–23:22 UTC): schedule off-peak or back up without pausing | draft | T0 | - | main | T1 other findings | 2026-10-31 | - |
| T3 | Ticket worker | unassigned | Metering + caps per plan (was ZAL A2): every user's usage counted; a cap on the plan; at the cap Zenod stops and tells the user why | draft | T1 (done) | - | main | builds on ZAL-10 #1076, Phylax usage ledger (root D29), per-tenant metering (root D30) | 2026-10-27 | audit what is live vs merged, then close the gap; ask E7-A2 (cap figure) with the audit's numbers |
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
| 2026-11-01 | accepted | Jordi (E7-A3, via the agent_team manager thread 2026-10-31): stamp T2.1–T2.7 and T3 ready and dispatch them; T2.5 reads E7-3 as "saved replies listed in the console"; live Stripe changes (T2.2) come back as their own ask | Delivery manager stamps the eight rows ready on this answer | console answer jr_2bf7e47b, Waiting on E7-A3 | if Jordi reverses the card |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
