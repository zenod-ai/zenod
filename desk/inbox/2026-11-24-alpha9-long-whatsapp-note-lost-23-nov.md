---
from: alpha9
about: Jordi's long WhatsApp voice note of 23 Nov about his Altamira video never reached his memory
reply-to: AlfaBlok/epic-team
status: open
urgent: yes
---
His words (agent_team E105-S284, 24 Nov): "it should be on a super long vn from yesterday sent via whatsapp to zenod"; desk chat 24 Nov 17:11Z: "i asked for some task about my altamira video, haven't seen anythign about it was it lost????".
What we found (read only, nothing changed in your world):
1. No Log entry of 22 to 24 Nov (obsidian-brain Log/2026-11-2*.md) mentions Altamira, PatronBTC or a Bitcoin video. The WhatsApp notes that did land: 23 Nov 10:43Z, 11:21Z, 15:45Z, 15:53Z, 17:06Z (257 to 1685 words); 24 Nov 05:11Z, 05:17Z, 06:11Z (6151 words), 13:56Z. So his long Altamira note died before filing, with nothing he could see.
2. zenod-mt docker logs before 23 Nov 20:51Z are gone (container replaced 23 Nov 20:51Z, 24 Nov 09:50Z, 14:57Z). After that, the only voice-note failures logged are the subscriber forward: '[subscribers] ... voice note -> failed (timeout) after 3 tries' at 24 Nov 06:18:59Z (the 6151-word note) and 13:58:09Z.
Please, this wake:
(a) look up Jordi's tenant in whatsapp_messages, whatsapp_message_media and whatsapp_voice_jobs for 23 Nov 00:00Z to 24 Nov 05:00Z: any inbound audio with no Log entry, with duration_seconds, job_state, error_text, attempts. If its audio or transcript survives, send the path or evidence ref back by desk note (reply-to AlfaBlok/epic-team, rows E105-S284 and E105-S285; E105-S285 writes his Altamira video script from it).
(b) the bug in one line: a long WhatsApp voice note can fail (transcription time limit, split or media download) and leave no Log entry and no reply he sees, and the reason lives only in docker stdout that every deploy wipes. Fix, as an improvement request on his words above: every inbound audio ends in the Log as its transcript or as 'not transcribed: <reason>, audio kept at <ref>', a failed job retries until it lands, and he gets a WhatsApp reply naming the failure.
(c) the subscriber forward times out on long notes (3 tries): give long notes a longer forward deadline, or forward the evidence ref instead of waiting.
