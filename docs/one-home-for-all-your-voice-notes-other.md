# EPIC-21: One home for all your voice notes: other apps forward to Zenod

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/one-home-for-all-your-voice-notes-other.md
Spine ID: one-home-for-all-your-voice-notes-other-apps-forward-to-zenod
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Voice notes Jordi records in other apps (EpicTeam Chat first) are forwarded to Zenod as raw audio plus transcript, tagged with the app, stored and indexed like WhatsApp ones; loosely coupled, any provider can forward.

Goal sentence: Every voice note you record anywhere lands in Zenod once, transcribed once, tagged with the app it came from.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): one memory for everything you say is the core promise; voice notes recorded in other apps must land there too.

## Done means

- [ ] E21-1 Zenod has one ingest door for voice notes from other apps (over its MCP seam, root L-7): raw audio plus an optional transcript and the source app; a supplied transcript is used as is, never transcribed twice; stored, filed and indexed like WhatsApp voice notes, tagged with the app.
- [x] E21-2 EpicTeam Chat forwards Jordi's voice notes to it (the agent_team side is agent_team's change, proposed to them), proven with a real forwarded note landing once in his memory.
- [ ] E21-3 Any provider can forward with a documented contract and its own scoped credential.

## Outcome

Verdict: accomplished
Outcome: Every voice note you record anywhere lands in Zenod once, transcribed once, tagged with the app it came from. (closed on the console's review list)
Closed: 2026-11-10 by Jordi (closed on the console's review list)

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active (V6 reopened by Jordi 2026-11-10)
Last attempted: 2026-11-10 V4 (with V5, run_3f9aba7d): read-only check that agent_team's back-fill and card-answer forwarding (E42-S42) landed in Jordi's Zenod once each
Result: yes. All 70 notes agent_team sent (30 older Chat notes, 30 card answers, 1 EpicSocial, 7 earlier, 2 agent test notes) plus 1 since are in his memory exactly once, with the right Source app line and their own capture time; his Zenod holds 103 voice notes since 2 Nov (32 WhatsApp + 71 forwarded), none missing or doubled. The two test notes are Log evidence only, on no page, so no vault change. Once V4 is confirmed every Done means is met (E21-1 and E21-3 by V1, E21-2 by V2 and V4) and the Outcome can be written.
Evidence: [e21-v4-2026-11-10.md](evidence/e21-v4-2026-11-10.md), private page http://vps3.taild81fbb.ts.net:8921/e21-v2/ (updated in place)
Waiting on: nobody; V4's card is on the review list
Approved work: none
Next action: V4 in review; on his confirm, tick E21-1 and E21-3, write the Outcome and close the epic
Source revision: main (docs only; no code changed)
Verified at: 2026-11-10T02:40Z

## Non-Goals

- No agent_team machinery inside Zenod (root L-7): the seam is MCP; EpicTeam Chat's forwarding is built on the agent_team side.
- WhatsApp voice notes unchanged.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 | Ticket worker | run_7966dd8b-8633-4403-af3c-43ca19284c7e | One ingest door for forwarded voice notes (audio, optional transcript used as is, source tag) over MCP, plus the cloud chat button sending its transcript once (E21-1, E21-3; with EPIC-14 S1 round 2) | done (approved by Jordi 2026-11-08) | none | [#1534](https://github.com/zenod-ai/zenod/pull/1534) `5e0b7dd`, live on cloud.zenod.dev | main | [evidence](evidence/e21-v1-2026-11-08.md) · [card](cards/E21-V1.md) · [contract](voice-note-forwarding.md): 0 transcription calls with a transcript, 1 without, repeats kept once | 2026-11-08 | followups: started V3 |
| V2 | Ticket worker | run_22db4b08-7edb-43ea-a9f8-4be865ee859c | EpicTeam Chat forwards voice notes to Zenod (agent_team side, built as agent_team E42-S39), one real note proven (E21-2) | done (approved by Jordi 2026-11-10) | V1 done; agent_team E42-S39 (live 1f11571, Jordi reconnected 2026-11-08 23:52Z) | agent_team E42-S39 | main | [evidence](evidence/e21-v2-2026-11-09.md) · [card](cards/E21-V2.md) · [private page](http://vps3.taild81fbb.ts.net:8921/e21-v2/): 7 of 7 Chat notes posted since the reconnect in his Log once each, `Source app: EpicTeam Chat`, transcript supplied; 26 card answers and 30 older notes not forwarded (desk note to agent_team 45c3b1f7) | 2026-11-09 | followups: started V5 |
| V3 | Ticket worker | run_22db4b08-7edb-43ea-a9f8-4be865ee859c | EpicTeam Chat forwards its voice notes: follow-up of V1 | done (no confirm: same work as V2, folded into V2's card) | V2 | agent_team E42-S39 | main | see V2 | 2026-11-09 | none |
| V4 | Ticket worker | run_3f9aba7d-ae07-4e96-b7ce-be16ff726677 (agent_team built E42-S42, desk note 45c3b1f7, taken bda1685) | Card voice answers and older Chat notes reach Zenod: agent_team forwards card answers (`fill`) and back-fills the notes keyed on the vn id; Zenod verifies each landed once (E21-2, goal) | done (approved by Jordi 2026-11-10) | agent_team shipped E42-S42 (console 6549192, live 2026-11-10T00:50Z) | agent_team E42-S42 | main | [evidence](evidence/e21-v4-2026-11-10.md) · [card](cards/E21-V4.md) · [private page](http://vps3.taild81fbb.ts.net:8921/e21-v2/): 70 of 70 back-filled and forwarded notes once each (+1 since, 71 of 71), right `Source app:` and own capture time; 103 voice notes since 11-02 = 32 WhatsApp + 71 forwarded, none missing or doubled; test notes vn_8a891947 and vn_e59dac3f only in the immutable Log, on no page | 2026-11-10 | followups: none; confirm: yes — only Jordi can say whether his own notes are where he expects them in his memory |
| V5 | Ticket worker | run_3f9aba7d-ae07-4e96-b7ce-be16ff726677 | Card answers and older Chat notes reach Zenod: follow-up of V2 | done (no confirm: same work as V4, on V4's card) | V4 | agent_team E42-S42 | main | see V4 | 2026-11-10 | none |
| V6 | Ticket worker | unassigned | Count how many of Jordi's EpicTeam voice notes (Chat, card answers, calls) landed in Zenod, show the count on a page, and close any gap toward 90% or more | ready | none | agent_team E42-S39, E42-S42 | main | none | 2026-11-10 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “One home for all your voice notes: other apps forward to Zenod” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:53Z · 9 min 31 s · $0.025 (gpt-4o-mini-transcribe) · vn_d4b0d617 Audio: https://team") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager with EPIC-14 S1 round 2 (Jordi's relaunch vn_10331915: "Are we then transcribing twice? … can we send him the transcription if we already have it?"): one worker builds the ingest door that accepts a ready transcript, so neither the cloud chat button nor forwarding apps transcribe twice. | one seam, one worker | vn_d4b0d617, vn_10331915 | — |
| 2026-11-09 | accepted | V2 answered Jordi's "are my voice notes landing?" (vn_bd75972d) read only: Chat forwarding works; the gaps are agent_team's (card answers, no replay) and go to them as a desk note, never edited here (root L-7) | V3 folded into V2's card; V4 tracks the back-fill | [evidence](evidence/e21-v2-2026-11-09.md) | agent_team replies |
| 2026-11-10 | accepted | V4 verified agent_team's E42-S42 back-fill read only: 71 of 71 forwarded notes once each, right tag and date; test notes vn_8a891947 and vn_e59dac3f left as immutable Log evidence (on no page, so no vault commit) | V5 folded into V4's card; card `completes: goal` | [evidence](evidence/e21-v4-2026-11-10.md) | Jordi's verdict on V4 |
| 2026-11-10 | accepted | desk notes about the voice-note back-fill closed and answered | agent_team took both gaps (95f3ee0) and V4 verified their back-fill (97864d7) | 95f3ee0, 97864d7 | never |
| 2026-11-10 | reopened | Jordi in Jordi's voice note 2026-11-10 23:08Z (Zenod Log/2026-11-10.md#^e-449504): "Zenod will have a pretty damn good feel for what's going on in Epic Team. If he gets like 90% of the voice notes"; the wake asks to confirm every voice note he leaves in EpicTeam (Chat, cards, calls) lands in Zenod and to show the count (root L-37) | V6 ready, epic active again | his note | V6 result |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
