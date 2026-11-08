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
Waiting on: none ; S6 will need an OpenAI account for Zenod when it starts
Approved work: none
Next action: S3 memory desk and S4 persona runner in flight ; S1 voice button running ; S2 inbox in review
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No build before the plan is approved.
- Zenod stays pure memory: no goals, no Kanban, no intent extraction.
- WhatsApp replies unchanged (root L-6); Epic Team machinery only as far as Jordi asked in his own words (voice note Log/2026-11-08.md#^e-7821a0), weighed against root L-7 in the plan.

## Waiting on

- [answered E14-A2 2026-11-08 @Jordi · done 2026-11-08] Is this the plan for personas, the inbox, calling your memory and the memory desk? Open http://vps3.taild81fbb.ts.net:8921/e14-plan/ — now 15 slides. New since your voice note of 16:09: a memory desk — when you ask for a job on the memory (like untangling Idealista and Poly-Maker) instead of saving or asking, Zenod hands it to an agent; each job is one change you can undo, it never rewrites your words or deletes, big jobs show a plan card first, and progress and results land in your inbox; no new "Epic Memory" product, Zenod stays, and it copies Epic Team's desk, personas, inbox, voice call and activity screens now (a shared package later for the voice and question card). Seven build steps, about four weeks, the memory desk is step 3. We recommend WhatsApp does not start memory jobs directly for now: a job asked on WhatsApp shows in your inbox as "run it?", so WhatsApp replies stay as they are — context: your voice notes of 8 Nov 15:51 and 16:09 — impact: yes turns the seven steps into rows and starts the first — risk: low, each step ships alone; calls cost a few cents a minute, capped — recommend: approve — why Jordi: it shapes what Zenod becomes — unblocks: EPIC-14 build — details: [plan evidence](http://vps3.taild81fbb.ts.net:8921/e14-p1/) — answer: APPROVED — acted: seven build steps added as S1–S7; S1 and S2 dispatched
- [superseded E14-A1 2026-11-08 by E14-A2] Is this how personas, an inbox and calling your memory should come to Zenod? Open http://vps3.taild81fbb.ts.net:8921/e14-plan/ — 13 slides: personas that wake nightly on your memory, mostly reading, writing only into their own folder and your inbox, capped at $1 of your $3 monthly allowance; a web inbox of their questions and findings; a voice-note button that goes into the filing Zenod already has; a call button, a "library hotline" that talks to Zenod's answer engine (about 2 to 20 cents a minute, capped); we recommend building it in Zenod and copying Epic Team's screens and code, not merging the two; voice-note ingestion and goals stay separate; Zenod does not rest on EpicSpine; six build steps, about three weeks — context: your voice note of 8 Nov 15:51 asked for a plan at one link before any build — impact: yes turns the six steps into rows and starts the first — risk: low, each step ships alone; the call costs money per minute, capped — recommend: approve — why Jordi: it changes what Zenod is — unblocks: EPIC-14 build — details: [plan evidence](http://vps3.taild81fbb.ts.net:8921/e14-p1/)

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Ticket worker | run_476d6c3c (round 2) | Plan at one URL: personas, inbox, voice and call buttons, memory desk, Epic Team modules reused, what stays separate (E14-1) | done (fed E14-A2) | none | main (docs, main-direct) | main | [evidence](evidence/e14-p1-2026-11-08.md) | 2026-11-08 | round 2 plan at http://vps3.taild81fbb.ts.net:8921/e14-plan/; waits on E14-A2 |
| S1 | Ticket worker | run_7087d0b7 | Voice note button in the cloud chat: record, send into Zenod's existing filing (1–2 d) | active (iteration 2, relaunched by Jordi 2026-11-08: Are we then transcribing twice? Is like, can Xenot not get like a, can we send him the transcription if we already have it? Or what? [voice note vn_10331915, audio https://team.alpha9.io/api/voice/notes/vn_10331915/audio]) | none | [#1523](https://github.com/zenod-ai/zenod/pull/1523) ded82b7 | main | [evidence](evidence/e14-s1-2026-11-08.md) · [card](cards/E14-S1.md) | 2026-11-08 | round 2 (Jordi: are we transcribing twice? send the transcript if we have it) built with EPIC-21 V1, the ingest door that accepts a ready transcript; back to review with the live link |
| S2 | Ticket worker | run_c2819cef + run_b01f1e70 (round 2 via S4 and S3) | Inbox: one place for persona questions, findings and desk jobs, Working → Done with Undo (2–3 d) | active (iteration 2, relaunched by Jordi 2026-11-08: But do we have personas/workers that can leave messages? My inbox empty and no way to launch a worker?) | none | #1520 ceca56f | main | [evidence](evidence/e14-s2-2026-11-08.md) | 2026-11-08 | Jordi: inbox empty, no way to launch a worker — round 2 rides on S4 (a persona on his account that leaves a real finding, Run now button) and S3 (an Ask the desk action that starts a job); S4's worker sets S2 back to review with the live link |
| S3 | Ticket worker | run_b01f1e70-bd63-4c67-aece-c0bf32207e11 — claimed 2026-11-08T17:24Z, lease until 2026-11-08T19:24Z | Memory desk: a job on the memory is a third Send outcome; agent on the job queue, one undoable commit per job, plan card over ~50 memories, results in the inbox; WhatsApp jobs show as "run it?" (4–5 d) | active | S2; EPIC-16 B1 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | dispatch (S2 inbox live ceca56f; EPIC-16 B1 done) |
| S4 | Ticket worker | run_c2819cef-1485-461e-87e0-92063fc41f17 — claimed 2026-11-08T17:24Z, lease until 2026-11-08T20:42Z | Persona runner: personas wake nightly on your memory, mostly reading, writing to their own folder and the inbox, capped at $1 of the $3 allowance (3–4 d) | active | S2 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | dispatch (S2 inbox live ceca56f; EPIC-16 B1 done) |
| S5 | Ticket worker | unassigned | Three starter personas tried on real notes (2–3 d) | draft | S4 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | after S4 |
| S6 | Ticket worker | unassigned | Call button: library hotline over OpenAI Realtime that asks Zenod's answer engine and passes jobs to the desk, cost capped (4–5 d; needs an OpenAI account for Zenod, asked when it starts) | draft | S3 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | after S3 |
| S7 | Ticket worker | unassigned | Price and limits for personas, calls and desk jobs (1 d) | draft | S4, S6 | - | main | [plan](http://vps3.taild81fbb.ts.net:8921/e14-plan/) | 2026-11-08 | after S4, S6 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Plan: personas, inbox, voice and calls come to Zenod” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 15:51Z Zenod: Log/2026-11-08.md#^e-7821a0 So the more I think about it, the") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | revised | Plan input from Jordi's voice note Log/2026-11-08.md#^e-6d07aa: a "memory desk" — requests that are tasks on the memory (e.g. untangle Idealista and Poly-Maker), not new memories, are recognised and dispatched to an agent working on the memory, reached from the cloud chat, voice notes and calls like the Team desk; no new "Epic Memory" product, Zenod with Phylax stays, but new Zenod features reuse Epic Team modules as much as possible. P1 round 2 adds this to the plan before E14-A1 is answered. | plan updated, ask re-posted as E14-A2 | Log/2026-11-08.md#^e-6d07aa | when E14-A2 is answered |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
