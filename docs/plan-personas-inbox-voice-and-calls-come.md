# EPIC-14: Plan: personas, inbox, voice and calls come to Zenod

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/plan-personas-inbox-voice-and-calls-come.md
Spine ID: plan-personas-inbox-voice-and-calls-come-to-zenod
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

A plan at one URL before any build: personas that wake on your memory, an inbox of decisions and findings, voice notes and calls to the memory (library hotline); bootstrap in Zenod and port Epic Team screens, or merge; keep ingestion separate.

Goal sentence: A plan at one link for personas, an inbox and calling your memory, before any build.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a paying user gets more from a memory that works for them: personas that act on it, an inbox for what needs them, and voice and calls as easy ways in.

## Done means

- [ ] E14-1 One plan at one URL Jordi can open: personas that wake on your memory, the inbox of decisions and findings, the voice-note and call buttons (library hotline), bootstrap in Zenod versus merge with Epic Team, what stays separate (voice-note ingestion), and whether Zenod rests on EpicSpine.
- [x] E14-2 Jordi approves the plan (coded ask), and its build steps become rows here. (E14-A2 APPROVED 2026-11-08, 8df02cb2)

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none (E14-A3 answered: calls use the team OpenAI key, capped)
Approved work: none
Next action: S3 memory desk and S4 persona runner in flight ; S1 voice button running ; S2 inbox round 3 (one chat, card reply boxes) in review
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No build before the plan is approved.
- Zenod stays pure memory: no goals, no Kanban, no intent extraction.
- WhatsApp replies unchanged (root L-6); Epic Team machinery only as far as Jordi asked in his own words (voice note Log/2026-11-08.md#^e-7821a0), weighed against root L-7 in the plan.

## Waiting on

- [answered E14-A3 2026-11-08 @Unblocker · done 2026-11-08] The call button needs its own OpenAI key for Zenod, so calls are switched on. We recommend a new key in a separate "Zenod" project in your OpenAI account, with a monthly budget limit of $10, sent through a private secret card we will send; we do not reuse the team console's OpenAI key, so Zenod's call costs stay separate and capped — context: the call step of the plan you approved (E14-A2) said it would need an OpenAI account for Zenod when it starts; it is being built now on a simulated call — impact: yes switches the library hotline on for you; until then the button says calls are not on yet — risk: spend only, about 2 to 20 cents a minute, capped per call and at $10 a month; revoke the key any time — recommend: yes, a separate capped Zenod project key — why Jordi: a paid account and key in your name — unblocks: S8 live call — answer: use the OpenAI key we already hold (agent-team-console's OPENAI_API_KEY, valid, answers 200; Jordi added $10 credit to its account on 2026-11-01 for the console's call button, E42-A3): copy it into zenod-mt with `secret copy agent-team-console zenod-mt OPENAI_API_KEY --approved E14-G1`, keep Zenod's per-call cap and add a $10-a-month spend stop in Zenod's own call meter, and log each call's cost per app so Zenod's spend stays visible; only if OpenAI refuses with no credit (429) does a fresh ask go to Jordi for credit or a separate Zenod project key — why: we never ask Jordi for a key we already have; the console's call button already runs on this exact key the same way (agent_team E42-S5), and Jordi approved calls costing a few cents a minute, capped, in E14-A2 — source: standing approval E14-G1 (infra-vps EPIC-14, reuse shared keys), E14-A2 answer, infra-vps AGENTS.md Secrets, agent_team docs/status/e42-s5-voice-call-prototype.md — confidence: 80% — rollback: remove OPENAI_API_KEY from zenod-mt and redeploy, the button goes back to 'calls are not on yet'; Jordi can still mint a separate capped Zenod project key later — acted: S8 worker run_e6d8ab9e steered to copy the key under E14-G1, cap at $10 a month in Zenod's call meter, log cost per app, and make one live test call
- [answered E14-A2 2026-11-08 @Jordi · done 2026-11-08] Is this the plan for personas, the inbox, calling your memory and the memory desk? Open http://vps3.taild81fbb.ts.net:8921/e14-plan/ — now 15 slides. New since your voice note of 16:09: a memory desk — when you ask for a job on the memory (like untangling Idealista and Poly-Maker) instead of saving or asking, Zenod hands it to an agent; each job is one change you can undo, it never rewrites your words or deletes, big jobs show a plan card first, and progress and results land in your inbox; no new "Epic Memory" product, Zenod stays, and it copies Epic Team's desk, personas, inbox, voice call and activity screens now (a shared package later for the voice and question card). Seven build steps, about four weeks, the memory desk is step 3. We recommend WhatsApp does not start memory jobs directly for now: a job asked on WhatsApp shows in your inbox as "run it?", so WhatsApp replies stay as they are — context: your voice notes of 8 Nov 15:51 and 16:09 — impact: yes turns the seven steps into rows and starts the first — risk: low, each step ships alone; calls cost a few cents a minute, capped — recommend: approve — why Jordi: it shapes what Zenod becomes — unblocks: EPIC-14 build — details: [plan evidence](http://vps3.taild81fbb.ts.net:8921/e14-p1/) — answer: APPROVED — acted: seven build steps added as S1–S7; S1 and S2 dispatched
- [superseded E14-A1 2026-11-08 by E14-A2] Is this how personas, an inbox and calling your memory should come to Zenod? Open http://vps3.taild81fbb.ts.net:8921/e14-plan/ — 13 slides: personas that wake nightly on your memory, mostly reading, writing only into their own folder and your inbox, capped at $1 of your $3 monthly allowance; a web inbox of their questions and findings; a voice-note button that goes into the filing Zenod already has; a call button, a "library hotline" that talks to Zenod's answer engine (about 2 to 20 cents a minute, capped); we recommend building it in Zenod and copying Epic Team's screens and code, not merging the two; voice-note ingestion and goals stay separate; Zenod does not rest on EpicSpine; six build steps, about three weeks — context: your voice note of 8 Nov 15:51 asked for a plan at one link before any build — impact: yes turns the six steps into rows and starts the first — risk: low, each step ships alone; the call costs money per minute, capped — recommend: approve — why Jordi: it changes what Zenod is — unblocks: EPIC-14 build — details: [plan evidence](http://vps3.taild81fbb.ts.net:8921/e14-p1/)

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Ticket worker | run_476d6c3c (round 2) | Plan at one URL: personas, inbox, voice and call buttons, memory desk, Epic Team modules reused, what stays separate (E14-1) | done (fed E14-A2) | none | main (docs, main-direct) | main | [evidence](evidence/e14-p1-2026-11-08.md) | 2026-11-08 | round 2 plan at http://vps3.taild81fbb.ts.net:8921/e14-plan/; waits on E14-A2 |
| S1 | Ticket worker | run_7087d0b7; round 2 run_7966dd8b-8633-4403-af3c-43ca19284c7e | Voice note button in the cloud chat: record, send into Zenod's existing filing (1–2 d) | done (approved by Jordi 2026-11-08) | none | [#1523](https://github.com/zenod-ai/zenod/pull/1523) ded82b7; round 2 [#1534](https://github.com/zenod-ai/zenod/pull/1534) `5e0b7dd` live | main | [evidence](evidence/e14-s1-2026-11-08.md) · [card](cards/E14-S1.md) · transcribing twice: no, the button sends audio only and Zenod transcribes once ([E21-V1](evidence/e21-v1-2026-11-08.md)) | 2026-11-08 | followups: none; confirm: yes — Jordi tries a web chat note on his phone; the answer settles his question |
| S2 | Ticket worker | run_0d0dd716 (round 3) | Inbox: one place for persona questions, findings and desk jobs, Working → Done with Undo (2–3 d) | done (approved by Jordi 2026-11-09) | none | #1520 ceca56f; S4 #1525 #1529; #1539 f9d0e878 (live) | main | [live](http://vps3.taild81fbb.ts.net:8921/e14-s2/) · [card](cards/E14-S2.md) | 2026-11-08 | one chat, a reply box on every card — followups: none; confirm: yes — only Jordi can judge one chat and the reply boxes |
| S3 | Ticket worker | run_a7703b43 (round 2) | Memory desk: a job on the memory is a third Send outcome; agent on the job queue, one undoable commit per job, plan card over ~50 memories, results in the inbox; WhatsApp jobs show as "run it?" (4–5 d) | done (approved by Jordi 2026-11-08) | S2; EPIC-16 B1 | #1531 7cf333f, #1538 f1512c1 | main | [live evidence](http://vps3.taild81fbb.ts.net:8921/e14-s3/) | 2026-11-08 | followups: started S8 |
| S4 | Ticket worker | run_f572a29d-5175-4679-b73f-753d43f411c0 (round 2) | Persona runner: personas wake nightly on your memory, mostly reading, writing to their own folder and the inbox, capped at $1 of the $3 allowance (3–4 d) | review (round 2: persona catalog, each with its own switch, cadence and skills; his questions on how personas run and the allowance answered with a diagram) | S2 | #1525 afaae1d5, #1529 f640ce66, #1537 4fe4f8cb, #1540 90d9c30b | main | [live](http://vps3.taild81fbb.ts.net:8921/e14-s4/) · [evidence](evidence/e14-s4-2026-11-08.md) · [card](cards/E14-S4.md) · production 371d883f 22:42Z | 2026-11-08 | followups: start S5 try the catalog personas on his real notes — waits on E15-A6 credit; confirm: yes — only Jordi can say which personas he wants on and whether his questions are answered |
| S5 | Ticket worker | unassigned | Three starter personas tried on real notes (2–3 d) | blocked | S4 done; E15-A6 (OpenRouter credit: trying three personas on real notes spends model calls on the account production depends on, about $0.33 left) | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | dispatch as soon as E15-A6 adds credit |
| S6 | Ticket worker | unassigned | Call button: library hotline over OpenAI Realtime that asks Zenod's answer engine and passes jobs to the desk, cost capped (4–5 d; needs an OpenAI account for Zenod, asked when it starts) | done (no confirm: the same call button was built and is reviewed under S8) | S3 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | covered by S8 (built and live as S8) |
| S7 | Ticket worker | unassigned | Price and limits for personas, calls and desk jobs (1 d) | draft | S4, S6 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | after S4, S6 |
| S8 | Ticket worker | run_e6d8ab9e-2ebe-4e9d-9539-57a8a5207612 | the call button, which also passes spoken jobs and questions to the desk: follow-up of S3 | review | S3 | [#1542](https://github.com/zenod-ai/zenod/pull/1542) 806d1f6 (live) | main | [evidence](evidence/e14-s8-2026-11-08.md) · [page](http://vps3.taild81fbb.ts.net:8921/e14-s8/) · [card](cards/E14-S8.md) | 2026-11-08 | live; key and caps on the evidence page — followups: start S7 price and limits — what calls cost users; confirm: yes — only Jordi can judge a real call by voice on his own memory |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Plan: personas, inbox, voice and calls come to Zenod” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 15:51Z Zenod: Log/2026-11-08.md#^e-7821a0 So the more I think about it, the") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | revised | Plan input from Jordi's voice note Log/2026-11-08.md#^e-6d07aa: a "memory desk" — requests that are tasks on the memory (e.g. untangle Idealista and Poly-Maker), not new memories, are recognised and dispatched to an agent working on the memory, reached from the cloud chat, voice notes and calls like the Team desk; no new "Epic Memory" product, Zenod with Phylax stays, but new Zenod features reuse Epic Team modules as much as possible. P1 round 2 adds this to the plan before E14-A1 is answered. | plan updated, ask re-posted as E14-A2 | Log/2026-11-08.md#^e-6d07aa | when E14-A2 is answered |
| 2026-11-08 | accepted | S8: the call key is stored as OPENAI_REALTIME_KEY on zenod-mt (same value as the console's OPENAI_API_KEY, under E14-G1), not as OPENAI_API_KEY | Zenod already reads OPENAI_API_KEY for transcription and model settings; that name would have moved that spend onto the call account | [S8 evidence](evidence/e14-s8-2026-11-08.md) | if Zenod gets its own OpenAI project key |
| 2026-11-08 | accepted | decided by Unblocker: E14-A3 — the call button uses the OpenAI key we already hold (copied under E14-G1), with a per-call cap and a $10-a-month stop in Zenod's call meter | why: never ask for a key we have; same key and pattern as the console's call button; calls approved capped in E14-A2 — rollback: remove the key from zenod-mt and redeploy | E14-A3 line in Waiting on | if OpenAI answers 429 no credit, or Jordi wants a separate Zenod project key |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
