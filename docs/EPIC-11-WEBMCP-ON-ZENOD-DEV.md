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

- [x] E11-1 zenod.dev (apps/site) registers WebMCP tools (what Zenod is, plans and price, open docs, go to sign-in) when `document.modelContext` exists; sign-in only navigates, never signs in or pays; covered by a vitest with a stubbed modelContext.
- [x] E11-2 Without WebMCP the site behaves exactly as before (build, lint, tests green).
- [ ] E11-3 Visitors' Chrome sees the tools without a flag: origin-trial token for zenod.dev in index.html (an agent registers the trial in the signed-in agent browser, E11-A1 answered).

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-02 E11-S1 merged (PR #1475, 9b5d18d): describe_zenod, get_plans, open_docs, go_to_sign_in in apps/site/src/lib/webmcp.ts
Result: tools registered behind feature detection, tested with a stubbed modelContext; not yet tried in a real WebMCP Chrome; awaiting image publish to reach zenod.dev
Evidence: zenod-in-every-mcp-directory-listing-spr.md
Waiting on: Jordi signs operations@alpha9.io into the agent browser once (waits on EPIC-7/E7-A11); S1 does not wait on it
Approved work: readied by Jordi 2026-11-02 ("do epicspine and zenod dev")
Next action: confirm describe_zenod in the live zenod.dev bundle after Publish image; then E11-S2: an agent registers the trial in the signed-in agent browser (E11-A1 answered, waits on EPIC-7/E7-A11) and adds the token via PR
Source revision: uncommitted scaffold
Verified at: 2026-11-02

## Waiting on

- [answered E11-A1 2026-11-02 @Jordi · research 2026-11-02 → waits on EPIC-7/E7-A11 · done 2026-11-02 research recorded → E7-A15] Register zenod.dev for Chrome's WebMCP origin trial and give us the token — context: Chrome only shows WebMCP tools to ordinary visitors on sites that carry a trial token; without it the tools work only with a testing flag — impact: unblocks E11-S2, the tools reach real visitors' Chrome (trial runs Chrome 149-156) — risk: none; a wrong or expired token only hides the tools — recommend: do it, because it is the only step between the shipped tools and visitors — why Jordi: it needs a Google account sign-in on the origin-trial page — steps: open https://developer.chrome.com/origintrials, pick WebMCP, Register, origin https://zenod.dev, then paste the token via the T3 secret card or in chat (it is public, it ships in the page) — unblocks: E11-S2 — effort: ~5 min — answer: Why can't you do it yourself? Can you not use the browser? What's stopping you? — research: agents can do the registration themselves in their own browser (T3's browser on VPS3); the only thing stopping them is that Chrome's origin-trial page needs a signed-in Google account, and no agent browser has one (checked 2026-11-02: the shared browser profile is signed out; the team browser holds no Google login). EPIC-7's ask E7-A11 already asks you to sign operations@alpha9.io into that browser once (it is open in the Delivery Manager thread's browser panel); that one sign-in unblocks both T7 and this — recommend: sign in once there; an agent then registers zenod.dev for the WebMCP trial, accepts the trial terms as Alpha9, adds the token and ships it (E11-S2), with no further step for you

## Non-Goals

Tools that sign in, pay or write data; WebMCP inside cloud.zenod.dev (the signed-in app).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| E11-S1 | Ticket worker | Sonnet subagent | Register WebMCP tools in apps/site, feature-detected, with a vitest | done | none | PR #1475 merged 9b5d18d | main | CI pass run 41477574557; site vitest 24/24, typecheck, build green; lint red only on pre-existing story-sections.tsx:39 | 2026-11-02 | publish + live check
| E11-S2 | Ticket worker | Delivery manager (agent registers via T3 browser) | Add the origin-trial token meta tag for zenod.dev (E11-3) | blocked | E11-S1, waits on EPIC-7/E7-A11 (one Google sign-in) | main via PR (meta tag in apps/site/index.html) | main | none | 2026-11-02 | after the sign-in: register the trial in the browser, add the token meta tag via PR |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-02 | accepted | Created as a goal under zenod-in-every-mcp-directory-listing-sprint-and-mcp-seo | one node in the epic log | zenod-in-every-mcp-directory-listing-spr.md | never |
| 2026-11-04 | accepted | E48-S6 asked-no-row sweep (agent_team run_0de9943c): E11-3 is E11-S2 (origin-trial token); its title now cites E11-3, no new row, no status changed | the console no longer lists E11-3 as asked with no row | this commit | never |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
