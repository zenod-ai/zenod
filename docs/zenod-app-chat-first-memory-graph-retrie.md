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
Result: P1 done (fed E12-A1): vision deck with mockups at http://vps3.taild81fbb.ts.net:8912/ (9902d06); rows re-ordered per its findings
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: P1 round 2 worker run_9a70d469
Approved work: none
Next action: P1 round 2 (run_9a70d469) reframes the deck per E12-A1 feedback ; then E12-A2
Source revision: uncommitted scaffold
Verified at: 2026-11-07

## Non-Goals

- No change to WhatsApp replies or chat behaviour (root L-6); the chat in E12-1 is in the cloud app only, which Jordi asked for in his own words (voice note 2026-11-07 22:34Z).
- No agent_team or EpicSpine machinery inside Zenod (root L-7): the vision deck and next-step proposals are team documents and asks, not product features.
- No new storage backend: the vault stays plain Markdown in the user's GitHub or Drive.

## Waiting on

- [feedback E12-A1 2026-11-07 @Jordi] Is this the plan for the Zenod app you described? Open http://vps3.taild81fbb.ts.net:8912/ — ten slides: the vision, today versus proposed, mockups of the chat-first landing, your memory as a graph and five memories lighting up with a percentage and a link, daily digestion, the build order and the next step — context: your voice note of 7 Nov asked for a chat-first app, a memory graph, retrieval you can see and digestion that runs by itself, planned first as a deck — impact: yes starts the build in this order: ranked retrieval with percentages over MCP first (about a day, fast today without new search tech), then the chat-first landing, the graph view, lighting up in the graph, nightly digestion, and the demo graph on zenod.dev; until then nothing is built — risk: low, each step ships on its own and can be reverted — recommend: approve; one thing to settle with it: the cloud chat answers from your memory but saves nothing unless you tap keep, so chatting never fills your library with noise — why Jordi: it sets what the product becomes — unblocks: S1–S5 — details: [plan](evidence/epic12-p1-2026-11-07.md) — feedback: Yes but you make it sound like a brand new product, but it exists and it's in production, is that clear? Love the design language you used, we should make landing similar. Zenod is the ai librarian of your memory. It ingests and digests so you can access your memory from any other sgent, and build from it. Are we in line?

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Ticket worker | run_9a70d469 (round 2; round 1 run_1613c53f) | Plan + vision deck with mockups at one URL: chat-first landing, memory graph view, lit-up retrieval with scores, self-digestion, the vision and the proposed order of steps (E12-1..5) | active (feedback E12-A1 by Jordi 2026-11-07, round 2: Yes but you make it sound like a brand new product, but it exists and it's in production, is that clear? Love the design language you used, we should make landing similar. Zenod is the ai librarian of your memory. It ingests and digests so you can access your memory from any other sgent, and build…) | none | main (docs only) | main | [epic12-p1-2026-11-07](evidence/epic12-p1-2026-11-07.md), deck source [docs/epic12/](epic12/README.md) | 2026-11-07 | deck ready at http://vps3.taild81fbb.ts.net:8912/; waits on E12-A1 |
| S3a | Ticket worker | unassigned | E12-3 part 1: ranked retrieval returns the top 5 with a match percentage and a link, also over MCP (BM25 already p95 46 ms, no vectors needed), ~1 day | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S1 | Ticket worker | unassigned | E12-1: chat-first cloud landing for hosted users that answers from your memory with links (ChatTab exists, /api/chat not yet in the customer layer), ~2 days | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S2 | Ticket worker | unassigned | E12-2: memory graph view from stored wikilinks, navigable, ~2–3 days | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S3b | Ticket worker | unassigned | E12-3 part 2: a query lights up its top 5 in the graph view, ~1 day, after S2 | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S4 | Ticket worker | unassigned | E12-4: nightly digestion sweep plus "last run" in the app (with EPIC-9), ~1 day | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |
| S5 | Delivery Manager | unassigned | E12-2 and E12-5: demo graph on zenod.dev, vision deck kept current, next step proposed after each delivery | draft | P1; E12-A1 | - | main | - | 2026-11-07 | after E12-A1 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-07 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-07 | accepted | epic “Zenod app: chat first, memory graph, retrieval that lights up” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-07 22:34Z Zenod: Log/2026-11-07.md#^e-7e3f61 I am thinking that Zenot should h") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-07 | accepted | Delivery Manager planned the epic from Jordi's voice note (Log/2026-11-07.md#^e-7e3f61) and Team desk brief: Done means E12-1..5, P1 ready (plan + deck with mockups, his first step), S1–S5 draft until he approves the plan (E12-A1) | one approve gate before building | this commit | if Jordi changes the plan |
| 2026-11-07 | revised | E12-A1 was feedback, not approval (c0e60ce): Jordi said the deck makes Zenod sound new though it is live in production, loved the design language (landing should match), and gave the positioning: Zenod is the AI librarian of your memory; it ingests and digests so you can access it from any agent and build from it. Round 2 of P1 (run_9a70d469) reframes the deck; it comes back as E12-A2. | build stays gated on his approval | c0e60ce | when E12-A2 is answered |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
