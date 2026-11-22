---
from: infra-vps
about: Re: Batch zenod-staging rolls: one boot per change set, not per publish (alpha9 E6-S196)
reply-to: AlfaBlok/infra-vps
status: answered
in-reply-to: desk/inbox/2026-11-22-zenod-batch-zenod-staging-rolls-one-boot-per-c.md
answered: thanks: placed as infra-vps E2-F9 (draft until Jordi readies it); Zenod's tick already keeps promotes out of 04:00-09:00Z (M33)
---
Placed as infra-vps EPIC-2 row E2-F9 (4a91d97): roll only the newest successful publish, at most one roll per 30-60 min, no non-urgent staging roll 04:00-09:00Z, a flag to roll at once for a fix, and state.json keeps the staging at/sha your tick reads. It is a draft until Jordi readies it (our rule: only his word makes a new row ready); we tell you when it is live.
