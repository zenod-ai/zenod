# ZAL-17 — paid Hosted beta candidate evidence

Date: 2026-08-26  
Issue: `#1083`  
Branch: `codex/zal-17-beta-acceptance`  
Original bound base: `f3c84c9`  
Reconciled `main`: `a412dd0a369931f38b707a907264ed828908604b`  
Exact tested candidate: `c7d85741b3cf3ef2069af0dfded4c4184250ff1b`  
Integration target: `main`

## Verdict

**PASS as the smallest local candidate for a credential-backed staging beta. NOT production proof and NOT authorization to deploy.**

The exact candidate SHA passes the full local regression, focused Hosted/channel acceptance, typecheck, build, schema, changed-file lint, API projection, and responsive browser gates. No live channel, provider, Stripe, signup, billing card, tenant, credential, deployment, or production state was used or changed.

Credential-backed staging proof remains mandatory before calling the beta operational. The explicit blockers are listed below.

## What changed

Existing implementation and existing suites were reused. There is one product fix:

- `GoogleDriveConnect` now receives the existing edition value.
- Hosted renders only the managed Google OAuth connect/status/disconnect journey and the supported Drive folder ID control.
- Hosted does not poll the private transcription status route and does not render customer OAuth client credentials, service-account JSON, local paths, provider/model/API-key/raw-token/dollar/cost controls or copy.
- Hosted OAuth setup writes only `google_drive_folder_id` and `artifact_archive_provider`, which are already in the Hosted customer allowlist.
- Self-hosted retains the pre-existing OAuth client ID/secret, service-account fallback, test/save, local transcription, provider and model presentation.

The other additions are acceptance scaffolding only:

- component and edition-propagation regressions;
- one API assertion for the exact Hosted Drive settings body under signed cookie and bearer capabilities;
- `scripts/zal17-portal-fixture.mjs`, a local-only fixture for exercising the built portal in both editions without credentials or external calls;
- this evidence record.

No service, flow, database schema, signup path, billing behavior, tenant model, channel routing, Ring behavior or customer product name was added or redesigned.

## Candidate configuration and service matrix

Secrets below are variable names only. Values must come from the approved staging secret store and must never be committed or printed.

| Edition | Runtime services | Customer surface | Required staging configuration | Persistent state |
| --- | --- | --- | --- | --- |
| Hosted | **2 services** from one immutable Zenod image: public `AGENT=zenod`; private existing `AGENT=phylax` Channels runtime | One Zenod product. Public portal exposes Overview, Connect/MCP, Channels, Vault & sources, managed Usage and Account. No customer Phylax or Ring product copy. | Public: `AGENT=zenod`, `PORT`, `ZENOD_DATA_DIR`, `CUSTOMER_APP_URL`, GitHub OAuth variables, `ACCOUNT_STATE_SECRET`, `CHASSIS_VAULT_MASTER_KEY`, `ZENOD_MANAGED_AI_ENABLED=1`, `OPENROUTER_PROVISIONING_KEY`, managed limit/warn variables, approved Stripe test variables when signup is exercised, `ZENOD_CHANNELS_URL`, exact `ZENOD_CHANNELS_ALLOWED_ORIGINS`, shared `ZENOD_CHANNELS_PRIVATE_TOKEN`, optional explicit `ZENOD_CHANNELS_MEMORY_URL`. Private Channels: `AGENT=phylax`, `PORT`, `ZENOD_DATA_DIR`, `CHASSIS_VAULT_MASTER_KEY`, the same private-token value, and existing approved WhatsApp/Telegram transport configuration. | Separate durable `/data` volume per service. The private Channels volume owns the WhatsApp session; the Zenod volume owns accounts, vault and managed admission/receipt journals. |
| Self-hosted | **1 Zenod service**. No private Channels dependency. | Overview, Connect/MCP, Telegram-only Channels, Vault & sources, raw Usage and operator Settings. WhatsApp is absent. | `AGENT=zenod`, `PORT`, `ZENOD_DATA_DIR=/data`, `ZENOD_AWAIT_PROVISION=0`, vault repository/branch and GitHub credential or GitHub App configuration, operator-selected provider plus its matching key, optional Telegram bot configuration. | One durable `/data` volume plus the configured vault repository. |

The private service is the existing Phylax runtime selected from the shared code/image. It is called **Channels** in the Zenod customer journey. Ring is not on the customer path and is not required for direct Zenod text/voice/media capture.

### Immutable image and version pin plan

