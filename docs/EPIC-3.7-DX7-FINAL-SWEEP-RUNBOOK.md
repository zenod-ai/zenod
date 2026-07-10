# Epic 3.7 DX-7 Final Sweep And Restore Drill Runbook

Status: draft runbook
Created: 2026-07-10
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`
Bound issue: https://github.com/zenod-ai/zenod/issues/732
Role: Epic 3.7 DX-7 final tester
Integration target: `main`

This is a human-ready final sweep checklist for proving the Epic 2.x per-user fleet is gone. It is
also the restore-drill script for proving one archived retired instance can be recovered. Do not run
the restore drill, cleanup, or any removal command without Jordi's explicit approval for the named
snapshot, tenant, command batch, and time window.

## Acceptance Summary

DX-7 passes only when all checks below have receipts in the evidence packet:

- Final container map comparison: the live always-on fleet matches `docs/final-container-map-deck.html`
  slide 1.
- Dokploy list: `project.all` shows no Epic 2.x per-tenant compose/app records except explicitly
  named non-unit services.
- `docker ps -a`: no Epic 2.x per-tenant containers remain.
- Docker volumes: no orphan tenant volumes remain without an archived snapshot receipt.
- Watchdog static checks: `/etc/zenod-watchdog.env` has only the canonical static checks and no
  per-tenant health URLs or container names.
- Provisioner/static-code checks: 2.x per-tenant provisioning, DNS minting, and watchdog
  registration paths are removed or tombstoned by DX-6.
- Snapshot restore drill: one retired instance restores from an archived snapshot in a quarantined
  drill surface and proves data presence.

## Canonical Final Fleet

Authoritative source: `docs/final-container-map-deck.html` slide 1. The expected always-on container
names are:

```text
proxy
zenod
callisthenes
epaminon-api
ring
phylax
```

Allowed exceptions:

- Epaminon per-job sandboxes are allowed only while a real job is running; they must have a job id,
  owner, start time, and expected teardown time in the evidence packet.
- Thin suite/product containers are allowed only if Epic 3.0 or a later spine explicitly adds them
  to the canonical map. Record the issue/PR/spine citation.
- Marketing, cloud, runner, database, or Dokploy infrastructure services are allowed only if they
  are explicitly listed in the "Allowed Non-Unit Services" evidence section.

Any old per-tenant pattern is a failure unless it is already stopped and retained only as a named
snapshot artifact: `tenant-*`, `zenod-*` per customer, `z-*`, `c-*`, `e-*`, `callisthenes-*`,
`ring-*`, `epaminon-*` customer boxes, or any compose record mapped to a retired Epic 2.x tenant.

## Inputs Required Before Final Sweep

Create a timestamped packet directory and copy or link these inputs into it:

```sh
export DX7_DATE="$(date -u +%Y%m%dT%H%M%SZ)"
export DX7_PACKET="$PWD/evidence/epic37-dx7-$DX7_DATE"
mkdir -p "$DX7_PACKET"
git rev-parse HEAD > "$DX7_PACKET/repo-commit.txt"
```

Required files:

- DX-1 final inventory manifest: every 2.x Dokploy app/container/volume classified.
- DX-2..DX-5 retirement manifests: snapshot ids, checksums, archive locations, and removal receipts.
- DX-6 provisioner/watchdog/DNS tombstone evidence.
- Canonical final map source hash.
- This runbook's issue handoff.

Record hashes:

```sh
for f in \
  docs/EPIC-3.7-DECOMMISSION-2X.md \
  docs/final-container-map-deck.html \
  docs/EPIC-3.7-DX7-FINAL-SWEEP-RUNBOOK.md
do
  test -f "$f" && shasum -a 256 "$f"
done | tee "$DX7_PACKET/doc-sha256.txt"
```

## Check 1: Dokploy List

This check is read-only. It uses `dokploy-env` for the API key and `project.all`, the Dokploy API
list endpoint for projects/environments/services. The raw API response contains env fields, so the
command redacts env data before writing evidence.

```sh
eval "$(dokploy-env)"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

/usr/bin/curl -fsS "$DOKPLOY_API_BASE/project.all" \
  -H "x-api-key: $DOKPLOY_API_KEY" > "$tmp"

python3 - "$tmp" \
  "$DX7_PACKET/dokploy-services.json" \
  "$DX7_PACKET/dokploy-services.tsv" <<'PY'
import csv
import json
import sys

src, json_out, tsv_out = sys.argv[1:4]
projects = json.load(open(src))
rows = []

