#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "Usage: $0 <container-name> <data-volume-name> <absolute-archive-directory>" >&2
  exit 2
}

[[ $# -eq 3 ]] || usage
container_name=$1
volume_name=$2
archive_dir=$3

[[ "$container_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || usage
[[ "$volume_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || usage
[[ "$archive_dir" == /* && "$archive_dir" != "/" ]] || usage
# live (default): copy while the workload runs (SQLite online backup), then pause
# it only for the seconds a final pass over the non-SQLite files takes.
# cold: pause (Swarm) or stop the workload for the whole archive, as before.
backup_mode=${ZENOD_BACKUP_MODE:-live}
[[ "$backup_mode" == "live" || "$backup_mode" == "cold" ]] || {
  echo "ZENOD_BACKUP_MODE must be live or cold" >&2
  exit 2
}
script_dir=$(cd "$(dirname "$0")" && pwd)
snapshot_script="${script_dir}/zenod-live-snapshot.mjs"
[[ "$backup_mode" == "cold" || -f "$snapshot_script" ]] || {
  echo "Missing $snapshot_script" >&2
  exit 2
}

docker inspect "$container_name" >/dev/null
docker volume inspect "$volume_name" >/dev/null
mounted_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container_name")
[[ "$mounted_volume" == "$volume_name" ]] || {
  echo "Refusing backup: $container_name does not mount $volume_name at /data" >&2
  exit 2
}

image_ref=$(docker inspect --format '{{.Config.Image}}' "$container_name")
[[ -n "$image_ref" ]] || { echo "Cannot resolve the container image" >&2; exit 2; }
verify_image=${ZENOD_VERIFY_IMAGE:-$image_ref}
docker image inspect "$verify_image" >/dev/null 2>&1 || {
  echo "Cannot resolve the verifier image" >&2
  exit 2
}
swarm_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$container_name")
[[ "$swarm_service" != "<no value>" ]] || swarm_service=""
service_replicas=""
if [[ -n "$swarm_service" ]]; then
  service_replicas=$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "$swarm_service")
  [[ "$service_replicas" == "1" ]] || {
    echo "Refusing backup: Swarm service $swarm_service must have exactly one replica" >&2
    exit 2
  }
fi
mkdir -p "$archive_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
archive_name="zenod-data-${timestamp}.tar.gz"
archive_path="${archive_dir}/${archive_name}"
pending_path="${archive_path}.partial"
restore_volume="zenod-restore-${timestamp}-$$"
was_running=$(docker inspect --format '{{.State.Running}}' "$container_name")
restore_created=0
workload_quiesced=0
snapshot_name=".snapshot-${timestamp}-$$"
snapshot_dir="${archive_dir}/${snapshot_name}"
helper_name="zenod-backup-snapshot-${timestamp}-$$"
helper_created=0
paused_ms=""

restore_workload() {
  if [[ "$workload_quiesced" == "1" && ( -n "$swarm_service" || "$backup_mode" == "live" ) ]]; then
    docker unpause "$container_name" >/dev/null 2>&1 || true
    workload_quiesced=0
  elif [[ "$workload_quiesced" == "1" && "$was_running" == "true" ]]; then
    docker start "$container_name" >/dev/null 2>&1 || true
    workload_quiesced=0
  fi
}

remove_snapshot() {
  if [[ "$helper_created" == "1" ]]; then
    docker exec "$helper_name" rm -rf "/archive/${snapshot_name}" "/archive/${snapshot_name}.sqlite-list" \
      >/dev/null 2>&1 || true
    docker rm -f "$helper_name" >/dev/null 2>&1 || true
    helper_created=0
  fi
  rm -rf -- "$snapshot_dir" "${snapshot_dir}.sqlite-list"
}

cleanup() {
  restore_workload
  remove_snapshot
  if [[ "$restore_created" == "1" ]]; then
    docker volume rm "$restore_volume" >/dev/null 2>&1 || true
  fi
  if [[ -f "$pending_path" ]]; then
    rm -f -- "$pending_path"
  fi
}
trap cleanup EXIT

now_ms() {
  local ns
  ns=$(date +%s%N)
  echo $((ns / 1000000))
}

pause_workload() {
  docker pause "$container_name" >/dev/null
  workload_quiesced=1
  [[ "$(docker inspect --format '{{.State.Paused}}' "$container_name")" == "true" ]] || {
    echo "Container $container_name did not pause" >&2
    exit 1
  }
}

if [[ "$backup_mode" == "live" ]]; then
  mkdir -m 0700 "$snapshot_dir"
  # The helper is the only container that mounts the live volume writable: a
  # read-only SQLite connection still needs the shared -shm lock file to read a
  # WAL database safely next to its writer. It never writes database content.
  docker run --detach --name "$helper_name" --network none --user 0 \
    --volume "${volume_name}:/source" \
    --volume "${archive_dir}:/archive" \
    --volume "${snapshot_script}:/opt/zenod-live-snapshot.mjs:ro" \
    --entrypoint sleep "$verify_image" infinity >/dev/null
  helper_created=1
  full_summary=$(docker exec "$helper_name" node /opt/zenod-live-snapshot.mjs \
    full /source "/archive/${snapshot_name}")
  echo "live pass: $full_summary" >&2
  since_ms=$(sed -n 's/.*"started_ms":\([0-9]*\).*/\1/p' <<<"$full_summary")
  [[ -n "$since_ms" ]] || { echo "Live pass did not report its start time" >&2; exit 1; }
  # Catch up on what changed during the (minutes-long) live pass while still
  # running, so the paused pass only covers the last few seconds.
  catchup_summary=$(docker exec "$helper_name" node /opt/zenod-live-snapshot.mjs \
    delta /source "/archive/${snapshot_name}" "$since_ms")
  echo "catch-up pass: $catchup_summary" >&2
  since_ms=$(sed -n 's/.*"started_ms":\([0-9]*\).*/\1/p' <<<"$catchup_summary")
  [[ -n "$since_ms" ]] || { echo "Catch-up pass did not report its start time" >&2; exit 1; }
  if [[ "$was_running" == "true" ]]; then
    pause_started=$(now_ms)
    pause_workload
  fi
  delta_summary=$(docker exec "$helper_name" node /opt/zenod-live-snapshot.mjs \
    delta /source "/archive/${snapshot_name}" "$since_ms")
  restore_workload
  [[ -z "${pause_started:-}" ]] || paused_ms=$(( $(now_ms) - pause_started ))
  echo "paused pass: $delta_summary paused_ms=${paused_ms:-0}" >&2
  repair_summary=$(docker exec "$helper_name" node /opt/zenod-live-snapshot.mjs \
    repair /source "/archive/${snapshot_name}")
  echo "repair pass: $repair_summary" >&2
  docker exec "$helper_name" sh -c \
    "cd /archive/${snapshot_name} && tar -czf /archive/${archive_name}.partial ."
  remove_snapshot
else
  if [[ -n "$swarm_service" ]]; then
    pause_started=$(now_ms)
    pause_workload
  elif [[ "$was_running" == "true" ]]; then
    pause_started=$(now_ms)
    docker stop --time 30 "$container_name" >/dev/null
    workload_quiesced=1
  fi
  docker run --rm \
    --volume "${volume_name}:/source:ro" \
    --volume "${archive_dir}:/archive" \
    "$image_ref" sh -c "cd /source && tar -czf /archive/${archive_name}.partial ."
fi
mv -- "$pending_path" "$archive_path"
chmod 0600 "$archive_path"
restore_workload
[[ -n "$paused_ms" || -z "${pause_started:-}" ]] || paused_ms=$(( $(now_ms) - pause_started ))
sha256sum "$archive_path" >"${archive_path}.sha256"
chmod 0600 "${archive_path}.sha256"
tar -tzf "$archive_path" >/dev/null

docker volume create "$restore_volume" >/dev/null
restore_created=1
docker run --rm \
  --volume "${restore_volume}:/restore" \
  --volume "${archive_dir}:/archive:ro" \
  "$image_ref" sh -c "cd /restore && tar -xzf /archive/${archive_name}"
# SQLite databases captured in WAL mode may need writable temporary -shm state
# during integrity_check. Only the disposable restore volume is writable here;
# the source archive remains mounted read-only above.
docker run --rm --volume "${restore_volume}:/data" "$verify_image" \
  node /app/scripts/verify-zenod-data.mjs /data

docker volume rm "$restore_volume" >/dev/null
restore_created=0
if [[ -n "${ZENOD_HEALTH_URL:-}" ]]; then
  healthy=0
  for _attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
      "$ZENOD_HEALTH_URL" >/dev/null; then
      healthy=1
      break
    fi
    sleep 1
  done
  [[ "$healthy" == "1" ]] || { echo "Restored workload did not become healthy" >&2; exit 1; }
fi

trap - EXIT
printf 'backup=%s\nchecksum=%s\nquiesced=%s\nmode=%s\npaused_ms=%s\nrestore_verified_at=%s\n' \
  "$archive_path" "${archive_path}.sha256" "${swarm_service:-$container_name}" \
  "$backup_mode" "${paused_ms:-0}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
