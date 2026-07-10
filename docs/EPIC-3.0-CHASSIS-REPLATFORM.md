# EPIC 3.0 · Chassis Replatform — one multi-tenant container per unit, written once

Status: draft
Created: 2026-07-10
Updated: 2026-07-10
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Epic 3.0 planner (Jordi + bound agent task)
Steward since: 2026-07-10 00:19 CEST
Last reconciled commit: `f1edc8c`
Planner: Jordi + bound agent
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Foundation/root scope | Reads this spine for rollups; routes decisions. | Root state reconciled. |
| Planner | Epic 3.0 planner | Replatform scope 3.0–3.6 | Shape acceptance, sequence child epics, maintain this ledger; no implementation by default. | Executable ledger, decisions, dispatch state. |
| Epic worker | unassigned | Child epic delivery (3.1 first) | Delivery lead inside accepted child scope; steward the child spine. | Child spine, issues, integration state current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one issue branch; structured issue handoff. | PR, commit, evidence, blocker, next action. |
| Tester | unassigned | Future validation issue | Validate exact commits against acceptance. | Commit, environment, pass/fail, residual risk. |

## Write Scope

Bound spine: `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`
Active steward: Epic 3.0 planner (Jordi + bound agent task)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detail to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-0-FOUNDATION-SPINE.md` — root/meta spine.
- `docs/EPIC-3.1-MCP-CHASSIS.md` … `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` — child execution spines.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md`, `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md`, `docs/EPIC-2.5-ATOMIC-UNITS.md`, `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — superseded-in-part deployment assumptions.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Replatform intent, sequence, cross-unit acceptance, decisions |
| Child spine (3.1–3.6) | That unit's implementation state, ledger, local decisions |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent / Epic 0 spine | Project direction, spine relationships |

## Mission

Replace Law-7 instance-per-user hosting with the chassis model: every unit is one always-on multi-tenant container built from one shared scaffold (`@zenod/mcp-chassis` for Node; SEAM-SPEC vNext contract for any stack), serving all tenants' MCP endpoints AND that unit's human settings UI from the same app. A new customer is a tenant row, never a deploy. Self-hosted is the identical image with a tenant count of one, including the UI. Suites (Herald, Council) compose units as machine tenants holding agent→unit tokens — units never embed suite logic. Full architecture: `docs/MCP-CHASSIS-SPEC.md` and `docs/mcp-hosting-options-deck.html`.

## Definition Of Done

- [ ] 3.1 chassis exists: transport, tenant auth, tenants table + `/api/tenants`, tenant-scoped storage, vault, metering, settings-UI shell — extracted, tested, documented.
- [ ] 3.2–3.6 each unit runs as ONE multi-tenant container conforming to SEAM-SPEC vNext, with ≥2 tenants exercised in hosted mode and single-tenant self-host verified from the public image.
- [ ] Stripe webhook provisions via `POST /api/tenants` end to end; the Dokploy per-tenant provisioner, per-tenant DNS minting, and watchdog registration API are deleted.
- [ ] Each unit serves its settings UI from the unit container; `zenod-ai/cloud` no longer hosts per-unit settings.
- [ ] A suite-composition proof: one machine tenant provisioned into two units, configured from an external UI via agent→unit tokens.
- [ ] GOLDEN PATH E2E (D17) passes for three tenants: ogg in via Phylax (and via webchat) → Ring routes to Zenod ingest → ticket_id + transcript receipt → receipt-driven follow-up calls → ack + final reply through Phylax, with receipts, tenant isolation, and origin_ticket_id traceability verified end to end. This is the replatform's final acceptance test.
- [ ] Cross-spine updates recorded and adopted by 2.3/2.4/2.5/2.9 stewards (Law 7 amendment in 2.5).

## Non-Goals

- Building the combined/suite dashboard product (Herald UI is Epic 4-HERALD scope; here we only prove the machine-tenant seam).
- Physical repo split (RD-4 stays staged; chassis is a monorepo package).
- Kubernetes, Cloudflare Workers, or any platform move; the VPS + Dokploy (one app per unit) remains the deploy target.
- Rewriting Callisthenes to Node; it conforms by contract in Python.

## Current State

Phase: planning
Last verified: 2026-07-10 00:19 CEST
Integration target: main
Fresh base commit: `f1edc8c`
Next action: HANDOVER STATE (2026-07-10, post-pilot-incident): 3.1 is declared DONE-FOR-PILOT and QUIESCED (C-1..C-16 + C-18 merged; C-17 parked pending Jordi's Stripe credentials; API freeze pending live pilot evidence; no further merges). 3.2 executes the LIVE PILOT directive: deploy frozen head `4fb1abe` as Dokploy app `zenod-mt-pilot`, provision T1/T2/T3, run acceptance ONCE on that live deployment (targeted checks only — no full-suite re-runs, they passed on this commit), model-key steps wait for Jordi entering the OpenRouter key via the Keys tab, then deliver the human test package (URL, tokens, click script). D19 anti-stall laws (a)–(e) bind every dispatch from now on. 3.7 continues its gated lanes. Phase 2 (3.3/3.5/3.6) waits for the pilot gate + freeze.
Blockers: pilot gate = live deployment + Jordi's hand test. Remaining human inputs: OpenRouter key via UI (pilot), Stripe credentials (C-17), Epaminon spawner mechanism (Phase 2).

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep replatform coherent with the project picture. | Rollups current or human decision required. |
| Planner | Make 3.1–3.6 executable and sequenced. | Backlog ready/dispatched or named blocker. |
| Epic worker | Deliver a child epic through the issue loop. | Ready for human test, tester handoff, or blocked. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked with required input. |
| Tester | Prove pass/fail. | Acceptance passed, evidenced failure, or planner decision required. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/MCP-CHASSIS-SPEC.md` | The architecture this epic implements. | Always |
| 2 | `docs/final-container-map-deck.html` | CANONICAL target: final containers, contents, OAuth, billing (D11). | Always |
| 3 | `docs/mcp-hosting-options-deck.html` | Why option B was chosen. | Always |
| 3 | `docs/EPIC-3.1-MCP-CHASSIS.md` | The critical-path child epic. | Planner, Epic worker |
| 4 | `packages/server/src/app.ts`, `auth.ts`, `agent.ts` | The existing code the chassis is extracted from. | Worker |
| 5 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | The laws being amended. | Planner |

