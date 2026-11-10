# EPIC-23: Zenod: our first live test user, then five, then ten

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-our-first-live-test-user-then-five.md
Spine ID: zenod-our-first-live-test-user-then-five-then-ten
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Next goal: one real test user live on Zenod and stable, as soon as possible; then four or five more, then ten, then live. Everything that blocks onboarding him, named and fixed.

Goal sentence: One real test user on Zenod and stable as soon as possible, then five, then ten, then live.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a stranger using Zenod for real is the step before a paying user.

## Done means

- [ ] E23-1 Every blocker to onboarding a stranger is on one page with its owner and state, and every one agents can fix is fixed
- [ ] E23-2 One real test user, not the team, signed up and saving to Zenod over WhatsApp, with no missed save and no unanswered question for 7 days
- [ ] E23-3 Five testers active for a week on the same terms, stable
- [ ] E23-4 Ten testers active, then a go-live decision by Jordi

## Current State

Owner: Delivery manager (zenod)
Status: active
Last attempted: 2026-11-09 23:45Z U1 walked the new-user path on production and listed every blocker on one page; 3 fixed, ask E23-A1 proposed
Result: 11 blockers, 3 fixed today (dead sign-in link restarted, tester renewal alerts reach HQ, invite text), 3 need Jordi, 1 needs infra-vps, 4 close at the first sign-up
Evidence: [e23-u1](evidence/e23-u1-2026-11-09.md), page http://vps3.taild81fbb.ts.net:8921/e23-u1/
Waiting on: Jordi, E23-A1 (proposed by U1, not yet posted): invite one person he knows now as the first tester, without waiting for the rehearsal
Approved work: none
Next action: post E23-A1; on a first name, agents issue that person's tester code and hand Jordi the filled invite (U2), then watch the sign-up live; the rehearsal sign-in (E7-A15, fresh link) runs in parallel if Jordi signs in
Source revision: main (see git log)
Verified at: 2026-11-09T23:45Z (cloud health ok aa46d5e, Phylax connected, readiness ready=true, tester-watch no alerts)

## Waiting on

- [ask E23-A1: decide @Jordi since 2026-11-10 row U2] Invite your first tester now, someone you know, without waiting for the dress rehearsal? Reply with their first name and how you reach them, or "rehearse first" — context: the whole new-user path was walked on production and every blocker is on one page (http://vps3.taild81fbb.ts.net:8921/e23-u1/); three were fixed today; the rehearsal has waited on one sign-in since 3 Nov and cannot test WhatsApp anyway, because your number belongs to your own account — impact: a friend's sign-up proves the last four unproven steps (the free tester checkout, linking WhatsApp, Drive access for an outside account, the new app signed in) and starts the 7 days to your first stable tester — risk: low; nothing is charged (€0, no card); agents make the code, prepare the invite and watch the sign-up live; if something breaks we fix it while they wait — recommend: yes, one friend who sends voice notes and will say when something breaks — why Jordi: only you can pick and contact the person — options: name a person · rehearse first — unblocks: U2 — details: [blockers](evidence/e23-u1-2026-11-09.md) — snoozed until: 2026-11-10T03:52Z

## Non-Goals

- EpicSocial and EpicTeam onboarding (agent_team plans those).
- New features: only what blocks a stranger from using Zenod.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Ticket worker | run_b87fdf63-fc99-4576-88df-9f871a385785 | E23-1: walk the whole new-user path on production as a stranger would and list every onboarding blocker on one page, with owner and state; fix every blocker agents can fix | done (fed E23-A1) | none | main-direct (docs/health, docs/epic7, evidence) | main | [e23-u1](evidence/e23-u1-2026-11-09.md), [page](http://vps3.taild81fbb.ts.net:8921/e23-u1/): 11 blockers, 3 fixed today, 3 need Jordi, 1 infra-vps, 4 at first sign-up; first run of a brand-new account checked locally on main (plan, vault choice, empty chat, no errors) | 2026-11-09T23:45Z | followups: started U4 (tester renewal alerts); park in-app nudge to link WhatsApp after the vault — the invite covers it; park /buy before sign-in shows raw JSON — no public link goes there; confirm: no — the page feeds the ask E23-A1 |
| U2 | Ticket worker | unassigned | E23-2: pick and onboard the first test user from the applications, then watch the first 7 days | draft | U1 | none | main | none | 2026-11-10 | after U1: on E23-A1 (Jordi names one person), issue their code and hand him the filled invite, then watch 7 days |
| U3 | Ticket worker | unassigned | E23-3, E23-4: five, then ten testers | draft | U2 | none | main | none | 2026-11-10 | after U2 |
| U4 | Ticket worker | run_b87fdf63-fc99-4576-88df-9f871a385785 | Tester renewal due, past_due and Stripe read alerts reach the HQ alert thread (health row 10 read testers without Stripe) | done (no confirm: plumbing on our own monitoring, nothing new to open) | U1 | main-direct (docs/health/s1-live) | main | probe reads Stripe at most hourly, keeps those alerts between reads; a tester alert turns row 10 red with its line; installed on VPS3, first Stripe read 2026-11-09T23:36:59Z, row green; test_aggregate 37 OK | 2026-11-09T23:37Z | followups: none |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | Planned from Jordi's voice note (2026-11-09 23:03Z, vn_bd75972d): "Our next incredible goal is getting one test user on Zenote, a live test user on Zenote stablely. One user. One. Let's get the first guy, let's, as soon as possible, to stabilize the service and then the next four or five, then the next 10, then we're live" and "what is missing in terms of me being able to onboard a user?" | U1 lists and fixes onboarding blockers first; U2 (the first user) and U3 stay draft until U1 reports | his voice note | when U1 reports |
| 2026-11-09 | accepted | epic “Zenod: our first live test user, then five, then ten” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-09 23:03Z · 14 min 49 s · $0.039 (gpt-4o-mini-transcribe) · vn_bd75972d Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
