#!/usr/bin/env bash
set -euo pipefail

# C-S4 duplicates the Z-N5 guarded cutover shape, scoped to a NEW Callisthenes
# compose. It never reads from sources except to transplant allowlisted env values,
# and never mutates Zenod, x-mcp, or the old Callisthenes 2.x compose.
umask 077

MODE="${MODE:-plan}"
DRY_RUN="${DRY_RUN:-1}"
CUTOVER_APPROVED="${CUTOVER_APPROVED:-0}"
APPROVAL_REF="${APPROVAL_REF:-}"
TARGET_COMPOSE_ID="${TARGET_COMPOSE_ID:-}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
STATE_DIR="${STATE_DIR:-/tmp/c-s4-dokploy-cutover-state}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-420}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-5}"

ZENOD_SOURCE_APP="2dkayH_eAur427leH64MT"
X_MCP_SOURCE_COMPOSE="NYUUcRopSdjmfRGoEWzHL"
OLD_CALLISTHENES_COMPOSE="oN6m6iGwRkDgc0C0WYvbD"
CALLI_HOST="calli.zenod.dev"

log() { printf '[c-s4] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

[[ "$MODE" =~ ^(plan|apply|rollback)$ ]] || die "MODE must be plan, apply, or rollback"
[[ "$DRY_RUN" =~ ^[01]$ ]] || die "DRY_RUN must be 0 or 1"
[[ -n "$DOKPLOY_API_KEY" ]] || die 'DOKPLOY_API_KEY is required; run eval "$(dokploy-env)"'
[[ -n "$TARGET_COMPOSE_ID" ]] || die "TARGET_COMPOSE_ID is required"
for protected in "$ZENOD_SOURCE_APP" "$X_MCP_SOURCE_COMPOSE" "$OLD_CALLISTHENES_COMPOSE"; do
  [[ "$TARGET_COMPOSE_ID" != "$protected" ]] || die "target must be a new Callisthenes compose; protected id refused"
done
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{7,40}$ ]] || die "EXPECTED_SHA must be the integrated 7-40 character git SHA"
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
    [[ "$endpoint" != /compose.update ]] ||
      log "DRY_RUN target env keys: $(jq -r '.env|split("\n")|map(split("=")[0])|sort|join(",")' <<<"$body")"
    return 0
  fi
  curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H 'Content-Type: application/json' \
    --data-binary @- "$DOKPLOY_API_BASE$endpoint" <<<"$body" >/dev/null
}

compose_json() { api_get "/compose.one?composeId=$1"; }
app_json() { api_get "/application.one?applicationId=$1"; }
compose_domains() { api_get "/domain.byComposeId?composeId=$1"; }
env_value() {
  jq -r --arg key "$2" '(.env//"")|split("\n")|map(select(startswith($key+"=")))|if length==1 then .[0]|sub("^[^=]+=";"") else empty end' <<<"$1"
}
require_env() { [[ -n "$(env_value "$1" "$2")" ]] || die "source is missing required $2"; }

