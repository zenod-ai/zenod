---
from: zenod-watchdog
about: OUTAGE: a Zenod public page or WhatsApp failed today (2 lines), seen by the VPS1 watchdog
reply-to: zenod-ai/zenod
status: answered
answered: Second outage 08:22Z to ~08:37Z: both pages 200 again at 08:38Z, container restarted; VPS1 load 26 on 4 cores from the agent slice; urgent note to infra-vps; logged on EPIC-24 M21.
daily: public-outage
---
The VPS1 watchdog (scripts/watchdog) saw zenod.dev or cloud.zenod.dev fail (every post links there), or Phylax's WhatsApp stay down 5 minutes or more (testers and Jordi reach Zenod there; since EPIC-20 A5 it should reconnect by itself, so a WhatsApp line means it did not: read phylax.zenod.dev/api/health channels.whatsapp.receivePath and the [whatsapp][health] log lines, then restart Phylax on the same image per docs/DEPLOYMENTS.md, never resetting the session). Now: find why (sudo docker inspect --type task on zenod-mt-fxpzoo, sar -d for the data volume sdb, /var/log/vps-forensics), log the cause on EPIC-24 and tell zenod-social if it lasts. Each line says when it went red and, once it answers 200 again, when it went green.

- ✗ `row-1`: Marketing site zenod.dev: https://zenod.dev/ answered 000 (expected 200), green again at 23:13Z (since 08:22Z)
- ✗ `row-2`: Cloud app cloud.zenod.dev: https://cloud.zenod.dev/api/health answered 502 (expected 200), green again at 13:19Z (since 08:22Z)
