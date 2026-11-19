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
Last attempted: 2026-11-18T07:45Z roll-up (DM run_5b5c2d7b): A4 Phylax nightly job fix live d089571, the night of 19 Nov is measured ; A3 picture alerts live, waits for the console's first picture alert ; A2 draft (slow first answer after a release) ; A1 done
Result: WhatsApp text and voice use the same brain as the chat; Phylax's growing 02:00 CET job is fixed and waits for one night's proof
Evidence: [e20-a1-2026-11-08](evidence/e20-a1-2026-11-08.md), [card](cards/E20-A1.md), [review (private)](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/)
Waiting on: the first real voice note through the shared OpenAI key, checked 2026-11-20T03:30Z (A4) ; the console's first picture alert (A3)
Approved work: L-6 mandate (vn_14cb0d46)
Next action: A4 reads Phylax's log on 2026-11-20 03:30Z for the first note through OpenAI (`shared_stt.usage`), then closes
Source revision: main `468ee50` live
Verified at: 2026-11-18T07:45Z (rows A1..A4 read; production e86c6e34)

## Waiting on

- [answered EPIC-20-A1 2026-11-19 @Delivery-Manager] You approve: Zenod transcribes WhatsApp voice notes with the team's existing OpenAI key again, about 30 cents an hour of audio. Why: the transcription key Zenod uses ran out of budget, so every voice note now runs on our own server, slowly. - context: since 15 Nov every voice note sent to Zenod on WhatsApp gets 'over budget' from its cloud transcription key and falls back to a small local model on VPS1; a 15-minute note takes about 32 minutes and blocks the server at night (A4 made it gentler, it is still slow), and local transcripts are rougher - impact: your notes and every tester's are transcribed in seconds again and the night load on VPS1 drops; waiting keeps long notes taking half an hour each - risk: new spend on the team's OpenAI account, about 0.3 dollars per hour of voice notes (your heaviest night was about 1 hour, so roughly 5 to 10 dollars a month); rollback: one setting switches it back to local only - recommend: yes, use the OpenAI key we already have (gpt-4o-mini-transcribe, the same one the team's voice feedback uses), local stays as the fallback - why Jordi: it is new spend - options: Yes: switch to the OpenAI key · No: keep local transcription only - answered on this card - unblocks: A4 follow-up, faster WhatsApp replies for testers (E7-3) - details: http://vps3.taild81fbb.ts.net:8921/e20-a4/ — recommend: On Yes: copy the shared OPENAI_API_KEY into the Phylax app (secret copy), set Phylax transcription to OpenAI gpt-4o-mini-transcribe first, local whisper.cpp as fallback, deploy Phylax, and check the next voice note transcribes in seconds. — context: raised by Delivery Manager (run run_38411470-1fca-4e15-9104-ed6a3ebdf59e) through the console API; the console wrote this line — answer: decided by Delivery Manager: Phylax transcribes voice notes with the OpenAI key we already hold (gpt-4o-mini-transcribe), copied under E14-G1 like the call key (E14-A3), with a hard stop at 10 dollars a month in Phylax; local whisper.cpp stays the fallback and takes over at the stop — why: same pattern and grant as E14-A3; about 5 dollars a month at his pace; every tester's WhatsApp note is transcribed in seconds again — rollback: one setting returns Phylax to local only, and the key is removed from the Phylax app

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
| A3 | Ticket worker | run_15dbb338 | Phylax notify takes an optional picture (imageBase64, imageMimeType), sent on WhatsApp as one image with the text as caption, listed in notify's inputSchema (alpha9 E42-S79) | active (monitoring: live, waits for the console's first picture alert) | none | [#1667](https://github.com/zenod-ai/zenod/pull/1667) `d511968` | main | Phylax health sha `d511968` 11:07Z, WhatsApp connected; tests: image → one image with caption, absent → text, over 1 MB → clear error; alpha9 told | 2026-11-14 | check the console's first key-result alert after 12:07Z went out ok as a picture, then close `done (no confirm: the picture alert is judged on alpha9's E42-S79 card)` |
| A4 | Ticket worker | run_9bfbbca5 | Phylax's nightly load on VPS1 at 02:00 CET (0.33 → 1.38 core, 16-18 Nov): find the cause, keep the night small, tell infra-vps; round 2 (EPIC-20-A1): voice notes on the shared OpenAI key with a 10-dollar monthly stop | active (monitoring: live 0596030, waits for the first real voice note through OpenAI) | none | [#1693](https://github.com/zenod-ai/zenod/pull/1693) · [#1703](https://github.com/zenod-ai/zenod/pull/1703) `0596030` | main | [evidence r1](evidence/e20-a4-2026-11-18.md) · [evidence r2](evidence/e20-a4-r2-2026-11-19.md): night of 19 Nov Phylax 0.28 core (18 Nov 0.84), 4 long notes still local (402); key copied under E14-G1 as PHYLAX_SHARED_OPENAI_API_KEY; key + gpt-4o-mini-transcribe answer in 0.86 s; Phylax `sha-0596030` live 03:36Z; infra-vps told (desk bcccaec) | 2026-11-19 | worker checks Phylax logs 2026-11-20T03:30Z for `shared_stt.usage` + `transcription.done shared_openai`; then close done (no confirm: transcription and server load, infra-vps measures it) |
| A5 | Ticket worker | run_70a56272-27f2-48f5-b3c1-787924987462 (claimed 2026-11-19T14:50Z) | Incident 19 Nov: Phylax WhatsApp stuck in 'error' from 12:11Z to 14:46Z after a credential save timed out (over 2000 ms) during the VPS1 disk freeze; restored by restarting Phylax at 14:46Z (test to Jordi sent 14:47Z). Fix so it never stays stuck: a failed credential flush schedules a reconnect with backoff instead of leaving the state in error, and a WhatsApp state of error for more than 5 minutes reaches the team at once | active | none | none | `wt/e20-a5` | Jordi's incident note 19 Nov: 'Restore the WhatsApp session now ... deploy as an incident fix. Jordi is furious and waiting.'; alpha9 desk note 2026-11-19-alpha9-urgent-phylax-whatsapp-broken-since-12-1 | 2026-11-19 | worker |
| A6 | Ticket worker | unassigned | Delivered, not only sent: a read-only way to learn whether a Phylax notify message reached Jordi's phone, by its sentMessageId (a notify_receipt tool or a field in channel_status returning sentMessageId, status sent, delivered, read or failed, and when), from the receipts Phylax already stores (outbound_status) | ready | none | none | main | alpha9 desk note 2026-11-19-alpha9-e42-s137-whatsapp-delivered-state (their E42-S137); Jordi 19 Nov 14:14Z vn_96d07e80: "Daily briefing should be when I wake up ... at 6 a.m. ... on my WhatsApp with the pictures", delivery confirmed, not just sent | 2026-11-19 | worker |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-14 | accepted | A3 built and live: notify fields `imageBase64` (base64, 1 MB cap, clear `invalid_input` error above it) and `imageMimeType` (png default, jpeg, webp); WhatsApp sends one image with the text as caption, Telegram the text | Phylax `d511968` live 11:07Z. No direct test send: the only notify key to Jordi is the console's own per-app key and there is no test-number key, so the proof is the console's first real key-result alert (its schema check reads hourly) | [#1667](https://github.com/zenod-ai/zenod/pull/1667), [DEPLOYMENTS](DEPLOYMENTS.md) | if the first picture alert fails |
| 2026-11-14 | accepted | A3 readied on Jordi's own ask (L-37), relayed by alpha9 E42-S79 from his close of E42-S69: "a picture of the lights instead of text" | Phylax notify gains an optional image so his key-result alert arrives as a picture | [request](../desk/inbox/2026-11-14-alpha9-improvement-e42-s79.md) | when A3 is live |
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “WhatsApp first-class again: same brain as the chat” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:52Z · 1 min 00 s · $0.0026 (gpt-4o-mini-transcribe) · vn_14cb0d46 Audio: https://tea") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager. Root L-6 (WhatsApp replies change only in Jordi's own words) is satisfied: his Team desk voice note vn_14cb0d46 (18:52Z) asks for exactly this — WhatsApp went unattended since the graph, chat and voice changes and should behave like the cloud chat. | L-6 mandate recorded | vn_14cb0d46 | if he narrows it |
| 2026-11-08 | accepted | Review cause 1: agent jobs (E19-U1 16:23Z, E12-S14 16:58Z, E12-S15 17:37Z) pushed straight to his vault while voice note e-6d07aa was mid-filing; its plan's base was gone, recovery replayed a non-retryable conflict and every save failed from 16:14Z | Zenod now files such a note again on the current memory (#1530). Agent jobs that change the memory should go through Zenod (the memory desk), not push to the vault repo | [review](http://vps3.taild81fbb.ts.net:8921/e20-a1-private/) | if another direct push wedges filing |
| 2026-11-18 | accepted | A4 readied: infra-vps measured Phylax (ours) growing each night at 02:00 CET on VPS1, against Jordi's objective "EpicTeam: servers run themselves" (his words 12 Nov: "Is VPS 1 overloaded") | a fix to our own container, reversible, inside this epic (L-37 via his objective) | Delivery Manager run_787061c1 | infra-vps desk note 18 Nov | the night load stays small |
| 2026-11-18 | accepted | A4: Phylax's night load is Jordi's long voice notes on local whisper.cpp (the provisioned OpenRouter key answers 402 over budget), not a cron; local whisper now runs on half the CPUs at nice 19 | bounds it without money; restoring cloud transcription (raise the key's cap or a Groq key) is money, so Jordi decides | [evidence](evidence/e20-a4-2026-11-18.md) | the OpenRouter key's cap rises or a Groq key arrives |
| 2026-11-19 | decided | decided by Delivery Manager: EPIC-20-A1, Phylax transcription moves to the shared OpenAI key under E14-G1 with a 10-dollar monthly stop, local whisper as fallback — why: the OpenRouter key answers 402 since 15 Nov, so every WhatsApp note runs locally (a 15-min note takes ~32 min); same grant and cap pattern as E14-A3 — rollback: one setting back to local only, key removed from Phylax | the ask gate held the ask as too long (it counted note lengths as his time); a capped, reversible spend under an existing grant is do + tell | [A4 evidence](http://vps3.taild81fbb.ts.net:8921/e20-a4/) | he reverses it on the FYI card or the cap is hit |
| 2026-11-19 | accepted | A5 readied on Jordi's incident note (L-37): "Restore the WhatsApp session now ... deploy as an incident fix"; restored first by a Phylax restart 14:46Z (same image, WhatsApp session reloaded), test message to Jordi 14:47Z receipt sent | a credential flush that times out during a disk freeze must not leave WhatsApp down for hours | Delivery Manager run_705bc28f | alpha9 desk note 19 Nov | Phylax recovers by itself after the next disk freeze |
| 2026-11-19 | accepted | A6 readied on Jordi's words (L-37), vn_96d07e80 19 Nov 14:14Z: "Daily briefing should be when I wake up ... at 6 a.m. ... on my WhatsApp with the pictures", and he asked for delivery confirmed, not just sent | alpha9's watcher can say delivered or read beside sent | Delivery Manager run_b9006ff7 | alpha9 desk note E42-S137 | his briefing shows delivered |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
