# EPIC 2 · HOSTED PRODUCT READINESS

Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md) · Positioning: launch deck V5 · Journeys: user-journeys deck (T1, J7–J9)
**Exit criterion: a stranger pays money and gets a working Council attached to their repo. Jordi is customer #0 and doesn't count.**

Status: 🟡 SCOPING. **Gated by Epic 1** — no executor capacity until stability P0s close. The only work
allowed now is the D-1 decision and this document.

---

## The launch product (Jordi, 2026-07-03)

**The launch SKU is the three-role project council:** a council attached to a PROJECT repo — memory
about the project, not the person — running the planner→executor→tester loop against one living
iteration doc. The generic personal council stays as a configuration users can turn on (voice notes,
ad-hoc Epaminon, memory Q&A) — we don't lose it, we just don't lead with it. Jordi is customer #0 of
the project council. Self-hosting is not core to this product; open-source likely but optional — decide
later, create no legacy now.

## Step 0 gate · D-1: hosting shape — DECIDED

| Option | Time to first invoice | Risk |
|---|---|---|
| **A. Managed single-tenant** — one container per customer, the exact image we dogfood, provisioned by us | ~days | ops toil per customer; fine at first 10–50 |
| B. Multi-tenant shell | weeks+ | rewrite of settings/auth/storage mid-stabilization |
| C. Self-host only (docs + docker run) | ~days | no recurring revenue muscle; support burden |

**DECIDED 2026-07-03 (Jordi): A — managed single-tenant.** Same image we dogfood, one container per
customer. Self-host stays as funnel (C), B deferred until revenue proves it.

## Tickets (high level — refined into acceptance-criteria form once D-1 is decided and Epic 1 exits P0)

### H-1 · Provisioning path: signup → running Council  (P0)
One command/script that stands up a customer container (image, volumes, env, WhatsApp or web channel),
scaffolds the vault repo (schema v1 commit), and returns the customer's console URL. This is J7 with us
pressing the button; automation comes later.
**Accept:** a fresh test customer provisioned end-to-end in <30 min without editing code.

