# EPIC 3.6 · Phylax — one container per phone number, users are whitelist rows

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.6-PHYLAX-MULTITENANT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: unassigned (planner draft by Epic 3.0 planner)
Steward since: 2026-07-10 00:19 CEST
Last reconciled commit: `f1edc8c`
Planner: Epic 3.0 planner
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Root scope | Reads for rollups. | Root state reconciled. |
| Planner | Epic 3.0 planner | Phylax scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead: align Phylax to the amended Law 7. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.6-PHYLAX-MULTITENANT.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.4-RING-MULTITENANT.md` — consumer of the mailbox.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` — Phylax product definition.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Phylax alignment intent, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Correct Phylax's tenancy framing: it was never per-user. One Phylax container per **phone number operated** (initially: one, total), fronting WhatsApp via Baileys and Telegram. Many humans talk to that one number; onboarding a user is a whitelist/pairing row, never a deploy. Phylax stays a deliberately isolated, zero-intelligence gateway (Baileys is flaky and ToS-exposed — breakage must never touch the ring), stays `vaultless`, and hands sender-tagged messages to the ring, which maps sender→tenant. Smallest epic in the family; mostly deleting per-user assumptions and pinning the contract.

## Definition Of Done

- [ ] Provisioning path creates NO Phylax container per customer; buying any product only writes whitelist/pairing rows consumed via the ring/control plane.
- [ ] Phylax hands messages to the ring with stable sender identity; ring-side pairing table maps sender→tenant (verified with two senders → two tenants on one number).
- [ ] Phylax config (whitelist, pairing) is runtime-updatable — API or watched config — with zero container restarts on user add/remove.
- [ ] `/healthz` + one watchdog check; Baileys session state on its own `/data` volume; documented session-recovery runbook.
- [ ] Contract note added to SEAM-SPEC vNext: gateway units are per-resource (phone number), not per-tenant; they carry no tenant table.
- [ ] Second-number playbook documented: standing up phylax-2 for a future dedicated/BSP number is compose + volume + pairing, nothing else.

## Non-Goals

- Making Phylax multi-tenant internally (it has no tenants; it has senders — tenancy lives in the ring).
- BSP migration or WhatsApp Business API adoption (future option the isolation already protects).
- Telegram feature expansion.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: audit current provisioning/compose for per-user Phylax assumptions; mint P-1.
Blockers: none hard; ring pairing verification (P-2 acceptance) firms up with 3.4.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed backlog. | Dispatched or named blocker. |
| Epic worker | Phylax aligned per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove zero-restart user onboarding and sender→tenant mapping. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docker-compose.phylax.yml` | Current shape and provision flow to simplify. | Always |
| 2 | `packages/server/src/agent.ts` | `PHYLAX_AGENT` (`notifier: true, vaultless: true`). | Worker |
| 3 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Isolation rationale to preserve verbatim. | Always |
| 4 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Where sender→tenant mapping lives. | Worker |

## Architecture And Context

Phylax runs from the shared Node image with `AGENT=phylax`, Baileys 7.x for WhatsApp, currently provisioned via the Console push flow (`ZENOD_AWAIT_PROVISION`). The correction is conceptual more than code: the unit key is the phone number (a physical resource), not a customer. Whitelist/pairing must move from provision-time env/config into runtime-updatable state so user onboarding never touches the container. The `ZENOD_AWAIT_PROVISION` dependency disappears with 3.5/E-MT-7; Phylax config updates ride the same control-plane token mechanism as `/api/tenants` but write gateway config, not tenants.

Ticket sketch: P-1 delete per-user provisioning assumptions; P-2 runtime whitelist/pairing API + two-sender verification with ring; P-3 health/watchdog/session-recovery runbook; P-4 SEAM-SPEC gateway-unit note + second-number playbook.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Phylax is per-phone-number, not per-user. | One number serves many humans; users are whitelist rows (Jordi, 2026-07-09 session). | parent D1/Law 7 amendment |
| 2026-07-10 | Keep container isolation and vaultless posture. | Baileys flakiness/ToS blast-radius argument is unchanged and correct. | `docs/EPIC-2.5-ATOMIC-UNITS.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | P-1 remove per-user provisioning assumptions | draft | - | - | `f1edc8c` | Customer purchase touches no Phylax container. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | P-2 runtime whitelist/pairing, two-sender test | draft | P-1 | - | `f1edc8c` | Add/remove user with zero restarts; senders map to correct tenants. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | P-3 health, watchdog, session-recovery runbook | draft | - | - | `f1edc8c` | Baileys session loss recoverable per runbook. | - | 2026-07-10 00:19 CEST | Mint issue. |
| draft | Ticket worker | unassigned | P-4 SEAM-SPEC gateway note + second-number playbook | draft | 3.1 C-8 | - | `f1edc8c` | Contract and playbook merged. | - | 2026-07-10 00:19 CEST | Mint issue. |

## Branch And Integration

- Default integration branch: `main`
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees for filesystem isolation.
- Dispatch record: branch, worktree if used, base commit, integration target, owner, and latest verified time.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available in a named test surface; acceptance validation in progress.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and spine reconciled.
- Integration rule: merge small reviewed work after required checks pass so new agents bootstrap from the freshest validated base.
- If not merged, the issue ledger must show branch/PR, blocker, owner, latest commit, and next action.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| WhatsApp number operations | Jordi | Any action risking the live Baileys session | Approve session-touching change window | Everything not touching the live session |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Mint P-1..P-4.
- Confirm with 3.4 planner where the pairing table's authoritative copy lives (ring).

## Worker Queue

- None until dispatch.

## Tester Queue

- Prepare two sender numbers for P-2.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.6-PHYLAX-MULTITENANT.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0. Jordi corrected the per-user framing himself (2026-07-09): one number, many people, whitelist rows. This spine records that and strips per-user machinery.
Next: mint P-1.
Risks: touching the live Baileys session during changes; keep P-3 runbook ahead of any session-affecting work.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Does the whitelist live in Phylax or does Phylax forward everything and the ring filters? Owner: Epic worker (with 3.4). Needed by: P-2.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Record Phylax as per-phone-number gateway class in the amended Law 7. | this spine | Epic 2.5 steward | proposed |

## Appendix

- Phylax has no `units/` folder today; it exists as `docker-compose.phylax.yml` + `AGENT=phylax`. Creating `units/phylax/` docs can ride P-4.
