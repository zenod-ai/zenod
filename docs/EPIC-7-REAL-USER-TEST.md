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
Last attempted: 2026-11-01 wake run_2f8237e5: T2.1, T2.3, T2.5, T2.6, T2.7 done; T3 built, waits on E7-A2; T2.4 dispatched (run_2d7be545); before: 2026-11-01 Delivery Manager wake run_faa97bf7 stamped T2.1–T2.7 and T3 ready (E7-A3) and dispatched T3, T2.1, T2.3, T2.5, T2.6, T2.7 (6 workers); before: 2026-10-31 T0 (run_af659956) and T1 (run_b7be352f) finished and integrated; before: 2026-10-31 Delivery Manager wake run_b793ac36 dispatched T0 (run_af659956) and T1 (run_b7be352f) in parallel on seat1; before: 2026-10-27 created from Jordi's brief (testers = production users, not charged; caps first; 1-month free code, extended monthly, never charged; Zenod production number; start with 5)
Result: T1 done 2026-10-31 ([map](evidence/epic7-t1-new-user-path-2026-10-31.md)): signup, €0 checkout and tenant creation work live (2 €0 subscriptions); phone link, Saved reply and console view never seen for a checkout-created user; renewal with no card bills €9 then suspends silently; AI spend cap is log-only and the Phylax allowance is effectively uncapped (T3 input). 7 gaps added as draft T2.1–T2.7. T0 done 2026-10-31 ([proof](evidence/epic7-t0-2026-10-31.md)): fresh backup-restore drill, live readiness ready=true, checkout open again (until the proof expires 2026-12-01, tracked in T2.3). Finding 2026-10-27: paid checkout is off in production (`/api/public/production-readiness` ready=false, only blocking check `backup_restore`), so no one can sign up, free code or not, until T0.
Evidence: [T0 proof](evidence/epic7-t0-2026-10-31.md), [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md); live readiness ready=true read 2026-10-31
Waiting on: Jordi, asks E7-A2 (cap figure) and E7-A5 (ready T4–T6 + live Stripe codes), below
Approved work: T0..T9 as planned (Jordi readied the epic 2026-10-31)
Next action: on E7-A2 set the cap and prove a capped reply (T3); on E7-A5 dispatch T4 (+T2.2), then T5 and T6; then T7 with Jordi (includes the T2.4 phone-link script)
Monitoring: Drive OAuth readiness proof since 2026-11-01 until 2026-11-28 · next check 2026-11-21 (watcher warning) · then raise a `do` ask for Jordi to renew it in Google Cloud console, or set the tester allowlist
Source revision: see git log
Verified at: 2026-11-01 (live health 1707c9f, readiness ready=true, keeper/watch timers on VPS1, Recent saves in live bundle)

## Waiting on

