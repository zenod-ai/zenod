# ZAL-17 — paid Hosted beta candidate evidence

Date: 2026-08-26

Issue: `#1083`

Branch: `codex/zal-17-beta-acceptance`

Original bound base: `f3c84c9`

Reconciled `main`: `a412dd0a369931f38b707a907264ed828908604b`

Exact source candidate: `f4a1746eab3fef0e08ba933a30ed658e627e93d2`

Evidence snapshot commit: `e2dc43ad04f6a72d59e1e56c4d382d8e24ade10e`

Integration target: `main`

Superseded candidate/evidence pair: `7eec30486a729c8fdce6827d09d46d7217cacaa4` / `9fab0fb329cfa2c4ca9785b82e62479c3aa78267`

## Verdict

**PASS as the smallest local candidate for a credential-backed staging beta. This is not production proof and is not authorization to deploy.**

The source candidate passes the full local regression, focused Hosted/channel acceptance, a bounded managed-Drive integration journey, typecheck, build, schema, changed-file lint, exact Hosted response projection, and presentation-only responsive browser checks. No live channel, provider, Stripe, signup, billing card, tenant, credential, deployment, or production state was used or changed.

Credential-backed staging proof remains mandatory before calling the beta operational. The local Drive callback crosses a mocked Google token/userinfo boundary. The built-portal browser fixture is presentation-only; it does not prove an uninterrupted real account, OAuth, channel, provider, billing, or staging journey.

## What changed

Existing architecture, product surfaces, APIs, settings storage and suites remain in place. The only net-new acceptance fix is the Hosted Google Drive boundary:

- Hosted `/api/drive/status` now returns an exact six-field customer schema: `configured`, `oauthAvailable`, `accountEmail`, `folderId`, `archiveConfigured`, and `archiveReason`.
- The projection removes `oauthClientId`, `clientEmail`, service-account mode/material, provider/transcription data and every unlisted internal field, even when the tenant runtime contains hostile values.
- The public Zenod service reads operator-owned `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` through an explicit Hosted Drive authority, not ordinary settings or raw fallbacks. Environment seeding remains disabled. For an entitled Hosted tenant, the operator pair has exclusive precedence; preserved legacy/hostile tenant OAuth client values and service-account JSON are ignored for status, start, callback and Drive authentication.
- The authority is resolved on every operation. Only one unambiguous account in `active` or `past_due` state with an active tenant-token record receives it. Canceled, paused, null/checkout, suspended, deleted or ambiguous state fails closed immediately, including after a runtime has already been cached.
- Each Hosted tenant continues to own only its OAuth state, refresh token, connected account email and selected folder. The tests prove a second Hosted tenant cannot read the first tenant's state or refresh token.
- A fresh Hosted tenant can start OAuth immediately when both operator variables exist. When either is absent, status truthfully returns `oauthAvailable: false`, the Connect button is disabled, and OAuth start returns a customer-safe `503 google_drive_oauth_unavailable` response.
- Hosted UI renders managed connect/status/disconnect and the supported folder control only. Self-hosted UI and raw API retain the existing BYO OAuth client ID/secret, service-account fallback, test/save, provider/transcription and folder behavior.

Acceptance scaffolding added for this boundary:

- `scripts/zal17-drive-journey.mjs` and root `npm run acceptance:zal17:drive` provide one reproducible terminal receipt;
- cookie and bearer Hosted new-tenant journeys with a mocked Google HTTP boundary;
- an exact self-hosted BYO journey;
- hostile projection, missing-config, tenant-isolation and component regressions;
- a presentation-only built-portal fixture and durable browser observation log.

No service, database schema, signup path, billing behavior, tenant model, channel routing, Ring behavior or customer product name was added or redesigned.

## Candidate configuration and service matrix

Secret names below are variable names only. Values must come from the approved staging secret store and must never be committed or printed.

