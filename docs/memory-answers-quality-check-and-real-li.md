# EPIC-15: Memory answers: quality check and real-life tests

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/memory-answers-quality-check-and-real-li.md
Spine ID: memory-answers-quality-check-and-real-life-tests
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Analyse the latest questions and answers (do they make sense, why not); test the memory with Jordi's real voice notes and live questions (top five topics last week…); check the digestion is triggered.

Goal sentence: Zenod answers questions about your memory well, tested on your own real voice notes.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a paying user keeps paying only if asking the memory gives good answers.

## Done means

- [ ] E15-1 The latest real questions Jordi asked and the answers he got are judged one by one (makes sense or not, and why), with the causes ranked.
- [ ] E15-2 A test set built from his real voice notes and live questions (for example the top five topics of last week), run on every change, with a score.
- [ ] E15-3 Digestion is shown to run by itself on new memories, with its last run time.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: Jordi, E15-A1 (OpenRouter test credits $1.38 left; does production share the account?)
Approved work: none
Next action: Q1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No synthetic fixtures he does not recognise as the main test.
- Read only on his vault; private content stays off this public repo.

## Waiting on

- [ask E15-A1: provide @Jordi since 2026-11-08 row Q1] Please top up the shared OpenRouter test credits by $20 — only $1.38 of $110 is left, and today it refused 15 of 20 test calls on your real notes. Also tell us whether production's own Zenod key draws on the same OpenRouter account: if it does, filing and answers stop for everyone when it reaches zero — context: the memory quality tests and the accuracy fix both run on that test key — impact: no model test runs until it is topped up; if production shares the account, Zenod itself is at risk — risk: spend only, $20, and we recommend giving the test key its own monthly cap so tests can never drain production — recommend: top up $20, set a monthly cap on the test key — why Jordi: the OpenRouter management key is yours, kept in Bitwarden and deliberately not on the servers — unblocks: Q1 follow-ups, EPIC-12 S1b accuracy, EPIC-18 W1 measuring

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | Ticket worker | run_ff4ff9cf-9ecb-4ca9-9327-92b9555247a0 | Judge the latest real questions and answers, build the real-note test set, check digestion is triggered (E15-1..3) | review | none | `wt/e15-q1`, main-direct (docs only) | main | [evidence](evidence/e15-q1-2026-11-08.md), [card](cards/E15-Q1.md), page http://vps3.taild81fbb.ts.net:8924/ (private, tailnet): live code dce775e on a read-only copy of his vault at 7f35d26; his two Chat-tab questions of 8 Nov judged no and partly (both causes fixed since by E12-S1b and S3c); live ask_brain on his account 0 of 4 (3 timeouts, 1 "Memory filing is in progress" during a 14 min filing); 45-question real-note set (20 here plus 25 from E12-S1b round 3 run_6ad10161) kept privately in ~/zenod-eval on VPS3; cloud chat path 14 of 45 facts right, 30 of 45 right memory in the top 5, his 20 judged by hand 6 sensible, 1 partly, 13 no; same code on the demo vault 20 of 20; causes ranked: word-only search 7 of 20, answer check discards right answers 4 of 20, agent reports are 313 of 343 Log entries of 1-8 Nov, no time-span questions, ask_brain slow and blocked while filing, filing fragments a note into many pages; digestion runs by itself: 30 of 30 notes of 1-8 Nov filed with no human step, median 4.3 min, weekly sweep last Sun 8 Nov 02:01Z and Sun 2 Nov 04:58Z, not shown in the app, other tenants not visible to agents; shared OpenRouter test key about $1.38 left | 2026-11-08 | followups: start Search by meaning and across languages, newer notes first — cause 1, 7 of 20 failures; start Keep right answers the check now hides — cause 2, 4 of 20, check overlap with E12-S1b round 3 first; start Answer what-did-I-say questions from his own notes before agent reports — cause 3; start Time-span questions such as the top topics of a week — cause 4, his own example fails; start ask_brain gets the chat's fast answer and answers while filing runs — cause 5, 0 of 4 live, his note now asks for good answers in his own words; start Run the real-question set after every production roll — E15-2 asks for every change; park Show the last digestion run in the app — EPIC-12 S4 holds it as a draft; park Fewer, merged pages per filed note — close to EPIC-12 S8 landing work; confirm: yes — only Jordi can say whether the verdicts match what he saw and whether the test questions are his |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Memory answers: quality check and real-life tests” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 15:51Z Zenod: Log/2026-11-08.md#^e-7821a0 So the more I think about it, the") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |



## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
