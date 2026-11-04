# EPIC: Zenod Alpha Launch — milestone A: Zenod is production-ready

Status: active
Created: 2026-08-16
Updated: 2026-10-24
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`
Spine ID: ZAL
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Serves (cross-repo): [agent_team EPIC-12 milestone A](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md)
GitHub issues: `https://github.com/zenod-ai/zenod/issues`
Integration branch: `main`
Active spine steward: Zenod delivery manager (Jordi + current bound agent task)
History: [2026-08-16 → 2026-09-16 spine, verbatim](archive/EPIC-ZENOD-ALPHA-LAUNCH-HISTORY-2026-08.md) (role bindings, ZAL-1…ZAL-22 ledger, decisions, gates, evidence, handoff journal)

## Goal

A real user signs up, pays or gets a free pass, uses Zenod over WhatsApp, and is metered and capped.

Goal sentence: A real user signs up, uses Zenod over WhatsApp, and is metered and capped.

## Serves

- Zenod root: [Foundation](EPIC-0-FOUNDATION-SPINE.md) — Zenod in real users' hands is the next milestone (root D14), now with the paid/free-pass path proved.
- Cross-repo: [agent_team EPIC-12 milestone A](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md) ("Zenod live, heard, sold"); its Done means E12-1 cites this spine's Outcome. Plan: agent_team deck `docs/plans/social-agent-plan/index.html`, slides 3–4, approved by Jordi 2026-10-24.

## Done means

- [ ] DOD-1 10 test users active on capped free passes (each signed up, used Zenod over WhatsApp, metered, stopped at the cap).
- [ ] DOD-2 One stranger paid €9 live, end to end through Stripe, and uses Zenod.

## Non-Goals

