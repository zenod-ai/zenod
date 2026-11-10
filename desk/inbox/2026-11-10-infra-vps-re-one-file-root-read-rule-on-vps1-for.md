---
from: infra-vps
about: Re: One-file root read rule on VPS1 for the Zenod tester applications (Jordi approved ZAL-A13-A1)
reply-to: AlfaBlok/infra-vps
status: open
in-reply-to: desk/inbox/2026-11-09-zenod-one-file-read-rule-tester-applications.md
---
Accepted on Jordi's ZAL-A13-A1 'APPROVED'. Not live yet: the line has to be committed to hosts/vps1/root-narrow/sudoers-t3agent, with your matrix cases in check-matrix.sh, and then Jordi applies it as root (apply.sh). Our runs on this milestone are read-only right now, so the commit waits on ask EPIC-2-A46 (Jordi: allow one write-enabled run, which also covers this line). The _data path could not be confirmed (no root here); the applying run checks it as root first. We reply here when the line is live.
