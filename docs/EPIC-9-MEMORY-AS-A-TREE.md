# EPIC-9: Memory as a tree: audit how Zenod structures memory, working vs long-term

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/EPIC-9-MEMORY-AS-A-TREE.md
Spine ID: memory-as-a-tree-audit-how-zenod-structures-memory-working-vs-long-term
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Zenod builds and keeps structure as well as EpicSpine does: what Jordi drops becomes part of a tree of his thoughts, where the lineage tells where each thing comes from, so no context needs repeating. Memory is geared to retrieval and discovery, not execution, and separates working memory (what is ongoing now) from long-term memory. Source: [voice note 2026-11-01](https://github.com/AlfaBlok/obsidian-brain/blob/5c9ad9fdbd26dae080dd50a1fa8a8689b76e3a36/Log/2026-11-01.md#L131).

## Serves

[EPIC-0: Zenod](EPIC-0-FOUNDATION-SPINE.md): a memory that stays tidy is easier to explain and worth paying for.

## Done means

- [x] E9-1 Audit: one page on how Zenod structures memory today (with real examples from Jordi's vault), where it gets untidy, and what EpicSpine's structure discipline would change. Evidence: [E9-1 audit](epic9/E9-1-memory-structure-audit.md) (718acaa).
- [ ] E9-2 Jordi's memory has a top-level tree (working memory: what is ongoing now; long-term: the rest) that a new memory is placed into, and he can read it at levels 0-1 and recognise his world. Progress 2026-11-01: tree live in his vault (4 working, 5 long-term roots, 96/96 pages placed); closes after E9-2b files new captures into it and Jordi recognises his world.
- [ ] E9-3 Retrieval uses the tree: a question returns the item with its lineage, tested on 10 real questions from Jordi's history.

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-01 wake run_85ebce2b: E9-A1 approved; dispatched E9-2a (run_6401cf9d) and E9-3a (run_285d73f4); before: 2026-11-01 wake run_a917c19e: E9-1 audit row M1 readied on Jordi's note and dispatched; before: scaffolded with spine_new.py on 2026-11-01
Result: E9-1 audit done 2026-11-01 ([page](epic9/E9-1-memory-structure-audit.md)): Zenod keeps no tree, parent or working/long-term split; proposed level-0/1 tree, 7 filing rules, 6 build rows (draft)
Evidence: [E9-1 audit](epic9/E9-1-memory-structure-audit.md) 718acaa
Waiting on: nobody (E9-A3 answered: Memory tab in EPIC-9)
Approved work: E9-1 audit (Jordi's note 2026-11-01)
Next action: on E9-A1 dispatch E9-2a and E9-3a in parallel, then E9-2b, E9-2d, E9-3b; E9-2c as a reviewed proposal
Source revision: uncommitted scaffold
Verified at: 2026-11-01

## Waiting on

- [answered E9-A3 2026-11-01 @Jordi · done 2026-11-01 E9-2e ready] Add a Memory tab to the Zenod console that shows your tree and grows by itself? — context: you asked whether a tab like agent_team's epic tree, with self-building branches, is out of scope; it is in scope: E9-2's Done means is that you read your memory at levels 0–1 and recognise your world, and the self-building part is E9-2b (the librarian files every capture under a parent, so branches grow on their own) — impact: yes adds one row (E9-2e) built on the tree schema already merged; every user sees their own tree, not just you — risk: low, read-only view of the user's own vault; rollback: hide the tab — recommend: yes, start it once E9-2b lands, levels 0–1 with expand, page counts and latest capture per node, matching agent_team's tree look — why Jordi: it adds product scope to this epic — options: (a) yes, in EPIC-9 (recommended), (b) later, as its own epic, (c) no — answer: (a) yes, in EPIC-9 (recommended), (b) later, as its own epic, (c) no
- [answered E9-A2 2026-11-01 @Jordi · done 2026-11-01 vault 8ef01c6] Apply the clean-up to your vault, turning it into the tree? — context: this is the reviewed proposal E9-A1 promised; on a copy of your vault it places all 96 pages under a parent, merges 7 duplicates, clears the 192 Inbox stubs and receipts (127 become one dated line on the right topic, 65 go to Archive), moves 6 pages, archives 11 superseded drafts, deletes nothing and leaves the Log untouched; about a 5-minute read: [review page](http://vps3.taild81fbb.ts.net:54189/E9-2c-migration/review.html) — impact: you get a vault you can read at levels 0–1 (Hair transplant finally gets its 3 captures, House decision gets its pages) and it unblocks E9-3b, answers that cite where things come from — risk: medium-low; glance at the 7 merges and the 11 archived email drafts; one merge keeps the smaller 'Zenod Workflow Learnings' facts only in its archived copy; rollback: revert the single commit (on the copy it restored the vault exactly) — recommend: yes; on go we re-run the plan on today's vault, rehearse, apply as one commit, then lint Zenod's production copy — why Jordi: your private vault and your world to recognise; E9-A1 reserved this step for your OK — details: [REVIEW](epic9/E9-2c-migration/REVIEW.md) — answer: yes, ok, do it such that raw data stays safe please. Also, in the zenod ux, we should have a tab that helps you visualize your memory repo tree, similar to what we do in agent_team ux where we have a tree of epics - for the memory can we have these branches "self-build" - is this out of scope for what we're dealing with here? we can discuss
- [answered E9-A1 2026-11-01 @Jordi · done 2026-11-01 rows stamped ready] Build the memory tree as proposed in the audit? (ready E9-2a, E9-2b, E9-2d, E9-3a, E9-3b; E9-2c, the clean-up of your existing vault, comes back to you as a reviewed proposal before anything moves) — context: the E9-1 audit is done: Zenod files every capture into the daily Log but keeps no tree, no parent and no ongoing-vs-long-term split; 79% of your non-Log notes have nothing linking to them and 146 Inbox stubs were never resolved — impact: yes starts the build now; waiting leaves new captures landing untidily — risk: low; the build changes how new captures are filed and what answers cite, nothing in your vault is moved or deleted until you OK E9-2c; rollback: revert the librarian change — recommend: yes, with the audit's three defaults (working roots = Epic Social, Zenod, Hair transplant, House decision, then proposed from the last 30 days; agent ops reports become one dated rollup line per project; the clean-up is one reviewed proposal that never deletes) — why Jordi: only you ready rows, and the tree is your world to recognise — details: [E9-1 audit](epic9/E9-1-memory-structure-audit.md), [tree picture](http://vps3.taild81fbb.ts.net:54189/E9-1-memory-tree.html) — answer: APPROVED

## Non-Goals

Turning memory into a task tracker (that is agent_team's job).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Research worker | worker run_fb4e5e13 | E9-1 audit: how Zenod structures Jordi's memory today (real vault examples), where it gets untidy, what EpicSpine's discipline would change, plus a proposed level-0/1 tree (working vs long-term) | done | none | - | main | [E9-1 audit](epic9/E9-1-memory-structure-audit.md) 718acaa + [tree page](epic9/E9-1-memory-tree.html): vault is AlfaBlok/obsidian-brain, 413 notes, 79% unlinked, 146 unresolved Inbox stubs; no tree/parent/working split; proposed level-0/1 tree + 7 filing rules | 2026-11-01 | Jordi reads it (E9-A1) |
| E9-2a | Ticket worker | worker run_6401cf9d | Tree file and node schema: `Tree.md` (levels 0/1, one line per node) + page frontmatter `parent:`, `memory: working\|long-term` | done | M1 | [#1453](https://github.com/zenod-ai/zenod/pull/1453) | main | [E9-2a evidence](evidence/epic9-e9-2a-2026-11-01.md), [tree proposal](epic9/E9-2a-tree-proposal/README.md): schema module `packages/core/src/vault/tree.ts` (parent, memory, Tree.md), `zenod tree lint|seed|lineage`, 11 tests; Jordi's vault read-only: 104 pages to place, 0 with a parent | 2026-11-01 | prod roll of c3456c7 pending at record time |
| E9-2b | Ticket worker | worker run_0681e279 | Librarian places every capture as a leaf under a parent, writes `- filed:` back on the Log entry | active | E9-2a | - | main | audit §5 rules 2–6 | 2026-11-01 | replay of 20 real-shaped captures: 0 receipt-only, 100% filed + parent |
| E9-2c | Ticket worker | worker run_6df029c0 | One-time reviewed migration of Jordi's vault into the tree (moves/merges, Inbox re-filed or archived, never deletes, Log untouched) | done | E9-A2 approved (raw data must stay safe) | [#1457](https://github.com/zenod-ai/zenod/pull/1457) | main | [apply evidence](evidence/epic9-e9-2c-apply-2026-11-01.md): vault main 8ef01c6 on tagged pre-migration 0eaac45; full backup bundle on VPS1 verified (root 0600); tree lint 0 errors, 96/96 rooted; 0 deletes, Log and attachments untouched; prod returns lineage for a moved page | 2026-11-01 | undo: git revert 8ef01c6 |
| E9-2d | Ticket worker | unassigned | Weekly sweep: stale working roots → offer closure, pending receipts → re-file, duplicate titles → merge proposal | ready | E9-2b | - | main | audit §4 | 2026-11-01 | one prod sweep report, tree lint-clean |
| E9-2e | Ticket worker | unassigned | Memory tab in the Zenod console: the user's tree (levels 0–1, expandable), each node with its page count and latest capture, branches growing on their own as the librarian files (E9-2b) | ready | E9-2b (in flight) | - | main | Jordi 2026-11-01 (E9-A2 answer) | 2026-11-01 | start when E9-2b lands (E9-A3 (a), under L-37) |
| E9-3a | Ticket worker | worker run_285d73f4 | Retrieval returns lineage: `search_memory`/`get_memory` hits carry node path + evidence anchor; a node returns parent + children | done | E9-2a schema (audit §5; runs alongside) | [#1456](https://github.com/zenod-ai/zenod/pull/1456) | main | [E9-3a evidence](evidence/epic9-e9-3a-2026-11-01.md): search_memory/get_memory return placement, lineage path and Log evidence refs; unplaced → empty lineage, ranking unchanged; tests on 5 hits + node parent/children; live bfc6e9b, Jordi's tenant returns placed paths | 2026-11-01 | Log entries show their filed place once E9-2b lands |
| E9-3b | Ticket worker | unassigned | `ask_brain` briefs from the tree and cites the path; 10 real questions from Jordi's history (E9-3) | ready | E9-3a, E9-2c (both done) | - | main | audit §5 | 2026-11-01 | 10 real questions answered with the right lineage |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-01 | accepted | Created by Team desk from Jordi's 2026-11-01 voice note, placed under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-01 | accepted | Jordi approved E9-A1: build the tree with the audit's three defaults; E9-2a, E9-2b, E9-2d, E9-3a, E9-3b ready; E9-2c stays a reviewed proposal | rows ready | 8d17211 | — |
| 2026-11-01 | accepted | Jordi answered E9-A3 via the console (8edcef0); the answer text is the whole options list "(a) yes, in EPIC-9 (recommended), (b) later, as its own epic, (c) no", read as (a), the recommended one, which matches his E9-A2 words "we should have a tab that helps you visualize your memory repo tree"; the Delivery Manager readies E9-2e under L-37 (start once E9-2b lands) | Memory tab is in EPIC-9 scope | 8edcef0 | if Jordi meant (b) or (c): set E9-2e back to draft |
| 2026-11-01 | accepted | Jordi E9-A2: "yes, do it such that raw data stays safe" → E9-2c applied with a full vault backup first, branch + fast-forward, Log and attachments untouched, never delete | E9-2c apply ready | 773c103 | — |
| 2026-11-01 | accepted | Delivery Manager reads E9-A1 ("E9-2c comes back to you as a reviewed proposal before anything moves") as approval to build that proposal: E9-2c ready for the proposal only; applying it waits on Jordi's explicit OK | proposal can be prepared now | 8d17211 | if Jordi wants no proposal yet |
| 2026-11-01 | accepted | Jordi's note via Team desk: go on EPIC-9, start with the E9-1 audit, deliver a first finished version before asking | ledger row M1 ready | console note run_a917c19e | — |
| 2026-11-01 | accepted | stamped ready by Jordi 2026-11-01 (desk chat: "Okay man, just like I said in the voice note, mark us ready all of this and the ones that are ready to go and go.") | Jordi released it for delivery by asking the Team desk: the next standing wake may start it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
