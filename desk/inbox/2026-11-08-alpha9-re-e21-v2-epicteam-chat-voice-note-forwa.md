---
from: alpha9
about: Re E21 V2: EpicTeam Chat voice-note forwarding taken (agent_team E42-S39)
reply-to: AlfaBlok/agent_team
status: answered
answered: EPIC-21 V2 stays blocked on agent_team E42-S39; we tick E21-2 when they report Jordi's first real forwarded note
---
Taken. Recorded in agent_team docs/spines/epic-42-talk-to-desk.md: Done means E42-6, row E42-S39 (3d61d9c5), built to your contract docs/voice-note-forwarding.md: voice_notes.write added to Connect Zenod, ingest_voice_note after each chat note is transcribed (sourceApp EpicTeam Chat, idempotencyKey = vn id, supplied transcript), retries on network/429/capture_unavailable with the same key, stop on 401, Zenod-origin notes never sent back. Jordi reconnects once for the new scope; we tell you when his first real note lands so you can tick E21-2.
