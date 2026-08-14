# Hosted Zenod production-readiness gate

Public paid signup is fail-closed. `ZENOD_PUBLIC_PAID_SIGNUP=1` makes the server refuse to boot unless
every check returned by `GET /api/public/production-readiness` is green. Keep the flag at `0` while
deploying or proving any gate.

## Production resources

- App: Dokploy application `zenod-mt` (`2dkayH_eAur427leH64MT`), mounted volume
  `zenod-mt-data:/data`.
- Customer origins: `https://zenod.dev` and `https://cloud.zenod.dev`.
- Stripe product: `prod_UpYtFTErYgQal7` (`Zenod Hosted`).
- Monthly live price: `price_1Tptlw80yG7aohEWL9X4zqMI` (€5/month).
- Yearly live price: `price_1U46kg80yG7aohEWqPt2WbZu` (€50/year).
- Portal configuration: `bpc_1U46kh80yG7aohEWoLG51m8k`, with invoices, payment-method updates,
  and cancellation at period end.
- Live webhook endpoint: `we_1U46n480yG7aohEWgjxZLZT2`; its signing secret is held in macOS
  Keychain as service `zenod-stripe-live-webhook-secret`, account `jordi`.

The webhook must subscribe to `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.

## Required environment

Configure the following in Dokploy without printing secret values:

```text
NODE_ENV=production
CUSTOMER_APP_URL=https://cloud.zenod.dev
DOMAIN=https://cloud.zenod.dev
ZC_COOKIE_DOMAIN=.zenod.dev
ACCOUNT_STATE_SECRET=<dedicated random value, at least 32 characters>
STRIPE_MODE=live
STRIPE_SECRET_KEY=<sk_live key from Keychain>
STRIPE_WEBHOOK_SECRET=<v2 live whsec value from Keychain>
PRICE_MONTHLY=price_1Tptlw80yG7aohEWL9X4zqMI
PRICE_YEARLY=price_1U46kg80yG7aohEWqPt2WbZu
STRIPE_PORTAL_CONFIGURATION_ID=bpc_1U46kh80yG7aohEWoLG51m8k
STRIPE_TAX_MODE=automatic
STRIPE_AUTOMATIC_TAX=1
ZENOD_SUPPORT_EMAIL=jordi@alpha9.io
ZENOD_LEGAL_VERSION=2026-08-13
ZENOD_PUBLIC_PAID_SIGNUP=0
ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS=<comma-separated numeric GitHub IDs used for the live drill>
```

Do not set any `*_VERIFIED_AT` value prospectively. Set it to the UTC completion time only after the
corresponding check below succeeds:

- `ZENOD_BACKUP_RESTORE_VERIFIED_AT`: cold backup restored into an isolated temporary volume and the
  JSON/SQLite verifier passed.
- `ZENOD_STRIPE_WEBHOOK_VERIFIED_AT`: a signed live event reached the deployed handler successfully.
- `ZENOD_STRIPE_PORTAL_VERIFIED_AT`: a live customer opened the configured portal and saw invoices,
  payment-method update, and cancel-at-period-end controls.
- `ZENOD_STRIPE_PROFILE_VERIFIED_AT`: Stripe checkout/portal show the correct legal business, support
  email, website, Terms, and Privacy links.
- `ZENOD_LIVE_BILLING_VERIFIED_AT`: a real-card €5 purchase completed, provisioned exactly one tenant,
  returned a working MCP URL, opened the billing portal, and was refunded/cancelled as intended.

## Deploy with signup closed

1. Record the currently deployed immutable image and a redacted environment-key list for rollback.
2. Deploy the new immutable `sha-*` image with `ZENOD_PUBLIC_PAID_SIGNUP=0`.
3. Verify `/healthz`, `/api/health`, the landing page, Terms, Privacy, and Data Handling. Confirm
   `/api/public/production-readiness` is non-200 until evidence dates are installed.
4. Verify an unauthenticated MCP request is rejected, while an existing tenant token can initialize,
   list tools, and call a read-only tool without crossing tenant boundaries.

## Cold backup and restore drill

Run on the VPS. The script resolves the exact mounted volume before quiescing anything. For the
one-replica production Swarm service it freezes the exact task with `docker pause`, which prevents
writes without inviting the scheduler to create a replacement task; standalone containers are
stopped normally. It atomically finalizes the archive, resumes the workload, creates a mode-0600
checksum, restores into a disposable writable Docker volume, parses every JSON file, runs SQLite
`integrity_check`, and probes health. The source archive is always read-only during restore and the
temporary restore volume is deleted; the archive and checksum are retained.

```sh
ZENOD_HEALTH_URL=https://cloud.zenod.dev/healthz \
  ./scripts/zenod-volume-backup.sh \
  <exact-running-container-name> zenod-mt-data /var/backups/zenod
```

Record the emitted `restore_verified_at` value in Dokploy only after the final health probe succeeds.
Restrict `/var/backups/zenod` to root/operator access and copy the archive to the approved independent
backup destination according to the host retention policy.

## Closed live billing drill

The public pricing buttons remain disabled. A signed-in GitHub user whose numeric ID is in
`ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS` can POST the normal checkout endpoint for the controlled live
drill. Use a real card; never use Stripe test-card numbers in live mode.

Verify, in order:

1. Checkout displays Zenod Hosted, €5/month, required billing address, Terms consent, and automatic tax.
2. One `checkout.session.completed` delivery returns HTTP 200 and creates exactly one tenant across a
   replay of the event.
3. The returned MCP URL initializes and can store/search a disposable memory in the tester vault.
4. **Manage billing** opens the live portal. Confirm invoice history, payment-method update, and
   cancellation at period end.
5. Send or observe subscription/invoice lifecycle events and confirm `past_due` retains grace access,
   `canceled`/`paused` suspends MCP, and a later `active` event restores it.
6. Refund the drill payment if appropriate and retain only redacted IDs/timestamps as evidence.

## Open and rollback

After every evidence value is current, set `ZENOD_PUBLIC_PAID_SIGNUP=1` and redeploy. Startup itself is
the last guard. Confirm the readiness endpoint returns 200 and a non-allowlisted signed-in user can
start checkout.

To close sales without taking the service down, set `ZENOD_PUBLIC_PAID_SIGNUP=0` and redeploy. To roll
back code, restore the prior immutable image and its captured environment while preserving
`zenod-mt-data`. Never roll back by deleting or recreating the data volume. If a data restore is
required, quiesce the exact workload and restore a verified archive into a new volume first; retain
the original volume until application and MCP checks pass.
