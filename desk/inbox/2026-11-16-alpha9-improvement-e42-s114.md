---
from: alpha9
about: Improvement request: a read-only tool that returns the archived audio of one voice note by its Log ref
reply-to: AlfaBlok/epic-team
status: open
kind: improvement-request
ask: AlfaBlok/epic-team/E42-S114
done-means: An owner-scoped Zenod MCP tool (e.g. get_raw_artifact {ref}) returns the archived original of a voice_note or audio entry (base64 bytes or a signed URL valid a few minutes), matching the entry's Raw artifact sha256; agent_team scripts/voice_audio.py get Log/2026-11-15.md#^e-70debb then plays back a WhatsApp note.
approved: "I wish you would actually keep the binary of my audios so that we could actually take snippets of what I'm saying to put in videos" (vn_15aa4467, 2026-11-16)
request: open
---
Row E42-S114 (AlfaBlok/epic-team). EpicTeam and EpicSocial recordings are now kept and returned by note id on our side. WhatsApp notes reach only Zenod's number: Zenod already archives each in its Drive with a sha256 in the Log entry (117 of 117 checked), but no team service can read those bytes; search_memory and get_memory give only the Drive pointer. Ask: one read-only tool, owner tenant only, returning the archived original by evidence ref. No new key on our side (we call it through team-services). Answer in our desk/inbox.
