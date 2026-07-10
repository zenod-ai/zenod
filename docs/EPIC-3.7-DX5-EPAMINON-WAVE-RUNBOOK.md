# Epic 3.7 DX-5 Epaminon Retirement Wave Runbook

Status: preparation package only; live wave blocked
Date: 2026-07-10
Bound issue: https://github.com/zenod-ai/zenod/issues/730
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md` (steward-owned, read-only here)
Branch: `codex/epic37-dx5-epaminon-wave`
Integration target: `main`

This runbook prepares the decommission side of DX-5. It does not authorize or
perform production inventory, snapshots, stops, deletes, DNS changes, watchdog
changes, or provisioner removal.

## Current Reconciliation

The 2026-07-10 DX-1 inventory and completed DX-2 wave establish four different
facts that must not be collapsed into one claim:

1. DX-1 classified zero separate live per-user Epaminon rows. No `e-*` Dokploy
   row appears in its 34-row project inventory.
2. DX-1 found six test Ring/suite rows with a bundled `zenod-epaminon` executor.
   DX-2 archived and retired all six as part of the approved test wave.
3. DX-1 also found the active `ring-jordiring-fkegkz` unknown suite, which has a
   bundled Epaminon executor. DX-2 deliberately excluded and retained that row.
   A current DX-5 inventory must rediscover and resolve it; the narrow zero-row
   fact in item 1 is not proof that all tenant-scoped executors are gone.
4. The canonical `epaminon` row and its `zenod-epaminon` container are a shared
   unit row. E-MT-7 replaces that runtime shape with `epaminon-api` plus ephemeral
   sandboxes. It is not a per-user row to delete under a zero-instance wave.

The baseline is recorded in
`docs/EPIC-3.7-DX5-EPAMINON-SCOPE.json`. Its
`zero_instance_proof.status` is `baseline-only` by design. It cannot pass the
wave validator until fresh evidence replaces the baseline. The committed
baseline digest is recorded in
`docs/EPIC-3.7-DX5-EPAMINON-SCOPE.sha256`; operational approval must bind the
new packet copy's digest, not reuse this baseline digest.

## Blockers And Human Gates

Production apply remains blocked until all of these exist:

- The parent pilot gate has passed, with a durable reference.
- Jordi has approved the Epaminon sandbox spawner mechanism.
- E-MT-7 has an accepted receipt for the exact deployed commit.
- Ephemeral sandbox evidence proves spawn, run, persistence, teardown, and zero
  crash-test orphans using a pinned worker image digest.
- A fleet re-inventory no older than 24 hours has classified every separate
  Epaminon and suite-bundled Epaminon executor.
- Jordi has approved the exact manifest digest, exact inventory digest, exact
  tenant/job-history row list, execution window, and rollback plan.

If a row is discovered, final acceptance additionally requires its archive
checksum, rollback-drill evidence, removal receipt, and a clean postflight
re-inventory. A zero-row wave still requires digest-bound approval; it does not
waive the cutover, spawner, code-path, or current-inventory gates.

## Scope Boundary

In scope for DX-5 classification:

- A separate per-user Epaminon Dokploy application/compose, including `e-*` or
  customer-named Epaminon rows.
- A suite compose containing an always-on `zenod-epaminon` tenant executor.
- Its Dokploy ID, domains, containers, volumes/binds, watchdog tokens, tenant,
  and job-history disposition.

Not a retirement candidate:

- The accepted shared `epaminon-api` container.
- A job sandbox tied to a current job, pinned image, tenant, start time, and
  expected teardown time.
- Historical DX-2 rows whose archives and removal receipts already exist.

`ZENOD_AWAIT_PROVISION`, `awaitingProvision()`, `applyProvision()`, and
`/api/provision` are DX-6/E-MT-7 code artifacts. A zero candidate count does not
remove them. The validator scans runtime, test, unit-template, and root compose
surfaces and fails while any such path remains.

## Evidence Packet

Create a private, timestamped packet outside the repository. Raw Dokploy and
container evidence may contain secrets and must not be committed or attached to
GitHub.

```sh
export DX5_PACKET="/srv/zenod-archives/epic37/dx5/evidence-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$DX5_PACKET"
cp docs/EPIC-3.7-DX5-EPAMINON-SCOPE.json "$DX5_PACKET/scope-manifest.json"
```

The validator requires these files:

| File | Purpose |
|---|---|
| `scope-manifest.json` | Exact approved candidate identities and job-history disposition. |
| `fleet-reinventory.json` | Fresh preflight Dokploy/Docker/volume/watchdog inventory. |
| `em-t7-receipt.json` | Accepted pilot, spawner, cutover, old-token, and AWAIT removal receipt. |
| `sandbox-proof.json` | Pinned image and ephemeral lifecycle/orphan evidence. |
| `approval.json` | Jordi's exact manifest/inventory digest and row approval. |
| `retirement-receipts.json` | Per-row archive, rollback, and removal evidence; empty rows for a proven zero-row wave. |
| `postflight-reinventory.json` | Fresh proof that only shared API and valid ephemeral sandboxes remain. |

Every JSON document has `schema_version: 1` and `wave: "DX-5"`. Inventory,
cutover, sandbox, retirement, and postflight documents also carry the full
40-character `commit_sha` of the checkout being validated.

## Fresh Inventory Contract

Collect read-only evidence for the exact Alpha9 environment immediately before
approval. At minimum capture and checksum:

- Dokploy `project.all`, with environment and secret fields kept private.
- `docker ps -a` plus compose labels for candidate matching.
- Docker volume list and inspect records for candidate ownership.
- The effective watchdog map and its durable source registration state.

Represent each collector as:

```json
{
  "name": "docker-ps-a",
  "evidence_ref": "/private/evidence/docker-ps-a.jsonl",
  "sha256": "<64 lowercase hex>"
}
```

`fleet-reinventory.json` uses `captured_at`, `commit_sha`, `collectors`, and
`rows`. Each row has a stable `row_id`, `topology`, classification, Dokploy ID,
container names, volume/bind names, domain IDs, watchdog tokens, and owner.
Valid topology values are:

- `separate-per-user`
- `suite-bundled`
- `canonical-shared`
- `ephemeral-sandbox`

Every preflight row with either retirement topology must appear exactly once in
`scope-manifest.json.candidates`. No fuzzy name matching or unlisted row is
allowed.

## Manifest And Approval

For each discovered candidate, add:

```json
{
  "row_id": "<stable Dokploy or composed identity>",
  "topology": "separate-per-user",
  "classification": "live-paying",
  "tenant_ref": "<approved tenant reference>",
  "job_history_evidence_ref": "<migration or deliberate archive evidence>"
}
```

For a genuinely empty current wave, keep `candidates: []` and replace the
baseline zero proof with:

```json
{
  "status": "proven",
  "basis_refs": [
    "<fresh Dokploy evidence>",
    "<fresh Docker evidence>",
    "<fresh volume evidence>",
    "<fresh watchdog evidence>"
  ]
}
```

Compute the approval boundary after manifest and preflight inventory are final:

```sh
shasum -a 256 \
  "$DX5_PACKET/scope-manifest.json" \
  "$DX5_PACKET/fleet-reinventory.json"
