# ZPF-10 closed-release gate packet

Status: phase 1 complete; production untouched

Prepared: 2026-08-27 23:12 CEST

Issue: [#1112](https://github.com/zenod-ai/zenod/issues/1112)

Exact candidate: `73e309adda4d04c5ea58f2ec4dc114143731ed1c`

## Outcome

The frozen integrated-independent Zenod–Phylax source architecture is built, reviewed, published as two separate immutable artifacts, and ready for the named backup/config/deployment gates. This packet does not claim deployment or live-journey success.

No production image, environment value, credential, MCP token, OAuth grant, Google credential, WhatsApp session, tenant row, volume, billing object, or signup state was changed while preparing this packet.

## Immutable candidate

| Service | Immutable image | OCI index | linux/amd64 manifest | PID 1 |
|---|---|---|---|---|
| Zenod | `ghcr.io/zenod-ai/zenod:sha-73e309a` | `sha256:a25a84c15dc9a6d3e7e860a2d5cbdc59cb71ae328ae1131ad625e92b2dabc1f3` | `sha256:2258c29ec7ff8fa5ec1483ffa25d4bde8f555c9752db99dd583d93b2021c8082` | `node packages/server/dist/main.js` |
| Phylax | `ghcr.io/zenod-ai/phylax:sha-73e309a` | `sha256:929b4b5c0c4bf5833f72eaa042d66d64f986f0856979b6cd9d3f71aa1a6fbc43` | `sha256:76ff048fb2aa02ff5a5be147a9ebb81b45d2c835fd436d90f7726c6b069312d3` | `node packages/server/dist/phylaxMain.js` |

Both images carry the exact OCI revision and baked `GIT_SHA` `73e309adda4d04c5ea58f2ec4dc114143731ed1c`. The Phylax image carries `dev.zenod.runtime=phylax-only` and passed the separate-artifact contract.

Automated evidence:

- exact-main CI [33116222429](https://github.com/zenod-ai/zenod/actions/runs/33116222429): PASS;
- paired publish [33116222471](https://github.com/zenod-ai/zenod/actions/runs/33116222471): PASS;
- server: 110 files / 1,109 tests;
- scripts: 194/194; schemas: 27/27;
- all-workspace typecheck, dedicated Phylax bundle and image contract: PASS;
- focused browser/synthetic, web and Phylax-web suites: PASS;
- independent architecture/security audit: PASS, no P1/P2 blocker;
- web lint: six pre-existing ZPF-7 findings, zero candidate delta.

## Current live baseline

| Surface | Dokploy app / service | Volume | Current image |
|---|---|---|---|
| Public Zenod | `2dkayH_eAur427leH64MT` / `zenod-mt-fxpzoo` | `zenod-mt-data:/data` | universal `sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a` |
| Private Channels | `urbFsgl6eImbQ4MTIZl5N` / `app-index-back-end-panel-6zm3qg` | `phylax-data:/data` | universal `sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a` |

Read-only inspection found both services healthy 1/1 on source `a6fbe8f`; the private worker and WhatsApp `self_host_dev` session are connected and ready, with no QR, auth, Drive, transcription, fatal, or error event in the inspected window. Current Dokploy and effective Swarm environment values match by per-key hash. Public has 34 existing pairs; private has 30. The shared Channels-token fingerprints match; the two service control tokens remain intentionally distinct.

Normal image rollback keeps both volumes and returns both services to the live, registry-available universal index `9308e5e...`. Deeper retained fallbacks `9ab0e06e...` and `72216fc7...` remain available.

## Exact preserved state and additive configuration

Every current environment pair and value, volume, tenant record, vault entry, direct MCP token, Google OAuth/refresh credential, channel binding, journal, and WhatsApp session remains unchanged.

Private Phylax adds the frozen island identity:

```text
PHYLAX_INSTANCE_MODE=zenod
PHYLAX_INSTANCE_ID=phylax-for-zenod
PHYLAX_SERVICE_NUMBER_ID=zenod-primary
```

First boot writes only the matching immutable `/data/phylax-instance.json`; it must not adopt this Zenod-bound volume as standalone.

For reproducible tariff accounting, the recommended explicit private pins are the current runtime defaults:

```text
PHYLAX_TARIFF_VERSION=phylax-runtime-v1
PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND=1
PHYLAX_INBOUND_MESSAGE_UNITS=1
PHYLAX_OUTBOUND_MESSAGE_UNITS=1
```

Public Zenod adds:

```text
ZENOD_PHYLAX_MANAGEMENT_URL=http://app-index-back-end-panel-6zm3qg:8080
ZENOD_PHYLAX_ALLOWED_ORIGINS=http://app-index-back-end-panel-6zm3qg:8080
ZENOD_PHYLAX_CONTROL_TOKEN=<secure byte-for-byte copy of the existing private CONTROL_PLANE_TOKEN>
ZENOD_MASTER_ALLOWANCE_UNITS=<approved positive integer>
ZENOD_PHYLAX_ALLOWANCE_UNITS=<approved positive integer>
ZENOD_ALLOWANCE_UNITS_PER_USD=<approved positive integer>
ZENOD_PHYLAX_TARIFF_VERSION=<approved nonempty version>
```

The service token is copied through the operator secret path; it is never printed, returned to the browser, minted, or rotated.

### Recommended beta configuration

The source and acceptance suites use this internally coherent beta configuration:

```text
ZENOD_MASTER_ALLOWANCE_UNITS=3000000
ZENOD_PHYLAX_ALLOWANCE_UNITS=1000000
ZENOD_ALLOWANCE_UNITS_PER_USD=1000000
ZENOD_PHYLAX_TARIFF_VERSION=tariff-v1
```

This is a proposed synthesis: a $3.00 master envelope leaves the UI contract's $2.00 local Zenod cap and allocates $1.00 to Phylax. The $2.00 local cap appears in the approved UI contract; the $1.00 Phylax allocation is a coherent tested recommendation, not a previously approved amount. It is a commercial/configuration choice, not an architecture change. Jordi must approve these exact values or provide replacements before target environment fingerprints and deploy JSON can be finalized.

Read-only derivation of this recommendation produced an exact, deploy-verifiable hypothetical target without exposing any value:

| Service | Current keys / canonical SHA-256 | Recommended target keys / canonical SHA-256 |
|---|---|---|
| Public Zenod | 34 / `5cfe7b9a3a98f90b983a95f1046b5a088778436fd376a49d2e9fe9e7c8b8170a` | 41 / `b8f026e3c5850f27ec518c09f92aa1441eba7e9dcb5e81088a60dc105c17c519` |
| Private Phylax | 30 / `36fea8d6332aa1897361c78f4fbb14fc488d0c3154eeda4ae87b32e20c5f5edf` | 37 / `43e9520e682d0d4f0d1d02c3f0985f502a7cd9dbbe76e27e35b25bc0811f9ec5` |

Canonicalization parses each nonempty dotenv line at its first `=`, rejects malformed or duplicate keys, requires every proposed key to be absent, sorts keys bytewise and hashes `KEY=VALUE\n` records with a terminal LF. Assertions passed: all 14 proposed keys are currently absent, every existing pair is byte-preserved, and the redacted copied-token fingerprint matches the private control token. These hashes are approval candidates only; nothing was written to Dokploy.

## Human gates

### Gate A — fresh backups only

Exact approval text:

> APPROVE ZPF-10 FRESH BACKUPS ONLY for `zenod-mt-data` and `phylax-data`: pause one exact 1/1 task at a time, create a mode-0600 archive, resume it, restore into a disposable volume, run the checked-in JSON/SQLite verifier with current live image `9308e5e…`, capture the complete current Dokploy records outside Git, copy all material to the configured client-encrypted `zenod-prod-crypt` remote, and download-check it. This does not approve deploy/config/channel/billing/signup.

The prepared operator command packet is preserved in [issue #1112](https://github.com/zenod-ai/zenod/issues/1112#issuecomment-5445262874). Pass requires two receipts, two archive/checksum pairs, two disposable-restore verifier passes, both services healthy afterward, encrypted off-host download-check success, and no session re-pair. Failure stops before deployment. The backup scripts resume a paused task on their exit trap and never overwrite or delete a live volume.

### Gate B — closed configuration and deployment

Gate B is not yet requestable because the allowance/tariff values are not approved. After values and Gate A evidence exist, its exact scope is:

1. Private Phylax first, pinned to OCI index `929b4b5c...`; preserve `phylax-data:/data`, all 30 current environment pairs and every credential/session; add only the approved identity/tariff pairs. Require exact source, `phylax-only`, identity `phylax-for-zenod/zenod/zenod-primary`, and WhatsApp ready without QR.
2. Public Zenod second, pinned to OCI index `a25a84c1...`; preserve `zenod-mt-data:/data` and all 34 current environment pairs; add only the approved management/allowance pairs. Require exact source, direct MCP continuity, Drive continuity, and public signup `0`.
3. On failure, roll public back first and private second to `9308e5e...`; preserve both volumes, credentials, tokens, sessions, journals, and the additive identity marker. Image rollback does not restore data.

The old ZAL-22 rollout script must not be reused because it pins one universal image to both services.

### Gate C — real journey

This remains a later, separate approval after the closed deployment is mechanically and browser healthy. One uninterrupted journey must prove text, URL, image, three overlapping eligible voice notes, raw Drive links, a >2h raw-only pointer, redelivery, one approved restart/no QR, cap pause/resume, combined customer usage, service-separated operator P&L, and exactly one terminal receipt per item. Real-card billing and public signup remain later independent gates under #1061.

## Remaining blocker

Only the production allowance/tariff values remain undecided in phase 1. Backups, deployment, live sends, real-card billing, and signup have not run. Public signup remains closed.
