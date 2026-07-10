# Epic 3.7 DX-4 Callisthenes Retirement Wave Runbook

Status: test classification refreshed; live execution blocked
Date: 2026-07-10
Bound issue: https://github.com/zenod-ai/zenod/issues/729
Classification refresh: https://github.com/zenod-ai/zenod/issues/793
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md` (read-only to this worker)
Branch: `codex/epic37-dx1b-classification`
Base commit: `6f1698578e5f46466507c9520f88579059b54c94`
Integration target: `main`

This package prepares the decommission side only. It does not authorize or implement live execution. The validator has no apply mode and performs no network, SSH, Docker, Dokploy, watchdog, DNS, or production-state operation.

## Current Candidate

DX-2 retired the three explicitly classified Callisthenes test rows. One per-user Callisthenes row remains in the DX-1 inventory:

| Candidate | Dokploy ID | Container | Volume | Current classification | Retirement eligibility |
|---|---|---|---|---|---|
| `callisthenes-jordicallifresh33087-muhmxp` | `NR_px8Ul2L2w_RaM4-DWe` | `callisthenes-jordicallifresh33087-muhmxp` | `compose-reboot-neural-hard-drive-z8o9gy_callisthenes-data` | `test` | blocked |

Issue #793 binds the exact row to Stripe TEST session
`cs_test_a1gjQa18N42b6UhVZDyFN36KLzXDoFgCFb5daQyLxt3LtZwnTD0iMUhmxP` and owner
`jordi+calli-fresh-33087769@alpha9.io`. Fresh read-only inventory at
`2026-07-10T03:37:50Z` confirms the original compose, domain ID
`KbaT833rSfzz3W_T_jy-z`, running container, and volume. This proves `test`; it
does not supply a shared-service `tenant_id` or authorize retirement.

Sanitized candidate data: `docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json`.

## Package Artifacts

- Candidate/classification manifest: `docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json`
- Evidence and approval contract: `docs/EPIC-3.7-DX4-CALLISTHENES-RECEIPT.schema.json`
- Fail-closed dry-run validator: `scripts/epic37-dx4-callisthenes-dry-run.py`
- Focused tests: `scripts/epic37-dx4-callisthenes-dry-run.test.py`

Receipts contain references and SHA-256 fingerprints only. Do not put bearer tokens, X credentials, environment dumps, raw Dokploy git URLs, or other secrets in repository artifacts or issue comments.

## Record-Only Duplicate Boundary

The fresh inventory also found compose `Us9aDVdhvlObXLDfDwW0I`, runtime project
`compose-hack-redundant-driver-nu1cex`, sharing the original tenant name and
hostname. It is `idle`, has zero deployments, containers, volumes, and watchdog
tokens, and owns domain ID `injtaVSszHyvNqLDEmJ88`. It is classified
`duplicate` / `record-only`, not as a second tenant and not as part of the
materialized DX-4 candidate.

Its exact preparation packet is
`docs/EPIC-3.7-DX1B-CALLISTHENES-DUPLICATE-CANDIDATE.json`. The packet has no
apply path. `scripts/epic37-dx1b-validate-duplicate.py` can emit only a
review-only plan after a fresh zero-materialization recheck, compose/domain
metadata export, rollback reference, exact manifest digest, maintenance window,
and new Jordi approval. No cleanup was performed.

Cloud recovery defect [#62](https://github.com/zenod-ai/cloud/issues/62) tracks
the duplicate creation path. The observed status probe may have coincided with
periodic legacy recovery; the available evidence does not prove direct GET
mutation.

## Blocking Gates

Every gate below is conjunctive. Passing one never weakens another.

| Gate | Required evidence | Owner | Current state |
|---|---|---|---|
| Parent pilot gate | Accepted pilot-gate receipt with timestamp and durable reference | Epic 3.0 steward | blocked / not supplied |
| CA-MT-6 cutover | Accepted receipt, exact 40-character commit, timestamp, durable reference | Epic 3.3 steward | blocked / Epic 3.3 remains planning in the required read |
| Exact classification | Exact Stripe TEST session and owner bind the original compose | #793 / steward | passed / `test` |
| Tenant binding | Candidate maps to one exact shared-service `tenant_id` | Epic 3.3 steward | blocked / not supplied |
| Tenant credentials and receipts | Tenant-scoped credential proof plus at least one tenant-scoped receipt proof | Epic 3.3 tester | blocked / not supplied |
| Shared-host continuity | The old token fingerprint passes against the manifest's exact shared host for the same tenant | Epic 3.3 tester | blocked / not supplied |
| Snapshot and rollback | Verified checksum, archive path, restore evidence, rollback checkpoint, outbound-key rollback reference | Wave operator/tester | blocked / no archive target |
| Exact wave approval | Jordi approves manifest digest, archive target, candidate, tenant, classification, window, and outbound-key rollback reference | Jordi | blocked / not supplied |

The current Epic 3.3 spine names `calli.zenod.dev` as the target. The candidate manifest binds that host. If CA-MT-6 accepts another shared hostname, update and re-hash the manifest before collecting evidence or approval; never waive the mismatch.

## Snapshot-First Preparation

The later operator must preserve this order. Steps 1 through 7 are evidence preparation and validation; no retirement mutation is allowed before all complete.

1. Refresh read-only inventory for the exact Dokploy ID, domain ID, container, volume, old route, and watchdog/source registrations. Any mismatch requires a new manifest and digest.
2. Preserve the evidence-backed `test` classification and exact domain ID, then fill `tenant_id`, set one exact non-root absolute `archive_target`, and remove only resolved inventory gaps. Do not infer shared-service binding from the slug or Stripe owner.
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
python3 scripts/epic37-dx1b-validate-duplicate.test.py
python3 -m json.tool docs/EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json >/dev/null
python3 -m json.tool docs/EPIC-3.7-DX4-CALLISTHENES-RECEIPT.schema.json >/dev/null
python3 -m json.tool docs/EPIC-3.7-DX1B-CALLISTHENES-DUPLICATE-CANDIDATE.json >/dev/null
git diff --check
```

The issue handoff must record the exact package commit and tests, then state the live blocker precisely: parent pilot receipt, accepted CA-MT-6 receipt, shared-service tenant binding, exact archive target and verified rollback checkpoint, and Jordi's candidate/digest/window/outbound-key rollback approval are still required. The duplicate additionally requires its own new digest-bound cleanup approval. No live execution occurred.
