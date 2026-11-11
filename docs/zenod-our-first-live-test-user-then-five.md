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
Last attempted: 2026-11-11 00:13Z U5 ready check for full promotion on production: Jordi as tester zero, the standard question set, the tester path and helpers at launch
Result: not ready yet, two blockers, both asked already: a stranger gets no tester code (E26-A3) and no email with the link (E26-A6). Green: Jordi's memories go in from WhatsApp, EpicTeam and MCP, get filed and read back; the same questions run on every change against the run before (93.8 / 100 / 1.6 on his notes); testers now start with helpers off (E23-A2), live 7d40f51
Evidence: [e23-u5](evidence/e23-u5-2026-11-10.md), page http://vps3.taild81fbb.ts.net:8921/e23-u5/ ; earlier [e23-u1](evidence/e23-u1-2026-11-09.md), page http://vps3.taild81fbb.ts.net:8921/e23-u1/
Waiting on: nobody
Approved work: none
Next action: once E26-A3 (Stripe code permission) and E26-A6 (mail key) are done from the Mac list, Zenod is ready for full promotion (U5): tell the social desk, then watch the first stranger sign up live; E23-A1 (a named first tester) can run in parallel
Source revision: main (see git log)
Verified at: 2026-11-11T00:13Z (cloud health ok 7d40f51, helper roster after the roll, tester-watch no alerts, memory tests 29872f6)

## Waiting on

