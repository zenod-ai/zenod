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

printf 'DX-2 guard tests passed\n'
