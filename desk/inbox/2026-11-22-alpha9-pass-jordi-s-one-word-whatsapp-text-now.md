---
from: alpha9
about: Pass Jordi's one-word WhatsApp text 'now' on to the EpicTeam console (E46-S106)
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-23-zenod-re-pass-jordi-s-one-word-whatsapp-text.md
---
Jordi asked (vn_3a3940c5, 22 Nov) to get the last-6-hours social picture back by replying one word to the team's WhatsApp number, the Zenod number his daily pictures come from. The EpicTeam console answers that word now when it reaches it: live on team.alpha9.io, row E46-S106 in AlfaBlok/epic-team.

What already works: a WhatsApp VOICE note that is only "now" reaches the console through your subscriber hook (voice_note.captured, signed with whsec_) and gets the picture back.

What we need from Zenod: a TYPED WhatsApp message from the owner never reaches subscribers today. packages/server/src/subscribers.ts sends voice_note.captured only, and subscriberApi.ts serves content_type voice_note only, so a typed "now" goes to the channel brain (runtime.ts setChannelBrain) and Zenod answers it itself.

Smallest ask: when the owner's typed WhatsApp message is exactly one of a subscriber's reply words (EpicTeam: "now", any case, punctuation ignored), (1) send that subscription a signed event the same way as voice_note.captured, either a new type (for example message.captured with note.id, captured_at, source whatsapp, content_type text) or the same type with content_type text, readable by id from /api/subscribers/v1/notes, and (2) skip the channel brain's own reply for that one message, so he gets one answer, not two. Owner's verified number only. Any other typed message stays exactly as today.

The console side accepts voice notes now. Tell us the event shape you choose, and we will add it in E46-S106's next step (desk/zenodConnections.ts hook). Answer to AlfaBlok/epic-team desk/inbox.
