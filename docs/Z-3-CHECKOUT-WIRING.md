# Z-3 · LIVE €5/mo Stripe Checkout → webhook → Z-2 provisioning

**Status: SITE READY, CHECKOUT BLOCKED-on-credentials.** The website ships the hosted
call-to-action as a placeholder `href="#"` (see the `TODO Z-3` comment in
`sites/zenod/index.html`). This doc is the exact wiring plan to make that button live.
The live half cannot be executed in this session: no LIVE Stripe keys, the Stripe MCP is
unauthenticated, and the control plane lives in the separate private repo `zenod-ai/cloud`
which is not in this checkout.

## Target flow

```
[site button] → Stripe Checkout Session (€5/mo sub)
             → payment succeeds
             → Stripe webhook (checkout.session.completed / customer.subscription.created)
             → zenod-ai/cloud webhook handler
             → provisioning queue (Z-2 machinery: mint tenant, scaffold repo, issue MCP token)
             → email customer their "paste into Claude" line
```

## Steps

1. **Create the LIVE product + €5/mo price in Stripe.**
   One recurring EUR price, €5.00/month, one SKU (ZD-1 DECIDED). Note the `price_…` id.
   - [BLOCKED-needs: LIVE Stripe secret key + account access; Stripe MCP here is unauthenticated]

2. **Create a Checkout Session (mode=subscription) for that price.**
   Either a static Payment Link (simplest for a single SKU) or a `checkout.session` created
   server-side by the cloud control plane. Set `success_url` / `cancel_url` back to the site.
   - [BLOCKED-needs: LIVE Stripe key to create the Payment Link / session]

3. **Point the site button at the resulting URL.**
   Replace `href="#"` in the hosted `.path` block of `sites/zenod/index.html` (marked by the
   `TODO Z-3` comment) with the LIVE Payment Link / Checkout URL. This is the only site edit
   remaining and can be done the moment step 2 yields a URL.
   - Doable here once the URL exists; the URL itself is [BLOCKED-needs: steps 1–2].

4. **Register the webhook endpoint in Stripe** pointing at the `zenod-ai/cloud` handler
   (the Stripe-webhook→provisioning-queue service already documented in the cloud control
   plane). Subscribe to `checkout.session.completed` and `customer.subscription.created/deleted`.
   - [BLOCKED-needs: access to zenod-ai/cloud repo to confirm the handler route + deployed URL]
   - [BLOCKED-needs: LIVE Stripe dashboard access to add the endpoint + copy the signing secret]

5. **Wire the webhook handler to the Z-2 provisioning entrypoint.**
   On `checkout.session.completed`, enqueue a provisioning job that runs the Z-2 machinery:
   create the per-tenant instance, scaffold/connect the GitHub vault repo, mint the MCP token,
   run the setup wizard end state, and email the "paste this into Claude" line. Verify the
   Stripe signature with the endpoint signing secret before enqueueing.
   - [BLOCKED-needs: Z-2 provisioning endpoint must exist + be reachable (sibling worker Z-2)]
   - [BLOCKED-needs: STRIPE_WEBHOOK_SECRET set in the cloud service env]

6. **Set env on the cloud control plane service** (Dokploy `cloud.zenod.dev` per memory):
   `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.
   - [BLOCKED-needs: LIVE credential values + Dokploy env access for the cloud service]

7. **Verify end-to-end in prod** (the Epic acceptance test): a real card completes €5 checkout,
   the subscription shows in Stripe, provisioning fires with no human touch, customer gets their
   token.
   - [BLOCKED-needs: everything above + a real card in prod]

## BLOCKED-needs summary

- LIVE Stripe secret key + authenticated Stripe access (MCP here is unauthenticated)
- LIVE €5/mo price id (step 1 output)
- LIVE Checkout / Payment Link URL to drop into the site (step 2 output)
- Access to private repo `zenod-ai/cloud` (webhook handler route + deployed URL)
- LIVE Stripe webhook endpoint + signing secret (STRIPE_WEBHOOK_SECRET)
- Z-2 provisioning endpoint live and reachable (sibling worker)
- Dokploy env access on the `cloud.zenod.dev` service to set the three Stripe vars
- A real card + prod run for the acceptance test

## What IS done here (no credentials needed)

- Site ships both paths; hosted CTA is a clearly-commented placeholder ready for the URL.
- Site edit for step 3 is a one-line change gated only on the URL existing.
- Legal minimum (ToS + Privacy, Epic-2 H-11 DRAFT) linked and self-contained under the site.