build_target_env() {
  local target="$1" zenod="$2" xmcp="$3"
  jq -nr --arg target "$(jq -r '.env//""' <<<"$target")" \
    --arg zenod "$(jq -r '.env//""' <<<"$zenod")" --arg xmcp "$(jq -r '.env//""' <<<"$xmcp")" \
    --arg sha "$EXPECTED_SHA" '
    def parsed($raw): $raw|split("\n")|map(select(length>0)|capture("^(?<key>[^=]+)=(?<value>.*)$"))|map({key:.key,value:.value})|from_entries;
    parsed($target) as $t|parsed($zenod) as $z|parsed($xmcp) as $x|{
      ACCOUNT_STATE_SECRET: ($t.ACCOUNT_STATE_SECRET // $z.STRIPE_WEBHOOK_SECRET),
      CALLISTHENES_THROTTLE_PER_HOUR: ($t.CALLISTHENES_THROTTLE_PER_HOUR // "10"),
      CHASSIS_VAULT_MASTER_KEY: $t.CHASSIS_VAULT_MASTER_KEY,
      CONTROL_PLANE_TOKEN: $t.CONTROL_PLANE_TOKEN,
      GITHUB_OAUTH_CLIENT_ID: $z.GITHUB_OAUTH_CLIENT_ID,
      GITHUB_OAUTH_CLIENT_SECRET: $z.GITHUB_OAUTH_CLIENT_SECRET,
      GIT_SHA: $sha,
      PRICE_MONTHLY: $z.PRICE_MONTHLY,
      PRICE_YEARLY: $z.PRICE_YEARLY,
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: $z.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: $z.STRIPE_WEBHOOK_SECRET,
      X_BEARER_TOKEN: $x.X_BEARER_TOKEN,
      X_OAUTH_CONSUMER_KEY: $x.X_OAUTH_CONSUMER_KEY,
      X_OAUTH_CONSUMER_SECRET: $x.X_OAUTH_CONSUMER_SECRET
    }|to_entries|sort_by(.key)|map("\(.key)=\(.value)")|join("\n")'
}

domain_id() { jq -r --arg host "$2" '.[]|select(.host==$host)|.domainId' <<<"$1"; }
snapshot_once() {
  mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
  [[ ! -f "$STATE_DIR/manifest.json" ]] || return 0
  jq '{composeId,name,env_keys:((.env//"")|split("\n")|map(select(length>0)|split("=")[0])|sort)}' <<<"$1" >"$STATE_DIR/target.before.json"
  printf '%s\n' "$2" >"$STATE_DIR/domains.before.json"
  jq -n --arg target "$TARGET_COMPOSE_ID" --arg sha "$EXPECTED_SHA" --arg approval "$APPROVAL_REF" \
    '{version:1,target:$target,expected_sha:$sha,approval_ref:$approval}' >"$STATE_DIR/manifest.json"
  chmod 600 "$STATE_DIR"/*
}

attach_domain() {
  local domains="$1"
  [[ -z "$(domain_id "$domains" "$CALLI_HOST")" ]] || { log "domain already attached"; return; }
  api_post /domain.create "$(jq -n --arg host "$CALLI_HOST" --arg composeId "$TARGET_COMPOSE_ID" \
    '{host:$host,path:"/",port:8080,https:true,certificateType:"letsencrypt",domainType:"compose",serviceName:"calli-front",composeId:$composeId}')" \
    "attach $CALLI_HOST to calli-front:8080"
}

health_sha() { jq -r '.sha // .git_sha // .gitSha // empty' <<<"$1"; }
http_code() { curl -sS -o /dev/null -w '%{http_code}' "$1" || true; }
final_world_ready() {
  local health sha mcp
  [[ "$(http_code "https://$CALLI_HOST/")" == 200 ]] || return 1
  [[ "$(http_code "https://$CALLI_HOST/app")" =~ ^(200|302|303)$ ]] || return 1
  health="$(curl -fsS "https://$CALLI_HOST/healthz")" || return 1
  sha="$(health_sha "$health")"; [[ "$sha" == "$EXPECTED_SHA"* ]] || return 1
  mcp="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://$CALLI_HOST/mcp")"
  [[ "$mcp" == 401 ]] || return 1
}

verify_world() {
  [[ "$DRY_RUN" == 0 ]] || { log "DRY_RUN verify / 200, /app 200|redirect, /healthz exact SHA, /mcp 401"; return; }
  local deadline=$((SECONDS+HEALTH_TIMEOUT_SECONDS))
  until final_world_ready; do
    (( SECONDS < deadline )) || die "calli health receipt did not converge; rollback with the same STATE_DIR"
    sleep "$HEALTH_POLL_SECONDS"
  done
  mkdir -p "$STATE_DIR"
  jq -n --arg url "https://$CALLI_HOST" --arg sha "$EXPECTED_SHA" --arg at "$(date -u +%FT%TZ)" \
    '{url:$url,sha:$sha,verified_at:$at,routes:{landing:200,app:"200|redirect",mcp:401,healthz:200}}' >"$STATE_DIR/health-receipt.json"
  chmod 600 "$STATE_DIR/health-receipt.json"
}

apply_cutover() {
  local target zenod xmcp domains env
  target="$(compose_json "$TARGET_COMPOSE_ID")"; zenod="$(app_json "$ZENOD_SOURCE_APP")"; xmcp="$(compose_json "$X_MCP_SOURCE_COMPOSE")"
  domains="$(compose_domains "$TARGET_COMPOSE_ID")"
  [[ "$(jq -r '.name' <<<"$target")" == callisthenes ]] || die "target compose must be named callisthenes"
  for key in CHASSIS_VAULT_MASTER_KEY CONTROL_PLANE_TOKEN; do require_env "$target" "$key"; done
  for key in GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET PRICE_MONTHLY PRICE_YEARLY; do require_env "$zenod" "$key"; done
  for key in X_OAUTH_CONSUMER_KEY X_OAUTH_CONSUMER_SECRET X_BEARER_TOKEN; do require_env "$xmcp" "$key"; done
  [[ "$(env_value "$zenod" STRIPE_SECRET_KEY)" == *'_test_'* ]] || die "Zenod source Stripe key is not TEST"
  env="$(build_target_env "$target" "$zenod" "$xmcp")"
  log "PLAN 1/4 snapshot target only; protected services remain read-only"
  [[ "$DRY_RUN" == 1 ]] || snapshot_once "$target" "$domains"
  log "PLAN 2/4 transplant allowlisted OAuth, Stripe TEST, and X app values in memory"
  api_post /compose.update "$(jq -n --arg composeId "$TARGET_COMPOSE_ID" --arg env "$env" '{composeId:$composeId,env:$env}')" "update target env; values redacted"
  api_post /compose.deploy "$(jq -n --arg composeId "$TARGET_COMPOSE_ID" '{composeId:$composeId,title:"C-S4 guarded Callisthenes deploy"}')" "deploy target compose"
  log "PLAN 3/4 attach only calli.zenod.dev; do not detach or stop any existing service"
  attach_domain "$domains"
  log "PLAN 4/4 verify guarded health receipt"
  verify_world
}

rollback() {
  [[ -f "$STATE_DIR/manifest.json" ]] || die "rollback state is missing"
  local domains id
  domains="$(compose_domains "$TARGET_COMPOSE_ID")"; id="$(domain_id "$domains" "$CALLI_HOST")"
  [[ -z "$id" ]] || api_post /domain.delete "$(jq -n --arg domainId "$id" '{domainId:$domainId}')" "remove target calli domain"
  log "rollback removed only the new target domain; protected services were never changed"
}

if [[ "${C_S4_SOURCE_ONLY:-0}" != 1 ]]; then
  case "$MODE" in plan|apply) apply_cutover;; rollback) rollback;; esac
fi
