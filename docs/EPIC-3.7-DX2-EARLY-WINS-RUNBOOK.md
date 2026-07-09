# Epic 3.7 DX-2 Early-Wins Retirement Runbook

Status: prepared, blocked before execution
Date: 2026-07-10
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`
Bound issue: https://github.com/zenod-ai/zenod/issues/722
Branch: `codex/epic37-dx2-early-wins`
Integration target: `main`
Base commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`

## Blocker

Do not execute destructive commands from this runbook yet.

Jordi must choose the snapshot archive target and approve the candidate list before execution. DX-1 must first classify each row as `test`, `dead`, or `duplicate`; any `live-paying`, `unknown`, or ambiguous row is out of scope for DX-2.

Permitted before approval: read-only inventory, candidate CSV editing, dry-run command review, syntax checks, archive target comparison.

Not permitted before approval: `compose.stop`, `application.stop`, `domain.delete`, `compose.delete`, `application.delete`, `docker rm`, `docker volume rm`, watchdog env edits, or DNS/provider deletion.

## Inputs

- DX-1 inventory issue: https://github.com/zenod-ai/zenod/issues/714
- Candidate CSV: `docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv`
- Guarded batch: `scripts/epic37-dx2-early-wins-retire.sh`
- Dokploy API base: `https://dokploy.polyqu.com/api`
- Dokploy API auth: `x-api-key` via `eval "$(dokploy-env)"`
- Watchdog env on VPS: `/etc/zenod-watchdog.env`

DX-1 evidence available at preparation time is incomplete. The issue says read-only bootstrap saw:

- Dokploy `project.all`: 6 projects, sanitized output expected at `/tmp/zenod-dokploy-inventory-sanitized.json`.
- Docker `ps -a`: 100 containers, sanitized output expected at `/tmp/zenod-docker-inventory-sanitized.json`.
- Docker volumes: 81 volumes.
- Watchdog active/enabled and still naming `zenod-jordi-f2c7a6`, `callisthenes-callisthenestest-vn6wnb`, and `ring-ringtest20260709-8uiw3s`.
- Public probes returned HTTP 200 for known per-tenant Zenod, Callisthenes, and Ring endpoint families, so no item is currently proven dead by health alone.

Initial candidate families are placeholders only: `tenant-testco`, `zenod-jorditest-*`, `zenod-jordizenodtest*`, `callisthenes-*test*`, `ring-*test*`, plus duplicate/error Dokploy rows for `ring-jordiring-fkegkz` and `zenod-jordizenodtest33-gmcxem` if DX-1 confirms them. Replace placeholders with exact DX-1 rows before execution.

## Archive Target Options

Jordi must pick one:

| Option | Target | Use When | Notes |
|---|---|---|---|
| A | VPS local: `/srv/zenod-archives/epic37/dx2/YYYYMMDD/` | Fastest restore, no external dependency. | Must be included in VPS backup policy; watch disk pressure before large batches. |
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
slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,notes
```

Rules:

- `classification` must be exactly `test`, `dead`, or `duplicate` to execute.
- `kind` must be `compose`, `application`, or `record-only`.
- Use semicolons inside multi-value cells, not commas.
- `domain_ids` are Dokploy domain IDs, not hostnames. Capture them via `domain.byComposeId` or `domain.byApplicationId`.
- `watchdog_tokens` must include every matching container name and health URL token that should be removed from `/etc/zenod-watchdog.env`.
- Record-only rows still need manifest evidence and domain cleanup if any domain record exists.

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

This must be run before destructive execution and pasted back into issue `#722`.

```bash
cd /Users/jordi/Documents/GitHub/zenod
ARCHIVE_DIR="/srv/zenod-archives/epic37/dx2/$(date -u +%Y%m%d)" \
CANDIDATES_CSV="docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv" \
DRY_RUN=1 \
bash scripts/epic37-dx2-early-wins-retire.sh
```

The script should refuse placeholder classifications. That refusal is expected until DX-1 and Jordi have approved real rows.

## Execution Sequence

Execute only after the blocker is cleared.

1. Confirm candidate CSV contains no placeholder, `unknown`, or `live-paying` rows.
2. Capture preflight evidence.
3. Remove watchdog entries first so intentional stops do not page.
4. Stop the Dokploy compose/application.
5. Snapshot stopped volumes and bind mounts.
6. Write SHA-256 checksums.
7. Run one restore drill against a snapshot archive before deleting anything else in the batch.
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
cd /Users/jordi/Documents/GitHub/zenod

export ARCHIVE_DIR="/srv/zenod-archives/epic37/dx2/$(date -u +%Y%m%d)"
export CANDIDATES_CSV="docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv"
export DRY_RUN=0
export RESTORE_DRILL=1
export JORDI_APPROVED_DX2=1

bash scripts/epic37-dx2-early-wins-retire.sh 2>&1 | tee "/tmp/epic37-dx2-execution-$(date -u +%Y%m%dT%H%M%SZ).log"
```

## Manual Command Batch

Use this when not using the guarded script. Replace every placeholder before running.

```bash
set -euo pipefail
eval "$(dokploy-env)"
SLUG="<slug>"
KIND="<compose|application|record-only>"
DOKPLOY_ID="<composeId-or-applicationId>"
DOMAIN_IDS="<domainId1 domainId2>"
CONTAINERS="<container1 container2>"
VOLUMES="<volume1 volume2>"
WATCHDOG_TOKENS="<container-or-url-token1> <container-or-url-token2>"
ARCHIVE_DIR="/srv/zenod-archives/epic37/dx2/$(date -u +%Y%m%d)"
EVIDENCE_DIR="/tmp/epic37-dx2-$SLUG-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ARCHIVE_DIR" "$EVIDENCE_DIR"

