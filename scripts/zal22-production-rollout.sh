#!/usr/bin/env bash
set -eEuo pipefail

# Guarded two-service rollout for the ZAL-22 stabilization candidate.
# Read-only plan is the default. Apply preserves every unnamed environment
# value, both durable volumes, the Phylax session, and all tenant credentials.

umask 077

MODE="${MODE:-plan}"
DRY_RUN="${DRY_RUN:-1}"
ROLLOUT_APPROVED="${ROLLOUT_APPROVED:-0}"
APPROVAL_REF="${APPROVAL_REF:-}"
STATE_DIR="${STATE_DIR:-/var/tmp/zenod-zal22-rollout}"
BACKUP_VERIFIED_AT="${BACKUP_VERIFIED_AT:-}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"

PUBLIC_APP="2dkayH_eAur427leH64MT"
PRIVATE_APP="urbFsgl6eImbQ4MTIZl5N"
PUBLIC_NAME="zenod-mt"
PRIVATE_NAME="phylax"
PUBLIC_SERVICE="zenod-mt-fxpzoo"
PRIVATE_SERVICE="app-index-back-end-panel-6zm3qg"
PUBLIC_VOLUME="zenod-mt-data"
PRIVATE_VOLUME="phylax-data"
PREVIOUS_IMAGE_INDEX="sha256:9ab0e06e259f7afc17035dc37e15c0d7828fdfb919336761a871bc4e430bd505"
IMAGE_INDEX="sha256:9308e5e2319567958380c1e329afab22532be54ec9fff8dddeabea2b3ed4227a"
IMAGE="ghcr.io/zenod-ai/zenod@${IMAGE_INDEX}"
PREVIOUS_IMAGE="ghcr.io/zenod-ai/zenod@${PREVIOUS_IMAGE_INDEX}"
SOURCE_SHA="a6fbe8f1b385608bf00a5e1a5e5c385305eba7a2"
PRICE_MONTHLY="price_1U8jip80yG7aohEW6tZnFgZq"
CHANNELS_ORIGIN="http://${PRIVATE_SERVICE}:8080"
CHANNELS_MEMORY_URL="http://${PUBLIC_SERVICE}:8080/mcp"

