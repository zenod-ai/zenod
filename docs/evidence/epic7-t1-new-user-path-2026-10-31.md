# EPIC-7 T1: new-user path audit, 2026-10-31

Read-only audit for [EPIC-7](../EPIC-7-REAL-USER-TEST.md) T1. Run `run_b7be352f`. Code is `main` at `5a95ff9`. Prod was read live 2026-10-31 23:14–23:23 UTC: Zenod `ae3e77a`, Phylax `dc24572`. Nothing was created or changed. No Stripe objects, accounts or messages were made. The repo is public, so this page leaves out promotion-code strings, Stripe IDs, tenant/user IDs and internal hostnames. Stripe was read with GET calls on VPS1, and the key was never printed.

## Summary

| # | Step | Status | One line |
|---|------|--------|----------|
| 0 | Readiness gate on checkout | **gap (T0 owns)** | `ready=false`. The only blocking check is `backup_restore`: the proof is from 2026-08-30 and the window is 31 days. Other dated proofs also expire during the test (see 0b) |
| 1 | Google signup | works (start verified live, callback by code) | `/auth/google/start` returns 302 to Google with PKCE and a nonce. `ZENOD_PUBLIC_GOOGLE_SIGNUP=1`. There are 2 Google identities on prod |
| 2 | Checkout with a 100% code (€0, no card) | works (proven 2× on live) / **gap at renewal** | 2 live `active` Zenod subscriptions have no payment method and a 100%-off coupon. A 1-month coupon becomes a €9 + VAT invoice at renewal with no card (see 2b) |
| 3 | Tenant created after checkout | works (2× on live) | Both €0 checkouts have a tenant, a Phylax tenant row and an active Phylax allowance binding |
| 3b | Vault connect (hidden step, not in the brief) | works once / unverified for a new user | Capture is fail-closed until a vault is `ready`. 1 of the 2 €0 tenants has a ready Drive vault. The other has none. The console opens on the Vault tab until a vault is ready |
| 4 | Phone linked to tenant on the Zenod production number | **unverified for any Stripe-born tenant** | The flow exists in code (one-time code sent to the shared number). Phylax has WhatsApp `connected`. Of 4 Phylax tenants, only 1 has a verified phone: a legacy non-Stripe, comped tenant. Neither €0 tenant ever linked a phone |
| 5 | First voice/text → "Saved" reply | **unverified for any Stripe-born tenant** | All Phylax paid work so far (242 rows, all `done`) belongs to the comped tenant. The Stripe-born tenants have none |
| 6 | Reply visible in the user's console | **gap / unverified** | The console shows subscription, usage and the channel's "Last message" time. The saved note itself lives in the user's vault (Drive/GitHub). No captures or replies list was found in the hosted console |
| M | Usage metering and caps | **gap (T3 input)** | Phylax channel/transcription spend is metered and pauses at a hard wallet cap, but the user is not told why. Zenod LLM spend (platform OpenRouter key) is counted in shadow only, with no allowance set on prod and no blocking |

## Step detail

### 0. Readiness gates checkout

- Code: `packages/server/src/productionReadiness.ts:220` `checkoutEnabled()`. In live mode it needs `ZENOD_PUBLIC_PAID_SIGNUP=1` and `report.ready`. `ready` ignores only the four advisory checks (`:21`). `backup_restore` (`:199`) needs `ZENOD_BACKUP_RESTORE_VERIFIED_AT` within 31 days. The service keeps serving when checks fail (`reportPublicSignupReadiness`, `:291`, called at `customerLayer.ts:300`), so existing tenants are unaffected and only new checkout closes.
- Bypass that already exists: `checkoutEnabledForOwner` (`productionReadiness.ts:228`) lets allowlisted owners check out while `ready=false`. The allowlist is matched by GitHub ID, user ID or a verified Google email (`ZENOD_LIVE_CHECKOUT_TESTER_GOOGLE_EMAILS`, set on prod). The 5 testers' Google emails could go on that list instead of waiting on T0. That is an env change, so the delivery manager decides.
- Live: `GET /api/public/production-readiness` returns 503 with `ready:false`, `publicPaidSignup:true`, `publicGoogleSignup:true`, `googleSignupReady:true`. The only failing blocking check is `backup_restore`. The failing advisory checks are `stripe_webhook`, `billing_portal`, `live_billing_journey` and `google_drive_vault_acceptance`. Prod env has `ZENOD_BACKUP_RESTORE_VERIFIED_AT=2026-08-30T15:22:23Z`. The Zenod log says: "production readiness checks failed: backup_restore. Serving normally; paid checkout stays disabled".
- 0b, dated proofs that expire during a 1–2 month test. These are blocking checks, not advisory, because Google signup is public:
  - `backup_restore`: 31-day window. Once T0 re-proves it, the proof has to be renewed every month.
  - `google_drive_vault_oauth` (`:86`): verified 2026-08-30, 90-day window, **expires 2026-11-28**. When it expires, checkout closes again.
  - `stripe_profile`: verified 2026-09-15, 90-day window, expires 2026-12-14.
