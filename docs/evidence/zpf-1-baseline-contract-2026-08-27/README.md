# ZPF-1 frozen baseline contract — 2026-08-27

Status: **automated characterization complete; the real composed text/URL seam is repaired and green; live claims remain explicitly unproved**

This packet freezes the customer-visible behavior and durability invariants that later ZPF tickets must preserve. It characterizes the current implementation; it does not redesign the architecture, deploy anything, rotate a credential, reconnect a client, send a channel message, or promote an unproved production behavior into a golden result.

## Exact baselines

- Contract source: `3e902f49372f211f589d73722f6be9bbf33a79d5` (`main` after the final-push control plane).
- Repair base: `264955371bbf85b44be5540448f0e1e8998889b8` (`main` with the corrected ZPF-1 characterization merged).
- Signup-closed deployed candidate: source `a6fbe8f1b385608bf00a5e1a5e5c385305eba7a2`, OCI index `sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a`.
- Deployment receipt: [`../zenod-zal22-production-rollout-2026-08-27/README.md`](../zenod-zal22-production-rollout-2026-08-27/README.md).
- Machine-readable contract: [`contract.json`](./contract.json).

## Frozen customer journeys

| Journey | Automated baseline | Production truth at freeze |
|---|---|---|
| Text and URL intake | **Passed after ZPF-1R:** authenticated discovery, durable enqueue, canonical ticket polling and one terminal reply succeed; exact redelivery reuses the same job and reply | Existing deployed text path observed separately; repaired source is not yet deployed proof |
| Image intake | Authenticated artifact, no STT, one idempotent ingest, Drive link only from Zenod terminal receipt | Code path proved; live Drive-link lap not claimed here |
| Voice intake ≤2h | Automatic transcription, raw archive, no 30-minute confirmation gate | Short live captures observed; exact two-hour boundary automated |
| Voice intake >2h | No transcription, raw archive, Zenod pointer entry | Automated only; live lap remains unproved |
| Three overlapping voice notes | Three distinct provider keys, one ingest and one terminal receipt each; exact redelivery dedupes | Automated only; ZAL-22 still requests the live lap |
| Restart/recovery | Accepted work is recovered without replaying an ambiguous application mutation or provider send | Production restart emitted no new auth/session/Drive errors |
| Cap pause | Raw text/audio/image evidence is journaled before paid work is paused | Automated only |

## Credential, session and storage invariants

The harness locks these as continuity assertions, not migration behavior:

- same-tenant MCP reconciliation preserves established credentials across restart, rejects cross-tenant adoption, and changes authority only through explicit rotation;
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
npm run test -w @zenod/mcp-chassis -- \
  src/oauthSqliteStore.test.ts \
  src/sqliteTenantStore.test.ts
```

That is the local composed contract surface: the current Phylax transport and durable queue call the real `createZenodUnit` over a local loopback MCP transport, authenticate against its tenant store, and discover its actual tool schema. It uses separate temporary Zenod and Phylax stores and no provider or external-network call. The test proves `chat_with_zenod` accepted-ticket polling, terminal reply, exact redelivery dedupe and cross-tenant poll rejection. The adjacent suites retain the voice, Drive, restart, cap, session and OAuth cases. The complete repository `npm test` remains the broader regression gate.

## Resolved source-baseline failure

The exact source baseline `3e902f4` did not complete the real composed text/URL journey:

1. a mismatched cross-tenant bearer is rejected with HTTP 401;
2. the correct tenant authenticates and real `tools/list` advertises the actual `chat_with_zenod` schema;
3. Phylax supplies its stable provider idempotency key;
4. Zenod durably enqueues and completes the chat task; but
5. chassis replaced the accepted response with `undeclared_long_tool` because `chat_with_zenod` was absent from `conduct.longTools`, so Phylax could not receive the ticket and poll the terminal reply.

ZPF-1R repairs only that declaration: `chat_with_zenod` now uses the same canonical `get_task_result` long-tool contract as the existing durable tools. The composed test sends each text/URL fixture twice and proves one stable idempotency key, one durable Zenod job, one terminal job identity and the same terminal reply on redelivery. A mismatched tenant bearer remains HTTP 401 for discovery and polling. The historical failure stays recorded in `contract.json` under `resolvedSourceBaselineFailures`; production remains unchanged.

## Deliberately not green

The following remain observations to collect, not golden assertions:

1. three overlapping real WhatsApp voice notes each returning exactly one Saved receipt with the actual Google Drive audio link;
2. one practical over-two-hour live note following the archive-only/pointer path; and
3. a fresh container-level two-service walk from this exact source baseline.

Those gaps belong to final release acceptance. They are not reasons to weaken or rewrite the automated contract.
