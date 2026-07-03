# Hosted Zenod / Council — Container-per-Tenant Plan (2026-07-02)

**Decision proposed:** one public repo, one image, one container stack per paying tenant. No private fork of the product. The only private code is a small **control plane** (signup, billing, credit API, provisioner) that never touches engine code.

---

## 1. What memory already says (reviewed)

Two prior analyses exist and they *agree with your instinct*, not with "pooled multi-tenant is ready":

- **2026-06-15 plan**: the engine is multi-tenant-*capable* (`createEngine` is fully dependency-injected, per-vault WriteQueue, `onUsage` metering; single-tenancy lives only in `packages/server`). That's the claim "the guy" made. It's true at the engine layer — but it argued for a **separate private hosted repo** wrapping core, which is exactly the two-codebase outcome you hate.
- **2026-06-16 overhaul** (post-#140 shared-connections/auth-bus): the connections platform's trust model is **reachability = authorization**. In a pooled process, tenant A's runtime could pull tenant B's tokens off the shared network unless the connections API is tenant-scoped (ticket N1) — a security-critical surface where one bug = cross-tenant credential leak. Conclusion on record: **per-tenant network isolation (Option C) is favored**, preserving the self-host auth model with *zero code change*.

So: container-per-tenant is not the lazy option — it's the option your own security analysis already recommended. And it kills N1 entirely (the network *is* the tenant boundary).

**Alpha deck alignment** (`alpha-research-deck.html`, 2 Jul): Zenod/Council scored 27/30; agentic social is the validated cluster (Postiz $157k MRR +22%); the open slot is the *memory-fed autonomous team*; recommended pricing is agency-replacement ($500–$3k/mo), and weeks 1–2 = sell as semi-manual productized service. The hosting plan below is built to serve that 90-day plan, not delay it.

## 2. Architecture

```
PUBLIC repo (zenod-ai/zenod)                    PRIVATE control plane (tiny, new)
─────────────────────────────                   ──────────────────────────────────
Same image for everyone.                        - Signup + Stripe (subscription + metered credits)
AGENT=console|zenod|archus|                     - Tenant registry (tenant → subdomain, stack, phone)
      epaminon|phylax|outbound                  - Provisioner (create/upgrade/suspend tenant stacks
Optional env in hosted mode:                      via Dokploy API)
  CREDIT_API_URL=...                            - CREDIT/LLM GATEWAY: OpenAI-compatible proxy that
  LLM_BASE_URL=<our gateway>                      meters tokens, applies markup, enforces balance
  LLM_API_KEY=<per-tenant virtual key>          - Shared WhatsApp platform number router
                                                  (sender phone → tenant webhook)
```

**Key moves:**

1. **Hosted mode = env vars, not a branch.** The repo already selects roles via `AGENT=`. Add two optional envs: an LLM base URL/key (points at our metering gateway) and a credit API URL. Self-hosters never set them; behavior is identical to today. The repo is transparent that these hooks exist ("hosted mode talks to a credit API"), but the credit API itself is closed. This is the standard open-core pattern (GitLab, Cal.com, Postiz itself, n8n): public product repo + private billing/control plane. Nobody forks the product for hosting.

2. **Token economics via the LLM gateway, not inside the engine.** Every hosted container gets a per-tenant virtual key to our OpenAI-compatible proxy (LiteLLM proxy or OpenRouter provisioned keys both do this off the shelf: per-key budgets, spend tracking, model allowlists). Our keys upstream → we resell tokens with a markup. Engine's existing `onUsage` metering is a bonus for the dashboard, but **enforcement lives in the gateway**, so a buggy or hacked tenant container still can't overspend — the key just stops working when credit hits zero. This is why "our keys + markup" beats BYO-keys for hosted: enforcement is external to the tenant bubble.

3. **Tenancy unit = the suite** (per the 06-16 assessment): one compose stack per tenant = console + zenod + archus + epaminon + phylax/outbound on a private per-tenant docker network, one volume, one subdomain `z-<name>.zenod.dev` via Traefik. Exactly the stack you run today, stamped out.

## 3. Pricing (aligned with the deck)

- **Agency tier — the product**: **$500–$1,000/mo flat**, tokens included up to a generous cap, then metered top-up. Deck's verdict: price as headcount ("the team that knows your company and posts for you"), not as software. Design partners at $300–500/mo per the 90-day plan; list at $1k.
- **Console tier**: ~$99–$200/mo including a starter credit bundle, then pay-as-you-go tokens at cost + ~30% markup. For people who want the whole council, visible costs, model choice.
- No BYO API keys in hosted (that's what self-host is for). One decision, one message: *you pay us, everything works*.

Unit economics sanity check: a dedicated suite stack idles at well under €5/mo of VPS share (a CX42-class Hetzner box ≈ €20/mo hosts ~5–10 tenant stacks; RAM is the binding constraint, mostly whisper). Even at $99/mo the infra margin is fine; at $500+ it's noise. Scale problem = "buy more €20 boxes," which is a good problem.

## 4. How hosted tenants track the repo (your "do they auto-update?" question)

Yes, and it's one mechanism for you and for them:

- CI builds a versioned image from `main` → pushes to a registry (`ghcr.io/zenod-ai/zenod:latest` + sha tags).
- Every tenant stack (including **yours — tenant zero**) runs the registry image instead of building from source.
- Provisioner exposes one action: **"roll fleet to :latest"** — iterate tenant stacks via Dokploy API, pull, restart, health-check, continue (stop on first failure = free canary; make *your* stack first in the ring).
- You move yourself onto a hosted tenant container immediately and dogfood the exact artifact customers run. Self-hosters keep building from source; same code, different delivery.

## 5. What happens when a user joins (behind the covers)

1. Lands on zenod.dev → **Stripe Checkout** (subscription).
2. Stripe webhook → control plane creates tenant record, picks subdomain.
3. Provisioner (Dokploy API) creates the compose stack from the tenant template: registry image, `AGENT` roles, per-tenant network + volume, Traefik domain, per-tenant LLM virtual key minted on the gateway with an initial budget.
4. Vault bootstrap: create a private GitHub repo under their account via GitHub App install (they click "Install" during onboarding) — or start with a platform-held repo and offer "export/transfer to your GitHub" later (simpler day-1, still honors the ownership story).
5. They enter their phone number → allowlisted on the **shared WhatsApp platform number** (per the 06-15 taxonomy: one Baileys singleton, sender-phone → tenant routing; no per-tenant sockets). WhatsApp bot starts responding.
6. Console UI at their subdomain: chat with the council, click-through OAuth for Google Drive/GitHub (the existing connections platform, unchanged — network isolation means its trust model needs zero hardening).
7. Credit runs down → gateway 402s → console shows "top up" → Stripe metered invoice or credit purchase.

Suspend = stop stack + revoke virtual key. Delete = export vault repo to them, destroy volume.

## 6. Backlog to live-paid

Reconciled with the 06-16 ticket list: T1–T3 (resolvePrincipal/TenantContext/SuiteRuntime) and **N1 are DROPPED** — container-per-tenant makes them unnecessary. #140's cross-account GitHub-auth blocker mostly dissolves too: each hosted tenant installs the GitHub App on *their own* account (single-account installs, the case that already works).

### Phase 0 — Concierge launch (this week; "live tomorrow" honestly = 2–3 days)
- [ ] **P0.1** Stripe payment link(s) for design-partner tier. *(hours)*
- [ ] **P0.2** CI: build + push image to ghcr; convert your own stack to run from registry image (tenant zero). *(half day)*
- [ ] **P0.3** Tenant compose **template** (parameterized: name, domain, volume, env) — checked into the repo or the control-plane repo. Provisioning is **manual**: you paste it into Dokploy per customer. *(half day)*
- [ ] **P0.4** LLM gateway v0: LiteLLM proxy container (or OpenRouter provisioned keys) — per-tenant key with budget cap; tenant env points at it. *(half day — this is the one piece you should not skip even in concierge mode, it's the meter)*
- [ ] **P0.5** WhatsApp: shared-number allowlist routing for a second sender phone → second tenant. *(1 day; if hairy, first customers get Telegram + console only, WhatsApp in P1)*
- [ ] **P0.6** Onboard 1–3 design partners by hand at $300–500/mo. Per the deck: sell before software.

### Phase 1 — Self-serve skeleton (weeks 1–3)
- [ ] **T5** Accounts: signup, magic-link auth, tenant registry DB.
- [ ] **T8** Provisioner: Stripe webhook → Dokploy API stack creation, subdomain, key minting; suspend/resume on payment state.
- [ ] **T10/T12** Metering + quota surfaced in console UI (usage page reads gateway spend API).
- [ ] **T11** Stripe metered billing / credit top-ups replacing manual invoices.
- [ ] **T9** Landing + onboarding flow (phone number, GitHub App install, Drive OAuth checklist).
- [ ] Hosted-mode UI flag: hide model/key plumbing on Agency tier; show it on Console tier (one codebase, one env var, e.g. `UI_MODE=agency|console`).
- [ ] Fleet roll command + health checks (canary = tenant zero).

### Phase 2 — Hardening (weeks 3–6, in parallel with customer growth)
- [ ] **T13/T14** Channel polish: WhatsApp shared-number ops runbook, Telegram bot per tenant.
- [ ] **T15** Hosted runner: Epaminon credentials via connections pull (drop legacy gh-auth volume).
- [ ] Per-tenant backup: nightly vault-repo push is already the backup for memory; add volume snapshot for sqlite state.
- [ ] Capacity: second VPS + placement logic in provisioner (tenant → host mapping).
- [ ] Abuse/isolation review: egress rules per tenant network, resource limits (mem/cpu) in the template.

### Explicitly deferred
- Pooled multi-tenancy (Option A + N1): only revisit if tenant count makes per-stack cost real (>~100 tenants). The migration path exists (engine is DI-ready) — that was the *correct* takeaway from the earlier conversation. You're not choosing against multi-tenant; you're deferring it until it pays.
- Scale-to-zero micro-VM platforms (Fly Machines etc.): nice later; Dokploy on Hetzner is fine to ~50+ tenants and you already operate it.

## 7. Open questions (small, none blocking Phase 0)

1. **Vault ownership at signup**: their GitHub from day 1 (stronger story, more onboarding friction) vs platform-held repo with export (frictionless, "your data is one click from leaving"). Recommend platform-held for Agency tier, own-GitHub for Console tier.
2. **Gateway choice**: LiteLLM proxy (self-hosted, free, per-key budgets) vs OpenRouter provisioned keys (zero ops, they take ~5%). Recommend starting OpenRouter-provisioned (you already run on OpenRouter), swap to LiteLLM when margin matters. **Shipped v0**: `scripts/gateway/openrouter-key.mjs` (P0.4/#452) — per-tenant budget-capped provisioned keys.
3. **Control-plane repo**: `zenod-ai/cloud` private — contains only provisioner, billing, gateway config, tenant template. Confirm this doesn't offend the one-repo instinct: the *product* stays one public repo; this is infrastructure, like your Dokploy config already is.

## 8. Public/private boundary — the rule that keeps it ONE codebase

The fear: hosting forces us to maintain "two shapes" (a self-host shape and a hosted shape) in one repo. It does not — *if* we hold one line.

**The line.** The public tenant image only ever gains **additive, dormant hooks**; it never *forks behavior* and never *gates a feature off* for self-host. All hosted orchestration lives in a **separate private control plane** (`zenod-ai/cloud`) that drives those hooks from outside and never touches engine code.

| Public tenant image (`zenod-ai/zenod`) | Private control plane (`zenod-ai/cloud`) |
|---|---|
| Engine + tools + channels + UI (unchanged) | Provisioner (Stripe → Dokploy), billing, tenant registry |
| Optional hooks: `LLM_BASE_URL`/`LLM_API_KEY`, credit API URL | LLM gateway keys (`openrouter-key.mjs` runs here) |
| Channel adapters with an **injectable transport** (see §9) | The wa-router service (reuses the public adapter, adds routing) |

**Litmus test — a hosted need may enter the public image ONLY if it is:**
1. **env-selected** (off by default),
2. **inert/safe when unset** (self-host with zero hosted env is fully functional), and
3. **useful-or-harmless to self-host** (a generic capability, not a hosted wart).

If a change can't meet all three, it belongs in the private control plane, not the image.

**Enforce it, don't trust it.** A discipline erodes over a year of PRs. Corral hosted hooks in a clearly-named module and add a CI check that boots the image with **no hosted env** and asserts full self-host function. That turns "one shape" from a promise into a test.

## 9. Channel transport seam (WhatsApp, and any channel)

Decision from the 07-03 discussion (supersedes the shared-socket framing in the P0.5 doc; self-host WhatsApp is unchanged).

**How subscribers reach the council on WhatsApp:** one **service number we control** (not the subscriber's own "me", not Cloud API). A single central **wa-router** holds one Baileys socket and a `senderJID → tenant` map (from the signup registry); it relays each subscriber's messages to their tenant and replies back out the one socket. This solves the identity objection (subscribers talk to a dedicated bot number) and avoids Cloud API cost.

**Why this is one shape, not two:** refactor each channel adapter to split **transport** (receive/send) from **pipeline** (transcribe → `handleTasking` → receipt). Then transport is injectable:
- self-host wires the **socket transport** (Baileys in-container — today's behavior);
- hosted wires the **relay transport** (inbound at token-gated `POST /api/whatsapp/inbound`; outbound via an injected `send()` that posts to the router). No socket in the tenant container.

The router itself **imports the same public Baileys adapter** (e.g. `AGENT=wa-router`), so the fragile, ban-prone socket code lives **once**, in public, dogfooded by every self-host user daily. The private part is just a lookup table + HTTP fan-out.

**Known costs (build it eyes-open — see #474):**
- **The seam is fatter than text.** WhatsApp media is encrypted and only fetchable through the authenticated socket, so the relay contract is `{text, media-bytes, receipts, presence}`, not a string — the router downloads media and ships bytes; typing/read-receipts proxy back through it. This is the fiddly part.
- **Shared failure domain + ban risk.** One unofficial-API number auto-replying to many strangers is a textbook ban pattern, and a ban takes *all* tenants down at once. Treat Baileys-router as a **deliberate MVP with a scale cliff**: past some volume you migrate to Cloud API. The routing layer is reusable then; the media/receipt transport is not — so it's a partial rebuild, knowingly accepted.
- **Sequencing.** This is **P1**, after the money path (Telegram + Console + Stripe #449 + provisioner #456). It does not gate the concierge launch.
