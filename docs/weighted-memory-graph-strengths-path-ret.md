# EPIC-18: Weighted memory graph: strengths, path retrieval, on the landing

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/weighted-memory-graph-strengths-path-ret.md
Spine ID: weighted-memory-graph-strengths-path-retrieval-on-the-landing
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Each memory links to others with a strength; edges in a fast DB (SQLite/DuckDB), node ids in the markdown; retrieve a cloud by multiplied path strength above a threshold (e.g. 0.9x0.95 > 0.8); show the idea on the landing page.

Goal sentence: Each memory links to others with a strength, and retrieval follows the strong paths.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): better, cheaper answers come from following strong links in your memory instead of guessing, and the idea makes the landing page clear.

## Done means

- [ ] E18-1 Each memory link has a strength (0 to 100%), stored in a fast database (SQLite or DuckDB) with node ids in the Markdown; built from what exists today (S2 graph, filing receipts, wikilinks) and kept up to date on every filing.
- [ ] E18-2 Retrieval follows paths whose multiplied strength stays above a threshold (e.g. 0.9 × 0.95 = 0.855 > 0.8 is included), measured on his real questions (~/zenod-eval) against today's retrieval: better answers, fewer tokens.
- [ ] E18-3 zenod.dev explains the idea conceptually: a librarian indexing your memory, one thought as a constellation of links of different weights.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: W1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- His vault stays plain Markdown he owns; the database is an index that can be rebuilt from it.
- WhatsApp unchanged (root L-6).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | Ticket worker | run_0bb3512b-9c41-4f3c-8125-8675523389ff — claimed 2026-11-08T16:17Z, lease until 2026-11-08T18:17Z | Audit what exists, then weighted edges in a fast DB with node ids, and path retrieval with a multiplied-strength threshold, measured on real questions (E18-1, E18-2) | active | none | `wt/e18-w1` | main | none | 2026-11-08 | dispatch |
| W2 | Ticket worker | unassigned | The constellation idea on zenod.dev (E18-3) | draft | W1 | - | main | - | 2026-11-08 | after W1 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Weighted memory graph: strengths, path retrieval, on the landing” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 16:09Z Zenod: Log/2026-11-08.md#^e-6d07aa So this graph functionality is in") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager from Jordi's voice note Log/2026-11-08.md#^e-6d07aa (read in full) and the Team desk brief. | his note is the ready stamp | Log/2026-11-08.md#^e-6d07aa | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