### H-2 · Checkout: a button that charges money  (P0)
Stripe checkout on the site (apps/site), one plan to start, webhook → provisioning queue (H-1 manual
fulfillment is acceptable at launch). No invoicing by hand.
**Accept:** a real card (Jordi's) completes checkout in prod; subscription visible in Stripe; provisioning
task created with the customer's details.

### H-3 · Bring-your-own credentials onboarding  (P0)
Guided connect: GitHub (vault repo — GitHub App, not PATs), X, Google Drive; each connection visibly
unlocks its journeys (J8). Secrets stored per-tenant, never in the vault.
**Accept:** a non-technical tester connects GitHub + X unaided in <20 min.

### H-4 · Onboarding interview → first backlog  (P1)
J9: the Council interviews the new customer (what do you do, for whom, what voice), files answers as
memory, proposes the first post backlog on the board.
**Accept:** fresh tenant reaches a reviewable first backlog within one session.

### H-5 · Operator guardrails for strangers  (P1)
Throttles, quiet hours, spend caps, and the approval gates from Epic 1 — configured per tenant with sane
defaults. What makes "an agent posts as my company" safe enough to buy.
**Accept:** default tenant cannot exceed N posts/hour or $X/day model spend; caps visible and editable.

### H-6 · Public proof: dogfood in the open  (P2, continuous)
Zenod's own X/Reddit presence run by Zenod (T0 loop), TrustMRR listing once revenue exists. The growth
chart is the sales page.
**Accept:** T0 loop posting on the real account under H-5 guardrails; TrustMRR listed at first MRR.

---

## Non-goals at launch
Multi-tenant architecture (that's option B, later). Marketplace/agents-for-hire. Composio long-tail
connectors. Anything that competes with Epic 1 for workers.

## Worker/tester append zone (same doc, never a new file)

<!-- executors and testers: add dated entries below this line; deliverable URLs mandatory -->

### 2026-07-04 · Worker (Product-Fable lane) — H-1 receipt verify · H-11 drafts · H-2 blocked

**Doc-state note (read first).** My handover brief sequenced work against a "Week 1 → Stripe
checkout" section plus H-11 and decisions D-4/D-5. Those live in `docs/HANDOVER-EPIC2.md` (untracked)
— they have **not yet been folded into this epic doc**, which still carries the H-1..H-6 / D-1-only
scoping. So this doc currently lags its own handover. Flagging for the planner to rewrite the state
sections (that's Product-Fable's pending first move per HANDOVER-EPIC2 line 149-152). My references
below trace to HANDOVER-EPIC2 and HOSTED-PLAN-2026-07-02 accordingly.

**H-1 · P0.2 (CI → ghcr) — ✅ PASS, landed and live.**
- Workflow: [`.github/workflows/publish.yml`](.github/workflows/publish.yml) — builds runtime stage on
  every push to `main`, pushes `ghcr.io/zenod-ai/zenod:latest` + `:sha-<short>`. Committed in
  `2ac7425` ("P0.2: publish runtime image to GHCR + tenant-zero registry compose (#470)").
- **Not just present — actually pushing.** Latest run `28691857903` (push of `e0a330f`, 2026-07-04
  02:15Z) = success; logs show `#38 pushing manifest for ghcr.io/zenod-ai/zenod:latest@sha256:8dbb5d0c…`
  and `…:sha-e0a330f@sha256:8dbb5d0c795e731603e5f7446a53dcfb08b0efa5021e3cdd804bc3ac8039d298 done`.
  Run URL: https://github.com/zenod-ai/zenod/actions/runs/28691857903 . Every recent push to main shows
  the same green "Publish image" run.
- Tenant-zero registry compose (the "run from registry, not source build" half of P0.2):
  [`docker-compose.tenant-zero.yml`](docker-compose.tenant-zero.yml) — no `build:` block, pulls
  `ghcr.io/zenod-ai/zenod:${ZENOD_IMAGE_TAG:-latest}`, `pull_policy: always`.
- (Could not list the ghcr package versions via API — token lacks `read:packages` — but the push step
  logs are conclusive proof the tags were written.)

**H-1 · P0.3 (parameterized tenant compose template) — ✅ PASS, landed.**
- [`docker-compose.tenant.yml`](docker-compose.tenant.yml) — full suite (console+zenod+archus+epaminon
  +phylax+outbound) on a private `tenant-net`; only Console bridges `dokploy-network` for Traefik.
  Parameterized via env: `ZENOD_IMAGE_TAG`, `TENANT_NAME`, `PHYLAX_CONSOLE_TOKEN`. Committed in
  `89d376e` ("P0.3: parameterized tenant suite template (#471)").
- Env contract documented: [`.env.tenant.example`](.env.tenant.example) (incl. commented
  `LLM_BASE_URL`/`LLM_API_KEY` reserved for the P0.4 gateway).
- Litmus (§8 HOSTED-PLAN): hooks are env-selected and inert when unset — self-host composes
  (`docker-compose.z2.yml` etc.) still build from source unchanged. Passes.
- **Verdict: both P0.2 and P0.3 are DONE. H-2/H-3 are not blocked by missing provisioning primitives.**

**H-11 · Legal minimum — DRAFT pages authored (deliverable ready, not deployed).**
- Three self-contained DRAFT pages, `noindex`, prominent DRAFT banner, story = "customer owns the vault
  repo": [`apps/site/public/legal/terms.html`](apps/site/public/legal/terms.html),
  [`privacy.html`](apps/site/public/legal/privacy.html),
  [`data-handling.html`](apps/site/public/legal/data-handling.html). Cross-linked.
- Held on a branch + **HOLD PR** (not merged) so DRAFT legal text does NOT auto-deploy to the live
  marketing site before counsel review. **PR: https://github.com/zenod-ai/zenod/pull/523** (HOLD).
- Not yet "linked from checkout" (H-2 acceptance) because checkout does not exist yet — wiring the
  footer link is a one-line follow-up once H-2 lands.

**H-2 · Checkout — BLOCKED, stopped per protocol (did not improvise).**
Two hard blockers, both needing Jordi:
1. **Stripe keys/account access.** No Stripe code exists in the repo (confirmed: zero `stripe` refs
   outside agent worktrees). Even Stripe *test* mode needs a test secret key, and creating the
   product/price (the "ONE prepaid credit bundle" plan, D-5) needs dashboard access. Per brief: stop and
   ask for keys.
2. **Backend location decision (architectural, not mine to improvise).** `apps/site` is a **static
   nginx site** ([`apps/site/Dockerfile`](apps/site/Dockerfile) → `nginx:alpine`, no server). Stripe
   Checkout Session creation (needs the secret key) **and** the webhook receiver (`checkout.session
   .completed` → provisioning-queue entry) require a server-side endpoint that does not exist. HOSTED-PLAN
   §2/§8 puts billing + provisioner in the **private `zenod-ai/cloud` control plane** — which is not this
   repo and may not exist yet. Need Jordi's call on WHERE the checkout backend + webhook live before I
   build: (a) a serverless function alongside the site, (b) a route in the private control-plane repo,
   or (c) a minimal endpoint in an existing service. The §8 litmus applies to whichever touches the
   public image.
3. **(Minor) D-5 plan specifics not yet numbered** — bundle size/price for the "ONE plan" aren't recorded
   as a DECIDED value in this doc; HOSTED-PLAN §3 sketches Console ~$99–200/mo + starter credit bundle.
   Needs a decided figure for the pricing page.

What I did NOT do (deliberately): build a pricing page with a guessed price wired to a non-existent
checkout backend. Unblock items 1–2 and I can deliver the pricing page + test-mode Checkout + webhook
stub → provisioning-queue entry in one pass.

