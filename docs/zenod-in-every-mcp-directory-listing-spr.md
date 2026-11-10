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
Goal sentence: Get Zenod into every AI tool directory.

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
Last attempted: 2026-11-10 roll-up: R2 connect kit and R3 official MCP Registry done ; R4 self-serve directories active, recheck 2026-11-12 (Gemini gallery refresh, mcp.so queue, MCP Market needs a normal browser) ; R1, R9, R10 blocked ; R5..R8 draft ; child EPIC-11 WebMCP active, S1 done, its trial token (S2) waits on the team sign-in E7-A18
Result: Zenod is in the official MCP Registry and the connect kit is live; Glama lists Zenod unclaimed and unscored until the team sign-in
Evidence: [P1 plan](epic10/P1-mcp-directory-plan.md), [server.json](epic10/server.json)
Waiting on: EPIC-7/E7-A18 (needs Mac agent: the team sign-in) for the Glama claim, R1 and EPIC-11 S2 ; R4 recheck 2026-11-12 ; R9 on 2026-12-07
Approved work: none
Next action: R4 recheck on 2026-11-12; claim Glama once the team sign-in is done
Source revision: uncommitted scaffold
Verified at: 2026-11-10T07:00Z

## Waiting on

- [answered E10-A4 2026-11-08 @Jordi · waits on EPIC-7/E7-A15 · done 2026-11-09 claim parked until the team sign-in E7-A15, no new ask] Glama hides Zenod: its health check cannot sign in to Zenod, so it marks Zenod "Unhealthy" and drops it from its connector search, even when you search "zenod". We will fix it by claiming the Glama listing with the zenod-ai GitHub org and giving Glama a separate test Zenod account with an empty library, so its check passes. OK? — context: the findability baseline of 8 Nov found it — impact: the Glama listing (live today) becomes findable — risk: Glama holds a sign-in to an empty test account; nothing of yours; rollback: delete the test account and the check fails again — recommend: yes — why Jordi: it gives a third party a credential — unblocks: E10-R10, E10-4 — details: [baseline](evidence/epic10-r10-2026-11-08.md) — answer: APPROVED — status: tried 2026-11-08 (run_2b4350c5), nothing created: claiming needs a signed-in Glama account and the empty test account needs its own Google or GitHub identity; both come from the team identity operations@alpha9.io once it is signed in (E7-A15, already with Jordi), so no new ask
- [answered E10-A6 2026-11-08 @Jordi · done 2026-11-08] You are right: Zenod is not "WhatsApp memory". Here is the directory wording led by what Zenod is, the line you confirmed for the product deck — title: "Zenod — the AI librarian of your memory" — one-liner: "Zenod keeps your memory for you: it takes in what you send by WhatsApp, voice note or any AI tool over MCP, files it as Markdown you own in GitHub or Google Drive, and lets any agent recall it with sources." WhatsApp is one way in, next to MCP and more. OK to use this in the directory listings? — context: your feedback on E10-A5; about the word you asked about: Glama (glama.ai) is one of the MCP directories, a public catalogue of tools that AI apps can connect to; it copied Zenod's entry from the official MCP Registry by itself, and E10-A4 (which you approved) fixes its health check so it shows Zenod — impact: one new registry version and the same wording on the other directories — risk: low, wording can change again — recommend: yes, it matches the product deck word for word — why Jordi: public wording in Zenod's name — unblocks: E10-4 — details: [baseline](evidence/epic10-r10-2026-11-08.md) — answer: APPROVED — acted: wording step dispatched (run_c9524b0c): new registry version and the same copy on every listing
- [feedback E10-A5 2026-11-08 @Jordi · done 2026-11-08 324fc87d round 2 E10-A6] Change Zenod's directory title and one-liner so people searching "notes" or "second brain" find it: title "Zenod: WhatsApp memory and notes" (today "Zenod Memory") and "Your second brain on WhatsApp: voice notes and messages filed into Markdown notes you own, recalled by any AI with citations." OK? — context: the 8 Nov baseline shows Zenod never matches "notes" or "second brain" because neither word is in its listing; nobody owns "whatsapp memory" yet — impact: one new registry version and the same copy on Glama, mcp.so, MCP Market and the Gemini repo — risk: low; wording can be changed again, registry versions can be superseded — recommend: yes — why Jordi: it is public wording in Zenod's name (E10-A1 covered the earlier wording only) — unblocks: E10-4 — details: [baseline and copy](evidence/epic10-r10-2026-11-08.md) — feedback: But why are you leading with WhatsApp? It's not like Z-Node is not WhatsApp memory and notes Z-Node is like a Maintained Your they maintain digital memory It's it. I don't know why you're leading with WhatsApp and WhatsApp is like you can ingest via WhatsApp But I'm a little bit nervous about and also what is this glamour? I don't you keep talking about this glamour thing I know I don't know what that word comes from from and your second brain on WhatsApp, this is, I mean, it's, I don't know how I would lead with that, you know, it's, it's kind of WhatsApp, MCP and it's, and more. I'm a little bit nervous, man. What are you, I'm a little bit nervous about this, to be honest.

