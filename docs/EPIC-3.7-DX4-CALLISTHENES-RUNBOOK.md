# Epic 3.7 DX-4 Callisthenes Retirement Wave Runbook

Status: preparation package complete; live execution blocked
Date: 2026-07-10
Bound issue: https://github.com/zenod-ai/zenod/issues/729
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md` (read-only to this worker)
Branch: `codex/epic37-dx4-callisthenes-wave`
Base commit: `1d7f4407bf5ede1aa366145d7a1f45457f7ad9d6`
Integration target: `main`

This package prepares the decommission side only. It does not authorize or implement live execution. The validator has no apply mode and performs no network, SSH, Docker, Dokploy, watchdog, DNS, or production-state operation.

## Current Candidate

DX-2 retired the three explicitly classified Callisthenes test rows. One per-user Callisthenes row remains in the DX-1 inventory:

| Candidate | Dokploy ID | Container | Volume | Current classification | Retirement eligibility |
|---|---|---|---|---|---|
| `callisthenes-jordicallifresh33087-muhmxp` | `NR_px8Ul2L2w_RaM4-DWe` | `callisthenes-jordicallifresh33087-muhmxp` | `compose-reboot-neural-hard-drive-z8o9gy_callisthenes-data` | `unknown` | blocked |

The name looks test-like, but that is not ownership or disposability evidence. `unknown` is deliberately non-executable. Jordi or the spine steward must classify the exact row, bind it to a shared-service `tenant_id`, fill its current Dokploy domain ID and archive target, and record the source evidence before a dry-run plan can exist.

Sanitized candidate data: `docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json`.

## Package Artifacts

- Candidate/classification manifest: `docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json`
- Evidence and approval contract: `docs/EPIC-3.7-DX4-CALLISTHENES-RECEIPT.schema.json`
- Fail-closed dry-run validator: `scripts/epic37-dx4-callisthenes-dry-run.py`
- Focused tests: `scripts/epic37-dx4-callisthenes-dry-run.test.py`

Receipts contain references and SHA-256 fingerprints only. Do not put bearer tokens, X credentials, environment dumps, raw Dokploy git URLs, or other secrets in repository artifacts or issue comments.

## Blocking Gates

Every gate below is conjunctive. Passing one never weakens another.

| Gate | Required evidence | Owner | Current state |
|---|---|---|---|
| Parent pilot gate | Accepted pilot-gate receipt with timestamp and durable reference | Epic 3.0 steward | blocked / not supplied |
| CA-MT-6 cutover | Accepted receipt, exact 40-character commit, timestamp, durable reference | Epic 3.3 steward | blocked / Epic 3.3 remains planning in the required read |
| Exact classification | Manifest is no longer `unknown`; Jordi confirms the exact classification and source | Jordi/steward | blocked / `unknown` |
| Tenant binding | Candidate maps to one exact shared-service `tenant_id` | Epic 3.3 steward | blocked / not supplied |
| Tenant credentials and receipts | Tenant-scoped credential proof plus at least one tenant-scoped receipt proof | Epic 3.3 tester | blocked / not supplied |
| Shared-host continuity | The old token fingerprint passes against the manifest's exact shared host for the same tenant | Epic 3.3 tester | blocked / not supplied |
| Snapshot and rollback | Verified checksum, archive path, restore evidence, rollback checkpoint, outbound-key rollback reference | Wave operator/tester | blocked / no archive target |
| Exact wave approval | Jordi approves manifest digest, archive target, candidate, tenant, classification, window, and outbound-key rollback reference | Jordi | blocked / not supplied |

The current Epic 3.3 spine names `calli.zenod.dev` as the target. The candidate manifest binds that host. If CA-MT-6 accepts another shared hostname, update and re-hash the manifest before collecting evidence or approval; never waive the mismatch.

## Snapshot-First Preparation

The later operator must preserve this order. Steps 1 through 7 are evidence preparation and validation; no retirement mutation is allowed before all complete.

1. Refresh read-only inventory for the exact Dokploy ID, domain ID, container, volume, old route, and watchdog/source registrations. Any mismatch requires a new manifest and digest.
2. Obtain explicit classification and tenant binding. Replace `unknown`, fill `tenant_id`, fill `domain_ids`, set one exact non-root absolute `archive_target`, and remove resolved inventory gaps. Do not infer classification from the slug.
3. Compute SHA-256 over the exact manifest bytes. The completed receipt and Jordi approval must both quote this digest and the exact archive target.
4. Attach accepted parent pilot and CA-MT-6 receipts. CA-MT-6 evidence must identify the accepted commit and test surface.
5. For the same `tenant_id`, record tenant-scoped credential proof, tenant-scoped receipt proof, and old-token continuity on the exact shared host. Store only evidence references and an irreversible token fingerprint.
6. Capture the source data snapshot before any stop, delete, deregistration, DNS, watchdog, container, or volume mutation. Store it under the exact archive target, calculate SHA-256, verify the archive, and record restore evidence.
7. Record a rollback checkpoint that binds the verified snapshot and outbound-key rollback plan. The rollback plan must cover restoring the old per-user service and reverting shared-service outbound-key custody if post-cutover checks fail.
8. Jordi approves the exact candidate/tenant/classification set, manifest digest, archive target, maintenance window, and outbound-key rollback reference in one durable approval.
9. Validate the completed receipt and generate a local plan. A failure is the expected safe result until every gate is complete.

```bash
python3 scripts/epic37-dx4-callisthenes-dry-run.py \
  --manifest docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json \
  --receipt /path/to/completed-dx4-receipt.json \
  --output /tmp/epic37-dx4-callisthenes-plan.json
