# Hosted Zenod production-readiness gate

Public paid signup is fail-closed. `ZENOD_PUBLIC_PAID_SIGNUP=1` makes the public server refuse to boot unless every check returned by `GET /api/public/production-readiness` is green. Keep signup and tester checkout closed while deploying or proving any gate.

The current approved Hosted shape is **two services from one immutable image**:

1. public Zenod (`AGENT=zenod`) owns the website/app, account, API, MCP, vault, managed usage and customer Channels facade; and
2. the existing private Phylax runtime (`AGENT=phylax`) remains the hidden Channels service and preserves the WhatsApp session, journal, retries and Telegram transport.

Ring is not on the Zenod customer path and must not be changed by this runbook.

The current exact read-only preflight, target IDs, image/rollback digests and redacted environment delta live in [`docs/evidence/zenod-production-readiness-preflight-2026-08-26/README.md`](./evidence/zenod-production-readiness-preflight-2026-08-26/README.md).

## Current commercial blocker

The approved beta product is one €9/month plus VAT Hosted plan. Candidate `91b4e7d` still contains the legacy €5/month and €50/year site, checkout tiers, Terms, price variables and monthly/yearly readiness requirement. Therefore:

- do not deploy `91b4e7d`, even with signup and tester checkout closed, because it would continue publishing the wrong product and legal contract;
- no billing drill may run against the legacy price contract; and
- a future immutable digest may be considered only after a reviewed correction makes the site, account, Terms, checkout parser, one operator-supplied monthly Stripe price reference and readiness rule agree on the approved product.

Do not work around this by silently reusing a legacy price ID or assigning one price to both tiers.

## Current and future human gates

The only current approval request is:

> **APPROVE PR #1089 DOCS MERGE ONLY**

This authorizes merging documentation and evidence only. It authorizes zero production, backup, quiesce, environment, credential, token, deploy, provider, Google, channel, billing, signup, route, session, data or verification-timestamp mutation.

Future approvals are independent and must be requested separately in this order:

1. define the off-host backup destination, retention and restore procedure;
2. authorize exact backup quiesce/verification for both volumes;
3. approve credential/token generation or source plus redacted exact non-secret environment values;
4. approve configuration and signup-closed deployment of a future pricing-corrected immutable digest;
5. approve OpenRouter reconciliation and child-key effects;
6. approve Google OAuth grant and disposable-account test;
7. approve real WhatsApp/Telegram sends or session-affecting work;
8. approve one €9 real-card billing drill and refund/cancel handling; and
9. approve public signup.

Approval of one gate never authorizes the next.

## Production resources

- Dokploy project: `zenod` (`FWSR0dSSjeOSjPsIsMty3`).
- Environment: `production` (`5BPzY3n4l6eSctYuUqXFN`).
- Public application: `zenod-mt` (`2dkayH_eAur427leH64MT`), Swarm service `zenod-mt-fxpzoo`, mounted volume `zenod-mt-data:/data`.
- Private Channels application: existing `phylax` (`urbFsgl6eImbQ4MTIZl5N`), Swarm service `app-index-back-end-panel-6zm3qg`, mounted volume `phylax-data:/data`.
- Shared private network: `dokploy-network` (`0k299mqvlih0w59gstyl5nvi1`).
- Customer origins: `https://zenod.dev` and `https://cloud.zenod.dev`.
- Existing private service owner/legacy origin: `https://phylax.zenod.dev`; preserve during non-destructive rollout, but do not advertise it as a product.
- Private service origin from public Zenod: `http://app-index-back-end-panel-6zm3qg:8080`.
- Google Drive callback: `https://cloud.zenod.dev/api/drive/oauth/callback`.
- Stripe product: `prod_UpYtFTErYgQal7` (`Zenod Hosted`).
- Legacy live prices, not approved for the €9 beta: monthly `price_1Tptlw80yG7aohEWL9X4zqMI`; yearly `price_1U46kg80yG7aohEWqPt2WbZu`.
- Portal configuration: `bpc_1U46kh80yG7aohEWoLG51m8k`.
- Live webhook endpoint: `we_1U46n480yG7aohEWgjxZLZT2`; its signing secret is held in macOS Keychain as service `zenod-stripe-live-webhook-secret`, account `jordi`.

The webhook must subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

## Required environment boundary

The following is a future configuration boundary, not an approved delta. Never print secret values. At a later configuration-planning gate, capture a mode-0600 complete pre-change environment snapshot outside the repository, publish only key status and exact non-secret values for review, and preserve every unnamed existing key.

### Public Zenod

Baseline and retained authority keys (the public-site host is optional as noted below):