for project in projects:
    project_name = project.get("name", "")
    for env in project.get("environments", []) or []:
        env_name = env.get("name", "")
        for group in ("applications", "compose", "postgres", "mariadb", "mysql", "mongo", "redis"):
            for service in env.get(group, []) or []:
                rows.append({
                    "project": project_name,
                    "environment": env_name,
                    "type": group,
                    "id": service.get("applicationId") or service.get("composeId") or service.get("postgresId") or service.get("databaseId") or "",
                    "name": service.get("name", ""),
                    "appName": service.get("appName", ""),
                    "status": service.get("applicationStatus") or service.get("composeStatus") or service.get("status") or "",
                })

json.dump(rows, open(json_out, "w"), indent=2, sort_keys=True)
with open(tsv_out, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["project", "environment", "type", "id", "name", "appName", "status"], delimiter="\t")
    writer.writeheader()
    writer.writerows(rows)
PY

column -t -s "$(printf '\t')" "$DX7_PACKET/dokploy-services.tsv" | tee "$DX7_PACKET/dokploy-services.txt"
```

Pass criteria:

- All canonical fleet services are present or explicitly covered by an allowed non-unit service row.
- No per-tenant Epic 2.x compose/application records remain.
- Every remaining non-canonical service has an owner and reason in the evidence template.

Failure examples:

- `tenant-*`, `z-*`, `c-*`, `e-*`, or customer-named compose records with no active migration blocker.
- A Dokploy record whose container no longer exists but whose compose/app still points at an old
  tenant hostname.
- A live-paying tenant record retired without a snapshot id and migration verification row.

## Check 2: Docker Container Inventory

Read-only host check:

```sh
ssh hetzner_vps_1 '
  set -eu
  docker ps -a --format "{{json .}}"
' > "$DX7_PACKET/docker-ps-a.jsonl"

python3 - "$DX7_PACKET/docker-ps-a.jsonl" "$DX7_PACKET/docker-ps-a.tsv" <<'PY'
import csv
import json
import sys

rows = []
for line in open(sys.argv[1]):
    if not line.strip():
        continue
    obj = json.loads(line)
    rows.append({
        "Names": obj.get("Names", ""),
        "Image": obj.get("Image", ""),
        "Status": obj.get("Status", ""),
        "Ports": obj.get("Ports", ""),
        "Networks": obj.get("Networks", ""),
    })

