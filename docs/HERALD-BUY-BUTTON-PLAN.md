# H-3 · Herald buy button — one card → full stack provisioned, zero human touch

**Status: SITE PAGE READY (placeholder CTA), PROVISIONING BLOCKED-on-credentials + on new machinery.**
Blueprint only. This session creates **no** LIVE Stripe SKU, writes **no** provisioning code,
and stores **no** real keys. Herald's site (`sites/herald/index.html`) ships the "Get Herald"
button as a clearly-commented `href="#"` placeholder (`TODO H-3`); this doc is the exact wiring
plan to make it live.

Grounded in the proven Zenod path (`docs/Z-3-CHECKOUT-WIRING.md`,
`docs/EPIC-2.3-ZENOD-MOVE-0.md`) and the epic (`docs/EPIC-2.6-HERALD-MOVE-0.md`, row H-3 +
HD-1/HD-2/HD-3). The live half cannot run here: no LIVE Stripe keys, the Stripe MCP is
unauthenticated, and the control plane lives in the separate private repo `zenod-ai/cloud`
(not in this checkout — same constraint noted in `docs/Z-3-CHECKOUT-WIRING.md`).

## Decisions this plan encodes

- **HD-1 · One SKU, ~$200/mo LIVE.** A single recurring price. Final number via Product-Fable /
  Epic 0. Credits for LLM spend per the **ZD-5 / D-5** pattern (`docs/EPIC-2.3-ZENOD-MOVE-0.md`
  §ZD-5: bundled prepaid credits, gateway balance is truth, warn→block→top-up).
- **HD-2 · Supervised at launch.** Provisioning wires Herald in supervised mode: every post
  requires the customer's ✓ (enforced in H-4, not here). The buy flow must set the supervised
  flag as a provisioning config default; **auto-send is never provisioned on at launch.**
- **HD-3 · Customer #0 = the Zenod project itself** (dogfood). The first run of this whole path
  provisions a stack that runs zenod's own public presence — the demo AND the launch content.
  Do the dogfood provision before charging customer #1.

## Target flow

```
[site "Get Herald" button]
  → Stripe Checkout Session (mode=subscription, ~$200/mo, one SKU — HD-1)
  → payment succeeds
  → Stripe webhook (checkout.session.completed / customer.subscription.created)
  → zenod-ai/cloud webhook handler (verify signature)
  → provisioning queue: provision the FULL Herald stack for one tenant
       ├─ ring nucleus   (Phylax gateway + core: mailbox, provenance, verbatim relay, `* → Herald` route)
       ├─ Herald guy     (LLM + MCP client to Zenod + Callisthenes — per-unit tokens injected)
       ├─ Zenod unit     (memory; per-tenant repo + MCP token — Z-2 machinery)
       ├─ Callisthenes   (outbound voice; holds the tenant's sending keys — the ONLY key-holder)
       ├─ credits meter   seeded on Herald's gateway key (ZD-5/D-5)
       └─ watchdog registration for all four containers (ZD-10 path)
  → QR pairing artifact delivered to the customer (email / success page), zero human touch
```

