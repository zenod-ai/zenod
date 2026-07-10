# Epic 3.7 DX-2 Early-Wins Retirement Runbook

Status: prepared for reviewed dry-run, blocked before execution
Date: 2026-07-10
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`
Bound issue: https://github.com/zenod-ai/zenod/issues/722
Branch: `codex/epic37-dx2-early-wins`
Integration target: `main`
Base commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`

## Blocker

Do not execute destructive commands from this runbook yet.

Jordi must choose the snapshot archive target and approve the exact candidate CSV before execution. The CSV now binds all 13 test rows and 4 failed duplicate records from the 2026-07-10 read-only inventory to their live Dokploy IDs, domain IDs, containers, volumes, watchdog tokens, and post-removal endpoint expectation. Any `live-paying`, `unknown`, or ambiguous active row remains out of scope.

Permitted before approval: read-only inventory, candidate CSV editing, dry-run command review, syntax checks, archive target comparison.

Not permitted before approval: `compose.stop`, `application.stop`, `domain.delete`, `compose.delete`, `application.delete`, `docker rm`, `docker volume rm`, watchdog env edits, or DNS/provider deletion.

## Inputs

- DX-1 inventory issue: https://github.com/zenod-ai/zenod/issues/714
- Candidate CSV: `docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv`
- Guarded batch: `scripts/epic37-dx2-early-wins-retire.sh`
- Dokploy API base: `https://dokploy.polyqu.com/api`
- Dokploy API auth: `x-api-key` via `eval "$(dokploy-env)"`
- Watchdog env on VPS: `/etc/zenod-watchdog.env`

DX-1 read-only evidence used to build the exact candidate manifest:

- Dokploy `project.all`: 6 projects, sanitized output expected at `/tmp/zenod-dokploy-inventory-sanitized.json`.
- Docker `ps -a`: 100 containers, sanitized output expected at `/tmp/zenod-docker-inventory-sanitized.json`.
- Docker volumes: 81 volumes.
- Watchdog active/enabled and still naming `zenod-jordi-f2c7a6`, `callisthenes-callisthenestest-vn6wnb`, and `ring-ringtest20260709-8uiw3s`.
- Public probes returned HTTP 200 for known per-tenant Zenod, Callisthenes, and Ring endpoint families, so no item is currently proven dead by health alone.

The candidate CSV contains no placeholder row. Its current review digest is `e0e81e0f2546d86034fc79bafb4e7c13abf383830cf9926241f8c7dc67e41c3f`. Its SHA-256 digest is the approval boundary: destructive mode refuses a CSV whose current digest differs from `APPROVED_CSV_SHA256`.

## Archive Target Options

Jordi must pick one:

| Option | Target | Use When | Notes |
|---|---|---|---|
| A | VPS local: `/srv/zenod-archives/epic37/dx2/YYYYMMDD/` | Recommended for the first wave because restore is local and no credential setup is needed. | The 45 candidate volumes total 15,168,771 bytes (~0.014 GiB); root had 55 GB free and Docker data had 35 GB free on 2026-07-10. Re-check immediately before approval and mirror off-host after the wave. |
| B | Object storage: S3/R2 bucket path `zenod-archives/epic37/dx2/YYYYMMDD/` | Better durability and off-host retention. | Requires configured credentials and upload/checksum evidence. |
| C | Admin laptop pull: `rsync` from VPS to local encrypted archive | Useful for small early-win set. | Operator must record local path and checksums; slower restore to VPS. |

Naming convention:

```text
<slug>__volume-<docker-volume>__<UTC YYYYMMDDTHHMMSSZ>.tgz
<slug>__bind-<safe-bind-path>__<UTC YYYYMMDDTHHMMSSZ>.tgz
<slug>__manifest__<UTC YYYYMMDDTHHMMSSZ>.json
SHA256SUMS
```

Retention: keep all snapshots. Deletion is explicitly out of scope for Epic 3.7.

## Candidate CSV Contract

CSV columns:

```text
slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,endpoint_expectation,notes
```

Rules:

- `classification` must be exactly `test`, `dead`, or `duplicate` to execute.
- `kind` must be `compose`, `application`, or `record-only`.
- Use semicolons inside multi-value cells, not commas.
- `domain_ids` are Dokploy domain IDs, not hostnames. Capture them via `domain.byComposeId` or `domain.byApplicationId`.
- `watchdog_tokens` must include every matching container name and health URL token that should be removed from `/etc/zenod-watchdog.env`.
- `endpoint_expectation` is `unrouted` for retired hosts or `still-routed` where a retained active row intentionally shares the hostname.
- Record-only rows still need manifest evidence and domain cleanup if any domain record exists.
- CSV cells must not contain commas. The script rejects any row that does not have exactly 11 fields.
- Before any stop, the script reads each live Dokploy record and Docker label set and refuses drift in slug, Dokploy ID, domain IDs, container names, mounted volume names, orphan-volume ownership, or watchdog tokens.

