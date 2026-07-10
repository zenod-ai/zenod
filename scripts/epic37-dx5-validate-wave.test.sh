#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$ROOT/scripts/epic37-dx5-validate-wave.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo"
mkdir -p "$REPO/packages/server/src" "$REPO/packages/server/test" "$REPO/units"
printf '%s\n' 'export const provisioningMode = "tenant-api";' > "$REPO/packages/server/src/current.ts"
printf '%s\n' 'export const tenantApiTest = true;' > "$REPO/packages/server/test/current.test.ts"
printf '%s\n' 'services: {}' > "$REPO/units/current.yml"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.name DX5-Test
git -C "$REPO" config user.email dx5-test@example.invalid
git -C "$REPO" add .
git -C "$REPO" commit -q -m fixture
COMMIT="$(git -C "$REPO" rev-parse HEAD)"

make_packet() {
  local destination="$1"
  local scenario="$2"
  mkdir -p "$destination"
  python3 - "$destination" "$COMMIT" "$scenario" <<'PY'
import hashlib
import json
import pathlib
import sys

destination = pathlib.Path(sys.argv[1])
commit = sys.argv[2]
scenario = sys.argv[3]
digest = "a" * 64

collectors = [
    {"name": name, "evidence_ref": f"evidence/{name}.json", "sha256": digest}
    for name in ("dokploy-project-all", "docker-ps-a", "docker-volumes", "watchdog-map")
]

candidate = {
    "row_id": "epaminon-tenant-1",
    "topology": "separate-per-user",
    "classification": "live-paying",
    "tenant_ref": "tenant-1",
    "job_history_evidence_ref": "evidence/tenant-1-job-history.json",
}
discovered_rows = [candidate.copy()] if scenario == "missing-archive" else []
postflight_rows = []
if scenario == "unexpected-row":
    postflight_rows = [{
        "row_id": "unexpected-suite",
        "topology": "suite-bundled",
        "classification": "unknown",
    }]

manifest = {
    "schema_version": 1,
    "wave": "DX-5",
    "zero_instance_proof": {
        "status": "proven",
        "basis_refs": ["evidence/fleet-reinventory.json"],
    },
    "candidates": [candidate] if scenario == "missing-archive" else [],
}
inventory = {
    "schema_version": 1,
    "wave": "DX-5",
    "commit_sha": commit,
    "captured_at": "2026-07-08T04:00:00Z" if scenario == "stale" else "2026-07-10T04:00:00Z",
    "collectors": collectors,
    "rows": discovered_rows,
}
postflight = {
    "schema_version": 1,
    "wave": "DX-5",
    "commit_sha": commit,
    "captured_at": "2026-07-10T04:20:00Z",
    "collectors": collectors,
    "rows": postflight_rows,
}
cutover = {
    "schema_version": 1,
    "wave": "DX-5",
    "commit_sha": commit,
    "status": "accepted",
    "accepted_at": "2026-07-10T03:00:00Z",
    "accepted_by": "E-MT-7 tester",
    "acceptance_ref": "issue#em-t7",
    "pilot_gate_ref": "issue#pilot",
    "spawner_decision_ref": "issue#spawner",
    "cutover_proof_ref": "evidence/cutover.json",
    "old_token_proof_ref": "evidence/token.json",
    "await_provision_removed": True,
}
if scenario == "missing-cutover":
    cutover["spawner_decision_ref"] = ""
    cutover["cutover_proof_ref"] = ""

sandbox = {
    "schema_version": 1,
    "wave": "DX-5",
    "commit_sha": commit,
    "status": "accepted",
    "evidence_ref": "evidence/sandbox.json",
    "worker_image_digest": "sha256:" + "b" * 64,
    "jobs_proven": 3,
    "lifecycle": {"spawned": True, "ran": True, "persisted": True, "torn_down": True},
    "crash_orphan_count": 0,
}
if scenario == "missing-sandbox":
    sandbox["evidence_ref"] = ""
    sandbox["lifecycle"]["torn_down"] = False

receipt_rows = []
if scenario == "missing-archive":
    receipt_rows = [{
        "row_id": candidate["row_id"],
        "rollback": {"status": "passed", "evidence_ref": "evidence/rollback.json"},
        "removal": {"status": "removed", "evidence_ref": "evidence/removal.json"},
    }]
receipts = {
    "schema_version": 1,
    "wave": "DX-5",
    "commit_sha": commit,
    "captured_at": "2026-07-10T04:15:00Z",
    "rows": receipt_rows,
}

def write(name, value):
    path = destination / name
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest_hash = write("scope-manifest.json", manifest)
inventory_hash = write("fleet-reinventory.json", inventory)
write("postflight-reinventory.json", postflight)
write("retirement-receipts.json", receipts)
write("em-t7-receipt.json", cutover)
write("sandbox-proof.json", sandbox)

approval = {
    "schema_version": 1,
    "wave": "DX-5",
    "status": "approved",
    "approved_by": "Jordi",
    "approved_at": "2026-07-10T04:10:00Z",
    "approval_ref": "issue#approval",
    "window": "2026-07-10T04:10:00Z/2026-07-10T05:10:00Z",
    "rollback_plan_ref": "runbook#rollback",
    "manifest_sha256": manifest_hash,
    "inventory_sha256": inventory_hash,
    "approved_row_ids": [candidate["row_id"]] if scenario == "missing-archive" else [],
}
write("approval.json", approval)
PY
}

expect_failure() {
  local expected="$1"
  local package="$2"
  local output
  if output="$(python3 "$VALIDATOR" --repo-root "$REPO" --package-dir "$package" --now 2026-07-10T05:00:00Z 2>&1)"; then
    echo "Expected validation failure containing: $expected" >&2
    exit 1
  fi
  grep -Fq "$expected" <<< "$output" || {
    echo "Failure did not contain '$expected':" >&2
    printf '%s\n' "$output" >&2
    exit 1
  }
}

python3 -m py_compile "$VALIDATOR"
(cd "$ROOT/docs" && shasum -a 256 -c EPIC-3.7-DX5-EPAMINON-SCOPE.sha256 >/dev/null)

make_packet "$TMP/pass" pass
python3 "$VALIDATOR" --repo-root "$REPO" --package-dir "$TMP/pass" --now 2026-07-10T05:00:00Z \
  | grep -Fq 'DX-5 wave packet accepted'

make_packet "$TMP/stale" stale
expect_failure 'fleet inventory is stale' "$TMP/stale"

make_packet "$TMP/unexpected" unexpected-row
expect_failure 'unexpected current retirement rows remain' "$TMP/unexpected"

make_packet "$TMP/missing-cutover" missing-cutover
expect_failure 'E-MT-7 receipt lacks spawner_decision_ref' "$TMP/missing-cutover"

make_packet "$TMP/missing-sandbox" missing-sandbox
expect_failure 'ephemeral sandbox proof lacks evidence_ref' "$TMP/missing-sandbox"

make_packet "$TMP/missing-archive" missing-archive
expect_failure 'candidate epaminon-tenant-1 lacks archive evidence' "$TMP/missing-archive"

make_packet "$TMP/legacy" pass
printf '%s\n' 'export const legacy = "ZENOD_AWAIT_PROVISION=1";' > "$REPO/packages/server/src/legacy.ts"
expect_failure 'remaining AWAIT_PROVISION path(s) found' "$TMP/legacy"

printf 'DX-5 validator tests passed\n'