```text
AGENT
NODE_ENV
PORT
ZENOD_DATA_DIR
CUSTOMER_APP_URL
DOMAIN
ZC_COOKIE_DOMAIN
ACCOUNT_STATE_SECRET
CHASSIS_VAULT_MASTER_KEY
CONTROL_PLANE_TOKEN
GITHUB_OAUTH_CLIENT_ID
GITHUB_OAUTH_CLIENT_SECRET
GITHUB_OAUTH_CALLBACK_URL
ZENOD_PUBLIC_SITE_HOST
```

`ZENOD_PUBLIC_SITE_HOST` is currently present and non-empty. It is optional for boot: `isPublicSiteHost` defaults to `zenod.dev` when neither a route option nor this environment key is supplied. Retain the explicit key in a future exact delta so host routing does not rely on the fallback.

Hosted Drive requires operator-owned keys on public Zenod only:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
```

Do not seed those values into tenant settings. Register only the approved public callback.
For the Hosted public beta this connection is archive/export-only: Zenod creates
one private tenant-specific folder automatically, GitHub remains the source
integration, and customers do not select a Drive folder. Self-hosted BYO Drive
source/inbox behavior is unchanged.

Hosted managed AI requires:

```text
ZENOD_MANAGED_AI_ENABLED
OPENROUTER_PROVISIONING_KEY
ZENOD_MANAGED_AI_LIMIT_USD
ZENOD_MANAGED_AI_WARN_PERCENT
```

Enabling managed AI starts authoritative reconciliation and may create, cap, disable or resume OpenRouter child keys for existing entitled tenants. Installing the key and enabling the flag therefore requires explicit provider-mutation approval; it is not a passive configuration change.

The customer Channels facade requires:

```text
ZENOD_CHANNELS_URL
ZENOD_CHANNELS_ALLOWED_ORIGINS
ZENOD_CHANNELS_PRIVATE_TOKEN
ZENOD_CHANNELS_MEMORY_URL
```

The private URL must exactly match its allowlist. The private token must be the same approved secret on public Zenod and private Channels and must never appear in the repository, issue, logs or evidence.

Billing/readiness keys remain:

```text
STRIPE_MODE
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_WEBHOOK_ENDPOINT_ID
PRICE_MONTHLY
STRIPE_PORTAL_CONFIGURATION_ID
STRIPE_TAX_MODE
STRIPE_AUTOMATIC_TAX
ZENOD_SUPPORT_EMAIL
ZENOD_LEGAL_VERSION
ZENOD_PUBLIC_PAID_SIGNUP
ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS
```

`PRICE_MONTHLY` is the sole price reference required for new Zenod checkout. Any existing `PRICE_YEARLY` value is legacy configuration: preserve it in pre-change snapshots and do not delete or reinterpret it, but Zenod readiness and new checkout do not depend on it. The monthly reference remains blocked until Jordi separately approves the exact live €9 Stripe price. No environment change is authorized by this runbook. A future closed-deploy delta must keep `ZENOD_PUBLIC_PAID_SIGNUP` closed and the tester allowlist empty.

### Private existing Phylax / Channels

Required keys are:

```text
AGENT
ZENOD_UNIT
NODE_ENV
PORT
ZENOD_DATA_DIR
CHASSIS_VAULT_MASTER_KEY
CONTROL_PLANE_TOKEN
ZENOD_CHANNELS_PRIVATE_TOKEN
```

Preserve the current Telegram, Phylax, customer/admin and domain keys byte-for-byte. Do not rotate the vault key, control token, Telegram bot token, session material or any legacy secret during the image rollout. `ZENOD_UNIT` remains for backward-compatible mode selection while `AGENT` makes the candidate role explicit.

### SHA reporting

At a future pricing-corrected deployment gate, remove the current service-level `GIT_SHA` overrides. Immutable images bake the full merge SHA; an old runtime override would make `/api/health` lie about the deployed version.

## Verification timestamps

Do not set any `*_VERIFIED_AT` value prospectively. Set it to the UTC completion time only after the corresponding proof succeeds:

- `ZENOD_BACKUP_RESTORE_VERIFIED_AT`: **both** public and private Channels volumes were cold-backed up, restored into isolated temporary volumes, verified, and copied to the approved independent destination. Use the later actual completion time.
- `ZENOD_STRIPE_WEBHOOK_VERIFIED_AT`: a signed live event reached the deployed handler successfully.
- `ZENOD_STRIPE_PORTAL_VERIFIED_AT`: a live customer opened the configured portal and saw invoices, payment-method update, and cancel-at-period-end controls.
- `ZENOD_STRIPE_PROFILE_VERIFIED_AT`: Stripe checkout/portal show the correct legal business, support email, website, Terms and Privacy links.
- `ZENOD_LIVE_BILLING_VERIFIED_AT`: after the pricing correction, one separately approved real-card €9 purchase completed, provisioned exactly one tenant and managed-AI authority, returned a working MCP URL, opened the billing portal, and was refunded/cancelled as intended.

## Future pricing-corrected deploy with signup and checkout closed

Do not use this procedure with `91b4e7d`. After the pricing correction produces a new immutable digest and the earlier independent gates have completed:

1. Obtain Jordi's exact approval of the future OCI digest, both Dokploy applications, the redacted exact key/non-secret-value delta and rollback references.
2. Record both currently deployed immutable images, complete operator-only environment snapshots, domains, mounts, service names, volume identities and private network.
3. Complete the two-volume backup and isolated restore drill below.
4. Pin the private existing Phylax application to the approved future digest first, preserving its volume and session. Verify private `/api/health` reports `phylax`, the full future SHA, acceptable worker/transport health and no session reset.
5. Pin public `zenod-mt` to the same digest second. Verify `/healthz`, `/api/health`, the landing page, Terms, Privacy and Data Handling by identity, not merely status.
6. Confirm `/api/public/production-readiness` remains non-200 and reports signup closed. An unauthenticated MCP request must be rejected; an existing tenant token must initialize, list tools and call a read-only tool without crossing tenant boundaries.
7. Run only the separately approved credential/channel/provider probes from the preflight matrix. Do not pair/reset WhatsApp, send test messages, create Google grants or enable OpenRouter reconciliation unless the approval names that effect.

Both services must report the same full future merge SHA. Reject or roll back a version-skewed rollout.

## Two-volume cold backup and restore drill

First define and approve the independent encrypted destination, retention, restore owner and copy/verification procedure without pausing anything. Then request a separate backup-quiesce approval. Only after that approval may an operator run these commands on the VPS. Resolve the exact one-replica container names immediately before each command. The script verifies that the named container owns the named `/data` volume, pauses the exact Swarm task, atomically finalizes the archive, resumes the workload, creates a mode-0600 checksum, restores into a disposable writable volume, parses every JSON file, runs SQLite `integrity_check`, and probes health.

Use separate archive directories:

```sh
ZENOD_HEALTH_URL=https://cloud.zenod.dev/healthz \
  ./scripts/zenod-volume-backup.sh \
  <exact-public-container> zenod-mt-data /var/backups/zenod/public

