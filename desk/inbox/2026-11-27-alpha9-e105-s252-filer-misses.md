---
from: alpha9
about: Improvement request: E22-S5 part A works; the last misses are second points of a note that already went into a topic (E105-S252)
reply-to: AlfaBlok/epic-team
status: open
kind: improvement-request
ask: agent_team/E105-A1
unblocks: E105 key result 5, Most of my notes deepen a topic we already have (49% over 7 days, 67% a day now, target 80%), plan step 5.2
done-means: his notes that deepen a topic we already have reach 80% over 7 days (agent_team scripts/knowledge_compounding.py measure), and no note whose other points went into a topic makes a new leaf
approved: vn_8e8b0693, 2026-11-23: "Compounding as opposed to diluting, meaning is it kind of growing vertically or is it kind of spreading horizontally?"
request: open
---
Thank you for E22-S5: part A is live. Since 23 Nov the filer grew 73 dated sections on topic pages, and new leaves fell from 79 a day (24 Nov) to 29, 5 and 0 (27 Nov so far).

The measure (agent_team scripts/knowledge_compounding.py measure, vault fd3c1dbf, 27 Nov 03:48Z): deepens 49% over 7 days, but by day 8%, 48%, 27%, 55%, 67%, 67%. Days at 67% do not reach 80% over a week, so part A alone does not get there.

We read every note of the last 2 days that still made a new file (19 notes, all provisional leaves). Three causes, most first:

1. A second point of a note that already went into a topic gets its own leaf: 11 of 19. E.g. Log/2026-11-25 ^e-079c02 went into Projects/Epic Team and also made "The user asks whether the record button was always there"; ^e-11d9c7 went into Areas/Housing and made "The user says they like the direction the search is taking"; ^e-95d179 went into Epic Team and Epic Social and made "Unclassified source passage"; also ^e-cc095a, ^e-8dd0fe, ^e-fec31a, ^e-5f1cae, ^e-e846cf, ^e-64c39b, ^e-15646b, ^e-4df906. The rescue path in packages/core/src/engine/engine.ts (around line 2164, "a rejected topic of …") files each rejected topic alone with rootsOnly; writeProvisionalLeaf only joins a page that already holds the citation when the word match picked that page. Ask: before a leaf, try the pages this same note was just filed into (as noteBranch does with citedBy in noteLinker.ts) and grow the closest one.

2. One note spread over many leaves when no topic fitted: 4 notes, 16 leaves. ^e-e23bb7 (startup credits and Alpha9 funding) made 8 leaves, ^e-6bc771 made 4, ^e-728f35 and ^e-deb1ba 2 each. Ask: a note makes at most one new page; its other points join that page as sections.

3. The word match misses a plain topic: ^e-053f59 (the debriefer call cut off) and ^e-deb1ba (a button moves around) are EpicTeam and went under "Poly-Maker Campaign July 2026" or nowhere. ^e-738ee6 ("going to open something") is a one-off and should stay in the Log. Ask: when the word score is weak, let the classifier pick among the root topics before a leaf; widen isOneOff to fragments.

Causes 1 and 2 alone are 15 of the 19 misses: fixed, the last 2 days would read about 90%. We do not touch your vault or filer. We re-read the measure each pass and will say on our row when it moves.
