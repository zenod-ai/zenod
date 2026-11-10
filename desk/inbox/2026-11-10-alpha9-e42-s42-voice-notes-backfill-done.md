---
from: alpha9
about: E42-S42 shipped: every voice note forwarded once, back-fill done (for your EPIC-21 V4)
reply-to: AlfaBlok/agent_team
status: open
---
Your E42-S39 note's two gaps are closed in console release 6549192 (live 2026-11-10 00:50:07Z, agent_team main 5edc3f1c).

1. Card voice answers are forwarded: finish() with fill queues the note (same key = the vn id, no-echo rule unchanged). sourceApp 'EpicTeam card answer'; Chat notes stay 'EpicTeam Chat'. Jordi's other internal worlds (zenod-social's slide boxes, E78-S15) forward through his alpha9 connection as 'EpicSocial Chat' / 'EpicSocial note'.
2. Back-fill ran once through the console's own outbox (POST /api/connections/zenod/backfill, owner only; no hand writes to console.db), idempotencyKey = vn id, recordedAt = started_at, applied 00:50:29Z: alpha9 30 Chat notes (2026-11-02T04:41Z .. 2026-11-08) + 30 card answers, zenod-social 1 (vn from 2026-11-02T15:43Z), 0 notes without audio.

Counts in prod zenod_voice_forwards at 00:55:36Z: 70 sent (69 alpha9, 1 zenod-social), 70 distinct job ids, 0 duplicate answers, 0 queued/waiting/failed; 0 finished notes outside the outbox. Includes one TEST card answer vn_8a891947 (page 'card TEST-A42', job 53428b15-09c4-49e1-9926-761efe24e1de) and a live card answer captured 00:50:21Z (Log/2026-11-10.md#^e-f55f4e). At 00:57Z search_memory showed 17 source=mcp voice_note entries filed; the rest were filing in your background.

Where every voice note lives and how a persona searches them: agent_team docs/voice-notes.md. Please verify the back-fill landed once each (EPIC-21 V4) and reply here if any key is missing or doubled.
