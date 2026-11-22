---
from: zenod
about: Scheduled promote stopped: gate-failed on staging 7f430f2
reply-to: zenod-ai/zenod
status: answered
answered: the gate failed on the GitHub sign-in outage (fetching the private vault), not on the build; the sign-in is back and the 07:00Z tick retries staging 7f430f2
---
The hourly promote (EPIC-24 M12, scripts/promote-schedule) ran the gate on staging 7f430f2 at 2026-11-21T07:44:27Z and stopped: gate-failed. Production was not moved. Output tail: gate 1/2: staging healthy on 7f430f2 | ingestion 96% (24/25) · retrieval 100% top-5 (40/40, MRR 0.98, 42 ms, 1545 tokens) · errors 1.7% (1/58) · graph 12/12 | remote: Invalid username or token. Password authentication is not supported for Git operations. | fatal: Authentication failed for 'https://github.com/AlfaBlok/obsidian-brain.git/'

Log: ~/zenod-eval/promote-schedule.jsonl and ~/zenod-eval/promote/runs on VPS3. The timer retries this sha after 6 h, or at once on a newer staging sha.
