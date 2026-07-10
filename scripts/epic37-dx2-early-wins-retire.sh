#!/usr/bin/env bash
set -eEuo pipefail

# Epic 3.7 DX-2 early-wins retirement batch.
# Defaults to dry-run. Do not run with DRY_RUN=0 until Jordi has approved the
# archive target and the candidate CSV.

umask 077

CANDIDATES_CSV="${CANDIDATES_CSV:-docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/epic37-dx2-evidence-$(date -u +%Y%m%dT%H%M%SZ)}"
ARCHIVE_DIR="${ARCHIVE_DIR:-}"
DRY_RUN="${DRY_RUN:-1}"
RESTORE_DRILL="${RESTORE_DRILL:-0}"
JORDI_APPROVED_DX2="${JORDI_APPROVED_DX2:-0}"
APPROVED_CSV_SHA256="${APPROVED_CSV_SHA256:-}"
APPROVAL_REF="${APPROVAL_REF:-}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
WATCHDOG_ENV="${WATCHDOG_ENV:-/etc/zenod-watchdog.env}"
CHECKSUMS_FILE=""
FIRST_ARCHIVE=""
PREPARE_STARTED=0
DELETION_STARTED=0
PREPARED_KINDS=()
PREPARED_IDS=()

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY_RUN: %q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

