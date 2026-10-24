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
Phase: milestone A ([ZAL](EPIC-ZENOD-ALPHA-LAUNCH.md)) revived 2026-10-24, steps A0–A5 defined, none started. Every other spine in this repo is closed ([TIDY-2026-10-24](TIDY-2026-10-24.md)).
Last attempted: agent_team EPIC-16 tree cleanse, 2026-10-24 (Jordi go, deck slide 5): root rewrite + five verdicts (#1428), AGENTS.md routes to open work only (#1429), 107 open rows in 22 closed epics swept to `superseded` and ZDU/ZMR status lines fixed (#1430). `tree_audit.py`: 0 finished epics with open rows, 0 status problems; residual: 58 non-standard row words in closed epics (history), 25 epics over 150 lines.
Production: `https://cloud.zenod.dev/api/health` reported `687f259` (= `main` HEAD) on 2026-10-24; the Publish image `deploy` job fails on `main` since 2026-10-24 (Dokploy API 404), owned by ZAL A0. Signup and paid checkout opened 2026-09-16 on `83c2752`; live billing never performed.
Waiting on: nobody at the root. Human gates live in ZAL: A1 voice test, A5 Stripe verification + live €9. The per-plan allowance figure and turning on blocking at the cap (D30) move with A2.
Next action: ZAL A0, re-check prod end to end (signup → WhatsApp → console), read-only, and fix the push-to-main deploy.
Verified at: 2026-10-24 (health endpoint, `spines.py --active`).

## Spine Map

| Spine ID | Relationship | Spine | Contributes | Status | Health / Blocker | Next Action |
|---|---|---|---|---|---|---|
| ZAL | child | [Zenod Alpha Launch](EPIC-ZENOD-ALPHA-LAUNCH.md) | Milestone A "Zenod is production-ready": a real user signs up, pays or gets a free pass, uses Zenod over WhatsApp, metered and capped (serves agent_team EPIC-12). | active | Revived 2026-10-24 under agent_team EPIC-12; A0 next; EPIC-6 health page sits under it. | ZAL A0 |
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

## Operating Learnings

EpicSpine skill: 2026.10.24.10 @ 1ce5487 (vendored copy re-synced in #1430), checked 2026-10-24

Always:
- L-1 | any task beyond answering a question | the delivery manager dispatches a worker and never implements itself | Jordi's chosen operating model | confirmed 2026-10-10
- L-2 | dispatching a worker | use the Claude Code `Agent` tool with `model: sonnet`, in the background, one task per worktree `../wt-<task>` | same subscription, no T3/OpenCode hop | confirmed 2026-10-10
- L-3 | integrating worker output | verify diff and checks yourself, then merge via your own PR once `ci` is green; never admin-push `main` | protected main requires `ci` | confirmed 2026-10-10
- L-4 | any push to `main` | it publishes GHCR images; once #964 is merged and its secrets exist (D27) it also auto-deploys Zenod production only, never Phylax or independent agents; before then, deploy stays a human gate | publish.yml pushes GHCR images; D27 | confirmed 2026-10-10, amended 2026-10-10

Scoped index:
- none yet