- Observed while auditing: T0's `zenod-volume-backup.sh` was running (`epic7-t0-20261031`) and had **paused the Phylax container** for about 5 minutes (about 23:17–23:22 UTC, running again at 23:22). Inbound WhatsApp is not received while it is paused. Zenod's `/api/health` showed `eventLoop.maxMs` ≈ 139 s in an earlier window, which matches the same backup pause. This is fine for T0, but the testers' runbook (T6/T10) should know that backups pause the receiver.

### 1. Google signup

- Code: `customerLayer.ts:621` `/auth/google/start` → `startIdentityFlow` (PKCE + nonce cookie). `:623` callback → `completeIdentityFlow`. The new-identity gate is at `:570`: when `ZENOD_PUBLIC_GOOGLE_SIGNUP!=1` and the user is not allowlisted, it returns 403. The identity is created at `:587` with `identities.resolveOrCreate`.
- After sign-in, `apps/web/src/App.tsx` boot calls `/api/console/account`. A 404 response means no account yet, and the app shows `HostedAccount` with "Choose your Zenod plan" (`apps/web/src/views/HostedAccount.tsx:289`), whose button is `/buy?tier=monthly`.
- Live: `/api/auth/status` returns `signInMethods:["github","google"]`. `/auth/google/start` returns 302 to accounts.google.com with redirect_uri `https://cloud.zenod.dev/auth/google/callback`, `code_challenge_method=S256`. Readiness `google_identity_oauth` is ok. `customer-identities.json` has 2 Google and 1 GitHub identities.
- Status: works. The callback was not run, because that needs a Google login, which belongs to T7.

### 2. Stripe checkout with a 100% code

- Code: `customerLayer.ts:1377` `startCheckout` checks the session, the Google-open gate, `checkoutEnabledForOwner` (`:1391`, returns 503 "paid signup is not open" when closed) and refuses a second active or past_due subscription. It then calls `customerBilling.ts:138` `createCustomerCheckout`, which sets `mode: subscription`, `allow_promotion_codes: true`, `payment_method_collection: "if_required"` (`:160`), required billing address, tax ID and ToS consent, and automatic tax. `/buy` (`:1413`) redirects 303 to Stripe. `/checkout/complete` (`:1439`) accepts `payment_status` other than `paid` when `status === "complete"` (`:1460`), so a €0 `no_payment_required` session completes.
- Live: the price is €9.00/month, `active`, `tax_behavior: unspecified`, automatic tax on. Stripe has 2 `active` subscriptions with `metadata.product=zenod`, `collection_method=charge_automatically`, **no default payment method**, and a discount. Their periods end 2026-11-13 and 2026-11-15. The local accounts match them: 2 accounts, checkout completed 2026-09-15 and 2026-10-13. So the €0, no-card checkout has already worked twice in live mode.
- Live coupon state: there is 1 coupon, **100% off, `duration: forever`**, redeemed 2×. It has 1 promotion code, which is active, has **no `max_redemptions`, no `expires_at`, and no first-time restriction**. Anyone who has that code gets Zenod free forever. There is no "Zenod tester" 1-month coupon yet; T4 creates it.
- 2b, renewal with no card. Code: `customerLayer.ts:1471` `/webhook` handles `invoice.paid` / `invoice.payment_failed` (`:1506`) and `customer.subscription.updated|deleted` by re-reading the subscription from Stripe. The status map is at `customerBilling.ts:214`: `past_due`/`incomplete` → `past_due`, and `canceled`/`unpaid` → `canceled`. Entitlement is at `customerLayer.ts:367`: `active` or `past_due` keeps the tenant active, anything else suspends it and the Phylax binding.
  - With a 1-month coupon (the T4 plan), Stripe drafts the month-2 invoice at €9 + VAT. With no payment method, the charge fails and the subscription goes `past_due`. The user keeps access, but Stripe sends its "payment failed / update your card" emails if customer emails are on. After the dunning schedule (a Stripe dashboard setting that the API cannot read), Stripe either cancels the subscription, which suspends the tenant without warning, or marks it `unpaid`, which the code also maps to `canceled` and suspends. A tester who adds a card when prompted would be charged €9.
  - Status: **gap**. The monthly extension must land before each renewal invoice is drafted, which is about 1 hour before `current_period_end`, or the coupon must be multi-month or forever and revoked at the end. The dunning and email settings must be checked so nobody is charged or cut off without notice. T4 already has to prove this.

