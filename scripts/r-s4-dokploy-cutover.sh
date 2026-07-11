#!/usr/bin/env bash
set -euo pipefail

# R-S4 duplicates the guarded Z-N5/C-S4 recipe for a NEW Ring application.
# The Zenod application is read only and supplies only allowlisted OAuth and
# Stripe TEST values. No existing application, compose, domain, or tenant is
# detached, stopped, updated, or deployed.
umask 077

MODE="${MODE:-plan}"
DRY_RUN="${DRY_RUN:-1}"
CUTOVER_APPROVED="${CUTOVER_APPROVED:-0}"
APPROVAL_REF="${APPROVAL_REF:-}"
TARGET_APP_ID="${TARGET_APP_ID:-}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
IMAGE="${IMAGE:-ghcr.io/zenod-ai/zenod:sha-${EXPECTED_SHA}}"
STATE_DIR="${STATE_DIR:-/tmp/r-s4-dokploy-cutover-state}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-420}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-5}"

ZENOD_SOURCE_APP="2dkayH_eAur427leH64MT"
RING_HOST="ring.zenod.dev"

log() { printf '[r-s4] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

[[ "$MODE" =~ ^(plan|apply|rollback)$ ]] || die "MODE must be plan, apply, or rollback"
[[ "$DRY_RUN" =~ ^[01]$ ]] || die "DRY_RUN must be 0 or 1"
[[ -n "$DOKPLOY_API_KEY" ]] || die 'DOKPLOY_API_KEY is required; run eval "$(dokploy-env)"'
[[ -n "$TARGET_APP_ID" ]] || die "TARGET_APP_ID is required"
[[ "$TARGET_APP_ID" != "$ZENOD_SOURCE_APP" ]] || die "target must be a new Ring application; protected Zenod id refused"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{7,40}$ ]] || die "EXPECTED_SHA must be the integrated 7-40 character git SHA"
[[ "$IMAGE" == "ghcr.io/zenod-ai/zenod:sha-$EXPECTED_SHA" ]] || die "IMAGE must be the immutable integrated SHA tag"
[[ "$STATE_DIR" == /* && "$STATE_DIR" != / ]] || die "STATE_DIR must be a non-root absolute path"
if [[ "$MODE" != plan || "$DRY_RUN" == 0 ]]; then
  [[ "$DRY_RUN" == 0 ]] || die "$MODE requires DRY_RUN=0"
  [[ "$CUTOVER_APPROVED" == 1 ]] || die "$MODE requires CUTOVER_APPROVED=1"
  [[ -n "$APPROVAL_REF" ]] || die "$MODE requires APPROVAL_REF naming the manager instruction"
fi

api_get() { curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE$1"; }
api_post() {
  local endpoint="$1" body="$2" summary="$3"
  if [[ "$DRY_RUN" == 1 ]]; then
    log "DRY_RUN POST $endpoint ($summary)"
    if [[ "$endpoint" == /application.update ]]; then
      log "DRY_RUN target env keys: $(jq -r '.env|split("\n")|map(split("=")[0])|sort|join(",")' <<<"$body")"
    fi
    return 0
  fi
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H 'Content-Type: application/json' \
    --data-binary @- "$DOKPLOY_API_BASE$endpoint" <<<"$body" >/dev/null
}

app_json() { api_get "/application.one?applicationId=$1"; }
app_domains() { api_get "/domain.byApplicationId?applicationId=$1"; }
env_value() {
  jq -r --arg key "$2" '(.env//"")|split("\n")|map(select(startswith($key+"=")))|if length==1 then .[0]|sub("^[^=]+=";"") else empty end' <<<"$1"
}
require_env() { [[ -n "$(env_value "$1" "$2")" ]] || die "source is missing required $2"; }

build_target_env() {
  local target="$1" source="$2"
  jq -nr --arg target "$(jq -r '.env//""' <<<"$target")" \
    --arg source "$(jq -r '.env//""' <<<"$source")" --arg sha "$EXPECTED_SHA" '
    def parsed($raw): $raw|split("\n")|map(select(length>0)|capture("^(?<key>[^=]+)=(?<value>.*)$"))|map({key:.key,value:.value})|from_entries;
    parsed($target) as $t|parsed($source) as $s|{
      ACCOUNT_STATE_SECRET: $t.ACCOUNT_STATE_SECRET,
      CHASSIS_VAULT_MASTER_KEY: $t.CHASSIS_VAULT_MASTER_KEY,
      CONTROL_PLANE_TOKEN: $t.CONTROL_PLANE_TOKEN,
      CUSTOMER_APP_URL: "https://ring.zenod.dev",
      DOMAIN: "https://ring.zenod.dev",
      GITHUB_OAUTH_CALLBACK_URL: "https://ring.zenod.dev/auth/github/callback",
      GITHUB_OAUTH_CLIENT_ID: $s.GITHUB_OAUTH_CLIENT_ID,
      GITHUB_OAUTH_CLIENT_SECRET: $s.GITHUB_OAUTH_CLIENT_SECRET,
      GIT_SHA: $sha,
      NODE_ENV: "production",
      PORT: "8080",
      PRICE_MONTHLY: $s.PRICE_MONTHLY,
      PRICE_YEARLY: $s.PRICE_YEARLY,
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: $s.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: $s.STRIPE_WEBHOOK_SECRET,
      ZC_COOKIE_DOMAIN: "ring.zenod.dev",
      ZENOD_DATA_DIR: "/data",
      ZENOD_SITE_DIST: "/app/apps/ring-site/dist",
      ZENOD_UNIT: "ring",
      ZENOD_WEB_DIST: "/app/apps/web/dist"
    }|to_entries|sort_by(.key)|map("\(.key)=\(.value)")|join("\n")'
}

domain_id() { jq -r --arg host "$2" '.[]|select(.host==$host)|.domainId' <<<"$1"; }
snapshot_once() {
  mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
  [[ ! -f "$STATE_DIR/manifest.json" ]] || return 0
  jq '{applicationId,name,dockerImage,env_keys:((.env//"")|split("\n")|map(select(length>0)|split("=")[0])|sort),mounts:[.mounts[]?|{mountId,type,volumeName,mountPath,applicationId}]}' <<<"$1" >"$STATE_DIR/target.before.json"
  printf '%s\n' "$2" >"$STATE_DIR/domains.before.json"
  jq -n --arg target "$TARGET_APP_ID" --arg sha "$EXPECTED_SHA" --arg approval "$APPROVAL_REF" \
    '{version:1,target:$target,expected_sha:$sha,approval_ref:$approval}' >"$STATE_DIR/manifest.json"
  chmod 600 "$STATE_DIR"/*
}

attach_domain() {
  local domains="$1"
  [[ -z "$(domain_id "$domains" "$RING_HOST")" ]] || { log "domain already attached"; return; }
  api_post /domain.create "$(jq -n --arg host "$RING_HOST" --arg applicationId "$TARGET_APP_ID" \
    '{host:$host,path:"/",port:8080,https:true,certificateType:"letsencrypt",domainType:"application",applicationId:$applicationId}')" \
    "attach $RING_HOST to Ring application port 8080"
}

health_sha() { jq -r '.sha // .git_sha // .gitSha // empty' <<<"$1"; }
http_code() { curl -sS -o /dev/null -w '%{http_code}' "$1" || true; }
final_world_ready() {
  local health runtime_health sha mcp oauth
  [[ "$(http_code "https://$RING_HOST/")" == 200 ]] || return 1
  [[ "$(http_code "https://$RING_HOST/app")" =~ ^(200|302|303)$ ]] || return 1
  health="$(curl -fsS "https://$RING_HOST/healthz")" || return 1
  [[ "$(jq -r '.status // empty' <<<"$health")" == ok ]] || return 1
  runtime_health="$(curl -fsS "https://$RING_HOST/api/health")" || return 1
  sha="$(health_sha "$runtime_health")"; [[ "$sha" == "$EXPECTED_SHA"* ]] || return 1
  mcp="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://$RING_HOST/mcp")"
  [[ "$mcp" == 401 ]] || return 1
  oauth="$(curl -sS -o /dev/null -D - "https://$RING_HOST/auth/signin" | awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/, ""); print substr($0,11)}')"
  [[ "$oauth" == https://github.com/login/oauth/authorize* ]] || return 1
  [[ "$oauth" == *"redirect_uri=https%3A%2F%2Fring.zenod.dev%2Fauth%2Fgithub%2Fcallback"* ]] || return 1
}

verify_world() {
  [[ "$DRY_RUN" == 0 ]] || { log "DRY_RUN verify / 200, /app 200|redirect, /healthz exact SHA, /mcp 401, OAuth callback=Ring"; return; }
  local deadline=$((SECONDS+HEALTH_TIMEOUT_SECONDS))
  until final_world_ready; do
    (( SECONDS < deadline )) || die "Ring health receipt did not converge; rollback with the same STATE_DIR"
    sleep "$HEALTH_POLL_SECONDS"
  done
  jq -n --arg url "https://$RING_HOST" --arg sha "$EXPECTED_SHA" --arg at "$(date -u +%FT%TZ)" \
    '{url:$url,sha:$sha,verified_at:$at,routes:{landing:200,app:"200|redirect",mcp:401,healthz:200},oauth_callback:"https://ring.zenod.dev/auth/github/callback"}' >"$STATE_DIR/health-receipt.json"
  chmod 600 "$STATE_DIR/health-receipt.json"
}

apply_cutover() {
  local target source domains env
  target="$(app_json "$TARGET_APP_ID")"; source="$(app_json "$ZENOD_SOURCE_APP")"; domains="$(app_domains "$TARGET_APP_ID")"
  [[ "$(jq -r '.name' <<<"$target")" == ring ]] || die "target application must be named ring"
  [[ "$(jq -r '[.mounts[]?|select(.mountPath=="/data")]|length' <<<"$target")" == 1 ]] || die "target must have exactly one persistent /data mount"
  for key in ACCOUNT_STATE_SECRET CHASSIS_VAULT_MASTER_KEY CONTROL_PLANE_TOKEN; do require_env "$target" "$key"; done
  for key in GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET PRICE_MONTHLY PRICE_YEARLY; do require_env "$source" "$key"; done
  [[ "$(env_value "$source" STRIPE_SECRET_KEY)" == *'_test_'* ]] || die "Zenod source Stripe key is not TEST"
  env="$(build_target_env "$target" "$source")"
  log "PLAN 1/4 snapshot only the new Ring target; preserve /data"
  [[ "$DRY_RUN" == 1 ]] || snapshot_once "$target" "$domains"
  log "PLAN 2/4 transplant allowlisted OAuth + Stripe TEST values in memory"
  api_post /application.update "$(jq -n --arg applicationId "$TARGET_APP_ID" --arg dockerImage "$IMAGE" --arg env "$env" '{applicationId:$applicationId,dockerImage:$dockerImage,env:$env}')" "set immutable image + target env; values redacted"
  api_post /application.deploy "$(jq -n --arg applicationId "$TARGET_APP_ID" '{applicationId:$applicationId,title:"R-S4 guarded Ring deploy"}')" "deploy new Ring application"
  log "PLAN 3/4 attach only ring.zenod.dev; never detach or stop another service"
  attach_domain "$domains"
  log "PLAN 4/4 verify root + /app + /mcp + /healthz and OAuth callback receipt"
  verify_world
}

rollback() {
  [[ -f "$STATE_DIR/manifest.json" ]] || die "rollback state is missing"
  local domains id old_image
  domains="$(app_domains "$TARGET_APP_ID")"; id="$(domain_id "$domains" "$RING_HOST")"
  [[ -z "$id" ]] || api_post /domain.delete "$(jq -n --arg domainId "$id" '{domainId:$domainId}')" "remove Ring target domain"
  old_image="$(jq -r '.dockerImage' "$STATE_DIR/target.before.json")"
  log "rollback removes only the new Ring domain; target image remains $old_image for manager-directed recovery"
}

if [[ "${R_S4_SOURCE_ONLY:-0}" != 1 ]]; then
  case "$MODE" in plan|apply) apply_cutover;; rollback) rollback;; esac
fi
