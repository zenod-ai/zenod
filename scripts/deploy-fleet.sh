#!/usr/bin/env bash
set -eEuo pipefail

# Roll the hosted ZENOD PRODUCTION app forward to a freshly published immutable sha.
#
# Why this exists
# ---------------
# publish.yml builds ghcr.io/zenod-ai/zenod:{latest,sha-<short>} on every push to
# main, but the hosted "docker" source app (zenod-mt, cloud.zenod.dev) is pinned to
# an *immutable* sha- tag. Dokploy's autoDeploy for a docker-source app only fires
# on a registry webhook for that exact tag, and an immutable sha tag never receives
# a new push — so nothing ever advanced the pin; it was re-pinned by hand. This
# script closes the loop: main merge -> build image -> re-pin + deploy.
#
# Scope (AGENTS.md "Production deployment boundary", set by the owner 2026-09-07)
# -------------------------------------------------------------------------------
# This repo may auto-deploy ONLY live Zenod production. Independent agents/services
# (Ring, Herald, Epaminon, Outbound, Callisthenes, x-mcp, ...) and the Phylax/WhatsApp
# companion (dedicated ghcr.io/zenod-ai/phylax image, deployed only when a change
# requires it) must never be rolled automatically. So there is NO open-ended
# discovery: the script touches only apps named in DEPLOY_APPS (default: zenod-mt),
# and refuses any app whose current image is not ghcr.io/zenod-ai/zenod.
#
# Rollback
# --------
# Pins are immutable, so rollback = re-pin the previous sha. Every run logs each
# app's previous image ("zenod-mt: <previous> -> <new>"). To undo, run this script
# with IMAGE set to that previous immutable tag (needs the Dokploy secrets locally):
#   IMAGE=ghcr.io/zenod-ai/zenod:sha-<previous> VERIFY_SHA=<previous> \
#     DOKPLOY_API_BASE=... DOKPLOY_API_KEY=... scripts/deploy-fleet.sh
# (or set the application's image in the Dokploy UI and redeploy). Code rollback
# only: it never restores data. The next push to main rolls forward again.
#
# Usage:
#   IMAGE=ghcr.io/zenod-ai/zenod:sha-<short> \
#   DOKPLOY_API_BASE=https://dokploy.polyqu.com/api DOKPLOY_API_KEY=... \
#   scripts/deploy-fleet.sh
#   DRY_RUN=1 ...  prints what it would change (read-only API calls, no update/deploy)
#
# Env:
#   IMAGE               required — immutable image: ghcr.io/zenod-ai/zenod:sha-<7-40 hex>
#   DOKPLOY_API_BASE    required — e.g. https://dokploy.polyqu.com/api
#   DOKPLOY_API_KEY     required — Dokploy API key; if empty the script SKIPS (exit 0)
#   DEPLOY_APPS         optional — comma-separated Dokploy app names or applicationIds
#                       to roll (default: zenod-mt). Every entry must be found.
#   DOKPLOY_PROJECT     optional — project name to search (default: zenod)
#   DOKPLOY_ENVIRONMENT optional — environment name within the project (default: production)
#   VERIFY_URL          optional — health URL whose JSON `.sha` must match the new image
#                       once rolled (default: https://cloud.zenod.dev/api/health; set to
#                       empty to rely on Dokploy status alone). Dokploy can accept a
#                       deploy and queue it without starting it, so status alone is weak.
#   VERIFY_SHA          optional — sha prefix expected from VERIFY_URL (default: the
#                       sha in IMAGE); override when rolling back to an older tag
#   HEALTH_TIMEOUT_SECONDS  optional — per-app wait for the roll (default 300)
#   DRY_RUN             optional — 1 = report only, change nothing
#
# Downtime: the script does not manage rollout ordering. Zenod production uses a
# single SQLite-backed /data volume and Swarm stop-first; expect a brief restart blip
# (see docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md). The image has no HEALTHCHECK.

IMAGE="${IMAGE:-}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
DEPLOY_APPS="${DEPLOY_APPS:-zenod-mt}"
DOKPLOY_PROJECT="${DOKPLOY_PROJECT:-zenod}"
DOKPLOY_ENVIRONMENT="${DOKPLOY_ENVIRONMENT:-production}"
VERIFY_URL="${VERIFY_URL-https://cloud.zenod.dev/api/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '[deploy-fleet] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

# Skip cleanly when the deploy credential is not configured, so the workflow that
# calls this can be merged before the secret exists without failing CI.
if [[ -z "$DOKPLOY_API_KEY" ]]; then
  log "DOKPLOY_API_KEY is empty — skipping production roll (configure the secret to enable)."
  exit 0
fi

[[ -n "$IMAGE" ]] || die "IMAGE is required (e.g. ghcr.io/zenod-ai/zenod:sha-abc1234)"
[[ "$IMAGE" =~ ^ghcr\.io/zenod-ai/zenod:sha-[0-9a-f]{7,40}$ ]] || die "IMAGE must be an immutable zenod sha- tag, got: $IMAGE"
[[ -n "$DOKPLOY_API_BASE" ]] || die "DOKPLOY_API_BASE is required"
[[ -n "$DEPLOY_APPS" ]] || die "DEPLOY_APPS must not be empty"
VERIFY_SHA="${VERIFY_SHA:-${IMAGE##*:sha-}}"

