# EPIC-20: WhatsApp first-class again: same brain as the chat

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/whatsapp-first-class-again-same-brain-as.md
Spine ID: whatsapp-first-class-again-same-brain-as-the-chat
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Review the recent WhatsApp exchange: since the graph, chat and voice changes WhatsApp went unattended. WhatsApp behaves like the cloud chat: decides new memory vs question vs task, answers responsively and fitly; proven on real messages.

Goal sentence: WhatsApp answers with the same brain as the cloud chat: it saves, answers or takes a job as the message needs.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): WhatsApp is how a paying user reaches Zenod most; it must be as good as the cloud chat.

## Done means

- [ ] E20-1 The recent WhatsApp exchanges are reviewed message by message (what was sent, what Zenod did and replied, what it should have done), with the causes ranked.
- [ ] E20-2 A WhatsApp message gets the same decision as the cloud chat (save a memory, answer from memory, or a job for the memory desk shown in the inbox as "run it?"), and answers use the same checked answer path, short enough for WhatsApp.
- [ ] E20-3 Proven on real-style messages through the live WhatsApp path: the decision is right at least 9 times in 10, answers are correct on his real questions at least as often as the cloud chat, and replies arrive within a few seconds.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: A1 dispatched (review, then build)
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No new WhatsApp number or provider.
- Root L-6: WhatsApp reply behaviour changes here only because Jordi asked for exactly this in his own words (Team desk voice note vn_14cb0d46, 2026-11-08 18:52Z, recorded in Decisions); nothing beyond what this epic names.
- Desk jobs are never started from WhatsApp directly; they show in the inbox as "run it?" (E14-A2).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Ticket worker | run_b72ff779-04e1-4467-8292-655206a85cac — claimed 2026-11-08T18:55Z, lease until 2026-11-08T20:55Z | Review the recent WhatsApp exchanges, then give WhatsApp the same brain as the cloud chat (decide, answer, job), proven on the live path (E20-1..3) | active | none | `wt/e20-a1` | main | none | 2026-11-08 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “WhatsApp first-class again: same brain as the chat” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:52Z · 1 min 00 s · $0.0026 (gpt-4o-mini-transcribe) · vn_14cb0d46 Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager. Root L-6 (WhatsApp replies change only in Jordi's own words) is satisfied: his Team desk voice note vn_14cb0d46 (18:52Z) asks for exactly this — WhatsApp went unattended since the graph, chat and voice changes and should behave like the cloud chat. | L-6 mandate recorded | vn_14cb0d46 | if he narrows it |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
