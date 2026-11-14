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

Goal sentence: WhatsApp answers with the cloud chat's brain: it saves, answers or takes a job as each message needs.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): WhatsApp is how a paying user reaches Zenod most; it must be as good as the cloud chat.

## Done means

- [x] E20-1 The recent WhatsApp exchanges are reviewed message by message (what was sent, what Zenod did and replied, what it should have done), with the causes ranked.
- [x] E20-2 A WhatsApp message gets the same decision as the cloud chat (save a memory, answer from memory, or a job for the memory desk shown in the inbox as "run it?"), and answers use the same checked answer path, short enough for WhatsApp.
- [ ] E20-3 Proven on real-style messages through the live WhatsApp path: the decision is right at least 9 times in 10, answers are correct on his real questions at least as often as the cloud chat, and replies arrive within a few seconds.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-10 roll-up: A1 done (WhatsApp uses the cloud chat's brain, closed by Jordi) ; A2 draft (the first reply after a restart, 17.5 s, E20-3) ; related: ZAL A15 and A16 made voice notes save with a local transcription fallback and receipts after reconnect ; EPIC-24 M6 is making releases seamless, which also removes most first-reply delays after a restart
Result: WhatsApp text and voice work with the same brain as the cloud chat; answers 6.6 s typical; first answer after a restart still slow
Evidence: [e20-a1-2026-11-08](evidence/e20-a1-2026-11-08.md), [card](cards/E20-A1.md), [review (private)](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/)
Waiting on: nobody; A2 waits on EPIC-24 M6 (seamless releases) to see whether the slow first answer remains
Approved work: L-6 mandate (vn_14cb0d46)
Next action: after M6 lands, measure the first WhatsApp answer after a release; start A2 only if it is still over a few seconds
Source revision: main `468ee50` live
Verified at: 2026-11-10T08:10Z

## Non-Goals

- No new WhatsApp number or provider.
- Root L-6: WhatsApp reply behaviour changes here only because Jordi asked for exactly this in his own words (Team desk voice note vn_14cb0d46, 2026-11-08 18:52Z, recorded in Decisions); nothing beyond what this epic names.
- Desk jobs are never started from WhatsApp directly; they show in the inbox as "run it?" (E14-A2).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Ticket worker | run_b72ff779 | Review the recent WhatsApp exchanges, then give WhatsApp the same brain as the cloud chat (decide, answer, job), proven on the live path (E20-1..3) | done (approved by Jordi 2026-11-09) | none | [#1530](https://github.com/zenod-ai/zenod/pull/1530) · [#1532](https://github.com/zenod-ai/zenod/pull/1532) `a8f529c` · [#1553](https://github.com/zenod-ai/zenod/pull/1553) | main | [evidence](evidence/e20-a1-2026-11-08.md) · [card](cards/E20-A1.md) | 2026-11-09 | live on 468ee50; followups: started A2 |
| A2 | Ticket worker | unassigned | a faster first answer after each production restart: follow-up of A1 | draft | A1 | none | main | parked by Jordi when closing A1 2026-11-09 | 2026-11-09 | Jordi starts it from the goal when wanted |
| A3 | Ticket worker | run_15dbb338 | Phylax notify takes an optional picture: imageBase64 (PNG up to about 1 MB) and imageMimeType, sent on WhatsApp as one image with the text as caption, other channels unchanged, listed in notify's inputSchema so the team console sends Jordi's key-result alert as a picture (alpha9 E42-S79) | active (claimed 2026-11-14 by run_15dbb338) | none | wt/a3-notify-image | main | [alpha9 request](../desk/inbox/2026-11-14-alpha9-improvement-e42-s79.md) | 2026-11-14 | build, deploy Phylax, tell alpha9 it is live |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-14 | accepted | A3 readied on Jordi's own ask (L-37), relayed by alpha9 E42-S79 from his close of E42-S69: "a picture of the lights instead of text" | Phylax notify gains an optional image so his key-result alert arrives as a picture | [request](../desk/inbox/2026-11-14-alpha9-improvement-e42-s79.md) | when A3 is live |
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “WhatsApp first-class again: same brain as the chat” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:52Z · 1 min 00 s · $0.0026 (gpt-4o-mini-transcribe) · vn_14cb0d46 Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager. Root L-6 (WhatsApp replies change only in Jordi's own words) is satisfied: his Team desk voice note vn_14cb0d46 (18:52Z) asks for exactly this — WhatsApp went unattended since the graph, chat and voice changes and should behave like the cloud chat. | L-6 mandate recorded | vn_14cb0d46 | if he narrows it |
| 2026-11-08 | accepted | Review cause 1: agent jobs (E19-U1 16:23Z, E12-S14 16:58Z, E12-S15 17:37Z) pushed straight to his vault while voice note e-6d07aa was mid-filing; its plan's base was gone, recovery replayed a non-retryable conflict and every save failed from 16:14Z | Zenod now files such a note again on the current memory (#1530). Agent jobs that change the memory should go through Zenod (the memory desk), not push to the vault repo | [review](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/) | if another direct push wedges filing |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
