# E9-2c: your vault, tidied into the tree (proposal; nothing has moved)

Parent spine: [EPIC-9 Memory as a tree](../../EPIC-9-MEMORY-AS-A-TREE.md) · row E9-2c · picture: [review.html](review.html)
Built against `AlfaBlok/obsidian-brain` @ `617ad03` (2026-11-01 22:31Z), on a throwaway local copy. Your vault is untouched.

**In one line:** every page gets a parent, so the vault becomes the tree below. Pages are moved or merged, never deleted. Anything unsure goes to `Archive/`. The Log is not touched. The whole change is one commit, and reverting that commit undoes all of it.

## The tree as it would look (levels 0 and 1, real counts)

Pages = existing pages hung under the node. Captures = Inbox captures Zenod never filed, now listed on the node as one dated line each, linking to their Log entry.

| Level 0 | Node (level 1) | Pages | Captures | What's under it |
|---|---|---:|---:|---|
| **Working memory** | Launching Epic Social | 2 | 54 | EpicSpine, the daily-post council; most captures are Agent Team ops reports |
| | Launching Zenod | 34 | 18 | `Zenod` (30 pages below it), Positioning & Story |
| | Hair transplant | 0 | 3 | your 3 October hair-transplant captures; it finally has a home |
| | House decision | 7 | 10 | Housing, Maresme vs Cerdanya, the property spine, buy-location reports |
| **Long-term memory** | Ventures and work | 26 | 8 | Idealista data venture (14), Poly-Maker trading (6), Altamira2050, Alpha9 tax, Nectary |
| | Ideas and knowledge | 8 | 14 | markets research, power laws, The Pen, explainer-script skills |
| | Infrastructure and runbooks | 6 | 11 | VPS runbooks, GitHub auth, browser automation, email MCP |
| | Life admin | 3 | 2 | hardware, insurance, travel |
| | People and family | 1 | 1 | private; the page stays where it is |

**Before → after** (`zenod tree lint`):

| | Before | After |
|---|---:|---:|
| Pages with a parent | 0 of 104 | 96 of 96, 0 errors |
| Duplicate-title groups | 6 | 0 |
| Machine files in Inbox | 192 | 0 |
| `zenod lint` errors | 78 | 61 |

There are fewer pages after because 18 are merged or archived. The 61 remaining lint errors were all there already. Five of them only show up now: those pages had no frontmatter, so lint had never read them.

## The 10 riskiest changes (please glance at these)

1. **Merge the two "Zenod Workflow Learnings" pages.** The 9 KB copy in `Projects/Zenod/` is appended to the 34 KB `Projects/Zenod Workflow Learnings`. Its `memoryFacts` stay only on the archived copy.
2. **Merge the two "Positioning & Story" pages.** The Projects copy goes into `Areas/Positioning & Story` (the one with 5 links), under Launching Zenod.
3. **Move 6 house pages** out of `Projects/Idealista Data Relationship/` into `Projects/House decision/`: Sub-Strategies, the property spine, Maresme vs Cerdanya, the buy-location report, the Mansions digest and the voice-note briefing. Links to them in other pages are rewritten (5 links across the whole migration). Zenod still writes to Sub-Strategies, so after "go" it has to pick up the new path.
4. **Archive 11 email drafts.** `email_comercial` v1–v7 and v2_1–v2_3 go to Archive, plus `email_director_general`. v8 and `email_director_v2` stay, and link to the archived drafts. If an older draft is the one you actually sent, it is in `Archive/`.
5. **`Areas/Housing` hangs under House decision (working memory), not Life admin.** Its content is your live buying strategy.
6. **Merge the two "Hosted Zenod M3 multi-tenant plan" pages.** The names are almost the same, but the text differs. The 4 KB one is appended to the 10 KB one.
7. **Merge the two "Hardware & Devices" pages.** The Notes copy is appended to the Areas copy.
8. **127 Inbox captures are re-filed by keyword.** 54 land on Launching Epic Social, mostly agent_team console reports, as one dated line each. A wrong line costs nothing: it only links to the Log entry.
9. **13 pages that had no frontmatter get a header.** The title comes from the page's first heading and the dates from git; the page body is unchanged. Lint then reads these pages for the first time and finds 4 orphan pages and 1 broken citation.
10. **Some pages hang outside their folder.** For example, `Zenot Council` sits under Epic Social and the Gmail/email MCP runbook under Infrastructure, while both stay in `Projects/Zenod/`. Paths don't change; only the parent does. The X (Twitter) runbook is the one low-confidence call: it is under Zenod, but could go under Epic Social.

## What goes to `Archive/` (moved, never deleted)

- **192 Inbox machine files → `Archive/Inbox/`.**
  - 127 of them are re-filed first, as lines on their node.
  - The other 65 are archived without re-filing:
    - 32 test or canary captures ("the ring is alive", ZNMT markers, code phrases);
    - 25 that no node clearly matches;
    - 4 tied between two nodes;
    - 4 receipts for captures that were already filed.
- **18 pages → `Archive/<old path>`:**
  - 11 superseded email drafts;
  - the 7 originals of merged duplicates, each marked `merged-into:` its target.
- **4 other files:**
  - the 3 July `Council/` launch docs;
  - `index_old_archive.md`.
- **Left alone:**
  - your own Inbox notes (Archetype targets, Test 21, the Notion imports, …);
  - `Index.md` and `index.md`. They collide on a Mac, so you choose which one to keep;
  - `docs/`, `_templates/`, `AGENTS.md`, `Log/`, `_attachments/`.

## What "go" does, exactly

1. **Re-check against today's vault.** On a fresh copy of `AlfaBlok/obsidian-brain` `main`, re-run the plan. Zenod adds captures every few minutes. If a new page has appeared since `617ad03`, the plan stops, and I place that page before going further.
2. **Rehearse.** Run a dry run, then `zenod tree lint`, which must show 0 errors.
3. **Apply.** The migration is applied as **one commit** on branch `e9-2c-tree-migration` and fast-forwarded to `main`. It adds `Tree.md` plus 10 node pages, edits 81 files and moves 220. Nothing is deleted, and `Log/` is untouched.
4. **Check after.** Zenod's production copy pulls the change. I then confirm `zenod tree lint` is clean on it and that the next capture files normally.

**Undo:** `git revert <that commit>`. This was tested on the copy, and it restores the vault byte for byte. If Zenod has meanwhile written to a moved page, git carries that edit across with the revert.

Files: [plan.json](plan.json) (every page and Inbox file with its action, confidence and one-line reason; the private page is named only by a hash) · [placements.json](placements.json) (the hand-made page choices) · script [`scripts/e9-2c-vault-tree-migration.mjs`](../../../scripts/e9-2c-vault-tree-migration.mjs) · evidence [epic9-e9-2c-2026-11-01](../../evidence/epic9-e9-2c-2026-11-01.md).