1. Build candidate `c7d85741b3cf3ef2069af0dfded4c4184250ff1b` in CI from a clean checkout.
2. Publish one image and record both the source SHA and returned registry digest.
3. Pin both Hosted services to the same immutable reference, for example `ghcr.io/zenod-ai/zenod@sha256:<registry-returned-digest>`. The placeholder is intentionally not a claimed digest.
4. Record service name, image digest, `GIT_SHA`, configuration revision and volume identity in the staging receipt.
5. Reject rollout if the two services have different source SHAs/digests or if `/healthz`/reported `GIT_SHA` does not match the receipt.

The current repository compose files are historical/operator inputs, not proof of this exact two-service staging deployment. Building, publishing and pinning the real digest is a staging blocker.

## Acceptance matrix

| Contract | Local proof at the candidate SHA | Result |
| --- | --- | --- |
| Signed Hosted account/auth, account isolation and hostile cookie/bearer capability | `customerLayer.test.ts`, `customerAccounts.test.ts`, `zenodUnit.test.ts` | PASS |
| Hosted repository/GitHub App, Drive, vault and MCP | `githubApp.test.ts`, `drive.test.ts`, `mcp.test.ts`, `zenodUnit.test.ts` | PASS |
| Customer-safe managed usage; no provider/model/key/raw-token/dollar leakage | `customerManagedAi*.test.ts`, `zenodUnit.test.ts`, `hosted-usage-card.test.tsx`, browser fixture sweep | PASS |
| Managed cap/raw admission, restart/replay and terminal receipts | `customerManagedAiAdmission.test.ts`, `customerManagedAiOutbox.test.ts`, `customerManagedAi.test.ts`, `zenodUnit.test.ts` | PASS |
| Hosted Telegram lifecycle, private admission and group denial | `telegram.test.ts`, `hostedChannels.test.ts`, `zenodUnit.test.ts` | PASS locally/synthetic |
| Private Channels facade and direct Zenod WhatsApp text/voice/media path | `hostedChannels.test.ts`, `phylaxTenantSettings.test.ts`, `phylaxChannels.test.ts`, `phylaxUnit.test.ts`, `whatsapp.test.ts`, `zenodUnit.test.ts` | PASS locally/synthetic |
| Channel retry/idempotency, receipt replay, identity collision and tenant isolation | Hosted/Phylax/WhatsApp/Telegram focused suites above | PASS locally/synthetic |
| Hosted has no Ring/Phylax customer copy or internal controls | `zenodUnit.test.ts`, `HostedChannelsPanel.test.tsx`, edition tests, browser fixture sweep | PASS |
| Self-host keeps provider/MCP/vault/raw usage and Telegram; no WhatsApp surface | `zenodUnit.test.ts`, edition/navigation/component tests, browser fixture sweep | PASS |
| Hosted Drive projection uses only safe routes/keys; self-host behavior remains | `google-drive-connect.test.tsx`, `Settings.drive-connect.test.tsx`, `zenodUnit.test.ts`, browser fixture sweep | PASS |
| Full regression/build/type/schema | exact commands below | PASS |

## Responsive browser evidence

The built `apps/web/dist` was served by `node scripts/zal17-portal-fixture.mjs` on loopback only. The fixture uses inert sample responses and makes no external request.

| Edition / Vault | Width | `scrollWidth` | Required controls | Forbidden-copy result |
| --- | ---: | ---: | --- | --- |
| Hosted | 360 | 360 | managed OAuth + folder ID present | none found |
| Hosted | 736 | 736 | managed OAuth + folder ID present | none found |
| Hosted | 1024 | 1024 | managed OAuth + folder ID present | none found |
| Self-hosted | 360 | 360 | existing OAuth client, service account, test/save and local transcription controls present | operator controls intentionally present |
| Self-hosted | 736 | 736 | same | operator controls intentionally present |
| Self-hosted | 1024 | 1024 | same | operator controls intentionally present |

Hosted forbidden-copy checks covered OAuth client secret, service account, private provider/model, OpenRouter, whisper/model names, API key, raw token, dollar and per-minute-cost copy. The approved customer MCP credential remains a customer-facing Connect/MCP capability and is not classified as a provider-secret leak.

Earlier in the same candidate pass, Overview, Connect/MCP, Channels, Vault, Usage and edition navigation were exercised at the same three widths. Hosted showed the six approved tabs; self-hosted showed its six operator tabs; no tested page overflowed horizontally; self-hosted Channels contained no WhatsApp surface.