- [answered E23-A2 2026-11-10 @Delivery-Manager · done 2026-11-11 7d40f51 helpers off by default for new accounts, PR #1607] Workers on or off at launch? — answer: testers start with Zenod's helpers off and get memory only; you keep yours on — why: you said we can launch with them off, and their cards are not good enough yet — rollback: switch them on for any tester in one step
- [answered E23-A1 2026-11-10 @Jordi · done 2026-11-10 2a7ae340 no hand-picked person, live flow is EPIC-26 E26-S2] Invite your first tester now, someone you know, without waiting for the dress rehearsal? Reply with their first name and how you reach them, or "rehearse first" — context: the whole new-user path was walked on production and every blocker is on one page (http://vps3.taild81fbb.ts.net:8921/e23-u1/); three were fixed today; the rehearsal has waited on one sign-in since 3 Nov and cannot test WhatsApp anyway, because your number belongs to your own account — impact: a friend's sign-up proves the last four unproven steps (the free tester checkout, linking WhatsApp, Drive access for an outside account, the new app signed in) and starts the 7 days to your first stable tester — risk: low; nothing is charged (€0, no card); agents make the code, prepare the invite and watch the sign-up live; if something breaks we fix it while they wait — recommend: yes, one friend who sends voice notes and will say when something breaks — why Jordi: only you can pick and contact the person — options: name a person · rehearse first — unblocks: U2 — details: [blockers](evidence/e23-u1-2026-11-09.md) — snoozed until: 2026-11-10T08:38Z — answer: But can you clarify the flow exactly? So I send them and say, just I send them the link to the testers, and then they put their email, they apply to it, and then, so what's the flow? Or is it not like I can give them one link? Like, is it a possibility that I give them one link? Also, I actually don't want to do this one special person step. I want to do it live, in real life, with people captured from the internet. Okay? And I want them to go through the application and do the application, and then we have to send them a link that allows them to either, if they're registered, it's just like a, I guess it's just a coupon. It's a one-time use coupon that is issued only for them, and it's emailed to them. Close the flow to me, please. (voice note vn_8bd5796f, audio https://team.alpha9.io/api/voice/notes/vn_8bd5796f/audio)

## Non-Goals

- EpicSocial and EpicTeam onboarding (agent_team plans those).
- New features: only what blocks a stranger from using Zenod.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Ticket worker | run_b87fdf63-fc99-4576-88df-9f871a385785 | E23-1: walk the whole new-user path on production as a stranger would and list every onboarding blocker on one page, with owner and state; fix every blocker agents can fix | done (fed E23-A1) | none | main-direct (docs/health, docs/epic7, evidence) | main | [e23-u1](evidence/e23-u1-2026-11-09.md), [page](http://vps3.taild81fbb.ts.net:8921/e23-u1/): 11 blockers, 3 fixed today, 3 need Jordi, 1 infra-vps, 4 at first sign-up; first run of a brand-new account checked locally on main (plan, vault choice, empty chat, no errors) | 2026-11-09T23:45Z | followups: started U4 (tester renewal alerts); park in-app nudge to link WhatsApp after the vault — the invite covers it; park /buy before sign-in shows raw JSON — no public link goes there; confirm: no — the page feeds the ask E23-A1 |
| U2 | Ticket worker | unassigned | E23-2: pick and onboard the first test user from the applications, then watch the first 7 days | done (no confirm: replaced by EPIC-26 E26-S2, the live public flow Jordi asked for in E23-A1) | U1 | none | main | none | 2026-11-10 | covered by E26-S2 |
| U3 | Ticket worker | unassigned | E23-3, E23-4: five, then ten testers | draft | U2 | none | main | none | 2026-11-10 | after U2 |
| U4 | Ticket worker | run_b87fdf63-fc99-4576-88df-9f871a385785 | Tester renewal due, past_due and Stripe read alerts reach the HQ alert thread (health row 10 read testers without Stripe) | done (no confirm: plumbing on our own monitoring, nothing new to open) | U1 | main-direct (docs/health/s1-live) | main | probe reads Stripe at most hourly, keeps those alerts between reads; a tester alert turns row 10 red with its line; installed on VPS3, first Stripe read 2026-11-09T23:36:59Z, row green; test_aggregate 37 OK | 2026-11-09T23:37Z | followups: none |
| U5 | Ticket worker | run_b362a0d4-0481-4c9f-808d-b9090bc6cdc2 | Ready check for full promotion: is Jordi tester zero and working on production (new memories go in, memories read back right), and does the same standard question set run on every change with a before and after comparison; one page that says green or names each blocker. Day zero of the 30-day challenge is today | done (approved by Jordi 2026-11-11) | none | [#1607](https://github.com/zenod-ai/zenod/pull/1607) merged 7d40f51, live 2026-11-11T00:08Z | main | [e23-u5](evidence/e23-u5-2026-11-10.md), page http://vps3.taild81fbb.ts.net:8921/e23-u5/, card [U5](cards/U5.md) | 2026-11-11T00:13Z | verdict: not yet. Jordi as tester zero works (memories in, filed, read back) and the same question set runs on every change; blockers are E26-A3 (Stripe code permission) and E26-A6 (mail key), both already asked; testers now start with helpers off (E23-A2), his stay on; followups: started EPIC-24, U6 |
| U6 | Ticket worker | run_6fbd735a-d89c-4b98-886f-ab76b5f29478 — claimed 2026-11-11T00:32Z, lease until 2026-11-11T02:32Z | ask finds a memory that is only in the log: follow-up of U5 | active | U5 | none | main | Jordi started it when closing U5 2026-11-11 | 2026-11-11 | worker |
| U7 | Ticket worker | run_596bcc20-9341-4b82-b104-4c808f0afbd0 — claimed 2026-11-11T02:22Z, lease until 2026-11-11T04:22Z | Go live with Zenod, memory only: prove on production that a stranger gets their own memory, WhatsApp link, MCP and €0 checkout with the code; mark helpers 'still building'; cut the fastest path past the two Mac steps; then open promotion | active | none | none | main | none | 2026-11-11 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | Planned from Jordi's voice note (2026-11-09 23:03Z, vn_bd75972d): "Our next incredible goal is getting one test user on Zenote, a live test user on Zenote stablely. One user. One. Let's get the first guy, let's, as soon as possible, to stabilize the service and then the next four or five, then the next 10, then we're live" and "what is missing in terms of me being able to onboard a user?" | U1 lists and fixes onboarding blockers first; U2 (the first user) and U3 stay draft until U1 reports | his voice note | when U1 reports |
| 2026-11-09 | accepted | epic “Zenod: our first live test user, then five, then ten” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-09 23:03Z · 14 min 49 s · $0.039 (gpt-4o-mini-transcribe) · vn_bd75972d Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | Jordi, voice note 2026-11-10 02:30Z (vn_8f8279fe): "the testers start today (the 30-day challenge starts today)" and he is creating the Zenod Memory account now; handed on by EPIC-24 in desk note 2e48e41 | testers today: the first-tester path is U2, waiting on ask E23-A1 (he names the person) and T1 (EPIC-26, the invite ready to send); tester-watch with Stripe alerts (U4) and the EPIC-24 M2 alerts are live; the Zenod Memory account is the social presence, passed to zenod-social | desk note 2e48e41, closed 32e768b | when E23-A1 is answered |
| 2026-11-10 | revised | Jordi answered E23-A1 (vn_8bd5796f): "I actually don't want to do this one special person step. I want to do it live, in real life, with people captured from the internet... they go through the application... we have to send them a link... a one-time use coupon that is issued only for them, and it's emailed to them. Close the flow to me, please." | no hand-picked first tester; U2 replaced by EPIC-26 E26-S2 (apply, one-time coupon by email, one link) | his voice note | when E26-S2 is in review |
| 2026-11-10 | accepted | Jordi asked for a ready check for full promotion in Jordi's voice note 2026-11-10 23:08Z (Zenod Log/2026-11-10.md#^e-449504): "Am I tester zero and I'm working and I'm able to make new memories, read memories, and we have like a test of things that the model passes, a standardized test that allows us to make changes and see how the same questions perform against the new changes. And so are we ready or not?" (root L-37) | U5 ready | his note | U5 result |
| 2026-11-10 | decided | decided by Delivery Manager: testers launch with Zenod's helpers off, memory only; Jordi keeps his helpers on. Jordi in Jordi's voice note 2026-11-10 23:08Z (Zenod Log/2026-11-10.md#^e-449504): "We can turn off the workers to begin with when we're testing or something, if that is what's really complicating everything" — why: helpers are the top plan and their cards are not yet good enough (EPIC-14 S36) — rollback: switch helpers on per tester | E23-A2 FYI | his note | S36 closed |
| 2026-11-11 | accepted | Jordi, Chat voice note vn_f4ab8ad2 (2026-11-11 02:05Z): he wants ONE product commercially live now, Zenod: launch with helpers and personas off and marked 'still building'; answer plainly whether Zenod without personas is multi-tenant today (testers sign up, each gets their own memory, WhatsApp number, MCP, billing with the coupon); if not, exactly what is missing and the fastest path; then go live (root L-37) | U7 ready | his note | U7 result |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
