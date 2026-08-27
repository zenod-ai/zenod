# EPIC P · Phylax Sprint — one channel core, integrated or standalone

Status: active — transport proof preserved; integrated/standalone product architecture locked 2026-08-27; PM sprint-plan reconciliation pending
Created: 2026-07-11
Updated: 2026-08-27
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-P-PHYLAX-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Phylax delivery manager (bind on dispatch)
Steward since: 2026-07-11T05:04:09+02:00
Last reconciled commit: `1bd8c26` on `codex/integrated-product-vision` before this spine update
Planner: Jordi + Epic 3.0 planner
Worker: Phylax delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | Phylax delivery manager | This spine | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, walk the journey, iterate until SHIP. | The test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. PORT/DUPLICATE means move code, adapt only imports/config — a scratch-written duplicate line is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-P-PHYLAX-SPRINT.md`
Active steward: Phylax delivery manager

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

Phase: Integrated/standalone product architecture locked; awaiting PM reconciliation into the overall sprint plan before new Phylax implementation is dispatched
Last verified: 2026-08-27 CEST (Jordi conversation decision plus durable product/UI contract; no implementation or production claim)
Integration target: main
Planning branch / artifact commit: `codex/integrated-product-vision` at `1bd8c26`; durable contract at `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html`
Next action: PM reconciles the locked product shape and contract acceptance into the pending overall sprint plan, explicitly mapping its Phylax/WhatsApp lane to the shared-core seams. Do not create a second metering/settings/runtime shape. After plan review, the Phylax steward normalizes executable tickets; the Zenod beta slice remains first and PM/standalone extend the same core later.
Blockers: no architectural decision is open. Exact MCP tool names, plan/allowance amounts, standalone pricing, whether PM bundles or links Zenod memory, and a future self-hosted Phylax add-on remain sprint/commercial details that may vary without changing the locked core. Historical P-S5 Telegram and real second-tenant laps remain unclosed evidence and must not be represented as passed.

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

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#870](https://github.com/zenod-ai/zenod/issues/870) | Ticket worker | P-S1-worker | P-S1 front duplicate | done | EPIC R SHIP satisfied | [#876](https://github.com/zenod-ai/zenod/pull/876) / `codex/p-s1-front-duplicate` | `31e69bb` | SHIP 1–4 | 11 focused tests + builds + CI; manager review; merged `4f4a140` | 2026-07-11T05:17:00+02:00 | integrated |
| [#871](https://github.com/zenod-ai/zenod/issues/871) | Ticket worker | P-S2-worker | P-S2 channels organ port (Baileys+Telegram+faces) | done | EPIC R SHIP satisfied | [#877](https://github.com/zenod-ai/zenod/pull/877) / `codex/p-s2-channels-port` | `31e69bb` | SHIP 8, 10 mechanics | 45 focused tests + typecheck + CI; manager review; merged `c0a2f6b` | 2026-07-11T05:17:00+02:00 | integrated |
| [#872](https://github.com/zenod-ai/zenod/issues/872) | Ticket worker | P-S3-worker | P-S3 tenant settings + keyword verification + transcription | done | P-S1, P-S2 done | [#881](https://github.com/zenod-ai/zenod/pull/881) / `codex/p-s3-tenant-settings` | `c0a2f6b` | SHIP 6–7, 9 | 645 full + 24 post-merge focused tests; CI; manager review; merged `78aaee6` | 2026-07-11T05:34:00+02:00 | integrated |
| [#873](https://github.com/zenod-ai/zenod/issues/873) | Ticket worker | P-S4-worker | P-S4 admin gate (alfablok) + billing + domain | done | P-S1, P-S2 admin surface done | [#880](https://github.com/zenod-ai/zenod/pull/880), [#883](https://github.com/zenod-ai/zenod/pull/883) / `codex/p-s4-admin-billing-domain` | `c0a2f6b` | SHIP 2, 4, 5 | CI + focused checks; live `51242ac`; root/health 200, MCP 401, logged-out admin 404 | 2026-07-11T05:54:31+02:00 | integrated and deployed |
| [#874](https://github.com/zenod-ai/zenod/issues/874) | Epic worker | Phylax delivery manager | P-S5 journey loop (browser + phone) + package | in progress; SHIP 10 Telegram + SHIP 11 need Human Gate inputs | P-S1..4 done | manager loop; [#917](https://github.com/zenod-ai/zenod/pull/917) | live `f6cc22c` | SHIP 1–12 | fresh QR paired; inbound keyword verified; clean text pipe; serialized Whisper voice pipe with artifact handoff; external WhatsApp MCP delivery receipt | 2026-07-12T17:38:01+02:00 | configure Telegram bot/identity; obtain second sender identity for isolation |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker; shared clone read-only on main.
- Manager integrates passing PRs; deploy = rebuild the ONE phylax app. Targeted tests + journey only.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Dispatch | Jordi | Ring SHIP approved | "go phylax" | Nothing before it |
| Test phone number for the manager's laps | Jordi | P-S5 start | Provide a spare/test WhatsApp number the manager may pair and message (or approve using a temp number) | P-S1..P-S4 |
| Real number pairing | Jordi | His own pass | Jordi scans the QR on /admin | Manager's laps on the test number |
| Live paying tenants / other live units | Jordi | Should not occur | BLOCKED ON JORDI | All else |

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- PM reconciles the 2026-08-27 locked contract and durable artifact into the pending overall sprint plan without accepting/rejecting it implicitly from this spine update.
- Normalize the future execution board around one shared Phylax core: MCP data/control contracts; tenant mapping/provisioning; issuer-neutral allowance and usage ledgers; Zenod allowance issuer/BFF first; then PM adapter and native Phylax shell/issuer.
- Preserve historical P-S5 evidence and name its remaining Telegram and real second-tenant laps wherever live transport completeness is claimed.
- Do not create a parallel standalone metering/settings/runtime backlog or a browser-to-Phylax credential flow.

## Worker Queue

- No new worker dispatch from this conversation update. Await the PM-reconciled sprint plan and explicit executable tickets.
- Historical P-S1–P-S4 are integrated; P-S5 remains incomplete for Telegram and a real second-tenant/sender isolation lap.

## Tester Queue

- Future shared-core acceptance must prove the same tenant/settings/metering behavior through integrated Zenod and native Phylax funding/presentation paths without a second implementation.
- Historical P-S5 still requires a real Telegram identity and two verified sender identities before its original uninterrupted package can be called complete.

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

## Open Questions

- No architecture question remains open for PM reconciliation.
- Deferred commercial choices that do not change the core: native Phylax price; PM bundled-versus-linked Zenod memory entitlement; future self-hosted Phylax add-on; exact internal allowance allocations.
- Exact MCP tool names are to be reconciled against existing code before ticket creation; the durable artifact names desired typed capabilities, not proof that every named tool exists.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.6-PHYLAX-MULTITENANT.md` | Mark superseded by this spine (doctrine D14/D18 carried forward; per-resource framing revised to full customer unit by Jordi 2026-07-11). | this spine | manager on bind | proposed |
| 2026-07-11 | `docs/EPIC-3.7-DECOMMISSION-2X.md` | After SHIP approval, the old fused WhatsApp path becomes retireable (new wave). | this spine | 3.7 manager | proposed |
| 2026-08-27 | Pending overall PM sprint proposal | Reconcile the WhatsApp-native PM lane to the locked one-core Phylax model: PM product backend invokes tenant-scoped Phylax MCP, PM owns proposals, Zenod supplies cited memory, and Phylax supplies transport plus its own metering. Sequence after Zenod beta stabilization; do not create a second runtime/metering/settings shape. | `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` and this handoff | PM | pending read-only reconciliation |

## Appendix

Inputs from Jordi at dispatch: (1) "go phylax" after Ring SHIP; (2) a test WhatsApp number the manager may pair and message during laps (his real number only on his own pass). Everything else reads from existing Dokploy envs.
