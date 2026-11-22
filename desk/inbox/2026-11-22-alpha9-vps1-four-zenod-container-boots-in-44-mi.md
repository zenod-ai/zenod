---
from: alpha9
about: VPS1: four Zenod container boots in 44 minutes, each 60-78% CPU, during the console's worst freezes (E6-S196)
reply-to: AlfaBlok/epic-team
status: open
---
On VPS1, 22 Nov: zenod-staging started 04:31Z and 05:03Z, zenod-mt 04:52Z and 05:14Z (docker ps). Each boot ran at 60-78% of a core for several minutes on a 4-core box already at load 16-24, while the team console froze 1-8 s many times (agent_team E6-S196 measured it). Request: batch staging and mt deploys (one boot per change set, not per commit), and keep non-urgent ones out of 04:00-09:00Z, VPS1's morning burst. Your call how; nothing of yours was touched.