Herald is provisioned **inside a one-room ring** (per the epic's converged design). WhatsApp is
wired into the **ring nucleus** (Phylax/Baileys/QR), never into Herald. The customer pairs by QR
and talks; Herald never touches WhatsApp or sending keys.

## What already exists vs what is NEW for Herald

| Step | Reuse (exists) | New for Herald |
|---|---|---|
| Checkout session | Zenod's proven Stripe Payment Link pattern (live link in `sites/zenod/index.html` line ~170; `docs/Z-3-CHECKOUT-WIRING.md`) | A **new ~$200/mo SKU** (HD-1) — currency/number per Product-Fable |
| Webhook handler | `zenod-ai/cloud` control plane (Dokploy `cloud.zenod.dev`, per `docs/Z-3` step 4–6 + memory "Zenod cloud control plane") | A **route/product branch** that dispatches to the Herald-stack provisioner, not the single-container Zenod provisioner |
| Provision Zenod unit | Z-2 machinery: mint tenant instance, scaffold/connect vault repo, issue MCP token (`docs/EPIC-2.3-ZENOD-MOVE-0.md`; tokened-URL handoff per ZD-8) | Provisioned as **one member of a 4-container stack**, not standalone |
| Provision Callisthenes | Unit exists (`sites/callisthenes/`; live per memory "Callisthenes deployed / Callisthenes capability epic"); it is the sole sending-key holder | Provisioned per-tenant + its **per-unit MCP token handed to Herald** as his mouth |
| Ring nucleus | Nucleus code = first installment of 2.7, extracted from the fused Console in **H-1** (epic row H-1) | **Depends on H-1** shipping the nucleus container + QR pairing runbook; provisioner instantiates one nucleus per tenant with the one-row `* → Herald` routing table |
| Herald guy | Suite-agent pattern (`docs/SUITE-AGENT-PATTERN.md`); guy container built in **H-2** | Provisioner injects **per-unit tokens** for Zenod + Callisthenes at provision time (never world keys); sets memory-seam URL+token and mouth URL+token as config |
| Credits / meter | D-5 gateway metering + ZD-5 bundled-credits + ZD-7 starter grant (`docs/EPIC-2.3-ZENOD-MOVE-0.md` §ZD-5/ZD-7); gateway key mint in `scripts/gateway/openrouter-key.mjs` | Meter seeded on **Herald's** gateway key; starter-credit number is a Herald CONFIG VALUE (Herald's own ZD-7 equivalent) |
| Watchdog | `scripts/watchdog/` (`zenod-watchdog.sh`, `.service`, `.timer`, `install.sh`); ZD-10 cloud-fed-list bootstrap (`docs/EPIC-2.3-ZENOD-MOVE-0.md` §ZD-10) | Register **all four** stack containers via the ZD-10 cloud-fed list — one provision writes four rows, no host change per tenant |
| QR delivery | QR pairing is a nucleus capability (H-1 runbook) | Provisioner surfaces the pairing QR/link to the customer (success page / email) as the last, human-touchless step |

## Steps (each tagged reuse / NEW; BLOCKED-needs noted)

1. **Create the LIVE product + ~$200/mo recurring price in Stripe.** One SKU (HD-1). Note the
   `price_…` id. *(NEW SKU; same mechanism as Z-3 step 1.)*
   - [BLOCKED-needs: LIVE Stripe secret key + account access; Stripe MCP here is unauthenticated]
   - [BLOCKED-needs: final currency + number from Product-Fable / Epic 0]

