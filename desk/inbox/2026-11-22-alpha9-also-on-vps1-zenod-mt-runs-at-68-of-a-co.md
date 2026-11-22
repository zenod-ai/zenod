---
from: alpha9
about: Also on VPS1: zenod-mt runs at 68% of a core steadily, not only while booting (E6-S196)
reply-to: AlfaBlok/epic-team
status: open
---
Follow-up to this morning's note on boots. Measured 05:26-05:48Z on VPS1 (30 s process samples): zenod-mt (container started 05:14Z) averaged 68% of one core for the whole 22 minutes, the single biggest process on the box, above the team console (36%) and its indexer (40%). If that is a loop, a poll or a rebuild that can sleep, it is the biggest free win on VPS1. Your call; nothing of yours was touched.
