#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/epic37-dx2-early-wins-retire.sh"
CSV="$ROOT/docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    echo "Expected failure containing: $expected" >&2
    exit 1
  fi
  grep -Fq "$expected" <<< "$output" || {
    echo "Failure did not contain '$expected':" >&2
    printf '%s\n' "$output" >&2
    exit 1
  }
}

bash -n "$SCRIPT"

awk -F, '
  NR == 1 { if (NF != 11) exit 1; next }
  NF != 11 { exit 1 }
  $2 !~ /^(test|dead|duplicate)$/ { exit 1 }
  $3 !~ /^(compose|application|record-only)$/ { exit 1 }
  $4 == "" { exit 1 }
  $10 !~ /^(unrouted|still-routed)$/ { exit 1 }
  END { if (NR != 18) exit 1 }
' "$CSV"

duplicate_ids="$(tail -n +2 "$CSV" | cut -d, -f4 | sort | uniq -d)"
[[ -z "$duplicate_ids" ]]
! rg -n 'PLACEHOLDER|live-paying|,unknown,' "$CSV"

expect_failure "DRY_RUN must be 0 or 1" env DRY_RUN=maybe bash "$SCRIPT"
expect_failure "set JORDI_APPROVED_DX2=1" env DRY_RUN=0 bash "$SCRIPT"
expect_failure "RESTORE_DRILL=1 is required" env DRY_RUN=0 JORDI_APPROVED_DX2=1 bash "$SCRIPT"
expect_failure "APPROVED_CSV_SHA256" env DRY_RUN=0 JORDI_APPROVED_DX2=1 RESTORE_DRILL=1 bash "$SCRIPT"
expect_failure "APPROVAL_REF" env DRY_RUN=0 JORDI_APPROVED_DX2=1 RESTORE_DRILL=1 APPROVED_CSV_SHA256="$(printf 'a%.0s' {1..64})" bash "$SCRIPT"
expect_failure "does not match approval" env \
  DRY_RUN=0 \
  JORDI_APPROVED_DX2=1 \
  RESTORE_DRILL=1 \
  APPROVED_CSV_SHA256="$(printf 'a%.0s' {1..64})" \
  APPROVAL_REF=test-only \
  DOKPLOY_API_KEY=test-only \
  ARCHIVE_DIR="$TMP/archive" \
  EVIDENCE_DIR="$TMP/evidence" \
  CANDIDATES_CSV="$CSV" \
  bash "$SCRIPT"

printf '%s\n' 'slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,endpoint_expectation,notes' > "$TMP/empty.csv"
expect_failure "Candidate CSV has no rows" env \
  DRY_RUN=1 \
  DOKPLOY_API_KEY=test-only \
  ARCHIVE_DIR="$TMP/archive" \
  EVIDENCE_DIR="$TMP/evidence" \
  CANDIDATES_CSV="$TMP/empty.csv" \
  bash "$SCRIPT"

printf '%s\n' \
  'slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,endpoint_expectation,notes' \
  'bad,test,compose,id,,,,,,unrouted,note,extra' > "$TMP/malformed.csv"
expect_failure "exactly 11 comma-free fields" env \
  DRY_RUN=1 \
  DOKPLOY_API_KEY=test-only \
  ARCHIVE_DIR="$TMP/archive" \
  EVIDENCE_DIR="$TMP/evidence" \
  CANDIDATES_CSV="$TMP/malformed.csv" \
  bash "$SCRIPT"

FAKE_BIN="$TMP/bin"
FAKE_LOG="$TMP/fake-calls.log"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${@: -1}"
printf '%s\n' "$url" >> "$DX2_FAKE_LOG"
case "$url" in
  */project.all) printf '[]\n' ;;
  */compose.one*) printf '%s\n' '{"composeId":"compose-id","name":"test-row","appName":"test-app","domains":[]}' ;;
  */compose.getConvertedCompose*) printf '%s\n' 'services: {}' ;;
  */domain.byComposeId*) printf '[]\n' ;;
  *) printf '%s\n' '{"ok":true}' ;;
esac
EOF

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-} ${2:-}" in
  "ps -a")
    if [[ " $* " == *" --filter "* ]]; then printf 'test-container\n'; else printf '{}\n'; fi
    ;;
  "volume ls") printf 'DRIVER VOLUME\n' ;;
  "stats --no-stream") printf '{}\n' ;;
  "network inspect") printf '[]\n' ;;
  "inspect test-container") printf '%s\n' '[{"Mounts":[{"Type":"volume","Name":"test-volume"}]}]' ;;
  "volume inspect") printf '%s\n' '[{"Labels":{"com.docker.compose.project":"test-app"}}]' ;;
  "run --rm") exit 42 ;;
  *) printf 'Unexpected fake docker call: %s\n' "$*" >&2; exit 97 ;;
esac
EOF

cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF

cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$FAKE_BIN/curl" "$FAKE_BIN/docker" "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl"
printf '%s\n' 'ZENOD_WATCHDOG_CONTAINERS="canonical"' > "$TMP/watchdog.env"
printf '%s\n' \
  'slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,endpoint_expectation,notes' \
  'test-row,test,compose,compose-id,,test-container,test-volume,,,unrouted,rollback-test' > "$TMP/rollback.csv"
rollback_hash="$(shasum -a 256 "$TMP/rollback.csv" | awk '{print $1}')"

set +e
rollback_output="$(
  PATH="$FAKE_BIN:$PATH" \
  DX2_FAKE_LOG="$FAKE_LOG" \
  DRY_RUN=0 \
  JORDI_APPROVED_DX2=1 \
  RESTORE_DRILL=1 \
  APPROVED_CSV_SHA256="$rollback_hash" \
  APPROVAL_REF=test-rollback \
  DOKPLOY_API_KEY=test-only \
  DOKPLOY_API_BASE=http://fake \
  ARCHIVE_DIR="$TMP/archive" \
  EVIDENCE_DIR="$TMP/rollback-evidence" \
  CANDIDATES_CSV="$TMP/rollback.csv" \
  WATCHDOG_ENV="$TMP/watchdog.env" \
  bash "$SCRIPT" 2>&1
)"
rollback_rc=$?
set -e

[[ "$rollback_rc" -eq 42 ]]
grep -Fq 'Pre-delete failure detected' <<< "$rollback_output"
grep -Fq '/compose.stop' "$FAKE_LOG"
grep -Fq '/compose.start' "$FAKE_LOG"
! grep -Fq '/compose.delete' "$FAKE_LOG"
grep -Fq 'ZENOD_WATCHDOG_CONTAINERS="canonical"' "$TMP/watchdog.env"

printf 'DX-2 guard tests passed\n'
