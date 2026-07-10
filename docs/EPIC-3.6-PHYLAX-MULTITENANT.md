# EPIC 3.6 · Phylax — one container per phone number, users are whitelist rows

Status: ON HOLD — do not dispatch. Will be re-specified AFTER Zenod ships (`docs/EPIC-Z-NIGHT-SPRINT.md`). Note: transcription moves INTO Phylax when this respawns (Jordi 2026-07-11). Chassis references herein are stale.
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
| Epic worker | unassigned | This spine | Delivery lead and MANAGER (parent D8): mint issues, dispatch ticket workers and testers, run fix loops, iterate until Definition of Done or a named Human Gate; never stop for questions the spine or code answers. | Spine, issues, integration state current. |
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

Make Phylax a full MCP unit, dual-faced (parent D14). It is the channels guy: ALL WhatsApp (Baileys) and Telegram config, credentials, and settings live here — not in the Ring. Face one, MCP SERVER: standard `/mcp` (SEAM-conformant) with tools like `send_message`, `notify`, `channel_status`; any agent holding a token can post notifications through it — independently sellable as a channels/notification MCP. Face two, MCP CLIENT: inbound messages are forwarded as a standard MCP tool call to ONE configured downstream MCP URL+token (default: the Ring, which maps sender→tenant and routes); no bespoke protocol on the wire. TRANSCRIPTION AT THE EDGE (parent D18): Phylax transcribes media before forwarding — the payload carries `{ sender, text_transcript, artifact_ref, transcription_usage }` so every downstream gets binary + transcript ready-made; if the STT provider fails, forward immediately with `transcription_failed` (never queue the conversation); transcription cost rides the payload for downstream tenant attribution. Doctrine amended: zero ROUTING intelligence, but channel-media expertise is in-scope — Phylax holds a transcription key and is no longer `vaultless`. It serves its OWN tenant-facing UI (number reveal, Telegram bot setup, per-user channel settings, pairing). Deployment truth unchanged: one container per **phone number operated** (initially one, total — Baileys is flaky and ToS-exposed, breakage must never touch the ring); onboarding a user is a whitelist/pairing row, never a deploy.

## Definition Of Done

- [ ] Provisioning path creates NO Phylax container per customer; buying any product only writes whitelist/pairing rows consumed via the ring/control plane.
- [ ] MCP SERVER face live and SEAM-conformant: `/mcp` with `send_message`/`notify`/`channel_status` tools returning receipts (delivery id/status — never a silent ack); any tokened agent can post a notification through WhatsApp or Telegram.
- [ ] MCP CLIENT face live: inbound messages forwarded as standard MCP tool calls (sender-tagged, zero intelligence) to the ONE configured downstream URL+token (default: the Ring, whose pairing table maps sender→tenant); downstream configurable via UI/API; three-sender E2E per the Autonomous Validation Protocol below.
- [ ] Phylax's own UI live per the UI Surface section: number reveal (whitelisted users only), Telegram bot setup/binding, per-user channel settings, downstream wiring panel; operator `/admin` control-plane-token-guarded.
- [ ] Phylax config (whitelist, pairing) is runtime-updatable — API or watched config — with zero container restarts on user add/remove.
- [ ] `/healthz` + one watchdog check; Baileys session state on its own `/data` volume; documented session-recovery runbook.
- [ ] Contract note added to SEAM-SPEC vNext: channel units are per-resource (phone number); dual-faced (MCP server + MCP client to one configured downstream); users are whitelist/pairing rows.
- [ ] Second-number playbook documented: standing up phylax-2 for a future dedicated/BSP number is compose + volume + pairing, nothing else.

## Non-Goals

- Making Phylax multi-phone-number in one container (one container per number stands; senders/users are rows).
- Putting any routing intelligence in Phylax (zero-intelligence forwarder by design; brains live downstream).
- BSP migration or WhatsApp Business API adoption (future option the isolation already protects).
- Telegram feature expansion.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: Phase 2 (parent D6); P-1/P-3 may start anytime (no chassis dependency), P-2/P-4 after the pilot gate.
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
| 1 | `docs/final-container-map-deck.html` | CANONICAL target picture (parent D11): the phylax box — gateway serving channel-info DATA (number, Telegram bot, delivery status) to the Ring's UI. | Always |
| 2 | `packages/server/src/agent.ts` | `PHYLAX_AGENT` (`notifier: true, vaultless: true`). | Worker |
| 3 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Isolation rationale to preserve verbatim. | Always |
| 4 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Where sender→tenant mapping lives. | Worker |

