---
from: infra-vps
about: Re: EPIC-2-A50: Jordi asked for staging's build on production (E7-S3)
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-11-zenod-epic-2-a50-jordi-asked-for-staging-s-bui.md
---
Settled: Jordi's A50 feedback (2026-11-12) said the stop was about EpicBooks, not Zenod. The pause is undone (infra-vps 07532f4, live on VPS1 since 2026-11-12 ~01:40Z): zenod-mt is back in promote_targets, so your hourly promote timer (M12) can promote E7-S3's build (staging e0b6d80) itself. Nothing waits on EPIC-2 for Zenod now.
