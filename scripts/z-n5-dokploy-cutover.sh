#!/usr/bin/env bash
set -eEuo pipefail

# Z-N5 one-container Dokploy cutover. Read-only dry-run is the default.
# Apply is intentionally gated until the PR is merged and the spine steward approves it.

umask 077

MODE="${MODE:-plan}"
IMAGE="${IMAGE:-}"
DRY_RUN="${DRY_RUN:-1}"
CUTOVER_APPROVED="${CUTOVER_APPROVED:-0}"
APPROVAL_REF="${APPROVAL_REF:-}"
STATE_DIR="${STATE_DIR:-/tmp/z-n5-dokploy-cutover-state}"
DOKPLOY_API_BASE="${DOKPLOY_API_BASE:-https://dokploy.polyqu.com/api}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-420}"
HEALTH_POLL_SECONDS="${HEALTH_POLL_SECONDS:-5}"

TARGET_APP="2dkayH_eAur427leH64MT"
OLD_SITE_APP="bSGHEi-7-i9VdjP3QQSDi"
OLD_CLOUD_COMPOSE="17QoMFRgvmZ0Y2n19DINT"
OLD_TEST_COMPOSE="wP2PWUnRL1VnKUMfwHDPj"
SOURCE_COMPOSE="$OLD_TEST_COMPOSE"

ZENOD_DOMAIN_ID="fw_6ibKlyvtozD92hPHg7"
CLOUD_DOMAIN_ID="ogCtEMVhudMSC80pJJm5M"
CLOUD_TEST_DOMAIN_ID="OQA2mW6eiWdNdACzMLPw7"
BANNED_DOMAIN_ID="Z_hbr8dWYf5D7xoVpv6pQ"
MIND_DOMAIN_ID="a1jRaYz8gbNLRIaf7AEfH"

