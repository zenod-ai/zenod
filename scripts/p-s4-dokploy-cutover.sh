#!/usr/bin/env bash
set -euo pipefail

# P-S4 duplicates the shipped R-S4 guarded application recipe. It may update
# only a newly-created Docker application named phylax and may read only the
# allowlisted OAuth/Stripe TEST values from the shipped Zenod application.
# The legacy compose, Ring, Zenod, and every supplied protected ID are refused.
umask 077

MODE="${MODE:-plan}"
DRY_RUN="${DRY_RUN:-1}"
CUTOVER_APPROVED="${CUTOVER_APPROVED:-0}"
APPROVAL_REF="${APPROVAL_REF:-}"
TARGET_APP_ID="${TARGET_APP_ID:-}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
IMAGE="${IMAGE:-ghcr.io/zenod-ai/zenod:sha-${EXPECTED_SHA}}"
STATE_DIR="${STATE_DIR:-/tmp/p-s4-dokploy-cutover-state}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-420}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-5}"

ZENOD_SOURCE_APP="2dkayH_eAur427leH64MT"
PROTECTED_LEGACY_PHYLAX_COMPOSE="uCoS_Zr0qKZyQHu4UDVjx"
PROTECTED_RING_APP="hkdStWh6zfJ9d-uohdJHt"
PHYLAX_HOST="phylax.zenod.dev"
PROTECTED_APP_IDS="${PROTECTED_APP_IDS:-$ZENOD_SOURCE_APP,$PROTECTED_LEGACY_PHYLAX_COMPOSE,$PROTECTED_RING_APP}"

log() { printf '[p-s4] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

[[ "$MODE" =~ ^(plan|apply|rollback)$ ]] || die "MODE must be plan, apply, or rollback"
[[ "$DRY_RUN" =~ ^[01]$ ]] || die "DRY_RUN must be 0 or 1"
[[ -n "$DOKPLOY_API_KEY" ]] || die 'DOKPLOY_API_KEY is required; run eval "$(dokploy-env)"'
[[ -n "$TARGET_APP_ID" ]] || die "TARGET_APP_ID is required"
case ",$PROTECTED_APP_IDS," in *",$TARGET_APP_ID,"*) die "protected/source application id refused: $TARGET_APP_ID";; esac
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{7,40}$ ]] || die "EXPECTED_SHA must be the reviewed integrated 7-40 character git SHA"
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
require_env() { [[ -n "$(env_value "$1" "$2")" ]] || die "application is missing required $2"; }

