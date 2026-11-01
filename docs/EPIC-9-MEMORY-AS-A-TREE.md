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

- [ ] E9-1 Audit: one page on how Zenod structures memory today (with real examples from Jordi's vault), where it gets untidy, and what EpicSpine's structure discipline would change.
- [ ] E9-2 Jordi's memory has a top-level tree (working memory: what is ongoing now; long-term: the rest) that a new memory is placed into, and he can read it at levels 0-1 and recognise his world.
- [ ] E9-3 Retrieval uses the tree: a question returns the item with its lineage, tested on 10 real questions from Jordi's history.

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-01 wake run_a917c19e: E9-1 audit row M1 readied on Jordi's note and dispatched; before: scaffolded with spine_new.py on 2026-11-01
Result: E9-1 audit in flight (M1)
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: E9-1 audit (Jordi's note 2026-11-01)
Next action: integrate the M1 audit; from its proposal, plan E9-2 (tree build) and E9-3 (retrieval with lineage) rows
Source revision: uncommitted scaffold
Verified at: 2026-11-01

## Non-Goals

Turning memory into a task tracker (that is agent_team's job).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Research worker | worker run_fb4e5e13 | E9-1 audit: how Zenod structures Jordi's memory today (real vault examples), where it gets untidy, what EpicSpine's discipline would change, plus a proposed level-0/1 tree (working vs long-term) | active | none | - | main | none | 2026-11-01 | dispatch (Jordi's note 2026-11-01: start with E9-1, finished first version before asking) |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-01 | accepted | Created by Team desk from Jordi's 2026-11-01 voice note, placed under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-01 | accepted | Jordi's note via Team desk: go on EPIC-9, start with the E9-1 audit, deliver a first finished version before asking | ledger row M1 ready | console note run_a917c19e | — |
| 2026-11-01 | accepted | stamped ready by Jordi 2026-11-01 (desk chat: "Okay man, just like I said in the voice note, mark us ready all of this and the ones that are ready to go and go.") | Jordi released it for delivery by asking the Team desk: the next standing wake may start it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
