#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/z-n5-dokploy-cutover.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bash -n "$SCRIPT"

health_sha="$({
  Z_N5_SOURCE_ONLY=1 \
  DOKPLOY_API_KEY=test-only \
  IMAGE=ghcr.io/zenod-ai/zenod:sha-abcdef0 \
  STATE_DIR="$TMP/source-state" \
  source "$SCRIPT"
  health_sha '{"status":"ok","sha":"abcdef0123456789","git_sha":"wrong"}'
})"
[[ "$health_sha" == "abcdef0123456789" ]]

redirect_body="$({
  Z_N5_SOURCE_ONLY=1 \
  DOKPLOY_API_KEY=test-only \
  IMAGE=ghcr.io/zenod-ai/zenod:sha-abcdef0 \
  STATE_DIR="$TMP/source-state" \
  source "$SCRIPT"
  api_post() { printf '%s\n' "$2"; }
  ensure_redirect '{"redirects":[]}'
})"
[[ "$(jq -r '.regex' <<<"$redirect_body")" == '^https?://mind\.zenod\.dev(/.*)?$' ]]
[[ "$(jq -r '.replacement' <<<"$redirect_body")" == 'https://zenod.dev$1' ]]
[[ "$(jq -r '.permanent' <<<"$redirect_body")" == 'true' ]]
grep -Fq '"https://zenod.dev/anything"' "$SCRIPT"

expect_failure() {
  local expected="$1"; shift
  local output
  if output="$("$@" 2>&1)"; then
    echo "expected failure containing: $expected" >&2
    exit 1
  fi
  grep -Fq "$expected" <<<"$output" || { printf '%s\n' "$output" >&2; exit 1; }
}

expect_failure "DOKPLOY_API_KEY is required" env IMAGE=ghcr.io/zenod-ai/zenod:sha-abcdef0 bash "$SCRIPT"
expect_failure "immutable" env DOKPLOY_API_KEY=x IMAGE=latest bash "$SCRIPT"
expect_failure "CUTOVER_APPROVED=1" env MODE=apply DRY_RUN=0 DOKPLOY_API_KEY=x \
  IMAGE=ghcr.io/zenod-ai/zenod:sha-abcdef0 bash "$SCRIPT"

FAKE_BIN="$TMP/bin"
FAKE_LOG="$TMP/calls.log"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${@: -1}"
printf '%s\n' "$url" >>"$Z_N5_FAKE_LOG"
case "$url" in
  */application.one*2dkayH_eAur427leH64MT*)
    printf '%s\n' '{"applicationId":"2dkayH_eAur427leH64MT","name":"zenod-mt","applicationStatus":"done","dockerImage":"ghcr.io/zenod-ai/zenod:sha-old0000","env":"NODE_ENV=production\nPORT=8080\nZENOD_DATA_DIR=/data\nCHASSIS_VAULT_MASTER_KEY=target-only\nCONTROL_PLANE_TOKEN=tenant-only","mounts":[{"type":"volume","volumeName":"zenod-mt-data","mountPath":"/data"}],"redirects":[]}'
    ;;
  */compose.one*wP2PWUnRL1VnKUMfwHDPj*)
    printf '%s\n' '{"composeId":"wP2PWUnRL1VnKUMfwHDPj","env":"GITHUB_OAUTH_CLIENT_ID=oauth-id\nGITHUB_OAUTH_CLIENT_SECRET=oauth-secret\nSTRIPE_SECRET_KEY=sk_test_secret\nSTRIPE_WEBHOOK_SECRET=whsec_secret\nPRICE_STARTER=must-not-copy\nPRICE_PRO=must-not-copy\nDOKPLOY_API_KEY=must-not-copy\nWATCHDOG_TOKEN=must-not-copy\nZENOD_AUTO_PROVISION=1\nOLD_CONSOLE_PASSWORD=must-not-copy"}'
    ;;
  */domain.byApplicationId*2dkayH_eAur427leH64MT*)
    printf '%s\n' '[{"domainId":"a1jRaYz8gbNLRIaf7AEfH","host":"mind.zenod.dev","path":"/","port":8080,"https":true,"certificateType":"letsencrypt","applicationId":"2dkayH_eAur427leH64MT","domainType":"application"}]'
    ;;
  */domain.byApplicationId*bSGHEi-7-i9VdjP3QQSDi*)
    printf '%s\n' '[{"domainId":"fw_6ibKlyvtozD92hPHg7","host":"zenod.dev","path":"/","port":80,"https":true,"certificateType":"letsencrypt","applicationId":"bSGHEi-7-i9VdjP3QQSDi","domainType":"application"},{"domainId":"ring","host":"ring.zenod.dev"}]'
    ;;
  */domain.byComposeId*17QoMFRgvmZ0Y2n19DINT*)
    printf '%s\n' '[{"domainId":"ogCtEMVhudMSC80pJJm5M","host":"cloud.zenod.dev","path":"/","port":4242,"https":true,"certificateType":"letsencrypt","serviceName":"webhook","composeId":"17QoMFRgvmZ0Y2n19DINT","domainType":"compose"}]'
    ;;
  */domain.byComposeId*wP2PWUnRL1VnKUMfwHDPj*)
    printf '%s\n' '[{"domainId":"OQA2mW6eiWdNdACzMLPw7","host":"cloud-test.zenod.dev","path":"/","port":4242,"https":true,"certificateType":"letsencrypt","serviceName":"webhook","composeId":"wP2PWUnRL1VnKUMfwHDPj","domainType":"compose"},{"domainId":"Z_hbr8dWYf5D7xoVpv6pQ","host":"zenod.zenod.dev","path":"/","port":4242,"https":true,"certificateType":"letsencrypt","serviceName":"webhook","composeId":"wP2PWUnRL1VnKUMfwHDPj","domainType":"compose"}]'
    ;;
  *) printf '%s\n' '{"ok":true}' ;;