### 3. Tenant created after checkout

- Code: there are two paths, and both are idempotent through `checkout_completed_at`. One is the webhook `checkout.session.completed` (`customerLayer.ts:1482`). The other is the browser return `/checkout/complete` (`:1439`). Both call `completeCustomerCheckout` (`customerBilling.ts:180`). That calls `createLocalTenantBindingAdapter` (`customerTenantBinding.ts:61`), which reserves the slug and token and runs `SqliteTenantStore.provisionTenant` (`:74`), then `reconcileBillingEntitlement`. On the Phylax side, `zenodPhylax.ts:682` `recordEntitlement` creates the binding and allowance period (`periodFor`, `:267`).
- Live: the Stripe webhook endpoint `https://cloud.zenod.dev/webhook` is `enabled` for exactly those 5 events. An unsigned POST returns 400, which shows signature checking is on. Both €0 accounts are `active`, have a tenant, and have a Phylax tenant settings row created right at checkout time (2026-09-15 23:34 and 2026-10-13 05:24). The adapter has 3 bindings with `desired_access=active`, `state=active`, `allocation_units=500000` and `local_capacity_units=0`, and 1 suspended binding for a canceled legacy account. The Stripe webhook check is advisory and stale (verified 2026-08-14).
- Status: works.

### 3b. Vault connect (hidden step)

- Code: `googleDriveVaultContract.ts:188` `projectVaultCapabilities` sets `memory.store`/`search`/`ask` to true only when the binding is `ready` (`:198`). `App.tsx` boot opens the hosted console on the `vault` tab until the vault is ready and the repository is verified.
- Live: 1 €0 tenant has a `google_drive` binding marked `ready` (2026-10-12). The other has no vault. The advisory check `google_drive_vault_acceptance` fails, because no Google-only acceptance has been recorded against this build.
- Status: works once. A brand-new user going through it is unverified, and T7 covers that. The T7 script should include this step, since a tester who skips it gets no Saved reply.

### 4. Phone linked to the tenant on the Zenod production number

- Code: the customer opens Channels (`apps/web/src/views/ZenodPortalPanels.tsx:72` `HostedChannelsPanel`, which uses `HostedWhatsAppConnect`, `apps/web/src/components/whatsapp-connect.tsx:606`) and enters their WhatsApp number. That calls `POST /api/channels/whatsapp/challenge` (`hostedChannels.ts` `mountHostedChannelsCustomerRoutes`, mounted at `zenodUnit.ts:1003` and visible only to users who have an account). The Zenod BFF then calls Phylax's tenant-scoped management (`zenodPhylax.channels`) → `/internal/zenod/channels/:tenantId/whatsapp/challenge` (`hostedChannels.ts:941`). Phylax checks that the number is free, reads the shared number from the live transport (`:1006`), and registers the phone with a one-time `NN-word` code (`:1014`). The user sends that code from their own WhatsApp to the shared number. `phylaxPortedRuntime.ts:380` → `phylaxTenantSettings.ts:1195` `verifyInboundReceipt` checks the code in constant time, marks the phone `verified` and replies. After that, `resolve()` (`:1234`) routes the sender to the tenant's Zenod `/mcp` with the tenant token. No separate whitelist is involved: the verified binding is the allowlist.
- Live: Phylax `/api/health` reports `status ok`, `instance phylax-for-zenod`, `mode zenod`, `serviceNumberId zenod-primary`, `whatsapp.state: connected`, `receivePath ready`. The log shows short 503 reconnects that recover within about 2 s. Phylax has 4 tenant rows and **1 verified phone**, which belongs to the comped, non-Stripe tenant. Neither €0 tenant has a phone, verified or pending.
- Status: the code path exists and the transport is up. **A Stripe-born tenant linking a phone has never been seen on prod.** Unverified until T7.

### 5. First voice/text → "Saved" reply

- Code: `phylaxPortedRuntime.ts:379` `portedInboundHandler` handles verification first, then sends the message to the tenant downstream. Voice is transcribed in Phylax under allowance admission (`phylaxUsageMeter.ts:173` `beginTranscription`). Zenod's `memory_store` then files the note and returns the receipt "Saved." / "Saved — filed to …" (`mcp.ts:425-432`, `storageReceipt.ts:60-64`), and Phylax delivers that as the WhatsApp reply.
- Live: Phylax's allowance ledger has 242 paid-work rows, all `done`, all on the comped tenant. The two €0 tenants have none. A later read was blocked by T0's backup pause, so the last activity time is not recorded here.
- Status: works for the operator's comped tenant (ZAL history). **Unverified for a Stripe-born tenant.**

