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
Waiting on: none
Approved work: none
Next action: Q1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No synthetic fixtures he does not recognise as the main test.
- Read only on his vault; private content stays off this public repo.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | Ticket worker | run_ff4ff9cf-9ecb-4ca9-9327-92b9555247a0 — claimed 2026-11-08T15:55Z, lease until 2026-11-08T17:55Z | Judge the latest real questions and answers, build the real-note test set, check digestion is triggered (E15-1..3) | active | none | `wt/e15-q1` | main | none | 2026-11-08 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Memory answers: quality check and real-life tests” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 15:51Z Zenod: Log/2026-11-08.md#^e-7821a0 So the more I think about it, the") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |



## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