## Exact commands and results

All terminal PASS commands below were rerun with a clean worktree at `c7d85741b3cf3ef2069af0dfded4c4184250ff1b`.

| Command | Result |
| --- | --- |
| `npm ci` | PASS; dependency install from the committed lockfile; no source/lock change |
| `npm test` | PASS across every workspace, 194 script assertions and schema check. Core summary: 31 files, 527 passed, 6 skipped. Schema: 27 self-contained tool schemas. |
| focused 15-file server acceptance command covering customer, managed AI, Hosted Channels, Phylax, WhatsApp, Telegram, MCP, Drive and GitHub App | PASS: 15 files, 295 tests |
| `npm test -w web` | PASS: 13 files, 69 tests |
| `npm run typecheck` | PASS across all configured workspaces |
| `npm run build` | PASS for core, chassis, server, customer web and public site; existing Vite chunk-size warning only |
| `npm run schemas:check` | PASS: 27 self-contained schemas, no files written |
| changed-file ESLint plus `git diff --check` | PASS |

Lint baseline disclosure:

- The repository has no root `lint` script.
- `npm run lint -w web` reports six pre-existing errors in `KeysTab.tsx`, `McpConfigTab.tsx`, `OperatingRulesTab.tsx` and `SkillSettingsTab.tsx`.
- None is in a ZAL-17 changed file; direct ESLint of all changed TS/TSX files passes.

## Rollback

Rollback is non-destructive and preserves all data/functionality:

1. Stop the staging rollout; do not delete either volume or reset a WhatsApp session.
2. Restore the previously recorded immutable image digest to **both** Hosted services.
3. Keep the same volume mounts and secret/config revision unless the incident is explicitly configuration-related.
4. If managed AI authority is suspect, disable its staging flag so it fails closed; do not mint/delete keys as part of code rollback.
5. Verify `/healthz`, expected `GIT_SHA`, customer auth projection, private Channels transport status and synthetic text/voice/media receipt flow.
6. If only the ZAL-17 source delta must be removed, revert candidate commit `c7d8574`; no schema/data migration or deletion is required.

## Explicit staging-only blockers and residual risks

These are blockers to a real Hosted beta claim, not failures hidden by the local verdict:

1. **Immutable image receipt:** CI must build/publish candidate `c7d8574`, return the real digest and prove both services run that digest.
2. **Version-coherent two-service staging:** public Zenod and private Channels must be configured with an exact private origin allowlist and matching secret, then restarted and observed without losing persistent receipts or WhatsApp session state.
3. **Real managed AI authority:** with approved staging credentials, prove tenant key provision, configured cap, raw admission at cap, restart/resume, terminal receipts and safe customer projection. No OpenRouter key or cap was mutated here.
4. **Real billing/signup:** with Stripe test-mode approval, prove signed checkout/webhook/account state and the paid Hosted entitlement. No Stripe endpoint, customer, price, card or subscription was used here.
5. **Real Telegram:** prove private DM activation, text/voice/media delivery, group denial and lost-response replay with an approved staging bot/identity.
6. **Real WhatsApp:** prove the existing shared session receives and returns text/voice/media through the direct Zenod path, preserves identity/tenant isolation, handles retry/idempotency, and recovers across process restart. No QR pairing or WhatsApp message was performed here.
7. **Drive OAuth credentials:** prove the managed Hosted Google OAuth redirect/callback/connect/disconnect journey with staging credentials and a disposable approved folder. Local proof covers routing, allowlist and presentation, not a Google authorization grant.
8. **Backup/restore:** take and verify staging backups of both `/data` volumes before rollout; prove rollback to the prior digest without deleting data or functionality.
9. **Existing lint debt:** six unrelated web lint errors remain. They do not invalidate the changed-file acceptance gate but should stay visible as repository debt.
10. **Bundle warning:** the customer web bundle remains above Vite's default chunk warning threshold. This is not a functional acceptance failure but remains a performance risk for public beta monitoring.

Production deploy, public signup, live Stripe, real-card billing, credential rotation, tenant/session/routing mutation and destructive cleanup remain closed human gates.

## Handoff decision

Advance `c7d85741b3cf3ef2069af0dfded4c4184250ff1b` only to an approved, credential-backed staging exercise. Do not describe local synthetic channel/provider/billing coverage as live proof. A beta/go-live decision requires receipts for blockers 1–8 on the same pinned image digest.