## Preflight Checks

Run from the VPS or a shell with Docker/Dokploy access. These are read-only.

```bash
set -euo pipefail
eval "$(dokploy-env)"
export DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
export DX2_EVIDENCE="/tmp/epic37-dx2-preflight-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DX2_EVIDENCE"

date -u | tee "$DX2_EVIDENCE/date.txt"
hostnamectl | tee "$DX2_EVIDENCE/host.txt"
docker version | tee "$DX2_EVIDENCE/docker-version.txt"
docker ps -a --format '{{json .}}' | tee "$DX2_EVIDENCE/docker-ps-a.jsonl"
docker volume ls | tee "$DX2_EVIDENCE/docker-volume-ls.txt"
docker network inspect dokploy-network > "$DX2_EVIDENCE/dokploy-network.json"
sudo systemctl status zenod-watchdog.timer --no-pager | tee "$DX2_EVIDENCE/watchdog-timer.txt"
sudo systemctl status zenod-watchdog.service --no-pager | tee "$DX2_EVIDENCE/watchdog-service.txt" || true
sudo cp /etc/zenod-watchdog.env "$DX2_EVIDENCE/zenod-watchdog.env.before"

curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/project.all" > "$DX2_EVIDENCE/dokploy-project-all.json"
```

For every candidate row, also capture:

```bash
# Compose row
curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/compose.one?composeId=<composeId>" \
  > "$DX2_EVIDENCE/<slug>.compose.one.json"

curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/compose.getConvertedCompose?composeId=<composeId>" \
  > "$DX2_EVIDENCE/<slug>.compose.converted.yml"

curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/domain.byComposeId?composeId=<composeId>" \
  > "$DX2_EVIDENCE/<slug>.domains.json"

# Application row
curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/application.one?applicationId=<applicationId>" \
  > "$DX2_EVIDENCE/<slug>.application.one.json"

curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_API_BASE/domain.byApplicationId?applicationId=<applicationId>" \
  > "$DX2_EVIDENCE/<slug>.domains.json"

docker inspect <container-name> > "$DX2_EVIDENCE/<slug>.<container-name>.inspect.json"
docker volume inspect <volume-name> > "$DX2_EVIDENCE/<slug>.<volume-name>.volume.json"
```

## Dry-Run Review

This must run on the Alpha9 VPS before destructive execution and be pasted back into issue `#722`. It performs live read-only reconciliation and prints every mutation without executing it.

```bash
cd <reviewed-zenod-checkout-on-alpha9>
eval "$(dokploy-env)"
ARCHIVE_DIR="/srv/zenod-archives/epic37/dx2/$(date -u +%Y%m%d)" \
CANDIDATES_CSV="docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv" \
DRY_RUN=1 \
bash scripts/epic37-dx2-early-wins-retire.sh
```

The dry-run is acceptable only if all 17 rows reconcile against live state and the output contains no unapproved identifier. A drift refusal is a safety pass and requires regenerating the manifest before seeking approval again.

## Execution Sequence

Execute only after the blocker is cleared.

1. Confirm candidate CSV contains no placeholder, `unknown`, or `live-paying` rows; compute and record its SHA-256 digest.
2. Capture preflight evidence.
3. Remove watchdog entries first so intentional stops do not page.
4. Stop the Dokploy compose/application.
5. Snapshot stopped volumes and bind mounts.
6. Write SHA-256 checksums.
7. Run one restore drill against a checksummed snapshot archive before deleting any domain, Dokploy record, container, or volume in the batch.
8. Delete Dokploy domain records.
9. Delete Dokploy compose/application record with Docker volumes preserved by Dokploy where possible.
10. Remove leftover containers.
11. Remove only volumes that have a matching archive and checksum.
12. Capture post-removal sweep.
13. Paste evidence and residual risk into issue `#722`.

Guarded execution command:

```bash
set -euo pipefail
eval "$(dokploy-env)"
cd <reviewed-zenod-checkout-on-alpha9>

export ARCHIVE_DIR="/srv/zenod-archives/epic37/dx2/$(date -u +%Y%m%d)"
export CANDIDATES_CSV="docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv"
export DRY_RUN=0
export RESTORE_DRILL=1
export JORDI_APPROVED_DX2=1
export APPROVED_CSV_SHA256="<digest-recorded-in-Jordi-approval>"
export APPROVAL_REF="<GitHub-comment-or-written-approval-reference>"

bash scripts/epic37-dx2-early-wins-retire.sh 2>&1 | tee "/tmp/epic37-dx2-execution-$(date -u +%Y%m%dT%H%M%SZ).log"
```

