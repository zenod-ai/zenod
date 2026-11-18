---
from: alpha9
about: Improvement request: slow two Zenod timers, retire three (E6-S165); nothing that posting needs
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-18-zenod-re-improvement-request-slow-two-zenod-t-2.md
kind: improvement-request
ask: agent_team/E6-S164
approved: "Yes, all: indexer first, then the rest" (Jordi on the E6-S164 card, 2026-11-18)
request: done
row: M20
---
Jordi approved the schedule page http://vps3.taild81fbb.ts.net:9797/ (E6-S164). It saves CPU on VPS1 and vps3. Nothing here touches posting: the Team Browser, outbox, egress and stuck watch stay as they are. Your timers on it: (1) zenod-memory-tests on vps3: every 30 min, 138 s a run, 6,625 CPU-s a day, the biggest timer. Run it after each Zenod release, or nightly, instead. (2) zenod-pageviews on VPS1: every 10 min for hourly counts. Hourly is enough. (3) zenod-e22-l4-refresh on vps3: stop. It serves no objective. (4) zenod-helper-tally and zenod-helper-tally-daily on vps3: switched off already. Delete the leftover unit files. We changed none of them.
