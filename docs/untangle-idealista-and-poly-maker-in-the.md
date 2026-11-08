# EPIC-19: Untangle Idealista and Poly-Maker in the memory

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/untangle-idealista-and-poly-maker-in-the.md
Spine ID: untangle-idealista-and-poly-maker-in-the-memory
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Idealista and Poly-Maker share one node, so Idealista questions return Poly-Maker results; split them into separate memories, fix their links, prove with before/after retrieval.

Goal sentence: Idealista and Poly-Maker are two separate memories again, and questions about one find only it.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a memory that knots two subjects together gives wrong answers; untangling it is the first memory-desk task.

## Done means

- [ ] E19-1 The tree no longer has one shared node for Idealista and Poly-Maker: each has its own place, and the links that belong to each point to the right one, done through a reversible, logged change to his vault.
- [ ] E19-2 Before and after on Idealista and Poly-Maker questions: answers about one no longer return the other, and why they got knotted is explained with the fix that stops it recurring.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: U1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- Only these two subjects; general untangling is the memory desk in EPIC-14.
- Every vault change is a git commit he can revert.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Ticket worker | run_383b13fc | Untangle Idealista and Poly-Maker: find why they knotted, split the node, fix the links, before/after retrieval (E19-1, E19-2) | active | none | `wt/e19-u1` | main | none | 2026-11-08 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | epic “Untangle Idealista and Poly-Maker in the memory” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-08 16:09Z Zenod: Log/2026-11-08.md#^e-6d07aa So this graph functionality is in") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-08 | accepted | Planned by the Delivery Manager from Jordi's voice note Log/2026-11-08.md#^e-6d07aa (read in full) and the Team desk brief. | his note is the ready stamp | Log/2026-11-08.md#^e-6d07aa | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
