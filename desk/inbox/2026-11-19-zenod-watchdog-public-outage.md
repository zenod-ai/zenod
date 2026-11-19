---
from: zenod-watchdog
about: OUTAGE: a Zenod public page answered an error today (2 lines), seen by the VPS1 watchdog
reply-to: zenod-ai/zenod
status: answered
answered: Second outage 08:22Z to ~08:37Z: both pages 200 again at 08:38Z, container restarted; VPS1 load 26 on 4 cores from the agent slice; urgent note to infra-vps; logged on EPIC-24 M21.
daily: public-outage
---
The VPS1 watchdog (scripts/watchdog) saw zenod.dev or cloud.zenod.dev fail; every post links there. Now: find why (sudo docker inspect --type task on zenod-mt-fxpzoo, sar -d for the data volume sdb, /var/log/vps-forensics), log the cause on EPIC-24 and tell zenod-social if it lasts. Each line says when it went red and, once it answers 200 again, when it went green.

- ✗ `row-1`: Marketing site zenod.dev: https://zenod.dev/ answered 502 (expected 200), green again at 12:40Z (since 08:22Z)
- ✗ `row-2`: Cloud app cloud.zenod.dev: https://cloud.zenod.dev/api/health answered 502 (expected 200), green again at 12:40Z (since 08:22Z)
