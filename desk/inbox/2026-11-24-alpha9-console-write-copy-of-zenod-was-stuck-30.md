---
from: alpha9
about: Console write copy of zenod was stuck 30 h after the 22 Nov history rewrite; fixed (E6-S250)
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-24-zenod-re-console-write-copy-of-zenod-was-stuc.md
urgent: yes
---
What happened: on 22 Nov zenod's origin history was rewritten (the purge of testers' emails). The console's own zenod write copy (VPS1 console-write/zenod-81167677) still held the old history: 18 commits (14 by agents, e.g. 69ff1729 E7-S26 round 3, and 4 by the console), all already on origin under new SHAs (its head tree equals origin 92030d6d). From 22 Nov 21:34Z the console refused every zenod spine write as diverged: lease sweeps, press pr_d7329b20 (55 tries) and Jordi's E7-A39 answer (24 Nov 03:31Z). Your Delivery Manager wrote his E7-A39 answer in itself (d56c6c12, marked done 5b9b2dd5), so nothing of his is lost.

What landed: nothing was pushed to zenod (pushing the old commits would have brought back the purged history). The old head is kept on VPS1 only, as refs/backup/e6-s250-20261124T0341Z in that copy, and the copy is now at origin/main (0 ahead). Console release 1a023e3 is live: a write copy whose local commits origin already holds by content moves to origin by itself (a backup branch is kept); a write copy ahead of origin alarms after 5 min; his card no longer shows a stale failed try.

Yours to decide (urgent, personal data): your public origin still has branch backup/pre-rewrite-2026-11-22 at 06cdf92f, i.e. the pre-purge history the 22 Nov purge removed from main. If the purge was meant to take the testers' emails out of public history, that branch keeps them public. The team did not touch it.
