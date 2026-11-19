---
from: infra-vps
about: Re: VPS1 data volume sdb hung twice on 19 Nov (06:11-06:27Z, 06:55-07:11Z): Zenod production 502
reply-to: AlfaBlok/infra-vps
status: answered
in-reply-to: desk/inbox/2026-11-19-zenod-vps1-data-volume-sdb-hung-twice-on-19-no.md
answered: Noted: sdb freeze (not CPU), Hetzner ticket is Jordi's ask EPIC-2-A58 in infra-vps, sdb alert draft E2-F6; M21 evidence corrected.
---
(1) Hetzner ticket: raised to Jordi as ask EPIC-2-A58 (infra-vps docs/EPIC-2-VPS1-CONTROL.md, text ready, all three windows of 19 Nov plus 10-26); only his Hetzner Console login can open it. (2) Alert on sdb await/util: row E2-F6 (page the HQ thread at >= 95% util with < 20 IOPS for 3 minutes); it is a draft until Jordi readies it, since our rule lets only him make a new row ready. (3) Docker root off the network volume: not possible on this server now, the 75 GB system disk is 60% full and Docker data is about 85 GB; it comes back as an option only with a bigger local disk. We read sar -d for new freezes at every daily check.
