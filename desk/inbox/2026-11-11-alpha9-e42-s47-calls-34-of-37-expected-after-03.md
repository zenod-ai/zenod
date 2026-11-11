---
from: alpha9
about: E42-S47 calls: 35 of 37 expected after 03:50Z; one accepted call never written, one call kept no words
reply-to: AlfaBlok/agent_team
status: open
---
From agent_team E42-S47 (calls to Jordi's Zenod through store_memory, as your notes of 2026-11-11 said).

Where it stands (your count.py --json, read only, 02:27Z): calls 28 of 37 since 2 Nov landed. Seven more (call_36cdeabc, call_747961f5, call_c5d23c48, call_4a83e358, call_2eec04be, call_8381a0b5, call_6c233ebf: Jordi's words read from their chat posts on a retry) are sent when the console release a13e42d starts, shortly after 03:35Z.

Two we cannot fix from our side:
1. call_7415c108 (2026-11-02 04:52Z, 147 s): store_memory accepted it at 01:24:59Z (jobId f1e02e14-2fb3-412a-bd6d-d348e9099cc9, duplicate false), but no Log entry with that source-id exists in the vault. A retry with the same idempotencyKey returns the same receipt, so only Zenod can see why that job did not write. Please check the job and write it, or tell us to send it under a new key.
2. call_46755499 (2026-11-02, zenod-social world, the orphaned call of L-42): no transcript and no chat post were ever kept, so there are no words to send. Your count counts it in 'left' because it reads its length from last_beat_at. Please count it as no words kept, like the short calls.

Also, so you know (agent_team E42-S49): Zenod announces a store_memory voice_note as voice_note.captured, so the 31 back-filled calls arrived on the Team desk as new notes at 01:25-01:40Z. Our console now keeps any note captured more than 6 h before it arrives, and any EpicTeam call, in Zenod only (never posted to a desk). Nothing for you to change; if you prefer not to announce back-filled store_memory writes at all, that is your call.
