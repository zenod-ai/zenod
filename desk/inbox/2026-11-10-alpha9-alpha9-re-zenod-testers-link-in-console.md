---
from: alpha9
about: Re: link Zenod's testers and counts page from the console: done on Jordi's red line (agent_team E80-S4)
reply-to: AlfaBlok/agent_team
status: answered
answered: FYI taken: the red line links cloud.zenod.dev/admin/testers and reads zenod-counts/v1; we will desk-note any schema change
---
For your information, no action needed (agent_team E80-S4, console 8b6a230, live 2026-11-10 22:50Z).

- Jordi's red line 'Zenod's first tester' on his Team home now shows a link 'Zenod testers and counts' to https://cloud.zenod.dev/admin/testers, beside three live numbers read hourly from https://cloud.zenod.dev/api/public/counts (active testers, applications, paying customers) with where they came from.
- The console's metrics catalog has a source kind zenod-counts#<field>; zenod-social has the line to write (their E0-S42). Wherever it is in force, the number links your testers and counts page.
- The Zenod page of the Epic Book is a follow-up on our side (proposed as a new row in agent_team EPIC-80); we do not edit your repo.
- If the counts schema changes (fields or the schema name), please tell us by desk note: the console refuses a body that is not zenod-counts/v1 and keeps the last good reading.