2. **Create a Checkout Session / Payment Link (mode=subscription)** for that price, with
   `success_url` back to the Herald site (ideally a page that shows/links the pairing QR).
   *(Reuse Zenod's Payment-Link approach.)*
   - [BLOCKED-needs: LIVE Stripe key to create the link/session]

3. **Point the site button at the resulting URL.** Replace `href="#"` in the `.get` block of
   `sites/herald/index.html` (marked `TODO H-3`) with the LIVE Checkout/Payment Link URL. One-line
   edit, doable the moment step 2 yields a URL — exactly as Zenod did (`sites/zenod/index.html`).

4. **Register the webhook endpoint in Stripe** → the `zenod-ai/cloud` handler. Subscribe to
   `checkout.session.completed` and `customer.subscription.created/deleted`. *(Reuse the existing
   endpoint; add a Herald-product branch.)*
   - [BLOCKED-needs: access to `zenod-ai/cloud` to add the Herald route + confirm deployed URL]
   - [BLOCKED-needs: LIVE Stripe dashboard access to add the endpoint + copy the signing secret]

5. **Wire the handler to a Herald-stack provisioner.** On `checkout.session.completed` (after
   verifying the Stripe signature with the endpoint signing secret), enqueue a provisioning job
   that stands up the full 4-container stack in order:
   nucleus (H-1) → Zenod (Z-2) → Callisthenes → Herald (H-2), then injects per-unit tokens into
   Herald, seeds the credits meter on Herald's gateway key (ZD-5/ZD-7), registers all four in the
   watchdog (ZD-10), and emits the pairing QR to the customer. **Supervised flag ON (HD-2).**
   *(NEW orchestration; each sub-step reuses an existing provisioner/machinery.)*
   - [BLOCKED-needs: H-1 nucleus container + QR runbook shipped]
   - [BLOCKED-needs: Herald guy (H-2) container + its provisioning entrypoint]
   - [BLOCKED-needs: per-tenant Callisthenes provisioning reachable]
   - [BLOCKED-needs: `STRIPE_WEBHOOK_SECRET` set in the cloud service env]

6. **Set env on the `cloud.zenod.dev` service** (Dokploy): `STRIPE_SECRET_KEY` (live),
   `STRIPE_WEBHOOK_SECRET`, and the Herald `STRIPE_PRICE_ID`. *(Reuse Z-3 step 6 mechanism; per
   memory "Dokploy env not via API" — compose env CAN be set via API; the old 403 was Cloudflare's
   WAF.)*
   - [BLOCKED-needs: LIVE credential values + Dokploy env access for the cloud service]

7. **Dogfood first (HD-3).** Run the whole path once to provision **customer #0 = the Zenod
   project's own public presence** before charging customer #1. Verify against the checklist below.
   Then Jordi runs the full funnel as customer #1; a tester repeats as a stranger.
   - [BLOCKED-needs: everything above + a real card in prod]

## Security invariants (do not violate)

- **Herald holds per-unit tokens only — never world keys.** Zenod token (his memory) and
  Callisthenes token (his mouth) are injected at provision time and scoped to those units.
- **Posting goes only through Callisthenes.** Callisthenes is the sole holder of the tenant's
  outbound (X / Reddit / email) sending keys (`sites/callisthenes/index.html`; epic boundary "↔
  2.4: no outbound keys in Herald, ever"). Herald asks; he never sends directly.
- **WhatsApp is wired into the ring nucleus, never into Herald** (epic converged design).
- **Verify the Stripe signature** before enqueueing any provisioning job (Z-3 step 5).
- **No world/admin keys in the tenant.** Each unit gets only its own scoped credentials.

## Acceptance-test checklist (matches H-3 test criteria in the epic)

Epic H-3 criteria: *"real card → stack live + QR delivered, zero human touch; all containers in
watchdog; credits meter on Herald's key."*

- [ ] A **real card** completes the ~$200/mo Stripe checkout (HD-1); subscription shows in Stripe.
- [ ] Webhook fires; signature verified; provisioning enqueued **with no human touch**.
- [ ] **Ring nucleus** container is live (Phylax gateway; one-row `* → Herald` route).
- [ ] **Herald** container is live with per-unit tokens for **Zenod** and **Callisthenes** wired
      (verified: Herald can read memory + reach the mouth; Herald holds **no** world keys).
- [ ] **Zenod** unit live with its own per-tenant repo + MCP token.
- [ ] **Callisthenes** unit live and is the **only** holder of the tenant's sending keys.
- [ ] **Credits meter** is active on **Herald's** gateway key; starter grant applied (ZD-5/ZD-7);
      balance is truth, warn-at-threshold and block-at-zero behave (per D-5).
- [ ] **All four containers registered in the fleet watchdog** (ZD-10 cloud-fed list; no per-tenant
      host change).
- [ ] **QR pairing artifact delivered** to the customer (success page / email); scanning it pairs
      WhatsApp to the nucleus and reaches Herald.
- [ ] **Supervised mode is ON (HD-2):** no auto-send is provisioned; posting-✓ enforcement is
      wired (full posting behaviour lands in H-4).
- [ ] **Dogfood (HD-3):** the very first successful run provisions customer #0 = the Zenod
      project's own presence, before customer #1 is charged.

## BLOCKED-needs summary

- LIVE Stripe secret key + authenticated Stripe access (MCP here is unauthenticated).
- The ~$200/mo Herald SKU price id + final number (Product-Fable / Epic 0).
- LIVE Checkout / Payment Link URL to drop into `sites/herald/index.html` (`TODO H-3`).
- Access to private repo `zenod-ai/cloud` (add the Herald webhook route + confirm deployed URL).
- LIVE Stripe webhook endpoint + `STRIPE_WEBHOOK_SECRET`.
- H-1 nucleus (container + QR runbook), H-2 Herald guy, and per-tenant Callisthenes provisioning
  all reachable from the provisioner.
- Dokploy env access on `cloud.zenod.dev` to set the three Stripe vars.
- A real card + prod run for the acceptance test (dogfood first, HD-3).

## What IS done here (no credentials needed)

- Herald site ships with the "Get Herald" CTA as a clearly-commented `href="#"` placeholder
  (`TODO H-3`), style mirrored from `sites/zenod/`.
- This wiring plan, grounded in the proven Zenod/Z-2/Z-3 machinery, watchdog (`scripts/watchdog/`),
  and ZD-5/ZD-7/ZD-8/ZD-10 decisions — each step tagged reuse vs NEW.
- The site edit for step 3 is a one-line change gated only on the LIVE URL existing.
