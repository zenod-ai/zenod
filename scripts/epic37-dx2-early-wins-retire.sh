#!/usr/bin/env bash
set -euo pipefail

# Epic 3.7 DX-2 early-wins retirement batch.
# Defaults to dry-run. Do not run with DRY_RUN=0 until Jordi has approved the
# archive target and the candidate CSV.

CANDIDATES_CSV="${CANDIDATES_CSV:-docs/EPIC-3.7-DX2-EARLY-WINS-CANDIDATES.csv}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/epic37-dx2-evidence-$(date -u +%Y%m%dT%H%M%SZ)}"
ARCHIVE_DIR="${ARCHIVE_DIR:-}"
DRY_RUN="${DRY_RUN:-1}"
RESTORE_DRILL="${RESTORE_DRILL:-0}"
JORDI_APPROVED_DX2="${JORDI_APPROVED_DX2:-0}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
WATCHDOG_ENV="${WATCHDOG_ENV:-/etc/zenod-watchdog.env}"

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

require_execute_guard() {
  if [[ "$DRY_RUN" != "1" && "$JORDI_APPROVED_DX2" != "1" ]]; then
    echo "Refusing destructive mode: set JORDI_APPROVED_DX2=1 only after Jordi approves archive target and candidate list." >&2
    exit 2
  fi
}

require_inputs() {
  [[ -f "$CANDIDATES_CSV" ]] || { echo "Missing candidate CSV: $CANDIDATES_CSV" >&2; exit 2; }
  [[ -n "$ARCHIVE_DIR" ]] || { echo "ARCHIVE_DIR is required." >&2; exit 2; }
  mkdir -p "$EVIDENCE_DIR"
  if [[ "$DRY_RUN" != "1" ]]; then
    mkdir -p "$ARCHIVE_DIR"
    [[ -n "$DOKPLOY_API_KEY" ]] || { echo "DOKPLOY_API_KEY is required. Run: eval \"\$(dokploy-env)\"" >&2; exit 2; }
  fi
}

dokploy_get() {
  local endpoint="$1"
  run curl -fsS -H "x-api-key: ${DOKPLOY_API_KEY}" "${DOKPLOY_API_BASE}${endpoint}"
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

capture_preflight() {
  log "Capturing read-only preflight evidence in $EVIDENCE_DIR"
  run docker ps -a --format '{{json .}}'
  run docker volume ls
  run docker network inspect dokploy-network
  dokploy_get "/project.all"
  if [[ -r "$WATCHDOG_ENV" ]]; then
    run cp "$WATCHDOG_ENV" "${EVIDENCE_DIR}/zenod-watchdog.env.before"
  else
    log "Watchdog env not readable at $WATCHDOG_ENV; operator must capture it with sudo."
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
  run sha256sum "$out"
}

archive_bind_path() {
  local slug="$1"
  local bind_path="$2"
  local safe_name
  safe_name="$(printf '%s' "$bind_path" | tr '/ ' '__')"
  local out="${ARCHIVE_DIR}/${slug}__bind-${safe_name}__$(date -u +%Y%m%dT%H%M%SZ).tgz"
  log "Archiving bind path $bind_path to $out"
  run sudo tar --one-file-system --numeric-owner -C "$bind_path" -czf "$out" .
  run sha256sum "$out"
}

restore_drill_archive() {
  local slug="$1"
  local archive_file="$2"
  local restore_volume="dx2-restore-${slug}-$(date -u +%Y%m%d%H%M%S)"
  log "Restore drill for $archive_file into temporary volume $restore_volume"
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
  IFS=';' read -r -a tokens <<< "$watchdog_tokens"
  for token in "${tokens[@]}"; do
    [[ -n "$token" ]] || continue
    run sudo cp "$WATCHDOG_ENV" "${WATCHDOG_ENV}.dx2.${slug}.$(date -u +%Y%m%dT%H%M%SZ).bak"
    run sudo perl -0pi -e "s/(^ZENOD_WATCHDOG_CONTAINERS=.*)\\b\\Q${token}\\E\\b\\s*/\$1/m; s/(^ZENOD_WATCHDOG_HEALTH_URLS=.*)\\b\\Q${token}\\E\\b\\s*/\$1/m" "$WATCHDOG_ENV"
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
  IFS=';' read -r -a ids <<< "$domain_ids"
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
  IFS=';' read -r -a containers <<< "$container_names"
  for container in "${containers[@]}"; do
    [[ -n "$container" ]] || continue
    run docker rm --force "$container"
  done
}

remove_archived_volumes() {
  local volume_names="$1"
  [[ -n "$volume_names" ]] || return 0
  IFS=';' read -r -a volumes <<< "$volume_names"
  for volume in "${volumes[@]}"; do
    [[ -n "$volume" ]] || continue
    run docker volume rm "$volume"
  done
}

process_candidate() {
  local slug="$1"
  local classification="$2"
  local kind="$3"
  local dokploy_id="$4"
  local domain_ids="$5"
  local container_names="$6"
  local volume_names="$7"
  local bind_paths="$8"
  local watchdog_tokens="$9"

  assert_safe_classification "$slug" "$classification"

  log "Processing $slug ($classification, $kind, $dokploy_id)"
  remove_watchdog_tokens "$slug" "$watchdog_tokens"
  stop_dokploy_record "$kind" "$dokploy_id"

  IFS=';' read -r -a volumes <<< "$volume_names"
  for volume in "${volumes[@]}"; do
    [[ -n "$volume" ]] || continue
    archive_named_volume "$slug" "$volume"
  done

  IFS=';' read -r -a binds <<< "$bind_paths"
  for bind_path in "${binds[@]}"; do
    [[ -n "$bind_path" ]] || continue
    archive_bind_path "$slug" "$bind_path"
  done

  if [[ "$RESTORE_DRILL" == "1" ]]; then
    local first_archive
    first_archive="$(find "$ARCHIVE_DIR" -maxdepth 1 -type f -name "${slug}__*.tgz" | sort | head -n 1 || true)"
    [[ -n "$first_archive" ]] && restore_drill_archive "$slug" "$first_archive"
  fi

  delete_domains "$domain_ids"
  delete_dokploy_record "$kind" "$dokploy_id"
  remove_leftover_containers "$container_names"
  remove_archived_volumes "$volume_names"
}

main() {
  require_execute_guard
  require_inputs
  capture_preflight

  # CSV columns:
  # slug,classification,kind,dokploy_id,domain_ids,container_names,volume_names,bind_paths,watchdog_tokens,notes
  tail -n +2 "$CANDIDATES_CSV" | while IFS=, read -r slug classification kind dokploy_id domain_ids container_names volume_names bind_paths watchdog_tokens _notes; do
    [[ -n "${slug:-}" ]] || continue
    process_candidate "$slug" "$classification" "$kind" "$dokploy_id" "$domain_ids" "$container_names" "$volume_names" "$bind_paths" "$watchdog_tokens"
  done

  log "Post-removal checks"
  run docker ps -a --format '{{json .}}'
  run docker volume ls
  dokploy_get "/project.all"
  run sudo systemctl status zenod-watchdog.timer --no-pager
}

main "$@"