- [ask E7-A5: approve @Jordi since 2026-11-01 row T4] Stamp T4, T5 and T6 `ready` (and with T4, retire the open free-forever code T2.2) — context: every gap T1 found is now closed or folded into T7; what is left before your rehearsal is the tester codes (T4: one live Stripe coupon "Zenod tester", 100% off, one single-use code per person, never charged, plus the monthly free-extension coupon T2.1 proved), the tester wording (T5) and one place to watch testers (T6); they are draft and only you ready rows — impact: T7 cannot start without them; nothing else in EPIC-7 can run meanwhile except T3 once you answer E7-A2 — risk: T4/T2.2 change live Stripe (€0 coupons only, no charges; the free-forever code is turned off, the 2 people already on it are untouched); rollback: deactivate the new coupon/codes, re-enable the old code — recommend: ready all three and approve the T4 + T2.2 Stripe changes in the same answer, so testers each get their own code and the open code stops working — why Jordi: only you ready rows, and these change live billing — unblocks: T4, T5, T6, T2.2, then T7 — details: [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md), [T2.1](evidence/epic7-t2-1-2026-11-01.md)
- [answered E7-A4 2026-11-01 @Delivery-Manager] Fold T2.4's phone-link check into T7? — answer: yes, T7 runs it — why: agents cannot link a phone (no project WhatsApp sender) and T7 already has you link a phone and send voice notes; one session instead of two — rollback: reopen T2.4 and run its script separately ([T2.4](evidence/epic7-t2-4-2026-11-01.md)). Note for T7: your number is bound to your comped account, so T7 needs a second WhatsApp number or a disconnect/relink.
- [ask E7-A2: approve @Jordi since 2026-11-01 row T3] Turn usage caps on: $3 of AI per user per month, keeping 1,000,000 WhatsApp/voice units — context: T3 built the cap (Zenod stops before any AI call and tells the user why, on WhatsApp and in the console) but it stays off until you pick the figure (root D30 needs your go) — impact: caps must be on before testers are invited; 5 testers cost at most $15/month in AI — risk: your own account is capped too (last September would have hit $3 around the 20th); the overall units limit must rise to 4,000,000 in the same change or WhatsApp pauses for everyone, so both are set together — rollback: remove the setting and redeploy, or switch to measure-only — recommend: yes, $3 is a third of the €9 plan and covers roughly 300–700 saves a month on today's model, about 10× your October use — why Jordi: D30 reserves the figure and switching blocking on to you — steps: on `zenod-mt` set `ZENOD_TENANT_MONTHLY_ALLOWANCE_USD=3` and `ZENOD_MASTER_ALLOWANCE_UNITS=4000000`, redeploy, roll Phylax for the new wording, prove a capped reply — unblocks: T3, E7-1, T7 — details: [T3 evidence](evidence/epic7-t3-2026-11-01.md)
- [answered E7-A3 2026-11-01 @Jordi · done 2026-11-01 rows stamped ready] Stamp T2.1–T2.7 and T3 `ready` so workers can start them — context: T1 mapped the signup path and found 7 gaps (renewal with no card, the open free-forever code, checkout closing again on 2026-11-28, phone link/Saved never proven, console has no list of saved replies, raw-JSON closed page, backups pausing WhatsApp); they and T3 (caps) are draft, and only you can ready a row — impact: T0 and T1 are done, so nothing in EPIC-7 can run until these are ready; each day waiting delays the tester invites — risk: low, each row is reversible code/docs work; live Stripe changes (T2.2) still come back as their own ask — recommend: ready all eight now; T2.5 can wait for your call on what 'visible in console' means — why Jordi: only Jordi stamps rows ready — details: [T1 map](evidence/epic7-t1-new-user-path-2026-10-31.md) — answer: APPROVED — Approved by the agent_team manager thread on Jordi's word 2026-10-31 ("mark ready whatever needs to be marked ready"; EPIC-7 Approved work T0..T9). Stamp T2.1-T2.7 and T3 ready and dispatch them. T2.5 too, with the reading "saved replies listed in the console". Live Stripe changes (T2.2) still come back as their own ask. (given in the console 2026-11-01, written in by Unblocker)

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
| T2.1 | Ticket worker | worker run_4981891b | Renewal with no card never charges and never cuts a tester off without a Zenod message | done | none (test mode; live check after T4) | [#1447](https://github.com/zenod-ai/zenod/pull/1447) | main | [T2.1 proof](evidence/epic7-t2-1-2026-11-01.md): sandbox test clocks: a `once` 100% coupon each month renews at €0 with no card (3 renewals); lapse → Zenod notices the user before suspension; dahlia invoice-event fix; live 7036210 | 2026-11-01 | live extension coupon with T4; first live €0 renewal at T10 |
| T2.2 | Ticket worker | unassigned | Retire or limit the existing live 100%-off-forever promotion code (unlimited, no expiry, used twice) | ready | T4; own live-Stripe ask | - | main | T1 other findings | 2026-10-31 | live Stripe change: ask tier when next |
| T2.3 | Ticket worker | worker run_270a1706 | Keep checkout open for the whole test: alerts/renewal for backup_restore (31 d), Drive login check (expires 2026-11-28), stripe_profile (2026-12-14) | done | T0 | [#1444](https://github.com/zenod-ai/zenod/pull/1444) | main | [T2.3 proof](evidence/epic7-t2-3-2026-11-01.md) 203f0dc: VPS1 readiness keeper (daily 04:30, drill when ≥24 d, Stripe re-check ≥60 d) + hourly watch → HQ alert queue; first drill green; backup proof to 2026-12-02, stripe_profile to 2027-01-30; live ready=true | 2026-11-01 | Drive OAuth check is Jordi-only, expires 2026-11-28 (watch warns from 11-21); off-host copy unencrypted |
| T2.4 | Ticket worker | worker run_2d7be545 | Prove vault → phone link → Saved for a checkout-created €0 tenant | done | T0, T2.1 | - | main | [T2.4 proof](evidence/epic7-t2-4-2026-11-01.md) 0650afd: Phylax rolled to sha-1707c9f (rollback digest 13c5710c…), connected, 1 probe 502 at roll; lapse notice + cap wording live. Phone link needs a human WhatsApp sender (none project-owned) → folded into T7 | 2026-11-01 | T7 needs a second WhatsApp number or a disconnect/relink of Jordi's (his is bound to the comped tenant) |
| T2.5 | Ticket worker | worker run_a356adb3 | Console shows the user their Saved replies (today only 'Last message' time) | done | none | [#1445](https://github.com/zenod-ai/zenod/pull/1445) | main | [T2.5 proof](evidence/epic7-t2-5-2026-11-01.md): Recent saves card (last 20 captures, Saved reply, vault link), tenant isolation tested; live 7036210; on prod the comped tenant projects 20/20 rows | 2026-11-01 | signed-in view checked at T7 |
| T2.6 | Ticket worker | worker run_50c9297c | Closed checkout shows a readable 'signup paused' page, not raw JSON | done | none | [#1443](https://github.com/zenod-ai/zenod/pull/1443) | main | [T2.6 evidence](evidence/epic7-t2-6-2026-11-01.md): browsers get a 503 "Signup is paused" page, API keeps JSON; tests + local run; live sha 9657aa5 | 2026-11-01 | none (side note: `/buy` signed-out still JSON 401) |
| T2.7 | Ticket worker | worker run_c0ce62d5 | Backups pause the live Phylax WhatsApp receiver (~5 min seen 2026-10-31 23:17–23:22 UTC): schedule off-peak or back up without pausing | done | T0 | [#1448](https://github.com/zenod-ai/zenod/pull/1448) | main | [T2.7 proof](evidence/epic7-t2-7-2026-11-01.md): live-snapshot backup pauses Phylax 725 ms (was ~5 min), WhatsApp stayed connected, 1612/1612 probes ok, restore verified; keeper uses it | 2026-11-01 | none |
| T3 | Ticket worker | worker run_00766eb6 | Metering + caps per plan (was ZAL A2): every user's usage counted; a cap on the plan; at the cap Zenod stops and tells the user why | blocked | T1 (done) | [#1446](https://github.com/zenod-ai/zenod/pull/1446) | main | [T3 evidence](evidence/epic7-t3-2026-11-01.md): blocking AI cap + WhatsApp/console cap message merged (93d7ba9), live sha 7036210; off until the allowance env is set; Phylax wording live (T2.4 roll) | 2026-11-01 | waits on E7-A2; then set env + prove a capped reply on prod |
| T4 | Ticket worker | unassigned | Tester codes (was ZAL A3): one live Stripe coupon "Zenod tester" 100% off, 1 month; one promotion code per person, single use, unused codes expire in 14 days; month-by-month extension = a fresh 100% coupon on that subscription before renewal; list of who got which code kept private on VPS1, never in a repo | draft | T0 | - | main | checkout already has `allow_promotion_codes` + `payment_method_collection: if_required` (customerBilling.ts) | 2026-10-27 | create coupon + one test code; prove a €0 checkout needs no card and what happens at renewal with no card (must never charge, must not cut the user off unannounced) |
| T5 | Ticket worker | unassigned | Tester wording: invite DM, checkout/welcome text and console say plainly: no payment details needed, you will not be charged, 1 month free, extended month by month while you test and give feedback, we will never charge you | draft | T4 | - | main | none | 2026-10-27 | draft in Jordi's voice (zenod-social message house); Jordi reviews after the fact |
| T6 | Ticket worker | unassigned | Watching testers: one place showing per tester signup, WhatsApp linked, last Saved reply, usage vs cap, errors; feedback channel named in the invite | draft | T3 | - | main | [EPIC-6](EPIC-6-HEALTH-DASHBOARD.md) health page | 2026-10-27 | reuse EPIC-6 where it fits |
| T7 | Tester | Jordi + worker | Dress rehearsal as a new user: fresh Google account, own tester code, €0 checkout, WhatsApp to the Zenod production number, 3 voice notes → 3 Saved replies, all visible in the console; a test account pushed to its cap is stopped with the message; Stripe shows €0 and no card | draft | T0–T6 | - | main | includes T2.4 phone-link script ([T2.4](evidence/epic7-t2-4-2026-11-01.md)) | 2026-10-27 | worker watches logs live while Jordi runs it; also covers ZAL A0's console check |
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
| 2026-11-01 | accepted | decided by Delivery Manager: T2.1 no longer waits on T4 — its proof is in Stripe test mode and needs no live coupon; the live renewal check runs after T4 | lets T2.1 start now | this commit | rollback: set Depends On back to T4 |
| 2026-11-01 | accepted | decided by Delivery Manager: T2.4's phone-link → Saved → console proof is folded into T7 (Jordi's dress rehearsal), since agents have no WhatsApp sender and the steps are T7's own — why: one session for Jordi instead of two — rollback: reopen T2.4 and run its 6-step script separately |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