| Edition | Runtime services | Google Drive configuration | Customer surface | Persistent state |
| --- | --- | --- | --- | --- |
| Hosted | **2 services** from one immutable Zenod image: public `AGENT=zenod`; private existing `AGENT=phylax` Channels runtime | Public service operator config must include both `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. The Google client must authorize the public `/api/drive/oauth/callback` URL. No tenant DB pre-seed is required or allowed. Status is unavailable/fail-closed when the pair is incomplete or entitlement/tenant identity is not active and unambiguous. | One Zenod product: Overview, Connect/MCP, Channels, Vault & sources, managed Usage and Account. No customer Phylax or Ring copy. | Public Zenod volume owns accounts, vault, per-tenant OAuth state/refresh token/email/folder and managed receipts. Private Channels volume owns the WhatsApp session. Operator Google client credentials remain service authority configuration, never tenant state or a customer response. |
| Self-hosted | **1 Zenod service**; no private Channels dependency | Existing BYO flow is unchanged: the operator supplies OAuth client ID/secret through the self-host settings surface, or uses the existing service-account fallback. Shared Hosted Google variables are not injected into an unentitled self-host tenant. | Overview, Connect/MCP, Telegram-only Channels, Vault & sources, raw Usage and operator Settings. WhatsApp is absent. | One durable `/data` volume plus the configured vault repository. |

Other required Hosted public-service configuration remains: `AGENT=zenod`, `PORT`, `ZENOD_DATA_DIR`, `CUSTOMER_APP_URL`, GitHub OAuth variables, `ACCOUNT_STATE_SECRET`, `CHASSIS_VAULT_MASTER_KEY`, managed-AI variables, approved Stripe test variables only when signup is gated for exercise, `ZENOD_CHANNELS_URL`, exact `ZENOD_CHANNELS_ALLOWED_ORIGINS`, shared `ZENOD_CHANNELS_PRIVATE_TOKEN`, and optional explicit `ZENOD_CHANNELS_MEMORY_URL`.

The private service remains the existing Phylax runtime selected from the shared code/image. It is called **Channels** in the Zenod customer journey. Ring is not on the customer path and is not required for direct Zenod text/voice/media capture.

### Config-health contract

| Condition | Hosted status | Hosted start | Storage effect |
| --- | --- | --- | --- |
| Both operator Google variables exist, tenant not connected | `oauthAvailable: true`, `configured: false` | `302` to Google consent | random tenant OAuth state only; no client credential seed |
| Both exist, mocked callback completes | safe connected email/folder fields only | callback `302` to portal | encrypted tenant refresh token/email; operator client credentials are not persisted |
| Either operator variable is absent, even with hostile/legacy tenant client values | `oauthAvailable: false`, safe customer reason | `503 google_drive_oauth_unavailable` | hostile/legacy values preserved but ignored; no operator value persisted |
| Account canceled/paused/null, tenant suspended/deleted, or account binding ambiguous | `oauthAvailable: false` when the signed capability reaches status | start denied; cached runtime authority becomes null immediately | existing tenant Drive state preserved; no provider exchange |
| Self-host BYO variables absent | existing raw self-host status | existing `400 save the Google OAuth client ID and secret first` | none |

### Immutable image and version pin plan

1. Build source candidate `f4a1746eab3fef0e08ba933a30ed658e627e93d2` in CI from a clean checkout.
2. Publish one image and record both the source SHA and registry-returned digest.
3. Pin both Hosted services to the same immutable reference, for example `ghcr.io/zenod-ai/zenod@sha256:<registry-returned-digest>`; this placeholder is not a claimed digest.
4. Record service name, image digest, `GIT_SHA`, configuration revision, Google redirect URI and volume identity in the staging receipt.
5. Reject rollout if the two services differ in source/digest or reported `GIT_SHA`.

The repository compose files are historical/operator inputs, not proof of this exact two-service staging deployment. Building, publishing and pinning the real digest remains a staging blocker.

## Acceptance matrix and proof classification

| Contract | Local evidence | Classification | Result |
| --- | --- | --- | --- |
| Signed Hosted account/auth and hostile cookie/bearer capability | `customerLayer.test.ts`, `customerAccounts.test.ts`, `zenodUnit.test.ts` | local integration/contract | PASS |
| Exact Hosted Drive public schema under hostile fields | `zenodUnit.test.ts` asserts exact keys/body for cookie and bearer | local integration | PASS |
| New Hosted tenant folder/start/callback/status/disconnect/error | `npm run acceptance:zal17:drive`; Google token/userinfo HTTP mocked | local integration with mocked provider boundary | PASS |
| Operator authority precedence, config absent, lifecycle and no client DB seed | `zenodUnit.test.ts` hostile values, config-health, cached-runtime lifecycle and state assertions | local integration | PASS |
| Self-host BYO raw status/start/callback/disconnect/error unchanged | `drive.test.ts` via the same journey command | local integration with mocked provider boundary | PASS |
| Hosted repository/GitHub App, vault and MCP | `githubApp.test.ts`, `mcp.test.ts`, `zenodUnit.test.ts` | local integration/contract | PASS |
| Customer-safe managed usage; no provider/model/key/raw-token/dollar leak | managed-AI suites, `zenodUnit.test.ts`, web tests | local integration/contract | PASS |
| Cap/raw admission, restart/replay and terminal receipts | `customerManagedAiAdmission.test.ts`, `customerManagedAiOutbox.test.ts`, `customerManagedAi.test.ts` | local integration/synthetic authority | PASS |
| Hosted Telegram lifecycle/private admission/group denial | `telegram.test.ts`, `hostedChannels.test.ts`, `zenodUnit.test.ts` | local synthetic transport | PASS locally/synthetic |
| Private Channels facade and direct Zenod WhatsApp text/voice/media | Hosted/Phylax/WhatsApp suites | local synthetic transport | PASS locally/synthetic |
| Channel retry/idempotency/identity collision/tenant isolation | Hosted/Phylax/WhatsApp/Telegram suites | local synthetic transport | PASS locally/synthetic |
| Hosted no Ring/Phylax/internal/provider copy; self-host no WhatsApp | web tests and `browser-qa.json` | component + presentation-only browser fixture | PASS for local presentation |
| Responsive edition presentation at 360/736/1024 | `browser-qa.json` | presentation-only browser fixture | PASS; no overflow observed |
| Credential-backed Google/channel/provider/billing | not run; requires approved staging secrets/actions | staging-only | BLOCKED BY HUMAN GATES |

## Exact journey and command/file matrix

The primary bounded journey is reproducible with:

```sh
npm run acceptance:zal17:drive
```

It runs:

```sh
npm exec -w @zenod/server -- vitest run test/zenodUnit.test.ts test/drive.test.ts -t "ZAL-17 .* Drive journey"
```

Terminal receipt at the source candidate:

```text
ZAL17_DRIVE_JOURNEY_RECEIPT {"schemaVersion":1,"acceptance":"ZAL-17 managed Drive journeys","status":"pass","sourceSha":"f4a1746eab3fef0e08ba933a30ed658e627e93d2","command":"npm run acceptance:zal17:drive","testCommand":"npm exec -w @zenod/server -- vitest run test/zenodUnit.test.ts test/drive.test.ts -t \"ZAL-17 .* Drive journey\"","startedAt":"2026-08-26T01:28:53.917Z","completedAt":"2026-08-26T01:28:55.654Z","boundary":"local integration with mocked Google token and userinfo HTTP; no credentials, staging, or live mutation"}
```

| File/command | What it proves | Result |
| --- | --- | --- |
| `packages/server/test/zenodUnit.test.ts` | exact cookie+bearer safe projection, operator-only authority over hostile stored values, new tenant start/callback/status/folder/disconnect/error, no operator persistence, tenant isolation, missing config and cached lifecycle denial | PASS |
| `packages/server/test/drive.test.ts` | self-host raw/BYO start/callback/status/disconnect/original config error | PASS |
| `apps/web/src/components/google-drive-connect.test.tsx` | Hosted managed-only/missing-config UI and preserved self-host operator UI | PASS |
| `scripts/zal17-drive-journey.mjs` | reproducible bounded journey and terminal JSON receipt | PASS |
| `scripts/zal17-portal-fixture.mjs` | inert edition responses for built-portal presentation QA | fixture only; not operational proof |
| `browser-qa.json` | exact responsive observations/procedure and downgraded visual boundary | PASS for presentation only |
| exact 15-file server command listed below | Hosted/customer/managed-AI/Channels/Phylax/WhatsApp/Telegram/MCP/Drive/GitHub regression | PASS: 15 files, 298 tests |
| `npm test -w web` | complete configured customer-web suite | PASS: 13 files, 70 tests |
| `npm test` | all workspaces, 194 script assertions and schema check | PASS; core 31 files/527 pass/6 skip; scripts 194 pass |
| `npm run typecheck` | configured workspaces | PASS |
| `npm run build` | core, chassis, server, customer web and public site | PASS; existing Vite chunk warning only |
| `npm run schemas:check` | 27 self-contained tool schemas, no writes | PASS |
| changed-file web ESLint | changed web TS/TSX only | PASS |
| `git diff --check origin/main..HEAD` | source/evidence whitespace | PASS after this evidence update |

Exact 15-file server command:

```sh
npm exec -w @zenod/server -- vitest run test/customerLayer.test.ts test/customerAccounts.test.ts test/customerManagedAi.test.ts test/customerManagedAiAdmission.test.ts test/customerManagedAiOutbox.test.ts test/hostedChannels.test.ts test/phylaxTenantSettings.test.ts test/phylaxChannels.test.ts test/phylaxUnit.test.ts test/whatsapp.test.ts test/telegram.test.ts test/mcp.test.ts test/drive.test.ts test/githubApp.test.ts test/zenodUnit.test.ts
```

### Browser procedure and claim boundary

The prior responsive run served built `apps/web/dist` with `node scripts/zal17-portal-fixture.mjs` on loopback, opened `/hosted` and `/self-hosted`, set 360x900, 736x900 and 1024x900 viewports, reloaded, and inspected Vault & sources and Channels. There is an exact zero-line `apps/web` diff from that run's source SHA to this source candidate. At this candidate, the web bundle was rebuilt and Browser Control re-opened both editions at 1496px, rechecked the same two sections and observed `scrollWidth === innerWidth`. `browser-qa.json` separates the carried-forward responsive matrix from this candidate's recheck.

Observed: exact viewport widths matched scroll widths; Hosted showed managed OAuth/folder controls without forbidden or internal copy; self-host retained OAuth client/secret/service-account controls; Hosted Channels showed WhatsApp without Ring/Phylax copy; self-host Channels showed no WhatsApp.

No screenshot artifact is claimed. These are presentation and visible-copy observations only. They do not prove an uninterrupted signed customer journey or real backend/provider operation.

### Lint baseline disclosure

The repository has no root lint script. `npm run lint --workspaces --if-present` reports seven pre-existing errors: one in `apps/calli-web/src/App.tsx` and six in `KeysTab.tsx`, `McpConfigTab.tsx`, `OperatingRulesTab.tsx` and `SkillSettingsTab.tsx`. None of those files differs from reconciled `main`, and none is changed by the corrected ZAL-17 source commit. Direct ESLint of all changed web TS/TSX files passes.

### CI receipt

Source-candidate CI: `https://github.com/zenod-ai/zenod/actions/runs/32919411966/job/98029805645` — **PASS in 3m53s** for exact source candidate `f4a1746eab3fef0e08ba933a30ed658e627e93d2`. The workflow ran clean checkout/install, root build, Docker build-check and root tests. The only annotation is the workflow runner's Node 20 action deprecation notice; it is not a test failure.

