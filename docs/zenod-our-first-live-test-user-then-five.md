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

Owner: unassigned
Status: ready
Last attempted: 2026-11-10 planned from Jordi's voice note vn_bd75972d; U1 dispatched
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: U1 walks the new-user path and lists every onboarding blocker
Source revision: uncommitted scaffold
Verified at: 2026-11-10

## Non-Goals

- EpicSocial and EpicTeam onboarding (agent_team plans those).
- New features: only what blocks a stranger from using Zenod.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Ticket worker | unassigned | E23-1: walk the whole new-user path on production as a stranger would and list every onboarding blocker on one page, with owner and state; fix every blocker agents can fix | ready | none | none | main | none | 2026-11-10 | dispatched 2026-11-10 |
| U2 | Ticket worker | unassigned | E23-2: pick and onboard the first test user from the applications, then watch the first 7 days | draft | U1 | none | main | none | 2026-11-10 | after U1; picking and inviting a person is Jordi's call (ask) |
| U3 | Ticket worker | unassigned | E23-3, E23-4: five, then ten testers | draft | U2 | none | main | none | 2026-11-10 | after U2 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | Planned from Jordi's voice note (2026-11-09 23:03Z, vn_bd75972d): "Our next incredible goal is getting one test user on Zenote, a live test user on Zenote stablely. One user. One. Let's get the first guy, let's, as soon as possible, to stabilize the service and then the next four or five, then the next 10, then we're live" and "what is missing in terms of me being able to onboard a user?" | U1 lists and fixes onboarding blockers first; U2 (the first user) and U3 stay draft until U1 reports | his voice note | when U1 reports |
| 2026-11-09 | accepted | epic “Zenod: our first live test user, then five, then ten” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-09 23:03Z · 14 min 49 s · $0.039 (gpt-4o-mini-transcribe) · vn_bd75972d Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