# 1. Evidence and manifests.
docker ps -a --format '{{json .}}' > "$EVIDENCE_DIR/docker-ps-a.before.jsonl"
docker volume ls > "$EVIDENCE_DIR/docker-volume-ls.before.txt"
sudo cp /etc/zenod-watchdog.env "$EVIDENCE_DIR/zenod-watchdog.env.before"

if [ "$KIND" = "compose" ]; then
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/compose.one?composeId=$DOKPLOY_ID" > "$EVIDENCE_DIR/$SLUG.compose.one.json"
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/compose.getConvertedCompose?composeId=$DOKPLOY_ID" > "$EVIDENCE_DIR/$SLUG.compose.converted.yml"
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/domain.byComposeId?composeId=$DOKPLOY_ID" > "$EVIDENCE_DIR/$SLUG.domains.json"
elif [ "$KIND" = "application" ]; then
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/application.one?applicationId=$DOKPLOY_ID" > "$EVIDENCE_DIR/$SLUG.application.one.json"
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/domain.byApplicationId?applicationId=$DOKPLOY_ID" > "$EVIDENCE_DIR/$SLUG.domains.json"
fi

for c in $CONTAINERS; do docker inspect "$c" > "$EVIDENCE_DIR/$SLUG.$c.inspect.json"; done
for v in $VOLUMES; do docker volume inspect "$v" > "$EVIDENCE_DIR/$SLUG.$v.volume.json"; done

# 2. Watchdog deregistration.
sudo cp /etc/zenod-watchdog.env "/etc/zenod-watchdog.env.dx2.$SLUG.$(date -u +%Y%m%dT%H%M%SZ).bak"
for token in $WATCHDOG_TOKENS; do
  sudo perl -0pi -e "s/(^ZENOD_WATCHDOG_CONTAINERS=.*)\\b\\Q${token}\\E\\b\\s*/\$1/m; s/(^ZENOD_WATCHDOG_HEALTH_URLS=.*)\\b\\Q${token}\\E\\b\\s*/\$1/m" /etc/zenod-watchdog.env
done
sudo systemctl start zenod-watchdog.service

# 3. Reversible stop.
if [ "$KIND" = "compose" ]; then
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" -d "{\"composeId\":\"$DOKPLOY_ID\"}" "$DOKPLOY_API_BASE/compose.stop"
elif [ "$KIND" = "application" ]; then
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" -d "{\"applicationId\":\"$DOKPLOY_ID\"}" "$DOKPLOY_API_BASE/application.stop"
fi

# 4. Snapshot and checksum.
for v in $VOLUMES; do
  out="$ARCHIVE_DIR/${SLUG}__volume-${v}__$(date -u +%Y%m%dT%H%M%SZ).tgz"
  docker run --rm -v "$v:/data:ro" -v "$ARCHIVE_DIR:/archive" alpine:3.20 sh -c "cd /data && tar --numeric-owner -czf /archive/$(basename "$out") ."
  sha256sum "$out" | tee -a "$ARCHIVE_DIR/SHA256SUMS"
done

# 5. Restore drill for one archive before deletion.
first_archive="$(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name "${SLUG}__*.tgz" | sort | head -n 1)"
restore_volume="dx2-restore-${SLUG}-$(date -u +%Y%m%d%H%M%S)"
docker volume create "$restore_volume"
docker run --rm -v "$restore_volume:/restore" -v "$(dirname "$first_archive"):/archive:ro" alpine:3.20 sh -c "cd /restore && tar -xzf /archive/$(basename "$first_archive") && find /restore -maxdepth 2 -type f | head -50"
docker volume rm "$restore_volume"

# 6. Domain, Dokploy record, leftover container, and volume removal.
for domain_id in $DOMAIN_IDS; do
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" -d "{\"domainId\":\"$domain_id\"}" "$DOKPLOY_API_BASE/domain.delete"
done

if [ "$KIND" = "compose" ] || [ "$KIND" = "record-only" ]; then
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" -d "{\"composeId\":\"$DOKPLOY_ID\",\"deleteVolumes\":false}" "$DOKPLOY_API_BASE/compose.delete"
elif [ "$KIND" = "application" ]; then
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H "Content-Type: application/json" -d "{\"applicationId\":\"$DOKPLOY_ID\"}" "$DOKPLOY_API_BASE/application.delete"
fi

for c in $CONTAINERS; do docker rm --force "$c" || true; done
for v in $VOLUMES; do docker volume rm "$v"; done

# 7. Post-sweep.
docker ps -a --format '{{json .}}' > "$EVIDENCE_DIR/docker-ps-a.after.jsonl"
docker volume ls > "$EVIDENCE_DIR/docker-volume-ls.after.txt"
sudo cp /etc/zenod-watchdog.env "$EVIDENCE_DIR/zenod-watchdog.env.after"
sudo systemctl status zenod-watchdog.timer --no-pager > "$EVIDENCE_DIR/watchdog-timer.after.txt"
```

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
- Dry-run guard expected behavior: placeholder candidate classifications must be rejected until DX-1 and Jordi approval replace the CSV rows.

## API Notes

Dokploy documents API-key auth through the `x-api-key` header. The Compose API includes `compose.stop`, `compose.start`, `compose.delete`, `compose.one`, `compose.getConvertedCompose`, and domain lookup by compose ID. The Application API includes `application.stop`, `application.start`, and `application.delete`. The Domain API includes `domain.byComposeId`, `domain.byApplicationId`, and `domain.delete`.