esac
EOF
chmod +x "$FAKE_BIN/curl"

output="$(PATH="$FAKE_BIN:$PATH" Z_N5_FAKE_LOG="$FAKE_LOG" DOKPLOY_API_KEY=test-only \
  DOKPLOY_API_BASE=http://fake IMAGE=ghcr.io/zenod-ai/zenod:sha-abcdef0 \
  STATE_DIR="$TMP/state" bash "$SCRIPT" 2>&1)"

grep -Fq 'PLAN 1/8' <<<"$output"
grep -Fq 'PLAN 8/8' <<<"$output"
grep -Fq 'DRY_RUN target env keys: CHASSIS_VAULT_MASTER_KEY,CONTROL_PLANE_TOKEN,CUSTOMER_APP_URL,DOMAIN,GITHUB_OAUTH_CALLBACK_URL,GITHUB_OAUTH_CLIENT_ID,GITHUB_OAUTH_CLIENT_SECRET,NODE_ENV,PORT,PRICE_MONTHLY,PRICE_YEARLY,STRIPE_MODE,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET,ZC_COOKIE_DOMAIN,ZENOD_DATA_DIR,ZENOD_PUBLIC_SITE_HOST' <<<"$output"
grep -Fq 'detach zenod.dev' <<<"$output"
grep -Fq 'detach cloud.zenod.dev' <<<"$output"
grep -Fq 'detach cloud-test.zenod.dev' <<<"$output"
grep -Fq 'detach zenod.zenod.dev' <<<"$output"
grep -Fq 'attach zenod.dev to target' <<<"$output"
grep -Fq 'attach cloud.zenod.dev to target' <<<"$output"
grep -Fq '301 mind.zenod.dev to zenod.dev preserving path' <<<"$output"
grep -Fq 'verify: zenod landing 200' <<<"$output"
grep -Fq 'stop old cloud compose' <<<"$output"
grep -Fq 'stop old cloud-test compose' <<<"$output"
grep -Fq 'verify old cloud compose hosts no longer serve' <<<"$output"
[[ ! -e "$TMP/state" ]]
! grep -Eq 'oauth-secret|sk_test_secret|whsec_secret|target-only|tenant-only|must-not-copy' <<<"$output"
! grep -Eq 'oauth-secret|sk_test_secret|whsec_secret|target-only|tenant-only|must-not-copy' "$FAKE_LOG"

printf 'Z-N5 cutover contract tests passed\n'