### 6. Reply visible in the console

- Code: the hosted console (`HostedAccount.tsx` and `Settings` with hosted sections) shows subscription, the usage card, the MCP endpoint and tokens, the vault card, and Channels with "Last message <time ago>" (`whatsapp-connect.tsx:917`). No hosted view of recent captures or Saved replies was found. `/api/overview` is projected with `usage:null` for hosted users (`zenodUnit.ts:544`). The note itself is a Markdown file in the user's Drive or GitHub vault.
- Status: **gap or definition question**. "Reply visible in the console" can only mean the "Last message" time plus the vault file, unless a recent-captures list is added. T7 already plans this check.

## Metering and caps, input for T3

| Layer | What is counted | Cap on prod | At the cap | Evidence |
|---|---|---|---|---|
| Phylax channel ledger | 1 unit per inbound/outbound message, 1 unit per transcription second (`PHYLAX_*_UNITS`) | Per-tenant wallet of 500,000 units (`ZENOD_PHYLAX_WALLET_TARGET_UNITS`), refilled at 100,000 low-water up to a master of 3,000,000 units per period (`ZENOD_MASTER_ALLOWANCE_UNITS`, `zenodPhylax.ts:171`, refill `:1146`). That is about 830 h of voice, so effectively no cap | Paid work pauses (`phylaxAllowanceLedger.ts:1101`, `insufficient_allowance` `:1116`). Transcription is forwarded as `allowance_unavailable` (`phylaxChannels.ts:1661`). WhatsApp delivery throws `PhylaxUsagePausedError`, so **the user gets silence and is not told why** | prod env, adapter bindings |
| Zenod LLM, platform OpenRouter key (D30) | Per-tenant month-to-date spend from the tenant's `usage.sqlite` (`runtime.ts` `monthToDateSpendUsd`) | **None.** `ZENOD_TENANT_MONTHLY_ALLOWANCE_USD` is unset on prod (`settings.ts:259`), so `local_capacity_units=0` | Shadow only: `checkTenantAllowance` (`runtime.ts:922`) logs `llm.allowance.exceeded … mode=shadow` and never blocks. The customer usage card (`customerMetering.ts:184` `projectLedgerUsage`) shows 0% / normal when no allowance is set | prod env |
| Units ↔ USD | `ZENOD_ALLOWANCE_UNITS_PER_USD=1000000` | n/a | Phylax's 1 unit per second of local transcription is about $0.000001/s on this scale. The unit scale is not tied to real cost | prod env |

What T3 needs: a real per-plan cap on LLM spend (the E7-A2 figure), switching shadow to blocking, a user-facing message when Zenod or Phylax pauses at the cap, and a Phylax master figure that means something.

## Proposed T2 rows (gaps)

1. `T2.1 | Renewal with no card never charges and never cuts off without notice | T4 | Stripe dashboard dunning and customer-email settings recorded; written extension procedure applied before renewal-invoice draft (or multi-month coupon + scheduled end); test-mode proof that a €0 sub renews at €0 and that a lapsed tester gets a Zenod message before suspension`
2. `T2.2 | Retire or bound the existing 100%-forever promotion code | none | promo code deactivated or given max_redemptions/expiry (Stripe write; Jordi-approved), the 2 existing comped subs untouched; Stripe GET shows the new limits`
3. `T2.3 | Keep checkout open for the whole test: dated readiness proofs | T0 | calendar plus an alert (EPIC-6 health page) for backup_restore (31 d), google_drive_vault_oauth (expires 2026-11-28) and stripe_profile (2026-12-14); each renewed before expiry, or the testers' emails on ZENOD_LIVE_CHECKOUT_TESTER_GOOGLE_EMAILS so a lapse cannot block them`
4. `T2.4 | Prove the full path for a Stripe-born tenant: vault → phone link → Saved | T0, T2.1 | one €0 test tenant connects Drive, links a phone with the one-time code, sends a voice note and a text, gets "Saved"; Phylax shows verified=1 for that tenant and done paid work; can merge into T7's rehearsal`
5. `T2.5 | Console shows the user their Saved replies (or redefine "visible in console") | none | decision recorded; if built: hosted console lists the last N captures/receipts for the tenant, verified on prod`
6. `T2.6 | Closed checkout shows a page, not raw JSON | none | /buy while checkout is closed renders a human "signup paused" page (today startCheckout returns JSON 503 to a browser redirect)`
7. `T2.7 | Backups pausing the live Phylax receiver | T0 | backup runbook states the pause window and schedules it off-peak, or snapshots without docker pause; inbound during a pause verified delivered afterwards`

Metering and caps are T3, not T2 (see the table above).
