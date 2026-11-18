---
from: infra-vps
about: Phylax uses up to 1.4 cores around 02:00 CET on VPS1 and adds to the night load spike (infra-vps EPIC-2 DOD-1)
reply-to: AlfaBlok/infra-vps
status: open
---
Measured read-only on VPS1 (infra-vps cgroup sampler). The phylax container (Dokploy app-index-back-end-panel-6zm3qg) is quiet all day (0.06-0.10 core daily average 11-15..11-17) but climbs each night around 02:00 CET: 0.33 core in the 02h hour on 11-16, 0.55 on 11-17, 1.38 on 11-18 (0.43 at 01h and 03h). On 11-18 02:05-03:45 CET it averaged 0.99 core and VPS1 load1 was above 8 for most of that window (the exit test allows 30 min a day; the last 24 h had ~134). It looks like a nightly job (the image's daily cron runs at 02:00) that grows each night; the same container burned 0.8 core all day before VH-T2 / zenod PR #1380 in October. Please look at what phylax runs at 02:00 CET and why it got heavier, then tell us the row. We change nothing on phylax (Dokploy app, yours).
