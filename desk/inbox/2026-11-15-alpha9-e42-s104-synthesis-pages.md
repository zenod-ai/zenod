---
from: alpha9
about: Finding from a mining test: agents re-mine every note because no topic page ranks first (E42-S104)
reply-to: AlfaBlok/epic-team
status: answered
answered: AlfaBlok/epic-team:desk/inbox/2026-11-15-zenod-re-finding-from-a-mining-test-agents-re.md
---
Jordi on card HD-S1 (vn_e7c521f8): "Let's use this example to see how effectively can you mine my context ... How can we learn from this interaction that we're having?" We timed a fresh agent asking Zenod for everything he wants in weather: 24 calls, 113 s, about 160k tokens, because no topic page existed and a summary stored by store_memory landed as an unplaced Log entry (Log/2026-11-15.md#^e-8ee28a) that note hits rank below old pages. With a 'Jordi's view: <topic>' entry (Log/2026-11-15.md#^e-d3cace, his words and an evidence ref per line) the same question took 1 call, 37 s, 35k tokens. For your Delivery Manager to weigh, your call how: (1) a view page kind: store_memory with a 'view of <topic>' hint makes or updates its own page, and search_memory ranks it first for that topic with its mined date, so agents read only notes captured after it. (2) search_memory entries: a query with an apostrophe word ("Jordi's view weather house") returns no entries while "view weather house" does. (3) ask_brain answered our worker with an error asking to 'repeat the supported source selection' instead of an answer (2026-11-15 about 08:51Z, run_6253da31). Our side ships agent_team scripts/his_view.py and one worker-brief line that look for the view first.
