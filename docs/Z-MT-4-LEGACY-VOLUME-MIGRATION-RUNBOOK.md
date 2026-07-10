# Z-MT-4 Legacy Volume Migration Runbook

Issue: [#737](https://github.com/zenod-ai/zenod/issues/737)

This runbook rehearses one stopped legacy Zenod volume into the shared layout at `/data/<tenant>/`. It does not authorize a live tenant migration. Production execution belongs to Z-MT-6 and requires Jordi's recorded migration-window approval.

Runtime prerequisites: Node.js 22 or later and Git. No container runtime or live credential is needed for a rehearsal.

## Safety Contract

- Dry-run is the default and performs no filesystem or registry writes.
- Apply requires `--apply --confirm-source-stopped` plus the exact `planDigest` from the current dry-run.
- The source and target must be disjoint mounts. Mount the legacy volume separately; do not use `/data` as both source and destination.
- Pass only the existing SHA-256 token hash. The utility rejects raw-token input and receipts never contain the raw token.
- Existing target content is never overwritten. An identical target is treated as an idempotent rerun; different content stops the migration.
- Copying happens in a temporary sibling directory. The target appears only after checksums, SQLite integrity, and Git verification pass.
- Rollback refuses to delete a target changed after migration and removes only target/registry state owned by the selected apply receipt.

## Inputs

Record these in the Z-MT-6 inventory before a live window:

| Input | Example | Source of truth |
|---|---|---|
| Tenant id | `jordi-f2c7a6` | approved tenant inventory |
| Legacy source mount | `/mnt/legacy/jordi-f2c7a6` | stopped legacy volume |
| New unit data root | `/data` | shared Zenod volume |
| Existing token hash | 64 hex characters | current control-plane/tenant record |
| Registry | `/data/chassis-tenants.sqlite` | chassis tenant registry |
| Receipt directory | `/data/migration-receipts` | operator evidence store |

Do not derive or print the raw bearer in this workflow. If the inventory cannot supply the existing hash, stop and route that gap to the Epic 3.2 steward.

## Rehearsal

Use a copied/synthetic legacy volume and a disposable data root. This is the ticket-level proof and needs no production approval.

```bash
PLAN_JSON=$(node scripts/migrate-zenod-volume.mjs \
  --source /tmp/zmt4/legacy-volume \
  --data-root /tmp/zmt4/new-data \
  --tenant tenant-rehearsal \
  --token-hash "$TOKEN_HASH")
printf '%s\n' "$PLAN_JSON"
PLAN_DIGEST=$(printf '%s\n' "$PLAN_JSON" | node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0, "utf8")).planDigest)')
```

The JSON result must state `operation: "plan"`, `mutation: false`, enumerate the intended copy/registry/verification actions, and report source SQLite, Git, and metadata-only legacy credential inventory. Credential inventory may include tenant ids, key classes, opaque handles, row/reference counts, and local-key file size/mode. It must never contain ciphertext, key bytes, key digests, or materialized values.

Apply only to the disposable target:

```bash
node scripts/migrate-zenod-volume.mjs \
  --apply \
  --confirm-source-stopped \
  --accept-plan "$PLAN_DIGEST" \
  --source /tmp/zmt4/legacy-volume \
  --data-root /tmp/zmt4/new-data \
  --tenant tenant-rehearsal \
  --token-hash "$TOKEN_HASH"
```

Retain the emitted `receiptPath`. A successful apply receipt must show:

- `checksums: pass`
- `sqliteIntegrity: pass`
- `gitVault: pass`
- `registry: pass`
- the source and target manifest digests
- every discovered SQLite database with `integrityCheck: ok`
- each Git vault's unchanged HEAD and porcelain status
- whether this run created the target and inserted the registry row

## Independent Verification

Verification is read-only and requires the original source to remain mounted:

```bash
node scripts/migrate-zenod-volume.mjs \
  --verify \
  --source /tmp/zmt4/legacy-volume \
  --data-root /tmp/zmt4/new-data \
  --tenant tenant-rehearsal \
  --token-hash "$TOKEN_HASH"
```

Run a fresh dry-run after apply, capture its new `planDigest`, and repeat apply with that digest. It must return `idempotent: true`, with `createdTarget: false` and `insertedRegistry: false`.

## First Hosted Boot Credential Conversion

Rehearse receipt-based rollback before this step. First hosted boot intentionally changes the copied target and therefore invalidates the apply receipt's target manifest.

Configure one stable 32-byte `CHASSIS_VAULT_MASTER_KEY` outside the data root. Reuse it unchanged across every restart and restore. If the standalone source used `ZENOD_CREDENTIAL_MASTER_KEY` rather than `.zenod-vault-key`, provide that legacy key for this one conversion as well.

On first exclusive hosted open, Zenod must:

1. Authenticate and decrypt the complete standalone `credential_entries` set before writing any chassis record.
2. Preserve every existing `zenod-secret:v1:*` settings handle while importing values through the chassis `TenantVault` API.
3. Accept only exact target-record matches when resuming an interrupted import.
4. Verify every imported value and settings reference, then secure-delete/drop the legacy table, truncate the WAL, vacuum, and verify again after reopen.
5. Overwrite and remove `.zenod-vault-key` only after the complete chassis set verifies.

Missing/wrong legacy or chassis keys, mixed legacy tenants, malformed rows, unresolved handles, and conflicting target records fail loudly without legacy cleanup. Restart after success must be idempotent and materialize the same handles and values.

Retain a recursive byte scan of the full tenant root after restart. The exact synthetic GitHub/model credentials and removed 32-byte standalone key must have zero matches across every file, including SQLite databases, WAL, and SHM files. Evidence records only secret hashes and match counts.

## Rollback Rehearsal

Use the first apply receipt, because that receipt owns the created target and registry row:

```bash
node scripts/migrate-zenod-volume.mjs --rollback /tmp/zmt4/receipts/<apply-receipt>.json
```

The rollback receipt must show `targetRemoved: true`, `registryRowRemoved: true`, and both absence checks passing. Running the same rollback again must succeed as an idempotent no-op.

Rollback deliberately fails if target files changed after apply or if the registry token hash changed. This includes the expected first-boot custody conversion. That failure protects post-cutover writes from deletion; it requires operator review rather than a force flag. The stopped original source remains the rollback authority after first boot.

Z-5 restore rebuilds memory from the Git repository at the recorded pre-crash commit and re-supplies world credentials through the operator secret channel. The restored service must read the pre-crash marker, prove the old commit is an ancestor, and create a new post-restore commit. Credential-handle continuity is not required after full data loss; credential functionality and encrypted custody are.

## Live Window Handoff

Z-MT-6 owns live execution. Before any live apply:

1. Record Jordi's approval for the tenant, order, window, and rollback checkpoint.
2. Stop the legacy container and prove it is stopped.
3. Mount the legacy volume read-only at a path disjoint from `/data/<tenant>`.
4. Run and retain the dry-run JSON.
5. Run apply once and retain the apply receipt.
6. Verify the shared hostname, unchanged `/mcp/<token>` credential, console session, repo, ingest, usage, and commit receipts before allowing writes.
7. Keep the legacy container and volume recoverable through the observation window.
8. Do not retire the old instance, subdomain, or watchdog entry until the separate retirement approval.

## Chassis Compatibility

The utility targets both the published chassis-spec table and the observed Phase-1 table: `chassis-tenants.sqlite` with unique `tenant_id` and unique `token_hash`. Optional `name`, `status`, `plan`, `quota`, and `created_at` values are inserted only when those columns exist; a newly created table uses the observed Phase-1 shape. A registry missing either uniqueness constraint, or carrying an unknown required column without a default, fails closed.

Epic 3.1 still owns the final chassis registry API. If C-2 changes the table or requires registration through a chassis service rather than direct SQLite insertion, record a Proposed Cross-Spine Update in #737 and adapt this ticket without editing `packages/mcp-chassis/**`.
