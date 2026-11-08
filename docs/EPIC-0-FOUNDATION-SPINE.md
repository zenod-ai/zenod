# EPIC-0: Zenod — a paying user on WhatsApp

Status: active
Created: 2026-07-09
Updated: 2026-10-24
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-0-FOUNDATION-SPINE.md`
Spine ID: Foundation
Spine Type: root
Root spine: self
Parent spine: none
Serves (cross-repo): [agent_team EPIC-12 · Zenod live, heard, sold](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md)
Integration branch: `main`
Active spine steward: Zenod delivery manager (Jordi + current bound agent task)
History: [Foundation history to 2026-10-24, verbatim](archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md) (July EpicSpine-adoption goal and DoD, role bindings, authority, bootstrap map, architecture, D1–D21, human gates, queues, validation evidence, handoff journal)
Project name: [Zenod, the memory app](https://zenod.dev/)

## Goal

A paying user uses Zenod over WhatsApp: signs up, pays or gets a free pass, uses it daily, metered and capped.

## Serves

This repository is Zenod; its root goal is the zenod side of [agent_team EPIC-12](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-12-zenod-live-heard-sold.md) ("Zenod live, heard, sold"), milestone A "Zenod is production-ready". Everything else in this repo either feeds that or is closed below.

## Done means

The steps are [Zenod Alpha Launch](EPIC-ZENOD-ALPHA-LAUNCH.md) A0–A5; these are the outcomes they add up to.

- [ ] DOD-1 A new user signs up on production and uses Zenod over WhatsApp end to end on today's infra (ZAL A0, A1).
- [ ] DOD-2 Every user's usage is metered and capped per plan; a free-pass code grants a capped allowance that stops at the cap (ZAL A2, A3).
- [ ] DOD-3 One live €9 payment completes end to end on Stripe live (ZAL A5).
- [ ] DOD-4 Ten test users use Zenod daily on free passes (ZAL A4).

## Non-Goals

- Rewriting child epic docs directly from this spine.
- Owning public positioning copy; that remains `docs/EPIC-0-STORY.md`.
- Replacing GitHub issues; issues remain the execution board.
- Defining every future agent role in full detail.
- Independent agents (Epaminon, Callisthenes, Ring, Herald, Outbound, x-mcp): outside this repo's deployment scope (AGENTS.md boundary, 2026-09-07); their spines here are closed.

## Current State

Status: active
Phase: Zenod is ready for its first five real testers apart from a dress rehearsal that waits on one sign-in from Jordi; the memory tree epic is in review. One line per child (detail stays in each child):
- [ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md) milestone A (active): production up; the launch work runs in EPIC-7 (testers) and EPIC-6 (health page).
- [EPIC-7](EPIC-7-REAL-USER-TEST.md) real-user test (active): T0–T6 live, keys rotated, secret guard in place; T7 rehearsal waits on one Google sign-in (E7-A15); leaked third-party keys roll from one page (E7-A14).
- [EPIC-6](EPIC-6-HEALTH-DASHBOARD.md) health page: S1 inventory in review since 2026-10-25; S2–S6 wait for Jordi to accept S1 and stamp S2/S3.
- [EPIC-9](EPIC-9-MEMORY-AS-A-TREE.md) memory as a tree (review): all three Done means met — Zenod finds Jordi's topics itself, he recognises the tree, search and ask_brain find items with their place; unasked chat steering was removed and chat replies are as before (L-6, L-7); Outcome written, awaiting Jordi's verdict.
- [EPIC-8](EPIC-8-WEB3-VENICE-RESEARCH.md) Web3/Venice: brainstorm only, draft until Jordi stamps it ready (E8-A3).
- [EPIC-10](zenod-in-every-mcp-directory-listing-spr.md) MCP directory listings (active): plan done, customer tool list and zenod.dev/connect kit live; publishing to free directories waits on E10-A1 (snoozed to 2026-11-05).
- [EPIC-11](EPIC-11-WEBMCP-ON-ZENOD-DEV.md) WebMCP on zenod.dev (active, own Delivery Manager): tools shipped; trial token waits on the same sign-in (E7-A15).
Last attempted: 2026-11-06 repo cleanup (D35): only zenod and zenod-social stay active, the other three Zenod repos are archived and marked DEPRECATED. Before: 2026-11-03 roll-up from children (above); 2026-11-02 roll-up of EPIC-7 and EPIC-9 work
Result: Zenod runs in production and a new tester could sign up, get a free pass and be capped, but nobody outside the team has used it yet. Live `cloud.zenod.dev/api/health` ok on `5aa4fe4` (2026-11-03); live billing never performed.
Waiting on: Jordi, most urgent first: E7-A15 sign in operations@alpha9.io once in the agents' browser (~1 min; unblocks T7, EPIC-11 and EPIC-10 R1); E7-A14 follow the one key page (~15–20 min); EPIC-9 verdict on its Outcome
Monitoring: E12-S1 worker run_14791928 (merged #1508, finishing verification and card) until done, next check 2026-11-08T05:48:33Z · next check 2026-11-08T05:48:33.000Z
Next action: once Jordi signs in (E7-A15), the agents run the T7 dress rehearsal, then T8 go/no-go and the five tester invites
Verified at: 2026-11-03 (child Current States read from main; live health ok, sha 5aa4fe4)

## Spine Map

| Spine ID | Relationship | Spine | Contributes | Status | Health / Blocker | Next Action |
|---|---|---|---|---|---|---|
| ZAL | child | [Zenod Alpha Launch](EPIC-ZENOD-ALPHA-LAUNCH.md) | Milestone A "Zenod is production-ready": a real user signs up, pays or gets a free pass, uses Zenod over WhatsApp, metered and capped (serves agent_team EPIC-12). | active | A0 done 2026-10-25; launch work runs in EPIC-7 (real-user test, T7 waits on E7-A11) and EPIC-6 (health page). | EPIC-7 T7 |
| EPIC-9 | child | [Memory as a tree](EPIC-9-MEMORY-AS-A-TREE.md) | Zenod files memory as a tree and answers with lineage. | active | Built and live; waits on Jordi's look (E9-A4). | E9-A4, then close E9-2 |
| EPIC-8 | child | [Web3 / Venice research](EPIC-8-WEB3-VENICE-RESEARCH.md) | Private-inference angle for Zenod (research line). | draft | Waits on Jordi to stamp ready (E8-A3). | on E8-A3: T1 + T2 |
| ZMR | child | [Memory Reliability](EPIC-ZENOD-MEMORY-RELIABILITY.md) | Complete multi-idea filing and grounded recall using existing evidence pipeline. | superseded | Closed: partially accomplished; superseded by ZAL (E16-S2, 2026-10-24) | none; [Outcome](EPIC-ZENOD-MEMORY-RELIABILITY.md#outcome) |
| ZDU | child | [Deployments and upgrades](EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md) | Repeatable minimal-scope upgrades with verified running versions and explicit rollback. | done | Closed: done (E16-S2, 2026-10-24) | none; [Outcome](EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md#outcome) |
| ZLS | child | [Landing story](EPIC-ZENOD-LANDING-STORY.md) | Promote the approved Zenod story into a responsive landing-page journey, retouch slides 01–08, and add slides 09–10. | superseded | Closed: superseded by ZAL (E16-S2, 2026-10-24) | none; [Outcome](EPIC-ZENOD-LANDING-STORY.md#outcome) |
| E3-0 | child | [Chassis Replatform](EPIC-3.0-CHASSIS-REPLATFORM.md) | Replace instance-per-user hosting with one always-on multi-tenant container per unit built from one shared scaffold. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.0-CHASSIS-REPLATFORM.md#outcome) |
| E3-1 | child | [MCP Chassis](EPIC-3.1-MCP-CHASSIS.md) | Create packages/mcp-chassis, the reusable scaffold every Node unit boots from, with first-class tenancy. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.1-MCP-CHASSIS.md#outcome) |
| E3-2 | child | [Zenod Multi-Tenant](EPIC-3.2-ZENOD-MULTITENANT.md) | Run every hosted Zenod tenant from ONE container on the chassis. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.2-ZENOD-MULTITENANT.md#outcome) |
| E3-3 | child | [Callisthenes Multi-Tenant](EPIC-3.3-CALLISTHENES-MULTITENANT.md) | Make Callisthenes the first multi-tenant unit and the proof of the pattern, in Python, by contract, with no rewrite. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.3-CALLISTHENES-MULTITENANT.md#outcome) |
| E3-4 | child | [Ring Multi-Tenant](EPIC-3.4-RING-MULTITENANT.md) | Run the Ring, the door that authenticates humans and routes them to their units, as one multi-tenant chassis container. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.4-RING-MULTITENANT.md#outcome) |
| E3-6 | child | [Phylax Multi-Tenant](EPIC-3.6-PHYLAX-MULTITENANT.md) | Make Phylax a full dual-faced MCP unit that owns all WhatsApp and Telegram config, credentials and settings, not the Ring. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-3.6-PHYLAX-MULTITENANT.md#outcome) |
| RIV | child | [Ring typed intent and voice memory](EPIC-RING-INTENT-AND-VOICE-MEMORY.md) | Make Ring simple and truthful for ordinary human chat, especially WhatsApp voice notes, with one typed interpretation per turn. | superseded | Closed: spine-conform, 2026-10-22 | none; [Outcome](EPIC-RING-INTENT-AND-VOICE-MEMORY.md#outcome) |
| Z | child | [Zenod Night Sprint](EPIC-Z-NIGHT-SPRINT.md) | Ship Zenod as one self-contained container that is the entire business, so Jordi can complete the whole customer journey himself. | done | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-Z-NIGHT-SPRINT.md#outcome) |
| C | child | [Callisthenes Sprint](EPIC-C-CALLISTHENES-SPRINT.md) | Stand up Callisthenes, one mouth for all your agents, as a self-contained unit at calli.zenod.dev by duplicating the working Zenod unit. | done | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-C-CALLISTHENES-SPRINT.md#outcome) |
| R | child | [Ring Sprint](EPIC-R-RING-SPRINT.md) | Stand up the Ring, a web chat with your own Council wired to your other units, as a self-contained unit at ring.zenod.dev. | done | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-R-RING-SPRINT.md#outcome) |
| P | child | [Phylax Sprint](EPIC-P-PHYLAX-SPRINT.md) | Stand up Phylax, your agents on WhatsApp and Telegram, as a full customer unit with one channel core, integrated or standalone. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-P-PHYLAX-SPRINT.md#outcome) |
| MC | child | [Mechanical Capture](EPIC-MECHANICAL-CAPTURE.md) | Build the assistant with capture guaranteed underneath: a mechanical capture lane plus a conversational Ring assistant lane in one WhatsApp thread. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-MECHANICAL-CAPTURE.md#outcome) |
| E2-55 | child | [Phylax Move 0](EPIC-2.55-PHYLAX-MOVE-0.md) | Deliver Phylax as an independently purchasable, deployable, configurable hosted channel gateway. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-2.55-PHYLAX-MOVE-0.md#outcome) |
| E2-9 | child | [Epaminon Move 0](EPIC-2.9-EPAMINON-MOVE-0.md) | Make Epaminon a first-class cloud worker product: a standalone MCP server that dispatches an authenticated Codex/Claude-style harness to completion. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-2.9-EPAMINON-MOVE-0.md#outcome) |
| E3-5 | child | [Epaminon Multi-Tenant](EPIC-3.5-EPAMINON-MULTITENANT.md) | Split Epaminon into a multi-tenant front unit and an ephemeral sandbox per job. | superseded | Closed: superseded, no successor in this repo (E16-S2, 2026-10-24) | none; [Outcome](EPIC-3.5-EPAMINON-MULTITENANT.md#outcome) |
| E3-7 | child | [Decommission 2.x](EPIC-3.7-DECOMMISSION-2X.md) | Inventory and retire the entire Epic 2.x per-user container fleet safely and provably. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-3.7-DECOMMISSION-2X.md#outcome) |
| E4-0 | child | [Herald root spine](EPIC-4.0-HERALD.md) | Deliver Herald, a project-voice agent running a briefing-governed, human-gated, self-measuring loop over a real channel, built generically. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-4.0-HERALD.md#outcome) |
| E5 | child | [Herald Sprint](EPIC-5-HERALD-SPRINT.md) | Stand up Herald as the next self-contained unit at herald.zenod.dev by duplicating the shipped Ring and adding the loop. | done | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-5-HERALD-SPRINT.md#outcome) |
| RCIT | child | [Ring-Callisthenes integration tests](EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md) | Prove Ring connects to Callisthenes as an ordinary MCP server and never claims a read or mutation succeeded without same-turn evidence. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md#outcome) |
| WJ | child | [WhatsApp-Council integration tests](EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md) | Prove four ordinary WhatsApp journeys end to end through Phylax and Ring, each success backed by the owning unit receipt. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md#outcome) |
| GDV | child | [Google identity and Drive-only vaults](EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md) | Let a person with no GitHub account sign in with Google, subscribe and use the full Zenod memory loop on a user-owned Google Drive vault. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md#outcome) |
| M0 | child | [M0 Plan self-hosted Zenod](M0-PLAN.md) | Ship self-hosted Zenod: one Docker container on Dokploy, used daily against a real vault. | superseded | Closed: the E12-S2 tidy, 2026-10-24 | none; [Outcome](M0-PLAN.md#outcome) |
| web3-venice-angle-research-line | child | [EPIC-8: Web3 / Venice angle — research line](EPIC-8-WEB3-VENICE-RESEARCH.md) | none | draft | none | fill Goal, Serves and Done means |
| memory-as-a-tree-audit-how-zenod-structures-memory-working-vs-long-term | child | [EPIC-9: Memory as a tree: audit how Zenod structures memory, working vs long-term](EPIC-9-MEMORY-AS-A-TREE.md) | none | draft | none | fill Goal, Serves and Done means |
| zenod-in-every-mcp-directory-listing-sprint-and-mcp-seo | child | [EPIC-10: Zenod in every MCP directory: listing sprint and MCP SEO](zenod-in-every-mcp-directory-listing-spr.md) | none | draft | none | fill Goal, Serves and Done means |
| zenod-app-chat-first-memory-graph-retrieval-that-lights-up | child | [EPIC-12: Zenod app: chat first, memory graph, retrieval that lights up](zenod-app-chat-first-memory-graph-retrie.md) | none | draft | none | fill Goal, Serves and Done means |
| zenod-as-a-whatsapp-gateway-we-can-sell | child | [EPIC-13: Zenod as a WhatsApp gateway we can sell](zenod-as-a-whatsapp-gateway-we-can-sell.md) | none | draft | none | Jordi readies it (or says not now) |

Full pre-2026-10-24 rows (purpose, evidence, last rollup): [history](archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md#spine-map).

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Epic worker | Zenod delivery manager | Milestone A: Zenod is production-ready | active | - | - | `main` | ZAL Done means; root DOD-1–4 | Revived 2026-10-24 ([TIDY](TIDY-2026-10-24.md)) | 2026-10-24 | A0 |
| bootstrap | Epic worker | Epic 0 Foundation planner | Apply EpicSpine to one real child epic | done | - | - | `8658d72` | One child epic has explicit authority, stewardship, issue ledger and handoff journal. | ZMR and ZAL ran as bound spines with issue ledgers (Sept–Oct 2026) | 2026-10-24 | - |
| bootstrap | Planner | Epic 0 Foundation planner | Decide relationship between Foundation and Story Epic 0 | done | - | - | `8658d72` | `EPIC-0-STORY.md` remains story-owned, or is nested under Foundation. | 2026-07-09 decision: Foundation is the meta Epic 0; Story is a child/sibling. | 2026-07-09 | - |
| `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Planner | Epic 0 Foundation planner | Spin out Epaminon executor-unit spine | done | - | - | `8658d72` | Child spine exists with current Epaminon facts, gaps and ledger. | Spine created 2026-07-09; closed superseded 2026-10-24 | 2026-10-24 | - |
| [#1](https://github.com/AlfaBlok/epicspine-skill/issues/1) | Epic 0 worker | Epic 0 Foundation planner | Public EpicSpine authority and recovery protocol | done | - | [PR #2](https://github.com/AlfaBlok/epicspine-skill/pull/2) / `main` | `d72279f` | Public skill, templates, README, deck, and validator. | Merged 2026-07-09 | 2026-07-09 | - |

Moved to [history](archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md#issue-ledger) unowned and without evidence: "Create Foundation Epic GitHub issues", "Validate bootstrap from a cold start"; the stale EPIC P and old ZAL rows are there too.

## Decisions

Older decisions (D1–D21): [history](archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md#decisions).

| ID | Date | Outcome | Decision / Attempt | Durable Summary | Rule / Absence Rule | Evidence | Revisit When |
|---|---|---|---|---|---|---|---|
| D25 | 2026-09-17 | accepted | Verify live production via its health endpoint, not the spine's stored record. | Live production reported `22440b4` while the spine still said `620716f`; `main` `3b95025` is 4 documentation-only commits ahead, so there is no pending functional deploy. | n/a | `docs/EPIC-ZENOD-MEMORY-RELIABILITY.md`, live health `https://cloud.zenod.dev/api/health` | Revisit if live health changes or a measured memory incident justifies a new deploy. |
| D26 | 2026-10-10 | accepted | Adopt EpicSpine 2026.10.09 with a Claude-native dispatch profile: the delivery manager never implements; workers are background Claude Code `Agent` subagents on Sonnet 5.5 in their own worktree; the manager verifies and self-merges through a CI-gated PR. | Jordi's preferred way of working; same subscription, no T3/OpenCode hop; protected `main` requires the `ci` check, so a self-merged PR keeps CI without the user merging. | n/a | `AGENTS.md` EpicSpine block; `skills/epic-spine.SOURCE` @ `8c6eef8` | Revisit if Jordi changes the worker model or merge policy. |
| D27 | 2026-10-10 | accepted | Push to `main` auto-deploys the Zenod production image; no manual re-pin. | Hosted apps are pinned to immutable `ghcr.io/zenod-ai/zenod:sha-<short>` tags, so nothing advances the pin after merge (after #963, `zenod-mt` stayed on a 10-day-old image); #964 wires it up. Scope stays inside the 2026-09-07 production deployment boundary: Zenod production only (`zenod-mt`, explicit allowlist), independent agents never auto-deployed, Phylax companion only when appropriate (not rolled by #964). Rollback = re-pin the previous immutable sha. Activation needs repo secrets `DOKPLOY_API_KEY` and `DOKPLOY_API_BASE` (owner adds them). Merged code is not deployed proof; record the deployed SHA when verified. | Never auto-deploy anything outside the allowlist. | [PR #964](https://github.com/zenod-ai/zenod/pull/964); `AGENTS.md` Production deployment boundary; `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md` | Revisit at the staging/prod split (D28) or a second real user. |
| D28 | 2026-10-10 | planned | Follow-up, not started: split staging and prod. | A `staging` app auto-follows `main`; `prod` moves only on an explicit promote that re-pins prod to the sha staging runs (one-line promote script); add a healthcheck for zero-downtime swaps before real users arrive. Today there is a single user (the owner), so a few seconds of redeploy blip is accepted. | n/a | D27 | Before the first real user, or when the redeploy blip matters. |
| D29 | 2026-10-14 | accepted | Phylax usage retention: decided 2026-10-14: 7-day per-call retention, daily rollups kept forever, export to S3 = future. | Jordi gave the explicit go. `USAGE_RETENTION_DAYS=7` is set on Phylax (Dokploy `urbFsgl6eImbQ4MTIZl5N`); raw per-call rows older than 7 days are rolled into `tenant_usage_daily` and deleted in 1000-row batches (#1390). `tenant_usage_totals` and quota checks are unaffected. Long-term export (e.g. S3) is a possible future feature, not in scope. Rollback = remove the env entry and redeploy (already-pruned raw rows are not restored; their daily rollups remain). | Do not VACUUM `usage.sqlite` without Jordi's explicit go. | #1382, #1390; `docs/evidence/phylax-usage-retention-7d-2026-10-14/README.md` | None; optional future S3 export is a separate decision. |
| D30 | 2026-10-12 | accepted | Hosted Zenod uses one platform OpenRouter key (`ZENOD_PLATFORM_OPENROUTER_KEY`), like Phylax, metered per tenant. | Replaces per-tenant gateway keys. Each tenant is metered via its own `llm_usage` plus the OpenRouter `user` field set to the tenant id. A per-tenant monthly allowance (`ZENOD_TENANT_MONTHLY_ALLOWANCE_USD`) is shadow-only while unset and never blocks. With the platform key active, tenant model, provider and base URL overrides are ignored. Per-tenant key data was removed on 2026-10-14 with Jordi's explicit go (receipt `docs/evidence/legacy-managed-ai-cleanup-2026-10-14/README.md`): 9 `zenod-tenant:*` OpenRouter keys deleted, stored tenant key and `managed_ai_*` data removed by the idempotent startup migration (#1409, #1410). Rollback to stored tenant keys is no longer possible; the platform key is the only path. #1397 fixed paid web asks being queued as `waiting_for_usage` in platform mode. Rollback = remove the env entry on Dokploy app `zenod-mt` and redeploy. | Do not enable allowance blocking, or set a final allowance without Jordi's explicit go (Human Gates). | [PR #1396](https://github.com/zenod-ai/zenod/pull/1396), [PR #1397](https://github.com/zenod-ai/zenod/pull/1397); `docs/evidence/zenod-platform-openrouter-key-2026-10-12/README.md` | Jordi decides the allowance and key cleanup gates. |
| D31 | 2026-10-24 | accepted | Revive Zenod Alpha Launch as milestone A (A0–A5) under agent_team EPIC-12 and tidy the stale spines: done = E5, C, R, Z; superseded = E2-55, E2-9, E3-7, E4-0, E4-2, MC, P, RCIT, WJ, GDV, M0. | Plan approved by Jordi 2026-10-24; tidy approved ("you can tidy up for sure"); each closed spine cites its own evidence in `## Outcome`. | Unclear cases superseded, never done. | [TIDY-2026-10-24](TIDY-2026-10-24.md), [ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md) | When A0 finds a closed spine's work broken in prod. |
| D32 | 2026-10-24 | accepted | Close the last five old spines: ZMR partially accomplished → superseded by ZAL; ZDU done; ZLS superseded by ZAL; E3-5 and CF superseded, no successor in this repo. | Each carries an Outcome; boxes ticked only with evidence. | Jordi go 2026-10-24, agent_team EPIC-16 deck slide 5 | [TIDY-2026-10-24](TIDY-2026-10-24.md) | n/a |
| D33 | 2026-10-24 | accepted | Rewrite this root around "a paying user uses Zenod over WhatsApp", serving agent_team EPIC-12; July EpicSpine-adoption content moves verbatim to the history page. | The root now says what Zenod is for; process history stays one link away. | Jordi go 2026-10-24, agent_team EPIC-16 deck slide 5 | [history](archive/EPIC-0-FOUNDATION-HISTORY-2026-10.md); [agent_team EPIC-16](https://github.com/AlfaBlok/agent_team/blob/main/docs/spines/epic-16-clean-spine-trees.md) | n/a |
| D34 | 2026-10-25 | accepted | Docs main-direct; Deploy gate for code paths; deploy needs ci; required ci check removed — Jordi via agent_team thread. | Every push to `main` used to roll prod, so even a spine edit had to go through a PR, and the agent_team console could not write answers into spines (e.g. EPIC-6-A1). publish.yml now ignores `docs/**` and `*.md`, except the image-baked `docs/tool-output-schemas.v4.json` and `units/zenod/skill/**`. Its first job calls ci.yml, so a red commit is never published or rolled. AGENTS.md: `Integration policy: main-direct` + `Deploy gate:` (every path that still triggers publish). Branch protection keeps everything except the required `ci` status check. | Deploy-gate paths: self-merged PR when `ci` is green, never admin-bypass. Docs and spines: straight to `main`. | [PR #1433](https://github.com/zenod-ai/zenod/pull/1433); `AGENTS.md`; `.github/workflows/publish.yml` | If a docs-tree file starts being read by the image or the deploy, add it to the publish filter and the Deploy gate. |
| D35 | 2026-11-06 | accepted | Only `zenod-ai/zenod` and `zenod-ai/zenod-social` stay active; `zenod-ai/cloud`, `alpha-nine/zenod_memory` and `AlfaBlok/zenod-cloud-test-vault-4ptjqj` are deprecated — Jordi ("ok go", this thread). | Each got a DEPRECATED README banner and was archived on GitHub (read-only, reversible); their spines answer E0-A1 and close superseded. Local checkouts moved to `../_deprecated/`; 35 idle zenod branches parked as `archive/<name>` tags (incl. `wt/e9-5c`, PR #1483 closed by Jordi). | Never delete these repos; unarchive only on Jordi's word. New Zenod work goes in `zenod` or `zenod-social` only. | cloud `d04869f`, zenod_memory `48b6d03`, test vault `985e7ba`; `gh repo view --json isArchived` true ×3; test /tmp leaks fixed [PR #1497](https://github.com/zenod-ai/zenod/pull/1497) (live `81615a3`); 17,207 old /tmp dirs moved to `/var/lib/vps3-scratch/t3agent/tmp-quarantine-2026-11-06/` (delete after 2026-11-20) | If hosted billing needs the old Stripe/provisioner code from `cloud`. |

## Operating Learnings

EpicSpine skill: 2026.10.24.10 @ 1ce5487 (vendored copy re-synced in #1430), checked 2026-10-24

Always:
- L-1 | any task beyond answering a question | the delivery manager dispatches a worker and never implements itself | Jordi's chosen operating model | confirmed 2026-10-10
- L-2 | dispatching a worker | use the Claude Code `Agent` tool with `model: sonnet`, in the background, one task per worktree `../wt-<task>` | same subscription, no T3/OpenCode hop | confirmed 2026-10-10
- L-3 | integrating worker output | verify diff and checks yourself; paths in AGENTS.md `Deploy gate:` merge via your own PR once `ci` is green, never admin-bypass; docs, spines and other `*.md` push straight to `main` | only gated paths roll production; `main` no longer requires `ci` (D34) | confirmed 2026-10-10, amended 2026-10-25
- L-4 | any push to `main` touching the Deploy gate | publish.yml runs `ci`, then publishes GHCR images, then auto-deploys Zenod production only (D27), never Phylax or independent agents; docs-only pushes (`docs/**`, `*.md`, except `docs/tool-output-schemas.v4.json` and `units/zenod/skill/**`, which are baked into the image) publish and deploy nothing | publish.yml `paths` filter + `needs: ci`; D27, D34 | confirmed 2026-10-10, amended 2026-10-25
- L-5 | any script or command touching Dokploy, env or secrets | Dokploy only through the `dokploy` wrapper (non-secret fields only; env in via `--stdin`, never out), never the raw key (root-only) or `curl`; never print an API response body or an env listing, only a fixed word or key NAMES; the `agent-output-guard` hooks (VPS1, VPS3) redact any known secret from tool output and alert Jordi, a backstop, not a licence | Dokploy `application.*` responses carry the whole env: two secret exposures on 2026-11-01 (T3 live, T3.1); enforced by machine since EPIC-7 T3.3 | confirmed 2026-11-02, amended 2026-11-02
- L-6 | any change that affects what Zenod does or says in a chat (WhatsApp, Telegram, MCP chat) | Zenod's chat path only captures what the user sends and acknowledges it; never parse commands from chat, change replies or add new chat behaviour unless Jordi asked for exactly that in his own words — an approved design or deck does not count | Jordi 2026-11-02 (E9-A8): "I never asked for anything remotely like this… Zenod should not be confused; at most we're pinging when a voice note arrived" | confirmed 2026-11-02
- L-7 | any design, row or change that touches how Zenod relates to agent_team (the team desk, personas, epics, steering) | Zenod is a standalone memory product: it captures, files, retrieves. Its only seams to agent_team are MCP (an agent pulls a memory) and a webhook (Zenod says "new voice note landed"); the desk decides what that note means for milestones or new epics. Never build agent_team or EpicSpine machinery (steering commands, pins, keeper notes, closures, asks) into Zenod, and never develop across the seam without a loud, separate warning to Jordi and his explicit yes | Jordi 2026-11-02 (E9-A8 follow-up): "integration should be clean with clean seams… never integrate developing into the other side without huge warning" | confirmed 2026-11-02
- L-8 | any ask that needs Jordi to click, sign in or paste something | give one clickable URL he can open from his Mac's normal browser (tailnet or public) that lands exactly where he acts, plus one line of what to click; never point him at a "panel", "thread" or app view, and never assume he can see the T3 browser preview | Jordi 2026-11-02/03 (E7-A12, E7-A11, and "if you don't give me a link I CAN'T DO IT") | confirmed 2026-11-03

Scoped index:
- none yet
