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
- [ ] E21-2 EpicTeam Chat forwards Jordi's voice notes to it (the agent_team side is agent_team's change, proposed to them), proven with a real forwarded note landing once in his memory.
- [ ] E21-3 Any provider can forward with a documented contract and its own scoped credential.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: V1 dispatched (with EPIC-14 S1 round 2: no double transcription)
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No agent_team machinery inside Zenod (root L-7): the seam is MCP; EpicTeam Chat's forwarding is built on the agent_team side.
- WhatsApp voice notes unchanged.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 | Ticket worker | run_7966dd8b-8633-4403-af3c-43ca19284c7e — claimed 2026-11-08T19:46Z, lease until 2026-11-08T21:46Z | One ingest door for forwarded voice notes (audio, optional transcript used as is, source tag) over MCP, plus the cloud chat button sending its transcript once (E21-1, E21-3; with EPIC-14 S1 round 2) | active | none | `wt/e21-v1` | main | none | 2026-11-08 | dispatch |
| V2 | Ticket worker | unassigned | EpicTeam Chat forwards voice notes to Zenod (agent_team side, proposed to agent_team), one real note proven (E21-2) | draft | V1 | - | main | - | 2026-11-08 | after V1 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “One home for all your voice notes: other apps forward to Zenod” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (Chat), 2026-11-08 18:53Z · 9 min 31 s · $0.025 (gpt-4o-mini-transcribe) · vn_d4b0d617 Audio: https://team") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager with EPIC-14 S1 round 2 (Jordi's relaunch vn_10331915: "Are we then transcribing twice? … can we send him the transcription if we already have it?"): one worker builds the ingest door that accepts a ready transcript, so neither the cloud chat button nor forwarding apps transcribe twice. | one seam, one worker | vn_d4b0d617, vn_10331915 | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
