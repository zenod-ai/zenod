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
Status: active (V6 done, approved by Jordi 2026-11-11; V7 closed 2026-11-11; V8 closed 2026-11-16: the team reads back the original audio of Jordi's WhatsApp notes)
Last attempted: 2026-11-23 Ticket worker run_0d1a6a94: V9 finished and live on production 49f5ca5c (#1753 closed the opened-note and search-hit gaps, test notes proof at http://vps3.taild81fbb.ts.net:8921/v9/); earlier run_f0b9fae5 built #1751 (d4aa9560, ci green): every voice note shows From EpicTeam Chat, From an EpicTeam card answer, From <app> or Spoken to Zenod, with a real title; search_memory takes label and origin; the Recent saves list filters by it; existing notes labelled from the stored Source app line
Result: calls 32 of 32 since 2 Nov, all voice items 172 of 172, last 7 days 140 of 140 (agent_team count 08:03:07Z) ; call_7415c108 found by source id as Log/2026-11-11.md#^e-63d037 (vault rev 4b4014fc) ; agent_team 4b1546f now resends a dead call job once by itself ; Zenod fix #1628 (1b3f3a12) reaches production with the next promote
Evidence: [v9/](evidence/v9/) · [v8-2026-11-16.md](evidence/v8-2026-11-16.md) · [e21-v7-2026-11-11.md](evidence/e21-v7-2026-11-11.md) · [e21-v6-2026-11-10.md](evidence/e21-v6-2026-11-10.md) · live count http://vps3.taild81fbb.ts.net:8921/v6-voice-note-count/
Waiting on: Jordi's verdict on the V9 card ; #1628 rides the promote on infra-vps/EPIC-2-A50
Approved work: none
Next action: Jordi opens the V9 card and says whether the labels are what he meant; the daily count page keeps watching calls by itself
Source revision: main ce6ef831 (scripts/voice-note-count only, no app code)
Verified at: 2026-11-23T11:55Z (production 49f5ca5c via /api/health and the live bundle holding the V9 note label, run_0d1a6a94)

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
| V6 | Ticket worker | run_2aeaac10-229e-4f2c-a93f-79ae3a30f907 | Count how many of Jordi's EpicTeam voice notes (Chat, card answers, calls) landed in Zenod, show the count on a page, and close any gap toward 90% or more | done (approved by Jordi 2026-11-11) | none | [#1610](https://github.com/zenod-ai/zenod/pull/1610) `ce6ef831`, agent_team E42-S39, E42-S42 | main | [evidence](evidence/e21-v6-2026-11-10.md) · [card](cards/V6.md) · [live count](http://vps3.taild81fbb.ts.net:8921/v6-voice-note-count/): last 7 days 103 of 114 (90%), since 2 Nov 110 of 147 (75%); Chat 50/50, cards 60/60, calls 0/37 (desk note agent_team 66fe92bef) | 2026-11-10 | followups: started agent_team E42-S47 (call transcripts through store_memory, call id as sourceId and idempotencyKey, 37 back-filled; desk notes 66fe92bef, 11ce19d07, which replaces e9a5aef8f); the count matches calls by call id (#1613); confirm: yes — only Jordi can say whether the count answers his question and whether calls must reach Zenod |
| V7 | Ticket worker | run_e7c9cb19-5bbe-46e5-87af-188ecf0dedc8 | EpicTeam calls: find why store_memory job f1e02e14-2fb3-412a-bd6d-d348e9099cc9 (call_7415c108, accepted 2026-11-11 01:24:59Z) wrote no Log entry and write it; count the 5 calls with no words kept (call_46755499, call_747961f5, call_c5d23c48, call_4a83e358, call_2eec04be) as no words kept, like short calls | done (no confirm: plumbing, counted in V6; call_7415c108 found by source id as Log/2026-11-11.md#^e-63d037) | V6; agent_team resend; #1628 reaches production at the next promote (paused on VPS1) | [#1628](https://github.com/zenod-ai/zenod/pull/1628) merged `1b3f3a12` (staging and production wait on the paused roll and promote) | main | [evidence](evidence/e21-v7-2026-11-11.md): cause = job ended `error: could not lock config file .git/config` (two git calls on the vault clone at once) and enqueue kept that dead receipt for its key; fix = config-lock retry + a failed store job with a sourceId re-runs on a same-key resend (#1628); count read only 04:52Z: calls 31 of 32, all 166 of 167, last 7 days 135 of 135, 5 calls no words kept; desk notes answered (agent_team cab11d936, e04824eb2) | 2026-11-11 | none: closed 2026-11-11 by Delivery Manager run_05913d54; #1628 reaches production with the promote on infra-vps/EPIC-2-A50 |
| V8 | Ticket worker | run_f8dbeb3a-8747-4a89-847a-b8f63623222d (built by run_00512111: #1678, #1680) | A read-only tool that returns the archived original audio of one voice note by its Log evidence ref (owner tenant only, through team-services, no new key): Zenod archives each WhatsApp note in Drive with a sha256 in the Log entry, but no team service can read the bytes | done (no confirm: a team tool; alpha9 plays the audio) | none | [#1678](https://github.com/zenod-ai/zenod/pull/1678) + [#1680](https://github.com/zenod-ai/zenod/pull/1680) merged, live c0f6ec83 | main | [evidence](evidence/v8-2026-11-16.md): owner call through team-services on Log/2026-11-15.md#^e-70debb gave audio/ogg 17735 bytes, sha256 173b60b3…641aa2 = the Log entry, plays (Opus 7.7 s); the test customer token gets `Tool get_raw_artifact not found`; no token 401; desk request answered | 2026-11-16 | none: closed 2026-11-16 by Ticket worker run_f8dbeb3a |
| V9 | Ticket worker | unassigned | Label each voice note by where it was spoken: in Zenod's memory list, entry view and search, a note from an app shows a plain label (From EpicTeam Chat, From an EpicTeam card answer, From EpicSocial; read from the Source app ingest_voice_note already gets) and a note spoken straight to Zenod (WhatsApp, web, call) shows Spoken to Zenod; the entry title is no longer the raw file name; search can filter by it. Jordi (vn_42bc4eb9, 17 Nov): "memories that are happening within an app are different than memories that are originated directly in Zenod" | done (approved by Jordi 2026-11-24) | none | [#1751](https://github.com/zenod-ai/zenod/pull/1751) merged d4aa9560 (live on production), [#1753](https://github.com/zenod-ai/zenod/pull/1753) merged 49f5ca5c (ci green: the opened note and search hits), live on production 49f5ca5c since 2026-11-23T11:53Z | main | alpha9 improvement request E42-S114 (approved on his note); live on production 49f5ca5c, proof page http://vps3.taild81fbb.ts.net:8921/v9/ (test notes only), shots in evidence/v9/, card docs/cards/V9.md | 2026-11-23 | followups: none; confirm: yes — only Jordi can say whether these labels and words are what he meant. live 49f5ca5c |

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
| 2026-11-10 | accepted | V6 counted read only, matched by source id (sha256 of the EpicTeam note id): Chat and card answers 110 of 110, calls 0 of 37; the calls gap is agent_team's (root L-7), sent as desk note 66fe92bef, nothing built across the seam | daily count page on VPS3 (#1610) | [evidence](evidence/e21-v6-2026-11-10.md) | agent_team answers on calls |
| 2026-11-11 | superseded | Door for EpicTeam calls (agent_team E42-S47 asked): ingest_voice_note on the forwarding door, transcript only, same voice_notes.write grant; not store_memory, which a zvn_ token cannot reach and which would need a wider grant (ask tier) | needs a Zenod row: the door accepts a no-audio call with a required transcript | desk note agent_team e9a5aef8f | the Delivery Manager's decision of the same day (store_memory) replaced it; corrected by desk note agent_team 11ce19d07 |
| 2026-11-11 | updated | V6: your voice note of 2026-11-10 23:08Z added to this: "Zenod will have a pretty damn good feel for what's going on in Epic Team. If he gets like 90% of the voice notes." (mark key 61e62b21) | He confirms the 90% target and asks to verify voice notes reach Zenod memory. | WhatsApp, Log/2026-11-10.md#^e-449504 | when its owner acts |
| 2026-11-11 | decided | decided by Delivery Manager: EpicTeam call transcripts (no audio) reach Zenod through store_memory with contentType voice_note, sourceId and idempotencyKey = the call id; Jordi in his 23:08Z note (Log/2026-11-10.md#^e-449504): "Zenod will have a pretty damn good feel for what's going on in Epic Team. If he gets like 90% of the voice notes" — why: the door already exists and is idempotent, so E42-S47 needs no Zenod build — rollback: switch to a dedicated transcript door later | V6 card folds his 90% target | desk note to agent_team | E42-S47 live |
| 2026-11-11 | accepted | V7 opened from agent_team's desk notes (E42-S47 calls 31 of 37 final): one accepted call never written, five calls kept no words | V7 | desk/inbox/2026-11-11-alpha9-e42-s47-correction-calls-31-of-37-is-fin.md | V7 done |
| 2026-11-16 | accepted | V8 readied as an improvement request Jordi approved in agent_team (E42-S114): one read-only tool returning a voice note's archived audio by its Log ref | owner tenant only, read only, no new key | Delivery Manager run_a11ae60e | desk/inbox/2026-11-16-alpha9-improvement-e42-s114.md | the tool returns the audio |
| 2026-11-16 | closed | V8 done (no confirm): get_raw_artifact live c0f6ec83, owner tenant only; alpha9 calls it through team-services `service_call zenod get_raw_artifact {ref}` | no new key, no PR needed | Ticket worker run_f8dbeb3a | evidence/v8-2026-11-16.md | none |
| 2026-11-23 | accepted | V9 ready on Jordi's words (L-37, vn_42bc4eb9, 17 Nov), relayed by alpha9's improvement request E42-S114: label app notes apart from notes spoken straight to Zenod | his ask is his ready stamp | Delivery Manager run_c12b2601 | alpha9 desk note 2026-11-23 | every note shows where it was spoken |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