```

`approval.json` must record both exact digests, `approved_by: "Jordi"`, a durable
approval reference, `approved_row_ids`, the execution window, and rollback plan
reference. Approval must postdate both accepted E-MT-7 evidence and the fresh
inventory. Any manifest or preflight inventory change invalidates approval.

## Cutover And Sandbox Receipts

`em-t7-receipt.json` must be accepted by the E-MT-7 authority and include:

- `accepted_at`, `accepted_by`, and `acceptance_ref`
- `pilot_gate_ref`
- `spawner_decision_ref`
- `cutover_proof_ref`
- `old_token_proof_ref`
- `await_provision_removed: true`
- the exact deployed `commit_sha`

`sandbox-proof.json` must include an accepted evidence reference, exact commit,
`worker_image_digest` in `sha256:<64 hex>` form, positive `jobs_proven`, all four
lifecycle booleans (`spawned`, `ran`, `persisted`, `torn_down`), and
`crash_orphan_count: 0`.

## Discovered-Row Receipts

This package does not define or run live mutation commands. The approved wave
operator must use the reviewed snapshot-first retirement mechanism and produce
one `retirement-receipts.json.rows` entry per approved candidate:

```json
{
  "row_id": "<exact candidate row_id>",
  "archive": {
    "evidence_ref": "<archive receipt>",
    "sha256": "<64 lowercase hex>"
  },
  "rollback": {
    "status": "passed",
    "evidence_ref": "<restore or rollback drill receipt>"
  },
  "removal": {
    "status": "removed",
    "evidence_ref": "<Dokploy/container/volume/domain/watchdog receipt>"
  }
}
```

The receipt row IDs must exactly equal the approved candidate IDs. A discovered
row with missing job history, archive, rollback, or removal evidence fails. The
receipt document's `captured_at` must postdate Jordi's approval.

## Postflight And Validation

Capture the same four collectors after the approved wave. The postflight `rows`
may contain only `canonical-shared` and properly attributed
`ephemeral-sandbox` rows. A sandbox row must include `job_id`, `tenant_ref`,
`started_at`, and `expected_teardown_at`.

Run from the exact committed checkout:

```sh
python3 scripts/epic37-dx5-validate-wave.py \
  --package-dir "$DX5_PACKET" \
  --repo-root "$PWD"
```

The validator fails closed on:

- preflight or postflight inventory older than 24 hours;
- incomplete Dokploy/Docker/volume/watchdog evidence;
- a packet commit that differs from the checked-out commit;
- an unexpected or remaining retirement row;
- missing pilot, spawner, E-MT-7, old-token, or sandbox evidence;
- an unpinned worker image or nonzero crash orphan count;
- candidate/inventory/approval/receipt row drift;
- a wrong manifest or inventory approval digest;
- missing tenant/job-history/archive/rollback/removal evidence;
- any remaining live AWAIT_PROVISION or `/api/provision` path.

The expected result today is failure because E-MT-7 is not accepted and legacy
provisioning paths remain. Do not weaken those checks to make preparation pass.

## Rollback Boundary

For every discovered row, the approved plan must preserve enough private
evidence to recreate the Dokploy record, attach a checksummed restored volume,
recreate domains, restore watchdog source registration where applicable, start
the service, and verify the tenant/job-history surface. Archives are retained;
deleting them is outside Epic 3.7.

## Handoff

Post to issue #730 after package review or later execution:

```markdown
Commit:
Branch: codex/epic37-dx5-epaminon-wave
Tests:
Manifest SHA-256:
Inventory SHA-256:
Approved rows:
E-MT-7 receipt:
Sandbox proof:
Archive/rollback/removal receipts:
Postflight result:
Blocker:
Next action for Epic 3.7 steward:
```

The spine steward, not this ticket worker, reconciles durable state into the
Epic 3.7 spine.
