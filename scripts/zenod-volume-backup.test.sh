#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
export MOCK_ARCHIVE_DIR="$test_root/backups"
export MOCK_CALL_LOG="$test_root/docker.log"

docker() {
  printf '%s\n' "$*" >>"$MOCK_CALL_LOG"
  case "$1" in
    inspect)
      if [[ "${2:-}" == "--format" ]]; then
        case "$3" in
          *'.Mounts'*) printf '%s\n' 'zenod-mt-data' ;;
          *'.Config.Image'*) printf '%s\n' 'ghcr.io/zenod-ai/zenod:sha-test' ;;
          *'com.docker.swarm.service.name'*) printf '%s\n' 'zenod-mt-service' ;;
          *'.State.Running'*) printf '%s\n' 'true' ;;
          *'.State.Paused'*) printf '%s\n' 'true' ;;
        esac
      fi
      ;;
    volume)
      [[ "$2" != "create" ]] || printf '%s\n' "$3"
      ;;
    service)
      case "$2" in
        inspect) printf '%s\n' '1' ;;
        ps) : ;;
        scale) : ;;
      esac
      ;;
    run)
      if [[ "$*" =~ tar\ -czf\ /archive/([^[:space:]]+) ]]; then
        mkdir -p "$MOCK_ARCHIVE_DIR"
        /usr/bin/tar -czf "$MOCK_ARCHIVE_DIR/${BASH_REMATCH[1]}" --files-from /dev/null
      fi
      ;;
    pause|unpause|start|stop) : ;;
  esac
}

curl() { return 0; }
export -f docker curl

output=$(ZENOD_HEALTH_URL=https://cloud.zenod.dev/healthz \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR")

grep -q '^quiesced=zenod-mt-service$' <<<"$output"
grep -q '^pause zenod-task-container$' "$MOCK_CALL_LOG"
grep -q '^unpause zenod-task-container$' "$MOCK_CALL_LOG"
if grep -q '^stop ' "$MOCK_CALL_LOG"; then
  echo 'Swarm backup must not stop an individual task container' >&2
  exit 1
fi

down_line=$(grep -n '^pause zenod-task-container$' "$MOCK_CALL_LOG" | cut -d: -f1)
archive_line=$(grep -n 'tar -czf /archive/' "$MOCK_CALL_LOG" | cut -d: -f1)
up_line=$(grep -n '^unpause zenod-task-container$' "$MOCK_CALL_LOG" | cut -d: -f1)
verify_line=$(grep -n 'verify-zenod-data.mjs' "$MOCK_CALL_LOG" | cut -d: -f1)
[[ "$down_line" -lt "$archive_line" && "$archive_line" -lt "$up_line" && "$up_line" -lt "$verify_line" ]]
grep -Eq -- '--volume zenod-restore-[^ ]+:/data .*verify-zenod-data.mjs' "$MOCK_CALL_LOG"
if grep -Eq -- '--volume zenod-restore-[^ ]+:/data:ro .*verify-zenod-data.mjs' "$MOCK_CALL_LOG"; then
  echo 'SQLite restore verification needs a writable disposable volume for WAL sidecars' >&2
  exit 1
fi

echo 'zenod-volume-backup Swarm quiescence test passed'
