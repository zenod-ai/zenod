#!/usr/bin/env bash
set -eEuo pipefail

# Roll the GHCR-image Dokploy fleet forward to a freshly published immutable sha.
#
# Why this exists
# ---------------
# publish.yml builds ghcr.io/zenod-ai/zenod:{latest,sha-<short>} on every push to
# main, but the hosted "docker" source apps (zenod-mt, ring, herald, …) are pinned
# to an *immutable* sha- tag. Dokploy's autoDeploy for a docker-source app only
# fires on a registry webhook for that exact tag, and an immutable sha tag never
# receives a new push — so nothing ever advances the pin. The pin was advanced by
# hand. This script closes the loop: main merge → build image → re-pin + deploy.
#
# It targets every application in the Dokploy "zenod" project whose dockerImage is
# `ghcr.io/zenod-ai/zenod:sha-*` (auto-discovered, so new agents join the fleet
# without editing this script). Pins stay immutable, so rollback is just re-pinning
# the previous sha.
#
# Usage:
#   IMAGE=ghcr.io/zenod-ai/zenod:sha-<short> \
#   DOKPLOY_API_BASE=https://dokploy.polyqu.com/api DOKPLOY_API_KEY=... \
#   scripts/deploy-fleet.sh
#
# Env:
#   IMAGE               required — the immutable image every fleet app is pinned to
#   DOKPLOY_API_BASE    required — e.g. https://dokploy.polyqu.com/api
#   DOKPLOY_API_KEY     required — Dokploy API key; if empty the script SKIPS (exit 0)
#   DOKPLOY_PROJECT     optional — project name to scan (default: zenod)
#   IMAGE_PREFIX        optional — pin pattern to match (default: ghcr.io/zenod-ai/zenod:sha-)
#   HEALTH_TIMEOUT_SECONDS  optional — per-app deploy wait (default 300)

IMAGE="${IMAGE:-}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
DOKPLOY_PROJECT="${DOKPLOY_PROJECT:-zenod}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/zenod-ai/zenod:sha-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"

log() { printf '[deploy-fleet] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

# Skip cleanly when the deploy credential is not configured, so the workflow that
# calls this can be merged before the secret exists without failing CI.
if [[ -z "$DOKPLOY_API_KEY" ]]; then
  log "DOKPLOY_API_KEY is empty — skipping fleet roll (configure the secret to enable)."
  exit 0
fi

[[ -n "$IMAGE" ]] || die "IMAGE is required (e.g. ghcr.io/zenod-ai/zenod:sha-abc1234)"
[[ "$IMAGE" =~ ^ghcr\.io/zenod-ai/zenod:sha-[0-9a-f]{7,40}$ ]] || die "IMAGE must be an immutable sha- tag, got: $IMAGE"
[[ -n "$DOKPLOY_API_BASE" ]] || die "DOKPLOY_API_BASE is required"

api_get() { curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/$1"; }
api_post() {
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H 'content-type: application/json' \
    "$DOKPLOY_API_BASE/$1" -d "$2" >/dev/null
}

log "Rolling project '$DOKPLOY_PROJECT' apps pinned to '${IMAGE_PREFIX}*' → $IMAGE"

# Discover fleet apps: id + name for every application currently pinned to our GHCR
# sha pattern. Auto-discovery keeps the fleet list from drifting out of this script.
mapfile -t FLEET < <(
  api_get "project.all" | jq -r --arg proj "$DOKPLOY_PROJECT" --arg prefix "$IMAGE_PREFIX" '
    .[] | select(.name == $proj) | .environments[]? | .applications[]?
    | select(.dockerImage != null and (.dockerImage | startswith($prefix)))
    | "\(.applicationId)\t\(.appName)\t\(.dockerImage)"'
)

[[ "${#FLEET[@]}" -gt 0 ]] || die "no fleet apps found in project '$DOKPLOY_PROJECT' matching '$IMAGE_PREFIX'"

rolled=()
for row in "${FLEET[@]}"; do
  IFS=$'\t' read -r app_id app_name current_image <<<"$row"
  if [[ "$current_image" == "$IMAGE" ]]; then
    log "  $app_name already on $IMAGE — skipping"
    continue
  fi
  log "  $app_name: $current_image → $IMAGE"
  api_post "application.update" "$(jq -n --arg applicationId "$app_id" --arg dockerImage "$IMAGE" \
    '{applicationId:$applicationId,dockerImage:$dockerImage}')"
  api_post "application.deploy" "$(jq -n --arg applicationId "$app_id" \
    '{applicationId:$applicationId,title:("Fleet roll → " + $ENV.IMAGE)}')"
  rolled+=("$app_id"$'\t'"$app_name")
done

if [[ "${#rolled[@]}" -eq 0 ]]; then
  log "Every fleet app already on $IMAGE — nothing to do."
  exit 0
fi

# Wait for each rolled app to reach a terminal Dokploy status. "done" = healthy;
# "error"/"idle" after a deploy request is a failure worth surfacing loudly.
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
failed=()
for row in "${rolled[@]}"; do
  IFS=$'\t' read -r app_id app_name <<<"$row"
  while :; do
    status="$(api_get "application.one?applicationId=$app_id" | jq -r '.applicationStatus')"
    case "$status" in
      done) log "  $app_name: done ✅"; break ;;
      error) log "  $app_name: error ❌"; failed+=("$app_name"); break ;;
      *)
        if (( $(date +%s) > deadline )); then
          log "  $app_name: timed out in status '$status' ⌛"; failed+=("$app_name"); break
        fi
        sleep 5 ;;
    esac
  done
done

[[ "${#failed[@]}" -eq 0 ]] || die "fleet roll incomplete: ${failed[*]}"
log "Fleet rolled to $IMAGE (${#rolled[@]} app(s))."
