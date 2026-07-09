# Z-MT-6 Zenod multi-tenant cutover and rollback runbook

Owner: Epic 3.2 ticket [#738](https://github.com/zenod-ai/zenod/issues/738)
Status: preparation only; no live action is authorized by this document
Target: existing hosted Zenod tenants move from per-user instances to `zenod.zenod.dev`

This runbook stops at two explicit human gates. It does not authorize a Dokploy, DNS, tenant,
container, or data mutation. The operator must paste every receipt into #738 or an access-controlled
evidence bundle linked from #738. Raw MCP tokens, tokened URLs, repo credentials, provider keys, and
cookies must never enter the issue, shell history, screenshots, or evidence files.

## Roles and authority

| Role | Authority |
|---|---|
| Epic 3.2 steward | Reconciles #738 and the Epic 3.2 spine; names the tested integration commit. |
| Cutover operator | Runs approved commands in the named production window and records redacted receipts. |
| Tester | Independently scores the per-tenant verification matrix against the exact deployed image. |
| Jordi | Approves Gate 1 before the first live migration and Gate 2 before any legacy retirement. |
| Epic 3.1 steward | Owns chassis changes. Z-MT-6 reports chassis friction as a Proposed Cross-Spine Update; it never patches `packages/mcp-chassis/**`. |

## Non-negotiable invariants

1. The raw tenant token does not change. Only its SHA-256 digest is recorded.
2. The public target is `https://zenod.zenod.dev/mcp/<token>`; evidence uses the literal redaction
   `<token>`, never the credential.
3. A tenant is never writable on source and target at the same time.
4. A source instance, source volume, route definition, and rollback checkpoint remain recoverable
   through the full observation window.
5. No legacy instance, volume, watchdog row, or subdomain is deleted before Gate 2.
6. Every claim names the production image, source commit, environment, tenant, timestamp, command or
   method, result, and evidence reference.
7. A chassis failure is reported in #738 under `Proposed Cross-Spine Update` with the failing joint
   proof and suggested 3.1 owner. Z-MT-6 does not repair the chassis.

## Evidence bundle

Create one access-controlled directory outside git for the approved run. Use this layout in evidence
references; the runbook does not create it automatically.

```text
z-mt-6-<window-id>/
  approval/
  inventory/
  preflight/
  tenants/<tenant-id>/baseline/
  tenants/<tenant-id>/migration/
  tenants/<tenant-id>/verification/
  tenants/<tenant-id>/rollback/
  observation/
  retirement/
```

Each receipt is JSON with this envelope. Secret-bearing command lines and responses must be redacted
before capture.

```json
{
  "window_id": "z-mt-6-YYYYMMDD-HHMMZ",
  "tenant_id": "opaque-tenant-id-or-null",
  "checkpoint": "P0|R0|R1|R2|R3|R4|R5|RETIRE",
  "observed_at": "ISO-8601 UTC",
  "environment": "production",
  "image_ref": "ghcr.io/zenod-ai/zenod:sha-<short>",
  "commit_sha": "40-character git SHA",
  "method": "redacted command or operator action",
  "result": "pass|fail|blocked",
  "evidence_ref": "relative path, GitHub issue comment, or immutable URL",
  "notes": "no secrets"
}
```

## Tenant inventory

The authoritative fleet discovery is Epic 3.7 DX-1, issue #714. Import its sanitized Dokploy,
Docker, volume, route, and watchdog references; do not run a second mutable discovery path. Z-MT-6
adds cutover-specific continuity and rollback fields.

The machine-readable inventory has schema version `z-mt-6.v1`:

```json
{
  "schema_version": "z-mt-6.v1",
  "environment": "production",
  "generated_at": "ISO-8601 UTC",
  "tenants": [
    {
      "tenant_id": "opaque-stable-id",
      "classification": "live-paying|test|internal|unknown",
      "cutover_order": 1,
      "cohort": "canary|wave-1|wave-2|final",
      "source": {
        "compose_id": "Dokploy compose ID",
        "service_name": "running service/container name",
        "hostname": "legacy hostname without token",
        "volume_name": "source Docker volume",
        "volume_mount": "/data",
        "image_ref": "immutable image reference",
        "runtime_sha": "40-character health/runtime SHA",
        "health_url": "https://legacy-host/api/health"
      },
      "target": {
        "hostname": "zenod.zenod.dev",
        "tenant_root": "/data/opaque-stable-id",
        "mcp_route": "/mcp/<token>"
      },
      "continuity": {
        "token_sha256": "64 lowercase hex characters",
        "vault_repo": "owner/repo",
        "baseline_commit_sha": "40-character repo commit SHA"
      },
      "rollback": {
        "checkpoint_id": "operator checkpoint ID",
        "snapshot_ref": "immutable source-volume snapshot reference",
        "checksum_manifest": "source checksum manifest evidence reference",
        "restore_command_ref": "reviewed Z-MT-4 rollback command reference"
      },
      "evidence": {
        "dokploy_inventory_ref": "DX-1 row/reference",
        "docker_inventory_ref": "DX-1 row/reference",
        "watchdog_ref": "DX-1 row/reference"
      }
    }
  ]
}
```

Validate and render without writing files:

```bash
node scripts/zenod-cutover-inventory.mjs \
  --input /secure/path/z-mt-6-inventory.json \
  --format markdown \
  --require-ready
```

To derive a digest without putting the token in argv, send the token to stdin from an approved secret
reader. The command prints only the digest:

```bash
approved-secret-reader | node scripts/zenod-cutover-inventory.mjs --hash-token
```

Receipt `I0`: validator exit 0, rendered table, input checksum, and a statement that no raw token or
tokened URL is present. Any `classification=unknown` requires Jordi to classify the tenant before Gate 1.

## Migration order

Assign exact tenants in the inventory, then freeze the order at Gate 1:

1. `canary`: one disposable or internal tenant with representative SQLite, repo, ingest, usage, and media state.
2. `wave-1`: test tenants and non-paying internal tenants, one at a time.
3. `wave-2`: live-paying tenants ordered by lowest activity and simplest integrations first.
4. `final`: the highest-value or highest-complexity tenant, including customer #1 when applicable.

Do not batch tenant data moves. Advance one tenant through R4 verification before starting the next.
Pause 24 hours after the canary before `wave-1`. A failure returns to the prior stable cohort; it does
not reorder the remaining tenants silently.

## P0 preflight: required before Gate 1

All rows below must have an exact evidence reference. `pending`, "green on another branch", or an
unmerged local tree is a failure.

| Check | Pass condition | Receipt |
|---|---|---|
| Integration candidate | Exact commit is on `codex/epic-3.2-zenod-multitenant`; worktree clean; immutable image exists and health reports that commit. | `P0-integration` |
| Z-MT-4 | #737 publishes dry-run, apply, verify, and rollback commands; synthetic-volume apply/verify/rollback and idempotent rerun pass. | `P0-zmt4` |
| Joint 3.1/3.2 proof | #736 passes T1/T2/T3 MCP, console, repo, ingest, usage, receipt, cross-tenant negative proof, and same-token rehearsal against the candidate. | `P0-joint-proof` |
| Chassis boundary | Joint proof has `pass`, or the 3.1 steward has resolved and accepted every Proposed Cross-Spine Update. | `P0-chassis` |
| Inventory | Inventory validator exits 0 with `--require-ready`; all rows classified; no duplicate order, token hash, compose ID, or volume. | `P0-inventory` |
| Capacity | Target free bytes exceed the sum of source used bytes plus 100% working headroom; inode and backup capacity pass. | `P0-capacity` |
| SQLite safety | Source SQLite list is complete; WAL/SHM handling and integrity checks are named by #737. | `P0-sqlite` |
| Target isolation | Target tenant roots do not exist, or #737 proves an idempotent identical prior staging; no path escapes `/data/<tenant-id>`. | `P0-target-root` |
| Routes | Existing legacy route IDs, target route ID, DNS/proxy owner, current TTL, and rollback method are recorded. | `P0-routes` |
| Watchdog | Shared unit health target and per-tenant synthetic MCP probe plan are ready; alert owner is named. | `P0-watchdog` |
| Restore rehearsal | A copied-volume full-state restore and the Z-5 repo-memory restore both pass in non-production. | `P0-restore` |
| Communications | Window, tenant order, expected write freeze, support contact, abort owner, and status channel are written. | `P0-comms` |

### Gate 1: live tenant migration approval

Stop here. Jordi must comment on #738 with all of the following:

```text
APPROVE Z-MT-6 LIVE MIGRATION
window: <start/end UTC>
candidate commit/image: <SHA and immutable image>
tenant order: <ordered opaque IDs>
rollback checkpoints: <checkpoint IDs>
abort owner: <name>
```

Anything less is not approval. Approval to migrate is not approval to retire legacy resources.

## Per-tenant baseline and checkpoints

Use the inventory `tenant_id` in every receipt. Never use the token as an identifier.

### R0: inventory frozen, source serving

- Re-read the DX-1 source compose, container, volume, domain, and watchdog references.
- Confirm source health and current runtime SHA.
- Confirm inventory token SHA-256 using stdin hashing; do not print or store the raw token.
- Record source volume used bytes and file count.

Pass: source is healthy and every observed identity matches the frozen inventory.

### R1: baseline proof and rollback material captured

Capture the source baseline before write freeze:

| Surface | Exact baseline evidence |
|---|---|
| MCP | Authenticated initialize and tools/list; response status and server version only. |
| Console | Tenant login succeeds; repo, ingest, usage, keys/connections panels render for that tenant. |
| Repo | `vault_repo`, clean/expected git status, HEAD `baseline_commit_sha`, and immutable GitHub commit URL. |
| Ingest | Queue counts by state and latest completed ingest job ID; no payload or credential. |
| Usage | Row/call count, latest timestamp, and aggregate cost/tokens. |
| Receipt | Latest successful memory or media receipt: job ID, evidence ref, commit SHA, and GitHub URL. |
| Storage | Source checksum manifest plus SQLite file list and integrity results. |
| Rollback | Snapshot ID/reference, source compose export, route export, and reviewed restore command reference. |

Pass: all baseline checks pass and the snapshot/checksum pair is independently readable. Keep the source running.

### R2: source quiesced

This is the first tenant mutation and requires Gate 1.

1. Put the source into the Z-MT-4 documented write freeze or stop mode.
2. Prove new authenticated writes fail closed or are unavailable; reads may remain available only if #737 declares them safe.
3. Run the Z-MT-4 final source snapshot/checksum command, including SQLite WAL/SHM handling.
4. Record the source stopped/quiesced state and timestamp.

Pass: one writer is possible and it is currently zero. Do not start the target writer yet if final checksums differ from R1 without an explained final transaction.

### R3: target staged, public route unchanged

Run the exact #737 apply and verify commands against `/data/<tenant-id>`. Then:

- Insert or reconcile the tenant registry using the existing token SHA-256, never the raw token.
- Confirm source and target checksum manifests match under the Z-MT-4 normalization rules.
- Confirm every SQLite integrity check passes and required WAL/busy-timeout behavior is retained.
- Confirm the vault HEAD equals `baseline_commit_sha` and no migration commit was created.
- Confirm transcripts, media/archive, ingest, usage, OAuth/connection, task/execution/journey,
  notification, WhatsApp, and vault paths all resolve below `/data/<tenant-id>`.
- Probe the target through an operator-only pre-route path using the existing credential. Do not add
  a second public hostname.

Pass: Z-MT-4 verify exits 0 and the target has not received public traffic.

### R4: route switched and tenant verified

1. Enable the shared route `https://zenod.zenod.dev/mcp/<token>` without recording the tokened URL.
2. Start the target tenant writer.
3. Keep the source stopped/quiesced, its compose/domain definition intact, and its volume mounted or restorable.
4. Run the full verification matrix below.

Pass: every row passes twice, once immediately and once 30 minutes later. On any failure, execute the R4 rollback before migrating another tenant.

## Per-tenant verification matrix

Use unique, non-sensitive marker IDs such as `zmt6-<tenant-id>-<utc>`. The test may create a real
memory commit only after the target route is live; record and retain that commit as the receipt.

| Surface | Pass condition | Negative proof |
|---|---|---|
| MCP continuity | Existing raw token authenticates at the shared redacted route; initialize and tools/list succeed. | No token and a different tenant token return 401/tenant-safe failure. |
| Console | Existing hosted entry/session binds the expected tenant and renders setup/repo/ingest/usage/key surfaces. | Direct resource URL or session from another tenant cannot read this tenant. |
| Repo | `store_memory` creates a target receipt and commit in exactly the inventoried repo; parent history contains `baseline_commit_sha`. | No other tenant repo changes. |
| Ingest | One representative text or media ingest reaches terminal success and archives evidence below the tenant root. | Marker search from another tenant returns no hit. |
| Usage | Calls/tokens/cost increase only in this tenant ledger and render in this tenant console. | Other tenant aggregate is unchanged except explicitly explained background work. |
| Receipt | Job ID, evidence ref, pages touched, commit SHA, GitHub URL, and tenant ID agree across MCP, DB/API, and repo. | Receipt lookup through another tenant fails. |
| Storage | Changed SQLite/media/vault paths remain below `/data/<tenant-id>`; no writes appear in root `/data` or another tenant. | Filesystem scan reports zero cross-root writes. |
| Auth/logging | Logs carry opaque tenant ID and no raw token/tokened URL. | Secret scan of captured logs is empty. |

Receipt `V-<tenant-id>`: matrix with exact timestamps, commit/image, marker, job ID, commit SHA,
GitHub URL, screenshots, negative results, and evidence references.

## Rollback

Rollback is mandatory when any R3/R4 verification fails, checksums diverge unexpectedly, cross-tenant
access succeeds, token continuity fails, error rate exceeds baseline, or the operator cannot prove which
side is the sole writer.

### Rollback from R2

No target is public. Abort the migration, restore source service state, verify source health and baseline
repo HEAD, and leave target staging untouched for diagnosis. Record `rollback-R2`.

### Rollback from R3

Target data is staged but not public. Disable the target tenant writer/registry row using the reviewed
#737 rollback command, restore source service state, and rerun MCP/console/repo/ingest/usage baseline checks.
Record checksum and registry results as `rollback-R3`.

### Rollback from R4

1. Stop or suspend the target tenant writer first.
2. Revert the shared route change using the recorded route export/rollback method.
3. Restore the source from the R2 checkpoint if the target accepted any write that is not already in the
   tenant repo. Do not copy target SQLite files back ad hoc.
4. Start the source and verify health, original hostname, existing credential, repo HEAD/history, ingest,
   usage, and latest receipt.
5. Prove the target no longer accepts the tenant credential.
6. Preserve both evidence sets and stop the wave.

Pass: source is the only writer, the existing client path is restored or an explicit customer incident is
opened, and all baseline surfaces pass. Record `rollback-R4` and notify the Epic 3.2 steward. A cross-tenant
failure also requires a Proposed Cross-Spine Update for the 3.1 steward.

## Observation window

### R5: tenant observation

For every migrated tenant:

- Run health plus authenticated MCP initialize/tools/list at 5, 15, and 30 minutes.
- Run the no-write MCP/console/repo/ingest/usage/receipt matrix at 6, 12, and 24 hours.
- Review unit error rate, tenant-tagged logs, disk/inodes, SQLite integrity signals, queue backlog,
  usage deltas, and watchdog delivery at every checkpoint.
- Keep the source stopped/quiesced but recoverable; retain volumes, compose definition, legacy route,
  secrets, and rollback material.

The canary must complete 24 hours with no unresolved P0/P1 incident before `wave-1`. After the final
tenant passes, hold the entire legacy fleet for at least 72 hours. Reset the 72-hour clock after any
rollback, tenant-affecting fix, route correction, or unexplained integrity/usage discrepancy.

### Post-cutover watchdog and restore proof

Before Gate 2:

1. Prove the shared Zenod unit is registered once and its `/healthz` alert delivers and clears in the
   approved non-production fault drill.
2. Prove a per-tenant authenticated synthetic probe detects tenant-resolution failure without logging the token.
3. Restore one copied full tenant prefix from the R2 snapshot into an isolated non-production root and run
   checksum, SQLite integrity, repo, ingest, usage, and receipt verification.
4. Run the Z-5 restore-from-repo drill separately and prove pre-existing memory commit SHAs survive.

The full-prefix restore proves rollback of SQLite/media/integration state. The Z-5 drill proves repo-memory
durability. Neither substitutes for the other.

## Gate 2: legacy retirement approval

Stop after the 72-hour window. Jordi must comment on #738 with:

```text
APPROVE Z-MT-6 LEGACY RETIREMENT
observation window: <start/end UTC>
tenants verified: <ordered opaque IDs and V-receipts>
rollback checkpoints retained until: <UTC date>
retire: <exact compose IDs, volumes policy, route IDs, watchdog rows, subdomains>
```

Retirement is not authorized if any tenant is missing a verification receipt, any rollback checkpoint is
unreadable, the watchdog/restore proof is incomplete, or a Proposed Cross-Spine Update remains unresolved.

## Retirement and post-sweep

Only after Gate 2, execute the separately reviewed Epic 3.7 DX-3 retirement checklist (#728):

1. Deregister per-instance watchdog rows before intentional shutdown/removal.
2. Remove legacy proxy/DNS entries and temporary redirects exactly as approved.
3. Remove legacy containers/compose rows; retain or delete volumes only according to the approved retention policy.
4. Verify `zenod.zenod.dev` still passes every tenant's no-write matrix.
5. Run DX-1 inventory again and prove no unapproved per-user Zenod instance, route, volume, or watchdog row remains.
6. Record removal receipts, snapshot/checksum retention, and post-sweep proof in #728 and link them from #738.

Terminal `accepted` requires both gates, all per-tenant verification receipts, the observation window,
watchdog and restore proofs, the DX-3 retirement receipts, and Epic 3.2 steward reconciliation. Before
Gate 1 the honest terminal state for #738 is `review` or `blocked with required input`, never `done`.