log() { printf '[z-n5] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

usage() {
  cat <<'EOF'
Usage:
  eval "$(dokploy-env)"
  IMAGE=ghcr.io/zenod-ai/zenod:sha-<merged-sha> scripts/z-n5-dokploy-cutover.sh

  MODE=apply DRY_RUN=0 CUTOVER_APPROVED=1 APPROVAL_REF=<steward-instruction> \
    STATE_DIR=/var/tmp/z-n5-cutover-<date> IMAGE=ghcr.io/zenod-ai/zenod:sha-<merged-sha> \
    scripts/z-n5-dokploy-cutover.sh

  MODE=rollback DRY_RUN=0 CUTOVER_APPROVED=1 APPROVAL_REF=<incident-or-instruction> \
    STATE_DIR=/var/tmp/z-n5-cutover-<date> scripts/z-n5-dokploy-cutover.sh

plan is read-only. apply and rollback mutate Dokploy and require the explicit gates above.
Never place STATE_DIR inside the repository. Rollback manifests are sanitized and mode 0600.
EOF
}

[[ "$MODE" =~ ^(plan|apply|rollback)$ ]] || die "MODE must be plan, apply, or rollback"
[[ "$DRY_RUN" =~ ^[01]$ ]] || die "DRY_RUN must be 0 or 1"
[[ -n "$DOKPLOY_API_KEY" ]] || die 'DOKPLOY_API_KEY is required; run eval "$(dokploy-env)"'
[[ "$STATE_DIR" == /* && "$STATE_DIR" != "/" ]] || die "STATE_DIR must be a non-root absolute path"
case "$STATE_DIR/" in "$(git rev-parse --show-toplevel 2>/dev/null || true)/"*) die "STATE_DIR must be outside the repository" ;; esac

if [[ "$MODE" != "rollback" ]]; then
  [[ "$IMAGE" =~ ^ghcr\.io/zenod-ai/zenod:sha-[0-9a-f]{7,40}$ ]] ||
    die "IMAGE must be an immutable ghcr.io/zenod-ai/zenod:sha-<7-40 hex> tag"
fi
if [[ "$MODE" != "plan" || "$DRY_RUN" == "0" ]]; then
  [[ "$DRY_RUN" == "0" ]] || die "$MODE requires DRY_RUN=0"
  [[ "$CUTOVER_APPROVED" == "1" ]] || die "$MODE requires CUTOVER_APPROVED=1"
  [[ -n "$APPROVAL_REF" ]] || die "$MODE requires APPROVAL_REF naming the steward instruction"
fi

api_get() {
  curl -fsS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_API_BASE$1"
}

api_post() {
  local endpoint="$1" body="$2" summary="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN POST $endpoint ($summary)"
    if [[ "$endpoint" == "/application.update" ]]; then
      local env_keys
      env_keys="$(jq -r '.env | split("\n") | map(split("=")[0]) | sort | join(",")' <<<"$body")"
      log "DRY_RUN target env keys: $env_keys"
    fi
    return 0
  fi
  curl -fsS -X POST \
    -H "x-api-key: $DOKPLOY_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$DOKPLOY_API_BASE$endpoint" <<<"$body" >/dev/null
}

app_json() { api_get "/application.one?applicationId=$1"; }
compose_json() { api_get "/compose.one?composeId=$1"; }
app_domains() { api_get "/domain.byApplicationId?applicationId=$1"; }
compose_domains() { api_get "/domain.byComposeId?composeId=$1"; }

env_value() {
  local json="$1" key="$2"
  jq -r --arg key "$key" '
    (.env // "") | split("\n") | map(select(startswith($key + "="))) |
    if length == 1 then .[0] | sub("^[^=]+="; "") else empty end
  ' <<<"$json"
}

require_env() {
  local json="$1" key="$2" value
  value="$(env_value "$json" "$key")"
  [[ -n "$value" ]] || die "source compose is missing required $key"
}

build_target_env() {
  local target_json="$1" source_json="$2"
  local existing source
  existing="$(jq -r '.env // ""' <<<"$target_json")"
  source="$(jq -r '.env // ""' <<<"$source_json")"
  jq -nr --arg existing "$existing" --arg source "$source" '
    def parsed($raw):
      $raw | split("\n") | map(select(length > 0) | capture("^(?<key>[^=]+)=(?<value>.*)$")) |
      map({key: .key, value: .value}) | from_entries;
    parsed($existing) as $target | parsed($source) as $src |
    {
      NODE_ENV: $target.NODE_ENV,
      PORT: $target.PORT,
      ZENOD_DATA_DIR: $target.ZENOD_DATA_DIR,
      CHASSIS_VAULT_MASTER_KEY: $target.CHASSIS_VAULT_MASTER_KEY,
      CONTROL_PLANE_TOKEN: $target.CONTROL_PLANE_TOKEN,
      CUSTOMER_APP_URL: "https://cloud.zenod.dev",
      DOMAIN: "https://cloud.zenod.dev",
      GITHUB_OAUTH_CALLBACK_URL: "https://cloud.zenod.dev/auth/github/callback",
      ZENOD_PUBLIC_SITE_HOST: "zenod.dev",
      ZC_COOKIE_DOMAIN: ".zenod.dev",
      STRIPE_MODE: "test",
      GITHUB_OAUTH_CLIENT_ID: $src.GITHUB_OAUTH_CLIENT_ID,
      GITHUB_OAUTH_CLIENT_SECRET: $src.GITHUB_OAUTH_CLIENT_SECRET,
      STRIPE_SECRET_KEY: $src.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: $src.STRIPE_WEBHOOK_SECRET,
      PRICE_MONTHLY: "price_1TrjPC76yJ3p1J6XqXl1QwN8",
      PRICE_YEARLY: "price_1TrjPD76yJ3p1J6XZGkcIQ56"
    } | to_entries | sort_by(.key) | map("\(.key)=\(.value)") | join("\n")
  '
}

build_preserved_target_env() {
  local target_json="$1" existing
  existing="$(jq -r '.env // ""' <<<"$target_json")"
  jq -nr --arg existing "$existing" '
    def parsed($raw):
      $raw | split("\n") | map(select(length > 0) | capture("^(?<key>[^=]+)=(?<value>.*)$")) |
      map({key: .key, value: .value}) | from_entries;
    parsed($existing) as $target | {
      NODE_ENV: $target.NODE_ENV,
      PORT: $target.PORT,
      ZENOD_DATA_DIR: $target.ZENOD_DATA_DIR,
      CHASSIS_VAULT_MASTER_KEY: $target.CHASSIS_VAULT_MASTER_KEY,
      CONTROL_PLANE_TOKEN: $target.CONTROL_PLANE_TOKEN
    } | to_entries | sort_by(.key) | map("\(.key)=\(.value)") | join("\n")
  '
}

domain_id_for_host() { jq -r --arg host "$2" '.[] | select(.host == $host) | .domainId' <<<"$1"; }

assert_preflight() {
  local target="$1" site_domains="$2" cloud_domains="$3" test_domains="$4" target_domains="$5"
  [[ "$(jq -r '.applicationId' <<<"$target")" == "$TARGET_APP" ]] || die "target application drift"
  [[ "$(jq -r '.name' <<<"$target")" == "zenod-mt" ]] || die "target application name drift"
  [[ "$(jq -r '[.mounts[]? | select(.type == "volume" and .volumeName == "zenod-mt-data" and .mountPath == "/data")] | length' <<<"$target")" == "1" ]] ||
    die "target /data volume drift"
  [[ "$(domain_id_for_host "$target_domains" mind.zenod.dev)" == "$MIND_DOMAIN_ID" ]] || die "mind.zenod.dev ownership drift"

  local id
  id="$(domain_id_for_host "$site_domains" zenod.dev)"
  [[ -z "$id" || "$id" == "$ZENOD_DOMAIN_ID" ]] || die "zenod.dev old-owner drift"
  id="$(domain_id_for_host "$cloud_domains" cloud.zenod.dev)"
  [[ -z "$id" || "$id" == "$CLOUD_DOMAIN_ID" ]] || die "cloud.zenod.dev old-owner drift"
  id="$(domain_id_for_host "$test_domains" cloud-test.zenod.dev)"
  [[ -z "$id" || "$id" == "$CLOUD_TEST_DOMAIN_ID" ]] || die "cloud-test.zenod.dev owner drift"
  id="$(domain_id_for_host "$test_domains" zenod.zenod.dev)"
  [[ -z "$id" || "$id" == "$BANNED_DOMAIN_ID" ]] || die "zenod.zenod.dev owner drift"
}

snapshot_once() {
  local target="$1" site="$2" cloud="$3" test="$4" target_domains="$5"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if [[ -f "$STATE_DIR/manifest.json" ]]; then
    [[ "$(jq -r '.target_app' "$STATE_DIR/manifest.json")" == "$TARGET_APP" ]] || die "STATE_DIR belongs to another cutover"
    return 0
  fi
  jq '{applicationId,name,dockerImage,sourceType,buildType,
    env_keys: ((.env // "") | split("\n") | map(select(length > 0) | split("=")[0]) | sort),
    mounts: [.mounts[]? | {mountId,type,volumeName,mountPath,applicationId}]}' <<<"$target" >"$STATE_DIR/target.before.json"
  printf '%s\n' "$site" >"$STATE_DIR/site-domains.before.json"
  printf '%s\n' "$cloud" >"$STATE_DIR/cloud.before.json"
  printf '%s\n' "$test" >"$STATE_DIR/test.before.json"
  printf '%s\n' "$target_domains" >"$STATE_DIR/target-domains.before.json"
  jq -n --arg target_app "$TARGET_APP" --arg approval "$APPROVAL_REF" --arg image "$IMAGE" \
    '{version:1,target_app:$target_app,approval_ref:$approval,requested_image:$image}' >"$STATE_DIR/manifest.json"
  chmod 600 "$STATE_DIR"/*
}

delete_domain_if_present() {
  local domains="$1" host="$2"
  local id="$(domain_id_for_host "$domains" "$host")"
  [[ -n "$id" ]] || { log "domain already absent: $host"; return 0; }
  api_post "/domain.delete" "$(jq -n --arg domainId "$id" '{domainId:$domainId}')" "detach $host ($id)"
}

create_target_domain_if_missing() {
  local target_domains="$1" host="$2"
  [[ -z "$(domain_id_for_host "$target_domains" "$host")" ]] || { log "domain already on target: $host"; return 0; }
  api_post "/domain.create" "$(jq -n --arg host "$host" --arg applicationId "$TARGET_APP" \
    '{host:$host,path:"/",port:8080,https:true,certificateType:"letsencrypt",domainType:"application",applicationId:$applicationId}')" \
    "attach $host to target port 8080"
}

ensure_redirect() {
  local target="$1"
  local regex='^https?://mind\.zenod\.dev(/.*)?$'
  local existing
  existing="$(jq -r --arg regex "$regex" '.redirects[]? | select(.regex == $regex) | .redirectId' <<<"$target")"
  [[ -z "$existing" ]] || { log "mind redirect already present"; return 0; }
  api_post "/redirects.create" "$(jq -n --arg applicationId "$TARGET_APP" --arg regex "$regex" \
    '{applicationId:$applicationId,regex:$regex,replacement:"https://zenod.dev$1",permanent:true}')" \
    "301 mind.zenod.dev to zenod.dev preserving path"
}

health_sha() { jq -r '.sha // .git_sha // .gitSha // empty' <<<"$1"; }

wait_for_deploy() {
  [[ "$DRY_RUN" == "0" ]] || { log "DRY_RUN wait for target health to report expected git SHA"; return 0; }
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) expected="${IMAGE##*:sha-}"
  while (( SECONDS < deadline )); do
    local body sha
    body="$(curl -fsS https://mind.zenod.dev/api/health 2>/dev/null || true)"
    sha="$(health_sha "$body" 2>/dev/null || true)"
    [[ "$sha" == "$expected"* ]] && return 0
    sleep "$HEALTH_POLL_SECONDS"
  done
  die "target did not report image SHA $expected on mind.zenod.dev before domain movement"
}

http_code() { curl -sS -o /dev/null -w '%{http_code}' "$1" || true; }

final_world_ready() {
  local expected="${IMAGE##*:sha-}" body sha location oauth_location mcp_code
  [[ "$(http_code https://zenod.dev/)" == "200" ]] || return 1
  [[ "$(http_code https://zenod.dev/pricing)" == "200" ]] || return 1
  [[ "$(http_code https://cloud.zenod.dev/)" == "200" ]] || return 1
  body="$(curl -fsS https://cloud.zenod.dev/api/health)" || return 1
  sha="$(health_sha "$body")"
  [[ "$sha" == "$expected"* ]] || return 1
  mcp_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' https://cloud.zenod.dev/mcp)"
  [[ "$mcp_code" == "401" ]] || return 1
  oauth_location="$(curl -sS -o /dev/null -D - https://cloud.zenod.dev/auth/signin | awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/, ""); print substr($0,11)}')"
  [[ "$oauth_location" == https://github.com/login/oauth/authorize* ]] || return 1
  [[ "$oauth_location" == *"redirect_uri=https%3A%2F%2Fcloud.zenod.dev%2Fauth%2Fgithub%2Fcallback"* ]] ||
    return 1
  location="$(curl -sS -o /dev/null -D - https://mind.zenod.dev/anything | awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/\r$/, ""); print substr($0,11)}')"
  [[ "$(http_code https://mind.zenod.dev/anything)" == "301" && "$location" == "https://zenod.dev/anything" ]] || return 1
  for host in cloud-test.zenod.dev zenod.zenod.dev; do
    [[ "$(http_code "https://$host/")" =~ ^(404|000)$ ]] || return 1
  done
}

verify_final_world() {
  [[ "$DRY_RUN" == "0" ]] || {
    log "DRY_RUN verify: zenod landing 200; cloud root 200; cloud health expected SHA; cloud MCP 401 challenge; OAuth callback=cloud; mind exact 301; retired hosts not routed"
    return 0
  }
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    final_world_ready && return 0
    sleep "$HEALTH_POLL_SECONDS"
  done
  die "final host health did not converge; run MODE=rollback with the same STATE_DIR or fix and rerun apply"
}

verify_legacy_stopped() {
  [[ "$DRY_RUN" == "0" ]] || { log "DRY_RUN verify old cloud compose hosts no longer serve"; return 0; }
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) code host all_stopped
  while (( SECONDS < deadline )); do
    all_stopped=1
    for host in admin.zenod.dev callisthenes.zenod.dev; do
      code="$(http_code "https://$host/")"
      [[ ! "$code" =~ ^[23] ]] || all_stopped=0
    done
    [[ "$all_stopped" == "1" ]] && return 0
    sleep "$HEALTH_POLL_SECONDS"
  done
  die "an old cloud compose host still serves after stop"
}

apply_cutover() {
  local target source site_domains cloud_domains test_domains target_domains new_env
  target="$(app_json "$TARGET_APP")"
  source="$(compose_json "$SOURCE_COMPOSE")"
  site_domains="$(app_domains "$OLD_SITE_APP")"
  cloud_domains="$(compose_domains "$OLD_CLOUD_COMPOSE")"
  test_domains="$(compose_domains "$OLD_TEST_COMPOSE")"
  target_domains="$(app_domains "$TARGET_APP")"
  assert_preflight "$target" "$site_domains" "$cloud_domains" "$test_domains" "$target_domains"
  for key in NODE_ENV PORT ZENOD_DATA_DIR CHASSIS_VAULT_MASTER_KEY CONTROL_PLANE_TOKEN; do
    require_env "$target" "$key"
  done
  for key in GITHUB_OAUTH_CLIENT_ID GITHUB_OAUTH_CLIENT_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
    require_env "$source" "$key"
  done
  [[ "$(env_value "$source" STRIPE_SECRET_KEY)" == *"_test_"* ]] || die "source Stripe key is not TEST mode"
  new_env="$(build_target_env "$target" "$source")"

  log "PLAN 1/8 snapshot private rollback state; preserve zenod-mt-data:/data and five allowlisted target env values"
  [[ "$DRY_RUN" == "1" ]] || snapshot_once "$target" "$site_domains" "$cloud_domains" "$test_domains" "$target_domains"
  log "PLAN 2/8 allowlist OAuth + Stripe TEST values in-memory; exclude provisioner/watchdog/DNS envs"
  api_post "/application.update" "$(jq -n --arg applicationId "$TARGET_APP" --arg dockerImage "$IMAGE" --arg env "$new_env" \
    '{applicationId:$applicationId,dockerImage:$dockerImage,env:$env}')" "set immutable image + merged env (values redacted)"
  api_post "/application.deploy" "$(jq -n --arg applicationId "$TARGET_APP" \
    '{applicationId:$applicationId,title:"Z-N5 canonical domain cutover"}')" "deploy target before domain movement"
  log "PLAN 3/8 verify target image SHA through existing mind.zenod.dev"
  wait_for_deploy

  log "PLAN 4/8 detach old canonical domains and delete retired/banned routes"
  delete_domain_if_present "$site_domains" zenod.dev
  delete_domain_if_present "$cloud_domains" cloud.zenod.dev
  delete_domain_if_present "$test_domains" cloud-test.zenod.dev
  delete_domain_if_present "$test_domains" zenod.zenod.dev

  log "PLAN 5/8 attach zenod.dev + cloud.zenod.dev to the one target application"
  target_domains="$(app_domains "$TARGET_APP")"
  create_target_domain_if_missing "$target_domains" zenod.dev
  target_domains="$(app_domains "$TARGET_APP")"
  create_target_domain_if_missing "$target_domains" cloud.zenod.dev
  log "PLAN 6/8 configure permanent mind.zenod.dev redirect"
  target="$(app_json "$TARGET_APP")"
  ensure_redirect "$target"

  log "PLAN 7/8 verify landing/customer/app/MCP image, OAuth callback, redirect, and retired hosts"
  verify_final_world
  log "PLAN 8/8 stop old cloud composes only after live health passes"
  api_post "/compose.stop" "$(jq -n --arg composeId "$OLD_CLOUD_COMPOSE" '{composeId:$composeId}')" "stop old cloud compose"
  api_post "/compose.stop" "$(jq -n --arg composeId "$OLD_TEST_COMPOSE" '{composeId:$composeId}')" "stop old cloud-test compose"
  verify_legacy_stopped
  log "cutover sequence complete; old records and volumes retained for rollback"
}

restore_domain() {
  local domains_file="$1" host="$2" owner_kind="$3" owner_id="$4"
  local current row
  if [[ "$owner_kind" == "application" ]]; then
    current="$(app_domains "$owner_id")"
  else
    current="$(compose_domains "$owner_id")"
  fi
  [[ -z "$(domain_id_for_host "$current" "$host")" ]] || { log "rollback domain already restored: $host"; return 0; }
  row="$(jq -c --arg host "$host" '.[] | select(.host == $host)' "$domains_file")"
  [[ -n "$row" ]] || die "rollback snapshot lacks $host"
  local body
  if [[ "$owner_kind" == "application" ]]; then
    body="$(jq --arg applicationId "$owner_id" '. | del(.domainId,.createdAt,.uniqueConfigKey,.composeId,.previewDeploymentId) + {applicationId:$applicationId,domainType:"application"}' <<<"$row")"
  else
    body="$(jq --arg composeId "$owner_id" '. | del(.domainId,.createdAt,.uniqueConfigKey,.applicationId,.previewDeploymentId) + {composeId:$composeId,domainType:"compose"}' <<<"$row")"
  fi
  api_post "/domain.create" "$body" "restore $host to old $owner_kind"
}

rollback_cutover() {
  [[ -f "$STATE_DIR/manifest.json" && -f "$STATE_DIR/target.before.json" ]] || die "rollback STATE_DIR is incomplete"
  local target current_domains redirect_id old_env old_image
  target="$(app_json "$TARGET_APP")"
  current_domains="$(app_domains "$TARGET_APP")"
  log "ROLLBACK 1/6 start old cloud composes before restoring routes"
  api_post "/compose.start" "$(jq -n --arg composeId "$OLD_CLOUD_COMPOSE" '{composeId:$composeId}')" "start old cloud compose"
  api_post "/compose.start" "$(jq -n --arg composeId "$OLD_TEST_COMPOSE" '{composeId:$composeId}')" "start old cloud-test compose"
  log "ROLLBACK 2/6 remove target canonical domains and mind redirect"
  delete_domain_if_present "$current_domains" zenod.dev
  delete_domain_if_present "$current_domains" cloud.zenod.dev
  redirect_id="$(jq -r '.redirects[]? | select(.regex == "^https?://mind\\.zenod\\.dev(/.*)?$") | .redirectId' <<<"$target")"
  [[ -z "$redirect_id" ]] || api_post "/redirects.delete" "$(jq -n --arg redirectId "$redirect_id" '{redirectId:$redirectId}')" "remove mind redirect"
  log "ROLLBACK 3/6 restore all detached domain records"
  restore_domain "$STATE_DIR/site-domains.before.json" zenod.dev application "$OLD_SITE_APP"
  restore_domain "$STATE_DIR/cloud.before.json" cloud.zenod.dev compose "$OLD_CLOUD_COMPOSE"
  restore_domain "$STATE_DIR/test.before.json" cloud-test.zenod.dev compose "$OLD_TEST_COMPOSE"
  restore_domain "$STATE_DIR/test.before.json" zenod.zenod.dev compose "$OLD_TEST_COMPOSE"
  log "ROLLBACK 4/6 restore target image and exact prior env without touching mounts"
  for key in NODE_ENV PORT ZENOD_DATA_DIR CHASSIS_VAULT_MASTER_KEY CONTROL_PLANE_TOKEN; do
    require_env "$target" "$key"
  done
  old_env="$(build_preserved_target_env "$target")"
  old_image="$(jq -r '.dockerImage' "$STATE_DIR/target.before.json")"
  api_post "/application.update" "$(jq -n --arg applicationId "$TARGET_APP" --arg dockerImage "$old_image" --arg env "$old_env" \
    '{applicationId:$applicationId,dockerImage:$dockerImage,env:$env}')" "restore prior image + env (values redacted)"
  api_post "/application.deploy" "$(jq -n --arg applicationId "$TARGET_APP" '{applicationId:$applicationId,title:"Z-N5 rollback"}')" "redeploy prior target"
  log "ROLLBACK 5/6 preserve mind.zenod.dev on target and zenod-mt-data:/data"
  log "ROLLBACK 6/6 operator verifies restored endpoints; snapshot retained at $STATE_DIR"
}

if [[ "${Z_N5_SOURCE_ONLY:-0}" != "1" ]]; then
  case "$MODE" in
    plan|apply) apply_cutover ;;
    rollback) rollback_cutover ;;
  esac
fi