## Execution Safety Properties

- Phase 0 is entirely read-only and reconciles the approved manifest against live Dokploy, Docker, volume, domain, and watchdog state before any stop.
- Phase 1 stops approved records and creates archives plus a durable `SHA256SUMS`; no deletion occurs.
- If Phase 1 or the restore drill fails, the error trap restores the captured watchdog baseline and restarts every compose/application that the batch stopped. Archives already written are retained.
- Phase 2 verifies the checksum, lists the tar, restores it into a temporary Docker volume, and removes only that temporary volume.
- Phase 3 runs only after Phase 2 passes. Before every Docker volume removal it re-verifies a matching archive checksum.
- The script records pre/post Docker inventory and stats, Dokploy inventory, watchdog env and timer state, per-candidate manifests, and endpoint results.
- The `*.zenod.dev` records are wildcard DNS: candidate hosts and a random nonexistent probe resolved to the same Cloudflare addresses on 2026-07-10. DX-2 removes Dokploy/Traefik domain rows; there is no per-tenant DNS provider record to delete. Post-removal endpoint behavior is still required evidence.

## Rollback

Rollback depends on where the failure occurs.

Before Dokploy record deletion:

```bash
# Compose
curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" \
  -d '{"composeId":"<composeId>"}' \
  "$DOKPLOY_API_BASE/compose.start"

# Application
curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" \
  -d '{"applicationId":"<applicationId>"}' \
  "$DOKPLOY_API_BASE/application.start"
```

After Dokploy record deletion but before volume removal:

- Recreate the Dokploy record from the captured `*.compose.converted.yml` or `*.application.one.json`.
- Reattach the existing volume.
- Recreate domains from `*.domains.json`.
- Re-add watchdog tokens from `zenod-watchdog.env.before`.
- Start/redeploy and probe the endpoint.

After volume removal:

```bash
RESTORE_VOLUME="<new-or-original-volume-name>"
ARCHIVE_FILE="<approved snapshot tgz>"

docker volume create "$RESTORE_VOLUME"
docker run --rm \
  -v "$RESTORE_VOLUME:/restore" \
  -v "$(dirname "$ARCHIVE_FILE"):/archive:ro" \
  alpine:3.20 \
  sh -c "cd /restore && tar -xzf /archive/$(basename "$ARCHIVE_FILE")"
sha256sum -c "$ARCHIVE_DIR/SHA256SUMS"
```

Then recreate the Dokploy record, attach the restored volume, recreate domains, re-add watchdog tokens, start/redeploy, and probe the public endpoint.

## Post-Execution Handoff

Post this back to issue `#722`:

```markdown
## DX-2 execution handoff

Terminal state: ready for testing | blocked
Executed by:
Date/time UTC:
Branch:
Commit:
Archive target:
Candidate approval evidence:

Rows retired:
| slug | classification | Dokploy id | domains removed | containers removed | volumes archived/removed | snapshot checksum | restore drill |
|---|---|---|---|---|---|---|---|

Preflight evidence:
- 

Post-sweep evidence:
- 

Rollback status:
- 

Residual risk:
- 

Next action for spine steward:
- Reconcile Issue Ledger, Validation Evidence, and Handoff Journal for DX-2.
```

## Self-Test Performed

- `bash -n scripts/epic37-dx2-early-wins-retire.sh`
- `git diff --check`
- Local fail-closed tests cover malformed CSV, missing approval digest, wrong digest, missing restore gate, and automatic pre-delete rollback after a simulated archive failure. The live dry-run covers empty list fields and cross-wired identifiers.
- `bash scripts/epic37-dx2-early-wins-retire.test.sh` passed locally.
- Alpha9 live read-only dry-run passed all 17 rows again after rollback hardening on 2026-07-10: 362 log lines, 253 printed mutations, zero executed, all four phases reached, and postflight watchdog evidence was captured.
- A deliberate cross-wire from the first test row to live-paying Dokploy ID `xDxfVYs0_4M09naWuCl66` failed with `Dokploy name drift` and did not enter Phase 1.

## API Notes

Dokploy documents API-key auth through the `x-api-key` header. The Compose API includes `compose.stop`, `compose.start`, `compose.delete`, `compose.one`, `compose.getConvertedCompose`, and domain lookup by compose ID. The Application API includes `application.stop`, `application.start`, and `application.delete`. The Domain API includes `domain.byComposeId`, `domain.byApplicationId`, and `domain.delete`.
