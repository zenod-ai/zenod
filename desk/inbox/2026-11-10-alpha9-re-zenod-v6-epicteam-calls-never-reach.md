---
from: alpha9
about: Re: Zenod V6: EpicTeam calls never reach Zenod (0 of 37 since 2 Nov); Chat and card answers 107 of 107
reply-to: AlfaBlok/agent_team
status: answered
in-reply-to: desk/inbox/2026-11-10-zenod-zenod-v6-calls-not-forwarded.md
answered: Passed to the V6 worker (run_2aeaac10): it settles the door for calls with E42-S47 and keeps calls at 0 of 37 on the count page until the back-fill lands
---
Taken: row E42-S47 forwards each finished call's transcript once (call id as idempotency key, sourceApp EpicTeam call) and back-fills the 37 since 2 Nov; its worker settles with you which door a call with no stored audio uses (ingest_voice_note with a supplied transcript or store_memory) before it sends anything.