ZENOD_HEALTH_URL=https://phylax.zenod.dev/healthz \
  ./scripts/zenod-volume-backup.sh \
  <exact-private-container> phylax-data /var/backups/zenod/channels
```

Copy both archives/checksums to an approved independent encrypted destination. Retain the source archives. If a real data restore is required, restore the verified archive into a new volume, run the same JSON/SQLite verifier, mount it only after approval, and retain the original volume until application, MCP, isolation and Channels checks pass. Never restore over or delete the original volume as part of code rollback.

## Closed billing drill

This stage is blocked until the candidate implements the approved €9 single-plan contract and Jordi separately approves Stripe/profile/real-card effects. The public pricing buttons remain disabled and the tester allowlist remains empty before that approval.

After approval, verify in order:

1. Checkout displays the approved Zenod Hosted plan, €9/month plus applicable VAT, required billing address, Terms consent and automatic tax.
2. One `checkout.session.completed` delivery returns HTTP 200 and creates exactly one tenant and one bounded managed-AI authority across event replay.
3. The returned MCP URL initializes and can store/search a disposable memory in the tester vault.
4. **Manage billing** opens the live portal with invoice history, payment-method update and cancellation at period end.
5. Subscription/invoice lifecycle proves `past_due` grace, `canceled`/`paused` suspension, and later `active` restoration without duplicate provider keys.
6. Refund/cancel as approved and retain only redacted IDs/timestamps as evidence.

## Open and rollback

Opening public signup is a separate exact gate. Only after every product, two-service, provider, backup, billing and legal check is current may Jordi approve `ZENOD_PUBLIC_PAID_SIGNUP=1`. Startup is the last guard; confirm readiness 200 and the approved €9 checkout for a non-allowlisted signed-in user.

To close sales, set signup closed and clear tester checkout. To roll back code:

1. restore the public application's captured environment and prior immutable image first;
2. restore the private Channels application's captured environment and prior immutable image second;
3. preserve `zenod-mt-data`, `phylax-data`, the WhatsApp session, Telegram binding, journals, tenant/provider receipts, encrypted credentials and Ring;
4. confirm both prior SHAs, public health, private transport health and existing read-only MCP; and
5. restore data only for proven corruption, into a new volume, retaining the original.

Never roll back by deleting/recreating a volume, resetting WhatsApp, deleting child keys, clearing queues or removing legacy functionality.
