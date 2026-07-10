# EPIC 3.4 · Ring Multi-Tenant — the door on the chassis

Status: ON HOLD — do not dispatch. Will be re-specified AFTER Zenod ships (`docs/EPIC-Z-NIGHT-SPRINT.md`) by duplicating the working Zenod unit and adapting it. Chassis references herein are stale.
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
| Epic worker | unassigned | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
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
- [ ] User→ring auth plane (Law 6a) works per tenant in one container: web login native; channel identity arrives as sender-tagged MCP calls FROM Phylax (parent D14 — no channel code in the ring), mapped by the ring's pairing table.
- [ ] Agent→unit token wallet per tenant: each ring tenant holds tokens only for the units that tenant enabled; wallet rows tenant-keyed in chassis vault.
- [ ] Routing verified: tenant A's ring reaches tenant A's Zenod/Callisthenes tenants only (two-tenant smoke test extended to routing).
- [ ] Ring settings UI panels (My Units wallet, Routing, Usage) tenant-scoped in the unit container per the UI Surface section.
- [ ] Web chat live as a channel (parent D15): ported `ChatTab` UX; a message or binary sent via webchat traverses the identical inbound pipeline as a Phylax-forwarded message and reaches the same council brain; tool testing works.
- [ ] Skill-per-unit live (parent D16): wiring a unit into the wallet auto-imports its published skill manifest; the routing brain demonstrably uses it (route-test cites the skill); skill-settings UI renders the installed set.
- [ ] Self-host parity: single-tenant ring with env token, UI included.
- [ ] Three-tenant browser E2E (Autonomous Validation Protocol below) passes: three tenants wired to their own downstream unit tenants, messages route only to the correct tenant's units, wallet/pairing isolation proven — executed autonomously with screenshots in evidence.

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
| 1 | `docs/final-container-map-deck.html` | CANONICAL target picture (parent D11): the ring box — front door, Channels panel (number reveal, Telegram bot, per-user settings), wallet, own Stripe webhook. | Always |
| 2 | `packages/server/src/agent.ts` | Where `ring` must become a real definition. | Worker |
| 3 | `units/ring/docker-compose.ring.yml` | Current staged ring-core compose. | Worker |
| 4 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Ring product definition and auth planes. | Always |

## Architecture And Context

The ring is where multi-tenancy is most visible: it holds the human session and the per-tenant wallet of agent→unit bearer tokens (Law 6 plane c). Under the chassis, "one ring per user" becomes "one ring container, tenant-keyed wallets." The suite composition seam (3.0) reuses exactly this wallet mechanism: Herald is a machine tenant with its own wallet. Inbound channel traffic arrives from Phylax (one container per phone number, 3.6) tagged with the sender; the ring maps sender→tenant via its pairing table.

Ticket sketch (to be firmed when ring-core lands): R-MT-1 real ring agent definition; R-MT-2 tenant-keyed pairing + session; R-MT-3 tenant wallet in vault; R-MT-4 routing E2E; R-MT-5 UI panels; R-MT-6 self-host parity + three-tenant browser E2E.

### UI Surface (PORT the existing Ring panels from `apps/web` — D7; CHANNELS ARE NOT HERE — parent D14)

The Ring is pure aggregation + intelligence: a guy authenticated to all the other guys. Its UI has NO channel settings — WhatsApp/Telegram config, number reveal, pairing, and per-user channel settings all live in Phylax's own UI (Epic 3.6). The Ring's UI already exists inside the `apps/web` console: `ring-control-surface.tsx` (router control: routes, spend, activity, misroute counters) backed by `/api/ring/status`, `PUT /api/ring/config`, `/api/ring/route-test`. Port onto the chassis shell and tenant-scope; do not redesign:

- **My Units (wallet)** — THE product panel: which units this tenant's ring holds agent→unit tokens for (Zenod, Callisthenes, Epaminon, **Phylax — a unit like any other**): connection status, add/remove by MCP URL+token (or auto-wired at purchase), token health. Today's peer/team surface (`peer-agents.tsx`, `/api/peers`, `/api/team/*`) generalized, backed by the chassis vault.
- **Routing** — existing ring control surface: chief-of-staff (Council/Mentor) selection, per-source routing rules (inbound Phylax calls arrive sender-tagged; the ring maps sender→tenant and routes with its intelligence).
- **Usage** — existing CostsTab pattern, scoped to routed messages and per-unit call counts.
- **Web chat (parent D15)** — the ported Council console chat (`ChatTab.tsx`: streaming, markdown, tool testing), unchanged UX. Architecturally it is A CHANNEL: webchat messages and binaries (files, images, audio) enter the SAME inbound pipeline as Phylax's WhatsApp/Telegram calls, sender-tagged with the session's tenant — one entry path into the council brain. You chat with your council here and test tools, exactly like today's console.
- **Skills (parent D16)** — one skill per unit in the wallet: what that guy does, when to route to him, his etiquette. Auto-imported from the unit's published skill manifest when wired (units self-describe); rendered/edited via the chassis skill-settings component. The routing brain consumes these skills.

A tenant sees only their wallet, routing, usage. The wallet panel is also the seam suites reuse (a machine tenant's wallet is configured by the suite's UI instead of a human). Inbound from channels: Phylax calls the Ring's MCP (standard tool call, sender-tagged) — the ring needs no channel code at all, only a pairing table mapping sender→tenant.

### Container And Deploy

- One image (ring on chassis), one container, port 8080, hostname `ring.zenod.dev`, `VOLUME /data` (tenant-keyed pairing/session/wallet rows; wallet secrets in chassis vault).
- One Dokploy application. Phylax is a SEPARATE container (per phone number, Epic 3.6) on the same private network; the ring consumes its sender-tagged mailbox.
- Client URL: `https://ring.zenod.dev/mcp/<token>` for agent access; humans use the UI.

### Autonomous Validation Protocol (three-tenant browser E2E)

The epic worker validates WITHOUT human help, via browser automation, against local ring + stub/real unit containers:

1. Boot ring fresh + two downstream units (chassis demo units are fine as stand-ins); provision T1, T2, T3 on the ring AND matching tenants on each downstream unit.
2. Per tenant: browser-login to ring UI; wire the wallet to that tenant's downstream tokens via the My Units panel.
3. Per tenant: send a message through the ring (web-chat channel is sufficient; WhatsApp path may be simulated by injecting into the Phylax mailbox seam with a sender mapped to that tenant); assert it routes to THAT tenant's downstream unit only (plant per-tenant marker data downstream and verify retrieval).
4. Negative: T1's session cannot view/edit T2's wallet or pairings; a sender paired to T1 must never reach T2's units; T1's wallet tokens must never appear in T2's requests (assert downstream ledger attribution).
5. GOLDEN PATH (parent D17 as amended by D18): inject an .ogg voice note via the Phylax seam (arrives pre-transcribed: `{ sender, transcript, artifact_ref, usage }`) AND drop the same file in webchat (ring-side transcription via the shared module); assert both converge on the identical pipeline — brain acts on text immediately, files via Zenod ingest passing transcript + artifact_ref (receipt must show `transcription: provided`, zero STT calls in Zenod), ack dispatched via Phylax `notify` with the stated plan, receipt drives at least one follow-up call, transcription cost booked to the correct tenant, final reply carries the receipt trail with `origin_ticket_id` intact.
6. Self-host parity: single-tenant ring from env token; pairing + wallet + routing work identically.
6. Record commands, screenshots, downstream ledger proofs in Validation Evidence with exact commit.

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
