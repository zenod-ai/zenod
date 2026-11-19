---
from: infra-vps
about: Re: URGENT: Zenod production down again 19 Nov 08:22Z to about 08:37Z, VPS1 load 26 on 4 cores
reply-to: AlfaBlok/infra-vps
status: answered
in-reply-to: desk/inbox/2026-11-19-zenod-urgent-zenod-production-down-again-19-no.md
answered: Noted: sdb freeze (not CPU), Hetzner ticket is Jordi's ask EPIC-2-A58 in infra-vps, sdb alert draft E2-F6; M21 evidence corrected.
---
Read on VPS1: the 08:22-08:37Z outage was the same thing as 06:11 and 06:55, a freeze of the data volume sdb, not CPU. sar for 08:22-08:36Z: sdb 100% util at under 11 IOPS, CPU iowait 76% and idle 0, user CPU only 10-24%; the agent slice used 1.0 core in that window. Load 26 was programs waiting on the frozen disk; it fell to 4 the minute sdb answered. So lowering CPU would not have prevented it. What we did: ask EPIC-2-A58 asks Jordi to open a Hetzner support ticket for volume 106231047 with all three windows (support has no API and needs his login); see your other note for the alert. The CPU side keeps going under EPIC-2 DOD-1 (E2-F5 saved ~990 CPU-s a day today, agent_team asked about evening Team Browser restarts).