- [answered E10-A1 2026-11-07 @Jordi · done 2026-11-07] May agents publish Zenod to the free, self-serve MCP directories (the official MCP Registry, Smithery, Glama, mcp.so, MCP Market free queue, awesome-mcp-servers, the Gemini CLI gallery) using the drafted wording? — context: P1 surveyed 15 directories; these need no review and no money, but each is a public post in Zenod's name; the wording leads with what no other memory server says: memory over WhatsApp, filed into a vault you own, answers with sources — impact: Zenod becomes findable in every tool that reads the official registry (VS Code, PulseMCP and others) and in the main web catalogs — risk: a public listing whose wording you dislike; rollback: each can be edited or removed (registry versions can be deprecated) — recommend: yes, it is the cheapest reach available and only repeats claims zenod.dev already makes — why Jordi: publishing in the company's name is your call — details: [plan §3 wording](epic10/P1-mcp-directory-plan.md) — snoozed until: 2026-11-05 — answer: APPROVED — acted: R3 and R4 ready, workers run_5932dd01 (R3) and run_f79bd8f2 (R4)

## Non-Goals

paid placement (MCP Market's $29 tier, sponsored slots); Google partnership or business-development deals (Spark named partners, Le Chat curated directory); a local/stdio or npm package of Zenod; Docker MCP Catalog; WebMCP on zenod.dev (that is EPIC-11); changing price or plans; contacting directory staff beyond the submission forms.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Research worker | worker run_a84842a7 | Plan: survey every MCP directory worth being in (Anthropic, Google, and the rest), their listing requirements and SEO levers; fill Goal, Serves, Done means; propose one row or child epic per listing action | done | none | - | main | [P1 plan](epic10/P1-mcp-directory-plan.md) e8d5160 + validated [server.json](epic10/server.json): 15 directories surveyed (23 sources); Zenod passes the technical bar, fails 5 review points (no connect page, instructing tool descriptions, unchecked customer tool list, never run as a claude.ai connector, low-res icon); copy drafted (name dev.zenod/memory, lead with WhatsApp + own vault + sourced answers) | 2026-11-02 | — |
| E10-R1 | Ticket worker | worker run_a8e28db0 | Directory-ready tool surface: capture the hosted customer `tools/list`; hide operator/backlog/dispatch tools from customer tenants; rewrite tool descriptions to describe, not instruct; keep annotations (PR, `packages/` deploy gate) (E10-3) | blocked | waits on EPIC-7/E7-A11 (customer tools/list capture) | [#1478](https://github.com/zenod-ai/zenod/pull/1478), [#1480](https://github.com/zenod-ai/zenod/pull/1480) | main | [R1 evidence](evidence/epic10-r1-2026-11-02.md): customer OAuth/zmt_ credentials see only the 7 memory tools (WhatsApp delivery credential keeps chat_with_zenod); operator tools hidden by role, not deleted; descriptions describe instead of instruct; tests + snapshot; live 9f12912 | 2026-11-02 | capture tools/list from a real customer account once the agent browser has a Google sign-in (E7-A11) |
| E10-R2 | Ticket worker | worker run_a4e42a16 | Listing kit: 512×512 and 1024×1024 PNG icon (outlined "Z", no system font) + square SVG; `zenod.dev/connect` page: what Zenod does over MCP, add as connector in Claude / ChatGPT / Cursor (deeplink button) / VS Code / Gemini CLI, the tools, the example prompts, privacy and support links (PR, `apps/`) (E10-3) | done (approved by Jordi 2026-11-03) | P1 | [#1476](https://github.com/zenod-ai/zenod/pull/1476) | main | [R2 evidence](evidence/epic10-r2-2026-11-02.md): https://zenod.dev/connect live (Claude, ChatGPT, Cursor one-click, VS Code, Gemini CLI steps; 7 memory tools; 5 example prompts; privacy/terms/support); outlined-Z icons SVG + 512/1024 PNG under /brand/; DOCS_URL and server.json websiteUrl → /connect; live c9a7a77 | 2026-11-02 | if R1 renames tools, update MEMORY_TOOLS in apps/site/src/lib/connect.ts |
| E10-R3 | Ticket worker | run_5932dd01-bc21-4238-ad44-aa1c72897671 | Official MCP Registry: DNS TXT proof on zenod.dev (Cloudflare token), key in the secret store, publish [server.json](server.json); a publish step in CI for later versions (E10-2) | done (approved by Jordi 2026-11-08) | R2 done; E10-A1 answered | [#1501](https://github.com/zenod-ai/zenod/pull/1501) | main | [R3 evidence](evidence/epic10-E10-R3-2026-11-07.md), [card](cards/E10-R3.md): listing live https://registry.modelcontextprotocol.io/?q=dev.zenod ; `search=dev.zenod` returns `dev.zenod/memory` 0.1.0 active, published 2026-11-07T20:55Z ; DNS proof TXT on zenod.dev, key in VPS1 store zenod-mcp-registry/MCP_REGISTRY_PRIVATE_KEY + Actions secret MCP_REGISTRY_PRIVATE_KEY ; CI publish workflow mcp-registry.yml merged dbf7a2c, first run green (skipped, version already live) | 2026-11-07 | followups: started E10-R9, E10-R10 |
| E10-R4 | Ticket worker | run_37245021 (monitoring, recheck 2026-11-12T09:00Z) | Self-serve directories in one pass: Smithery (add `/.well-known/mcp/server-card.json` if the scan can't sign in), Glama (`/.well-known/glama.json`), mcp.so, MCP Market free queue, awesome-mcp-servers PR, Gemini CLI extension repo (E10-2) | active | R2 done; E10-A1 answered | - | main | [R4 evidence](evidence/epic10-E10-R4-2026-11-07.md): Glama live https://glama.ai/mcp/connectors/dev.zenod/memory ; Gemini CLI repo https://github.com/zenod-ai/zenod-gemini (v0.1.0, topic set, installs; gallery crawls daily) ; mcp.so queued https://github.com/chatmcp/mcpso/issues/6906 ; awesome-mcp-servers PR https://github.com/punkpeye/awesome-mcp-servers/pull/18864 (needs a Glama score for zenod-ai/zenod) ; MCP Market form 403 to scripted browsers ; Smithery closed self-serve 2026-10-31, not in our hands ; recheck 2026-11-09: Glama still unscored and unclaimed (E7-A15), Gemini gallery data not refreshed since 2026-10-15, mcp.so issue still unanswered among 4446 open, awesome PR waits on the Glama score, MCP Market retried once and got 403 again, nothing sent | 2026-11-09 | monitoring until 2026-11-12T09:00Z: Gemini gallery refresh, mcp.so issue, awesome PR after the Glama claim ; MCP Market free queue needs a person on a normal browser (about 1 minute) or the signed-in agent browser after E7-A15 |
| E10-R5 | Ticket worker | unassigned | Anthropic Connectors Directory (child epic if review bounces): test as a custom connector in claude.ai with a customer account, populate a reviewer test account, submit with the drafted copy (E10-1) | draft | R1, R2; E10-A2 | - | main | P1 plan | 2026-11-02 | portal status "Published" (Community), listing URL recorded; Verified is a bonus, not a gate |
| E10-R6 | Ticket worker | unassigned | OpenAI ChatGPT directory (child epic: needs a demo video, test cases, domain challenge on cloud.zenod.dev, identity verification) (E10-5) | draft | R1, R2; E10-A3 | - | main | P1 plan | 2026-11-02 | review approved, listing URL recorded |
| E10-R7 | Ticket worker | unassigned | Findability check: monthly search of each directory for "memory", "whatsapp", "notes", "second brain"; record Zenod's position; adjust copy (E10-4) | draft | R3–R5 | - | main | P1 plan | 2026-11-02 | a table of positions per directory in this folder, first run after R3–R5 |
| E10-R8 | Ticket worker | unassigned | Follow-through: GitHub/VS Code inclusion (re-check 30 days after R3), PulseMCP (auto when it reopens), Cursor Marketplace review | draft | R3 | - | main | P1 plan | 2026-11-02 | each either listed or recorded as "not in our hands" with date |
| E10-R9 | Ticket worker | Delivery Manager (date-gated) | E10-R8 GitHub/VS Code inclusion re-check on 2026-12-07 (30 days after the listing): follow-up of E10-R3 | blocked | date 2026-12-07 | none | main | Jordi started it when closing E10-R3 2026-11-08 | 2026-11-08 | re-check on 2026-12-07 whether GitHub's MCP list and VS Code show dev.zenod/memory; a worker is dispatched that day, nothing to do before |
| E10-R10 | Ticket worker | Delivery Manager (monthly, date-gated) | E10-R7 findability check (needs R3 to R5 live): follow-up of E10-R3 | blocked | date 2026-12-08 (monthly re-run); Glama claim waits on E7-A15 | none | main | [findability table](epic10/findability-2026-11-08.md), [evidence](evidence/epic10-r10-2026-11-08.md): Registry "memory" 62/323 A–Z ; Glama Unhealthy, hidden ; "whatsapp memory" open phrase ; Smithery search empty ; wording E10-A6 live 2026-11-08 ([wording evidence](evidence/epic10-r10-wording-2026-11-08.md)): Registry 0.2.0 via CI (first real publish, run 42451067814, #1513), Gemini v0.2.0, mcp.so 6906 and awesome PR 18864 updated, MCP Market free queue 403 | 2026-11-08 | wording done 2026-11-08 (run_c9524b0c): every listing we control carries "Zenod — the AI librarian of your memory"; Glama picks it up from the registry by itself, its claim waits on E7-A15; next: monthly findability re-run 2026-12-08 against the new wording |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-02 | accepted | Delivery Manager filled Serves, Done means and Non-Goals from the P1 plan (the scaffold had placeholders and Jordi readied the epic as "plan first, then one action each"); R1 and R2 ready (internal prep, no publishing); publishing waits on E10-A1 | plan → rows | P1 plan | if Jordi edits the Done means |
| 2026-11-02 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-02 | accepted | epic “Zenod in every MCP directory: listing sprint and MCP SEO” ready on Jordi's ask (L-37, Team desk: "I want to have a sprint inside the Xenote launch, which is about listing Xenote in the Anthropic MCP store and the Googl") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-04 | accepted | E48-S6 asked-no-row sweep (agent_team run_0de9943c): E10-1..E10-5 were already planned as E10-R1..R7 (P1 plan); each row title now cites the Done-means id it delivers (R5 E10-1, R3/R4 E10-2, R1/R2 E10-3, R7 E10-4, R6 E10-5), no new row, no status changed | the console no longer lists E10-1..5 as asked with no row | this commit | if the rows are re-planned |
| 2026-11-07 | accepted | R3 and R4 stamped ready (root L-37): Jordi answered E10-A1 "APPROVED" via the console (39746f0) — agents publish Zenod to the free self-serve MCP directories with the drafted P1 wording | his answer is the ready stamp and the publishing approval for exactly the listed directories | 39746f0 | if a directory asks for money, a paid tier or a review not in the ask |
| 2026-11-08 | revised | E10-A5 was feedback (0d33cc6): Jordi does not want to lead with WhatsApp or "second brain"; Zenod is a maintained digital memory, reachable by WhatsApp, MCP and more; he did not know what Glama is. Round 2 is E10-A6: wording led by the confirmed positioning (the AI librarian of your memory), WhatsApp as one way in, and Glama explained. | lead with what Zenod is, not one channel | 0d33cc6 | when E10-A6 is answered |
| 2026-11-08 | blocked | decided by Delivery Manager: the Glama fix (E10-A4) waits on the same sign-in as EPIC-7 T7 (operations@alpha9.io, E7-A15) instead of a new ask — why: both missing pieces (a Glama account, a separate identity for the empty test account) come from that one team identity, and Jordi has too many asks open — rollback: raise a dedicated ask if E7-A15 stalls | no new ask | evidence/epic10-r10-glama-2026-11-08.md | when E7-A15 is answered |
| 2026-11-08 | done | E10-A6 wording published (run_c9524b0c): the registry `description` holds at most 100 characters, so it carries the approved one-liner shortened with its words in order ("Keeps your memory: WhatsApp, voice or any AI tool over MCP, Markdown you own, recall with sources"); the full one-liner goes everywhere with room (Gemini, mcp.so, awesome-mcp-servers) | approved words only, shortened only where a field limit forces it | evidence/epic10-r10-wording-2026-11-08.md | when the wording changes again |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).


## Spine Map

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| webmcp-on-zenod-dev-agents-in-chrome-can-read-the-offer-and-start-sign-up | child | [EPIC-11: WebMCP on zenod.dev: agents in Chrome can read the offer and start sign-up](EPIC-11-WEBMCP-ON-ZENOD-DEV.md) | makes zenod.dev itself callable by browser agents, one more place agents find Zenod | draft | none | none | 2026-11-02 | fill Goal, Serves and Done means |

## Plain names

The card's tree names a task by these (E48-S26, agent_team docs/review-cards.md). Plain words only.

- P1: The plan was made: 15 directories were checked.
- E10-R1: Customers see only the memory tools
- E10-R2: the logo and the connect page
- E10-R3: the official MCP registry
- E10-R4: Smithery, Glama and other lists you add yourself to
- E10-R5: the Anthropic connectors directory
- E10-R6: the ChatGPT directory
- E10-R7: a monthly check that people find Zenod
- E10-R8: more listings once the registry has us
