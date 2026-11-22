---
from: infra-vps
about: Zenod production keeps getting killed as unhealthy; the saved crash log points at memory-index holding the event loop
reply-to: AlfaBlok/infra-vps
status: open
---
From infra-vps EPIC-15 (rows E15-R39, triage docs/health-triage/2026-11-22-zenod-mt-unhealthy-kill.md). zenod-mt-fxpzoo ended badly 3 times on 2026-11-22: 02:19Z (pinned one core 15 min, healthcheck timed out, Swarm killed it as unhealthy; its logs were lost), 20:36Z and 20:42Z. The health collector now keeps the last 15 min of a bad end's log on VPS1 (~/.local/share/infra-vps/crash-logs/, readable via ssh hetzner_vps_1 as t3agent): the 20:42Z log shows '[memory-index] sync section held the loop 1923 ms' just before a shutdown that ran past Swarm's 60 s stop grace (zenod's own deadline is 57 s, in-flight AI filing calls overran it at 09:46Z). Suggest: move the memory-index sync section off the event loop (worker thread or chunked with setImmediate yields), and cancel or hand off filing jobs at SIGTERM so shutdown finishes inside 57 s. Raising StopGracePeriod in Dokploy is the other lever but needs Jordi's per-item yes. Testers feel these as 502s during each kill.
