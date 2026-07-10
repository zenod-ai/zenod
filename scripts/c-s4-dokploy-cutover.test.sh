#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/c-s4-dokploy-cutover.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
bash -n "$SCRIPT"

expect_failure() {
  local expected="$1"; shift
  local output
  ! output="$("$@" 2>&1)" || { echo "expected failure" >&2; exit 1; }
  grep -Fq "$expected" <<<"$output"
}
expect_failure TARGET_COMPOSE_ID env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 bash "$SCRIPT"
expect_failure 'protected id refused' env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 \
  TARGET_COMPOSE_ID=oN6m6iGwRkDgc0C0WYvbD bash "$SCRIPT"
expect_failure CUTOVER_APPROVED env DOKPLOY_API_KEY=x EXPECTED_SHA=abcdef0 TARGET_COMPOSE_ID=new-calli \
  MODE=apply DRY_RUN=0 bash "$SCRIPT"

FAKE="$TMP/bin"; LOG="$TMP/calls"; mkdir -p "$FAKE"
cat >"$FAKE/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${@: -1}"; printf '%s\n' "$url" >>"$C_S4_FAKE_LOG"
case "$url" in
  */compose.one*new-calli*) printf '%s\n' '{"composeId":"new-calli","name":"callisthenes","env":"CHASSIS_VAULT_MASTER_KEY=vault\nCONTROL_PLANE_TOKEN=control","composeStatus":"done"}';;
  */application.one*2dkayH_eAur427leH64MT*) printf '%s\n' '{"applicationId":"2dkayH_eAur427leH64MT","name":"zenod-mt","env":"GITHUB_OAUTH_CLIENT_ID=gid\nGITHUB_OAUTH_CLIENT_SECRET=gsecret\nSTRIPE_SECRET_KEY=sk_test_secret\nSTRIPE_WEBHOOK_SECRET=whsec_secret\nPRICE_MONTHLY=price_month\nPRICE_YEARLY=price_year"}';;
  */compose.one*NYUUcRopSdjmfRGoEWzHL*) printf '%s\n' '{"composeId":"NYUUcRopSdjmfRGoEWzHL","name":"x-mcp","env":"X_OAUTH_CONSUMER_KEY=xkey\nX_OAUTH_CONSUMER_SECRET=xsecret\nX_BEARER_TOKEN=xbearer"}';;
  */domain.byComposeId*new-calli*) printf '%s\n' '[]';;
  *) printf '%s\n' '{"ok":true}';;
esac
EOF
chmod +x "$FAKE/curl"

output="$(PATH="$FAKE:$PATH" C_S4_FAKE_LOG="$LOG" DOKPLOY_API_KEY=x DOKPLOY_API_BASE=http://fake \
  EXPECTED_SHA=abcdef0 TARGET_COMPOSE_ID=new-calli STATE_DIR="$TMP/state" bash "$SCRIPT" 2>&1)"
grep -Fq 'PLAN 1/4' <<<"$output"; grep -Fq 'PLAN 4/4' <<<"$output"
grep -Fq 'attach calli.zenod.dev to calli-front:8080' <<<"$output"
grep -Fq 'DRY_RUN verify / 200' <<<"$output"
grep -Fq 'ACCOUNT_STATE_SECRET,CALLISTHENES_THROTTLE_PER_HOUR,CHASSIS_VAULT_MASTER_KEY,CONTROL_PLANE_TOKEN,GITHUB_OAUTH_CLIENT_ID,GITHUB_OAUTH_CLIENT_SECRET,PRICE_MONTHLY,PRICE_YEARLY,STRIPE_MODE,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET,X_BEARER_TOKEN,X_OAUTH_CONSUMER_KEY,X_OAUTH_CONSUMER_SECRET' <<<"$output"
! grep -Eq 'gsecret|sk_test_secret|whsec_secret|xsecret|xbearer|vault|control' <<<"$output"
! grep -Eq '/compose\.(stop|start)|application\.(update|deploy)' "$LOG"
[[ ! -e "$TMP/state" ]]

echo 'C-S4 guarded cutover contract tests passed'
