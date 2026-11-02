# EPIC-10 P1: MCP directory plan for Zenod

Spine: [EPIC-10](../zenod-in-every-mcp-directory-listing-spr.md) · Run: run_a84842a7 · Researched 2026-11-02 · Sibling child: [EPIC-11 WebMCP on zenod.dev](../EPIC-11-WEBMCP-ON-ZENOD-DEV.md) (not touched here)

Research and planning only. Nothing was submitted, posted or signed up for. The one network write-free check was `mcp-publisher validate` on the draft [server.json](server.json) (passes against registry.modelcontextprotocol.io, 2026-11-02).

## 1. What Zenod brings to a directory today (checked 2026-11-02)

| Check | Result | Evidence |
|---|---|---|
| Public remote endpoint | `https://cloud.zenod.dev/mcp`, streamable HTTP; unauthenticated POST returns **401** with `WWW-Authenticate: Bearer resource_metadata=...` | live curl 2026-11-02 |
| OAuth | OAuth 2.1 auth-code + PKCE S256, refresh tokens, **dynamic client registration** (`/oauth/register`), RFC 9728 protected-resource metadata and RFC 8414 AS metadata both live; public clients (`token_endpoint_auth_methods: none`); scope `mcp` | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`; `packages/server/src/oauth.ts` |
| Authorize page CSP | allows `form-action https:` on the OAuth page, so claude.ai / chatgpt.com callbacks are not blocked | `packages/server/src/zenodUnit.ts:976` |
| Tool annotations | every memory tool has `title` + `readOnlyHint`/`destructiveHint` (search/get/ask read-only; store/ingest write, non-destructive; run_task destructive) | `packages/server/src/mcp.ts` |
| Privacy policy | https://zenod.dev/legal/privacy.html (controller Alpha Analytics SL, retention, sharing, contact support@zenod.dev) | live 200 |
| Terms | https://zenod.dev/legal/terms.html | live 200 |
| Support contact | support@zenod.dev | privacy policy |
| Source | public, AGPL-3.0, github.com/zenod-ai/zenod (`units/zenod`) | `gh repo view` |
| Icon | only `apps/site/public/favicon.svg` (64×64 "Z" drawn with a system font, renders differently per machine) | repo |
| User docs | **gap**: `DOCS_URL` points at the repo `docs/` folder, which is internal spines, not "connect Zenod to Claude" instructions | `apps/site/src/lib/customer.ts:4` |
| Tool descriptions | **risk**: several hosted tool descriptions tell the model how to behave ("Use the requested limit...", "MUST be returned verbatim"); Anthropic rejects descriptions that instruct Claude rather than describe the tool | `mcp.ts` search_memory, task_brain; review criteria |
| Hosted tool surface | **unknown**: the source registers 23 tools incl. GitHub backlog/dispatch tools (`create_issue`, `backlog_*`, `run_task`); which of these a *hosted customer* sees has not been captured from a live `tools/list` | `mcp.ts` |
| End-to-end in Claude | **untested**: nobody has added `cloud.zenod.dev/mcp` as a claude.ai custom connector and run every tool with a customer account; needs a signed-in browser (same blocker as EPIC-7 E7-A11) | — |

Net: Zenod already passes the hard technical gates (remote, HTTPS, OAuth with DCR, 401 + PRM, annotations, privacy, terms). It does not yet pass the review-quality gates (user docs, clean tool descriptions, a customer-only tool surface, a real Claude test, a reviewer test account, a proper icon).

## 2. Directory survey (as of 2026-11-02)

Value is a judgement from how the directory reaches users, not measured traffic (none of these publish per-listing traffic). "Self-serve" means no human approval.

| # | Directory | Who can list / how | Requirements | Effort | Value | Zenod qualifies today? | Blocker |
|---|---|---|---|---|---|---|---|
| 1 | **Anthropic Connectors Directory** (claude.ai Customize > Connectors, claude.com/connectors) | Anyone on a **paid Claude plan**, via portal claude.ai/directory/manage > Submit new > MCP connector. Auto policy scan, then listed as **Community** by default; Anthropic may escalate to **Verified** (checkmark, better display/discovery) on its own [1][2][3] | Remote HTTPS; OAuth 2.0 for user data; every tool `title` + read-only/destructive hint; names ≤64 chars; narrow, non-instructing descriptions; split read/write; real error messages; public docs by publish date; privacy URL, support contact, icon; **reviewer test account, fully populated**; agree to Software Directory Terms + Policy and 7 compliance acknowledgments. Listing: name ≤100, one-liner ≤200, description ≤2000, 1–5 categories, permanent slug [1][2] | M (prereqs) + 30 min portal | **Highest**: inside the product where Claude users look for connectors; Verified label boosts discovery | Technically yes; review-wise no | docs page, description cleanup, customer-only tool surface, Claude test, test account, icon; then Jordi: paid-plan account + accept terms for Alpha Analytics SL |
| 2 | **Official MCP Registry** (registry.modelcontextprotocol.io, preview) | Self-serve with `mcp-publisher`; namespace proves ownership: `io.github.<org>/*` via GitHub login/OIDC, or `dev.zenod/*` via DNS TXT or `/.well-known/mcp-registry-auth` on zenod.dev [4][5][6] | `server.json` (schema 2025-12-11) with a `remotes` streamable-http entry; URL publicly reachable; description ≤100 chars. No review | **S** (draft done and validated) | **High as a feeder**: PulseMCP, GitHub/VS Code and many aggregators read from it; PulseMCP currently ingests only via the registry [7][9] | **Yes** | publishing is ask-tier (E10-A1); namespace proof (agent: DNS TXT on zenod.dev via the Cloudflare token) |
| 3 | **GitHub MCP Registry** (github.com/mcp) → **VS Code** `@mcp` gallery | VS Code's gallery lists servers from GitHub's registry [8]. GitHub's registry syncs from the official registry but onboarding new publishers looks manually curated; no documented request path (community threads unanswered, Oct 2026) [9] | being in the official registry first | S after #2, then wait | High for developers (Copilot / VS Code) | after #2 | GitHub curation, not in our hands; re-check 30 days after #2 |
| 4 | **OpenAI ChatGPT directory** (apps, now submitted as "plugins") | Org owner on platform.openai.com with **individual or business identity verification**; listed under the verified name [10][11] | Public HTTPS MCP; OAuth (DCR supported) or none, no API keys; **domain challenge** at `https://<mcp host or parent>/.well-known/openai-apps-challenge`; website, support, privacy, **terms** URLs; square logo ≥48 px; 5 positive + 3 negative test cases, **demo video**, release notes; reviewer test account without MFA/magic links; per-tool annotations with justifications; country allowlist [10][11] | M–L | **High** (ChatGPT reach) | Technically close | org/business verification (Jordi), challenge file on cloud.zenod.dev (code, deploy gate), demo video, test account, test cases |
| 5 | **Smithery** (smithery.ai) | Self-serve: smithery.ai/new, paste the public URL, or `smithery mcp publish "<url>" -n @org/name` [12] | Streamable HTTP; OAuth detected from a **401** (we return 401, good); Smithery registers itself via Client ID Metadata Documents; auth-protected servers need the owner to sign in for the scan, or a static `/.well-known/mcp/server-card.json`; Cloudflare bot rules must not block `SmitheryBot/1.0` [12] | S | Medium-high (large catalog, also re-published into Glama "connectors") | Yes, if CIMD or server card works | account creation + publishing (ask tier); likely a server card on cloud.zenod.dev (code) because the scan needs a Zenod login |
| 6 | **Glama** (glama.ai/mcp) | Indexes GitHub repos and remote connectors; claim a remote connector by serving `/.well-known/glama.json` (schema `connector.json`, maintainers email = Glama account email) [13] | For the repo route: `glama.json` in repo root + a Dockerfile Glama can start and introspect; quality score badge | S–M | Medium; **also the gate to punkpeye/awesome-mcp-servers**, which now requires a passing Glama listing [14] | Partly (repo is public) | account + claim (ask tier); `.well-known/glama.json` on cloud.zenod.dev (code) |
| 7 | **awesome-mcp-servers** (punkpeye, GitHub) | PR to README; must already be listed on Glama and passing its checks, add the Glama badge; hosted OAuth servers go via Glama connectors [14] | Glama listing | S after #6 | Medium (very high-starred list, SEO backlinks) | after #6 | PR = publishing (A1) |
| 8 | **PulseMCP** | **Not accepting submissions right now**; says it will pick up servers from the official registry automatically when it resumes [7] | official registry | 0 after #2 | Medium | via #2 | none; re-check |
| 9 | **mcp.so** | Submit form on site (403 to our fetcher) or GitHub issue on punkpeye/mcp.so [15] | name, URL, description | S | Medium (high SEO, many listings) | Yes | publishing (A1); browser for the form |
| 10 | **MCP Market** (mcpmarket.com) | Form with GitHub repo URL; **free queue 4–6 weeks** or **$29 one-time** for 24 h + "Official" badge + "Try now" link [16] | GitHub URL or remote MCP | S | Low-medium | Yes | free queue: publishing (A1); paid tier = money, not proposed |
| 11 | **Cursor** (Marketplace at cursor.com/marketplace/publish; plugins `.cursor-plugin/plugin.json`; one-click deeplink `cursor://anysphere.cursor-deeplink/mcp/install`) [17] | Manual review, uncertain turnaround; secondary sources only | plugin manifest pointing at the remote MCP | M | Medium (developers) | Yes for the deeplink today; Marketplace after review | publishing (A1); deeplink needs no listing and can go on zenod.dev now (code) |
| 12 | **Gemini CLI extensions gallery** (geminicli.com/extensions) | Auto-crawled daily from **public GitHub repos** with `gemini-extension.json` at the repo/archive root, the `gemini-cli-extension` topic and a tagged release; no vetting [18] | manifest; Google moved free/Pro/Ultra individuals to Antigravity CLI on 2026-06-18, so reach is now mostly Code Assist licensees [19] | S (a tiny separate repo, e.g. `zenod-ai/zenod-gemini`) | Low-medium | Yes | a new public repo + topic = publishing (A1) |
| 13 | **Google, everything else** | No public third-party MCP directory exists for Gemini as of 2026-11-02: Spark (Gemini app) takes custom URLs per user and named partners by negotiation; Gemini Enterprise and Agent Registry are per-tenant admin registration; Antigravity's MCP store has no public submission path [19][20][21] | — | — | "Google's store" = Gemini CLI gallery (#12) + a "Use Zenod in Gemini" doc for custom URLs | n/a | partnership conversation (business development, not a listing) |
| 14 | **Docker MCP Catalog** | PR to github.com/docker/mcp-registry; built around container images, remote support newer [22] | image or remote entry | M | Low for a hosted consumer product | Partly | skip for now |
| 15 | **Mistral Le Chat** | Curated directory, no public submission; any user adds a custom URL [23] | — | — | Low | n/a | skip; docs line only |

Also-rans not planned (low reach or duplicates): claudemarket.ai and similar mirrors of the Claude directory, LobeHub, Cline marketplace, Windsurf (no current submission docs found), npx `mcp-submit` multi-poster (unvetted). Revisit only if a directory reports real Zenod referrals.

## 3. MCP SEO

### How each directory finds and ranks

- **Official registry**: the API `search` is a **substring match on the server name only** (checked live: `search=second brain` → 0 hits; `search=memory` → 100+ servers, all with "memory" in the name, e.g. `com.googleapis.memorystore`). So the *name* is the whole SEO lever there: `dev.zenod/memory` matches both "zenod" and "memory". Description is capped at 100 chars and shown by downstream clients.
- **Anthropic**: ranking is undocumented; inputs are name, one-liner, description, categories and the Verified label ("affects how the connector is displayed and discovered") [3]. The description is written by us and Anthropic can't edit it [1]. Verified is granted by Anthropic for "highly useful" connectors, so quality and real usage are the lever.
- **Smithery / Glama / mcp.so / MCP Market**: full-text search on name + description + tool names; Glama and Smithery also show quality/verification scores (license, working introspection, tool descriptions). Matching keywords in the description and well-named tools is what moves us.
- **VS Code / GitHub**: show registry title + description; search by name and description.

### The crowd we stand in

The registry already holds 100+ "memory" servers (brainmemory, memoryrouter, workingmemory, gnosismemory, heirmos, getdeeprecall, letta...), almost all pitching "persistent memory shared across Claude, ChatGPT, Cursor". None of the first 100 says WhatsApp, Markdown vault you own, or citations with git receipts. Those three are the differentiators every listing must lead with.

### Drafted copy (agent-prepared; final wording approved in E10-A1)

- **Server name** (Anthropic, Smithery, Glama, mcp.so): `Zenod`. Title where a longer field exists: `Zenod — memory you own, fed from WhatsApp`.
- **Registry name**: `dev.zenod/memory`, title `Zenod Memory`. Fallback if domain proof is refused: `io.github.zenod-ai/zenod-memory`.
- **Registry description (93/100 chars)**: `Memory you own: capture on WhatsApp, filed into your Markdown vault, recalled with citations.`
- **One-liner (≤200, Anthropic/OpenAI subtitle)**: `Send notes and voice memos on WhatsApp; Zenod files them into a Markdown vault you own on GitHub or Google Drive and answers from it with sources.`
- **Long description (≤2000)**:

  > Zenod is a personal memory agent. Tell it things the way you already talk: a WhatsApp message, a voice note, a pasted email, a meeting transcript. Zenod keeps the original as evidence, files the meaning onto the right page of your vault, and links every page back to its source.
  >
  > Your memory lives in ordinary Markdown in storage you own, a GitHub repository or a Google Drive folder, so you can read it, edit it, open it in Obsidian or take it elsewhere at any time. Every write comes back with a receipt: the page it touched and the commit or file it saved.
  >
  > With this connector, Claude can search your memory, read a note, store something new and ask a question that spans many notes. Answers cite the vault pages they came from, so you can check them.
  >
  > Zenod Hosted costs €9/month + VAT and includes managed AI usage and WhatsApp. Zenod is open source (AGPL-3.0) and can be self-hosted free with your own AI key.
  >
  > You need a Zenod account (sign in with Google at cloud.zenod.dev) and a GitHub repository or Google Drive folder for the vault.

  (Claims checked against zenod.dev's current copy and SEAM-SURFACE.md; "voice note" relies on the live voice-capture path, recheck before publishing.)
- **Keywords / tags**: memory, personal memory, second brain, notes, knowledge base, PKM, WhatsApp, voice notes, Markdown, Obsidian, GitHub, Google Drive, journal, recall, citations, long-term memory.
- **Categories**: Anthropic: `Productivity` + `Knowledge management` (pick the nearest names in the portal list, up to 5); Smithery/Glama: Memory, Knowledge & Notes, Productivity; MCP Market: Memory Management.
- **Example prompts** (Anthropic use cases, OpenAI positive tests, directory "examples" fields):
  1. "Remember that my car insurance with Mapfre renews on 14 March." → `store_memory`
  2. "When does my passport expire?" → `ask_brain` (answer with cited page)
  3. "What did I send myself on WhatsApp last week about the garden?" → `search_memory`
  4. "Open my note on the Barcelona flat viewing." → `get_memory`
  5. "File this meeting transcript into my vault." → `ingest_memory` + `get_ingest_result`
  - Negative tests (OpenAI): "Book me a flight" (no tool), "Delete my whole vault" (refused/no tool), "What's the weather" (no tool).
- **Tool names**: keep the existing snake_case names (short, verb-object, already match how people ask). Customer-facing surface for listings: `search_memory`, `get_memory`, `store_memory`, `ingest_memory`, `get_ingest_result`, `ask_brain`, `get_task_result`. Descriptions rewritten to *describe*, not instruct, e.g. `search_memory`: "Search the user's memory vault by words, category or date and return matching entries with their paths and sources." (Row E10-R1.)

## 4. Proposed build (ordered by value ÷ effort)

`J` = needs Jordi (raised as an ask when that row is next). Everything else an agent does.

| Row | What | Done check | J? |
|---|---|---|---|
| E10-R1 | **Directory-ready tool surface**: capture the hosted customer `tools/list`; hide operator/backlog/dispatch tools from customer tenants; rewrite tool descriptions to describe, not instruct; keep annotations (PR, `packages/**` deploy gate) | live `tools/list` on a customer tenant shows only the 7 memory tools, each with title + hint and no imperative-to-the-model sentences; vitest snapshot | no |
| E10-R2 | **Listing kit**: 512×512 and 1024×1024 PNG icon (outlined "Z", no system font) + square SVG; `zenod.dev/connect` page: what Zenod does over MCP, add as connector in Claude / ChatGPT / Cursor (deeplink button) / VS Code / Gemini CLI, the tools, the example prompts, privacy and support links (PR, `apps/**`) | page and icons live on zenod.dev; `DOCS_URL` points at it | no |
| E10-R3 | **Official MCP Registry**: DNS TXT proof on zenod.dev (Cloudflare token), key in the secret store, publish [server.json](server.json); a publish step in CI for later versions | `curl 'https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.zenod'` returns `dev.zenod/memory` | **E10-A1** (publishing) |
| E10-R4 | **Self-serve directories in one pass**: Smithery (add `/.well-known/mcp/server-card.json` if the scan can't sign in), Glama (`/.well-known/glama.json`), mcp.so, MCP Market free queue, awesome-mcp-servers PR, Gemini CLI extension repo | each listing URL recorded in the ledger and loads | E10-A1 covers publishing; accounts on these sites are created with the team Google identity once the agent browser is signed in (E7-A11) |
| E10-R5 | **Anthropic Connectors Directory** (child epic if review bounces): test as a custom connector in claude.ai with a customer account, populate a reviewer test account, submit with the drafted copy | portal status "Published" (Community), listing URL recorded; Verified is a bonus, not a gate | **E10-A2** (paid plan + accepting Anthropic's directory terms as Alpha Analytics SL); depends R1, R2 |
| E10-R6 | **OpenAI ChatGPT directory** (child epic: needs a demo video, test cases, domain challenge on cloud.zenod.dev, identity verification) | review approved, listing URL recorded | **E10-A3** (business verification of Alpha Analytics SL with OpenAI + publishing under that name); depends R1, R2 |
| E10-R7 | **Findability check**: monthly search of each directory for "memory", "whatsapp", "notes", "second brain"; record Zenod's position; adjust copy | a table of positions per directory in this folder, first run after R3–R5 | no |
| E10-R8 | **Follow-through**: GitHub/VS Code inclusion (re-check 30 days after R3), PulseMCP (auto when it reopens), Cursor Marketplace review | each either listed or recorded as "not in our hands" with date | no |

EPIC-11 (WebMCP on zenod.dev) stays the separate child it is; R2's connect page is a natural extra WebMCP target but that is EPIC-11's call.

## 5. Proposed spine text (for the steward; this run did not edit the spine)

**Goal** (Jordi's, unchanged): Zenod is listed in Anthropic's MCP directory, Google's, and every other MCP list worth being in, and is maximally findable there (MCP SEO: names, descriptions, keywords, examples). A plan first, then small child epics, one per little promotion action.

**Serves**: [EPIC-0](EPIC-0-FOUNDATION-SPINE.md): puts Zenod where people already shop for Claude and ChatGPT connectors, so a stranger can find it, connect it and become the paying user EPIC-0 is after.

**Done means**:
- [ ] E10-1 Zenod is live in the **Anthropic Connectors Directory** (Community or Verified) with its listing URL recorded, and every listed tool works there from a customer account.
- [ ] E10-2 `dev.zenod/memory` is published in the **official MCP Registry** (API search returns it) and Zenod is listed on at least **five more** directories (target: Smithery, Glama, mcp.so, MCP Market, Gemini CLI gallery, awesome-mcp-servers), each with a working link in the ledger.
- [ ] E10-3 Every listing uses the approved copy (name, one-liner, description, keywords, example prompts) and a public "connect Zenod" page at zenod.dev; the directory tool surface is the customer memory tools only, with descriptions that pass Anthropic's review criteria.
- [ ] E10-4 Findability measured: for "memory" Zenod appears on the first results page of the Anthropic directory and Smithery, and for "whatsapp memory" in the top 3 of every directory with full-text search; positions recorded with date.
- [ ] E10-5 The **ChatGPT directory** submission is approved, or its blocker is recorded with OpenAI's reason.

**Non-Goals**: paid placement (MCP Market's $29 tier, sponsored slots); Google partnership or business-development deals (Spark named partners, Le Chat curated directory); a local/stdio or npm package of Zenod; Docker MCP Catalog; WebMCP on zenod.dev (that is EPIC-11); changing price or plans; contacting directory staff beyond the submission forms.

**P1 row update**: `| P1 | Research worker | Sonnet subagent (run_a84842a7) | Plan: survey ... | done | none | main (docs/epic10/P1-mcp-directory-plan.md) | main | plan + validated server.json, 23 sources, 2026-11-02 | 2026-11-02 | steward adds Done means and rows E10-R1..R8; dispatch R1 and R2 (no asks); raise E10-A1 |`

**Next action**: dispatch E10-R1 (tool surface) and E10-R2 (listing kit) in parallel worktrees; raise E10-A1 so R3/R4 can publish as soon as R2 lands.

## 6. Asks (coded; only E10-A1 blocks now)

- **E10-A1 (blocks R3, R4 now)** — May agents publish Zenod to the free, self-serve MCP directories (official MCP Registry, Smithery, Glama, mcp.so, MCP Market free queue, awesome-mcp-servers, Gemini CLI gallery) using the copy in §3? — context: these listings need no review and no money, but each is a public post in Zenod's name — impact: Zenod becomes findable by every client that reads the registry (VS Code, PulseMCP and others pull from it) — risk: a public listing with wording you dislike; rollback: each can be edited or removed (registry versions can be marked deprecated, the others have edit/delete) — recommend: yes, with the §3 copy, because it is the cheapest reach we can get and the text only makes claims zenod.dev already makes — why Jordi: publishing in the company's name is your call.
- **E10-A2 (raise when R5 is next, after R1+R2)** — Submit Zenod to Anthropic's Connectors Directory: needs a paid Claude plan seat in Alpha9's org and your acceptance of Anthropic's Software Directory Terms and seven compliance statements on behalf of Alpha Analytics SL (~10 min in the portal; an agent pre-fills every field).
- **E10-A3 (raise when R6 is next)** — Verify Alpha Analytics SL with OpenAI (business identity verification on platform.openai.com) so Zenod can be listed in ChatGPT under the company name.

## Sources (all accessed 2026-11-02)

1. Anthropic, *Submit a connector to the directory* — https://claude.com/docs/connectors/building/submission
2. Anthropic, *Connector pre-submission checklist* (review criteria) — https://claude.com/docs/connectors/building/review-criteria
3. Anthropic, *Connector verification* — https://claude.com/docs/connectors/verification
4. MCP, *Quickstart: publish to the MCP Registry* (preview) — https://modelcontextprotocol.io/registry/quickstart
5. MCP, *Publishing remote servers* — https://modelcontextprotocol.io/registry/remote-servers
6. MCP, *Registry authentication* (GitHub, DNS, HTTP) — https://modelcontextprotocol.io/registry/authentication
7. PulseMCP, *Submit* (paused; ingests from the official registry) — https://www.pulsemcp.com/submit
8. VS Code, *Add and manage MCP servers* (`@mcp` gallery from GitHub's registry) — https://code.visualstudio.com/docs/copilot/customization/mcp-servers
9. GitHub community discussion #210489 (remote servers in github.com/mcp, unanswered, Oct 2026) — https://github.com/orgs/community/discussions/210489 ; GitHub blog — https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/
10. OpenAI, *Upload and submit your plugin* — https://developers.openai.com/plugins/deploy/submission
11. OpenAI, *Plugin guidelines* — https://developers.openai.com/apps-sdk/app-submission-guidelines
12. Smithery, *Publish* docs — https://smithery.ai/docs/build/publish
13. Glama, *What is glama.json* — https://glama.ai/blog/2025-07-08-what-is-glamajson ; Glama remote connector pages, e.g. https://glama.ai/mcp/remote-servers/com.postman/postman-mcp-server
14. awesome-mcp-servers listing rule (PR #6738 description) — https://github.com/punkpeye/awesome-mcp-servers
15. mcp.so — https://mcp.so (submit form 403 to fetcher; GitHub issues https://github.com/punkpeye/mcp.so/issues)
16. MCP Market, *Submit* — https://mcpmarket.com/submit
17. Cursor deeplinks and Marketplace (secondary) — https://aiengineerguide.com/til/cursor-mcp-deeplink/ ; https://www.adwaitx.com/cursor-marketplace-plugins/
18. Gemini CLI, *Release extensions* (updated 2026-05-08) — https://geminicli.com/docs/extensions/releasing/
19. Tallyfy, *How to get your MCP server into Google Gemini* (updated 2026-09-04, secondary) — https://tallyfy.com/how-to-list-mcp-server-google-gemini/
20. Google Cloud blog, *Developer's guide to MCP apps in Gemini* (2026-10-20, Enterprise only) — https://cloud.google.com/blog/topics/developers-practitioners/devs-guide-to-mcp-apps-in-gemini
21. Google Cloud, *Agent Registry* docs — https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry
22. Docker, *MCP Catalog* — https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/
23. Mistral, *MCP connectors in Le Chat* — https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors

Live checks (2026-11-02): `cloud.zenod.dev` OAuth metadata and 401 challenge; `zenod.dev/legal/{privacy,terms}.html`; registry API searches (`memory`, `whatsapp`, `obsidian`, `second brain`, `zenod`); `mcp-publisher validate docs/epic10/server.json` → valid.
