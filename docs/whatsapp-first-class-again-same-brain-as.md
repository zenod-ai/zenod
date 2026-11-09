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

- [x] E20-1 The recent WhatsApp exchanges are reviewed message by message (what was sent, what Zenod did and replied, what it should have done), with the causes ranked.
- [x] E20-2 A WhatsApp message gets the same decision as the cloud chat (save a memory, answer from memory, or a job for the memory desk shown in the inbox as "run it?"), and answers use the same checked answer path, short enough for WhatsApp.
- [ ] E20-3 Proven on real-style messages through the live WhatsApp path: the decision is right at least 9 times in 10, answers are correct on his real questions at least as often as the cloud chat, and replies arrive within a few seconds.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-09 A1 (run_b72ff779): WhatsApp brain live, card to review; ZAL-A15 incident found and recorded
Result: WhatsApp text gets the cloud chat's decision and checked answers (#1532, live in `468ee50`); his 6 WhatsApp questions on 9 Nov were all answered; decision 40/40 and 39/40 blind; answers graded the same as the cloud chat (8/10 each); live reply 6.6 s warm, 17.5 s first after a restart. Voice notes are not transcribed since 03:19Z (OpenRouter out of credit, ZAL-A15)
Evidence: [e20-a1-2026-11-08](evidence/e20-a1-2026-11-08.md), [card](cards/E20-A1.md), [review (private)](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/)
Waiting on: Jordi's judgement of the card; E20-3 open (first reply after a restart is 17.5 s)
Approved work: L-6 mandate (vn_14cb0d46)
Next action: Jordi judges A1; then a speed step for the first answer after each restart (E20-3)
Source revision: main `468ee50` live
Verified at: 2026-11-09T06:30Z live health `468ee50`

## Non-Goals

- No new WhatsApp number or provider.
- Root L-6: WhatsApp reply behaviour changes here only because Jordi asked for exactly this in his own words (Team desk voice note vn_14cb0d46, 2026-11-08 18:52Z, recorded in Decisions); nothing beyond what this epic names.
- Desk jobs are never started from WhatsApp directly; they show in the inbox as "run it?" (E14-A2).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Ticket worker | run_b72ff779 | Review the recent WhatsApp exchanges, then give WhatsApp the same brain as the cloud chat (decide, answer, job), proven on the live path (E20-1..3) | review | none | [#1530](https://github.com/zenod-ai/zenod/pull/1530) · [#1532](https://github.com/zenod-ai/zenod/pull/1532) `a8f529c` · [#1553](https://github.com/zenod-ai/zenod/pull/1553) | main | [evidence](evidence/e20-a1-2026-11-08.md) · [card](cards/E20-A1.md) | 2026-11-09 | live on 468ee50; followups: start faster first answer after a restart — E20-3 needs replies within a few seconds, cold was 17.5 s; start voice notes wait behind slow filings — three notes waited 13 min; park keep and Run it? live check — would write into his memory and inbox; confirm: yes — Jordi sends a few WhatsApp messages and judges the replies |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “WhatsApp first-class again: same brain as the chat” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:52Z · 1 min 00 s · $0.0026 (gpt-4o-mini-transcribe) · vn_14cb0d46 Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager. Root L-6 (WhatsApp replies change only in Jordi's own words) is satisfied: his Team desk voice note vn_14cb0d46 (18:52Z) asks for exactly this — WhatsApp went unattended since the graph, chat and voice changes and should behave like the cloud chat. | L-6 mandate recorded | vn_14cb0d46 | if he narrows it |
| 2026-11-08 | accepted | Review cause 1: agent jobs (E19-U1 16:23Z, E12-S14 16:58Z, E12-S15 17:37Z) pushed straight to his vault while voice note e-6d07aa was mid-filing; its plan's base was gone, recovery replayed a non-retryable conflict and every save failed from 16:14Z | Zenod now files such a note again on the current memory (#1530). Agent jobs that change the memory should go through Zenod (the memory desk), not push to the vault repo | [review](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/) | if another direct push wedges filing |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
