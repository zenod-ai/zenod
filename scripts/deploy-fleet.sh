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
#   HEALTH_TIMEOUT_SECONDS  optional — per-app wait for the roll, measured from the
#                       deploy request (default 900; see "Roll duration" below)
#   HEALTH_POLL_SECONDS optional — seconds between health checks (default 5)
#   DRY_RUN             optional — 1 = report only, change nothing
#   SETTLE_SECONDS      optional — pause between deploy and first check (default 10)
#
# Roll duration (why the default wait is 900s)
# --------------------------------------------
# Measured 2026-10-10 on zenod-mt: a roll on an idle Dokploy takes ~40s from the
# deploy request to /api/health reporting the new sha (30f709a 40s, c34ee43 42s; the
# new Swarm task starts in ~3s, start-first). But Dokploy runs deployments through ONE
# shared FIFO queue across every project, so a roll waits behind any unrelated build:
# for a7673eb the deploy request was accepted at 20:52:13Z, Dokploy only started it at
# 20:58:47Z (right after a 6m52s Scrapingv1 compose build finished), and production
# was live at 20:59:19Z, 7m06s end to end. Meanwhile applicationStatus still reads
# 'done' (the previous deploy), so status cannot distinguish "queued" from "stale".
# Dokploy deployments across all projects have run up to ~12 min, so 900s covers the
# worst observed blocking build plus the ~40s roll. Success is still ONLY the health
# sha matching; this timeout only bounds how long we wait for it.
#
# Stale GIT_SHA override (root cause of the 2026-10-10 "timed out" false failure)
# --------------------------------------------------------------------------------
# The image bakes GIT_SHA at build time (Dockerfile ENV) and /api/health reports it.
# zenod-mt had also been given an explicit GIT_SHA=<old sha> line in its Dokploy
# environment (set by the manual zmr-production-image.py roll). A runtime env var
# overrides the image ENV, so after a correct roll (new image, Swarm task and OCI
# revision all right) /api/health kept reporting the old sha and this script timed
# out. The script therefore removes any GIT_SHA line from the app env as part of the
# update (every other env line is preserved) so health reflects the image that is
# actually running. An app that already has the right image but still carries the
# override is also fixed (re-deployed), not skipped.
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
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-900}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-5}"
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
  # A stale GIT_SHA env line overrides the sha baked into the image and makes
  # /api/health lie about the running build, so detect it from the app's env.
  strip_env=0
  app_env="$(api_get "application.one?applicationId=$app_id" | jq -r '.env // ""')"
  if grep -q '^GIT_SHA=' <<<"$app_env"; then
    strip_env=1
    log "  $app_name: env has a GIT_SHA override; it will be removed so /api/health reports the image's own baked sha"
  fi
  if [[ "$current_image" == "$IMAGE" && "$strip_env" == "0" ]]; then
    log "  $app_name already on $IMAGE — skipping"
    continue
  fi
  log "  $app_name: $current_image -> $IMAGE   (rollback: re-pin $current_image)"
  summary "- \`$app_name\`: \`$current_image\` -> \`$IMAGE\`"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "  DRY_RUN: would application.update (strip_git_sha_env=$strip_env) + application.deploy $app_name"
    continue
  fi
  if [[ "$strip_env" == "1" ]]; then
    # Rewrite env without the GIT_SHA line only; all other lines are kept as-is.
    api_post "application.update" "$(jq -n --arg applicationId "$app_id" --arg dockerImage "$IMAGE" --arg env "$app_env" \
      '{applicationId:$applicationId,dockerImage:$dockerImage,env:($env|split("\n")|map(select(startswith("GIT_SHA=")|not))|join("\n"))}')"
  else
    api_post "application.update" "$(jq -n --arg applicationId "$app_id" --arg dockerImage "$IMAGE" \
      '{applicationId:$applicationId,dockerImage:$dockerImage}')"
  fi
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
roll_started=$(date +%s)
sleep "${SETTLE_SECONDS:-10}"
failed=()
for row in "${rolled[@]}"; do
  IFS=$'\t' read -r app_id app_name <<<"$row"
  deadline=$(( roll_started + HEALTH_TIMEOUT_SECONDS ))
  next_progress=$(( roll_started + 60 ))
  while :; do
    status="$(api_get "application.one?applicationId=$app_id" | jq -r '.applicationStatus')"
    live_sha=""
    if [[ -n "$VERIFY_URL" ]]; then
      live_sha="$(curl -fsS --max-time 10 -A 'zenod-deploy-fleet' "$VERIFY_URL" 2>/dev/null | jq -r '.sha // ""' 2>/dev/null || true)"
    fi
    if [[ "$status" == "error" ]]; then
      log "  $app_name: Dokploy status error"; failed+=("$app_name"); break
    elif [[ -n "$VERIFY_URL" && -n "$live_sha" && "$live_sha" == "$VERIFY_SHA"* ]]; then
      log "  $app_name: live sha $live_sha matches (Dokploy status '$status', $(( $(date +%s) - roll_started ))s after deploy request)"; break
    elif [[ -z "$VERIFY_URL" && "$status" == "done" ]]; then
      log "  $app_name: Dokploy status done"; break
    fi
    now=$(date +%s)
    if (( now > deadline )); then
      log "  $app_name: timed out after $(( now - roll_started ))s (limit ${HEALTH_TIMEOUT_SECONDS}s; Dokploy status '$status', live sha '${live_sha:-unknown}', want '$VERIFY_SHA')"
      log "  hint: Dokploy shares one deploy queue across projects, so the roll may still be queued behind another build (check deployment.all for $app_name); if it started and the sha is still stale => check the Swarm task image/OCI revision and the app env for a GIT_SHA override"
      failed+=("$app_name"); break
    fi
    if (( now >= next_progress )); then
      log "  $app_name: still waiting after $(( now - roll_started ))s (Dokploy status '$status', live sha '${live_sha:-unknown}', want '$VERIFY_SHA')"
      next_progress=$(( now + 60 ))
    fi
    sleep "$HEALTH_POLL_SECONDS"
  done
done

[[ "${#failed[@]}" -eq 0 ]] || die "production roll incomplete: ${failed[*]} — inspect Dokploy queue/deployments; rollback by re-pinning the previous sha logged above"
log "Zenod production rolled to $IMAGE (${#rolled[@]} app(s))."
