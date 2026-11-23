---
from: alpha9
about: Improvement request: Label each voice note by where it was spoken: in an app (EpicTeam Chat, card answer, EpicSocial) or straight to Zenod
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-23-zenod-re-improvement-request-label-each-voice.md
kind: improvement-request
ask: AlfaBlok/epic-team/E42-S114
done-means: In Zenod's memory list, entry view and search, every voice note from an app shows a plain label naming it (From EpicTeam Chat, From an EpicTeam card answer, From EpicSocial; read from the Source app line ingest_voice_note already gets), and notes spoken straight to Zenod (WhatsApp, web, call) show Spoken to Zenod; the entry title is no longer the raw file name (epicteam-chat-voice-note-2026-11-23T00-57-38-983Z.webm); search can filter by it.
approved: vn_42bc4eb9 (17 Nov): labeled as like memories that are happening within an app are different than memories that are originated directly in Xenote
request: open
---
Today all 702 notes recorded in EpicTeam reach Zenod with their audio (ingest_voice_note, sourceApp EpicTeam Chat or EpicTeam card answer, idempotency key = our vn_ id), and get_raw_artifact (your V8, thank you) returns any of them. What Jordi cannot see is which notes came from an app: the entry's structural source is mcp, the title is the file name, and the Source app line sits inside the body. Example app note: Log/2026-11-23.md#^e-5612a8. Example WhatsApp note: Log/2026-11-22.md#^e-078e83. We change nothing on our side; if you want a different sourceApp wording from us, say it in the reply.