## Architecture And Context

The unit anatomy ("cookie cutter"), decided 2026-07-10:

- One unit = one container = one app. The same HTTP app serves `/mcp` (Streamable HTTP, stateless, bearer→tenant) and `/` (tenant-scoped settings UI: login with token, see your keys/usage/config). `packages/server` already serves both surfaces today; the chassis formalizes it.
- Tenancy: `tenant_id = lookup(sha256(bearer))`; every read/write tenant-scoped; no client-supplied tenant args. Tokened URL `/mcp/<token>` (ZD-8) preserved.
- Self-host = same image, one tenant seeded from env token, UI included. No divergence, no separate codebase.
- Suites compose via machine tenants: buying Herald provisions a tenant in each composed unit; Herald's own UI holds those agent→unit tokens (Law 6 plane c) and configures units through their APIs. Units stay suite-agnostic. One Zenod container ever.
- Billing (D10): each unit container carries its own Stripe webhook (`/api/billing/webhook`, chassis billing module) and checkout return pages; the control plane shrinks to catalog/checkout composition + claim links. OAuth (D9): the chassis OAuth kit serves both MCP-client sign-in and world-connection flows for every unit.
- Canonical target picture (D11): `docs/final-container-map-deck.html` slide 1 — containers, contents, per-unit OAuth flows, billing. All child spines point here.
- DevOps: ~6 Dokploy applications total (proxy, zenod, callisthenes, ring+phylax, epaminon-api, db). One hostname per unit. Watchdog = 5 static `/healthz` checks.
- Isolation exceptions: Epaminon per-job sandboxes (ephemeral), Phylax per phone number.
- The UI is a first-class deliverable of every unit epic, not a follow-up: each child spine carries a "UI Surface" section (the exact pages a tenant sees), a "Container And Deploy" section (image, port, hostname, volume, Dokploy app), and an "Autonomous Validation Protocol."

Standard Autonomous Validation Protocol (binding on every child epic): the epic worker proves its own done-ness with browser automation and no human in the loop — boot the unit fresh, provision THREE tenants via `POST /api/tenants`, exercise each tenant over MCP and through the browser UI, assert each tenant sees only its own data, assert cross-tenant access provably fails (planted markers, direct-URL attempts, ledger attribution), verify single-tenant self-host parity from the same image, and record commands + screenshots in the child spine's Validation Evidence with the exact commit. A child epic is not "done" until this protocol has passed autonomously.

Child spine map:

