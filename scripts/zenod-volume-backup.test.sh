#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
export MOCK_ARCHIVE_DIR=
export MOCK_CALL_LOG=
export MOCK_VERIFY_RESOLVES=1
export MOCK_VERIFY_FAILS=0
export MOCK_ARCHIVE_FAILS=0
export MOCK_MOUNTED_VOLUME=zenod-mt-data
export MOCK_REPLICAS=1
export MOCK_DELTA_FAILS=0

docker() {
  printf '%s\n' "$*" >>"$MOCK_CALL_LOG"
  case "$1" in
    inspect)
      if [[ "${2:-}" == "--format" ]]; then
        case "$3" in
          *'.Mounts'*) printf '%s\n' "$MOCK_MOUNTED_VOLUME" ;;
          *'.Config.Image'*) printf '%s\n' 'ghcr.io/zenod-ai/zenod:sha-test' ;;
          *'com.docker.swarm.service.name'*) printf '%s\n' 'zenod-mt-service' ;;
          *'.State.Running'*) printf '%s\n' 'true' ;;
          *'.State.Paused'*) printf '%s\n' 'true' ;;
        esac
      fi
      ;;
    image)
      [[ "$2" == "inspect" ]]
      [[ "$MOCK_VERIFY_RESOLVES" == "1" ]]
      ;;
    volume)
      [[ "$2" != "create" ]] || printf '%s\n' "$3"
      ;;
    service)
      case "$2" in
        inspect) printf '%s\n' "$MOCK_REPLICAS" ;;
        ps) : ;;
        scale) : ;;
      esac
      ;;
    run)
      if [[ "$*" =~ tar\ -czf\ /archive/([^[:space:]]+) ]]; then
        mkdir -p "$MOCK_ARCHIVE_DIR"
        /usr/bin/tar -czf "$MOCK_ARCHIVE_DIR/${BASH_REMATCH[1]}" --files-from /dev/null
        [[ "$MOCK_ARCHIVE_FAILS" == "0" ]] || return 1
      fi
      if [[ "$*" == *'verify-zenod-data.mjs'* && "$MOCK_VERIFY_FAILS" == "1" ]]; then
        return 1
      fi
      ;;
    exec)
      case "$*" in
        *'zenod-live-snapshot.mjs full'*) printf '%s\n' '{"command":"full","started_ms":1700000000000}' ;;
        *'zenod-live-snapshot.mjs delta'*)
          # fail the paused pass (the one after the catch-up pass)
          [[ "$MOCK_DELTA_FAILS" == "0" || "$*" != *" 1700000000500" ]] || return 1
          printf '%s\n' '{"command":"delta","copied":3,"started_ms":1700000000500}'
          ;;
        *'zenod-live-snapshot.mjs repair'*) printf '%s\n' '{"command":"repair","copied":0}' ;;
        *'tar -czf /archive/'*)
          [[ "$*" =~ tar\ -czf\ /archive/([^[:space:]]+) ]]
          mkdir -p "$MOCK_ARCHIVE_DIR"
          /usr/bin/tar -czf "$MOCK_ARCHIVE_DIR/${BASH_REMATCH[1]}" --files-from /dev/null
          [[ "$MOCK_ARCHIVE_FAILS" == "0" ]] || return 1
          ;;
      esac
      ;;
    pause|unpause|start|stop|rm) : ;;
  esac
}

curl() { return 0; }
export -f docker curl

new_case() {
  local name=$1
  MOCK_ARCHIVE_DIR="$test_root/$name/backups"
  MOCK_CALL_LOG="$test_root/$name/docker.log"
  MOCK_VERIFY_RESOLVES=1
  MOCK_VERIFY_FAILS=0
  MOCK_ARCHIVE_FAILS=0
  MOCK_MOUNTED_VOLUME=zenod-mt-data
  MOCK_REPLICAS=1
  MOCK_DELTA_FAILS=0
  export MOCK_ARCHIVE_DIR MOCK_CALL_LOG MOCK_VERIFY_RESOLVES MOCK_VERIFY_FAILS MOCK_ARCHIVE_FAILS MOCK_MOUNTED_VOLUME MOCK_REPLICAS MOCK_DELTA_FAILS
  mkdir -p "$(dirname "$MOCK_CALL_LOG")"
  : >"$MOCK_CALL_LOG"
}

