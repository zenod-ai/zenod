# ZAL-4 — read-only production preflight

Date: 2026-08-26

Issue: [#1061](https://github.com/zenod-ai/zenod/issues/1061)

Branch: `codex/zal-4-production-gate`

Bound base: `a88cbd921d4ff22fa566f6f81d62670beb48be7c`

Integration target: `main`

Candidate source: `f4a1746eab3fef0e08ba933a30ed658e627e93d2`

Integrated candidate merge: `91b4e7da173f5932ff6d1d8b48c3e6db6c05269e`

## Verdict

**READY FOR PR #1089 DOCUMENTATION MERGE ONLY. DO NOT DEPLOY IMAGE `91b4e7d`.**

The locally accepted application candidate is published as one immutable GHCR image, but it is not an approved deployment candidate. The target applications, current rollback images, volumes, private network, public origins, current fail-closed signup state, and preliminary redacted environment delta are known. No production or provider state was changed during this preflight.

There is one release-contract blocker that must not be hidden: the candidate public site, Hosted account links, billing parser, Terms, readiness check, and current live Stripe price variables still implement **€5 monthly plus €50 yearly**, while the approved beta contract is **one €9/month plus VAT plan**. Deploying `91b4e7d` would continue exposing the wrong public pricing and legal contract even with checkout closed. The strong recommendation is to merge this documentation only, correct the product contract in code, publish a new immutable digest, and evaluate that future digest in a fresh preflight.

## No-mutation boundary

This pass performed only:

- local repository and registry reads;
- read-only Dokploy API queries;
- read-only Docker/VPS metadata and health queries;
- unauthenticated public GET probes; and
- a private-network GET from the public container to the existing Phylax health endpoint.

It did **not** update Dokploy, images, replicas, domains, environment, credentials, Stripe, OpenRouter, Google, customer records, signup, routes, WhatsApp/Telegram sessions, volumes, backups, or verification timestamps. It did not build or push an image. Secret values were not printed or written.

## Candidate image receipt

The `main` image publish workflow succeeded for the integrated merge in [GitHub Actions run 32920326399](https://github.com/zenod-ai/zenod/actions/runs/32920326399).

| Item | Exact value |
| --- | --- |
| Source candidate proved by ZAL-17 | `f4a1746eab3fef0e08ba933a30ed658e627e93d2` |
| Integrated merge built by GHCR workflow | `91b4e7da173f5932ff6d1d8b48c3e6db6c05269e` |
| Immutable tag | `ghcr.io/zenod-ai/zenod:sha-91b4e7d` |
| Observed OCI index digest; not approved for deploy | `sha256:7d28e02d21a26300955c21173cf1992290c8cfe5de565d2fe47e91353812bcde` |
| Linux/amd64 image manifest | `sha256:3d09be2a00f5c7d3d4642e98ae09f772f1dc512f848994971ee9e92b65a8caad` |
| Observed immutable reference; do not deploy | `ghcr.io/zenod-ai/zenod:sha-91b4e7d@sha256:7d28e02d21a26300955c21173cf1992290c8cfe5de565d2fe47e91353812bcde` |

The source candidate and integrated merge differ only by evidence/merge history, not the application source proved by ZAL-17. This receipt makes the artifact auditable; it does not approve it. A future pricing-corrected digest must be separately named, re-preflighted and approved for both services. At that future configuration gate, the current explicit `GIT_SHA` runtime overrides should be removed so they cannot mask the SHA baked into the immutable image.

## Exact Dokploy and VPS target

Dokploy base: `https://dokploy.polyqu.com/api`

VPS: `hetzner_vps_1` / `49.13.24.121`

| Scope | Exact target | Current state | Future intended topology; not approved here |
| --- | --- | --- | --- |
| Project | `zenod` · `FWSR0dSSjeOSjPsIsMty3` | exists | unchanged |
| Environment | `production` · `5BPzY3n4l6eSctYuUqXFN` | exists | unchanged |
| Public service | application `zenod-mt` · `2dkayH_eAur427leH64MT`; Swarm service `zenod-mt-fxpzoo` | 1/1 | 1/1, public Zenod role, future pricing-corrected digest |
| Public volume | `zenod-mt-data:/data` | present, about 1.6 GB | preserve in place |
| Private Channels service | existing application `phylax` · `urbFsgl6eImbQ4MTIZl5N`; Swarm service `app-index-back-end-panel-6zm3qg` | 1/1 | 1/1, private Phylax role, same future pricing-corrected digest |
| Private Channels volume | `phylax-data:/data` | present, about 2.3 GB; owns WhatsApp session/journal | preserve in place; never reset/re-pair as part of rollout |
| Shared network | `dokploy-network` · `0k299mqvlih0w59gstyl5nvi1` | both services attached | unchanged |
| Customer origins | `https://zenod.dev`, `https://cloud.zenod.dev` | public | unchanged |
| Legacy public origin | `https://mind.zenod.dev` on public app | present | preserve unless separately retired |
| Existing Phylax owner/legacy origin | `https://phylax.zenod.dev` | present | preserve for this non-destructive rollout; do not advertise as a product |
| Private Channels origin | `http://app-index-back-end-panel-6zm3qg:8080` | public container reached `/healthz` with 200 | configure only as the public service's allowed private Channels origin |
| Ring | application `ring` · `hkdStWh6zfJ9d-uohdJHt`; service `ring-ycxjwn`; volume `ring-data` | separate 1/1 legacy product | excluded from Zenod routing and untouched |

The future topology remains exactly **two Zenod Hosted runtime services from one codebase/image**: public Zenod and the existing private Phylax runtime presented to customers only as Channels. It does not create a third service or a new Channels codebase. This topology statement is not deployment approval.

## Current rollback images

| Service | Current source SHA | Current immutable registry digest | Rollback reference |
| --- | --- | --- | --- |
| Public Zenod | `7365dbc1c7d869f6c78ee010e47e998f87091c4d` | `sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` | `ghcr.io/zenod-ai/zenod:sha-7365dbc@sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` |
| Private Channels | `399b3a8dc07154008553702b9c9d689ba92cb63b` | `sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159` | `ghcr.io/zenod-ai/zenod:sha-399b3a8@sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159` |
| Ring, excluded/preserved | `0be407a10ff5cd50c306398f919009b4d8fc5734` | `sha256:18a95f2507bbd43e28fd5c2de80a1066c50a21bf03e86948dd6e36c33b0509c4` | no rollout action |

The live Zenod/Channels images are currently version-skewed. A future pricing-corrected rollout should make only the two Zenod Hosted services version-coherent. Ring remains separate.

## Redacted environment-key delta

Statuses below are key presence/action only. No value is included.

### Public `zenod-mt`

| Key | Current | Required action |
| --- | --- | --- |
| `AGENT` | absent | add as explicit public Zenod mode |
| `GIT_SHA` | present | future pricing-corrected deploy: remove runtime override and use the image-baked SHA |
| `NODE_ENV` | present | retain |
| `PORT` | present | retain |
| `ZENOD_DATA_DIR` | present | retain |
| `CUSTOMER_APP_URL` | present | retain after origin check |
| `DOMAIN` | present | retain after origin check |
| `ZC_COOKIE_DOMAIN` | present | retain after domain check |
| `ACCOUNT_STATE_SECRET` | present | retain; do not rotate during rollout |
| `CHASSIS_VAULT_MASTER_KEY` | present | retain; do not rotate during rollout |
| `CONTROL_PLANE_TOKEN` | present | retain; do not rotate during rollout |
| `GITHUB_OAUTH_CLIENT_ID` | present | retain |
| `GITHUB_OAUTH_CLIENT_SECRET` | present | retain |
| `GITHUB_OAUTH_CALLBACK_URL` | present | retain after callback check |
| `ZENOD_PUBLIC_SITE_HOST` | present and non-empty | optional for boot: `isPublicSiteHost` defaults to `zenod.dev` when neither a route option nor this key is supplied; retain the explicit key in a future exact delta so `zenod.dev` serves the public site and other Zenod hosts serve the app without relying on the fallback |
| `GOOGLE_OAUTH_CLIENT_ID` | absent | add from approved operator credential store |
| `GOOGLE_OAUTH_CLIENT_SECRET` | absent | add from approved operator credential store |
| `ZENOD_MANAGED_AI_ENABLED` | absent | add only with explicit provider-mutation approval |
| `OPENROUTER_PROVISIONING_KEY` | absent in Dokploy; operator-store item present | add only with explicit provider-mutation approval |
| `ZENOD_MANAGED_AI_LIMIT_USD` | absent | add operator-only cap setting |
| `ZENOD_MANAGED_AI_WARN_PERCENT` | absent | add operator-only warning setting |
| `ZENOD_MANAGED_AI_RECONCILE_INTERVAL_MS` | absent | optional; keep absent to use tested default unless explicitly changed |
| `ZENOD_MANAGED_AI_ADMISSION_RESUME_INTERVAL_MS` | absent | optional; keep absent to use tested default unless explicitly changed |
| `ZENOD_CHANNELS_URL` | absent | add private service origin |
| `ZENOD_CHANNELS_ALLOWED_ORIGINS` | absent | add exact private-origin allowlist |
| `ZENOD_CHANNELS_PRIVATE_TOKEN` | absent | create in approved secret store and add; same secret on both services |
| `ZENOD_CHANNELS_MEMORY_URL` | absent | add explicit public MCP authority origin |
| `STRIPE_MODE` | present | no change authorized by this docs merge; future exact delta must state its status |
| `STRIPE_SECRET_KEY` | present | retain; do not rotate |
| `STRIPE_WEBHOOK_SECRET` | present | retain; do not rotate |
| `STRIPE_WEBHOOK_ENDPOINT_ID` | present | retain |
| `PRICE_MONTHLY` | present, legacy-contract mismatch | do not use for beta checkout; replace only after pricing correction and Stripe approval |
| `PRICE_YEARLY` | present, legacy-contract mismatch | do not use for beta checkout; remove requirement only through reviewed code, not ad hoc config |
| `STRIPE_PORTAL_CONFIGURATION_ID` | present | retain pending pricing/billing review |
| `STRIPE_TAX_MODE` | present | retain |
| `STRIPE_AUTOMATIC_TAX` | present | retain |
| `ZENOD_SUPPORT_EMAIL` | present | retain |
| `ZENOD_LEGAL_VERSION` | absent | add only after the current legal package is reviewed |
| `ZENOD_PUBLIC_PAID_SIGNUP` | present; endpoint confirms closed | keep fail-closed |
| `ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS` | present | no change authorized; a future closed-deploy delta should close tester checkout, and a later billing gate must name any exact tester |
| `ZENOD_BACKUP_RESTORE_VERIFIED_AT` | present and currently accepted by old single-volume readiness | do not reuse for two-volume rollout; set only after fresh public + Channels restore evidence |
| `ZENOD_STRIPE_WEBHOOK_VERIFIED_AT` | present and current by endpoint | do not change prospectively |
| `ZENOD_STRIPE_PORTAL_VERIFIED_AT` | present and current by endpoint | do not change prospectively |
| `ZENOD_STRIPE_PROFILE_VERIFIED_AT` | absent | leave absent until live profile proof |
| `ZENOD_LIVE_BILLING_VERIFIED_AT` | absent | leave absent until separately approved real-card proof |

No conventional local Google OAuth credential-store item was discoverable by key-name presence checks. The Google client and approved redirect URI therefore remain a named credential blocker. No credential value was requested or read.

### Private existing Phylax / Channels service

| Key | Current | Required action |
| --- | --- | --- |
| `AGENT` | absent | add explicit `phylax` mode |
| `ZENOD_UNIT` | present | retain for backward-compatible mode selection during this rollout |
| `GIT_SHA` | present | future pricing-corrected deploy: remove runtime override and use the image-baked SHA |
| `NODE_ENV` | present | retain |
| `PORT` | present | retain |
| `ZENOD_DATA_DIR` | present | retain |
| `CHASSIS_VAULT_MASTER_KEY` | present | retain; do not rotate |
| `CONTROL_PLANE_TOKEN` | present | retain; do not rotate |
| `CUSTOMER_APP_URL` | present | retain for legacy/admin compatibility |
| `DOMAIN` | present | retain for legacy/admin compatibility |
| `ZC_COOKIE_DOMAIN` | present | retain |
| `ZENOD_CHANNELS_PRIVATE_TOKEN` | absent | add the same approved secret as public Zenod |
| `TELEGRAM_ENABLED` | present | retain |
| `TELEGRAM_BOT_TOKEN` | present | retain; do not rotate |
| `TELEGRAM_ALLOWED_USERS` | present | retain |
| `TELEGRAM_ACCEPT_ALL` | present | retain and verify fail-closed policy before customer proof |
| `TELEGRAM_RICH` | present | retain |
| `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` | absent | no addition required for the default local transcription path; any managed cloud transcription key is a separate design and credential gate |

All other existing keys remain byte-for-byte preserved unless a later redacted delta explicitly names them. No environment change is authorized by this document. A future rollout must not overwrite the complete environment from a reconstructed template.

## Current fail-closed production truth

Read-only public probes returned:

- public Zenod `/healthz`: 200;
- public Zenod `/api/health`: 200, source `7365dbc1c7d869f6c78ee010e47e998f87091c4d`;
- private Phylax `/api/health`: 200, source `399b3a8dc07154008553702b9c9d689ba92cb63b`, worker healthy, WhatsApp connected, receive path ready, no restart requested;
- `https://zenod.dev` and its Terms, Privacy, and Data Handling pages: 200 with the expected page identities; and
- `/api/public/production-readiness`: 503, `publicPaidSignup=false`, 10/13 checks green.

The three current readiness failures are `legal_version`, `stripe_profile`, and `live_billing_journey`. No evidence timestamp was changed. Even if those three were repaired, the newly discovered €5/€50 candidate-code mismatch and missing two-volume backup proof still prevent the approved €9 beta from opening.

## Backup and isolated restore plan

The host currently contains one approximately 1.5 GB Zenod archive/checksum pair dated 2026-08-14. No separate Phylax/Channels archive was discoverable. The public volume is about 1.6 GB and the private Channels volume about 2.3 GB. The old readiness timestamp therefore cannot be treated as proof for this two-volume candidate.

The first future gate is to define the independent encrypted destination, retention, restore ownership and exact copy/verification procedure without quiescing anything. Only after that definition is approved may a separate backup-quiesce gate authorize the following steps:

1. Resolve and record the exact one-replica container names for `zenod-mt-fxpzoo` and `app-index-back-end-panel-6zm3qg`; verify their `/data` mounts are respectively `zenod-mt-data` and `phylax-data`.
2. Save a mode-0600 operator-only rollback snapshot outside the repository containing the complete current Dokploy configuration. The evidence packet retains only key names and status.
3. Run the existing verifier sequentially into separate directories so archives cannot collide:

   ```sh
   ZENOD_HEALTH_URL=https://cloud.zenod.dev/healthz \
     ./scripts/zenod-volume-backup.sh \
     <exact-public-container> zenod-mt-data /var/backups/zenod/public

   ZENOD_HEALTH_URL=https://phylax.zenod.dev/healthz \
     ./scripts/zenod-volume-backup.sh \
     <exact-private-container> phylax-data /var/backups/zenod/channels
   ```

   The script quiesces only the exact one-replica task, writes atomically, checks the checksum/archive, restores to a disposable volume, parses JSON, runs SQLite `integrity_check`, resumes the workload, and probes health.
4. Copy both archives and checksums to an approved independent encrypted destination. That destination and retention policy are not yet named and remain a human input.
5. Only after both receipts and the off-host copy exist may `ZENOD_BACKUP_RESTORE_VERIFIED_AT` be set to the later of the two actual completion times. Never set it from this preflight date.

If an incident requires data restore, restore the verified archive into a **new** explicitly named volume, run `scripts/verify-zenod-data.mjs`, change only the affected service mount after approval, and retain the original volume until application, MCP, tenant-isolation, and Channels checks pass. Never untar over the live source volume and never delete the original as part of rollback.

## Future independent gates and smoke matrix

These gates are intentionally independent. Approval of one does not authorize the next.

| Stage | Gate | Actions / evidence | Pass condition | Failure action |
| --- | --- | --- | --- | --- |
| 0 · docs merge | `APPROVE PR #1089 DOCS MERGE ONLY` | merge the packet/runbook only | exact docs land on `main`; zero external mutation | do not merge if review finds drift |
| 1 · off-host backup definition | separate planning approval | name encrypted destination, retention, copy, restore owner and verification procedure | complete non-secret procedure is reviewable; no workload pause | revise procedure |
| 2 · backup quiesce | separate operational approval | fresh verified public and Channels archives plus checksums and independent copy | both restore verifiers pass; both services return healthy; no session reset | resume exact task; do not deploy |
| 3 · credentials and exact config plan | separate credential/config-planning approval | name credential/token source or generation ceremony and publish redacted exact non-secret environment values for a future delta | every source, key status and non-secret value is reviewable; no config changed | keep capability absent/fail-closed |
| 4 · future pricing-corrected closed deploy | separate config/deploy approval for a **new digest**, not `91b4e7d` | snapshot config; apply approved delta; pin private then public to the named future digest; keep signup/test checkout closed | both services report the future SHA; health, public identity, MCP auth/isolation and rollback checks pass | restore captured config/digests; preserve volumes/session |
| 5 · OpenRouter reconciliation | separate provider-mutation approval | enable authoritative reconciliation against the exact approved account cohort | bounded child-key/cap/replay receipts with no duplicate or orphan | disable managed AI fail-closed; preserve audit |
| 6 · Google OAuth | separate Google grant/test approval | register callback and use a disposable account/folder for start/callback/status/folder/disconnect | exact tenant-isolated receipts; no operator credential leak | revoke disposable grant if approved; preserve tenant evidence |
| 7 · real Channels | separate send/session approval | approved WhatsApp and Telegram text/voice/media, lost-response replay and restart recovery without QR reset | direct Zenod path, no Ring, correct tenant, exactly-once receipts | stop sends; preserve session/journal; rollback only if required |
| 8 · €9 real-card billing | separate Stripe/profile/real-card approval | signed webhook, profile, portal, one approved €9 purchase, idempotent provisioning, MCP proof, cancel/refund | current evidence times set only after success | close checkout, refund/cancel as approved, preserve audit |
| 9 · public signup | separate exact `ZENOD_PUBLIC_PAID_SIGNUP=1` approval | enable only on the named future digest after every readiness/product check is green | startup succeeds, readiness 200, non-allowlisted checkout opens at approved €9 contract | immediately close signup; rollback if product/runtime checks fail |

Required exact non-financial probes after a future approved closed deployment include:

- both services report the same full merge SHA and registry digest;
- public origin and legal page identity, not merely HTTP 200;
- unauthenticated MCP rejection and existing-tenant read-only MCP success;
- two-tenant negative isolation;
- direct Zenod Channels routes with no Ring or customer-facing Phylax path;
- private transport health plus approved WhatsApp text/voice/media, lost-response replay, and restart recovery without pairing/reset;
- private Telegram DM proof and group denial with an approved test identity;
- managed usage customer projection contains only percentage/state/reset while operator evidence retains provider detail;
- at-cap raw text/audio/image remains journaled and resumes once; and
- the ZAL-2 recap prompt uses structural `search_memory` then exact `get_memory`, returns citations, emits no mutation-status prose, and leaves the vault HEAD unchanged.

## Non-destructive rollback

Rollback is image/config rollback, not data deletion:

1. Keep `ZENOD_PUBLIC_PAID_SIGNUP` closed and disable tester checkout.
2. Restore the public application's operator-only configuration snapshot and exact public rollback reference first. This stops the new public facade from calling a service being rolled back.
3. Restore the private Channels application's operator-only configuration snapshot and exact private rollback reference second.
4. Preserve `zenod-mt-data`, `phylax-data`, `ring-data`, every tenant record, encrypted credential record, managed-AI receipt, journal, Telegram binding, WhatsApp auth/session, and legacy handle. Do not disconnect, re-pair, delete a child key, or clear a queue as part of code rollback.
5. Confirm the public SHA returns to `7365dbc1c7d869f6c78ee010e47e998f87091c4d` and private SHA to `399b3a8dc07154008553702b9c9d689ba92cb63b`, with health and existing read-only MCP/channel-status checks passing.
6. If only one service fails, roll back that service while keeping the other service and both volumes intact; then evaluate version compatibility before resuming customer tests.
7. Use a data restore only for proven corruption, into a new volume from a verified archive. Retain the original volume until the restored surface passes.

The candidate contains no required schema/data migration, so normal rollback must not restore data or delete newly preserved records.

## Residual risks and blockers

1. **Pricing contract is not implemented:** the candidate still exposes/accepts €5 monthly and €50 yearly while the approved product is one €9 monthly plan. This blocks billing and signup.
2. **Google credentials are not installed or sourced:** both required public keys are absent; the approved callback must be registered before a real Drive test.
3. **Managed AI activation has external effects:** the provisioning credential is available in the operator store but absent from Dokploy. Enabling it starts authoritative reconciliation and may mint, cap, disable, or resume child keys for existing active/past-due accounts. Approval must explicitly include this effect.
4. **Channels secret is new:** the shared private token does not exist in either service and must be generated/stored through an approved secret path. Deploying private Phylax restarts/reconnects the existing transport even though it must not reset the session.
5. **Two-volume backup is missing:** the only discovered archive predates this rollout and no separate Channels backup was found. The off-host destination is unnamed.
6. **Live images are skewed:** public and private services currently run different SHAs. A future pricing-corrected rollout must pin both; transient deploy and rollback ordering matters.
7. **Credential-backed journeys remain unproved:** ZAL-17 used mocked Google, synthetic Channels/Telegram/WhatsApp, and local managed-AI boundaries.
8. **Private service still has a public legacy origin:** preserve it for non-destructive rollback, but do not present it as a product. Removing it is a separate domain/access decision.
9. **Current readiness is necessary but incomplete:** it reports 10/13, but its single backup timestamp and monthly/yearly price check do not encode the new two-service/single-plan contract.
10. **Every external action remains independently gated.** Documentation merge, backup-definition, backup-quiesce, credential/config planning, future closed deploy, OpenRouter reconciliation, Google OAuth, channel sends/session work, €9 real-card billing and public signup may not be bundled.

## Current exact human gate

The only current approval request is:

> **APPROVE PR #1089 DOCS MERGE ONLY**

This authorizes merging the three documentation/evidence files in PR #1089 and nothing else. It authorizes zero Dokploy, backup, quiesce, environment, credential, token, deploy, provider, Google, channel, billing, signup, route, session, data or verification-timestamp mutation.

## Future gate order

After the docs merge, future approvals must be requested separately and in this order:

1. define the off-host backup destination, retention and restore procedure;
2. authorize exact backup quiesce/verification for both volumes;
3. approve credential/token generation or source plus redacted exact non-secret environment values;
4. approve configuration and signup-closed deployment of a **future pricing-corrected immutable digest**;
5. approve OpenRouter reconciliation and child-key effects;
6. approve Google OAuth grant and disposable-account test;
7. approve real WhatsApp/Telegram sends or session-affecting work;
8. approve one €9 real-card billing drill and refund/cancel handling; and
9. approve public signup.

Each request must restate its exact target, effect, rollback and evidence. Approval of an earlier gate never authorizes a later one.
