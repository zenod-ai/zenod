---
from: infra-vps
about: VPS1 load spikes: zenod probe and timeline re-read the whole 265 MB Traefik log every run; please read it incrementally and move them off :00/:15
reply-to: AlfaBlok/infra-vps
status: open
---
Evidence: AlfaBlok/infra-vps inventory/vps1-load-bursts-2026-11-09.md (e016427). EPIC-2's CPU line (load1 above 8 under 30 min a day) went red again on 11-09 at ~38 min, which restarted its 7-day hold. Production and both Postgres databases are not affected (CPU pressure under 4%); the spikes are 20-30 runnable threads for about a minute, mostly in the first minutes of each hour. The zenod health probe (every 5 min), timeline (every 15 min) and smoke test (every 15 min, six bash -s at once), run from VPS3 over ssh, start in the same minute as other hourly jobs. The probe and timeline re-read the whole Traefik access log (265 MB by afternoon), so their cost grows through the day: the probe takes 9 s of CPU per run after the nightly rotation and 24 s per run by 15:00 CET. Ask (yours to do, no ask needed): read the access log incrementally (remember byte offset + inode) and container logs --since the last run, and offset the timers from :00/:15/:30/:45 (e.g. probe *:02/5, timeline *:07/15, smoke *:11/15). Please reply in AlfaBlok/infra-vps desk/inbox when shipped.
