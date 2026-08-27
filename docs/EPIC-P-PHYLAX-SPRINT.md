# EPIC P · Phylax Sprint — one channel core, integrated or standalone

Status: active — final integrated-independent delivery push
Created: 2026-07-11
Updated: 2026-08-27
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-P-PHYLAX-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: `/root` final-push delivery manager
Steward since: 2026-08-27 14:40 CEST
Last reconciled commit: `ebb5f52706bd68689baa30a7875c342c67a991fa` on `main`
Planner: Jordi + Epic 3.0 planner
Worker: Phylax delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | `/root` final-push delivery manager | This spine | Steward the frozen architecture, issue board, parallel dispatch, integration, release validation and final Jordi test handoff. No architecture changes without Jordi. | Reviewed integrated `main`, exact release evidence, blockers and one final test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. PORT/DUPLICATE means move code, adapt only imports/config — a scratch-written duplicate line is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-P-PHYLAX-SPRINT.md`
Active steward: `/root` final-push delivery manager

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-Z-NIGHT-SPRINT.md` — the Zenod template.
- `docs/EPIC-R-RING-SPRINT.md` — the downstream this unit forwards into; its SHIP 8 (MCP face) is this epic's dependency.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D14/D18/D19–D21 apply verbatim.
- `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` — superseded by this spine (its D14/D18 doctrine is carried forward here; its "no tenants table" framing is REVISED by Jordi 2026-07-11: Phylax is a full customer unit).

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Product shape, journey, PORT/DUPLICATE markings, pre-made decisions |
| `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` | Binding 2026-08-27 integrated/standalone service boundary, connection/control diagrams, product UI contract, metering/allowance model and beta sequencing |
| The live Zenod unit + EPIC-Z | Historical/reusable customer-shell components; not authority to copy Zenod ownership, billing, credentials or metering into the Phylax core |
| Existing WhatsApp/Baileys + Telegram + transcription code in `packages/server` (whatsapp store, `phylaxGateway.ts`, telegram routes, transcription paths) | The channels organ being PORTED |
| GitHub issue | One ticket's execution detail |
| Validation evidence | The journey screenshots + phone screenshots |

## Mission

