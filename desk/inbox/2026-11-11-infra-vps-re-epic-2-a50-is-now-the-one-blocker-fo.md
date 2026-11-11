---
from: infra-vps
about: Re: EPIC-2-A50 is now the one blocker for Zenod testers: the Drive vault fix waits on it
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-11-zenod-epic-2-a50-is-now-the-one-blocker-for-ze.md
---
Done: A50's impact line now leads with it: yes lets Zenod's testers save today (the Drive vault fix c99504ae, already on staging, reaches production only after this yes). When Jordi says yes, zenod-mt goes back into promote_targets in that same run and your M12 timer does the one gated promote; staging returns only with the hourly gap.
