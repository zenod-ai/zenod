# ZPF-1 frozen baseline contract — 2026-08-27

Status: **automated characterization complete; live claims remain explicitly unproved**

This packet freezes the customer-visible behavior and durability invariants that later ZPF tickets must preserve. It characterizes the current implementation; it does not redesign the architecture, deploy anything, rotate a credential, reconnect a client, send a channel message, or promote an unproved production behavior into a golden result.

## Exact baselines

- Contract source: `3e902f49372f211f589d73722f6be9bbf33a79d5` (`main` after the final-push control plane).
- Signup-closed deployed candidate: source `a6fbe8f1b385608bf00a5e1a5e5c385305eba7a2`, OCI index `sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a`.
- Deployment receipt: [`../zenod-zal22-production-rollout-2026-08-27/README.md`](../zenod-zal22-production-rollout-2026-08-27/README.md).
- Machine-readable contract: [`contract.json`](./contract.json).

## Frozen customer journeys

| Journey | Automated baseline | Production truth at freeze |
|---|---|---|
| Text and URL intake | Direct tenant Zenod binding, stable provider idempotency key, typed receipt | Existing text path observed; exact fixture is automated |
| Image intake | Authenticated artifact, no STT, one idempotent ingest, Drive link only from Zenod terminal receipt | Code path proved; live Drive-link lap not claimed here |
| Voice intake ≤2h | Automatic transcription, raw archive, no 30-minute confirmation gate | Short live captures observed; exact two-hour boundary automated |
| Voice intake >2h | No transcription, raw archive, Zenod pointer entry | Automated only; live lap remains unproved |
| Three overlapping voice notes | Three distinct provider keys, one ingest and one terminal receipt each; exact redelivery dedupes | Automated only; ZAL-22 still requests the live lap |
| Restart/recovery | Accepted work is recovered without replaying an ambiguous application mutation or provider send | Production restart emitted no new auth/session/Drive errors |
| Cap pause | Raw text/audio/image evidence is journaled before paid work is paused | Automated only |

## Credential, session and storage invariants

The harness locks these as continuity assertions, not migration behavior:

- the direct MCP bearer remains byte-identical across ordinary restart even if a later environment seed differs;
- registered OAuth clients and refresh authority persist in SQLite;
- each tenant's Google OAuth/folder state remains in that tenant's Zenod store;
- the WhatsApp session is reopened from its existing Phylax session directory and protected backup;
- Telegram identities and tenant sender bindings survive restart without crossing tenants; and
- production volume identities remain `zenod-mt-data:/data` and `phylax-data:/data` as recorded in the immutable rollout packet.

No test in this packet calls a live provider or reads a secret value from production.

## How to run

From the repository root:

```sh
npm run build -w zenod
npm run build -w @zenod/mcp-chassis
npm run test -w @zenod/server -- \
  test/phylaxBaselineContract.test.ts \
  test/phylaxChannels.test.ts \
  test/taskJobMediaIngestArchive.test.ts \
  test/customerManagedAiAdmission.test.ts \
  test/whatsappCredentials.test.ts \
  test/phylaxTenantSettings.test.ts \
  test/hostedChannels.test.ts \
  test/zenodUnit.test.ts
npm run test -w @zenod/mcp-chassis -- src/oauthSqliteStore.test.ts
```

That is the local composed contract surface: current Phylax transport/queue/session code plus the current Zenod ingest/Drive/tenant/OAuth code in one deterministic no-network run. The complete repository `npm test` remains the broader regression gate.

## Deliberately not green

The following remain observations to collect, not golden assertions:

1. three overlapping real WhatsApp voice notes each returning exactly one Saved receipt with the actual Google Drive audio link;
2. one practical over-two-hour live note following the archive-only/pointer path; and
3. a fresh container-level two-service walk from this exact source baseline.

Those gaps belong to final release acceptance. They are not reasons to weaken or rewrite the automated contract.
