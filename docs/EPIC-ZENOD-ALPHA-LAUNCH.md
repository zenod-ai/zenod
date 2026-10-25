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

## Serves

- Zenod root: [Foundation](EPIC-0-FOUNDATION-SPINE.md) — Zenod in real users' hands is the next milestone (root D14), now with the paid/free-pass path proved.
- Cross-repo: [agent_team EPIC-12 milestone A](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md) ("Zenod live, heard, sold"); its Done means E12-1 cites this spine's Outcome. Plan: agent_team deck `docs/plans/social-agent-plan/index.html`, slides 3–4, approved by Jordi 2026-10-24.

## Done means

- [ ] DOD-1 10 test users active on capped free passes (each signed up, used Zenod over WhatsApp, metered, stopped at the cap).
- [ ] DOD-2 One stranger paid €9 live, end to end through Stripe, and uses Zenod.

## Non-Goals

- Recruiting or posting from this repo: the call for testers is posted by the zenod-social team ([zenod-ai/zenod-social](https://github.com/zenod-ai/zenod-social), spine recruit-testers).
- The deferred owner-analytics screens ZAL-11…ZAL-16 (#1077–#1082) and the voice-note-to-Codex lane.
- Opening testers before caps work (order: A0 → A2/A3 → A4).

## Current State

Status: active
Phase: revived 2026-10-24 as milestone A of agent_team EPIC-12; steps A0–A5 defined, none started
Last verified: 2026-10-24
Last attempted: 2026-10-25 Epic Spine health wake (run_bad0b5fb) dispatched A0 as worker run_f010b4a9; EPIC-6 answered internal-only (EPIC-6-A1); earlier: revived this spine (history moved, A0–A5 ledger, tidy of stale spines: [TIDY-2026-10-24](TIDY-2026-10-24.md))
Result: plan in place; production facts below are as last recorded, not re-checked today
Production as last recorded: public Google registration and paid checkout opened 2026-09-16 on `83c2752` ([receipt](evidence/public-opening-2026-09-16/README.md)); live billing and Drive acceptance never performed; the infra-vps cleanup has since changed the hosts, so nothing is assumed working until A0.
Finding 2026-10-24: push-to-main auto-deploy (root D27) is broken: the `deploy` job of Publish image fails with a Dokploy API 404 on `abd85dd` and `51a3b06` (run 40118507158 family), so `main` publishes images but no longer rolls prod; `cloud.zenod.dev/api/health` reports `abd85dd`, status ok. A0 includes fixing this (likely the app/project moved in the infra-vps cleanup).
Waiting on: nobody. A1 (Jordi's voice test) is asked only when it is the next step.
Next action: A0 — re-check prod end to end on today's infra (signup → WhatsApp → console), read-only, and record the deployed SHA from `https://cloud.zenod.dev/api/health`.
Verified at: 2026-10-24 (spine only)

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | Tester | run_f010b4a9 | ZAL-A0 · Re-check prod after the infra-vps cleanup | active | - | run_f010b4a9 | `main` | Signup → WhatsApp → console journey passes end to end on today's infra; deployed SHA recorded; push-to-main deploy rolls prod again (Dokploy 404 fixed). | 2026-09-16 opening receipt (pre-cleanup) | 2026-10-25 | Worker running; repairs only what the journey breaks. |
| A1 | Tester | Jordi | ZAL-A1 · Jordi's voice test (pending since 2026-08-27) | draft | A0 | - | - | 3 overlapping voice notes, 3 clean Saved receipts, no re-pair. | ZAL-22 #1099 awaiting acceptance | 2026-10-24 | Ask Jordi once A0 is green. |
| A2 | Ticket worker | unassigned | ZAL-A2 · Metering + caps per plan | draft | A0 | - | - | Every user's usage counted; a cap per plan; at the cap the service stops and asks for a top-up. | Builds on ZAL-10 #1076 (managed cap lifecycle), Phylax usage ledger (root D29) and per-tenant metering (root D30) | 2026-10-24 | Audit what is live vs merged, then close the gap. |
| A3 | Ticket worker | unassigned | ZAL-A3 · Free-pass code with a capped allowance | draft | A2 | - | - | A code grants a capped free allowance; abuse stops at the cap. | none | 2026-10-24 | After A2. |
| A4 | Recruiter (zenod-social) | zenod-social team | ZAL-A4 · Recruit 10 test users | draft | A2, A3 | - | - | Reddit call for testers posted by zenod-social (spine recruit-testers); 10 users active on free passes (DOD-1). | none | 2026-10-24 | Signal zenod-social only after A2/A3 pass. |
| A5 | Operator | Jordi + worker | ZAL-A5 · Stripe live: business verification + one live €9 payment | draft | A0 | - | - | Stripe business profile verified; one live €9 payment end to end (DOD-2) on price `price_1U8jip80yG7aohEW6tZnFgZq`. | Price approved 2026-08-26 (history) | 2026-10-24 | Ask Jordi for the business verification when next. |

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
| 2026-10-24 | Old detail moved, not deleted, to the history page; stale sibling spines closed or superseded. | 707-line spine → under the 150-line budget; one active board. | [TIDY-2026-10-24](TIDY-2026-10-24.md) |


## Spine Map

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| HEALTH | child | [EPIC-6: health.zenod.dev — one page that shows whether Zenod is up](EPIC-6-HEALTH-DASHBOARD.md) | Before testers arrive, anyone can see in one page whether the site, the database, the WhatsApp relay and the agents are alive, and when each last did real work. | active | none | none | 2026-10-25 | S1 (inventory) running; S4 is tailnet-only per EPIC-6-A1 |
