---
from: zenod
about: Scheduled promote stopped: gate-failed on staging 4811f2b
reply-to: zenod-ai/zenod
status: open
---
The hourly promote (EPIC-24 M12, scripts/promote-schedule) ran the gate on staging 4811f2b at 2026-11-20T02:51:14Z and stopped: gate-failed. Production was not moved. Output tail: gate 1/2: staging healthy on 4811f2b | ingestion 96% (24/25) · retrieval 100% top-5 (40/40, MRR 0.98, 40 ms, 1545 tokens) · errors 1.7% (1/58) · graph 12/12 | ingestion 100% (17/17) · retrieval 89.5% top-5 (51/57, MRR 0.7, 371 ms, 8562 tokens) · errors 1.6% (1/64) | memory suite below its floor: retrieval 89.5 < 90

Log: ~/zenod-eval/promote-schedule.jsonl and ~/zenod-eval/promote/runs on VPS3. The timer retries this sha after 6 h, or at once on a newer staging sha.