api_get() { curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE/$1"; }
api_post() {
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H 'content-type: application/json' \
    "$DOKPLOY_API_BASE/$1" -d "$2" >/dev/null
}

summary() { [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; }

log "Zenod production roll: apps [$DEPLOY_APPS] in $DOKPLOY_PROJECT/$DOKPLOY_ENVIRONMENT -> $IMAGE (DRY_RUN=$DRY_RUN)"

# Resolve the allowlist against the project: id, name, current image. Entries match
# either the Dokploy app name or its applicationId; anything not listed is ignored.
projects_json="$(api_get "project.all")"
targets=()
IFS=',' read -r -a wanted <<<"$DEPLOY_APPS"
for want in "${wanted[@]}"; do
  want="${want//[[:space:]]/}"
  [[ -n "$want" ]] || continue
  row="$(jq -r --arg proj "$DOKPLOY_PROJECT" --arg env "$DOKPLOY_ENVIRONMENT" --arg want "$want" '
    [.[] | select(.name == $proj) | .environments[]? | select(.name == $env) | .applications[]?
     | select(.name == $want or .applicationId == $want)]
    | if length == 1 then .[0] | "\(.applicationId)\t\(.name)\t\(.dockerImage // "")"
      else "COUNT:\(length)" end' <<<"$projects_json")"
  [[ "$row" != COUNT:* ]] || die "allowlisted app '$want' matched ${row#COUNT:} apps in $DOKPLOY_PROJECT/$DOKPLOY_ENVIRONMENT (need exactly 1)"
  targets+=("$row")
done
[[ "${#targets[@]}" -gt 0 ]] || die "no apps resolved from DEPLOY_APPS='$DEPLOY_APPS'"

rolled=()
for row in "${targets[@]}"; do
  IFS=$'\t' read -r app_id app_name current_image <<<"$row"
  # Boundary guard: only Zenod production images, never the dedicated phylax image
  # or anything else, even if mistakenly allowlisted.
  [[ "$current_image" == ghcr.io/zenod-ai/zenod:* || "$current_image" == ghcr.io/zenod-ai/zenod@* ]] \
    || die "$app_name is on '$current_image', not a ghcr.io/zenod-ai/zenod image — refusing (outside Zenod production boundary)"
  if [[ "$current_image" == "$IMAGE" ]]; then
    log "  $app_name already on $IMAGE — skipping"
    continue
  fi
  log "  $app_name: $current_image -> $IMAGE   (rollback: re-pin $current_image)"
  summary "- \`$app_name\`: \`$current_image\` -> \`$IMAGE\`"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "  DRY_RUN: would application.update + application.deploy $app_name"
    continue
  fi
  api_post "application.update" "$(jq -n --arg applicationId "$app_id" --arg dockerImage "$IMAGE" \
    '{applicationId:$applicationId,dockerImage:$dockerImage}')"
  api_post "application.deploy" "$(jq -n --arg applicationId "$app_id" --arg image "$IMAGE" \
    '{applicationId:$applicationId,title:("Zenod production roll -> " + $image)}')"
  rolled+=("$app_id"$'\t'"$app_name")
done

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN complete — nothing changed."
  exit 0
fi
if [[ "${#rolled[@]}" -eq 0 ]]; then
  log "Every allowlisted app already on $IMAGE — nothing to do."
  exit 0
fi

# Wait for each rolled app. Success = the live health endpoint reports the new sha
# (when VERIFY_URL is set) else Dokploy status "done". Dokploy "error" or a timeout
# fails loudly. A Dokploy deploy can be accepted yet sit queued, hence the health check.
sleep 10
failed=()
for row in "${rolled[@]}"; do
  IFS=$'\t' read -r app_id app_name <<<"$row"
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
  while :; do
    status="$(api_get "application.one?applicationId=$app_id" | jq -r '.applicationStatus')"
    live_sha=""
    if [[ -n "$VERIFY_URL" ]]; then
      live_sha="$(curl -fsS --max-time 10 -A 'zenod-deploy-fleet' "$VERIFY_URL" 2>/dev/null | jq -r '.sha // ""' 2>/dev/null || true)"
    fi
    if [[ "$status" == "error" ]]; then
      log "  $app_name: Dokploy status error"; failed+=("$app_name"); break
    elif [[ -n "$VERIFY_URL" && -n "$live_sha" && "$live_sha" == "$VERIFY_SHA"* ]]; then
      log "  $app_name: live sha $live_sha matches (Dokploy status '$status')"; break
    elif [[ -z "$VERIFY_URL" && "$status" == "done" ]]; then
      log "  $app_name: Dokploy status done"; break
    fi
    if (( $(date +%s) > deadline )); then
      log "  $app_name: timed out (Dokploy status '$status', live sha '${live_sha:-unknown}', want '$VERIFY_SHA')"
      failed+=("$app_name"); break
    fi
    sleep 5
  done
done

[[ "${#failed[@]}" -eq 0 ]] || die "production roll incomplete: ${failed[*]} — inspect Dokploy queue/deployments; rollback by re-pinning the previous sha logged above"
log "Zenod production rolled to $IMAGE (${#rolled[@]} app(s))."
