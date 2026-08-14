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

docker inspect "$container_name" >/dev/null
docker volume inspect "$volume_name" >/dev/null
mounted_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container_name")
[[ "$mounted_volume" == "$volume_name" ]] || {
  echo "Refusing backup: $container_name does not mount $volume_name at /data" >&2
  exit 2
}

image_ref=$(docker inspect --format '{{.Config.Image}}' "$container_name")
[[ -n "$image_ref" ]] || { echo "Cannot resolve the container image" >&2; exit 2; }
mkdir -p "$archive_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
archive_name="zenod-data-${timestamp}.tar.gz"
archive_path="${archive_dir}/${archive_name}"
pending_path="${archive_path}.partial"
restore_volume="zenod-restore-${timestamp,,}-$$"
was_running=$(docker inspect --format '{{.State.Running}}' "$container_name")
restore_created=0

cleanup() {
  if [[ "$restore_created" == "1" ]]; then
    docker volume rm "$restore_volume" >/dev/null 2>&1 || true
  fi
  if [[ "$was_running" == "true" ]]; then
    docker start "$container_name" >/dev/null 2>&1 || true
  fi
  if [[ -f "$pending_path" ]]; then
    rm -f -- "$pending_path"
  fi
}
trap cleanup EXIT

if [[ "$was_running" == "true" ]]; then
  docker stop --time 30 "$container_name" >/dev/null
fi

docker run --rm \
  --volume "${volume_name}:/source:ro" \
  --volume "${archive_dir}:/archive" \
  "$image_ref" sh -c "cd /source && tar -czf /archive/${archive_name}.partial ."
mv -- "$pending_path" "$archive_path"
sha256sum "$archive_path" >"${archive_path}.sha256"
tar -tzf "$archive_path" >/dev/null

docker volume create "$restore_volume" >/dev/null
restore_created=1
docker run --rm \
  --volume "${restore_volume}:/restore" \
  --volume "${archive_dir}:/archive:ro" \
  "$image_ref" sh -c "cd /restore && tar -xzf /archive/${archive_name}"
docker run --rm --volume "${restore_volume}:/data:ro" "$image_ref" \
  node /app/scripts/verify-zenod-data.mjs /data

docker volume rm "$restore_volume" >/dev/null
restore_created=0
if [[ "$was_running" == "true" ]]; then
  docker start "$container_name" >/dev/null
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
    [[ "$healthy" == "1" ]] || { echo "Restored container did not become healthy" >&2; exit 1; }
  fi
fi

trap - EXIT
printf 'backup=%s\nchecksum=%s\nrestore_verified_at=%s\n' \
  "$archive_path" "${archive_path}.sha256" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
