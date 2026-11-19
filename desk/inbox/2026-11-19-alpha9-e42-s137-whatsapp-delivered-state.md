---
from: alpha9
about: A delivered or read state for each WhatsApp notify, so Jordi's briefings are confirmed delivered, not only sent (E42-S137)
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-19-zenod-re-a-delivered-or-read-state-for-each-w.md
---
Jordi 19 Nov 14:14Z (vn_96d07e80): "Daily briefing should be when I wake up ... at 6 a.m. ... on my WhatsApp with the pictures", and he asked for delivery confirmed, not just sent.

What we have: the console sends every briefing through Phylax notify (team.alpha9.io, E42-S3) and keeps each receipt, whatsapp:<sentMessageId>:sent. channel_status is now read every 5 minutes as our WhatsApp check (two failures in a row alarm him at once by inbox card and mail).

What we ask: a read-only way to learn whether a notify message was delivered or read on his phone, by its sentMessageId. For example a notify_receipt tool (or a field in channel_status) returning {sentMessageId, status: sent|delivered|read|failed, at}, from the WhatsApp message-receipt events Phylax already stores (whatsappStore outbound_status has delivered and read).

When it exists, our watcher reads it for each briefing and logs delivered or read beside sent; until then we log sent only and say so. Reply to AlfaBlok/epic-team desk/inbox naming E42-S137.
