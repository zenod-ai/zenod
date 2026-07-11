#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/p-s4-dokploy-cutover.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
bash -n "$SCRIPT"

expect_failure() {
  local expected="$1"; shift
  local output
  ! output="$("$@" 2>&1)" || { echo "expected failure" >&2; exit 1; }
  grep -Fq "$expected" <<<"$output"
}
expect_failure TARGET_APP_ID env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 bash "$SCRIPT"
for protected in 2dkayH_eAur427leH64MT uCoS_Zr0qKZyQHu4UDVjx hkdStWh6zfJ9d-uohdJHt; do
  expect_failure 'protected/source application id refused' env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 TARGET_APP_ID="$protected" bash "$SCRIPT"
done
expect_failure CUTOVER_APPROVED env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 TARGET_APP_ID=new-phylax MODE=apply DRY_RUN=0 bash "$SCRIPT"

FAKE="$TMP/bin"; LOG="$TMP/calls"; mkdir -p "$FAKE"
cat >"$FAKE/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${@: -1}"; printf '%s\n' "$url" >>"$P_S4_FAKE_LOG"
case "$url" in
  */application.one*new-phylax*) printf '%s\n' '{"applicationId":"new-phylax","name":"phylax","dockerImage":"old","env":"ACCOUNT_STATE_SECRET=state\nCHASSIS_VAULT_MASTER_KEY=vault\nCONTROL_PLANE_TOKEN=control\nPHYLAX_FULL_CUSTOMER_UNIT=1","mounts":[{"mountId":"m1","type":"volume","volumeName":"phylax-data-new","mountPath":"/data","applicationId":"new-phylax"}]}' ;;
  */application.one*2dkayH_eAur427leH64MT*) printf '%s\n' '{"applicationId":"2dkayH_eAur427leH64MT","name":"zenod-mt","env":"GITHUB_OAUTH_CLIENT_ID=gid\nGITHUB_OAUTH_CLIENT_SECRET=gsecret\nSTRIPE_SECRET_KEY=sk_test_secret\nSTRIPE_WEBHOOK_SECRET=whsec_secret\nPRICE_MONTHLY=price_month\nPRICE_YEARLY=price_year"}' ;;
  */domain.byApplicationId*new-phylax*) printf '%s\n' '[]' ;;
  *) printf '%s\n' '{"ok":true}' ;;
esac
EOF
chmod +x "$FAKE/curl"

output="$(PATH="$FAKE:$PATH" P_S4_FAKE_LOG="$LOG" DOKPLOY_API_KEY=x DOKPLOY_API_BASE=http://fake \
  EXPECTED_SHA=abcdef0 TARGET_APP_ID=new-phylax STATE_DIR="$TMP/state" bash "$SCRIPT" 2>&1)"
grep -Fq 'PLAN 1/4' <<<"$output"; grep -Fq 'PLAN 4/4' <<<"$output"
grep -Fq 'attach phylax.zenod.dev only to the new full-customer application' <<<"$output"
grep -Fq 'exact-SHA /api/health' <<<"$output"
grep -Fq 'ACCOUNT_STATE_SECRET,CHASSIS_VAULT_MASTER_KEY,CONTROL_PLANE_TOKEN,CUSTOMER_APP_URL,DOMAIN,GITHUB_OAUTH_CALLBACK_URL,GITHUB_OAUTH_CLIENT_ID,GITHUB_OAUTH_CLIENT_SECRET,GIT_SHA,NODE_ENV,PHYLAX_ADMIN_GITHUB_LOGIN,PHYLAX_FULL_CUSTOMER_UNIT,PHYLAX_SITE_DIST,PORT,PRICE_MONTHLY,PRICE_YEARLY,STRIPE_MODE,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET,ZC_COOKIE_DOMAIN,ZENOD_DATA_DIR,ZENOD_UNIT,ZENOD_WEB_DIST' <<<"$output"
! grep -Eq 'gsecret|sk_test_secret|whsec_secret|vault|control|state' <<<"$output"
! grep -Eq '/(compose|application)\.(stop|start)' "$LOG"
[[ ! -e "$TMP/state" ]]

compose_json="$(env GIT_SHA=abcdef0 GITHUB_OAUTH_CLIENT_ID=x GITHUB_OAUTH_CLIENT_SECRET=x \
  ACCOUNT_STATE_SECRET=x STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=x \
  PRICE_MONTHLY=price_x PRICE_YEARLY=price_y CHASSIS_VAULT_MASTER_KEY=x \
  CONTROL_PLANE_TOKEN=x docker compose -f "$ROOT/units/phylax/docker-compose.phylax.yml" config --format json)"
[[ "$(jq -r '.networks["dokploy-network"].external' <<<"$compose_json")" == true ]]
[[ "$(jq -r '.services.phylax.networks|keys|join(",")' <<<"$compose_json")" == dokploy-network ]]
[[ "$(jq -r '.services.phylax.ports // [] | length' <<<"$compose_json")" == 0 ]]
[[ "$(jq -r '.services.phylax.expose|join(",")' <<<"$compose_json")" == 8080 ]]
[[ "$(jq -r '.services.phylax.environment.ZENOD_UNIT' <<<"$compose_json")" == phylax ]]
[[ "$(jq -r '.services.phylax.environment.PHYLAX_FULL_CUSTOMER_UNIT' <<<"$compose_json")" == 1 ]]
[[ "$(jq -r '.services.phylax.environment.PHYLAX_SITE_DIST' <<<"$compose_json")" == /app/apps/phylax-site/dist ]]
[[ "$(jq -r '.services.phylax.volumes|length' <<<"$compose_json")" == 1 ]]

echo 'P-S4 guarded cutover contract tests passed'
