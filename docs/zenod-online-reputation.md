# EPIC-28: Zenod: Build an online reputation

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-online-reputation.md
Spine ID: zenod-online-reputation
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Integration branch: main
Integration policy: main-direct

## Goal

Goal sentence: People and AI agents find Zenod and speak well of it.

Jordi's WhatsApp voice note 23 Nov 15:25Z ([Log/2026-11-24.md#^e-8b9fa2](https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-11-24.md#^e-8b9fa2)): "build an online reputation for Zenod. That's the goal. And then the key results, all these things that we're measuring". He approved it as its own objective, after Zenod: Get 5 testers, on ask E7-A45 (25 Nov: "APPROVED").

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): people who already heard good things about Zenod try it and pay; this spine is how they hear.

## Done means

- [ ] DOD-1 Zenod is listed in 10 AI tool directories where people and agents look.
- [ ] DOD-2 5 people outside the team review or recommend Zenod in public.
- [ ] DOD-3 An AI assistant asked for a memory tool names Zenod in 3 of 10 tries.

## Current State

Status: active
Last attempted: 2026-11-25 R-S1 ticket worker (run_7bc3eb8f): both baselines measured
Result: DOD-1 baseline 4 of 10 directories list Zenod (MCP Registry, Glama, AI-Powered, addrbook); DOD-3 baseline 0 of 10 assistants name Zenod (top picks Basic Memory, Obsidian, MemoryPlugin); DOD-2 not measured yet; [evidence page](http://vps3.taild81fbb.ts.net:9709/), [evidence](evidence/r-s1-2026-11-25.md)
Waiting on: nothing from Jordi; the team plans the next step per key result
Next action: Delivery Manager writes the next row per key result from R-S1's proposals
Verified at: 2026-11-25

## Waiting on

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| R-S1 | Ticket worker | run_7bc3eb8f (finished 2026-11-25) | Baselines: count the AI tool directories that list Zenod today (DOD-1) and ask 10 AI assistants for a memory tool, counting how often Zenod is named (DOD-3); one evidence page with both numbers | done (no confirm: baselines for DOD-1 and DOD-3; the next steps use them) | none | none | main | evidence http://vps3.taild81fbb.ts.net:9709/ : listed in 4 of 10 directories (MCP Registry, Glama, AI-Powered, addrbook); 0 of 10 AI assistants name Zenod (they pick Basic Memory, Obsidian, MemoryPlugin, Mem0); $0.37 on OpenRouter | 2026-11-25 | followups: start R-S2, R-S3, R-S4 (drafts below) |
| R-S2 | Ticket worker | unassigned | DOD-1: list Zenod on mcpservers.org, the Docker MCP Catalog and AIBase (Docker and AIBase are draft E10-S6), and chase the mcp.so and awesome-mcp-servers (PR #18864) queues: 9 of 10 if all land | draft | none | none | main | http://vps3.taild81fbb.ts.net:9709/ | 2026-11-25 | draft: proposed by R-S1; ready on Jordi's word |
| R-S3 | Ticket worker | unassigned | DOD-3: pages that answer 'a memory I own' and compare Zenod with Basic Memory and Mem0 (what assistants recommend today), then re-run the same 10 questions monthly with the R-S1 script | draft | none | none | main | http://vps3.taild81fbb.ts.net:9709/ | 2026-11-25 | draft: proposed by R-S1; ready on Jordi's word |
| R-S4 | Ticket worker | unassigned | DOD-2: baseline of public reviews or recommendations of Zenod by people outside the team (none known today) | draft | none | none | main | none | 2026-11-25 | draft: proposed by R-S1; ready on Jordi's word |
| R-S5 | Ticket worker | unassigned | Site says Zenod Memory (E7-S41 plan steps 1a-1d, 3a): every title and heading says Zenod Memory, pages served as real HTML, /pricing canonical fixed and in the sitemap, home description under 155 characters, one structured-data record naming our profiles; self-merged PR (deploy-gated paths) | draft | E7-S41 card (Jordi's 'Do we start this plan?') | none | main | http://vps3.taild81fbb.ts.net:9960/#plan | 2026-11-26 | draft: starts on Jordi's yes to the E7-S41 plan |
| R-S6 | Ticket worker | unassigned | Three zenod.dev pages (E7-S41 step 4a, overlaps R-S3): what Zenod Memory is, Zenod compared with Basic Memory and Mem0, and 'Zenod is not Zenodo' | draft | E7-S41 card | none | main | http://vps3.taild81fbb.ts.net:9960/#plan | 2026-11-26 | draft: starts on Jordi's yes to the E7-S41 plan |
| R-S7 | Ticket worker | unassigned | Weekly rerun of the six Google searches (zenod, zenod memory, zenod ai, zenod mcp, zenod memory app, zenod.dev) onto the E7-S41 page (step 5) | done (folded into E7-S43: zenod EPIC-7, the same weekly rerun, live on :9960#weekly) | E7-S41 card | none | main | http://vps3.taild81fbb.ts.net:9960/#plan | 2026-11-26 | none |

## Decisions

| Date | Status | Decision | Why | Evidence | Rollback |
|---|---|---|---|---|---|
| 2026-11-25 | accepted | Objective Zenod: Build an online reputation filed, after Zenod: Get 5 testers, with key results DOD-1 to DOD-3; R-S1 ready on his yes (L-37) | Jordi: "build an online reputation for Zenod. That's the goal"; answer on E7-A45: "APPROVED" | zenod docs/EPIC-7-REAL-USER-TEST.md E7-A45 | park the objective in docs/pursuits.json |

## Operating Learnings

none yet