## Rollback

Rollback is non-destructive and requires no schema or data migration:

1. Stop the staging rollout; do not delete either volume or reset a WhatsApp session.
2. Restore the previously recorded immutable image digest to **both** Hosted services.
3. Keep the same volume mounts and secret/config revision. An older image may ignore the new shared Google variables; that truthfully makes Hosted Drive unavailable rather than deleting tenant data.
4. Do not delete tenant refresh tokens, OAuth emails, folders or other credential-vault records during code rollback. A user-invoked Drive disconnect remains the only flow here that clears that tenant's Drive refresh/email/folder state.
5. If managed AI authority is suspect, disable its staging flag so it fails closed; do not mint/delete keys as part of code rollback.
6. Verify `/healthz`, expected `GIT_SHA`, customer-safe Drive config health, private Channels transport status and synthetic text/voice/media receipts.
7. If only the corrected managed-Drive authority delta must be removed, revert source commit `f4a1746`; no schema/data migration or deletion is required. Do not delete preserved tenant OAuth values or refresh-token custody records.

## Explicit staging-only blockers and residual risks

1. **Immutable image receipt:** CI must publish the source candidate and return the real registry digest; both Hosted services must report the same digest/SHA.
2. **Version-coherent two-service staging:** public Zenod and private Channels require the exact private origin allowlist/token and preserved volumes/session.
3. **Real Google OAuth:** configure the two operator variables and approved redirect URI, then prove new-tenant consent/callback/status/folder/disconnect and restart against a disposable staging account/folder. No Google grant occurred locally.
4. **Real managed AI authority:** prove tenant provision/cap/raw admission/restart/terminal receipt/safe projection with approved staging credentials. No OpenRouter key or cap was mutated here.
5. **Real billing/signup:** prove signed checkout/webhook/account state with Stripe test-mode approval. No Stripe customer, card or subscription was used.
6. **Real Telegram:** prove private-DM text/voice/media, group denial and lost-response replay with an approved staging bot/identity.
7. **Real WhatsApp:** prove direct Zenod text/voice/media, identity/tenant isolation, retry/idempotency and restart recovery without re-pairing. No QR pairing or message occurred here.
8. **Backup/restore:** verify backups of both `/data` volumes before rollout and prove non-destructive digest rollback.
9. **Existing lint debt:** six unrelated web lint errors remain visible repository debt.
10. **Bundle warning:** the customer web bundle remains above Vite's default chunk warning threshold and needs public-beta monitoring.

Production deploy, public signup, live Stripe, real-card billing, credential rotation, tenant/session/routing mutation and destructive cleanup remain closed human gates.

## Handoff decision

Advance source candidate `f4a1746eab3fef0e08ba933a30ed658e627e93d2` only to an approved credential-backed staging exercise. Do not describe local mocked/synthetic/browser coverage as live proof. A beta/go-live decision requires receipts for blockers 1–8 on the same pinned image digest.