- Recruiting or posting from this repo: the call for testers is posted by the zenod-social team ([zenod-ai/zenod-social](https://github.com/zenod-ai/zenod-social), spine recruit-testers).
- The deferred owner-analytics screens ZAL-11…ZAL-16 (#1077–#1082) and the voice-note-to-Codex lane.
- Opening testers before caps work (order: EPIC-7 T0–T8, then T9).

## Current State

Status: active
Phase: A0 re-check done and proposed done 2026-10-25 (worker run_f010b4a9); A1–A5 not started
Last verified: 2026-10-25
Last attempted: 2026-11-04 reconcile (run_867502de): Jordi approved A6 and parked its follow-up as A7 ; 2026-11-04 ZAL-A6 iteration 2 (run_107e6293): WhatsApp voice note with Zenod's real replies, Claude Code retrieving a transcript and saving a learning, real console screens with demo data, live at 43d63a1 ; 2026-11-04 ZAL-A6 iteration 2 (product visuals) shipped by worker run_107e6293 (#1495, 43d63a1 live 11:25Z) and in review; before, iteration 1 Paper landing (#1494, a69a78d) ; 2026-11-03 roll-up from children — [EPIC-7](EPIC-7-REAL-USER-TEST.md) (active): everything agents can build for the 5-tester test is live (checkout, caps, tester codes, wording, tester-watch, rotated keys); the rehearsal waits on one Google sign-in (E7-A15) and the leaked-key rolls on one key page (E7-A14). [EPIC-6](EPIC-6-HEALTH-DASHBOARD.md) (active): S1 inventory in review since 2026-10-25; S2–S6 wait for Jordi to accept S1. A0 re-check proposed done 2026-10-25; A1 voice test and A5 live billing not started
Result: production is up (health ok on 5aa4fe4, 2026-11-03) and ready for testers apart from the rehearsal; no tester invited yet; live billing never performed
Production 2026-10-25: `cloud.zenod.dev/api/health` status ok, sha `ae3e77a3b794a44f78b8f64323f67da28bd4d983`; Dokploy `zenod-mt` on `ghcr.io/zenod-ai/zenod:sha-ae3e77a`; production-readiness still lists 5 advisory failures (Stripe webhook/portal/live billing journey, backup restore, Drive acceptance), all A5 or later. Public Google registration and paid checkout opened 2026-09-16 on `83c2752` ([receipt](evidence/public-opening-2026-09-16/README.md)); live billing and Drive acceptance never performed.
Finding 2026-10-25 (resolved): the `deploy` job's Dokploy 404 was not a moved app id: `dokploy.polyqu.com` was closed on 2026-10-22 (Dokploy is Tailscale-only), so GitHub runners cannot reach it. The VPS1 deploy poller (infra-vps EPIC-10-A9) already rolls `zenod-mt` after `publish`; #1435 turns `deploy` into a health-sha check and the two `DOKPLOY_*` GitHub secrets were removed. `scripts/deploy-fleet.sh` is manual-only and refuses on Dokploy v0.30 (`project.all` no longer returns images); not needed for the push path.
Waiting on: Jordi, through EPIC-7: E7-A15 (one sign-in) and E7-A14 (key page); EPIC-6 waits on his S1 review
Waiting on (ZAL-A6-A1): answered 2026-11-04 ; A6 done (Jordi approved 2026-11-04, c00a3d3), Paper landing with product visuals live at 43d63a1 ; A7 (restyle pricing and connect) parked as draft by Jordi
Next action: EPIC-7 T7 rehearsal once Jordi signs in, then T8 go/no-go and the five invites
Verified at: 2026-11-04T11:25Z health sha 43d63a1, zenod.dev serves the product visuals, A6 card fields checked against the gate ; 2026-11-03 child Current States read; live health 5aa4fe4

## Waiting on

- [answered ZAL-A6-A1 2026-11-04 @Jordi · done 2026-11-04] Pick a landing direction at http://vps3.taild81fbb.ts.net:8741/ — answer: "i choose A please" (Team desk chat) — A6 ready, worker dispatched

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | Tester | worker run_f010b4a9 | ZAL-A0 · Re-check prod after the infra-vps cleanup | proposed done | - | [#1435](https://github.com/zenod-ai/zenod/pull/1435) | `main` | Signup → WhatsApp → console journey passes end to end on today's infra; deployed SHA recorded; push-to-main deploy rolls prod again (Dokploy 404 fixed). | 2026-10-25: prod health ok on `ae3e77a`; WhatsApp connected; push-to-main roll proven by run 40160156776 ([evidence](evidence/zal-a0-2026-10-25.md)); authenticated console not exercised. | 2026-10-25 | Accept as done (or require the authenticated console check with A1). |
| A1 | Tester | Jordi | ZAL-A1 · Jordi's voice test (pending since 2026-08-27) | draft | A0 | - | - | 3 overlapping voice notes, 3 clean Saved receipts, no re-pair. | ZAL-22 #1099 awaiting acceptance | 2026-10-24 | Ask Jordi once A0 is green. |
| A2 | Ticket worker | - | ZAL-A2 · Metering + caps per plan | moved | - | - | - | Moved to [EPIC-7](EPIC-7-REAL-USER-TEST.md) T3 on 2026-10-27. | - | 2026-10-27 | see EPIC-7 |
| A3 | Ticket worker | - | ZAL-A3 · Free-pass code with a capped allowance | moved | - | - | - | Moved to [EPIC-7](EPIC-7-REAL-USER-TEST.md) T4 on 2026-10-27. | - | 2026-10-27 | see EPIC-7 |
| A4 | Recruiter (zenod-social) | - | ZAL-A4 · Recruit test users | moved | - | - | - | First wave of 5 moved to [EPIC-7](EPIC-7-REAL-USER-TEST.md) T9 on 2026-10-27; later waves toward DOD-1 come after it. | - | 2026-10-27 | see EPIC-7 |
| A5 | Operator | Jordi + worker | ZAL-A5 · Stripe live: business verification + one live €9 payment | draft | A0 | - | - | Stripe business profile verified; one live €9 payment end to end (DOD-2) on price `price_1U8jip80yG7aohEW6tZnFgZq`. | Price approved 2026-08-26 (history) | 2026-10-24 | Ask Jordi for the business verification when next. |
| A6 | Ticket worker | run_107e6293 (it.2; it.1 run_c49da4e3) | ZAL-A6 · Cleaner landing: parallel beta of zenod.dev | done (approved by Jordi 2026-11-04) | - | [#1495](https://github.com/zenod-ai/zenod/pull/1495) merged 43d63a1 (it.1 [#1494](https://github.com/zenod-ai/zenod/pull/1494) a69a78d; beta 74977f7, docs only) | `main` | Beta landing on a temporary tailnet link beside the live `apps/site` (untouched): fewer columns, larger lighter diagrams, generated imagery, human copy; 3 directions + low-hanging-fruit list; Jordi picks before `apps/site` changes. | 2026-11-04 it.2: product visuals live on https://zenod.dev/ at 43d63a1 (health sha verified 11:25Z): WhatsApp voice note with the real replies, Claude Code retrieving a transcript and saving a learning, real console screens; [evidence](evidence/zal-a6-2026-11-04.md), [card](cards/A6.md). Before: it.1 Paper landing a69a78d; 2026-11-03 directions A/B/C at http://vps3.taild81fbb.ts.net:8741/ | 2026-11-04 | followups: started A7 |
| A7 | Ticket worker | unassigned | restyle the pricing and connect pages in the Paper style: follow-up of A6 | draft | A6 | none | main | none | parked by Jordi when closing A6 2026-11-04 | 2026-11-04 | Jordi starts it from the goal when wanted |

Superseded from the history board: ZAL-4 #1061 (production gate) → A0/A5; ZAL-5 #1062 (stranger journey) → A0 + DOD-2; ZAL-6 #1063 (invitation draft) → A4 via zenod-social.

## Human Gates

| Gate | Human Owner | Exact approval / input | What may continue without it |
|---|---|---|---|
| Voice test | Jordi | A1 three-note result | A2, A3 |
| Stripe business verification + live €9 | Jordi | A5 verification and approval of the one live payment | Free-pass work (A2–A4) |
| Public call for testers | Jordi (via zenod-social) | Exact post content, per zenod-social's own gate | Everything here |

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-08-16 → 2026-09-16 | 21 decisions (alpha milestone, €9 single plan, WhatsApp as Zenod access, Phylax hidden, Ring absent, two-service voice/Drive contract, public opening) | Kept verbatim | [history page](archive/EPIC-ZENOD-ALPHA-LAUNCH-HISTORY-2026-08.md#decisions) and its appendix |
| 2026-10-24 | Revived as milestone A "Zenod is production-ready" under agent_team EPIC-12, steps A0–A5; plan approved by Jordi 2026-10-24. | One concrete finish line: 10 capped free-pass users and one live €9 payment; testers only after caps work. | agent_team deck slides 3–4; [EPIC-12](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md) |
| 2026-10-27 | A2, A3, A4 moved to EPIC-7 (real-user production test, first 5 testers); Jordi: caps before testers, testers never charged, 1-month code extended monthly. | One epic for the whole path to testers. | [EPIC-7](EPIC-7-REAL-USER-TEST.md) |
| 2026-10-24 | Old detail moved, not deleted, to the history page; stale sibling spines closed or superseded. | 707-line spine → under the 150-line budget; one active board. | [TIDY-2026-10-24](TIDY-2026-10-24.md) |
| 2026-11-04 | ZAL-A6: landing direction A (Paper) chosen for zenod.dev; A6 stamped ready (root L-37). Decided by Jordi via Team desk chat, verbatim: "i choose A please". | His answer to ZAL-A6-A1 is the ready stamp; B and C stay beta-only. | [directions](http://vps3.taild81fbb.ts.net:8741/) |
| 2026-11-04 | ZAL-A6 brief for direction A, by Jordi via Team desk chat, verbatim: "i want to lean on whatsapp as a way in, as are code agents, and go thgouth ingestion, digestion, retrieval and land the concept and land the value of having your memory store for mining and self custoydy, etc. first class voice treatment". Story: WhatsApp and code agents as the ways in → ingestion → digestion → retrieval → the value of owning your memory store (mining it, self-custody); voice first class. | His brief for the A6 build. | Team desk chat 2026-11-04 |


## Spine Map

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| HEALTH | child | [EPIC-6: health.zenod.dev — one page that shows whether Zenod is up](EPIC-6-HEALTH-DASHBOARD.md) | Before testers arrive, anyone can see in one page whether the site, the database, the WhatsApp relay and the agents are alive, and when each last did real work. | review | none | none | 2026-10-25 | S1–S6 done, E6-1..E6-4 met 2026-11-03 (af4a490); waits on Jordi's epic verdict |
| real-user-production-test-5-testers-on-free-passes | child | [EPIC-7: Real-user production test — 5 testers on free passes](EPIC-7-REAL-USER-TEST.md) | Five real people use production Zenod as ordinary users, capped and never charged, before Zenod goes truly live. | ready | none | none | 2026-10-27 | fill Goal, Serves and Done means |
