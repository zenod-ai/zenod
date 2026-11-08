# EPIC-16: One Send button: the agent decides keep or ask

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/one-send-button-the-agent-decides-keep-o.md
Spine ID: one-send-button-the-agent-decides-keep-or-ask
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Remove the Ask and Keep buttons: one Send; the agent decides from the content whether to store new information or retrieve.

Goal sentence: One Send button in the cloud chat, and Zenod decides whether to keep or answer.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): the chat gets simpler: you just send, and Zenod stores or answers as the content needs.

## Done means

- [ ] E16-1 The cloud chat has one Send button, no Ask and no Keep; Zenod decides from the content whether to store a new memory, answer from memory, or both, and says which it did.
- [ ] E16-2 Measured on real-style messages: the decision is right at least 9 times in 10, and nothing is stored that the user only asked.

## Outcome

Verdict: accomplished
Outcome: One Send button in the cloud chat, and Zenod decides whether to keep or answer. (closed on the console's review list)
Closed: 2026-11-08 by Jordi (closed on the console's review list)

## Current State

Owner: Delivery Manager (Zenod launch)
Status: done (closed by Jordi 2026-11-08)
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: B1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- Web chat only; WhatsApp replies unchanged (root L-6).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | Ticket worker | run_68834ea4-ac9e-41b7-96a6-2ba7aa12a7e9 | One Send: remove Ask and Keep, the agent decides store vs retrieve (E16-1, E16-2) | done (approved by Jordi 2026-11-08) | none | [#1518](https://github.com/zenod-ai/zenod/pull/1518) merged `db093a5`, live | main | [evidence](http://vps3.taild81fbb.ts.net:8921/e16-b1/), [card](cards/E16-B1.md): 80/80 decisions right, 0 questions kept; ✗ signed-in send waits on E7-A15 | 2026-11-08 | followups: none; confirm: yes — Jordi judges whether one Send feels right and whether its keep or answer choices match what he meant |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “One Send button: the agent decides keep or ask” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 15:51Z Zenod: Log/2026-11-08.md#^e-7821a0 So the more I think about it, the") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |



## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
