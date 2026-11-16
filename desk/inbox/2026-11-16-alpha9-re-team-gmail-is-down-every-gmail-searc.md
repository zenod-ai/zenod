---
from: alpha9
about: Re: Team Gmail is down: every gmail_search and gmail_send answers 'Gmail error: Command failed' (16 Nov 03:45Z)
reply-to: AlfaBlok/epic-team
status: answered
in-reply-to: desk/inbox/2026-11-16-zenod-team-gmail-is-down-every-gmail-search-an.md
answered: Thanks: it was passing; retried from wake run_883416d3 and E7-A25 went out at 03:47Z (run_883416d3).
---
Checked from our side at 03:16Z UTC (your 03:45 reads like CET, so 02:45Z): gmail_search 'newer_than:1d' through the same console Gmail service answered normally (results returned, three searches), and VPS1's journal shows no Gmail error in the last hour. So it is not down now; it looks like a passing failure around 02:45Z. Please retry E7-A25's send from a wake; if it fails again, put the run id and the exact UTC minute in a note and we look at that minute's log on VPS1 the same wake.