build_target_env() {
  local target="$1" source="$2"
  jq -nr --arg target "$(jq -r '.env//""' <<<"$target")" \
    --arg source "$(jq -r '.env//""' <<<"$source")" --arg sha "$EXPECTED_SHA" '
    def parsed($raw): $raw|split("\n")|map(select(length>0)|capture("^(?<key>[^=]+)=(?<value>.*)$"))|map({key:.key,value:.value})|from_entries;
    parsed($target) as $t|parsed($source) as $s|{
      ACCOUNT_STATE_SECRET: $t.ACCOUNT_STATE_SECRET,
      CHASSIS_VAULT_MASTER_KEY: $t.CHASSIS_VAULT_MASTER_KEY,
      CONTROL_PLANE_TOKEN: $t.CONTROL_PLANE_TOKEN,
      CUSTOMER_APP_URL: "https://phylax.zenod.dev",
      DOMAIN: "https://phylax.zenod.dev",
      GITHUB_OAUTH_CALLBACK_URL: "https://phylax.zenod.dev/auth/github/callback",
      GITHUB_OAUTH_CLIENT_ID: $s.GITHUB_OAUTH_CLIENT_ID,
      GITHUB_OAUTH_CLIENT_SECRET: $s.GITHUB_OAUTH_CLIENT_SECRET,
      GIT_SHA: $sha,
      NODE_ENV: "production",
      PHYLAX_ADMIN_GITHUB_LOGIN: "alfablok",
      PHYLAX_FULL_CUSTOMER_UNIT: "1",
      PHYLAX_SITE_DIST: "/app/apps/phylax-site/dist",
      PORT: "8080",
      PRICE_MONTHLY: $s.PRICE_MONTHLY,
      PRICE_YEARLY: $s.PRICE_YEARLY,
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: $s.STRIPE_SECRET_KEY,
      # Stripe signing secrets are endpoint-specific. Preserve the dedicated
      # Phylax TEST endpoint created for https://phylax.zenod.dev/webhook.
      STRIPE_WEBHOOK_ENDPOINT_ID: $t.STRIPE_WEBHOOK_ENDPOINT_ID,
      STRIPE_WEBHOOK_SECRET: $t.STRIPE_WEBHOOK_SECRET,
      ZC_COOKIE_DOMAIN: "phylax.zenod.dev",
      ZENOD_DATA_DIR: "/data",
      ZENOD_UNIT: "phylax",
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
    '{version:1,target:$target,expected_sha:$sha,approval_ref:$approval,fresh_qr_only:true}' >"$STATE_DIR/manifest.json"
  chmod 600 "$STATE_DIR"/*
}

attach_domain() {
  local domains="$1"
  [[ -z "$(domain_id "$domains" "$PHYLAX_HOST")" ]] || { log "domain already attached to approved target"; return; }
  api_post /domain.create "$(jq -n --arg host "$PHYLAX_HOST" --arg applicationId "$TARGET_APP_ID" \
    '{host:$host,path:"/",port:8080,https:true,certificateType:"letsencrypt",domainType:"application",applicationId:$applicationId}')" \
    "attach $PHYLAX_HOST only to the new full-customer application"
}

health_sha() { jq -r '.sha // .git_sha // .gitSha // empty' <<<"$1"; }
http_code() { curl -sS -o /dev/null -w '%{http_code}' "$1" || true; }
final_world_ready() {
  local health sha mcp oauth admin
  [[ "$(http_code "https://$PHYLAX_HOST/")" == 200 ]] || return 1
  [[ "$(http_code "https://$PHYLAX_HOST/app")" =~ ^(200|302|303)$ ]] || return 1
  health="$(curl -fsS "https://$PHYLAX_HOST/api/health")" || return 1
  [[ "$(jq -r '.status // empty' <<<"$health")" == ok ]] || return 1
  sha="$(health_sha "$health")"; [[ "$sha" == "$EXPECTED_SHA"* ]] || return 1
  mcp="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://$PHYLAX_HOST/mcp")"
  [[ "$mcp" == 401 ]] || return 1
  admin="$(http_code "https://$PHYLAX_HOST/admin")"; [[ "$admin" == 404 ]] || return 1
  oauth="$(curl -sS -o /dev/null -D - "https://$PHYLAX_HOST/auth/signin" | awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/, ""); print substr($0,11)}')"
  [[ "$oauth" == https://github.com/login/oauth/authorize* ]] || return 1
  [[ "$oauth" == *"redirect_uri=https%3A%2F%2Fphylax.zenod.dev%2Fauth%2Fgithub%2Fcallback"* ]] || return 1
}

verify_world() {
  [[ "$DRY_RUN" == 0 ]] || { log "DRY_RUN verify root/app, exact-SHA /api/health, unauthenticated /mcp=401, OAuth callback=Phylax, logged-out /admin=404"; return; }
  local deadline=$((SECONDS+HEALTH_TIMEOUT_SECONDS))
  until final_world_ready; do
    (( SECONDS < deadline )) || die "Phylax health receipt did not converge; rollback with the same STATE_DIR"
    sleep "$HEALTH_POLL_SECONDS"
  done
  jq -n --arg url "https://$PHYLAX_HOST" --arg sha "$EXPECTED_SHA" --arg at "$(date -u +%FT%TZ)" \
    '{url:$url,sha:$sha,verified_at:$at,routes:{landing:200,app:"200|redirect",mcp:401,admin_logged_out:404,health:200},oauth_callback:"https://phylax.zenod.dev/auth/github/callback",fresh_qr_required:true}' >"$STATE_DIR/health-receipt.json"
  chmod 600 "$STATE_DIR/health-receipt.json"
}

apply_cutover() {
  local target source domains env
  target="$(app_json "$TARGET_APP_ID")"; source="$(app_json "$ZENOD_SOURCE_APP")"; domains="$(app_domains "$TARGET_APP_ID")"
  [[ "$(jq -r '.name' <<<"$target")" == phylax ]] || die "target application must be the distinct new Docker application named phylax"
  [[ "$(jq -r '[.mounts[]?|select(.mountPath=="/data")]|length' <<<"$target")" == 1 ]] || die "target must have exactly one fresh persistent /data mount"
  [[ "$(jq -r '[.mounts[]?|select(.mountPath=="/data")|.applicationId]|unique|length' <<<"$target")" == 1 ]] || die "target /data mount ownership is ambiguous"
  [[ "$(jq -r '[.mounts[]?|select(.mountPath=="/data")|.applicationId][0]' <<<"$target")" == "$TARGET_APP_ID" ]] || die "target /data mount must be owned by the new application"
  for key in ACCOUNT_STATE_SECRET CHASSIS_VAULT_MASTER_KEY CONTROL_PLANE_TOKEN PHYLAX_FULL_CUSTOMER_UNIT STRIPE_WEBHOOK_ENDPOINT_ID STRIPE_WEBHOOK_SECRET; do require_env "$target" "$key"; done
  [[ "$(env_value "$target" PHYLAX_FULL_CUSTOMER_UNIT)" == 1 ]] || die "target must be pre-marked PHYLAX_FULL_CUSTOMER_UNIT=1"
  for key in GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET STRIPE_SECRET_KEY PRICE_MONTHLY PRICE_YEARLY; do require_env "$source" "$key"; done
  [[ "$(env_value "$source" STRIPE_SECRET_KEY)" == *'_test_'* ]] || die "Zenod source Stripe key is not TEST"
  env="$(build_target_env "$target" "$source")"
  log "PLAN 1/4 snapshot only the new Phylax Docker target; preserve its fresh /data"
  [[ "$DRY_RUN" == 1 ]] || snapshot_once "$target" "$domains"
  log "PLAN 2/4 transplant allowlisted OAuth + Stripe TEST values in memory"
  api_post /application.update "$(jq -n --arg applicationId "$TARGET_APP_ID" --arg dockerImage "$IMAGE" --arg env "$env" '{applicationId:$applicationId,sourceType:"docker",dockerImage:$dockerImage,env:$env}')" "set immutable image + Phylax env; values redacted"
  api_post /application.deploy "$(jq -n --arg applicationId "$TARGET_APP_ID" '{applicationId:$applicationId,title:"P-S4 guarded Phylax full-customer deploy"}')" "deploy only the new Phylax application"
  log "PLAN 3/4 attach only phylax.zenod.dev; never detach, stop, or reuse another unit"
  attach_domain "$domains"
  log "PLAN 4/4 verify exact SHA, OAuth callback, MCP auth, and closed admin gate"
  verify_world
}

rollback() {
  [[ -f "$STATE_DIR/manifest.json" ]] || die "rollback state is missing"
  local domains id
  domains="$(app_domains "$TARGET_APP_ID")"; id="$(domain_id "$domains" "$PHYLAX_HOST")"
  [[ -z "$id" ]] || api_post /domain.delete "$(jq -n --arg domainId "$id" '{domainId:$domainId}')" "remove domain only from the new target"
  log "rollback never restores or migrates a WhatsApp session; next pairing remains a fresh QR"
}

if [[ "${P_S4_SOURCE_ONLY:-0}" != 1 ]]; then
  case "$MODE" in plan|apply) apply_cutover;; rollback) rollback;; esac
fi
