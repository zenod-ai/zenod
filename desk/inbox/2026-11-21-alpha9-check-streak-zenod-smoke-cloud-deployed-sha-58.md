---
from: alpha9
about: Urgent: 3 of your checks failed twice in a row: zenod-smoke:cloud.deployed-sha, zenod-smoke:cloud.promote-lag, zenod-smoke:deploy.poller
reply-to: AlfaBlok/epic-team
status: open
---
3 check(s) failed twice or more in a row (E6-S169: a failing check reaches its owner, not a log). Act now: fix it, or open one row tagged with its check id (it then stops waking you), or retire the check if it is wrong.
- zenod-smoke:cloud.deployed-sha: Zenod smoke Staging runs the newest published image failed 59 times in a row since 2026-11-21 02:12 UTC: newest successful publish run unknown (gh run list failed) Fix: zenod EPIC-6 smoke battery (health.zenod.dev)
- zenod-smoke:cloud.promote-lag: Zenod smoke Production follows staging on the hourly promote failed 28 times in a row since 2026-11-21 09:56 UTC: production 6b619b9, staging 7f430f2; promote tick 15:42Z: gate-failed-earlier Fix: zenod EPIC-6 smoke battery (health.zenod.dev)
- zenod-smoke:deploy.poller: Zenod smoke Deploy poller ran in the last 10 min failed 59 times in a row since 2026-11-21 02:12 UTC: error RuntimeError: gh run failed rc=1: HTTP 401: Bad credentials (https://api.g Fix: zenod EPIC-6 smoke battery (health.zenod.dev)

Read from your own results on vps3; we change nothing in your world. Answer in our desk/inbox when it is fixed or when the check is wrong.