read_to_file() {
  local output="$1"
  shift
  "$@" > "$output"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_execute_guard() {
  [[ "$DRY_RUN" == "0" || "$DRY_RUN" == "1" ]] || { echo "DRY_RUN must be 0 or 1." >&2; exit 2; }
  [[ "$DRY_RUN" == "1" ]] && return 0

  [[ "$JORDI_APPROVED_DX2" == "1" ]] || {
    echo "Refusing destructive mode: set JORDI_APPROVED_DX2=1 only after Jordi approves archive target and candidate list." >&2
    exit 2
  }
  [[ "$RESTORE_DRILL" == "1" ]] || { echo "Refusing destructive mode: RESTORE_DRILL=1 is required." >&2; exit 2; }
  [[ "$APPROVED_CSV_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || {
    echo "Refusing destructive mode: APPROVED_CSV_SHA256 must be the approved candidate CSV hash." >&2
    exit 2
  }
  [[ -n "$APPROVAL_REF" ]] || { echo "Refusing destructive mode: APPROVAL_REF must identify Jordi's approval receipt." >&2; exit 2; }
}

validate_candidate_csv() {
  local bad_rows
  bad_rows="$(awk -F, 'NR == 1 { if (NF != 11) print NR; next } NF != 11 || $1 == "" { print NR }' "$CANDIDATES_CSV")"
  [[ -z "$bad_rows" ]] || { echo "Candidate CSV must have exactly 11 comma-free fields; bad rows: $bad_rows" >&2; exit 2; }
  [[ "$(wc -l < "$CANDIDATES_CSV" | tr -d ' ')" -gt 1 ]] || { echo "Candidate CSV has no rows." >&2; exit 2; }

  local duplicate_ids
  duplicate_ids="$(tail -n +2 "$CANDIDATES_CSV" | cut -d, -f4 | sort | uniq -d)"
  [[ -z "$duplicate_ids" ]] || { echo "Candidate CSV repeats Dokploy IDs: $duplicate_ids" >&2; exit 2; }
}

require_inputs() {
  [[ -f "$CANDIDATES_CSV" ]] || { echo "Missing candidate CSV: $CANDIDATES_CSV" >&2; exit 2; }
  [[ -n "$ARCHIVE_DIR" ]] || { echo "ARCHIVE_DIR is required." >&2; exit 2; }
  [[ "$ARCHIVE_DIR" == /* && "$ARCHIVE_DIR" != "/" ]] || { echo "ARCHIVE_DIR must be a non-root absolute path." >&2; exit 2; }
  validate_candidate_csv
  mkdir -p "$EVIDENCE_DIR"
  [[ -n "$DOKPLOY_API_KEY" ]] || { echo "DOKPLOY_API_KEY is required for live read-only reconciliation. Run: eval \"\$(dokploy-env)\"" >&2; exit 2; }
  if [[ "$DRY_RUN" != "1" ]]; then
    local actual_hash
    local approved_hash
    actual_hash="$(sha256_file "$CANDIDATES_CSV")"
    approved_hash="$(printf '%s' "$APPROVED_CSV_SHA256" | tr 'A-F' 'a-f')"
    [[ "$actual_hash" == "$approved_hash" ]] || {
      echo "Refusing destructive mode: candidate CSV hash $actual_hash does not match approval $APPROVED_CSV_SHA256." >&2
      exit 2
    }
    mkdir -p "$ARCHIVE_DIR"
    cp "$CANDIDATES_CSV" "$EVIDENCE_DIR/approved-candidates.csv"
    printf '%s  %s\n' "$actual_hash" "$CANDIDATES_CSV" > "$EVIDENCE_DIR/approved-candidates.sha256"
    printf '%s\n' "$APPROVAL_REF" > "$EVIDENCE_DIR/approval-ref.txt"
  fi
  CHECKSUMS_FILE="$ARCHIVE_DIR/SHA256SUMS"
}

dokploy_get() {
  local endpoint="$1"
  run curl -fsS -H "x-api-key: ${DOKPLOY_API_KEY}" "${DOKPLOY_API_BASE}${endpoint}"
}

dokploy_get_to_file() {
  local endpoint="$1"
  local output="$2"
  read_to_file "$output" curl -fsS -H "x-api-key: ${DOKPLOY_API_KEY}" "${DOKPLOY_API_BASE}${endpoint}"
}

dokploy_post() {
  local endpoint="$1"
  local body="$2"
  run curl -fsS -X POST \
    -H "x-api-key: ${DOKPLOY_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${DOKPLOY_API_BASE}${endpoint}"
}

rollback_predelete() {
  local rc="${1:-1}"
  [[ "$rc" -ne 0 ]] || rc=130
  trap - ERR INT TERM
  set +e
  set +u

  if [[ "$DRY_RUN" != "1" && "$PREPARE_STARTED" == "1" && "$DELETION_STARTED" != "1" ]]; then
    log "Pre-delete failure detected; restoring watchdog baseline and restarting stopped records"
    if [[ -f "$EVIDENCE_DIR/zenod-watchdog.env.before" ]]; then
      sudo cp "$EVIDENCE_DIR/zenod-watchdog.env.before" "$WATCHDOG_ENV"
      sudo systemctl start zenod-watchdog.service
    fi

    local i
    for ((i = ${#PREPARED_IDS[@]} - 1; i >= 0; i--)); do
      case "${PREPARED_KINDS[$i]}" in
        compose) dokploy_post "/compose.start" "{\"composeId\":\"${PREPARED_IDS[$i]}\"}" ;;
        application) dokploy_post "/application.start" "{\"applicationId\":\"${PREPARED_IDS[$i]}\"}" ;;
      esac
    done
  fi

  exit "$rc"
}

capture_preflight() {
  log "Capturing read-only preflight evidence in $EVIDENCE_DIR"
  read_to_file "$EVIDENCE_DIR/docker-ps-a.before.jsonl" docker ps -a --format '{{json .}}'
  read_to_file "$EVIDENCE_DIR/docker-volume-ls.before.txt" docker volume ls
  read_to_file "$EVIDENCE_DIR/docker-stats.before.jsonl" docker stats --no-stream --format '{{json .}}'
  read_to_file "$EVIDENCE_DIR/dokploy-network.before.json" docker network inspect dokploy-network
  dokploy_get_to_file "/project.all" "$EVIDENCE_DIR/dokploy-project-all.before.json"
  read_to_file "$EVIDENCE_DIR/zenod-watchdog.env.before" sudo cat "$WATCHDOG_ENV"
}

capture_candidate_manifest() {
  local slug="$1"
  local kind="$2"
  local id="$3"
  local domain_ids="$4"
  local container_names="$5"
  local volume_names="$6"
  local row_dir="$EVIDENCE_DIR/${slug}__${id}"
  mkdir -p "$row_dir"

  if [[ "$kind" == "compose" || "$kind" == "record-only" ]]; then
    dokploy_get_to_file "/compose.one?composeId=${id}" "$row_dir/compose.one.json"
    dokploy_get_to_file "/compose.getConvertedCompose?composeId=${id}" "$row_dir/compose.converted.yml"
    dokploy_get_to_file "/domain.byComposeId?composeId=${id}" "$row_dir/domains.json"
  else
    dokploy_get_to_file "/application.one?applicationId=${id}" "$row_dir/application.one.json"
    dokploy_get_to_file "/domain.byApplicationId?applicationId=${id}" "$row_dir/domains.json"
  fi

  local -a containers=()
  if [[ -n "$container_names" ]]; then
    IFS=';' read -r -a containers <<< "$container_names"
    for container in "${containers[@]}"; do
      [[ -n "$container" ]] || continue
      read_to_file "$row_dir/${container}.inspect.json" docker inspect "$container"
    done
  fi

  local -a volumes=()
  if [[ -n "$volume_names" ]]; then
    IFS=';' read -r -a volumes <<< "$volume_names"
    for volume in "${volumes[@]}"; do
      [[ -n "$volume" ]] || continue
      read_to_file "$row_dir/${volume}.volume.json" docker volume inspect "$volume"
    done
  fi

  printf '%s\n' "$domain_ids" > "$row_dir/approved-domain-ids.txt"
}

normalize_set() {
  printf '%s' "$1" | tr ';' '\n' | sed '/^$/d' | LC_ALL=C sort | paste -sd ';' -
}

assert_set_equal() {
  local label="$1"
  local expected
  local actual
  expected="$(normalize_set "$2")"
  actual="$(normalize_set "$3")"
  [[ "$expected" == "$actual" ]] || {
    echo "Live reconciliation failed for $label: expected '$expected' but found '$actual'." >&2
    exit 2
  }
}

validate_live_candidate() {
  local slug="$1"
  local kind="$2"
  local id="$3"
  local domain_ids="$4"
  local container_names="$5"
  local volume_names="$6"
  local watchdog_tokens="$7"
  local endpoint_expectation="$8"
  local row_dir="$EVIDENCE_DIR/${slug}__${id}"
  local manifest

  [[ "$endpoint_expectation" == "unrouted" || "$endpoint_expectation" == "still-routed" ]] || {
    echo "Refusing $slug: endpoint_expectation must be unrouted or still-routed." >&2
    exit 2
  }

  if [[ "$kind" == "application" ]]; then
    manifest="$row_dir/application.one.json"
    [[ "$(jq -r '.applicationId' "$manifest")" == "$id" ]] || { echo "Application ID drift for $slug." >&2; exit 2; }
  else
    manifest="$row_dir/compose.one.json"
    [[ "$(jq -r '.composeId' "$manifest")" == "$id" ]] || { echo "Compose ID drift for $slug." >&2; exit 2; }
  fi
  [[ "$(jq -r '.name' "$manifest")" == "$slug" ]] || { echo "Dokploy name drift for $slug/$id." >&2; exit 2; }

  local actual_domains
  actual_domains="$(jq -r '[.domains[].domainId] | join(";")' "$manifest")"
  assert_set_equal "$slug domain IDs" "$domain_ids" "$actual_domains"

  if [[ "$kind" != "application" ]]; then
    local app_name
    local actual_containers
    local actual_volumes=""
    app_name="$(jq -r '.appName' "$manifest")"
    actual_containers="$(docker ps -a --filter "label=com.docker.compose.project=${app_name}" --format '{{.Names}}' | LC_ALL=C sort | paste -sd ';' -)"
    assert_set_equal "$slug containers" "$container_names" "$actual_containers"

    if [[ -n "$actual_containers" ]]; then
      local -a containers=()
      [[ -z "$actual_containers" ]] || IFS=';' read -r -a containers <<< "$actual_containers"
      for container in "${containers[@]}"; do
        [[ -n "$container" ]] || continue
        actual_volumes+="$(docker inspect "$container" | jq -r '.[0].Mounts[] | select(.Type == "volume") | .Name')"$'\n'
      done
      actual_volumes="$(printf '%s' "$actual_volumes" | sed '/^$/d' | LC_ALL=C sort -u | paste -sd ';' -)"
      assert_set_equal "$slug mounted volumes" "$volume_names" "$actual_volumes"
    else
      local -a volumes=()
      if [[ -n "$volume_names" ]]; then
        IFS=';' read -r -a volumes <<< "$volume_names"
        for volume in "${volumes[@]}"; do
          [[ -n "$volume" ]] || continue
          [[ "$(docker volume inspect "$volume" | jq -r '.[0].Labels["com.docker.compose.project"] // ""')" == "$app_name" ]] || {
            echo "Volume $volume is not owned by Dokploy app $app_name." >&2
            exit 2
          }
        done
      fi
    fi
  fi

  local -a tokens=()
  if [[ -n "$watchdog_tokens" ]]; then
    IFS=';' read -r -a tokens <<< "$watchdog_tokens"
    for token in "${tokens[@]}"; do
      [[ -n "$token" ]] || continue
      sudo grep -Fq -- "$token" "$WATCHDOG_ENV" || { echo "Watchdog token drift for $slug: $token not found." >&2; exit 2; }
    done
  fi
}

assert_safe_classification() {
  local slug="$1"
  local classification="$2"
  case "$classification" in
    test|dead|duplicate) ;;
    *)
      echo "Refusing $slug: classification must be test, dead, or duplicate, got '$classification'." >&2
      exit 2
      ;;
  esac
}

archive_named_volume() {
  local slug="$1"
  local volume="$2"
  local out="${ARCHIVE_DIR}/${slug}__volume-${volume}__$(date -u +%Y%m%dT%H%M%SZ).tgz"
  log "Archiving Docker volume $volume to $out"
  run docker run --rm \
    -v "${volume}:/data:ro" \
    -v "${ARCHIVE_DIR}:/archive" \
    alpine:3.20 \
    sh -c "cd /data && tar --numeric-owner -czf /archive/$(basename "$out") ."
  if [[ "$DRY_RUN" == "1" ]]; then
    run sha256sum "$out"
  else
    sha256sum "$out" | tee -a "$CHECKSUMS_FILE"
  fi
  [[ -n "$FIRST_ARCHIVE" ]] || FIRST_ARCHIVE="$out"
}

archive_bind_path() {
  local slug="$1"
  local bind_path="$2"
  local safe_name
  safe_name="$(printf '%s' "$bind_path" | tr '/ ' '__')"
  local out="${ARCHIVE_DIR}/${slug}__bind-${safe_name}__$(date -u +%Y%m%dT%H%M%SZ).tgz"
  log "Archiving bind path $bind_path to $out"
  run sudo tar --one-file-system --numeric-owner -C "$bind_path" -czf "$out" .
  if [[ "$DRY_RUN" == "1" ]]; then
    run sha256sum "$out"
  else
    sha256sum "$out" | tee -a "$CHECKSUMS_FILE"
  fi
  [[ -n "$FIRST_ARCHIVE" ]] || FIRST_ARCHIVE="$out"
}

restore_drill_archive() {
  local slug="$1"
  local archive_file="$2"
  local restore_volume="dx2-restore-${slug}-$(date -u +%Y%m%d%H%M%S)"
  log "Restore drill for $archive_file into temporary volume $restore_volume"
  if [[ "$DRY_RUN" != "1" ]]; then
    grep -F -- "$archive_file" "$CHECKSUMS_FILE" | tail -n 1 | sha256sum -c -
    tar -tzf "$archive_file" >/dev/null
  fi
  run docker volume create "$restore_volume"
  run docker run --rm \
    -v "${restore_volume}:/restore" \
    -v "$(dirname "$archive_file"):/archive:ro" \
    alpine:3.20 \
    sh -c "cd /restore && tar -xzf /archive/$(basename "$archive_file") && find /restore -maxdepth 2 -type f | head -50"
  run docker volume rm "$restore_volume"
}

remove_watchdog_tokens() {
  local slug="$1"
  local watchdog_tokens="$2"
  [[ -n "$watchdog_tokens" ]] || return 0
  log "Removing watchdog tokens for $slug from $WATCHDOG_ENV"
  local -a tokens=()
  [[ -z "$watchdog_tokens" ]] || IFS=';' read -r -a tokens <<< "$watchdog_tokens"
  local backup="${WATCHDOG_ENV}.dx2.${slug}.$(date -u +%Y%m%dT%H%M%SZ).bak"
  run sudo cp "$WATCHDOG_ENV" "$backup"
  for token in "${tokens[@]}"; do
    [[ -n "$token" ]] || continue
    run sudo env "DX2_TOKEN=${token}" perl -0pi -e 's/\Q$ENV{DX2_TOKEN}\E//g; s/ {2,}/ /g' "$WATCHDOG_ENV"
    if [[ "$DRY_RUN" != "1" ]] && sudo grep -Fq -- "$token" "$WATCHDOG_ENV"; then
      echo "Watchdog token removal failed for $slug: $token remains." >&2
      exit 2
    fi
  done
  run sudo systemctl start zenod-watchdog.service
}

stop_dokploy_record() {
  local kind="$1"
  local id="$2"
  [[ -n "$id" ]] || return 0
  case "$kind" in
    compose) dokploy_post "/compose.stop" "{\"composeId\":\"${id}\"}" ;;
    application) dokploy_post "/application.stop" "{\"applicationId\":\"${id}\"}" ;;
    record-only) log "Record-only row $id has no running app to stop." ;;
    *) echo "Unknown dokploy kind '$kind'." >&2; exit 2 ;;
  esac
}

delete_domains() {
  local domain_ids="$1"
  [[ -n "$domain_ids" ]] || return 0
  local -a ids=()
  [[ -z "$domain_ids" ]] || IFS=';' read -r -a ids <<< "$domain_ids"
  for domain_id in "${ids[@]}"; do
    [[ -n "$domain_id" ]] || continue
    dokploy_post "/domain.delete" "{\"domainId\":\"${domain_id}\"}"
  done
}

delete_dokploy_record() {
  local kind="$1"
  local id="$2"
  [[ -n "$id" ]] || return 0
  case "$kind" in
    compose) dokploy_post "/compose.delete" "{\"composeId\":\"${id}\",\"deleteVolumes\":false}" ;;
    application) dokploy_post "/application.delete" "{\"applicationId\":\"${id}\"}" ;;
    record-only) dokploy_post "/compose.delete" "{\"composeId\":\"${id}\",\"deleteVolumes\":false}" ;;
    *) echo "Unknown dokploy kind '$kind'." >&2; exit 2 ;;
  esac
}

remove_leftover_containers() {
  local container_names="$1"
  [[ -n "$container_names" ]] || return 0
  local -a containers=()
  [[ -z "$container_names" ]] || IFS=';' read -r -a containers <<< "$container_names"
  for container in "${containers[@]}"; do
    [[ -n "$container" ]] || continue
    run docker rm --force "$container"
  done
}

remove_archived_volumes() {
  local slug="$1"
  local volume_names="$2"
  [[ -n "$volume_names" ]] || return 0
  local -a volumes=()
  [[ -z "$volume_names" ]] || IFS=';' read -r -a volumes <<< "$volume_names"
  for volume in "${volumes[@]}"; do
    [[ -n "$volume" ]] || continue
    if [[ "$DRY_RUN" != "1" ]]; then
      local archive_file
      archive_file="$(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name "${slug}__volume-${volume}__*.tgz" | sort | tail -n 1)"
      [[ -n "$archive_file" ]] || { echo "Refusing to remove $volume: no matching archive." >&2; exit 2; }
      grep -F -- "$archive_file" "$CHECKSUMS_FILE" | tail -n 1 | sha256sum -c -
    fi
    run docker volume rm "$volume"
  done
}

validate_candidate() {
  local slug="$1"
  local classification="$2"
  local kind="$3"
  local dokploy_id="$4"
  local domain_ids="$5"
  local container_names="$6"
  local volume_names="$7"
  local bind_paths="$8"
  local watchdog_tokens="$9"
  local endpoint_expectation="${10}"

  assert_safe_classification "$slug" "$classification"
  [[ "$kind" == "compose" || "$kind" == "application" || "$kind" == "record-only" ]] || {
    echo "Refusing $slug: unsupported kind '$kind'." >&2
    exit 2
  }
  [[ -n "$dokploy_id" ]] || { echo "Refusing $slug: dokploy_id is required." >&2; exit 2; }

  log "Reconciling $slug ($classification, $kind, $dokploy_id) against live read-only state"
  capture_candidate_manifest "$slug" "$kind" "$dokploy_id" "$domain_ids" "$container_names" "$volume_names"
  validate_live_candidate "$slug" "$kind" "$dokploy_id" "$domain_ids" "$container_names" "$volume_names" "$watchdog_tokens" "$endpoint_expectation"
}

prepare_candidate() {
  local slug="$1"
  local classification="$2"
  local kind="$3"
  local dokploy_id="$4"
  local container_names="$5"
  local volume_names="$6"
  local bind_paths="$7"
  local watchdog_tokens="$8"

  log "Preparing $slug ($classification, $kind, $dokploy_id)"
  remove_watchdog_tokens "$slug" "$watchdog_tokens"
  stop_dokploy_record "$kind" "$dokploy_id"
  if [[ "$kind" == "compose" || "$kind" == "application" ]]; then
    PREPARED_KINDS+=("$kind")
    PREPARED_IDS+=("$dokploy_id")
  fi

  local -a volumes=()
  if [[ -n "$volume_names" ]]; then
    IFS=';' read -r -a volumes <<< "$volume_names"
    for volume in "${volumes[@]}"; do
      [[ -n "$volume" ]] || continue
      archive_named_volume "$slug" "$volume"
    done
  fi

  local -a binds=()
  if [[ -n "$bind_paths" ]]; then
    IFS=';' read -r -a binds <<< "$bind_paths"
    for bind_path in "${binds[@]}"; do
      [[ -n "$bind_path" ]] || continue
      archive_bind_path "$slug" "$bind_path"
    done
  fi

}

probe_post_endpoint() {
  local slug="$1"
  local id="$2"
  local expectation="$3"
  local row_dir="$EVIDENCE_DIR/${slug}__${id}"
  local manifest="$row_dir/compose.one.json"
  [[ -f "$manifest" ]] || manifest="$row_dir/application.one.json"
  local path="/api/health"
  [[ "$slug" == callisthenes-* ]] && path="/connect"

  while read -r host; do
    [[ -n "$host" ]] || continue
    if [[ "$DRY_RUN" == "1" ]]; then
      printf 'DRY_RUN: verify https://%s%s is %s\n' "$host" "$path" "$expectation"
      continue
    fi
    local code
    code="$(curl -L -sS -o /dev/null --max-time 20 -w '%{http_code}' "https://${host}${path}" || true)"
    printf '%s %s %s\n' "$host" "$expectation" "$code" >> "$EVIDENCE_DIR/post-endpoint-status.txt"
    if [[ "$expectation" == "unrouted" && "$code" =~ ^[23] ]]; then
      echo "Post-removal endpoint is still routed for $slug: https://${host}${path} returned $code." >&2
      exit 2
    fi
    if [[ "$expectation" == "still-routed" && ! "$code" =~ ^[23] ]]; then
      echo "Shared endpoint unexpectedly stopped routing for $slug: https://${host}${path} returned $code." >&2
      exit 2
    fi
  done < <(jq -r '.domains[].host' "$manifest")
}

retire_candidate() {
  local slug="$1"
  local classification="$2"
  local kind="$3"
  local dokploy_id="$4"
  local domain_ids="$5"
  local container_names="$6"
  local volume_names="$7"

  assert_safe_classification "$slug" "$classification"
  log "Retiring $slug ($classification, $kind, $dokploy_id)"

  delete_domains "$domain_ids"
  delete_dokploy_record "$kind" "$dokploy_id"
  remove_leftover_containers "$container_names"
  remove_archived_volumes "$slug" "$volume_names"
}

main() {
  require_execute_guard
  require_inputs
  capture_preflight
  trap 'rollback_predelete $?' ERR
  trap 'rollback_predelete 130' INT TERM

  # CSV columns:
  # slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,endpoint_expectation,notes
  log "Phase 0/3: reconcile every approved identifier against live read-only state"
  while IFS=, read -r slug classification kind dokploy_id domain_ids container_names volume_names bind_paths watchdog_tokens endpoint_expectation _notes; do
    [[ -n "${slug:-}" ]] || continue
    validate_candidate "$slug" "$classification" "$kind" "$dokploy_id" "$domain_ids" "$container_names" "$volume_names" "$bind_paths" "$watchdog_tokens" "$endpoint_expectation"
  done < <(tail -n +2 "$CANDIDATES_CSV")

  log "Phase 1/3: stop records and archive data"
  PREPARE_STARTED=1
  while IFS=, read -r slug classification kind dokploy_id _domain_ids container_names volume_names bind_paths watchdog_tokens _endpoint_expectation _notes; do
    [[ -n "${slug:-}" ]] || continue
    prepare_candidate "$slug" "$classification" "$kind" "$dokploy_id" "$container_names" "$volume_names" "$bind_paths" "$watchdog_tokens"
  done < <(tail -n +2 "$CANDIDATES_CSV")

  log "Phase 2/3: prove one archive restores before any deletion"
  [[ -n "$FIRST_ARCHIVE" ]] || { echo "Refusing batch: no volume or bind archive is available for the required restore drill." >&2; exit 2; }
  restore_drill_archive "batch" "$FIRST_ARCHIVE"

  log "Phase 3/3: remove approved domains, records, containers, and archived volumes"
  DELETION_STARTED=1
  while IFS=, read -r slug classification kind dokploy_id domain_ids container_names volume_names _bind_paths _watchdog_tokens _endpoint_expectation _notes; do
    [[ -n "${slug:-}" ]] || continue
    retire_candidate "$slug" "$classification" "$kind" "$dokploy_id" "$domain_ids" "$container_names" "$volume_names"
  done < <(tail -n +2 "$CANDIDATES_CSV")

  log "Post-removal checks"
  read_to_file "$EVIDENCE_DIR/docker-ps-a.after.jsonl" docker ps -a --format '{{json .}}'
  read_to_file "$EVIDENCE_DIR/docker-volume-ls.after.txt" docker volume ls
  read_to_file "$EVIDENCE_DIR/docker-stats.after.jsonl" docker stats --no-stream --format '{{json .}}'
  dokploy_get_to_file "/project.all" "$EVIDENCE_DIR/dokploy-project-all.after.json"
  read_to_file "$EVIDENCE_DIR/zenod-watchdog.env.after" sudo cat "$WATCHDOG_ENV"
  read_to_file "$EVIDENCE_DIR/watchdog-timer.after.txt" sudo systemctl status zenod-watchdog.timer --no-pager

  while IFS=, read -r slug _classification _kind dokploy_id _domain_ids _container_names _volume_names _bind_paths _watchdog_tokens endpoint_expectation _notes; do
    [[ -n "${slug:-}" ]] || continue
    probe_post_endpoint "$slug" "$dokploy_id" "$endpoint_expectation"
  done < <(tail -n +2 "$CANDIDATES_CSV")

  trap - ERR INT TERM
}

main "$@"
