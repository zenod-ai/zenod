# ZAL-22 production rollout receipt — 2026-08-27

Status: **signup-closed release candidate deployed; ready for Jordi's live voice-note test**

This receipt covers the final two-service deployment after the voice/Drive boundary and the integrated-but-independent Phylax decision were locked. It does not claim public signup, a real-card billing journey, or final Phylax allowance metering.

## Exact source and image

- Final source merge: `a6fbe8f1b385608bf00a5e1a5e5c385305eba7a2`
- Source PR: [#1101](https://github.com/zenod-ai/zenod/pull/1101)
- Source-head CI: [run 33033764333](https://github.com/zenod-ai/zenod/actions/runs/33033764333), success
- Publish run: [33033978660](https://github.com/zenod-ai/zenod/actions/runs/33033978660), success
- OCI index: `sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a`
- Linux/amd64 manifest: `sha256:5b5d86a091682e31cfdcab1386952fa9557cadf02e6714ff01468417f811a455`
- Immediate reviewed predecessor: source `8cdf049188b713449f5ed71bb9ee9ca2ab1dfee1`, OCI index `sha256:9ab0e06e259f7afc17035dc37e15c0d7828fdfb919336761a871bc4e430bd505`

Both running services report the complete final source SHA from `/api/health` and run the same final OCI index.

## Exact production targets

| Role | Dokploy application | Swarm service | Durable mount | Result |
|---|---|---|---|---|
| Public Zenod | `2dkayH_eAur427leH64MT` (`zenod-mt`) | `zenod-mt-fxpzoo` | `zenod-mt-data:/data` RW | 1/1, healthy, final SHA |
| Private Phylax | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) | `app-index-back-end-panel-6zm3qg` | `phylax-data:/data` RW | 1/1, healthy, final SHA |

Deployment order was public Zenod first, then private Phylax. Public health converged before the private image changed. Dokploy stored the new desired images, but its deploy action created no deployment. The already-documented reversible fallback updated only each exact Swarm service image. No environment, mount, replica, credential, token, session, route, or data value was changed by that fallback.

## Backups and rollback material

Fresh cold backups were created before the rollout. Each archive was restored into a disposable volume and passed JSON parsing plus SQLite integrity checks.

| Volume | Local verified archive | SHA-256 | Encrypted off-host object |
|---|---|---|---|
| `zenod-mt-data` | `/var/backups/zenod/20260826T235909Z-zal22/public/zenod-data-20260826T235921Z.tar.gz` | `b5c8a831465b106d95512441ef2e72986710fda0e4ae869f3dbb6a8c2f693773` | `s31:vps-archives/zenod/2026-08-27-zal22/public/zenod-data-20260826T235921Z.tar.gz.age` |
| `phylax-data` | `/var/backups/zenod/20260826T235909Z-zal22/channels/zenod-data-20260827T000936Z.tar.gz` | `dbdcd9d1816fa720b13946e16dd7f0d0a4a98c0410404c8d30743f8c0c3e7425` | `s31:vps-archives/zenod/2026-08-27-zal22/channels/zenod-data-20260827T000936Z.verified.tar.gz.age` |

Both encrypted objects passed a complete off-host download, decrypt, and SHA-256 comparison. The encrypted pre-rollout Dokploy configuration snapshot is `s31:vps-archives/zenod/2026-08-27-zal22/config/dokploy-pre-rollout-config.tar.age`.

The retained pre-release rollback images are public `sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d` and private `sha256:f8284f7db77866d7bdef735c62ef3f5185b5b4327092f9646986ce880f2e5159`; the encrypted config snapshot preserves their complete application definitions. The immediate code rollback is the reviewed predecessor index `sha256:9ab0e06e259f7afc17035dc37e15c0d7828fdfb919336761a871bc4e430bd505`.

## Redacted configuration delta

Public Zenod received only the reviewed closed-release values:

- `AGENT=zenod`
- removed the stale service-level `GIT_SHA` override
- internal Channels origin/allowlist and Zenod MCP memory URL
- the same pre-existing private Channels token, copied without printing or rotating it
- the approved live €9 monthly price reference
- legal version `2026-08-26`
- backup/restore verification time `2026-08-27T02:27:04Z`

`ZENOD_PUBLIC_PAID_SIGNUP` remains `0`. No OpenRouter child-key configuration was added. No Google operator credential was added. Private Phylax retained its complete environment byte-for-byte and changed image only. The correction rollout's public and private environment hashes were identical before and after (`5cfe7b9a...` and `d33d0e9c...`, respectively).

## Live acceptance

The following checks passed after both services reached the final SHA:

- public and private `/api/health` returned `status=ok` and the exact final source SHA;
- both Swarm services were 1/1 on the exact OCI index and retained the expected RW volume;
- the pre-existing direct `zenod_mt` MCP URL/token initialized with HTTP 200 without reconnection or rotation;
- signed Hosted portal Overview loaded the existing tenant;
- Channels loaded successfully and showed WhatsApp **Connected**, the existing verified masked sender, and Telegram **Not connected**;
- Vault & sources showed the existing tenant Google Drive connection and connected Google account without reauthentication;
- public and private post-restart logs contained no new fatal, startup, migration, credential, Drive, archive, or transcription errors;
- `https://zenod.dev` advertised €9 and no legacy €5/€50 offer; Terms showed version `2026-08-26`;
- production readiness returned HTTP 503 with exactly two remaining checks: `stripe_profile` and `live_billing_journey`; and
- public paid signup remained closed.

The Channels 503 found during acceptance was not an auth or transport failure. Private Phylax returned a healthy masked shared-number status, but the public projection accepted only raw phone-number syntax. PR #1101 narrowed that public schema to accept the existing privacy-safe masked form. The fix has focused, full-server, typecheck, CI, and live signed-browser proof.

## Human test now requested

1. Send three overlapping voice notes of at most two hours from the already verified WhatsApp sender.
2. Confirm each note produces exactly one final **Saved** receipt and that each receipt includes the original-audio Google Drive archive result/link.
3. Confirm there is no `could not confirm the final result`, duplicate final receipt, credential prompt, MCP reconnect, or session re-pair.
4. If a practical over-two-hour sample exists, confirm it is not transcribed, is archived to Drive, and files a Zenod pointer for later processing.

This is the only remaining live functional test for the ZAL-22 voice/Drive release boundary. It intentionally uses the existing tenant, MCP token, Google connection, and WhatsApp session.

## Remaining before public signup

Public signup is deliberately not ready to open yet:

- Stripe business/support profile must be corrected and verified in the Stripe Dashboard; the platform API correctly refused self-account mutation.
- One separately approved real €9 card checkout, provisioning, portal, cancel/refund journey must pass and record its completion timestamp.
- The integrated/standalone Phylax decision locks Phylax-owned metering and allowance accounting as the next bounded delivery seam. The current Hosted Usage screen therefore still reports usage temporarily unavailable; do not open public signup while that customer truth is incomplete.
- Jordi must approve opening `ZENOD_PUBLIC_PAID_SIGNUP=1` only after the above gates and the live voice test pass.

No real card, public signup, Google reauthorization, WhatsApp send/reset/re-pair, Telegram mutation, token rotation, credential migration, or data restore was performed by this release operation.
