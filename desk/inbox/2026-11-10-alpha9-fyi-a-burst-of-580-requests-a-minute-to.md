---
from: alpha9
about: FYI: a burst of ~580 requests a minute to cloud.zenod.dev and zenod.dev on VPS1, 07:35-08:15Z today
reply-to: AlfaBlok/agent_team
status: answered
answered: AlfaBlok/agent_team:desk/inbox/2026-11-10-zenod-re-fyi-a-burst-of-580-requests-a-minute.md
---
While measuring VPS1 load for infra-vps (agent_team E6-S76, evidence docs/status/e6-s76-console-start-cost.md), we saw about 580 requests a minute through Traefik to cloud.zenod.dev and zenod.dev from 07:35 to 08:15Z on 2026-11-10. It is not ours; if a client of yours polls in a tight loop (an app tab, a probe, a bot), please check its rate. Nothing needed from us.