line_number() {
  grep -n -- "$1" "$MOCK_CALL_LOG" | head -n 1 | cut -d: -f1
}

assert_private_file() {
  local path=$1 mode
  if mode=$(stat -c '%a' "$path" 2>/dev/null); then
    :
  else
    mode=$(stat -f '%Lp' "$path")
  fi
  [[ "$mode" == "600" ]] || {
    echo "$path must have mode 0600, got $mode" >&2
    exit 1
  }
}

new_case cold
output=$(ZENOD_BACKUP_MODE=cold ZENOD_HEALTH_URL=https://cloud.zenod.dev/healthz \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR")

grep -q '^quiesced=zenod-mt-service$' <<<"$output"
grep -q '^pause zenod-task-container$' "$MOCK_CALL_LOG"
grep -q '^unpause zenod-task-container$' "$MOCK_CALL_LOG"
if grep -q '^stop ' "$MOCK_CALL_LOG"; then
  echo 'Swarm backup must not stop an individual task container' >&2
  exit 1
fi

inspect_line=$(line_number '^image inspect ghcr.io/zenod-ai/zenod:sha-test$')
down_line=$(line_number '^pause zenod-task-container$')
archive_line=$(line_number 'tar -czf /archive/')
up_line=$(line_number '^unpause zenod-task-container$')
verify_line=$(line_number 'verify-zenod-data.mjs')
[[ "$inspect_line" -lt "$down_line" && "$down_line" -lt "$archive_line" && "$archive_line" -lt "$up_line" && "$up_line" -lt "$verify_line" ]]
grep -Eq -- '--volume zenod-restore-[^ ]+:/data ghcr.io/zenod-ai/zenod:sha-test node /app/scripts/verify-zenod-data.mjs' "$MOCK_CALL_LOG"
if grep -Eq -- '--volume zenod-restore-[^ ]+:/data:ro .*verify-zenod-data.mjs' "$MOCK_CALL_LOG"; then
  echo 'SQLite restore verification needs a writable disposable volume for WAL sidecars' >&2
  exit 1
fi
archive_path=$(sed -n 's/^backup=//p' <<<"$output")
checksum_path=$(sed -n 's/^checksum=//p' <<<"$output")
assert_private_file "$archive_path"
assert_private_file "$checksum_path"

new_case pinned
pinned_image='ghcr.io/zenod-ai/zenod@sha256:verifier'
output=$(ZENOD_BACKUP_MODE=cold ZENOD_VERIFY_IMAGE="$pinned_image" \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR")

inspect_line=$(line_number "^image inspect $pinned_image$")
down_line=$(line_number '^pause zenod-task-container$')
up_line=$(line_number '^unpause zenod-task-container$')
verify_line=$(line_number "--volume zenod-restore-[^ ]*:/data $pinned_image node /app/scripts/verify-zenod-data.mjs")
[[ "$inspect_line" -lt "$down_line" && "$down_line" -lt "$up_line" && "$up_line" -lt "$verify_line" ]]
[[ "$(grep -c "^run .*$pinned_image" "$MOCK_CALL_LOG")" == "1" ]]
grep -Eq -- '^run .*--volume zenod-mt-data:/source:ro .*ghcr.io/zenod-ai/zenod:sha-test sh -c .*tar -czf' "$MOCK_CALL_LOG"
grep -Eq -- '^run .*--volume zenod-restore-[^ ]+:/restore .*ghcr.io/zenod-ai/zenod:sha-test sh -c .*tar -xzf' "$MOCK_CALL_LOG"
if grep -Eq -- '--volume zenod-mt-data:/(source|data)( |$)' "$MOCK_CALL_LOG"; then
  echo 'The live source volume must only be mounted read-only' >&2
  exit 1
fi

new_case wrong_mount
MOCK_MOUNTED_VOLUME=unexpected-volume
export MOCK_MOUNTED_VOLUME
if bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/wrong-mount.out" 2>"$test_root/wrong-mount.err"; then
  echo 'Mismatched /data volume must fail' >&2
  exit 1
fi
grep -q '^Refusing backup: zenod-task-container does not mount zenod-mt-data at /data$' "$test_root/wrong-mount.err"
if grep -Eq '^(pause|stop|run) ' "$MOCK_CALL_LOG"; then
  echo 'Mount refusal must happen before quiescence or backup work' >&2
  exit 1
fi

new_case multiple_replicas
MOCK_REPLICAS=2
export MOCK_REPLICAS
if bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/multiple-replicas.out" 2>"$test_root/multiple-replicas.err"; then
  echo 'Multi-replica Swarm service must fail' >&2
  exit 1
fi
grep -q '^Refusing backup: Swarm service zenod-mt-service must have exactly one replica$' "$test_root/multiple-replicas.err"
if grep -Eq '^(pause|stop|run) ' "$MOCK_CALL_LOG"; then
  echo 'Replica refusal must happen before quiescence or backup work' >&2
  exit 1
fi

new_case unresolved
MOCK_VERIFY_RESOLVES=0
export MOCK_VERIFY_RESOLVES
if ZENOD_VERIFY_IMAGE='ghcr.io/zenod-ai/zenod@sha256:missing' \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/unresolved.out" 2>"$test_root/unresolved.err"; then
  echo 'Unresolvable verifier image must fail' >&2
  exit 1
fi
grep -q '^Cannot resolve the verifier image$' "$test_root/unresolved.err"
if grep -Eq '^(pause|stop) ' "$MOCK_CALL_LOG"; then
  echo 'Verifier resolution failure must happen before quiescence' >&2
  exit 1
fi

new_case archive_failure
MOCK_ARCHIVE_FAILS=1
export MOCK_ARCHIVE_FAILS
if ZENOD_BACKUP_MODE=cold bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/archive-failure.out" 2>"$test_root/archive-failure.err"; then
  echo 'Archive failure must fail the backup command' >&2
  exit 1
fi
grep -q '^pause zenod-task-container$' "$MOCK_CALL_LOG"
[[ "$(grep -c '^unpause zenod-task-container$' "$MOCK_CALL_LOG")" == "1" ]]
if grep -Eq '^volume (create|rm) ' "$MOCK_CALL_LOG"; then
  echo 'Archive failure must not create or remove any volume' >&2
  exit 1
fi
if find "$MOCK_ARCHIVE_DIR" -type f -print -quit | grep -q '^'; then
  echo 'Archive failure must remove only its partial archive' >&2
  exit 1
fi

new_case verify_failure
MOCK_VERIFY_FAILS=1
export MOCK_VERIFY_FAILS
if ZENOD_BACKUP_MODE=cold ZENOD_VERIFY_IMAGE="$pinned_image" \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/verify-failure.out" 2>"$test_root/verify-failure.err"; then
  echo 'Verifier failure must fail the backup command' >&2
  exit 1
fi
up_line=$(line_number '^unpause zenod-task-container$')
verify_line=$(line_number 'verify-zenod-data.mjs')
remove_line=$(line_number '^volume rm zenod-restore-')
[[ "$up_line" -lt "$verify_line" && "$verify_line" -lt "$remove_line" ]]
[[ "$(grep -c '^unpause zenod-task-container$' "$MOCK_CALL_LOG")" == "1" ]]
if grep -Eq '^volume rm (zenod-mt-data|phylax-data)$' "$MOCK_CALL_LOG"; then
  echo 'Failure cleanup must never remove a live volume' >&2
  exit 1
fi
find "$MOCK_ARCHIVE_DIR" -name '*.partial' -print -quit | grep -q '^' && {
  echo 'Failure cleanup must remove partial archives' >&2
  exit 1
}
archive_path=$(find "$MOCK_ARCHIVE_DIR" -name '*.tar.gz' -print -quit)
[[ -n "$archive_path" && -f "${archive_path}.sha256" ]]
assert_private_file "$archive_path"
assert_private_file "${archive_path}.sha256"

new_case live
output=$(ZENOD_VERIFY_IMAGE="$pinned_image" ZENOD_HEALTH_URL=https://phylax.zenod.dev/healthz \
  bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR")

grep -q '^mode=live$' <<<"$output"
grep -Eq '^paused_ms=[0-9]+$' <<<"$output"
helper_line=$(line_number '^run --detach --name zenod-backup-snapshot-')
full_line=$(line_number 'zenod-live-snapshot.mjs full /source')
down_line=$(line_number '^pause zenod-task-container$')
catchup_line=$(line_number 'zenod-live-snapshot.mjs delta /source .* 1700000000000$')
delta_line=$(line_number 'zenod-live-snapshot.mjs delta /source .* 1700000000500$')
up_line=$(line_number '^unpause zenod-task-container$')
repair_line=$(line_number 'zenod-live-snapshot.mjs repair /source')
archive_line=$(line_number 'tar -czf /archive/')
helper_rm_line=$(line_number '^rm -f zenod-backup-snapshot-')
verify_line=$(line_number 'verify-zenod-data.mjs')
[[ "$helper_line" -lt "$full_line" && "$full_line" -lt "$catchup_line" && "$catchup_line" -lt "$down_line" && "$down_line" -lt "$delta_line" \
  && "$delta_line" -lt "$up_line" && "$up_line" -lt "$repair_line" && "$repair_line" -lt "$archive_line" && "$archive_line" -lt "$helper_rm_line" \
  && "$helper_rm_line" -lt "$verify_line" ]] || {
  echo 'Live backup must copy, pause only for the delta pass, then archive and verify' >&2
  exit 1
}
[[ "$(grep -c '^pause ' "$MOCK_CALL_LOG")" == "1" && "$(grep -c '^unpause ' "$MOCK_CALL_LOG")" == "1" ]]
if grep -q '^stop ' "$MOCK_CALL_LOG"; then
  echo 'Live backup must never stop the workload' >&2
  exit 1
fi
grep -Eq -- "^run --detach --name zenod-backup-snapshot-[^ ]+ --network none --user 0 --volume zenod-mt-data:/source --volume $MOCK_ARCHIVE_DIR:/archive .*--entrypoint sleep $pinned_image infinity$" "$MOCK_CALL_LOG"
[[ "$(grep -c 'zenod-mt-data:/source' "$MOCK_CALL_LOG")" == "1" ]] || {
  echo 'Only the snapshot helper may mount the live volume' >&2
  exit 1
}
if find "$MOCK_ARCHIVE_DIR" -name '.snapshot-*' -print -quit | grep -q '^'; then
  echo 'Live backup must remove its staging snapshot' >&2
  exit 1
fi
archive_path=$(sed -n 's/^backup=//p' <<<"$output")
assert_private_file "$archive_path"
assert_private_file "$(sed -n 's/^checksum=//p' <<<"$output")"

new_case live_delta_failure
MOCK_DELTA_FAILS=1
export MOCK_DELTA_FAILS
if bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" \
  >"$test_root/live-delta-failure.out" 2>"$test_root/live-delta-failure.err"; then
  echo 'Live delta failure must fail the backup command' >&2
  exit 1
fi
[[ "$(grep -c '^unpause zenod-task-container$' "$MOCK_CALL_LOG")" == "1" ]]
grep -q '^rm -f zenod-backup-snapshot-' "$MOCK_CALL_LOG"
if find "$MOCK_ARCHIVE_DIR" -mindepth 1 -print -quit | grep -q '^'; then
  echo 'Live delta failure must leave no snapshot or archive behind' >&2
  exit 1
fi

new_case bad_mode
if ZENOD_BACKUP_MODE=warm bash "$repo_root/scripts/zenod-volume-backup.sh" \
  zenod-task-container zenod-mt-data "$MOCK_ARCHIVE_DIR" >/dev/null 2>&1; then
  echo 'Unknown backup mode must fail' >&2
  exit 1
fi
[[ ! -s "$MOCK_CALL_LOG" ]]

echo 'zenod-volume-backup verifier and Swarm safety tests passed'