Stand up Phylax — "your agents, on WhatsApp and Telegram" — at `phylax.zenod.dev`, as a FULL customer unit (Jordi 2026-07-11, revising the old per-resource framing): DUPLICATE the Zenod customer layer (landing, GitHub sign-in, Stripe, tenants, dashboard), and the product middle is the PORTED channels organ that already works in this codebase: the Baileys WhatsApp server, the Telegram bot integration, and the transcription capability (D18). Dual-faced per D14: MCP SERVER (`send_message`/`notify`/`channel_status` — any tokened agent posts notifications) and MCP CLIENT (inbound messages matched sender→tenant IN PHYLAX, then forwarded as a standard MCP call to that tenant's configured downstream — their Ring). The Baileys number is ADMIN-plane: Jordi pairs it once via QR on a hardcoded-admin page; tenants never QR — they register their phone number and verify by sending a keyword TO the number. Done = the journey walked clean by the manager (with a real phone), then Jordi.

### 2026-08-27 binding product-shape clarification

The July mission remains the historical implementation/proof record, but its "duplicate Zenod" and Ring-only framing no longer defines the future product shape. The locked simplest seam is `WhatsApp / Telegram ↔ Phylax ↔ one downstream service`. Phylax is a duplex MCP channel bridge: inbound it acts as an MCP client calling the tenant's one named downstream adapter; outbound it acts as an MCP server exposing channel send/status operations. It owns transport sessions, sender verification, media staging, transcription, idempotency, delivery, receipts, channel settings and its own usage ledger. It does not own Zenod memory, PM proposal state, or host-product billing.

Phylax must remain one reusable core. Zenod Hosted and PM present Phylax controls inside their own product UI and provision an internal channel tenant/binding automatically; the browser talks only to its signed-in product backend, which invokes narrow tenant-scoped Phylax MCP control tools. Phylax standalone adds its own customer shell and billing adapter around the same tenant model, MCP surface, metering, allowance enforcement, settings components and delivery runtime. Standalone is an extension of the beta core, never a rebuild or fork.

Commercially, each service meters the costs it incurs. Phylax maintains the authoritative append-only transcription/channel usage ledger and allowance grants. Integrated Zenod/PM subscriptions issue an idempotent internal allowance grant to the mapped Phylax tenant; native Phylax billing issues the same grant for standalone customers. Only the allowance issuer and product-owned presentation differ. The host product may show one combined customer usage percentage and combined operator P&L without copying Phylax events into the Zenod or PM ledger as if those services incurred them.

## Definition Of Done

SHIP — the journey, walked on the LIVE deployment with a REAL browser and a REAL phone, loop until ONE uninterrupted clean pass, screenshots (browser + phone) per step:

- [ ] 1. `phylax.zenod.dev` logged out → normal landing ("your agents on WhatsApp & Telegram"), Get started, Pricing, Sign in. No public token field. (DUPLICATE)
- [ ] 2. Pricing: Self-hosted (free) / Monthly / Yearly, Stripe TEST. (DUPLICATE)
- [ ] 3. GitHub sign-in — same account system as the other units. (DUPLICATE)
- [ ] 4. Subscribe → tenant row in THIS container → dashboard. (DUPLICATE)
- [ ] 5. ADMIN: `phylax.zenod.dev/admin`, visible ONLY to the hardcoded GitHub login `alfablok` (any other session: 404, not 403) — QR pairing page for the Baileys number (PORT existing pairing screen), session health, paired-numbers list. Manager pairs the TEST number here; Jordi pairs the real one on his pass. (PORT + admin gate)
- [ ] 6. Tenant dashboard: register MY PHONE NUMBER → the page shows a one-time keyword and instructs "WhatsApp this keyword to <the Phylax number>" → tenant sends it FROM their phone → Phylax receives it, matches, marks the number VERIFIED. (Possession proof in the inbound direction — Jordi's design. BUILD-small: the keyword check; everything around it is ported plumbing.)
- [ ] 7. Tenant dashboard: set DOWNSTREAM = their Ring MCP URL + token (paste, like the Ring wallet in reverse); TRANSCRIPTION setting (on/off + provider key — PORT the existing transcription settings UI and capability, D18); Telegram bot binding (PORT existing telegram connect); notification prefs. Phylax's own MCP URL + token shown with copy button. (PORT + DUPLICATE)
- [ ] 8. THE PIPE, text: WhatsApp a text message from the verified phone to the Phylax number → Phylax matches sender→tenant → forwards as a standard MCP call to the tenant's Ring → the council's reply arrives back on WhatsApp. Round trip on a real phone. (PORT of the whole existing WhatsApp⇄brain loop, re-plumbed through the tenant lookup + downstream call)
- [ ] 9. THE PIPE, voice (D18, lap 2 of the loop — same epic, sequenced after 8 passes): send a voice note → Phylax transcribes at the edge (PORTED transcription) → forwards `{ sender→tenant, transcript, artifact_ref }` → council reply returns to WhatsApp. If the STT provider fails, forward with `transcription_failed` — the conversation never queues. (PORT)
- [ ] 10. MCP SERVER face: an external MCP client calls `send_message` on the tenant's Phylax URL → message arrives on the tenant's WhatsApp → delivery receipt returned (never a silent ack). Telegram equivalent exercised once. (PORT)
- [ ] 11. Isolation: a second tenant with a different verified number — messages route to THEIR downstream only; neither tenant can see the other's settings, numbers, or history. Admin page invisible to both.
- [ ] 12. Test package: "I manually walked the full journey — browser AND phone — and it works. URL + screenshots. Now you test." Jordi's pass: pair the real number, verify his phone, wire his Ring, talk to his council from WhatsApp.

HARDEN: multiple Baileys numbers (schema has `number_id` on tenant rows from day one; admin UI for N numbers later), phone re-verification on change, Google sign-in, cross-unit admin/usage view (separate epic), retirement of the old fused WhatsApp path (3.7 wave).

### Locked contract acceptance for the reconciled sprint plan

- [ ] One Phylax runtime/core supports integrated Zenod, integrated PM, and native Phylax through explicit product/allowance adapters rather than code forks.
- [ ] Each Phylax tenant has exactly one named downstream service/adapter; Phylax contains no application routing intelligence.
- [ ] Integrated browsers authenticate only to Zenod or PM. Their backend authorizes the customer, resolves the mapped channel tenant, and calls a narrow Phylax MCP control surface; no private Phylax token reaches the browser.
- [ ] Tenant-safe MCP control tools cannot pair/reset shared transports, replace shared credentials, inspect other tenants, or access global journals/capacity.
- [ ] Text, voice, image and reply context use one versioned media envelope with provider message ID, stable idempotency key, raw artifact reference, duration, transcript when eligible and explicit disposition when not transcribed.
- [ ] Phylax meters its own transcription/channel costs through one append-only usage ledger. Integrated and standalone products call the same idempotent allowance-grant operation through different allowance issuers.
- [ ] Customer presentation is product-owned: Zenod/PM show one combined plan projection; standalone Phylax shows the same Phylax metering projection in its own portal; operator P&L preserves service-level truth.
- [ ] Zenod public-beta implementation proves the shared core first without hard-coding Zenod as the only commercial owner; standalone Phylax and PM later extend the same interfaces.
- [ ] Deploys, startup reconciliation and UI changes cannot rotate customer MCP tokens, move tenant credentials, reset channel sessions, or change service ownership as an implicit side effect.

## Non-Goals

- Routing intelligence of any kind (D14: zero — match sender, forward, done; brains live in the Ring).
- Building a new pairing/QR screen (the existing one PORTS), new chat UIs, or touching the Ring beyond calling its MCP face.
- Multiple numbers in the UI (schema yes, UI later).
- Merging the Phylax runtime, session, journal, settings or metering stores into Zenod or PM.
- Building separate integrated-versus-standalone Phylax metering, tenant, settings or delivery cores.
- Letting product browsers call Phylax directly or hold internal service credentials.
- Exposing broad owner/admin mutations through the tenant-safe MCP control surface.
- Moving Zenod vault/Drive ownership or PM proposal/decision ownership into Phylax.
- Expanding the current Zenod beta stabilization into the PM adapter or standalone commercial launch before its reconciled sprint tickets are accepted.

## Current State

Phase: Final architecture frozen; wave 3 integrated and wave 4 no-loss decoupling active
Last verified: 2026-08-27 19:46 CEST
Integration target: main
Fresh base commit: `ebb5f52706bd68689baa30a7875c342c67a991fa` on `main`; signup-closed production candidate remains deployed and is the rollback/behavior baseline, not target-architecture proof
Control plane: [PR #1113](https://github.com/zenod-ai/zenod/pull/1113) merged as `3e902f4` after CI and independent review; durable visual contract at `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html`
Next action: implement #1110's explicit no-loss compatibility migration from exact integrated `main`; independently review its mixed-version, rollback, custom-binding, concurrent-voice and Drive-receipt evidence before integration.
Blockers: no architecture decision or source-wave blocker is open. Production deployment, real channel sends, real-card billing and public signup remain later named human gates. Exact plan allowance amounts, allocation chunk sizes and native Phylax pricing are configuration/commercial choices that cannot change the ledger or service architecture.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic worker | Journey passes clean (browser + phone); test package delivered. | Package posted, or "BLOCKED ON JORDI: <one question>" as entire status. |
| Ticket worker | Ticket done in own worktree, PR opened. | PR + one-line result. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine, top to bottom | Everything is here. | Always |
| 2 | `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` | Current locked product/UI/control/metering contract; supersedes "duplicate Zenod everywhere" as the future shape. | Always for new planning |
| 3 | `docs/EPIC-Z-NIGHT-SPRINT.md` + `docs/EPIC-C-CALLISTHENES-SPRINT.md` + `docs/EPIC-R-RING-SPRINT.md` | Historical template and prior product evidence; reuse components, not obsolete ownership assumptions. | When reconciling legacy work |
| 4 | Live Zenod and Phylax customer/channel code | Existing assets to extend; code remains authoritative for implemented behavior. | Ticket planning / workers |
| 5 | WhatsApp/Baileys code (`packages/server` whatsapp store + pairing screen), `phylaxGateway.ts`, telegram routes, transcription settings + pipeline, `/data/whatsapp` runtime shape | Proven transport organ to preserve and expose through the shared MCP seam. | Channel workers |
| 6 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D14/D18/D19–D21 | Durable routing/media doctrine. | Manager |

## Architecture And Context

### Locked target architecture (2026-08-27)

The simplest reusable Phylax is a duplex MCP bridge bound to one downstream service per tenant: `WhatsApp / Telegram ↔ Phylax ↔ downstream adapter`. Inbound messages are normalized into one versioned text/media envelope and forwarded through the tenant's adapter; outbound application calls use Phylax MCP send/status tools and return provider delivery receipts. Multi-tenant hosting is many isolated one-to-one bindings on one Phylax core, not an intelligent router.

Integrated products use a backend-for-frontend control path: `Zenod or PM browser → authenticated Zenod or PM backend → tenant-scoped Phylax MCP → Phylax settings`. Subscription/account provisioning creates an internal channel tenant/binding rather than a duplicate customer login or subscription. The browser never authenticates directly to Phylax and never holds its service credential. Native Phylax uses its own product shell to invoke the same underlying settings/metering operations.

One Phylax metering core records append-only allowance grants and usage events. A host-product allowance issuer handles integrated Zenod/PM subscription events; the native Phylax billing issuer handles standalone subscription events. Both call the same grant operation and feed the same admission/enforcement and customer-safe projection. `commercial_owner = zenod | pm | phylax` selects the issuer/presentation, never a different runtime, ledger or settings model.

Ownership is fixed: Phylax owns transport/session/verification/raw staging/transcription/dedupe/delivery; Zenod owns memory/vault/tenant Drive archive and memory receipts; PM owns proposal/revision/correlation/decision state. New product adapters may compose these services but may not move ownership implicitly.

### Historical July deployment shape

One Dokploy application `phylax`, one hostname `phylax.zenod.dev`, one container: the duplicated customer front + the ported channels organ + its own `/data` (tenants, per-tenant settings, Baileys session state per number). Sender→tenant mapping lives HERE (Jordi 2026-07-11): tenant rows carry `{ phone_number, verified, number_id, downstream_url, downstream_token(vault), transcription_settings, telegram_binding }`. Inbound: sender lookup → tenant → forward to downstream with tenant's token (D18 payload for media). Unmatched senders: configurable hold/reject, default reject with a polite one-time reply.

Tickets:

- **P-S1 · Front duplicate** (DUPLICATE) — customer layer + landing + tenants for phylax.
- **P-S2 · Channels organ port** (PORT) — Baileys server + session persistence + Telegram bot + the existing pairing/QR screen, mounted admin-side; MCP server face tools with delivery receipts; MCP client face: tenant lookup + downstream forward (this wiring is the epic's one new seam — flagged, 90-min budget, escalate don't invent).
- **P-S3 · Tenant settings + verification** (PORT settings UIs + BUILD-small keyword verification) — phone number registration + keyword-inbound verification; downstream URL/token; transcription settings (PORT existing UI + pipeline, D18); Telegram binding; MCP URL panel.
- **P-S4 · Admin gate + billing + domain** (DUPLICATE + small gate) — `/admin` hardcoded to GitHub login `alfablok` (404 otherwise); three TEST prices; webhook → tenant row; Traefik `phylax.zenod.dev`; guarded cutover.
- **P-S5 · Journey loop** (manager) — SHIP 1–11 with a real phone; text pipe first (8), voice pipe second (9); package.

Wave 1: P-S1 ∥ P-S2. Wave 2: P-S3, P-S4. Then P-S5. Heartbeats, budgets, worktrees: same laws as every sprint.

## Decisions

Later dated rows supersede conflicting July product-shape assumptions while preserving the July implementation and live-proof history.

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Unit shape (Jordi, supersedes old 3.6 framing) | Phylax is a FULL customer unit: landing, Stripe, tenants, settings — exactly like Zenod — plus the Baileys/Telegram organ. |
| 2026-07-11 | Routing (Jordi, confirmed) | Sender→tenant mapping lives IN PHYLAX. Tenant registers + verifies their number; inbound is matched here and forwarded to that tenant's downstream MCP URL+token. The Ring needs no pairing table. |
| 2026-07-11 | Verification (Jordi) | Inbound-direction possession proof: dashboard shows a one-time keyword; the user WhatsApps it TO the Phylax number from the claimed phone; receipt = verified. No outbound verification sends. |
| 2026-07-11 | Admin (Jordi) | `phylax.zenod.dev/admin`, visible ONLY to hardcoded GitHub login `alfablok` (constant in config/env, checked against the GitHub session identity; others get 404). Contains: QR pairing (ported screen), Baileys session health, paired numbers. Jordi pairs numbers; users never QR. |
| 2026-07-11 | Numbers | One Baileys number now; schema carries `number_id` per tenant from day one; multi-number admin UI is HARDEN. |
| 2026-07-11 | Transcription (Jordi + D18) | In the unit, PORTED from existing code, with its settings in the tenant UI. SHIP sequences it as lap 2 (text pipe proves first). Graceful degradation per D18. |
| 2026-07-11 | Telegram | PORTED existing integration, in SHIP (one send + one bind exercised). |
| 2026-07-11 | Downstream | ONE per tenant: their Ring MCP URL + token (the contract proven by EPIC R SHIP 8). Zero routing intelligence in Phylax (D14). |
| 2026-07-11 | Dispatch gate | Only after Jordi approves the Ring test package. |
| 2026-07-11 | Baileys session | FRESH QR pairing on the new unit (test number for the manager, real number by Jordi). The old fused container's session is not migrated; the old path keeps running untouched until its 3.7 wave. |
| 2026-07-11 | Conduct kit | Register async ticket shapes with receipt middleware before walking (the silent_ack lesson). |
| 2026-07-11 | Anything unanswered | Simplest option, journal it, keep moving. |
| 2026-08-27 | Simplest seam (Jordi, binding) | Phylax is a duplex MCP channel bridge: one channel tenant maps to one named downstream service/adapter. Inbound Phylax is the MCP client; outbound Phylax is the MCP server. Multi-tenant scale repeats this isolated one-to-one shape; no routing intelligence. |
| 2026-08-27 | Integrated control plane (Jordi, binding) | Zenod/PM browser talks only to its product backend. That backend authenticates and resolves the host tenant, then invokes narrow tenant-scoped Phylax MCP tools. Broad owner/admin tools and private Phylax credentials are never reachable from the customer UI. |
| 2026-08-27 | Product provisioning (Jordi, binding) | Buying Zenod or PM creates one host-product customer plus an internal Phylax channel tenant/binding, not a second customer login/subscription. Native Phylax owns its own account only when Phylax itself is the purchased product. |
| 2026-08-27 | Shared core and standalone extension (Jordi, binding) | Integrated Zenod, integrated PM and Phylax standalone reuse one tenant/settings/MCP/metering/enforcement/delivery core and reusable UI components. Standalone changes the product shell, billing authority and allowance issuer; it is never rebuilt or forked later. |
| 2026-08-27 | Metering and P&L (Jordi, binding) | Phylax authoritatively meters its transcription/channel costs. Zenod/PM or native Phylax billing issues idempotent append-only allowance grants to the same ledger. Host UI may show one combined percentage; operator views preserve service-level costs and combined customer P&L. |
| 2026-08-27 | Product ownership and sequence (Jordi, binding) | Phylax owns channels/STT, Zenod owns memory/vault/Drive archive, PM owns proposals/decisions. Land the contract and shared-core seams now; prove Zenod beta first; PM and standalone extend them later without widening the current stabilization refactor. |
| 2026-08-27 | Deployment islands (Jordi, binding) | One Phylax codebase produces one Phylax artifact reused by isolated instances. One service WhatsApp number belongs to one Phylax instance. `phylax-for-zenod` and `phylax-for-pm` use fixed product adapters; standalone Phylax permits one explicitly configured compatible downstream per tenant. Instances never share volumes, sessions, credentials, ledgers or admin state. Zenod and PM remain separate artifacts. |
| 2026-08-27 | Credit semantics (Jordi, binding) | Credit is internal integer-denominated allowance, never a provider key, OAuth credential, MCP token or provider balance. The selling product owns the master customer allowance and grants bounded, idempotent allocations to its mapped Phylax tenant through service-authenticated MCP. Phylax spends only its allocation, records its own actual/estimated costs and never deletes historical usage. Native Phylax billing uses the same grant operation. |
| 2026-08-27 | Architecture change authority (Jordi, binding) | Service ownership, instance topology, MCP boundaries, auth model, metering ownership and customer experience are frozen by this spine. Ticket workers implement bounded seams only. Any proposed change returns to Jordi; no worker may reinterpret the architecture, move credentials, create another router/ledger/runtime, or refactor a working subsystem opportunistically. |
| 2026-08-27 | Final-push mandate | `/root` is the active epic worker and spine steward. It must keep dispatching, reviewing and integrating the dependency-ordered issue board until the exact candidate is ready for Jordi's final test or a named human gate blocks progress. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#870](https://github.com/zenod-ai/zenod/issues/870) | Ticket worker | P-S1-worker | P-S1 front duplicate | done | EPIC R SHIP satisfied | [#876](https://github.com/zenod-ai/zenod/pull/876) / `codex/p-s1-front-duplicate` | `31e69bb` | SHIP 1–4 | 11 focused tests + builds + CI; manager review; merged `4f4a140` | 2026-07-11T05:17:00+02:00 | integrated |
| [#871](https://github.com/zenod-ai/zenod/issues/871) | Ticket worker | P-S2-worker | P-S2 channels organ port (Baileys+Telegram+faces) | done | EPIC R SHIP satisfied | [#877](https://github.com/zenod-ai/zenod/pull/877) / `codex/p-s2-channels-port` | `31e69bb` | SHIP 8, 10 mechanics | 45 focused tests + typecheck + CI; manager review; merged `c0a2f6b` | 2026-07-11T05:17:00+02:00 | integrated |
| [#872](https://github.com/zenod-ai/zenod/issues/872) | Ticket worker | P-S3-worker | P-S3 tenant settings + keyword verification + transcription | done | P-S1, P-S2 done | [#881](https://github.com/zenod-ai/zenod/pull/881) / `codex/p-s3-tenant-settings` | `c0a2f6b` | SHIP 6–7, 9 | 645 full + 24 post-merge focused tests; CI; manager review; merged `78aaee6` | 2026-07-11T05:34:00+02:00 | integrated |
| [#873](https://github.com/zenod-ai/zenod/issues/873) | Ticket worker | P-S4-worker | P-S4 admin gate (alfablok) + billing + domain | done | P-S1, P-S2 admin surface done | [#880](https://github.com/zenod-ai/zenod/pull/880), [#883](https://github.com/zenod-ai/zenod/pull/883) / `codex/p-s4-admin-billing-domain` | `c0a2f6b` | SHIP 2, 4, 5 | CI + focused checks; live `51242ac`; root/health 200, MCP 401, logged-out admin 404 | 2026-07-11T05:54:31+02:00 | integrated and deployed |
| [#874](https://github.com/zenod-ai/zenod/issues/874) | Epic worker | Phylax delivery manager | P-S5 journey loop (browser + phone) + package | in progress; SHIP 10 Telegram + SHIP 11 need Human Gate inputs | P-S1..4 done | manager loop; [#917](https://github.com/zenod-ai/zenod/pull/917) | live `f6cc22c` | SHIP 1–12 | fresh QR paired; inbound keyword verified; clean text pipe; serialized Whisper voice pipe with artifact handoff; external WhatsApp MCP delivery receipt | 2026-07-12T17:38:01+02:00 | configure Telegram bot/identity; obtain second sender identity for isolation |
| [#1103](https://github.com/zenod-ai/zenod/issues/1103) | Ticket worker | ZPF-1-worker | Freeze working journeys and architecture invariants | done / wave 1 | none | [#1115](https://github.com/zenod-ai/zenod/pull/1115) / `codex/zpf-1-baseline-contract` | `3e902f4` | Versioned no-regression harness covers content, concurrent voice, Drive receipts, restart/cap and durable auth/session/credential invariants without normalizing known failures. | Independent PASS; corrected baseline merged to `main` as `2649553`; real durable-chat declaration defect routed to #1119 instead of normalized | 2026-08-27 16:25 CEST | Integrated; retain as the frozen regression contract. |
| [#1104](https://github.com/zenod-ai/zenod/issues/1104) | Ticket worker | ZPF-2-worker | Independent Phylax artifact and isolated instance modes | done / wave 1 | none | [#1117](https://github.com/zenod-ai/zenod/pull/1117) / `codex/zpf-2-phylax-artifact` | `3e902f4` | Dedicated Phylax artifact boots multiple isolated fixed-product/standalone instances with no shared runtime data and no Zenod process embedded. | Final head `5b43267`; CI, independent review and exact image/runtime/identity/restart proofs PASS; merged as `e682ca0` | 2026-08-27 18:14 CEST | Integrated; preserve the separate artifact, fixed island identity and existing data/session volumes. |
| [#1105](https://github.com/zenod-ai/zenod/issues/1105) | Ticket worker | ZPF-3-worker | Deployment-stable tenant auth, credentials and sessions | done / wave 1 | none | [#1116](https://github.com/zenod-ai/zenod/pull/1116) / `codex/zpf-3-auth-stability` | `3e902f4` | Direct MCP/OAuth/Drive/channel credentials survive reconcile/restart/upgrade; only explicit confirmed revoke invalidates; real-browser loopback completes. | Independent PASS; exact head `15a4871`; merged to `main` as `ab92ce2`; real Chrome loopback and direct-token/OAuth restart proofs green | 2026-08-27 16:25 CEST | Integrated; no token, credential or session rotation occurred. |
| [#1106](https://github.com/zenod-ai/zenod/issues/1106) | Ticket worker | ZPF-4-worker | Issuer-neutral Phylax allowance and usage ledger | done / wave 1 | none | [#1118](https://github.com/zenod-ai/zenod/pull/1118) / `codex/zpf-4-phylax-ledger` | `913efeb` | Append-only integer ledger gives exactly-once tenant grants/adjustments/usage, deterministic reset/suspension and custody-preserving cap behavior. | Final head `1fbef2f`; CI and independent review PASS; all lease/cap/period/order/restart invariants green; merged as `37d08bc` | 2026-08-27 16:38 CEST | Integrated library foundation; runtime wiring remains owned by later tickets. |
| [#1119](https://github.com/zenod-ai/zenod/issues/1119) | Ticket worker | ZPF-1R-worker | Repair the real durable chat MCP declaration seam | done / wave 1 repair | #1103 | [#1120](https://github.com/zenod-ai/zenod/pull/1120) / `codex/zpf-1r-durable-chat-contract` | `2649553` | `chat_with_zenod` has one canonical accepted/poll contract while ordinary synchronous chat remains compatible; replay and tenant isolation remain exact. | Final head `344ba6e`; CI and clean exact-head manager review PASS; malformed tickets reject and 60 focused tests pass; merged as `1781812` | 2026-08-27 16:38 CEST | Integrated; baseline defect is closed without auth/routing/credential changes. |
| [#1107](https://github.com/zenod-ai/zenod/issues/1107) | Ticket worker | ZPF-5-worker | Tenant-safe Phylax management MCP | done / wave 2 | #1105, #1106 | [#1122](https://github.com/zenod-ai/zenod/pull/1122) / `codex/zpf-5-management-mcp` | `e682ca0` | Versioned, scoped, idempotent tenant/channel/credit tools; separate owner surface; hostile and rolling-version matrix green. | Final head `2cd7623`; exact CI and independent review PASS; stable caller-custodied service credentials, fenced recovery and high-entropy operation proof; merged as `297656e` | 2026-08-27 18:14 CEST | Integrated; no production, credential, token, session or live-channel mutation occurred. |
| [#1108](https://github.com/zenod-ai/zenod/issues/1108) | Ticket worker | ZPF-6-worker | Zenod provisioning, Channels BFF and combined usage | done / wave 3 | #1107 | [#1125](https://github.com/zenod-ai/zenod/pull/1125) / `codex/zpf-6-zenod-adapter` | `297656e` | Zenod lifecycle provisions/funds Phylax through MCP; browser remains Zenod-only; combined cap/projection is truthful and existing tenant assets persist. | Final head `e17b30d`; CI and independent review PASS; 1,073 server tests; merged as `0000725` | 2026-08-27 19:46 CEST | Integrated; retain separate stores, stable credentials, authoritative periods and fail-closed combined cap. |
| [#1109](https://github.com/zenod-ai/zenod/issues/1109) | Ticket worker | ZPF-7-worker | Product UI facades, Phylax operator UI and standalone shell | done / wave 3 | #1104, #1107 | [#1124](https://github.com/zenod-ai/zenod/pull/1124) / `codex/zpf-7-ui-shells` | `297656e` then reconciled `0000725` | Reusable settings/metering components serve Zenod/PM facades and native Phylax while every instance retains a separate operator UI and authority boundary. | Final head `2308933`; CI and independent review PASS; fixed-mode hostile asset/auth and responsive proofs green; merged as `ebb5f52` | 2026-08-27 19:46 CEST | Integrated; preserve separate product/native/operator shells and Phylax-specific artifact. |
| [#1110](https://github.com/zenod-ai/zenod/issues/1110) | Ticket worker | ZPF-8-worker | Remove legacy coupling with no-loss compatibility migration | active / wave 4 | #1103–#1109 | `codex/zpf-8-decouple-migrate` | `ebb5f52` | Phylax-local metering and fixed adapters replace piggyback/dynamic coupling only after exact migration, mixed-version, rollback and custom-binding preservation proof. | Dispatched from exact integrated wave-3 `main` with no UI, transport, auth or production authority | 2026-08-27 19:46 CEST | Implement bounded compatibility migration, broad proof, PR and independent review; do not deploy. |
| [#1111](https://github.com/zenod-ai/zenod/issues/1111) | Ticket worker | ZPF-9-worker | PM and standalone conformance without a core fork | queued / wave 5 | #1107, #1109, #1110 | `codex/zpf-9-three-island-conformance` | fresh integrated #1110 `main` | PM contract harness and native issuer prove three simultaneous isolated islands using the same Phylax core; downstream PM repo unchanged without authority. | Frozen three-island architecture | 2026-08-27 14:40 CEST | Dispatch after #1110 integrates. |
| [#1112](https://github.com/zenod-ai/zenod/issues/1112) | Tester / release worker | ZPF-10-release | Final integrated-independent acceptance and closed rollout | queued / wave 6 | #1103–#1111 | `codex/zpf-10-release-acceptance` | exact integrated `main` | Exact candidate passes full automated/independent review, backups, separate-artifact closed deploy and uninterrupted real customer journey; test package delivered. | ZAL-22 production packet is the prior rollback/current baseline | 2026-08-27 14:40 CEST | Dispatch only after implementation waves integrate. |
| [#1061](https://github.com/zenod-ai/zenod/issues/1061) | Epic worker / human gate | `/root` + Jordi | Public production-readiness gate | blocked after closed candidate | #1112, Stripe profile, live €9 journey, explicit signup approval | existing ZAL-4 operator lane | exact #1112 candidate | Readiness 13/13, final human acceptance, explicit public signup approval and rollback named. | Current production candidate is signup-closed and 11/13 | 2026-08-27 14:40 CEST | Keep signup closed; execute only after #1112 and separate exact approvals. |

## Branch And Integration

- Default integration branch: protected `main`; current coherent wave-4 base is `ebb5f52706bd68689baa30a7875c342c67a991fa` after integrating #1103–#1109 and #1119.
- One ticket worker, dedicated `codex/` branch and separate worktree per issue. Workers write detailed progress and handoffs to their issue; only `/root` edits this spine.
- Waves 1–3 integrated #1103–#1109 and #1119. Wave 4 runs only #1110 from exact integrated main. Later waves obey the dependencies recorded above.
- The manager independently reviews each PR, integrates small coherent changes, updates the base for subsequent workers and rejects architectural drift even when tests are green.
- No implementation PR may deploy automatically as acceptance. ZPF-10 owns the exact backup/deploy/test sequence after all source waves integrate.
- `review` means implementation complete, PR open, CI green and independent architecture review clean; `done` additionally requires integrated-main validation and spine reconciliation.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Architecture/product contract | Jordi | Any proposal changes service ownership, island topology, MCP boundary, auth model, metering ownership or customer experience | Explicitly approve the revised spine decision before implementation | Work strictly inside the frozen contract |
| Final-push dispatch | Jordi | 2026-08-27 backlog and goal creation | Approved by the request to create, parallelize and execute this final push | All local code, tests, docs, GitHub issues/PRs and read-only production inspection inside this spine |
| Test phone number for the manager's laps | Jordi | P-S5 start | Provide a spare/test WhatsApp number the manager may pair and message (or approve using a temp number) | P-S1..P-S4 |
| Real number pairing | Jordi | His own pass | Jordi scans the QR on /admin | Manager's laps on the test number |
| Live paying tenants / other live units | Jordi | Should not occur | BLOCKED ON JORDI | All else |
| Production backup/deploy | Jordi | ZPF-10 has an exact reviewed merge SHA, immutable images, targets, env-preservation proof and rollback | Approve the exact backup and closed deployment actions | Local/review/CI/read-only preflight |
| Real channel acceptance | Jordi | Closed candidate is healthy and named test messages/tenant are ready | Approve the exact real WhatsApp/Telegram sends; Jordi performs final experiential pass | Automated and synthetic acceptance |
| Billing and public signup | Jordi | #1061 reaches exact Stripe/profile/legal/live-journey gate | Separate real-card approval, then separate `public signup on` approval | Signup-closed testing and remediation |

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- Architecture and acceptance are frozen. Route any proposed change to Jordi instead of editing issue scope silently.
- Keep the PM repository/proposal read-only until its own steward accepts the shared contract; #1111 proves compatibility without downstream mutation.
- Preserve historical P-S5 evidence and name its remaining Telegram and real second-tenant laps wherever live transport completeness is claimed.
- Do not create a parallel standalone metering/settings/runtime backlog, browser-to-Phylax credential flow, provider child-key scheme, dynamic product router or shared database.

## Worker Queue

- Wave 1: #1103 baseline contract, #1104 independent Phylax artifact and #1105 auth stability in parallel; #1106 ledger when a slot opens.
- Wave 2: #1107 management MCP after auth and ledger.
- Wave 3: #1108 Zenod adapter and #1109 UI shells in parallel.
- Wave 4: #1110 compatibility migration and coupling removal.
- Wave 5: #1111 three-island PM/standalone conformance.
- Wave 6: #1112 exact release acceptance, then #1061 public gates.

## Tester Queue

- Every wave gets independent review against this spine, not only unit tests.
- #1112 must prove the same tenant/settings/metering behavior through Zenod, PM fixture and native Phylax paths without a second implementation.
- Historical P-S5 still requires a real Telegram identity and two verified sender identities before its original uninterrupted package can be called complete; it can be satisfied inside the gated #1112 journey.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-11 | Pre-P-S5 live deployment receipt | `51242ac` | `https://phylax.zenod.dev` | guarded Dokploy target + exact-SHA HTTP probes | PASS: root and health 200; MCP unauthenticated 401; logged-out `/admin` 404; OAuth redirect targets Phylax callback | `/var/tmp/p-s4-cutover-2026-07-11`; application `urbFsgl6eImbQ4MTIZl5N` |
| 2026-07-12 | P-S5 WhatsApp text pipe | `f6cc22c` | `phylax.zenod.dev` + WhatsApp Web/real account | verified sender → Phylax → tenant Ring → WhatsApp | PASS: one inbound, one Ring run, one reply; legacy listener disabled | `docs/evidence/phylax-ship-2026-07-12/10-clean-text-pipe-whatsapp-web.png` |
| 2026-07-12 | P-S5 voice transcription pipe | `f6cc22c` | `phylax.zenod.dev` + WhatsApp Web/real account | 35-second voice note → serialized local Whisper → authenticated artifact handoff → Ring → WhatsApp | PASS: message `3EB08DF39E67F9B2227E5F`; transcript and `whisper.cpp large-v3-turbo` source recorded; reply `voice pipe passed`; container remained stable | `docs/evidence/phylax-ship-2026-07-12/12-voice-transcription-pipe-live.png` |
| 2026-07-12 | P-S5 MCP server WhatsApp face | `f6cc22c` | live tenant MCP endpoint | external MCP client `send_message` to verified phone | PASS: provider receipt `whatsapp:3EB0A5D62BF7283727DC42:sent` (not silent ack) | live structured MCP receipt |
| 2026-07-12 | Exact-SHA deployment reconciliation | `f6cc22c` | Dokploy application `urbFsgl6eImbQ4MTIZl5N` + Swarm service | reconcile desired image and `GIT_SHA`; restart preserved fresh Baileys volume/session | PASS: `/api/health` reports full `f6cc22ccc3b7210a5e8afceb9f619ac76a73c734`; WhatsApp reconnected to linked number ending `0219` | `docs/evidence/phylax-ship-2026-07-12/13-completion-audit.md` |
| 2026-07-12 | P-S5 completion audit | `f6cc22c` | live deployment + durable stores + screenshots + focused/full tests | inspect every SHIP 1–12 requirement and reject indirect evidence where real-account proof is required | SHIP 1–6, 8–9 pass; SHIP 7/10 Telegram and SHIP 11 live second-tenant isolation remain incomplete | `docs/evidence/phylax-ship-2026-07-12/13-completion-audit.md` |
| pending | SHIP journey clean pass | `f6cc22c` | phylax.zenod.dev live + real phone | browser + phone walk, screenshots both | pending Telegram exercise and two-tenant isolation | test package |

## Handoff Journal

### 2026-07-11 - Planner - Phylax sprint spine created

Context: Jordi revised the old per-resource framing (3.6): Phylax is a full customer unit — Zenod duplicate + the ported Baileys/Telegram/transcription organ. Sender→tenant routing lives in Phylax (confirmed); verification is inbound-keyword (Jordi's design); admin QR page hardcoded to `alfablok`. Gated on the Ring because tenants' downstream IS the Ring's MCP face (EPIC R SHIP 8).
Next: hold until Ring SHIP approval, then dispatch.
Risks: Baileys pairing flakiness (why the organ has its own quarantined history — session state on its own /data, admin re-pair one click away); the tenant-lookup+forward wiring is the one new seam (P-S2, budgeted); real-phone testing needs a test number from Jordi.
Links: `docs/EPIC-R-RING-SPRINT.md`, `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` (doctrine carried, framing revised).

### 2026-07-11 - Phylax delivery manager - bound and wave 1 dispatched

Context: Ring SHIP gate was already satisfied. Minted P-S1 through P-S5 as issues #870–#874. Dispatched P-S1 and P-S2 in separate worktrees at the exact pinned base `31e69bbbc20e2e4a2b053a2d30adf44f18b34245`; both workers confirmed the required worktrees before implementation. GitHub app issue writes returned 403, so the authenticated `gh` CLI created the same tickets without blocking delivery.
Next: review and integrate wave 1; dispatch P-S3 and P-S4 only after their recorded dependencies land.
Risks: live `phylax.zenod.dev` currently returns 404 as expected before P-S4; an older Dokploy compose named `phylax` exists without a domain and is read-only until P-S4 identifies the new full-customer-unit target, preserving the old fused path.
Links: [#870](https://github.com/zenod-ai/zenod/issues/870), [#871](https://github.com/zenod-ai/zenod/issues/871), [#872](https://github.com/zenod-ai/zenod/issues/872), [#873](https://github.com/zenod-ai/zenod/issues/873), [#874](https://github.com/zenod-ai/zenod/issues/874).

### 2026-07-11 - Phylax delivery manager - wave 1 integrated; wave 2 dispatched

Context: P-S1 PR #876 and P-S2 PR #877 both passed CI and independent manager review. Review caught and fixed a broken Self-host link and required the channels PR to compose the shipped WhatsAppGateway, WhatsAppStore, TelegramGateway, shared transcription, and pairing API/UI rather than stopping at a scratch seam. Manager reran 11 customer/unit checks and builds plus the 45-test channel battery. Wave 1 merged as `4f4a140` and `c0a2f6b`.
Assignments: P-S3-worker / `codex/p-s3-tenant-settings` / `../wt-p-s3`; P-S4-worker / `codex/p-s4-admin-billing-domain` / `../wt-p-s4`; both start from integrated base `c0a2f6b524c53c69dedcd812739916bf8b26272d` without rebasing wave 1.
Next: integrate wave 2, publish/deploy one exact SHA into a new full-customer-unit application, then request the test WhatsApp number at the P-S5 Human Gate.

### 2026-07-11 - Phylax delivery manager - wave 2 integrated and live target ready

Context: P-S4 PR #880 and P-S3 PR #881 passed CI and manager review. P-S3 merged P-S4 without rebasing and resolved the shared hooks onto exactly one Baileys/Telegram runtime. A dedicated Stripe TEST webhook endpoint was created for `https://phylax.zenod.dev/webhook`; #883 preserves its endpoint-specific signing secret. Final image `sha-51242ac` passed publish smoke. The new application owns a fresh `phylax-data` volume and no migrated session; the protected legacy compose was untouched. Dokploy's deployment queue was backed up behind an unrelated active job, so the manager created only the reviewed new Swarm service from the exact target config, then used Dokploy's start action to reconcile application status to done.
Evidence: live `/api/health` reports `phylax` / `51242ac`; root 200; unauthenticated MCP 401; logged-out `/admin` 404; OAuth authorization redirect carries `https://phylax.zenod.dev/auth/github/callback`.
Next: P-S5 Human Gate — obtain the manager's spare/test WhatsApp number, pair it by fresh QR, then walk from step 1 until one uninterrupted clean browser-and-phone pass.

### 2026-07-12 - Phylax delivery manager - live WhatsApp text, voice, and MCP receipt passed

Context: Jordi supplied `+34 664 24 02 19` for a fresh QR pairing and `+34 618 21 77 03` as the real sender. The manager paired the new Phylax session without migrating the legacy session, verified the sender with the inbound keyword, and disabled only the legacy `zenod-console` listener after Jordi explicitly approved unplugging it. The old container and session remain intact. A clean text lap produced one Ring run and one WhatsApp reply.

During the voice lap, two overlapping local Whisper processes exhausted the container and left two audit rows in `processing`. PR #917 added a global FIFO for local Whisper while preserving cloud STT concurrency, plus restart recovery that marks in-flight rows `interrupted`. CI passed, image `sha-f6cc22c` deployed, and the two stale rows recovered as designed. A new 35-second real-account voice note then completed without restart. Ring recorded the transcribed prompt, authenticated Phylax artifact reference, sender, and `transcription_source: whisper.cpp large-v3-turbo`; WhatsApp received `voice pipe passed`. An independent MCP client then called `send_message` and received provider message ID `3EB0A5D62BF7283727DC42` with status `sent`.

Next: configure the ported Telegram gateway with a real bot token and bind/exercise one identity; then create a second tenant with a second verified sender identity for the isolation lap. Do not issue the test package until both pass.

### 2026-07-12 - Phylax delivery manager - exact-SHA receipt reconciled and completion audited

Context: the live container was already running image `sha-f6cc22c`, but Dokploy desired state and the Swarm task still exposed `GIT_SHA=51242ac`, so `/api/health` contradicted the deployed image. The manager updated the Dokploy application record to immutable image `sha-f6cc22c`, replaced the stale `GIT_SHA`, reconciled the Swarm service, and verified the full SHA at the public health endpoint. The persistent fresh Baileys session reconnected to linked number ending `0219` with no error. A signed live-session probe also proved `AlfaBlok` receives 200 for the admin page/API while a different signed GitHub login receives 404/404.

Validation: the manager inspected every SHIP criterion against live HTTP behavior, durable tenant/account/channel stores, Ring/WhatsApp receipts, screenshots, and current code tests. Focused Phylax coverage passed 27 tests and the repository test command passed. The audit refuses to treat automated isolation as the required real second-tenant lap: Telegram remains unbound/unexercised and the live deployment still has one tenant with one verified sender.

Next: obtain the named Telegram and second-sender inputs, run those two live laps, then restart the full journey at step 1 for the uninterrupted clean-pass package.

### 2026-08-27 - Planner/steward - Integrated and standalone Phylax direction locked for PM reconciliation

Context: Jordi paused the release sequence to reconcile Phylax's long-term product shape before more refactoring. The conversation established the simplest seam as a duplex MCP bridge bound to one downstream service per tenant. Zenod Hosted and PM should include Phylax transparently through their own authenticated backend and UI, while Phylax-only customers use a native product shell over the same core. The browser never talks directly to the private Phylax service or holds its credential. Tenant-safe settings/activation operations may use narrow MCP control tools; shared transport pairing/reset and global administration remain owner-only.

Metering was added as a first-class service boundary rather than deferred standalone work. Phylax owns an issuer-neutral allowance-grant ledger, its channel/STT usage ledger and enforcement. Zenod, PM and native Phylax billing are interchangeable allowance issuers that fund the same channel tenant/core. This preserves one combined product usage presentation where appropriate while retaining truthful service-level operator P&L. The standalone product is therefore an extension—product shell, native billing issuer and generic downstream setup—not a later rebuild.

The durable visual contract is `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` at planning commit `1bd8c26`. It includes the data plane, browser/backend/MCP settings flow, automatic subscription provisioning, integrated-versus-standalone UI contracts, voice/media ownership, metering/P&L, scaling invariants and beta scope. The local PM proposal and PG0 remained pending and read-only; no proposal decision, issue creation, downstream-repository change, implementation, deployment, credential, session or production mutation occurred.

Next: Jordi will give this conversation/durable contract to the PM. The PM reconciles its overall sprint proposal around the locked shared-core seams, keeps the current Zenod stabilization slice narrow, and returns a revised execution plan. The Phylax steward then normalizes tickets only after that plan is reviewed.

Risks: the historical July spine and tickets contain duplicate-Zenod, Ring-only and three-plan assumptions. They remain useful implementation/evidence history but must not be copied forward as current product authority. Exact tool names, prices and internal allowance allocations are proposal details; changing them must not fork the core architecture.

### 2026-08-27 - Epic worker - Final architecture goal bound and execution board created

Context: Jordi accepted the deployment-island, backend-for-frontend and issuer-neutral metering model and explicitly requested a detailed parallel backlog plus a new persistent goal. `/root` became the active Phylax spine steward and final-push delivery manager. The goal is to deliver the frozen architecture to a final human test without rotating credentials/tokens/sessions or opportunistically redesigning working subsystems.

Action: created issues #1103–#1112 as six dependency waves. Wave 1 freezes current behavior, separates the Phylax artifact, makes auth/credential/session continuity append-only and builds the independent allowance ledger. Subsequent waves expose the tenant-safe MCP, bind Zenod and reusable UI shells, remove old coupling through a no-loss compatibility migration, prove PM/standalone conformance and run one exact closed rollout. Existing #1061 remains the separate public billing/signup gate.

Next: merge this control-plane update, then dispatch #1103, #1104 and #1105 in isolated worktrees from its exact main commit; queue #1106 when a slot opens. The steward reviews/integrates and advances bases between waves.

Risks: current production is a signup-closed candidate, not proof of the target separate-artifact architecture. No production, credential, billing, session, channel or signup mutation is authorized by backlog creation.

Assignment identity: `/root` final-push delivery manager

Branch / latest commit: `codex/zenod-phylax-final-push-control-plane` from `915d3c4`; commit pending

Last verified: 2026-08-27 14:40 CEST

Links: [#1103](https://github.com/zenod-ai/zenod/issues/1103), [#1104](https://github.com/zenod-ai/zenod/issues/1104), [#1105](https://github.com/zenod-ai/zenod/issues/1105), [#1106](https://github.com/zenod-ai/zenod/issues/1106), [#1107](https://github.com/zenod-ai/zenod/issues/1107), [#1108](https://github.com/zenod-ai/zenod/issues/1108), [#1109](https://github.com/zenod-ai/zenod/issues/1109), [#1110](https://github.com/zenod-ai/zenod/issues/1110), [#1111](https://github.com/zenod-ai/zenod/issues/1111), [#1112](https://github.com/zenod-ai/zenod/issues/1112), [#1061](https://github.com/zenod-ai/zenod/issues/1061)

### 2026-08-27 - Epic worker - Control plane merged and wave 1 dispatched

Context: [PR #1113](https://github.com/zenod-ai/zenod/pull/1113) passed strict spine validation, repository CI and independent architecture review at exact head `17c16a2`, then merged to `main` as `3e902f4`.

Action: dispatched #1103, #1104 and #1105 from exact merged base `3e902f4` into separate worktrees/branches. The three scopes are deliberately non-overlapping: durable no-regression evidence, Phylax-only packaging/entrypoint, and remaining auth/OAuth continuity. All workers are prohibited from editing spines, changing architecture, deploying, or touching real credentials/tokens/sessions.

Next: review and integrate each exact PR when ready. Assign the first freed worker slot to #1106 from the newest coherent `main`.

Risks: the active workers must not interpret existing universal-image packaging as permission to combine services again, or use OAuth repair as permission to rotate direct MCP tokens. The frozen invariants and issue acceptance govern even if broader refactoring appears convenient.

Assignment identity: `/root` final-push delivery manager; ZPF-1/2/3 ticket workers

Branch / latest commit: `main` `3e902f49372f211f589d73722f6be9bbf33a79d5`; steward rollup branch `codex/zenod-phylax-final-push-steward`

Last verified: 2026-08-27 15:05 CEST

Links: [PR #1113](https://github.com/zenod-ai/zenod/pull/1113), [#1103](https://github.com/zenod-ai/zenod/issues/1103), [#1104](https://github.com/zenod-ai/zenod/issues/1104), [#1105](https://github.com/zenod-ai/zenod/issues/1105), [#1106](https://github.com/zenod-ai/zenod/issues/1106)

### 2026-08-27 - Epic worker - Wave 1 partial integration and review gates

Context: #1103 and #1105 passed exact-head CI plus independent review and are integrated on `main` `2649553`. The real composed #1103 harness correctly exposed an undeclared durable `chat_with_zenod` contract instead of hiding it behind mocks, so bounded repair #1119/[PR #1120](https://github.com/zenod-ai/zenod/pull/1120) was added without changing the architecture.

Action: held #1104 and #1106 from merge when independent reviewers found bounded correctness defects. #1104 was corrected from a universal Zenod composition to a Phylax-only generic-chassis process and remains under exact route-surface review. #1106 closed lease fencing and reserved-cap settlement defects; a final correction is active so direct usage cannot depend on whether an unrelated projection reconciled an expired period. #1119 head `344ba6e` is CI-green after strict malformed-ticket handling and awaits final exact-head re-review.

Next: merge #1119 only after final PASS; finish #1104/#1106 review-fix loops; then dispatch #1107 from the newest coherent `main`.

Risks: review findings are implementation defects inside accepted ticket scope, not permission to redesign the service boundary, metering model or credential/auth model. Production, credentials, tokens, sessions and tenant data remain untouched.

Assignment identity: `/root` final-push delivery manager

Branch / latest commit: `main` `264955371bbf85b44be5540448f0e1e8998889b8`; steward reconciliation branch `codex/zpf-wave1-reconcile-2026-08-27`

Last verified: 2026-08-27 16:25 CEST

Links: [#1103](https://github.com/zenod-ai/zenod/issues/1103), [#1104](https://github.com/zenod-ai/zenod/issues/1104), [#1105](https://github.com/zenod-ai/zenod/issues/1105), [#1106](https://github.com/zenod-ai/zenod/issues/1106), [#1119](https://github.com/zenod-ai/zenod/issues/1119), [PR #1117](https://github.com/zenod-ai/zenod/pull/1117), [PR #1118](https://github.com/zenod-ai/zenod/pull/1118), [PR #1120](https://github.com/zenod-ai/zenod/pull/1120)

### 2026-08-27 - Epic worker - Ledger and durable-chat foundations integrated; wave 2 started

Context: #1106/[PR #1118](https://github.com/zenod-ai/zenod/pull/1118) and #1119/[PR #1120](https://github.com/zenod-ai/zenod/pull/1120) passed their bounded fix loops, exact-head CI and final review. They merged sequentially to `main` as `37d08bc` and `1781812`.

Action: dispatched dependency-ready #1107 from exact `main` `1781812` to implement only the frozen tenant-safe management MCP. In parallel, #1104 is correcting two independent-review findings: remove residual Zenod-only customer routes from the Phylax artifact and bind immutable instance/mode/service-number identity to its existing `/data` volume before channel startup.

Next: independently review and integrate exact #1104 and #1107 heads; then dispatch #1108 and #1109 according to their recorded dependencies.

Risks: #1104 must preserve every existing session, credential, setting and journal while narrowing reachability. #1107 must not expose owner transport controls or backend service credentials to customer browsers. Neither ticket authorizes deployment or live mutations.

Assignment identity: `/root` final-push delivery manager; ZPF-2 correction worker; ZPF-5 worker

Branch / latest commit: `main` `17818127d19a332ff8164d5c968f93a7c7b5bb80`; steward reconciliation branch `codex/zpf-wave1-reconcile-2026-08-27`

Last verified: 2026-08-27 16:38 CEST

Links: [#1104](https://github.com/zenod-ai/zenod/issues/1104), [#1107](https://github.com/zenod-ai/zenod/issues/1107), [PR #1117](https://github.com/zenod-ai/zenod/pull/1117), [PR #1118](https://github.com/zenod-ai/zenod/pull/1118), [PR #1120](https://github.com/zenod-ai/zenod/pull/1120)

### 2026-08-27 - Epic worker - Separate artifact and management seam integrated; wave 3 started

Context: #1104/[PR #1117](https://github.com/zenod-ai/zenod/pull/1117) and #1107/[PR #1122](https://github.com/zenod-ai/zenod/pull/1122) passed their bounded fix loops, exact-head CI and independent review. They merged sequentially to `main` as `e682ca0` and `297656e`.

Action: dispatched #1108 and #1109 in parallel from exact `main` `297656e`. #1108 exclusively owns the Zenod lifecycle/BFF/provisioning/combined-usage lane; #1109 exclusively owns reusable UI components plus separate product/native/operator shells and the Phylax-specific UI artifact. Neither worker may change the frozen service boundary.

Next: independently review and integrate #1108 first, then reconcile #1109 onto that main and integrate only after its exact browser/image/auth boundary passes. Dispatch #1110 only after both are integrated.

Risks: #1108 must never rotate service credentials, invent tenant mappings, expose Phylax authority to the browser or fabricate combined usage. #1109 must not ship a generic Zenod SPA in the Phylax artifact or expose operator/internal routing to product customers. Neither ticket authorizes deployment, live credentials, channel sends, billing or signup.

Assignment identity: `/root` final-push delivery manager; ZPF-6 worker; ZPF-7 worker

Branch / latest commit: `main` `297656e75b4baa8a0674726348b9a0d0f18b6399`; steward reconciliation branch `codex/zpf-control-wave3`

Last verified: 2026-08-27 18:14 CEST

Links: [#1108](https://github.com/zenod-ai/zenod/issues/1108), [#1109](https://github.com/zenod-ai/zenod/issues/1109), [PR #1117](https://github.com/zenod-ai/zenod/pull/1117), [PR #1122](https://github.com/zenod-ai/zenod/pull/1122)

### 2026-08-27 - Epic worker - Wave 3 integrated; no-loss decoupling started

Context: #1108/[PR #1125](https://github.com/zenod-ai/zenod/pull/1125) and #1109/[PR #1124](https://github.com/zenod-ai/zenod/pull/1124) passed their bounded fix loops, exact-head CI and independent review. #1108 merged first as `0000725`; #1109 reconciled onto that exact main, revalidated its fixed-mode/operator asset boundary, and merged as `ebb5f52`.

Action: dispatched #1110 from exact integrated `main` `ebb5f52` to remove only the legacy transcription-accounting piggyback and dynamic fixed-product binding compatibility after generated/custom/mixed-version/rollback evidence passes.

Next: independently review and integrate #1110. Dispatch #1111 only after the compatibility migration is exact-main green and preserves every existing credential, session, token, binding and tenant datum.

Risks: no old compatibility read may be removed before both rolling orders and rollback pass. Fixed Zenod/PM adapters must never reinterpret custom standalone bindings. Phylax local usage booking must not block capture or duplicate charges. #1110 authorizes no UI rewrite, transport replacement, deployment or live mutation.

Assignment identity: `/root` final-push delivery manager; ZPF-8 worker

Branch / latest commit: `main` `ebb5f52706bd68689baa30a7875c342c67a991fa`; steward reconciliation branch `codex/zpf-control-wave4`

Last verified: 2026-08-27 19:46 CEST

Links: [#1110](https://github.com/zenod-ai/zenod/issues/1110), [PR #1124](https://github.com/zenod-ai/zenod/pull/1124), [PR #1125](https://github.com/zenod-ai/zenod/pull/1125)

## Open Questions

- No architecture question remains open for the final push. Any proposed change to service boundaries, credential ownership, routing, tenant identity, metering ownership or deployment islands must stop for Jordi's explicit approval.
- Deferred commercial choices that do not change the core: native Phylax price; PM bundled-versus-linked Zenod memory entitlement; future self-hosted Phylax add-on; exact internal allowance allocations.
- Ticket workers must reconcile exact MCP tool names against existing code before implementation. The durable artifact and issues lock the required typed capabilities; they do not authorize inventing parallel protocols or a second control plane.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` | Mark superseded by this spine (doctrine D14/D18 carried forward; per-resource framing revised to full customer unit by Jordi 2026-07-11). | this spine | manager on bind | proposed |
| 2026-07-11 | `docs/EPIC-3.7-DECOMMISSION-2X.md` | After SHIP approval, the old fused WhatsApp path becomes retireable (new wave). | this spine | 3.7 manager | proposed |
| 2026-08-27 | Pending overall PM sprint proposal | Reconcile the WhatsApp-native PM lane to the locked one-core Phylax model: PM product backend invokes tenant-scoped Phylax MCP, PM owns proposals, Zenod supplies cited memory, and Phylax supplies transport plus its own metering. Sequence after Zenod beta stabilization; do not create a second runtime/metering/settings shape. | `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` and this handoff | PM | pending read-only reconciliation |

## Appendix

Inputs from Jordi at dispatch: (1) "go phylax" after Ring SHIP; (2) a test WhatsApp number the manager may pair and message during laps (his real number only on his own pass). Everything else reads from existing Dokploy envs.