log() { printf '[zal22-rollout] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

[[ "$MODE" =~ ^(plan|apply)$ ]] || die "MODE must be plan or apply"
[[ "$DRY_RUN" =~ ^[01]$ ]] || die "DRY_RUN must be 0 or 1"
[[ -n "$DOKPLOY_API_KEY" ]] || die 'load the Dokploy API key with eval "$(dokploy-env)"'
[[ "$STATE_DIR" == /* && "$STATE_DIR" != "/" ]] || die "STATE_DIR must be a non-root absolute path"
case "$STATE_DIR/" in "$(git rev-parse --show-toplevel)/"*) die "STATE_DIR must be outside the repository" ;; esac

if [[ "$MODE" == "apply" ]]; then
  [[ "$DRY_RUN" == "0" ]] || die "apply requires DRY_RUN=0"
  [[ "$ROLLOUT_APPROVED" == "1" ]] || die "apply requires ROLLOUT_APPROVED=1"
  [[ -n "$APPROVAL_REF" ]] || die "apply requires APPROVAL_REF"
  [[ "$BACKUP_VERIFIED_AT" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    die "apply requires the actual off-host BACKUP_VERIFIED_AT timestamp"
fi

api_get() {
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE$1"
}

api_post() {
  local endpoint="$1" body="$2" summary="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN POST $endpoint ($summary)"
    return 0
  fi
  curl -fsS -X POST \
    -H "x-api-key: $DOKPLOY_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- "$DOKPLOY_API_BASE$endpoint" <<<"$body" >/dev/null
}

app_json() { api_get "/application.one?applicationId=$1"; }

env_value() {
  jq -r --arg key "$2" '
    (.env // "") | split("\n") | map(select(startswith($key + "="))) |
    if length == 1 then .[0] | sub("^[^=]+="; "") else empty end
  ' <<<"$1"
}

require_exact_mount() {
  local json="$1" volume="$2"
  [[ "$(jq -r --arg volume "$volume" '[.mounts[]? | select(.type == "volume" and .volumeName == $volume and .mountPath == "/data")] | length' <<<"$json")" == "1" ]] ||
    die "expected exact $volume:/data mount"
}

assert_app() {
  local json="$1" id="$2" name="$3" volume="$4"
  [[ "$(jq -r '.applicationId' <<<"$json")" == "$id" ]] || die "$name application ID drift"
  [[ "$(jq -r '.name' <<<"$json")" == "$name" ]] || die "$name application name drift"
  require_exact_mount "$json" "$volume"
}

build_public_env() {
  local raw="$1" private_token="$2"
  jq -nr \
    --arg raw "$raw" \
    --arg private_token "$private_token" \
    --arg channels_origin "$CHANNELS_ORIGIN" \
    --arg memory_url "$CHANNELS_MEMORY_URL" \
    --arg monthly "$PRICE_MONTHLY" \
    --arg legal "2026-08-26" \
    --arg backup "$BACKUP_VERIFIED_AT" '
      def parsed($value):
        $value | split("\n") |
        map(select(length > 0) | capture("^(?<key>[^=]+)=(?<value>.*)$")) |
        map({key: .key, value: .value}) | from_entries;
      parsed($raw) |
      .AGENT = "zenod" |
      del(.GIT_SHA) |
      .PRICE_MONTHLY = $monthly |
      .ZENOD_LEGAL_VERSION = $legal |
      .ZENOD_BACKUP_RESTORE_VERIFIED_AT = $backup |
      .ZENOD_CHANNELS_URL = $channels_origin |
      .ZENOD_CHANNELS_ALLOWED_ORIGINS = $channels_origin |
      .ZENOD_CHANNELS_MEMORY_URL = $memory_url |
      .ZENOD_CHANNELS_PRIVATE_TOKEN = $private_token |
      to_entries | sort_by(.key) | map("\(.key)=\(.value)") | join("\n")
    '
}

snapshot() {
  local public="$1" private="$2"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if [[ ! -f "$STATE_DIR/public.before.json" ]]; then
    printf '%s\n' "$public" >"$STATE_DIR/public.before.json"
    printf '%s\n' "$private" >"$STATE_DIR/private.before.json"
    jq -n --arg approval "$APPROVAL_REF" --arg image "$IMAGE" --arg sha "$SOURCE_SHA" \
      '{approval:$approval,image:$image,sourceSha:$sha,createdAt:(now|todate)}' >"$STATE_DIR/manifest.json"
    chmod 600 "$STATE_DIR"/*
  fi
}

wait_health_sha() {
  local url="$1" deadline=$((SECONDS + 600))
  [[ "$DRY_RUN" == "0" ]] || { log "DRY_RUN wait for $url to report $SOURCE_SHA"; return 0; }
  while (( SECONDS < deadline )); do
    local sha
    sha="$(curl -fsS "$url" 2>/dev/null | jq -r '.sha // empty' 2>/dev/null || true)"
    [[ "$sha" == "$SOURCE_SHA" ]] && return 0
    sleep 5
  done
  die "$url did not converge to $SOURCE_SHA"
}

main() {
  local public private private_token current_public_token public_env
  public="$(app_json "$PUBLIC_APP")"
  private="$(app_json "$PRIVATE_APP")"
  assert_app "$public" "$PUBLIC_APP" "$PUBLIC_NAME" "$PUBLIC_VOLUME"
  assert_app "$private" "$PRIVATE_APP" "$PRIVATE_NAME" "$PRIVATE_VOLUME"

  case "$(jq -r '.dockerImage' <<<"$public")" in
    "$IMAGE"|"$PREVIOUS_IMAGE") ;;
    *) die "public image is neither the reviewed predecessor nor candidate index" ;;
  esac
  case "$(jq -r '.dockerImage' <<<"$private")" in
    "$IMAGE"|"$PREVIOUS_IMAGE") ;;
    *) die "private image drift" ;;
  esac
  [[ "$(env_value "$public" ZENOD_PUBLIC_PAID_SIGNUP)" == "0" ]] || die "public signup must remain closed"
  [[ "$(env_value "$private" AGENT)" == "phylax" ]] || die "private AGENT drift"
  [[ "$(env_value "$private" ZENOD_UNIT)" == "phylax" ]] || die "private ZENOD_UNIT drift"

  private_token="$(env_value "$private" ZENOD_CHANNELS_PRIVATE_TOKEN)"
  [[ -n "$private_token" ]] || die "private Channels token is missing"
  current_public_token="$(env_value "$public" ZENOD_CHANNELS_PRIVATE_TOKEN)"
  [[ -z "$current_public_token" || "$current_public_token" == "$private_token" ]] ||
    die "public/private Channels token mismatch; refusing rotation"

  public_env="$(build_public_env "$(jq -r '.env // ""' <<<"$public")" "$private_token")"
  log "public delta: add AGENT + Channels bridge; remove stale GIT_SHA; set reviewed EUR 9 monthly price, legal version, and verified backup timestamp"
  log "private delta: image only; environment, durable volume, and channel session unchanged"
  log "preserved invariants: signup closed; tenant tokens/OAuth/Drive credentials untouched; no OpenRouter child-key configuration"

  [[ "$DRY_RUN" == "1" ]] || snapshot "$public" "$private"
  api_post "/application.update" "$(jq -n --arg applicationId "$PUBLIC_APP" --arg dockerImage "$IMAGE" --arg env "$public_env" '{applicationId:$applicationId,sourceType:"docker",dockerImage:$dockerImage,env:$env}')" \
    "public image + bounded environment delta"
  api_post "/application.deploy" "$(jq -n --arg applicationId "$PUBLIC_APP" '{applicationId:$applicationId,title:"ZAL-22 stable voice, Drive, auth and Channels public rollout"}')" \
    "restart public Zenod only"
  wait_health_sha "https://cloud.zenod.dev/api/health"

  api_post "/application.update" "$(jq -n --arg applicationId "$PRIVATE_APP" --arg dockerImage "$IMAGE" --arg env "$(jq -r '.env // ""' <<<"$private")" '{applicationId:$applicationId,sourceType:"docker",dockerImage:$dockerImage,env:$env}')" \
    "private image only; exact environment retained"
  api_post "/application.deploy" "$(jq -n --arg applicationId "$PRIVATE_APP" '{applicationId:$applicationId,title:"ZAL-22 stable concurrent voice and Drive archive private rollout"}')" \
    "restart private Phylax without session reset"
  wait_health_sha "https://phylax.zenod.dev/api/health"
  log "two-service rollout converged on $SOURCE_SHA"
}

main "$@"
