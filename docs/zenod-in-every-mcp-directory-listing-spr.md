# EPIC-10: Zenod in every MCP directory: listing sprint and MCP SEO

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-in-every-mcp-directory-listing-spr.md
Spine ID: zenod-in-every-mcp-directory-listing-sprint-and-mcp-seo
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Zenod is listed in Anthropic's MCP directory, Google's, and every other MCP list worth being in, and is maximally findable there (MCP SEO: names, descriptions, keywords, examples). A plan first, then small child epics, one per little promotion action.

## Serves

[EPIC-0](EPIC-0-FOUNDATION-SPINE.md): puts Zenod where people already shop for Claude and ChatGPT connectors, so a stranger can find it, connect it and become the paying user EPIC-0 is after.

## Done means

- [ ] E10-1 Zenod is live in the **Anthropic Connectors Directory** (Community or Verified) with its listing URL recorded, and every listed tool works there from a customer account.
- [ ] E10-2 `dev.zenod/memory` is published in the **official MCP Registry** (API search returns it) and Zenod is listed on at least **five more** directories (target: Smithery, Glama, mcp.so, MCP Market, Gemini CLI gallery, awesome-mcp-servers), each with a working link in the ledger.
- [ ] E10-3 Every listing uses the approved copy (name, one-liner, description, keywords, example prompts) and a public "connect Zenod" page at zenod.dev; the directory tool surface is the customer memory tools only, with descriptions that pass Anthropic's review criteria.
- [ ] E10-4 Findability measured: for "memory" Zenod appears on the first results page of the Anthropic directory and Smithery, and for "whatsapp memory" in the top 3 of every directory with full-text search; positions recorded with date.
- [ ] E10-5 The **ChatGPT directory** submission is approved, or its blocker is recorded with OpenAI's reason.

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-02 Delivery Manager wake run_1ada2ae7: planning worker P1 dispatched (Jordi readied the epic, L-37)
Result: P1 plan done 2026-11-02 ([plan](epic10/P1-mcp-directory-plan.md)): Zenod technically ready; 5 review gaps; rows R1–R8 planned
Evidence: [P1 plan](epic10/P1-mcp-directory-plan.md), [server.json](epic10/server.json)
Waiting on: Jordi, ask E10-A1 (publish to the free self-serve directories)
Approved work: none
Next action: E10-R1 (customer tool surface) and E10-R2 (listing kit) in parallel; R3/R4 publish on E10-A1; E10-A2 (Anthropic) and E10-A3 (OpenAI) are raised when R5/R6 are next
Source revision: uncommitted scaffold
Verified at: 2026-11-02

## Waiting on

- [ask E10-A1: approve @Jordi since 2026-11-02 row E10-R3] May agents publish Zenod to the free, self-serve MCP directories (the official MCP Registry, Smithery, Glama, mcp.so, MCP Market free queue, awesome-mcp-servers, the Gemini CLI gallery) using the drafted wording? — context: P1 surveyed 15 directories; these need no review and no money, but each is a public post in Zenod's name; the wording leads with what no other memory server says: memory over WhatsApp, filed into a vault you own, answers with sources — impact: Zenod becomes findable in every tool that reads the official registry (VS Code, PulseMCP and others) and in the main web catalogs — risk: a public listing whose wording you dislike; rollback: each can be edited or removed (registry versions can be deprecated) — recommend: yes, it is the cheapest reach available and only repeats claims zenod.dev already makes — why Jordi: publishing in the company's name is your call — details: [plan §3 wording](epic10/P1-mcp-directory-plan.md) — snoozed until: 2026-11-05

## Non-Goals

