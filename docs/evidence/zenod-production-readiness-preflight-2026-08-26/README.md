# ZAL-4 — read-only production preflight

Date: 2026-08-26

Issue: [#1061](https://github.com/zenod-ai/zenod/issues/1061)

Branch: `codex/zal-4-production-gate`

Bound base: `a88cbd921d4ff22fa566f6f81d62670beb48be7c`

Integration target: `main`

Candidate source: `f4a1746eab3fef0e08ba933a30ed658e627e93d2`

Integrated candidate merge: `91b4e7da173f5932ff6d1d8b48c3e6db6c05269e`

## Verdict

**READY FOR AN EXPLICITLY APPROVED, SIGNUP-CLOSED TWO-SERVICE DEPLOYMENT PREP; NOT READY FOR A BILLING DRILL OR PUBLIC SIGNUP.**

The approved application candidate is already published as one immutable GHCR image. The target applications, current rollback images, volumes, private network, public origins, current fail-closed signup state, and redacted environment delta are known. No production or provider state was changed during this preflight.

There is one release-contract blocker that must not be hidden: the candidate public site, Hosted account links, billing parser, Terms, readiness check, and current live Stripe price variables still implement **€5 monthly plus €50 yearly**, while the approved beta contract is **one €9/month plus VAT plan**. The image may be deployed with signup and tester checkout closed for credential-backed staging, but it may not be used for a billing drill or public sale until that bounded pricing contract is corrected and reviewed.

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
| OCI index digest to approve and pin | `sha256:7d28e02d21a26300955c21173cf1992290c8cfe5de565d2fe47e91353812bcde` |
| Linux/amd64 image manifest | `sha256:3d09be2a00f5c7d3d4642e98ae09f772f1dc512f848994971ee9e92b65a8caad` |
| Proposed exact reference | `ghcr.io/zenod-ai/zenod:sha-91b4e7d@sha256:7d28e02d21a26300955c21173cf1992290c8cfe5de565d2fe47e91353812bcde` |

The source candidate and integrated merge differ only by evidence/merge history, not the application source proved by ZAL-17. Both Hosted services must use the exact proposed reference and report the full integrated merge SHA from `/api/health`. The current explicit `GIT_SHA` runtime overrides must be removed during the approved rollout so they cannot mask the SHA baked into the immutable image.

## Exact Dokploy and VPS target

Dokploy base: `https://dokploy.polyqu.com/api`

VPS: `hetzner_vps_1` / `49.13.24.121`

| Scope | Exact target | Current state | Proposed state |
| --- | --- | --- | --- |
| Project | `zenod` · `FWSR0dSSjeOSjPsIsMty3` | exists | unchanged |
| Environment | `production` · `5BPzY3n4l6eSctYuUqXFN` | exists | unchanged |
| Public service | application `zenod-mt` · `2dkayH_eAur427leH64MT`; Swarm service `zenod-mt-fxpzoo` | 1/1 | 1/1, `AGENT=zenod`, candidate digest |
| Public volume | `zenod-mt-data:/data` | present, about 1.6 GB | preserve in place |
| Private Channels service | existing application `phylax` · `urbFsgl6eImbQ4MTIZl5N`; Swarm service `app-index-back-end-panel-6zm3qg` | 1/1 | 1/1, `AGENT=phylax`, same candidate digest |
| Private Channels volume | `phylax-data:/data` | present, about 2.3 GB; owns WhatsApp session/journal | preserve in place; never reset/re-pair as part of rollout |
| Shared network | `dokploy-network` · `0k299mqvlih0w59gstyl5nvi1` | both services attached | unchanged |
| Customer origins | `https://zenod.dev`, `https://cloud.zenod.dev` | public | unchanged |
| Legacy public origin | `https://mind.zenod.dev` on public app | present | preserve unless separately retired |
| Existing Phylax owner/legacy origin | `https://phylax.zenod.dev` | present | preserve for this non-destructive rollout; do not advertise as a product |
| Private Channels origin | `http://app-index-back-end-panel-6zm3qg:8080` | public container reached `/healthz` with 200 | configure only as the public service's allowed private Channels origin |
| Ring | application `ring` · `hkdStWh6zfJ9d-uohdJHt`; service `ring-ycxjwn`; volume `ring-data` | separate 1/1 legacy product | excluded from Zenod routing and untouched |

This is exactly **two Zenod Hosted runtime services from one codebase/image**: public Zenod and the existing private Phylax runtime presented to customers only as Channels. It does not create a third service or a new Channels codebase.

## Current rollback images

| Service | Current source SHA | Current immutable registry digest | Rollback reference |
| --- | --- | --- | --- |
| Public Zenod | `7365dbc1c7d869f6c78ee010e47e998f87091c4d` | `sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` | `ghcr.io/zenod-ai/zenod:sha-7365dbc@sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` |
| Private Channels | `399b3a8dc07154008553702b9c9d689ba92cb63b` | `sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159` | `ghcr.io/zenod-ai/zenod:sha-399b3a8@sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159` |
| Ring, excluded/preserved | `0be407a10ff5cd50c306398f919009b4d8fc5734` | `sha256:18a95f2507bbd43e28fd5c2de80a1066c50a21bf03e86948dd6e36c33b0509c4` | no rollout action |

The live Zenod/Channels images are currently version-skewed. The proposed rollout makes only the two Zenod Hosted services version-coherent. Ring remains separate.

## Redacted environment-key delta

Statuses below are key presence/action only. No value is included.

### Public `zenod-mt`

| Key | Current | Required action |
| --- | --- | --- |
| `AGENT` | absent | add as explicit public Zenod mode |
| `GIT_SHA` | present | remove runtime override; use baked candidate SHA |
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
| `STRIPE_MODE` | present | retain for signup-closed staging only |
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
| `ZENOD_LIVE_CHECKOUT_TESTER_GITHUB_IDS` | present | clear for initial closed deploy; restore an exact tester only at the separately approved billing drill |
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
| `GIT_SHA` | present | remove runtime override; use baked candidate SHA |
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

All other existing keys remain byte-for-byte preserved unless a later redacted delta explicitly names them. The rollout must not overwrite the complete environment from a reconstructed template.

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

After exact backup approval and immediately before deployment:

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

## Staged rollout and smoke matrix

| Stage | Gate | Actions / evidence | Pass condition | Failure action |
| --- | --- | --- | --- | --- |
| 0 · current preflight | read-only | exact images/digests, target IDs, volumes, network, origins, key presence, registry receipt, public/private health | this packet is reproducible; signup remains closed | stop; no mutation |
| 1 · backup | separate backup/quiesce approval | fresh verified public and Channels archives plus checksums and independent copy | both restore verifiers pass; both services return healthy; no session reset | resume exact task; do not deploy |
| 2 · private candidate | deployment/config approval | snapshot config; add approved private delta; pin existing Phylax app to candidate digest | `/api/health` reports `phylax` and full candidate merge SHA; worker/transport health acceptable; same `phylax-data` mount | restore private rollback digest/config; keep volume/session |
| 3 · public candidate | same deployment/config approval | add approved public delta; pin `zenod-mt` to same digest; keep signup/test checkout closed | `/healthz` and `/api/health` 200 with full candidate SHA; readiness remains non-200/closed; customer site and legal identities correct | restore public rollback digest/config first, then private if required |
| 4 · closed non-financial proof | explicit credential/provider/channel test approvals as applicable | GitHub sign-in/account; unauthenticated MCP rejected; existing tenant initialize/list/read; two-tenant isolation; Google config/start/callback/folder/disconnect with disposable account; managed AI cap/journal/restart; private Channels status and approved text/voice/media/replay without QR reset | exact receipts on same two-service digest; no provider/internal metadata leak; no Ring path; raw evidence retained at cap | disable affected capability fail-closed and/or digest rollback; preserve data/session/keys for audit |
| 5 · billing proof | separate exact Stripe/profile/real-card approval, after pricing correction | signed webhook, profile, portal, one approved €9 real-card purchase, idempotent tenant/key provisioning, MCP proof, cancel/refund handling | current evidence times set only after each success; tester remains exact allowlist | close checkout, refund/cancel as approved, preserve audit |
| 6 · public signup | separate exact `ZENOD_PUBLIC_PAID_SIGNUP=1` approval | enable only on the named digest after every readiness/product check is green | startup succeeds, readiness 200, non-allowlisted checkout opens at approved €9 contract | immediately set signup closed; rollback if product/runtime checks fail |

Required exact non-financial probes after the closed deployment include:

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
6. **Live images are skewed:** public and private services currently run different SHAs. Rollout must pin both; transient deploy and rollback ordering matters.
7. **Credential-backed journeys remain unproved:** ZAL-17 used mocked Google, synthetic Channels/Telegram/WhatsApp, and local managed-AI boundaries.
8. **Private service still has a public legacy origin:** preserve it for non-destructive rollback, but do not present it as a product. Removing it is a separate domain/access decision.
9. **Current readiness is necessary but incomplete:** it reports 10/13, but its single backup timestamp and monthly/yearly price check do not encode the new two-service/single-plan contract.
10. **Real-card, public signup, route/session changes, and publication remain separate gates.** A closed deployment approval authorizes none of them unless explicitly named.

## Exact human approval request

The next safe approval is:

> **APPROVE ZAL-4 CLOSED DEPLOYMENT PREP** for candidate merge `91b4e7da173f5932ff6d1d8b48c3e6db6c05269e`, pinned on both Dokploy applications `2dkayH_eAur427leH64MT` and `urbFsgl6eImbQ4MTIZl5N` to OCI digest `sha256:7d28e02d21a26300955c21173cf1992290c8cfe5de565d2fe47e91353812bcde`, preserving `zenod-mt-data`, `phylax-data`, the existing WhatsApp session, all legacy records, and Ring. Approve the redacted key delta in this packet, fresh verified backups of both volumes, and rollback to public digest `sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` plus private digest `sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159`. Keep public signup and tester checkout closed. Do not run billing, send channel test messages, reset/pair a session, create Google grants, or enable OpenRouter reconciliation unless separately named.

Because the Google credential source, independent backup destination, Channels token creation, and pricing correction are still unresolved, the operator must restate the final concrete configuration plan after those inputs exist. **This packet is not itself approval.**

Real-card billing and `ZENOD_PUBLIC_PAID_SIGNUP=1` require later, separate exact approvals.
