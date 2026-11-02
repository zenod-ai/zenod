# EPIC-11: WebMCP on zenod.dev: agents in Chrome can read the offer and start sign-up

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/EPIC-11-WEBMCP-ON-ZENOD-DEV.md
Spine ID: webmcp-on-zenod-dev-agents-in-chrome-can-read-the-offer-and-start-sign-up
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-10: Zenod in every MCP directory: listing sprint and MCP SEO](zenod-in-every-mcp-directory-listing-spr.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

An AI agent running in a visitor's Chrome can ask zenod.dev what Zenod is, compare self-hosted with Zenod Hosted and its price, open the docs, and take the visitor to sign-in, through WebMCP tools (`document.modelContext.registerTool`), without scraping the page. Browsers without WebMCP see no change.

## Serves

[EPIC-10: Zenod in every MCP directory: listing sprint and MCP SEO](zenod-in-every-mcp-directory-listing-spr.md): makes zenod.dev itself callable by browser agents: one more place agents find and recommend Zenod.

## Done means

- [ ] E11-1 zenod.dev (apps/site) registers WebMCP tools (what Zenod is, plans and price, open docs, go to sign-in) when `document.modelContext` exists; sign-in only navigates, never signs in or pays; covered by a vitest with a stubbed modelContext.
- [ ] E11-2 Without WebMCP the site behaves exactly as before (build, lint, tests green).
- [ ] E11-3 Visitors' Chrome sees the tools without a flag: origin-trial token for zenod.dev in index.html (needs Jordi to register the trial, E11-A1).

## Current State

Owner: Delivery manager
Status: ready
Last attempted: scaffolded with spine_new.py on 2026-11-02
Result: created, not started
Evidence: zenod-in-every-mcp-directory-listing-spr.md
Waiting on: Jordi: E11-A1 (S1 does not wait on it)
Approved work: readied by Jordi 2026-11-02 ("do epicspine and zenod dev")
Next action: worker builds and tests the tools on a branch; Delivery manager verifies and integrates
Source revision: uncommitted scaffold
Verified at: 2026-11-02

## Waiting on

- [ask E11-A1: do @Jordi since 2026-11-02 row E11-S2] Register zenod.dev for Chrome's WebMCP origin trial and give us the token — context: Chrome only shows WebMCP tools to ordinary visitors on sites that carry a trial token; without it the tools work only with a testing flag — impact: unblocks E11-S2, the tools reach real visitors' Chrome (trial runs Chrome 149-156) — risk: none; a wrong or expired token only hides the tools — recommend: do it, because it is the only step between the shipped tools and visitors — why Jordi: it needs a Google account sign-in on the origin-trial page — steps: open https://developer.chrome.com/origintrials, pick WebMCP, Register, origin https://zenod.dev, then paste the token via the T3 secret card or in chat (it is public, it ships in the page) — unblocks: E11-S2 — effort: ~5 min

## Non-Goals

Tools that sign in, pay or write data; WebMCP inside cloud.zenod.dev (the signed-in app).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| E11-S1 | Ticket worker | worker | Register WebMCP tools in apps/site, feature-detected, with a vitest | ready | none | wt/e11-s1-webmcp | main | none | 2026-11-02 | build on branch, open PR (apps/** is under the Deploy gate), report |
| E11-S2 | Ticket worker | Delivery manager | Add the origin-trial token meta tag for zenod.dev | blocked | E11-S1, E11-A1 | none | main | none | 2026-11-02 | add the token once Jordi provides it |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-02 | accepted | Created as a goal under zenod-in-every-mcp-directory-listing-sprint-and-mcp-seo | one node in the epic log | zenod-in-every-mcp-directory-listing-spr.md | never |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