paid placement (MCP Market's $29 tier, sponsored slots); Google partnership or business-development deals (Spark named partners, Le Chat curated directory); a local/stdio or npm package of Zenod; Docker MCP Catalog; WebMCP on zenod.dev (that is EPIC-11); changing price or plans; contacting directory staff beyond the submission forms.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Research worker | worker run_a84842a7 | Plan: survey every MCP directory worth being in (Anthropic, Google, and the rest), their listing requirements and SEO levers; fill Goal, Serves, Done means; propose one row or child epic per listing action | done | none | - | main | [P1 plan](epic10/P1-mcp-directory-plan.md) e8d5160 + validated [server.json](epic10/server.json): 15 directories surveyed (23 sources); Zenod passes the technical bar, fails 5 review points (no connect page, instructing tool descriptions, unchecked customer tool list, never run as a claude.ai connector, low-res icon); copy drafted (name dev.zenod/memory, lead with WhatsApp + own vault + sourced answers) | 2026-11-02 | — |
| E10-R1 | Ticket worker | worker run_a8e28db0 | Directory-ready tool surface: capture the hosted customer `tools/list`; hide operator/backlog/dispatch tools from customer tenants; rewrite tool descriptions to describe, not instruct; keep annotations (PR, `packages/` deploy gate) | active | P1 | - | main | P1 plan | 2026-11-02 | live `tools/list` on a customer tenant shows only the 7 memory tools, each with title + hint and no imperative-to-the-model sentences; vitest snapshot |
| E10-R2 | Ticket worker | worker run_a4e42a16 | Listing kit: 512×512 and 1024×1024 PNG icon (outlined "Z", no system font) + square SVG; `zenod.dev/connect` page: what Zenod does over MCP, add as connector in Claude / ChatGPT / Cursor (deeplink button) / VS Code / Gemini CLI, the tools, the example prompts, privacy and support links (PR, `apps/`) | active | P1 | - | main | P1 plan | 2026-11-02 | page and icons live on zenod.dev; `DOCS_URL` points at it |
| E10-R3 | Ticket worker | unassigned | Official MCP Registry: DNS TXT proof on zenod.dev (Cloudflare token), key in the secret store, publish [server.json](server.json); a publish step in CI for later versions | draft | R2; E10-A1 | - | main | P1 plan | 2026-11-02 | `curl 'https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.zenod'` returns `dev.zenod/memory` |
| E10-R4 | Ticket worker | unassigned | Self-serve directories in one pass: Smithery (add `/.well-known/mcp/server-card.json` if the scan can't sign in), Glama (`/.well-known/glama.json`), mcp.so, MCP Market free queue, awesome-mcp-servers PR, Gemini CLI extension repo | draft | R2; E10-A1 | - | main | P1 plan | 2026-11-02 | each listing URL recorded in the ledger and loads |
| E10-R5 | Ticket worker | unassigned | Anthropic Connectors Directory (child epic if review bounces): test as a custom connector in claude.ai with a customer account, populate a reviewer test account, submit with the drafted copy | draft | R1, R2; E10-A2 | - | main | P1 plan | 2026-11-02 | portal status "Published" (Community), listing URL recorded; Verified is a bonus, not a gate |
| E10-R6 | Ticket worker | unassigned | OpenAI ChatGPT directory (child epic: needs a demo video, test cases, domain challenge on cloud.zenod.dev, identity verification) | draft | R1, R2; E10-A3 | - | main | P1 plan | 2026-11-02 | review approved, listing URL recorded |
| E10-R7 | Ticket worker | unassigned | Findability check: monthly search of each directory for "memory", "whatsapp", "notes", "second brain"; record Zenod's position; adjust copy | draft | R3–R5 | - | main | P1 plan | 2026-11-02 | a table of positions per directory in this folder, first run after R3–R5 |
| E10-R8 | Ticket worker | unassigned | Follow-through: GitHub/VS Code inclusion (re-check 30 days after R3), PulseMCP (auto when it reopens), Cursor Marketplace review | draft | R3 | - | main | P1 plan | 2026-11-02 | each either listed or recorded as "not in our hands" with date |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-02 | accepted | Delivery Manager filled Serves, Done means and Non-Goals from the P1 plan (the scaffold had placeholders and Jordi readied the epic as "plan first, then one action each"); R1 and R2 ready (internal prep, no publishing); publishing waits on E10-A1 | plan → rows | P1 plan | if Jordi edits the Done means |
| 2026-11-02 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-02 | accepted | epic “Zenod in every MCP directory: listing sprint and MCP SEO” ready on Jordi's ask (L-37, Team desk: "I want to have a sprint inside the Xenote launch, which is about listing Xenote in the Anthropic MCP store and the Googl") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).


## Spine Map

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| webmcp-on-zenod-dev-agents-in-chrome-can-read-the-offer-and-start-sign-up | child | [EPIC-11: WebMCP on zenod.dev: agents in Chrome can read the offer and start sign-up](EPIC-11-WEBMCP-ON-ZENOD-DEV.md) | makes zenod.dev itself callable by browser agents, one more place agents find Zenod | draft | none | none | 2026-11-02 | fill Goal, Serves and Done means |
