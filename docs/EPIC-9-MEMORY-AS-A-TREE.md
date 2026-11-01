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
- [ ] E9-2 Jordi's memory has a top-level tree (working memory: what is ongoing now; long-term: the rest) that a new memory is placed into, and he can read it at levels 0-1 and recognise his world.
- [ ] E9-3 Retrieval uses the tree: a question returns the item with its lineage, tested on 10 real questions from Jordi's history.

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-01 wake run_a917c19e: E9-1 audit row M1 readied on Jordi's note and dispatched; before: scaffolded with spine_new.py on 2026-11-01
Result: E9-1 audit done 2026-11-01 ([page](epic9/E9-1-memory-structure-audit.md)): Zenod keeps no tree, parent or working/long-term split; proposed level-0/1 tree, 7 filing rules, 6 build rows (draft)
Evidence: [E9-1 audit](epic9/E9-1-memory-structure-audit.md) 718acaa
Waiting on: nobody (E9-A1 approved 2026-11-01; E9-2c comes back to Jordi as a reviewed proposal)
Approved work: E9-1 audit (Jordi's note 2026-11-01)
Next action: on E9-A1 dispatch E9-2a and E9-3a in parallel, then E9-2b, E9-2d, E9-3b; E9-2c as a reviewed proposal
Source revision: uncommitted scaffold
Verified at: 2026-11-01

## Waiting on

- [answered E9-A1 2026-11-01 @Jordi · done 2026-11-01 rows stamped ready] Build the memory tree as proposed in the audit? (ready E9-2a, E9-2b, E9-2d, E9-3a, E9-3b; E9-2c, the clean-up of your existing vault, comes back to you as a reviewed proposal before anything moves) — context: the E9-1 audit is done: Zenod files every capture into the daily Log but keeps no tree, no parent and no ongoing-vs-long-term split; 79% of your non-Log notes have nothing linking to them and 146 Inbox stubs were never resolved — impact: yes starts the build now; waiting leaves new captures landing untidily — risk: low; the build changes how new captures are filed and what answers cite, nothing in your vault is moved or deleted until you OK E9-2c; rollback: revert the librarian change — recommend: yes, with the audit's three defaults (working roots = Epic Social, Zenod, Hair transplant, House decision, then proposed from the last 30 days; agent ops reports become one dated rollup line per project; the clean-up is one reviewed proposal that never deletes) — why Jordi: only you ready rows, and the tree is your world to recognise — details: [E9-1 audit](epic9/E9-1-memory-structure-audit.md), [tree picture](http://vps3.taild81fbb.ts.net:54189/E9-1-memory-tree.html) — answer: APPROVED

## Non-Goals

Turning memory into a task tracker (that is agent_team's job).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Research worker | worker run_fb4e5e13 | E9-1 audit: how Zenod structures Jordi's memory today (real vault examples), where it gets untidy, what EpicSpine's discipline would change, plus a proposed level-0/1 tree (working vs long-term) | done | none | - | main | [E9-1 audit](epic9/E9-1-memory-structure-audit.md) 718acaa + [tree page](epic9/E9-1-memory-tree.html): vault is AlfaBlok/obsidian-brain, 413 notes, 79% unlinked, 146 unresolved Inbox stubs; no tree/parent/working split; proposed level-0/1 tree + 7 filing rules | 2026-11-01 | Jordi reads it (E9-A1) |
| E9-2a | Ticket worker | unassigned | Tree file and node schema: `Tree.md` (levels 0/1, one line per node) + page frontmatter `parent:`, `memory: working\|long-term` | ready | M1 | - | main | audit §5 | 2026-11-01 | lint passes on a fixture vault; every meaning page has a resolvable parent |
| E9-2b | Ticket worker | unassigned | Librarian places every capture as a leaf under a parent, writes `- filed:` back on the Log entry | ready | E9-2a | - | main | audit §5 rules 2–6 | 2026-11-01 | replay of 20 real-shaped captures: 0 receipt-only, 100% filed + parent |
| E9-2c | Ticket worker | unassigned | One-time reviewed migration of Jordi's vault into the tree (moves/merges, Inbox re-filed or archived, never deletes, Log untouched) | draft | E9-2a; Jordi OK on the tree | - | main | audit §6 Q3 | 2026-11-01 | Jordi recognises his world at levels 0–1 (E9-2) |
| E9-2d | Ticket worker | unassigned | Weekly sweep: stale working roots → offer closure, pending receipts → re-file, duplicate titles → merge proposal | ready | E9-2b | - | main | audit §4 | 2026-11-01 | one prod sweep report, tree lint-clean |
| E9-3a | Ticket worker | unassigned | Retrieval returns lineage: `search_memory`/`get_memory` hits carry node path + evidence anchor; a node returns parent + children | ready | E9-2a schema (audit §5; runs alongside) | - | main | audit §5 | 2026-11-01 | schema updated; test asserts the path on 5 hits |
| E9-3b | Ticket worker | unassigned | `ask_brain` briefs from the tree and cites the path; 10 real questions from Jordi's history (E9-3) | ready | E9-3a, E9-2c | - | main | audit §5 | 2026-11-01 | 10 real questions answered with the right lineage |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-01 | accepted | Created by Team desk from Jordi's 2026-11-01 voice note, placed under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-01 | accepted | Jordi approved E9-A1: build the tree with the audit's three defaults; E9-2a, E9-2b, E9-2d, E9-3a, E9-3b ready; E9-2c stays a reviewed proposal | rows ready | 8d17211 | — |
| 2026-11-01 | accepted | Jordi's note via Team desk: go on EPIC-9, start with the E9-1 audit, deliver a first finished version before asking | ledger row M1 ready | console note run_a917c19e | — |
| 2026-11-01 | accepted | stamped ready by Jordi 2026-11-01 (desk chat: "Okay man, just like I said in the voice note, mark us ready all of this and the ones that are ready to go and go.") | Jordi released it for delivery by asking the Team desk: the next standing wake may start it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
