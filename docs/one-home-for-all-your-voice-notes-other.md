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

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-09 V2 (with V3, run_22db4b08): read-only check of Jordi's question "are my voice notes actually landing in Zenod?" across his Zenod Log and agent_team's forward outbox
Result: yes. All 7 EpicTeam Chat notes posted since his reconnect (2026-11-08 23:52Z) are in his memory once each, tagged EpicTeam Chat, transcript supplied; WhatsApp lands as before (25 from 6 to 9 Nov). Two agent_team-side gaps: voice answers spoken into cards are never forwarded (26) and notes from before forwarding were not replayed (30). No Zenod fault; no reconnect needed. E21-1 met by V1 (approved), E21-2 proven pending Jordi's verdict on V2, E21-3 met by the V1 contract.
Evidence: [e21-v2-2026-11-09.md](evidence/e21-v2-2026-11-09.md), private page http://vps3.taild81fbb.ts.net:8921/e21-v2/
Waiting on: V2's review card; agent_team on the desk note (card answers and back-fill, V4)
Approved work: none
Next action: V2 in review; V4 verifies the back-fill once agent_team answers
Source revision: main (docs only; no code changed)
Verified at: 2026-11-09T23:25Z

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
| V4 | Ticket worker | run_3f9aba7d-ae07-4e96-b7ce-be16ff726677 — claimed 2026-11-10T02:34Z, lease until 2026-11-10T04:34Z | Card voice answers and older Chat notes reach Zenod: agent_team forwards card answers (`fill`) and back-fills the 56 notes keyed on the vn id; Zenod verifies each landed once (E21-2, goal) | active | agent_team shipped E42-S42 (console 6549192, live 2026-11-10T00:50Z; taken bda1685, our note closed 95f3ee0) | - | main | 26 card answers and 30 notes posted 2026-11-02..08 not in Zenod ([evidence](evidence/e21-v2-2026-11-09.md)) | 2026-11-09 | waits on agent_team's reply to the desk note; then count each id once in his Log |
| V5 | Ticket worker | unassigned | Card answers and older Chat notes reach Zenod: follow-up of V2 | ready | agent_team shipped E42-S42 (console 6549192, live 2026-11-10T00:50Z; taken bda1685, our note closed 95f3ee0) | none | main | Jordi started it when closing V2 2026-11-10 | 2026-11-10 | same work as V4: waits on agent_team shipping card-answer forwarding and the back-fill (desk note 45c3b1f7); Zenod verifies each lands once |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “One home for all your voice notes: other apps forward to Zenod” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:53Z · 9 min 31 s · $0.025 (gpt-4o-mini-transcribe) · vn_d4b0d617 Audio: https://team") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager with EPIC-14 S1 round 2 (Jordi's relaunch vn_10331915: "Are we then transcribing twice? … can we send him the transcription if we already have it?"): one worker builds the ingest door that accepts a ready transcript, so neither the cloud chat button nor forwarding apps transcribe twice. | one seam, one worker | vn_d4b0d617, vn_10331915 | — |
| 2026-11-09 | accepted | V2 answered Jordi's "are my voice notes landing?" (vn_bd75972d) read only: Chat forwarding works; the gaps are agent_team's (card answers, no replay) and go to them as a desk note, never edited here (root L-7) | V3 folded into V2's card; V4 tracks the back-fill | [evidence](evidence/e21-v2-2026-11-09.md) | agent_team replies |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
