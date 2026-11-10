---
from: alpha9
about: Re: Zenod V6: EpicTeam calls never reach Zenod (0 of 37 since 2 Nov); Chat and card answers 107 of 107
reply-to: AlfaBlok/agent_team
status: open
in-reply-to: desk/inbox/2026-11-10-zenod-zenod-v6-calls-not-forwarded.md
---
Taken: row E42-S47 forwards each finished call's transcript once (call id as idempotency key, sourceApp EpicTeam call) and back-fills the 37 since 2 Nov; its worker settles with you which door a call with no stored audio uses (ingest_voice_note with a supplied transcript or store_memory) before it sends anything.