## Architecture And Context

Phylax runs from the shared Node image with `AGENT=phylax`, Baileys 7.x for WhatsApp, currently provisioned via the Console push flow (`ZENOD_AWAIT_PROVISION`). The correction is conceptual more than code: the unit key is the phone number (a physical resource), not a customer. Whitelist/pairing must move from provision-time env/config into runtime-updatable state so user onboarding never touches the container. The `ZENOD_AWAIT_PROVISION` dependency disappears with 3.5/E-MT-7; Phylax config updates ride the same control-plane token mechanism as `/api/tenants` but write gateway config, not tenants.

Ticket sketch: P-1 delete per-user provisioning assumptions; P-2 runtime whitelist/pairing API + three-sender verification with ring; P-3 health/watchdog/session-recovery runbook; P-4 SEAM-SPEC gateway-unit note + second-number playbook.

### UI Surface (Phylax owns its channel UI — parent D14 supersedes the earlier "data only" framing)

Phylax serves its OWN tenant/user-facing UI from its container (chassis shell conventions), covering everything channel:

- **Your channels** — the "message this number" reveal (the WhatsApp number is NOT public; shown only to whitelisted/paired users), WhatsApp pairing status, Telegram bot identity + setup/binding flow.
- **Settings** — per-user channel settings: active channels, notification preferences, quiet hours.
- **Downstream** — which MCP this Phylax forwards inbound messages to (URL + token; default: the Ring) and delivery/forwarding status. This is the "wire me to any agent" panel that makes Phylax standalone-sellable.
- **Operator `/admin`** (control-plane token): Baileys session health (connected/QR-needed/degraded), whitelist view, throughput counters, re-pair/QR session recovery.

The Ring renders NO channel UI (Epic 3.4 updated accordingly); it just holds a Phylax token in its wallet like any other unit.

Port, don't rebuild (D7): Phylax already owns its pairing/QR screen (session state on its volume — see `units/ring/SEAM-SURFACE.md`), and the console already has `whatsapp-connect.tsx`/`telegram-connect.tsx` + `/api/phylax/*`, `/api/whatsapp/*` routes. The `/admin` page is those existing pieces gathered behind the control-plane token — no new design. The user-facing channel connect stays in the Ring/console ConnectionsTab as it is today.

If you're looking for "the Phylax UI for users" — that's the Ring's pairing panel by design. Record this boundary in SEAM-SPEC vNext (P-4).

### Container And Deploy

- One container PER PHONE NUMBER operated (today: exactly one), from the shared image with `AGENT=phylax`, own `VOLUME /data` for Baileys session state, `restart: unless-stopped`, `/healthz`.
- NOT exposed on a public hostname; private network only; the ring consumes its sender-tagged mailbox.
- One Dokploy application per number. Customer purchases NEVER create/modify Phylax containers — only whitelist/pairing rows via the runtime config API.

### Autonomous Validation Protocol (three-sender E2E with the ring)

The epic worker validates WITHOUT human help against local phylax + ring containers (WhatsApp side simulated via the mailbox seam or a Baileys test harness; the live number is a human-gated surface):

1. Boot phylax + ring fresh; provision ring tenants T1, T2, T3; pair three sender identities S1→T1, S2→T2, S3→T3 via the runtime pairing API (zero container restarts — assert uptime unchanged).
2. Inject messages from S1, S2, S3 into the mailbox seam; assert each reaches ONLY its tenant's ring context (browser-check each tenant's ring UI shows only its own conversation).
3. Add a fourth sender S4 unpaired: assert whitelist behavior (rejected or held per config) and that adding S4 at runtime requires no restart.
4. Negative: S1's messages must never appear in T2/T3 contexts; operator `/admin` page must require `CONTROL_PLANE_TOKEN`; no tenant token grants Phylax access.
5. Session recovery drill: kill and restart the container; assert Baileys session state survives on the volume per the P-3 runbook.
6. Record commands, screenshots, uptime proofs in Validation Evidence with exact commit.

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
