# Epic 3.7 DX-3 Zenod retirement wave

Owner: Epic 3.7 ticket [#728](https://github.com/zenod-ai/zenod/issues/728)
Migration owner: Epic 3.2 ticket [#738](https://github.com/zenod-ai/zenod/issues/738)
Status: preparation only; no live mutation is authorized or implemented by this package

## Scope and authority

DX-3 retires the one remaining live-paying per-user Zenod row after Z-MT-6 has migrated and accepted
that tenant. DX-3 does not migrate tenant data, change a token, switch the shared route, or declare
Gate 2 accepted. Those remain owned by #738 and its accepted artifacts:

- `docs/Z-MT-6-CUTOVER-RUNBOOK.md`
- `scripts/zenod-cutover-inventory.mjs`
- Z-MT-4 migration/apply/verify/rollback receipts linked from #738
- the tenant `V-<tenant-id>` verification receipt and Jordi's exact Gate 2 comment on #738

The preparation artifact currently lives at Z-MT-6 branch commit
`53fd7947a3b172952bb39640c32fdaefb937b9fd`; consume the steward-integrated version when #738
executes. Do not copy migration logic into DX-3.

This runbook does not grant shell or production authority. Jordi must separately approve the exact
DX-3 candidate, manifest digest, archive target, window, and rollback checkpoint on #728. Gate 2 on
#738 is necessary but is not the DX-3 wave approval.

## Frozen candidate

The exact read-only candidate inventory is
`docs/EPIC-3.7-DX3-ZENOD-CANDIDATES.json`. It was reconciled against Dokploy, Docker, the source
health route, and watchdog token presence at `2026-07-10T02:56:06Z`.

| Tenant | Compose ID | Domain ID | Container | Volume | Runtime commit |
|---|---|---|---|---|---|
| `jordi-f2c7a6` | `xDxfVYs0_4M09naWuCl66` | `qJCkerpwpOQPqhYP_lN45` | `zenod-jordi-f2c7a6` | `compose-quantify-multi-byte-firewall-r3b7ka_zenod-standalone-data` | `3ddd2afcf952842c2b93e2fad14c52f131329439` |

Exact manifest digest:

```text
33c792c909a3c039d447bed8b597735380208f67f3e72b925913d0f5ee10dd40  docs/EPIC-3.7-DX3-ZENOD-CANDIDATES.json
```

The digest covers the file bytes, including its final newline. Any candidate refresh changes the
digest and invalidates every prior Gate 2, current-state, and DX-3 approval receipt. Do not edit the
manifest in place after approval; regenerate it from a fresh read-only reconciliation, compute the
new digest, and seek approval for that exact value.

## Receipt bundle

Start from `docs/EPIC-3.7-DX3-WAVE-GATE-TEMPLATE.json`. The checked-in template intentionally fails
validation. Fill a new access-controlled copy outside git; never place raw tokens, tokened URLs,
credentials, cookies, or provider keys in it.

The validator requires all of these before it emits a plan:

1. A fresh read-only current-state receipt whose exact compose, domain, container, volume, and
   watchdog identities match the manifest and whose manifest digest matches byte-for-byte.
2. An accepted, unexpired Z-MT-6 Gate 2 receipt owned by #738 and approved by Jordi. Its exact retire
   resource set and `V-<tenant-id>` receipt must match the DX-3 candidate.
3. The accepted tenant receipt with `zenod.zenod.dev/mcp/<token>` continuity proof using only the
   token SHA-256, complete migration/data proof for all Z-MT-6 surfaces, and matching source/target
   baseline commit proof.
4. A readable, unexpired rollback checkpoint with snapshot checksum, restore proof, and retention
   through the end of the DX-3 window.
5. A wave-specific archive target below `/srv/zenod-archives/epic37/dx3/<window-id>`.
6. Jordi's exact #728 wave approval binding the candidate IDs, candidate digest, archive target,
   rollback checkpoint IDs, and UTC window. The current time must be inside that window.

`pending`, a branch-only success, a missing field, a placeholder, an expired `valid_until`, a resource
mismatch, or either approval on the wrong issue is a hard failure.

## Validation and dry run

The helper reads two local JSON files and writes only to stdout/stderr. It has no apply mode and makes
no network, Dokploy, Docker, DNS, watchdog, archive, or filesystem mutation.

```bash
node scripts/epic37-dx3-zenod-wave.mjs \
  --manifest docs/EPIC-3.7-DX3-ZENOD-CANDIDATES.json \
  --gate /secure/path/epic37-dx3-wave-gate.json \
  --format text
```

Expected success begins with:

```text
DX-3 RECEIPTS VALID; DRY RUN ONLY
```

Record the emitted candidate digest and plan digest on #728. Re-run immediately before the first
operator action. A validation failure authorizes nothing. A successful dry run also authorizes
nothing until the exact command package is separately reviewed and Jordi's approval remains valid.

## Snapshot-first operator sequence

The eventual reviewed operator package must stop before each boundary and retain evidence under the
approved archive target. This document describes order and acceptance; it does not implement these
mutations.

### Phase 0: reconcile and freeze

1. Re-run the DX-1/DX-2 style read-only Dokploy, domain, Docker label, mounted-volume, source-health,
   and watchdog reconciliation for the exact IDs in the manifest.
2. Capture source compose export, domain export, container inspect, volume inspect, current source
   health/runtime SHA, shared-host no-write tenant matrix, disk bytes/inodes, and watchdog source map.
3. Produce a fresh `current_state` receipt with a short explicit `valid_until`; rerun the helper.
4. Stop if any identity, status, mount, runtime revision, target proof, receipt, or approval changed.

No mutation occurs in Phase 0.

### Phase 1: snapshot and prove rollback

1. Apply the approved write freeze from #738. Prove the shared target remains the sole writer.
2. Stop the exact source compose only after the freeze proof is recorded.
3. Snapshot every listed volume to the exact approved archive target using numeric ownership.
4. Write `SHA256SUMS`, compose/domain/watchdog exports, the approved manifest, gate bundle digest,
   validator plan, and operator log into the evidence directory.
5. Verify every archive checksum and tar listing. Restore the archive into an isolated temporary
   volume and run the #738 full-prefix restore checks before continuing.
6. If snapshot, checksum, or restore proof fails, restart the exact source compose from captured
   state, verify its baseline, preserve all evidence, and stop. Do not enter Phase 2.

Nothing is deleted in Phase 1. The new DX-3 snapshot supplements the retained Z-MT-6 rollback
checkpoint; it does not replace it.

### Phase 2: deregister and remove exact resources

Enter only after Phase 1 passes and the validator still succeeds inside the approved window.

1. Remove the two exact watchdog tokens from the durable registration source and host environment;
   run the natural source-sync and watchdog cycles and prove they are not recreated.
2. Confirm the source compose is stopped and the shared-host token continuity/no-write matrix passes.
3. Delete only domain ID `qJCkerpwpOQPqhYP_lN45`; prove the shared hostname remains healthy.
4. Delete only compose ID `xDxfVYs0_4M09naWuCl66` with automatic volume deletion disabled.
5. Remove only container `zenod-jordi-f2c7a6` if it remains after Dokploy deletion.
6. Re-verify the matching archive checksum, then remove only the approved source volume.

Any unlisted resource, duplicate ID, wildcard match, drift, recreated watchdog row, shared-host
failure, or expired receipt stops the wave. There is no best-effort continuation.

### Phase 3: post-sweep

1. Re-run the exact Dokploy/Docker/volume/domain/watchdog inventory and prove all candidate resources
   are absent while canonical resources are unchanged.
2. Prove the legacy host has the approved retired-route behavior and `zenod.zenod.dev` passes the
   tenant MCP/console/repo/ingest/usage/receipt/storage matrix.
3. Verify all archive checksums again and record the retained Z-MT-6 checkpoint date.
4. Post removal receipts, snapshot/checksum refs, plan digest, reclaimed resources, and post-sweep
   evidence on #728; link that handoff from #738.

## Rollback

- Before domain/compose deletion: restore the watchdog source and host baseline, start the exact
  compose, and prove the source and shared target have the writer state dictated by #738.
- After domain/compose deletion but before volume removal: recreate only from captured compose and
  domain exports, attach the original volume, restore watchdog registration, and verify source health.
- After volume removal: create an isolated replacement volume, verify `SHA256SUMS`, restore the exact
  archive preserving ownership, recreate the captured compose/domain/watchdog state, and execute the
  #738 rollback matrix.

Stop the wave after any rollback. Do not silently return to the removal sequence. Record which side is
the sole writer, both tenant matrices, exact timestamps, and the incident owner on #728 and #738.

## Handoff contract

Preparation is ready for review when the manifest digest, validator tests, and runbook pass locally.
Production remains blocked until #738 records accepted Z-MT-6/Gate-2 evidence and Jordi approves the
exact #728 tenant, window, archive target, digest, and rollback checkpoint. No live execution was
performed while preparing this package.
