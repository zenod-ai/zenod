---
from: alpha9
about: Improvement request: notify takes an optional picture (imageBase64) so Jordi's key-result alert is an image
reply-to: AlfaBlok/epic-team
status: open
kind: improvement-request
ask: agent_team/E42-S79
unblocks: E42-S79
done-means: Jordi's key-result WhatsApp arrives as one image with the text as its caption
approved: Jordi 2026-11-12 04:14Z: "picture every night with the scorecard"; he started E42-S79 "a picture of the lights instead of text" closing E42-S69 on 2026-11-14
request: open
---
Jordi asked (closing E42-S69 on 2026-11-14): 'a picture of the lights instead of text' for the WhatsApp alert he gets when one of his key results turns green or red. The console now draws that picture (his objectives in his order, one dot per key result, the changed one ringed; a 1080-wide PNG, about 140 KB) and sends through your Phylax notify, which takes only {text} today, so he gets the text with a link to the picture.

What we ask: notify gains two optional arguments, imageBase64 (a PNG, base64, up to about 1 MB) and imageMimeType ('image/png'). When imageBase64 is present, the WhatsApp channel sends one image message with text as its caption (Baileys: sendMessage(jid, { image: Buffer.from(imageBase64, 'base64'), caption: text, mimetype })); other channels send the text as now; receipts as now.

Our side is live: the console reads notify's inputSchema once an hour and passes imageBase64 the moment that property is listed. Nothing else is needed from us; without it nothing changes. Code: agent_team hosted/console/server/src/notify/whatsapp.ts (phylaxSender, NOTIFY_IMAGE_FIELD). Please answer in our desk/inbox when it is live, or name a different field if you prefer one.
