# WhatsApp for multiple tenants — P0.5 design & decision

Ticket: #453 (P0.5, epic #448). Status: **investigated; recommending the low-risk path for Phase 0 and scoping the shared-number router as P1.**

## DECISION — 2026-07-08 (Jordi)

**Go with dedicated Baileys per user (Option A / tier 2). Shared-number router (Option B / tier 3) → backlog.**

The three hosting tiers are:
1. **Self-hosted** — user runs everything; pairs *their own* number.
2. **Dedicated hosted** — Zenod runs one container per user; still pairs *their own* number. Same topology as tier 1, just Zenod-run. **This is what we ship.**
3. **Multi-tenant shared number** — one Zenod number + `wa-router` demuxing `senderPhone → Ring`. **Backlog** (needs the new router service + `/api/whatsapp/inbound`; a shared socket is a shared failure domain).

Tier 2 needs **no new WhatsApp gateway code** — the in-process per-tenant socket (`whatsappGateway.ts`, `runtime.ts:205`) is exactly this and runs live. "Moving forward" = provision a dedicated tenant + QR-pair the user's number during onboarding. Under Epic 2.5, WhatsApp inbound feeds that tenant's Ring/brain-gateway; Phylax owns outbound over the same socket.

## What the code actually does today

The WhatsApp gateway is **one Baileys socket bound in-process to one engine, per container**:

- `runtime.ts:205` constructs `WhatsAppGateway` with `getEngine: () => this.getEngine()` — the socket, the allowlist (`whatsappConfig.ts`), and the engine all live in the same tenant container.
- Inbound never leaves the process: `messages.upsert` → transcribe/describe → `engine.handleTasking({ surface: "whatsapp" })` → reply back out the same socket (`whatsappGateway.ts:790/1076/1106`).
- There is **no inbound-message HTTP endpoint** (`app.ts` exposes `/api/whatsapp/status|pair|disconnect|reset-session`, but nothing that accepts an inbound message from an external router).

So "shared platform number → sender-phone routing → tenant webhook, one Baileys singleton" is **a different topology**, not a setting. It needs a new central service *and* a new inbound path on the Console.

## The two ways to give tenants WhatsApp

### Option A — per-tenant socket (works today, zero new code)
Each tenant's Console pairs **its own** WhatsApp number via the existing QR flow; its allowlist admits that tenant's phone(s). Fully isolated (matches container-per-tenant), no shared surface, no routing.
- **Cost:** each tenant needs their own WhatsApp number + a one-time QR pairing during onboarding.
- **Risk:** low — it's the path live Zenod already runs.

### Option B — shared platform number + router (what the ticket describes)
One Baileys socket in a central **wa-router** service holding a `senderPhone → tenant` map. Inbound → look up tenant → POST to that tenant Console's **new** `/api/whatsapp/inbound`; the Console processes via `handleTasking` and calls back the router to send the reply out the one socket.
- **New pieces:** the router service (single socket, sender map, send-back API) + `/api/whatsapp/inbound` + an outbound bridge on each Console (replace in-process `socket.sendMessage` with "post reply to router").
- **Cost:** re-architects inbound from in-process to HTTP; **untestable without the live platform number + creds** (and the memory warns hard about socket fragility: zombie-container 428 conflicts, the @lid receipt gotcha, connected-but-mute).
- **Risk:** medium-high, and it touches the one socket that, if broken, takes down WhatsApp for everyone on the shared number.

## Decision (recommended)

**Phase 0 (1–3 concierge partners): don't build Option B.** Do the ticket's own fallback — **Telegram + Console for the first partners, and offer per-tenant WhatsApp (Option A) to anyone who needs it.** Both work today with zero risk to the live socket. This unblocks onboarding now.

**Promote Option B to a scoped P1 ticket** (it's really a T13/T14-class channel-platform item, #462), built against a *second* test number so a bug can't take down the live one. Concrete P1 scope:
1. `wa-router` service: single socket, `senderPhone → {tenantBaseUrl, token}` map, `POST /send`.
2. Console `POST /api/whatsapp/inbound` (token-gated) → `handleTasking` → reply via router `/send`.
3. Extract the transcribe/vision/receipt pipeline currently inline in `whatsappGateway.ts` so both the in-process socket and the router-fed inbound share it (no logic fork).
4. Ops runbook: one socket = one failure domain; zombie-container guard from memory applies.

## Why this is the honest call
The container-per-tenant model already gives every tenant a working chat surface (Console UI) and Telegram. WhatsApp-shared-number is the *one* Phase-0 item that fights the isolation model (a shared socket is a shared surface) and is untestable from a dev box. Shipping A/Telegram now and scoping B for P1 keeps the launch honest and the live socket safe — exactly the fallback the ticket anticipated.
