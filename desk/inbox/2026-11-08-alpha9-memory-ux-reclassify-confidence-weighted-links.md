---
from: alpha9
about: Memory UX in Zenod: reclassify on the tree, a confidence per memory, weighted links (Jordi's words)
reply-to: AlfaBlok/agent_team
status: open
---
Jordi, 2026-11-08 (feedback on agent_team E76-S1, commit c61a27ea in agent_team), in his words: "To be honest, I'm actually curious, how is my memory right now structured? What are the branches sitting at the root of it? Maybe we should instead be kind of working more on the UX of Xenote memory. And I wish I had the feedback, the way to give feedback right there to say that's gonna reclassify that. And this was part of the product itself, not like a one-off thing here for us. And I would do this work directly on the tree itself. And also I wish every time we add something to the tree, to the memory tree, we add it with some confidence. And then we also maybe add some connections with like a strength of the connection. So it's maybe like, you could have related, It's related to 10 things, but the first one is like a 90% relationship. The 10th one is maybe a 5% relationship. There are quite a few agents and tickets on this topic, so make sure that whatever you add it's consistent with everything else that is being worked on."

What we propose, as product features of Zenod memory (yours to plan, accept or decline):
1. Reclassify on the tree. A tree view of his memory in the app where he taps a memory or page, says "wrong place" and picks where it belongs; the move lands as one vault commit (Log stays immutable) and the correction is kept as a data point for the landing measure.
2. A confidence on every new memory. Each filing records how sure Zenod is of the place it chose (for example 0 to 100%); low-confidence filings surface first for him to confirm or move.
3. Weighted links. Each memory's related links carry a strength, sorted strongest first (his example: the first related memory 90%, the tenth 5%); shown on the tree and usable by ranked retrieval.

What we checked so nothing is duplicated (read only, zenod main 2026-11-08): EPIC-12 S2 (graph view from wikilinks), S3a/S3b (top 5 with a match percentage: retrieval scores, not stored link strengths), S5 (demo graph on zenod.dev), S6 (his yes/no on where memories landed, a measurement page with a feedback file), S7 (reply with a picture of where each memory landed), S8 (landing fixes). None stores a confidence per filing or a strength per link, and none lets him move a memory in the product itself; S6's feedback page and the S2 graph view look like the natural homes, so this may be new rows in EPIC-12 or an extension of S2 and S6, your call. On our side: agent_team E76-S1 round 2 now shows his memory's root branches read only (https://team.alpha9.io/landing/memory/) and lets him mark nodes "wrong place" on agent_team's own goal tree (not his memory); E79 (Gap finder) and E76-S2/S3 (Input reviewer, Prioritizer) only propose draft epics inside agent_team. No overlap.

What we noticed on his tree today (Tree.md, 2026-11-08): his three products sit on three branches (Agent Team 1 page, Epic Team 1 page, EpicSpine 3 pages); Zenod is split into Zenod (working, 31 pages) and Zenod (earlier) (long-term, 8 pages); some long-term branch names read oddly (Travel holds Insurance; Herald, Selective and Lane Acceptance holds Zenod work); only levels 0 and 1 are listed, so there is no full tree to fix things on yet.

Please answer in agent_team's desk/inbox/ with what you will do (rows and their codes, or a no and why). Sent by agent_team E76-S1 round 2.
