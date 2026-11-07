# EPIC-12: Zenod app: chat first, memory graph, retrieval that lights up

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-app-chat-first-memory-graph-retrie.md
Spine ID: zenod-app-chat-first-memory-graph-retrieval-that-lights-up
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Cloud Zenod opens on a chat with your memory (as on WhatsApp); a memory view shows the graph to navigate; a query lights up the top memories with scores and links (fast, MCP too); daily self-digestion; a vision deck that proposes next steps.

Goal sentence: Cloud Zenod opens on a chat with your memory and shows it as a graph you can search.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a paying user needs to see and use their memory, not only send to it: a chat-first app with a visible memory graph and retrieval is what makes Zenod worth €9 and makes the landing page clear.

## Done means

- [ ] E12-1 Signing in to cloud Zenod opens on a chat box that answers from your memory with links to the memories it used; settings move behind it.
- [ ] E12-2 A memory view shows your memory as a graph: each memory a node, its links as edges, navigable (open a node, follow its links); the same graph, with demo data, explains Zenod on zenod.dev.
- [ ] E12-3 A query lights up the top 5 memories in the graph, each with a match percentage and a link, in under 1 s for a typical vault; the same ranked retrieval is an MCP tool.
- [ ] E12-4 Digestion runs by itself on every new memory or at least daily, with its last run visible in the app (builds on EPIC-9).
- [ ] E12-5 A vision deck for Zenod lives at one URL and is kept current: each delivered step updates it and comes with a proposed next step for Jordi to accept.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-07 planned from Jordi's voice note (Log/2026-11-07.md#^e-7e3f61): Done means E12-1..5, rows P1 and S1–S5
Result: P1 dispatched
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: P1 plans the epic and shows it as a deck with mockups at one URL, then E12-A1 (approve) under ## Waiting on
Source revision: uncommitted scaffold
Verified at: 2026-11-07

## Non-Goals

- No change to WhatsApp replies or chat behaviour (root L-6); the chat in E12-1 is in the cloud app only, which Jordi asked for in his own words (voice note 2026-11-07 22:34Z).
- No agent_team or EpicSpine machinery inside Zenod (root L-7): the vision deck and next-step proposals are team documents and asks, not product features.
- No new storage backend: the vault stays plain Markdown in the user's GitHub or Drive.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Ticket worker | run_1613c53f | Plan + vision deck with mockups at one URL: chat-first landing, memory graph view, lit-up retrieval with scores, self-digestion, the vision and the proposed order of steps (E12-1..5) | done (fed E12-A1) | none | main (docs only) | main | [epic12-p1-2026-11-07](evidence/epic12-p1-2026-11-07.md), deck source [docs/epic12/](epic12/README.md) | 2026-11-07 | deck ready at http://vps3.taild81fbb.ts.net:8912/; waits on E12-A1 |
| S1 | Ticket worker | unassigned | E12-1: chat-first cloud landing that answers from your memory with links | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S2 | Ticket worker | unassigned | E12-2: memory graph view, navigable; demo graph reused on zenod.dev | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S3 | Ticket worker | unassigned | E12-3: retrieval that lights up the top 5 with percentages and links, under 1 s, also over MCP | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S4 | Ticket worker | unassigned | E12-4: digestion on each new memory or daily, last run visible (with EPIC-9) | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S5 | Delivery Manager | unassigned | E12-5: vision deck kept current, next step proposed after each delivery | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-07 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-07 | accepted | epic “Zenod app: chat first, memory graph, retrieval that lights up” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-07 22:34Z Zenod: Log/2026-11-07.md#^e-7e3f61 I am thinking that Zenot should h") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-07 | accepted | Delivery Manager planned the epic from Jordi's voice note (Log/2026-11-07.md#^e-7e3f61) and Team desk brief: Done means E12-1..5, P1 ready (plan + deck with mockups, his first step), S1–S5 draft until he approves the plan (E12-A1) | one approve gate before building | this commit | if Jordi changes the plan |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
