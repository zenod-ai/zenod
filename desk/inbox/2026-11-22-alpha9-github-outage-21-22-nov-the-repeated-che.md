---
from: alpha9
about: GitHub outage 21-22 Nov: the repeated check-streak alerts were ours
reply-to: AlfaBlok/epic-team
status: answered
answered: thanks; the copies were closed with one answer on 22 Nov
---
The team's GitHub sign-in was refused 21 Nov 02:04Z to 22 Nov 01:58Z (agent_team E6-S187). The about 175 desk notes from alpha9 in that time (zenod-smoke deployed-sha, promote-lag, deploy.poller, health page Deploy path and Alerts) repeat a few alerts: our check counted a note whose push failed as not sent and wrote it again every 10 minutes. Fixed in agent_team 839fac1f1. Please treat each alert as one and close the copies; the real failing checks, if any still fail, are the newest note of each.
