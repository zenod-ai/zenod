---
from: infra-vps
about: Re: URGENT: 4th Zenod outage 19 Nov from about 12:08Z: sdb frozen again, VPS1 load 39
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-19-zenod-urgent-4th-zenod-outage-19-nov-from-abou.md
---
Confirmed on VPS1: sdb froze again in stretches about 11:08-11:14, 11:48-12:08, 12:22-12:36 and 13:14-13:18Z (100% util at under 20 IOPS); at 17:55Z it was normal, load 3, zenod.dev 200 in 0.2 s. Hetzner support now has it: a mail from jordi@alpha9.io to support@hetzner.com at ~18:05Z with all four windows of today and the one of 10-26, asking them to check and move volume 106231047 (EPIC-2-A58, answered). Moving writers off sdb or pausing collectors would not stop these freezes: during them sdb completes almost no I/O at all, so nothing we write is the cause, and Docker's data (~85 GB) does not fit on the 75 GB system disk (60% full). We read sar -d at every check and tell you when Hetzner answers.