| Child | Scope | Depends on |
|---|---|---|
| 3.1 `EPIC-3.1-MCP-CHASSIS.md` | Extract chassis package + settings-UI shell + tenants/provisioning | — |
| 3.2 `EPIC-3.2-ZENOD-MULTITENANT.md` | Zenod on chassis, tenant-prefixed storage | 3.1 |
| 3.3 `EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Python conformance by contract | 3.1 (contract only) |
| 3.4 `EPIC-3.4-RING-MULTITENANT.md` | Ring on chassis when real agent lands | 3.1 |
| 3.5 `EPIC-3.5-EPAMINON-MULTITENANT.md` | Multi-tenant API + per-job sandboxes | 3.1 |
| 3.6 `EPIC-3.6-PHYLAX-MULTITENANT.md` | De-per-user Phylax; whitelist as config | 3.1 (light) |
| 3.7 `EPIC-3.7-DECOMMISSION-2X.md` | Inventory + retire all Epic 2.x per-user containers | early wins: none; per-unit retirement: that unit's migration |

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | D1: Option B — one multi-tenant container per unit on the VPS. | Container-per-user capped at ~100 users, M-redeploys, provisioner flakiness; multi-tenant is less machinery. | `docs/mcp-hosting-options-deck.html` |
| 2026-07-10 | D2: Unit container serves its own settings UI alongside `/mcp`. | Self-host keeps full product; kills the cloud-repo settings split; matches existing `packages/server` shape. | `packages/server/src/app.ts` |
| 2026-07-10 | D3: Suites compose as machine tenants with agent→unit tokens; units stay suite-agnostic. | Preserves modularity; Law 6 plane c already models it; one container per unit ever. | `docs/MCP-CHASSIS-SPEC.md` |
| 2026-07-10 | D4 (DECIDED by Jordi): SQLite per unit container on `/data`, WAL mode + busy_timeout mandatory, behind the chassis storage seam. No shared DB service now; shared Postgres remains the sanctioned fallback via the same seam if cross-tenant querying/RLS is ever wanted. | Each unit is one process, so writes serialize in-process; WAL gives concurrent reads; zero new infra; stack already runs node:sqlite. PGlite rejected (single-connection). Rule: Epaminon sandboxes never touch the DB directly — they persist via API/files. | 2026-07-10 session; `packages/core/src/state/sqlite.ts` |
| 2026-07-10 | D5: Callisthenes conforms by SEAM-SPEC contract in Python; no rewrite. | It wraps upstream xmcp; its bearer-is-tenant design is the suite-wide pattern. | Epic 2.4, `units/callisthenes/` |
| 2026-07-10 | D6: Pilot-first rollout — chassis is proven on ONE character before the rest are unleashed. Pilot = Zenod (3.2). | The chassis must be exercised by a real unit, not just the demo; Zenod's console (`apps/web`) IS the UI the chassis shell must host, so piloting Zenod does the chassis UI work once for everyone. Gate: pilot passes its three-tenant browser E2E → 3.3/3.5/3.6 dispatch in parallel. | UI survey 2026-07-10; `apps/web/src/views/Settings.tsx` |
| 2026-07-10 | D7: Port the existing UI, never rebuild it. Every unit's UI work is re-homing what exists — `apps/web` console + `/api/*` contract for Node units, `connect_page.py` for Callisthenes, Phylax's own pairing screen — with tenant-scoping as the only substantive change. | The console, setup wizard, per-unit tabs, and connect flows already exist and work; rebuilding is waste and risk. | UI survey 2026-07-10 (appendix) |
| 2026-07-10 | D9: The chassis ships an OAuth KIT so OAuth is never reinvented per unit: (a) OAuth SERVER for MCP-client sign-in (Claude.ai/Claude Code — lift existing oauthStore, `.well-known`, consent pages), (b) OAuth CLIENT framework for world connections (GitHub App, Google Drive, X PKCE, …) with per-tenant callback state binding and vault custody, (c) session auth. Units declare providers; the kit does the dance. | Four units each need multiple OAuth flows; the code exists once in `packages/server` and once in Callisthenes — extract, don't multiply. | UI survey; `packages/server/src/oauth.ts`, `githubLinks.ts` |
| 2026-07-10 | D10: Each unit container is ALSO its own payment callback service: the chassis ships a billing module (Stripe webhook receiver → verify signature → insert/suspend tenant row; checkout success/cancel return pages), enabled by env (`STRIPE_WEBHOOK_SECRET`). The cloud control plane shrinks to catalog/checkout composition and claim links; Stripe events land on each unit's own `/api/billing/webhook`. | Units stay self-sufficient sellable atoms (one unit = one product = one website = one webhook); removes the last provisioning logic from the control plane. | Jordi 2026-07-10; `docs/final-container-map-deck.html` |
| 2026-07-10 | D11: `docs/final-container-map-deck.html` slide 1 is the CANONICAL target picture (containers, contents, OAuth flows, billing). Every Epic 3.x spine references it; workers build toward it; changes to it are a 3.0 planner decision. | One shared visual target simplifies each worker's goal. | this session |
| 2026-07-10 | D12: The chassis ships the CONDUCT KIT — the suite's etiquette as structural middleware, not persona prose: (a) SEAM-SPEC receipt discipline (every mutation returns an evidence handle — id/URL/SHA — or errors loudly; long tools return `ticket_id` + completion events; poll tool required), lifting the existing receipt engine (`outboundReceipt.ts`, `filingReceipt.ts`, `storageReceipt.ts`, `taskingPolicy.ts`); (b) the reply gate (`replyGate.ts` pattern: action turns deliver ONLY tool receipts) and read/mutate tool classification (`toolKinds.ts`, unknown fails safe to mutate); (c) SEAM items 10–11 implemented at last: `origin_ticket_id` + `depth ≤ 1` propagation on every dispatch; (d) `AgentDefinition` (persona + capability flags) as chassis config; (e) STANDING DIRECTIVES as data: the Council (or user) installs/updates operating rules per unit via a seam tool; the unit re-reads them each turn (turn-preamble) and RENDERS them in its UI. (f) Standard UI components: "Operating Rules" panel (SEAM conformance + active directives, read-only receipts of conduct), MCP config settings, skill settings. | The etiquette agreed in the council must survive modularization; it already exists as code in the fused system — extract it once so every isolated MCP guy complies by construction, and the rules are VISIBLE in each unit's UI. | `docs/SEAM-SPEC.md`, `units/*/SEAM-SURFACE.md`, `packages/core/src/replyGate.ts`, `packages/server/src/outboundReceipt.ts`, `packages/server/src/agent.ts`, `docs/ITERATION-3-PROTOCOL.md`, `docs/EPAMINON-ARCHUS-PROTOCOL.md` |
| 2026-07-10 | D13: Epic 3.7 decommission lane — inventory and turn off all per-user containers provisioned under the Epic 2.x model, staged with the migrations. Early wins (dead test tenants, unused instances) may trigger before Phase 2. | The old fleet burns RAM and watchdog attention; retiring it is real scope with real risk (live paying tenants) and needs its own ledger. | Jordi 2026-07-10 |
| 2026-07-10 | D14 (supersedes the channel placement in earlier UI notes): CHANNELS LIVE IN PHYLAX, NOT THE RING. The Ring is pure aggregation + intelligence: a guy authenticated to all the other guys (wallet of agent→unit tokens) with routing brains; it owns NO channel settings — Phylax is just another unit in its wallet. Phylax is a full MCP unit, dual-faced: (a) MCP SERVER — tools like `send_message`/`notify`/`channel_status`, holding ALL WhatsApp + Telegram config and serving its own tenant-facing UI (the non-public number to message, Telegram bot setup, per-user channel settings, pairing); any agent with a token can post notifications to it — independently sellable as a channels/notification MCP. (b) MCP CLIENT — inbound texts are forwarded with zero intelligence as a standard MCP tool call to ONE configured downstream MCP URL+token (default: the Ring); no bespoke protocol on the wire (SEAM law 1). Still one container per phone number (Baileys blast radius unchanged); users/senders remain whitelist rows. | The Ring's product is the aggregation, not the pipes; channels are piping and belong with the channel guy; Phylax must speak MCP both ways or it becomes a funky side protocol, which SEAM forbids. | Jordi 2026-07-10; `docs/SEAM-SPEC.md` §1 |
| 2026-07-10 | D15: The Ring's web chat = the current Council console chat, ported (`ChatTab.tsx`: streaming, markdown, tool testing). It is implemented as A CHANNEL: webchat messages and binaries enter the SAME inbound pipeline as WhatsApp/Telegram (sender-tagged, mapped to the session's tenant) — one entry path into the council brain, whatever the pipe. The Ring UI therefore gives you a webchat into the council where you can test tools, exactly like today's console. | The Council's chat UX already works and is loved; making web "just another channel" keeps Phylax/webchat symmetric and gives every tenant a channel that needs no pairing. | `apps/web/src/views/ChatTab.tsx`; parent D14 |
| 2026-07-10 | D16: Skill-per-connected-MCP. The Ring holds one SKILL for each unit in its wallet — how to use that guy: what he does, when to route to him, his tool etiquette, receipt expectations. Corollary for the chassis: every unit PUBLISHES its own skill manifest (a machine-readable usage card served at a well-known path, versioned with the unit); wiring a unit into the wallet auto-imports its skill; the skill-settings UI component (D12f) renders/edits the installed set. Suites inherit the same mechanism for their machine tenants. | The ring's intelligence about its units should come FROM the units (self-describing), not be hand-maintained prose; skills stay current with unit versions automatically. | Jordi 2026-07-10; chassis C-12 skill settings |
| 2026-07-10 | D17: THE GOLDEN PATH — the canonical cross-unit scenario that defines "the suite works," and the final acceptance test of this replatform. A WhatsApp voice note (.ogg) arrives: (1) Phylax (client face) forwards it sender-tagged as a standard MCP call to the Ring, media riding as an artifact reference; (2, amended by D18) Phylax transcribes at the edge and forwards `{ sender, transcript, artifact_ref, usage }`; the Ring maps sender→tenant and has TEXT immediately — no media round-trip; (3, amended by D18) the Ring consults its Zenod skill (D16) and files via Zenod ingest passing transcript + artifact_ref; Zenod bypasses its own STT (one-transcription rule), files with provenance, returns `ticket_id` then the commit-SHA receipt; the binary archives async off the hot path; (4) in parallel the Ring dispatches a quick ack via Phylax's `notify` server-face tool — telling the user the plan it's executing ("transcribing your note, then filing + checking your backlog"), etiquette-compliant (one ack, no narration stream); (5) on receipt arrival the brain DECIDES FROM THE RECEIPT whether to make further calls (file to vault, create issue, reply with summary), each grounded in the prior receipt's evidence; (6) final user reply carries the receipt trail. Every hop is bearer-authenticated, tenant-scoped, origin_ticket_id-propagated, metered. | This one flow exercises Phylax dual faces (D14), Ring routing + skills (D16), webchat symmetry (D15 — same flow must work with an ogg dropped in webchat), conduct kit receipts + ticket propagation (D12), and multi-tenant isolation. If the golden path passes for three tenants, the architecture is real. | Jordi 2026-07-10 |
| 2026-07-10 | D18: TRANSCRIPTION AT THE EDGE, ONCE. Channel units (Phylax) transcribe media before forwarding: the forward call to the downstream MCP carries `{ sender, text_transcript, artifact_ref, transcription_usage }` — binary + transcript ready-made, off the shelf. Rules: (a) the transcript TRAVELS WITH the binary for the rest of its life; any unit receiving both (e.g. Zenod ingest) accepts the pre-made transcript, BYPASSES its own STT, and records provenance ("transcribed by phylax@version") — never double-transcribe; (b) Zenod keeps its own transcription for media entering WITHOUT a transcript (Drive drops, direct ingest) — same shared transcription module, one source; (c) graceful degradation: if the STT provider fails, Phylax forwards immediately with `transcription_failed` and the downstream may transcribe — the conversation never queues behind a dead provider; (d) cost attribution: transcription usage rides the forward payload; the Ring books it to the tenant it maps the sender to; (e) doctrine amended: Phylax has zero ROUTING intelligence, but channel-media expertise is in-scope — it holds a transcription/gateway key and is no longer `vaultless`. This kills the hot-path cross-seam piping: the Ring gets text instantly; the Zenod call becomes FILING (text, no media seam); the binary archives to Zenod async, off the hot path. | Avoids the ping-pong of media-over-seams on the latency-critical voice path; puts the specialization where the volume is; makes Phylax stronger standalone ("channels MCP that hands your agent text"); one-transcription rule prevents double cost. | Jordi 2026-07-10 (discussion following D17) |
| 2026-07-10 | D19 (ANTI-STALL LAWS, binding on all 3.x dispatches after the 3.2 pilot incident): (a) FIRST TOUCHABLE MILESTONE — every epic's first delivered ticket is a deployed surface Jordi can open (URL + tokens + click script), time-boxed; all hardening and full proofs sequence BEHIND it; the Autonomous Validation Protocol runs behind a demo, never instead of one. (b) SHOUT YOUR GATES — blocked on a human decision means the worker's entire status becomes "BLOCKED ON JORDI: <exact question + options + recommendation>" and it stops; polishing while parked at a gate is a defect. (c) BASE PIN + LAP LIMIT — consumers pin their base; the full gate runs at most once per pinned base; two rebase-and-reprove laps force escalation to the planner; providers quiesce surface-touching merges while a pinned proof is in flight. (d) HEARTBEAT — every 30 minutes one status line (state | blocker | ETA); two ETA slips = stop and report options. (e) ONE WORLD — acceptance runs ON the deployment the human will touch, never on a parallel local harness; full test suites run at most once per frozen commit, and never re-run for docs-only movement; the worker's test pass and Jordi's hand test happen on the same live surface. | The 3.2 pilot ran for hours producing good work Jordi couldn't touch, silently parked at his own approval gate, re-running its full proof across three rebase laps. Root cause included the planner-written "no human in the loop" protocol — corrected here. | epicspine issues #4, #5; 2026-07-10 incident |
| 2026-07-10 | D8: The epic worker bound to each child spine is the delivery MANAGER: it must mint issues, dispatch ticket workers and testers (subagents), run bounded fix loops on failures, and iterate until the Definition of Done is met or a named Human Gate blocks. Stopping to ask anything answerable from the spine is a defect. | Jordi runs one autonomous worker per spine; question-storms defeat the purpose. | EpicSpine goal-seeking posture |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | Epic 3.0 planner | Confirm D4 (DB) | done | - | - | `f1edc8c` | Decisions recorded here; children unblocked. | D4 decided 2026-07-10: SQLite/WAL per unit behind the storage seam. Numbering resolved (Herald→Epic 4). | 2026-07-10 | None. |
| draft | Epic worker | unassigned | Deliver Epic 3.1 chassis | ready | - | - | `f1edc8c` | 3.1 Definition of Done met. | D4 resolved; Phase 1 unblocked. | 2026-07-10 | Dispatch worker (3.0 appendix prompt). |
| draft | Planner | Epic 3.0 planner | Record cross-spine amendments in 2.3/2.4/2.5/2.9 | draft | D1–D3 accepted | - | `f1edc8c` | Proposed updates adopted or rejected by target stewards. | Proposals listed below. | 2026-07-10 00:19 CEST | Route via Epic 0. |

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
| Architecture acceptance | Jordi | D1–D5 adoption; Law 7 amendment | Approve decisions and numbering | Spine drafting, chassis design notes |
| Production cutover | Jordi | Replacing live per-tenant containers with multi-tenant units | Approve migration window and rollback plan | Hosted-test-env validation |
| Data migration | Jordi | Moving existing tenant `/data` volumes into tenant-prefixed layout | Approve per-tenant migration script run | Dry-run on copies |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: no automatic timeout; verify issue, branch, PR, latest commit, evidence, blocker, next action before takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-10 00:19 CEST |

## Planner Queue

- ~~D4~~ resolved 2026-07-10 (SQLite/WAL per unit). Numbering resolved: Herald → Epic 4 (`EPIC-4-HERALD.md`); this family owns Epic 3. Dispatch Phase 1 workers.
- Create GitHub issues for the draft ledger rows.
- Sequence (D6): Phase 1 = 3.1 + 3.2 pilot → gate (pilot E2E passes, chassis frozen, Jordi confirms) → Phase 2 = 3.3 ∥ 3.5 ∥ 3.6 → Phase 3 = 3.4.

## Worker Queue

- None until 3.1 dispatch.

## Tester Queue

- Define the two-tenant smoke test reused by every child epic (two tokens, cross-tenant read attempt must fail, per-tenant ledger counts).

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | Spine structural contract | working tree from `f1edc8c` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | pending | - |

## Handoff Journal

### 2026-07-10 - Planner - Replatform spine family created

Context: Jordi chose Option B and asked for standardized scaffolding ("write once, use multiply") plus a landed answer on UI placement, self-hosting, and suite composition. Code survey showed 4 of 5 units already share one Node image selected by `AGENT` env; chassis is an extraction, not a greenfield build.
Next: Jordi confirms D4 and numbering; dispatch 3.1.
Risks: numbering collision with Epic 3 Herald; live-tenant data migration; Callisthenes upstream pin may drift during conformance work.
Assignment identity: Epic 3.0 planner (Jordi + Claude Cowork session)
Branch / latest commit: `main` / `f1edc8c`
Last verified: 2026-07-10 00:19 CEST
Links:

- `docs/MCP-CHASSIS-SPEC.md`
- `docs/mcp-hosting-options-deck.html`

## Open Questions

- ~~D4 database target?~~ Resolved 2026-07-10: SQLite per unit, WAL + busy_timeout, behind the storage seam; shared Postgres stays available later via the same seam.
- Existing paying tenants on per-user containers: migrate scripted or by hand? Owner: Jordi. Needed by: 3.2 cutover.
- ~~D17 NEW PIPING (a) media hand-off~~ — largely RESOLVED by D18: hot path carries transcript (text) + `artifact_ref`; only the async archive fetch remains (Phylax stores blob, unit-token-fetchable URL; base64-in-args forbidden above small sizes). Owner: 3.1 steward (SEAM-SPEC vNext row). Off hot path.
- ~~D17 NEW PIPING (b) completion-event delivery~~ — DEMOTED by D18 to the filing/archive lane: poll `get_task_result(ticket_id)` (exists today); push/webhook as later SEAM extension. Owner: 3.1 steward.
- D17 NEW PIPING (c) — ack orchestration stands: the Ring brain dispatches the Phylax `notify` ack in parallel with long calls (fire-after-dispatch, one ack per plan, no narration). Owner: 3.4 worker + D12 etiquette.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Amend Law 7: one container per unit, multi-tenant within; exceptions Epaminon job sandboxes and Phylax per phone number. Unit anatomy includes its own settings UI. | This spine, D1–D3 | Epic 2.5 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Retire Z-1 per-tenant Dokploy provisioning, ZD-6 ceiling, ZD-10 watchdog registration; keep ZD-8 tokened URL. | `docs/MCP-CHASSIS-SPEC.md` | Epic 2.3 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Add SEAM-SPEC vNext conformance scope (→ Epic 3.3). | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Epic 2.4 steward | proposed |
| 2026-07-10 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Split into multi-tenant API + per-job sandboxes (→ Epic 3.5); drop `ZENOD_AWAIT_PROVISION`. | `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | Epic 2.9 steward | proposed |
| 2026-07-10 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Register 3.0–3.7 in the child-spine map; record Option-B decision. | This spine | Epic 0 steward | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | D16 addition to chassis scope: units publish a versioned skill manifest (machine-readable usage card — purpose, tools, etiquette, receipt expectations) at a well-known path, declared via `createUnit({ skill })`; consumed by ring/suite wallets on wiring. Suggest folding into C-8 (SEAM-SPEC row) + C-12 (skill settings UI). | Parent D16 | Epic 3.1 steward (`019f4932-d428…`) | proposed |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | QUIESCE DIRECTIVE (Jordi + 3.0 planner): epic declared done-for-pilot; reconcile ledger (C-1..C-16, C-18 done; C-17 parked on Jordi's Stripe creds; freeze pending live pilot evidence); then stop all merges and new tickets until reactivated. | 2026-07-10 incident + D19 | Epic 3.1 steward | directive |
| 2026-07-10 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | LIVE PILOT DIRECTIVE (Jordi + 3.0 planner): deploy frozen `4fb1abe` as Dokploy `zenod-mt-pilot`; provision T1/T2/T3; acceptance ONCE on the live deployment, targeted checks only, no full-suite re-runs; OpenRouter key entered by Jordi via Keys tab (never injected); deliver test package (URL, tokens, click script); BLOCKED-ON-JORDI protocol + 30-min heartbeat per D19. | 2026-07-10 incident + D19 | Epic 3.2 steward | directive |
| 2026-07-10 | `docs/EPIC-3.1-MCP-CHASSIS.md` | D18 additions to SEAM-SPEC vNext (C-8): (1) channel-forward payload shape `{ sender, text_transcript?, artifact_ref, transcription_usage?, transcription_failed? }`; (2) pre-transcribed ingest contract — tools accepting media MUST accept an optional accompanying transcript, bypass their own STT when present, and record transcription provenance (one-transcription rule); (3) artifact_ref = unit-token-fetchable URL, base64-in-args forbidden above small sizes; (4) transcription as a shared chassis module (one source, per-unit key config). | Parent D18 | Epic 3.1 steward (`019f4932-d428…`) | proposed |
| 2026-07-10 | `skills/epic-spine/SKILL.md` (via Epic 0 Foundation) | EpicSpine improvements learned in Epic 3: (1) NUMBERED DECISIONS as first-class — parent decisions carry stable IDs (D1…Dn) that child spines and workers cite ("parent D8"); template should formalize the ID scheme. (2) CANONICAL ARTIFACTS section — a spine may declare shared artifacts (decks, specs) with an owner and change rule, so cross-epic visuals/contracts have a steward like spines do. (3) SIGNALS between spines — a spine declares events it emits ("zenod-cutover-done") and dependents subscribe; parent planner routes signals at rollup, replacing ad-hoc "X must notify Y" rows. | Lived practice in Epic 3.0–3.7 (D-references, D11 canonical deck, 3.7's cutover dependencies) | Epic 0 Foundation steward | proposed |

## Appendix

### Worker dispatch prompts (one autonomous epic worker per child spine)

Paste-ready template — replace `<SPINE>`:

> You are the Epic worker — the DELIVERY MANAGER — and active steward for `<SPINE>`. Bootstrap from that spine only (its Bootstrap Map tells you what else to read). You manage, you don't just code: mint GitHub issues from the ledger drafts, dispatch ticket workers (subagents) on dedicated branches, dispatch testers against exact commits, run bounded fix loops when tests fail, reconcile the spine after every merge, and ITERATE until the Definition Of Done is fully met. Prove completion yourself by executing the spine's Autonomous Validation Protocol with browser automation (three provisioned tenants, per-tenant UI verification, cross-tenant failure proofs, self-host parity), recording evidence in the spine. UI rule (D7): PORT the existing UI named in the spine's UI Surface section — `apps/web` console / existing pages — onto the chassis; change only what tenant-scoping requires; do not redesign or rebuild. Do not edit other spines; record cross-spine needs in Proposed Cross-Spine Updates. Only stop for the Human Gates named in the spine. If you find yourself about to ask a question, first check whether the spine, its Bootstrap Map, or the code answers it — stopping for anything answerable there is a defect.

Dispatch order and readiness (D6 pilot-first phasing):

| Phase | Spine | Ready when |
|---|---|---|
| 1 | `docs/EPIC-3.1-MCP-CHASSIS.md` | D4 decided — dispatch first |
| 1 (pilot) | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Chassis API usable (may co-develop with 3.1; pilot feedback shapes the freeze) |
| — GATE — | Pilot three-tenant browser E2E passes; chassis API frozen | Jordi confirms "stable and proven" |
| 2 | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Gate passed + SEAM-SPEC vNext (C-8) |
| 2 | `docs/EPIC-3.5-EPAMINON-MULTITENANT.md` | Gate passed + spawner gate decided |
| 2 | `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` | Gate passed (P-1/P-3 may start anytime — no chassis dependency) |
| any | `docs/EPIC-3.7-DECOMMISSION-2X.md` | DX-1 inventory + DX-2 early wins may trigger NOW; per-unit retirement waves follow each unit's migration |
| 3 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Last — needs real ring-core + migrated downstream units |

### UI survey (2026-07-10) — what exists and gets PORTED (D7)

- `apps/web` — React 19 + Vite + Tailwind v4 + shadcn tenant console, bundled into and served by `packages/server` (Hono serves SPA at `/*`, JSON API at `/api/*`, ~120 routes). Views: `SetupWizard` (5 steps: password, vault repo, model key, WhatsApp, done), `Settings` shell with tabs Chat · Team · Vault · Keys & models · Transcription · Connections · Costs · Test, `ChatTab`, `Login`.
- Per-unit panels inside that one app: Ring = `ring-control-surface.tsx` + `/api/ring/*`; Epaminon = `epaminon-executor-settings.tsx` + `/api/exec/*`, `/api/journeys/*`; Phylax = ConnectionsTab channels + `/api/phylax/*`, `/api/whatsapp/*` (Phylax also owns its own pairing/QR screen).
- Callisthenes = `units/callisthenes/connect_page.py` (Starlette on FastMCP `custom_route`, 8 routes, server-rendered; X OAuth + paste-token flows).
- Cloud→tenant session bridge exists: `GET /api/auth/hosted-entry` (signed ticket from control plane → session → SPA). Keep it; it becomes "control plane hands the buyer into their tenant-scoped console."
- `apps/site` (marketing/buy) and `zenod-ai/cloud` (checkout/provisioning) are NOT unit UI and stay out of unit containers.

### Source survey

- Survey of unit codebases (2026-07-10 session): Zenod/Epaminon/Phylax/Ring = one Node 22 image (`packages/server`, MCP SDK 1.29 + Hono, port 8080, `AGENT` env selects persona); Callisthenes = Python 3.12 FastMCP wrapping upstream `xmcp` (port 8000). `units/*/Dockerfile` for Node units are `FROM scratch` placeholders; real build is the repo-root Dockerfile.
