# EPIC 3.4 · Ring Multi-Tenant — the door on the chassis

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.4-RING-MULTITENANT.md`
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
| Planner | Epic 3.0 planner | Ring migration scope | Shape acceptance and tickets until an epic worker is bound. | Executable ledger. |
| Epic worker | unassigned | This spine | Delivery lead: put Ring core on the chassis. | Spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, risk. |

## Write Scope

Bound spine: `docs/EPIC-3.4-RING-MULTITENANT.md`
Active steward: unassigned (Epic 3.0 planner until epic worker bound)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — parent.
- `docs/EPIC-3.1-MCP-CHASSIS.md` — dependency.
- `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` — channel gateway sibling.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` — Ring product definition.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Ring multi-tenant migration intent, acceptance, decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent 3.0 spine | Replatform direction and sequencing |

## Mission

Run the Ring — the door/router that authenticates humans and routes them to their units — as one multi-tenant chassis container. A tenant's ring state (pairing, session, unit wiring: which agent→unit tokens this user's ring holds) is tenant-keyed rows. Prerequisite honesty: `AGENT=ring` currently falls back to the Zenod agent definition (`ring` is absent from the `AGENTS` map); the real ring-core behavior must land or be extracted first. This epic is deliberately last in the migration order.

## Definition Of Done

- [ ] A real `ring` unit definition exists (no silent fallback to Zenod) and boots via `createUnit`.
- [ ] User→ring auth plane (Law 6a: WhatsApp pairing / web login) works per tenant in one container.
- [ ] Agent→unit token wallet per tenant: each ring tenant holds tokens only for the units that tenant enabled; wallet rows tenant-keyed in chassis vault.
- [ ] Routing verified: tenant A's ring reaches tenant A's Zenod/Callisthenes tenants only (two-tenant smoke test extended to routing).
- [ ] Ring settings UI panels (channel pairing, unit wiring) tenant-scoped in the unit container.
- [ ] Self-host parity: single-tenant ring with env token, UI included.

## Non-Goals

- Council/Mentor brain behavior (separate unit/scope).
- Phylax/Baileys itself (Epic 3.6); the ring only consumes its mailbox.
- Suite dashboards.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: none until 3.1/3.2/3.3 land and the real ring-core is defined; planner revisits then.
Blockers: `ring` agent not yet a real definition; depends on Epic 3.1.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Ticketed backlog once ring-core exists. | Dispatched or named blocker. |
| Epic worker | Ring on chassis per Definition of Done. | Ready for human test or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked. |
| Tester | Prove per-tenant routing isolation. | Pass, evidenced failure, or planner decision. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-3.1-MCP-CHASSIS.md` | The scaffold. | Always |
| 2 | `packages/server/src/agent.ts` | Where `ring` must become a real definition. | Worker |
| 3 | `units/ring/docker-compose.ring.yml` | Current staged ring-core compose. | Worker |
| 4 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Ring product definition and auth planes. | Always |

## Architecture And Context

The ring is where multi-tenancy is most visible: it holds the human session and the per-tenant wallet of agent→unit bearer tokens (Law 6 plane c). Under the chassis, "one ring per user" becomes "one ring container, tenant-keyed wallets." The suite composition seam (3.0) reuses exactly this wallet mechanism: Herald is a machine tenant with its own wallet. Inbound channel traffic arrives from Phylax (one container per phone number, 3.6) tagged with the sender; the ring maps sender→tenant via its pairing table.

Ticket sketch (to be firmed when ring-core lands): R-MT-1 real ring agent definition; R-MT-2 tenant-keyed pairing + session; R-MT-3 tenant wallet in vault; R-MT-4 routing smoke test; R-MT-5 UI panels; R-MT-6 self-host parity.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | Ring migrates last. | Depends on chassis, migrated units to route to, and a real ring-core definition. | parent 3.0 sequencing |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | Epic 3.0 planner | Confirm ring-core scope and mint R-MT tickets | draft | 3.1, 3.2, 3.3 done | - | `f1edc8c` | Ticket sketch confirmed against real ring-core. | - | 2026-07-10 00:19 CEST | Revisit after 3.3. |

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
| Ring-core scope | Jordi | Before R-MT tickets are minted | Approve what the deterministic ring-core actually is | Chassis-side wallet design |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- Revisit after 3.3 proof; firm the R-MT ticket sketch.

## Worker Queue

- None until dispatch.

## Tester Queue

- None until dispatch.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.4-RING-MULTITENANT.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Spine drafted

Context: Child of Epic 3.0. Thin by design: ring-core is not yet a real agent definition; this spine records the target shape and parks execution.
Next: revisit after 3.1–3.3.
Risks: building ring tenancy before ring behavior exists would be speculation.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`

## Open Questions

- Is Council/Mentor inside the ring container or a separate unit tenant? Owner: Jordi. Needed by: R-MT ticket minting.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Note `AGENT=ring` fallback-to-Zenod gap as a tracked defect of the current staging. | code survey | Epic 2.5 steward | proposed |

## Appendix

- `units/ring/docker-compose.ring.yml` comment: ring-core "boots the deterministic core, NOT a BrainEngine."