```

The output is a plan, not an executor. It sets `production_mutation_permitted` to `false`, includes no credentials, and lists the future sequence only after every prerequisite validates. The helper refuses to overwrite an existing plan file so stale evidence cannot be silently replaced.

## Future Live-Wave Sequence

This section is a review checklist for the separately authorized operator. It is not an execution command.

1. Re-run exact identifier and shared-host continuity checks inside the approved window.
2. Re-verify the snapshot checksum and restore evidence before the first mutation.
3. Deregister exact watchdog/source tokens, if present, and prove a natural sync cannot recreate them.
4. Stop only the approved Dokploy compose row.
5. Verify the shared host still serves the same tenant with the old token and tenant-scoped outbound credentials.
6. Delete only approved domain records and the exact Dokploy row while preserving the source volume until the checkpoint is revalidated.
7. Remove only listed leftover containers and only volumes whose exact snapshot checksum still verifies.
8. Prove the old per-user route is unrouted, the shared host remains continuous, the tenant's receipts remain present, and no watchdog entry regenerated.
9. Post removal receipts, reclaimed resources, rollback status, and residual risk to issue #729 for steward reconciliation.

## Rollback Triggers

Rollback immediately on any tenant mismatch, old-token failure, credential lookup failure, missing receipt, shared-host regression, unapproved identifier, watchdog regeneration, archive checksum failure, or window overrun.

Before old-row deletion, restore watchdog/source registrations if changed and restart the exact compose row. After old-row deletion, recreate the row and domain from captured read-only manifests, attach the preserved or restored volume, restore outbound-key custody per the approved reference, and re-probe both old and shared routes. Keep all archives; archive deletion is outside Epic 3.7.

## Validation And Handoff

Local package validation:

```bash
python3 scripts/epic37-dx4-callisthenes-dry-run.test.py
python3 -m json.tool docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json >/dev/null
python3 -m json.tool docs/EPIC-3.7-DX4-CALLISTHENES-RECEIPT.schema.json >/dev/null
git diff --check
```

The issue handoff must record the exact package commit and tests, then state the live blocker precisely: parent pilot receipt, accepted CA-MT-6 receipt, explicit classification and tenant binding, exact archive target and verified rollback checkpoint, and Jordi's candidate/window/outbound-key rollback approval are still required. No live execution occurred.