with open(sys.argv[2], "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["Names", "Image", "Status", "Ports", "Networks"], delimiter="\t")
    writer.writeheader()
    writer.writerows(sorted(rows, key=lambda r: r["Names"]))
PY

column -t -s "$(printf '\t')" "$DX7_PACKET/docker-ps-a.tsv" | tee "$DX7_PACKET/docker-ps-a.txt"
```

Pass criteria:

- The only always-on unit containers are the canonical final fleet.
- No stopped Epic 2.x tenant containers remain as "just in case" state. The retained state must be
  the archived snapshot, not a stopped container.
- Every running Epaminon sandbox is tied to an active job and has an expected teardown.
- The Dokploy list and `docker ps -a` agree: no Dokploy record points to missing active service, and
  no active old tenant container exists without a Dokploy record and owner.

## Check 3: Docker Volumes And Orphan Proof

Read-only host check:

```sh
ssh hetzner_vps_1 '
  set -eu
  docker volume ls --format "{{json .}}"
' > "$DX7_PACKET/docker-volumes.jsonl"

ssh hetzner_vps_1 '
  set -eu
  for v in $(docker volume ls -q); do
    docker volume inspect "$v" --format "{{json .}}"
  done
' > "$DX7_PACKET/docker-volume-inspect.jsonl"
```

Classify volumes against the retirement snapshot manifest:

```sh
python3 - "$DX7_PACKET/docker-volume-inspect.jsonl" \
  "$DX7_PACKET/retirement-snapshots.tsv" \
  "$DX7_PACKET/docker-volume-classification.tsv" <<'PY'
import csv
import json
import re
import sys

volume_file, snapshot_file, out_file = sys.argv[1:4]
snapshot_by_volume = {}

with open(snapshot_file, newline="") as f:
    reader = csv.DictReader(f, delimiter="\t")
    for row in reader:
        volume = (row.get("volume") or "").strip()
        if volume:
            snapshot_by_volume[volume] = row

tenant_pattern = re.compile(r"(tenant-|^z-|^c-|^e-|callisthenes-|epaminon-|ring-)", re.I)
rows = []

for line in open(volume_file):
    if not line.strip():
        continue
    obj = json.loads(line)
    name = obj.get("Name", "")
    has_snapshot = name in snapshot_by_volume
    looks_old = bool(tenant_pattern.search(name))
    if looks_old and not has_snapshot:
        verdict = "FAIL-old-looking-volume-without-snapshot"
    elif has_snapshot:
        verdict = "ok-archived-retired-volume"
    else:
        verdict = "ok-canonical-or-nonunit"
    rows.append({
        "volume": name,
        "mountpoint": obj.get("Mountpoint", ""),
        "driver": obj.get("Driver", ""),
        "snapshot_id": snapshot_by_volume.get(name, {}).get("snapshot_id", ""),
        "archive_uri": snapshot_by_volume.get(name, {}).get("archive_uri", ""),
        "verdict": verdict,
    })

with open(out_file, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["volume", "driver", "snapshot_id", "archive_uri", "verdict", "mountpoint"], delimiter="\t")
    writer.writeheader()
    writer.writerows(sorted(rows, key=lambda r: r["volume"]))
PY

column -t -s "$(printf '\t')" "$DX7_PACKET/docker-volume-classification.tsv" \
  | tee "$DX7_PACKET/docker-volume-classification.txt"
```

Pass criteria:

- Zero rows have `FAIL-old-looking-volume-without-snapshot`.
- Every retired tenant volume has `snapshot_id`, `archive_uri`, checksum, snapshot date, and owner in
  `retirement-snapshots.tsv`.
- No volume is retained as rollback state unless it is part of the canonical final fleet.

Expected `retirement-snapshots.tsv` columns:

```text
tenant	unit	volume	snapshot_id	archive_uri	sha256	snapshot_utc	retired_by_issue	restore_priority	notes
```

## Check 4: Watchdog Static Checks

Read-only host check. This extracts only watchdog names/URLs and avoids printing notification tokens.

```sh
ssh hetzner_vps_1 '
  set -eu
  sudo sh -c '"'"'
    set -a
    test -f /etc/zenod-watchdog.env && . /etc/zenod-watchdog.env
    printf "ZENOD_WATCHDOG_HEALTH_URLS=%s\n" "${ZENOD_WATCHDOG_HEALTH_URLS:-}"
    printf "ZENOD_WATCHDOG_CONTAINERS=%s\n" "${ZENOD_WATCHDOG_CONTAINERS:-}"
    printf "ZENOD_WATCHDOG_DISK_PATHS=%s\n" "${ZENOD_WATCHDOG_DISK_PATHS:-}"
  '"'"'
  systemctl is-enabled zenod-watchdog.timer || true
  systemctl is-active zenod-watchdog.timer || true
  journalctl -u zenod-watchdog.service -n 80 --no-pager
' > "$DX7_PACKET/watchdog-static-check.txt"
```

Expected static health URL shape:

```text
https://zenod.zenod.dev/healthz
https://calli.zenod.dev/healthz
https://epaminon.zenod.dev/healthz
https://ring.zenod.dev/healthz
https://phylax.zenod.dev/healthz
```

Expected static container names:

```text
zenod
callisthenes
epaminon-api
ring
phylax
```

Pass criteria:

- No per-tenant URL remains, including `z-*`, `c-*`, `e-*`, `tenant-*`, customer names, or old
  `cloud-test` tenant proofs.
- No per-tenant container name remains.
- Timer is enabled and active, or a named replacement monitor is linked in the evidence packet.
- Latest journal sample shows the static URLs evaluated without per-tenant misses.

If the canonical hostnames changed during Epic 3.x delivery, update this section only with a spine or
PR citation and include the changed source hash in the packet.

## Check 5: Provisioner And Static Code Tombstones

Run from the repository after DX-6 merges. This is a static proof that the old path cannot mint new
per-tenant Dokploy apps, DNS records, or watchdog entries.

```sh
rg -n \
  "compose\\.create|compose\\.delete|domain\\.create|ZENOD_WATCHDOG_CONTAINERS|ZENOD_WATCHDOG_HEALTH_URLS|z-<name>|tenant-<name>|ZENOD_AWAIT_PROVISION|DOKPLOY_API" \
  docs packages scripts units \
  > "$DX7_PACKET/provisioner-static-search.txt" || true
```

Pass criteria:

- Remaining hits are docs, tombstone comments, tests, this runbook, or the final multi-tenant unit
  deploy path.
- No live checkout/webhook/provisioner path creates a per-customer Dokploy compose/app.
- No live path appends per-customer watchdog entries.
- No live path mints per-customer DNS/subdomains for unit tenants.

Record every remaining non-doc hit in the evidence template with one of:

- `canonical-multitenant`
- `tombstone`
- `test-only`
- `follow-up-required`

## Check 6: Final Container Map Diff

Create normalized expected and actual lists:

```sh
cat > "$DX7_PACKET/expected-final-containers.txt" <<'EOF'
proxy
zenod
callisthenes
epaminon-api
ring
phylax
EOF

python3 - "$DX7_PACKET/docker-ps-a.jsonl" "$DX7_PACKET/actual-always-on-containers.txt" <<'PY'
import json
import re
import sys

allowed_ephemeral = re.compile(r"(epaminon.*job|sandbox)", re.I)
names = []
for line in open(sys.argv[1]):
    if not line.strip():
        continue
    row = json.loads(line)
    name = row.get("Names", "")
    status = row.get("Status", "")
    if "Up " not in status:
        continue
    if allowed_ephemeral.search(name):
        continue
    names.append(name)

for name in sorted(set(names)):
    print(name)
PY

diff -u "$DX7_PACKET/expected-final-containers.txt" "$DX7_PACKET/actual-always-on-containers.txt" \
  | tee "$DX7_PACKET/final-container-map.diff"
```

Pass criteria:

- Diff is empty after explicitly allowed non-unit services are accounted for in the evidence packet.
- Any diff line is either a blocker or has a linked steward-approved canonical-map update.

## Restore Drill: Gated Operator Procedure

This section is deliberately not read-only. It creates a temporary restore volume/container and later
removes only those drill artifacts. Do not run it until Jordi approves the target snapshot and command
batch. Never run this against a live tenant volume.

### Restore Drill Preconditions

Required fields:

```text
tenant=
unit=
snapshot_id=
archive_uri=
archive_sha256=
source_volume=
image_ref=
restore_token_secret_source=
llm_secret_source=
approved_by=
approved_utc=
```

The chosen snapshot should be a dead/test retired instance when possible. If the only useful proof is
a live-paying tenant snapshot, Jordi must approve the tenant, window, and rollback plan explicitly.

### Restore Drill Commands

Operator sets variables:

```sh
export DX7_RESTORE_TENANT="<tenant>"
export DX7_RESTORE_UNIT="<unit>"
export DX7_SNAPSHOT_ARCHIVE="<absolute path or mounted archive path>"
export DX7_SNAPSHOT_SHA256="<expected sha256>"
export DX7_IMAGE_REF="<image ref recorded in retirement manifest>"
export DX7_DRILL_NAME="dx7-restore-${DX7_RESTORE_UNIT}-${DX7_RESTORE_TENANT}-$(date -u +%Y%m%d%H%M%S)"
export DX7_DRILL_VOLUME="${DX7_DRILL_NAME}-data"
```

Verify snapshot integrity:

```sh
printf "%s  %s\n" "$DX7_SNAPSHOT_SHA256" "$DX7_SNAPSHOT_ARCHIVE" | sha256sum -c - \
  | tee "$DX7_PACKET/restore-snapshot-sha256.txt"
```

Create a quarantined temporary volume and unpack the snapshot:

```sh
docker volume create "$DX7_DRILL_VOLUME" | tee "$DX7_PACKET/restore-volume-create.txt"

docker run --rm \
  -v "$DX7_DRILL_VOLUME:/restore" \
  -v "$(dirname "$DX7_SNAPSHOT_ARCHIVE"):/archive:ro" \
  busybox sh -c 'cd /restore && tar -xzf "/archive/'"$(basename "$DX7_SNAPSHOT_ARCHIVE")"'"' \
  | tee "$DX7_PACKET/restore-unpack.txt"
```

Start the drill container with no public hostname and local-only access:

```sh
docker run -d \
  --name "$DX7_DRILL_NAME" \
  --label epic=3.7 \
  --label purpose=dx7-restore-drill \
  --label tenant="$DX7_RESTORE_TENANT" \
  -p 127.0.0.1::8080 \
  -v "$DX7_DRILL_VOLUME:/data" \
  -e ZENOD_API_TOKEN="$RESTORE_DRILL_TOKEN" \
  "$DX7_IMAGE_REF" \
  | tee "$DX7_PACKET/restore-container-id.txt"

docker inspect "$DX7_DRILL_NAME" > "$DX7_PACKET/restore-container-inspect.json"
docker port "$DX7_DRILL_NAME" 8080/tcp | tee "$DX7_PACKET/restore-local-port.txt"
```

Health and data proof:

```sh
RESTORE_URL="http://$(docker port "$DX7_DRILL_NAME" 8080/tcp | sed 's/0.0.0.0/127.0.0.1/')"
curl -fsS "$RESTORE_URL/healthz" | tee "$DX7_PACKET/restore-healthz.txt"

docker run --rm -v "$DX7_DRILL_VOLUME:/data:ro" busybox sh -c '
  find /data -maxdepth 3 -type f | sort | sed -n "1,120p"
' | tee "$DX7_PACKET/restore-data-file-list.txt"
```

Unit-specific proof:

- Zenod: search or read a known migrated marker from the restored `/data` or MCP endpoint and record
  the original commit/path.
- Callisthenes: prove the restored token/account binding exists and the X/OAuth state is present
  without posting.
- Epaminon: prove the restored tenant/API state exists; do not start customer jobs.
- Ring/Phylax: prove pairing/session metadata is present; do not send outbound messages.

Cleanup drill artifacts after evidence capture:

```sh
docker rm -f "$DX7_DRILL_NAME" | tee "$DX7_PACKET/restore-container-cleanup.txt"
docker volume rm "$DX7_DRILL_VOLUME" | tee "$DX7_PACKET/restore-volume-cleanup.txt"
```

Pass criteria:

- Snapshot checksum matches the retirement manifest.
- Restore starts from the archived snapshot, not the original retired volume.
- Restored service is local-only and has no public route.
- Health check passes.
- Unit-specific tenant data proof passes.
- Drill artifacts are cleaned up and do not appear in the final `docker ps -a` or volume sweep.

## Evidence Template

Use this template as the issue handoff for #732 and attach/link the packet files.

```markdown
## DX-7 Final Sweep Evidence

Date / UTC:
Tester:
Repo:
Commit:
Branch:
Bound spine:
Bound issue:
Dokploy API base:
VPS:

### Canonical Sources

| Source | SHA256 / URL | Notes |
|---|---|---|
| docs/EPIC-3.7-DECOMMISSION-2X.md |  |  |
| docs/final-container-map-deck.html |  | slide 1 canonical fleet |
| docs/EPIC-3.7-DX7-FINAL-SWEEP-RUNBOOK.md |  |  |

### Allowed Non-Unit Services

| Service | Type | Owner | Why Allowed | Evidence |
|---|---|---|---|---|
|  |  |  |  |  |

### Dokploy List

Command:
Evidence file:
Result: PASS / FAIL
Unexpected rows:

| Project | Env | Type | Name | App Name | Status | Verdict |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

### Docker Containers

Command:
Evidence file:
Result: PASS / FAIL
Unexpected containers:

| Name | Image | Status | Networks | Verdict |
|---|---|---|---|---|
|  |  |  |  |  |

### Docker Volumes / Orphan Proof

Command:
Evidence file:
Result: PASS / FAIL

| Volume | Snapshot ID | Archive URI | SHA256 | Verdict |
|---|---|---|---|---|
|  |  |  |  |  |

### Watchdog Static Checks

Command:
Evidence file:
Result: PASS / FAIL
Health URLs:
Container names:
Journal sample:
Unexpected tenant entries:

### Provisioner Static Checks

Command:
Evidence file:
Result: PASS / FAIL
Remaining hits:

| Path | Line | Classification | Follow-up |
|---|---:|---|---|
|  |  |  |  |

### Restore Drill

Approved by:
Approval timestamp:
Tenant:
Unit:
Snapshot ID:
Archive URI:
Snapshot SHA256:
Image ref:
Drill container:
Drill volume:
Evidence files:
Result: PASS / FAIL
Cleanup verified: yes / no

### Residual Risk / Blockers

| Severity | Blocker | Owner | Required Input | What Can Continue |
|---|---|---|---|---|
|  |  |  |  |  |

### Final Verdict

DX-7 is PASS / FAIL.
Human-ready for Epic 3.7 go-live: yes / no.
Next action:
```

## Residual Blockers To Carry Until Execution

- DX-7 final pass depends on DX-3..DX-6 completion and their retirement manifests.
- Snapshot archive location and retention policy must be explicit before the restore drill.
- Jordi must approve the restore target and command batch if the drill touches VPS Docker state.
- The bound 3.7 spine and final map deck must be merged or otherwise present on the tested commit
  before claiming the final sweep.

## References

- `docs/EPIC-3.7-DECOMMISSION-2X.md`
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md`
- `docs/final-container-map-deck.html`
- `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md`
- `scripts/watchdog/zenod-watchdog.sh`
- `units/PROVISIONING-RUNBOOK.md`
- Dokploy API reference: https://docs.dokploy.com/docs/api/reference-project and
  https://docs.dokploy.com/docs/api/reference-compose
