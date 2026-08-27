#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${PHYLAX_CONTRACT_IMAGE:-zenod-phylax-contract:local}"
platform="${PHYLAX_PLATFORM:-linux/amd64}"
suffix="${USER:-codex}-$$"
container="zpf2-phylax-contract-${suffix}"
mismatch_container="zpf2-phylax-mismatch-${suffix}"
volume="zpf2-phylax-data-${suffix}"
fixed_containers=("zpf2-phylax-zenod-${suffix}" "zpf2-phylax-pm-${suffix}")
fixed_volumes=("zpf2-phylax-zenod-data-${suffix}" "zpf2-phylax-pm-data-${suffix}")
contract_tmp="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" "$mismatch_container" "${fixed_containers[@]}" >/dev/null 2>&1 || true
  docker volume rm "$volume" "${fixed_volumes[@]}" >/dev/null 2>&1 || true
  rm -rf "$contract_tmp"
}
trap cleanup EXIT

session_cookie() {
  local secret="$1" login="$2" github_id="$3"
  node -e '
    const { createHmac } = require("node:crypto");
    const [secret, login, githubId] = process.argv.slice(1);
    const payload = Buffer.from(JSON.stringify({
      github_id: Number(githubId),
      login,
      exp: Date.now() + 600_000,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    process.stdout.write(`zenod_customer_session=${payload}.${signature}`);
  ' "$secret" "$login" "$github_id"
}

if [[ "${PHYLAX_CONTRACT_SKIP_BUILD:-0}" != "1" ]]; then
  docker build --platform "$platform" \
    -f "$repo_root/units/phylax/Dockerfile" \
    -t "$image" "$repo_root"
fi

docker volume create "$volume" >/dev/null
docker run --rm --platform "$platform" --entrypoint sh -v "$volume:/data" "$image" -c \
  'mkdir -p /data/whatsapp/session && printf "%s" "legacy-session-sentinel" > /data/whatsapp/session/contract-sentinel'

common_env=(
  -e CHASSIS_VAULT_MASTER_KEY="$(printf '44%.0s' {1..32})"
  -e ACCOUNT_STATE_SECRET="zpf2-contract-account-state-secret-1234567890"
  -e PUBLIC_SIGNUP_ENABLED=0
  -e PHYLAX_API_TOKEN="phylax_contract_bearer_token"
  -e PHYLAX_PREWARM_LOCAL_MODEL=0
  -e PHYLAX_INSTANCE_MODE=standalone
  -e PHYLAX_INSTANCE_ID=contract-phylax
  -e PHYLAX_SERVICE_NUMBER_ID=contract-number
)

docker run -d --platform "$platform" --name "$container" -P -v "$volume:/data" \
  "${common_env[@]}" "$image" >/dev/null

refresh_base_url() {
  local port
  port="$(docker port "$container" 8080/tcp | head -n 1 | awk -F: '{print $NF}')"
  base_url="http://127.0.0.1:${port}"
}
refresh_base_url

wait_for_health() {
  local attempt
  for attempt in {1..120}; do
    if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$base_url/api/health" 2>/dev/null || true)" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  return 1
}

probe() {
  local method="$1" path="$2" expected="$3" status
  local args=(-sS -o /dev/null -w '%{http_code}' --max-time 5 -X "$method")
  if [[ "$method" == "POST" || "$method" == "PUT" ]]; then
    args+=(-H 'content-type: application/json' --data '{}')
  fi
  status="$(curl "${args[@]}" "$base_url$path")"
  if [[ "$status" != "$expected" ]]; then
    echo "expected $method $path -> $expected, got $status" >&2
    return 1
  fi
}

assert_surface() {
  probe GET /api/health 200
  probe GET /api/auth/status 200
  probe GET /api/me 401
  probe GET /api/console/account 401
  probe POST /create-checkout-session 401
  probe POST /api/billing/portal 401
  probe GET /checkout/complete 303
  probe POST /webhook 503
  probe GET /api/phylax/settings 401
  probe GET /api/phylax/admin/metering 404

  probe POST /api/ask 404
  probe POST /api/chat 404
  probe GET /api/drive/status 404
  probe POST /api/store 404
  probe GET /api/vault 404
  probe PUT /api/vault/repository 404
  probe GET /api/github/app/start 404
  probe GET /api/github/app/setup 404
  probe GET /api/github/app/start/setup 404
  probe GET /github/setup 404
  probe GET /api/public/production-readiness 404
  probe GET /api/customer-usage 404
  probe GET /api/customer-managed-ai/jobs/example 404

  local customer_html
  customer_html="$(curl -fsS --max-time 5 "$base_url/app")"
  if ! grep -Fq '<div id="root"></div>' <<<"$customer_html"; then
    echo "dedicated Phylax customer HTML is missing" >&2
    return 1
  fi
  if grep -Eiq 'Zenod account|Talk to Zenod|Vault &amp; sources' <<<"$customer_html"; then
    echo "Zenod customer copy leaked into the Phylax artifact" >&2
    return 1
  fi
  # Anonymous callers never receive the owner SPA. The backend boundary is
  # authoritative; client-side routing is only a second line of separation.
  probe GET /admin 404
}

wait_for_health
assert_surface
docker exec "$container" sh -c '
  test -d /app/apps/phylax-web/dist
  test ! -e /app/apps/web/dist
  ! grep -R -E -i "Zenod account|Talk to Zenod|Vault & sources" /app/apps/phylax-web/dist
'
docker exec "$container" node -e '
  const fs = require("node:fs");
  const identity = JSON.parse(fs.readFileSync("/data/phylax-instance.json", "utf8"));
  const expected = { instanceId: "contract-phylax", mode: "standalone", serviceNumberId: "contract-number" };
  if (JSON.stringify(identity) !== JSON.stringify(expected)) throw new Error(`identity mismatch: ${JSON.stringify(identity)}`);
  if (fs.readFileSync("/data/whatsapp/session/contract-sentinel", "utf8") !== "legacy-session-sentinel") {
    throw new Error("legacy session sentinel changed");
  }
'

docker restart "$container" >/dev/null
refresh_base_url
wait_for_health
assert_surface
docker rm -f "$container" >/dev/null

docker run -d --platform "$platform" --name "$mismatch_container" -v "$volume:/data" \
  "${common_env[@]}" \
  -e PHYLAX_INSTANCE_MODE=zenod \
  -e PHYLAX_INSTANCE_ID=wrong-phylax \
  -e PHYLAX_SERVICE_NUMBER_ID=wrong-number \
  "$image" >/dev/null
for _attempt in {1..20}; do
  if [[ "$(docker inspect -f '{{.State.Running}}' "$mismatch_container")" == "false" ]]; then
    break
  fi
  sleep 0.5
done
if [[ "$(docker inspect -f '{{.State.Running}}' "$mismatch_container")" != "false" ]]; then
  echo "mismatched identity container did not fail before runtime startup" >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.State.ExitCode}}' "$mismatch_container")" == "0" ]]; then
  echo "mismatched identity container exited successfully" >&2
  exit 1
fi
docker logs "$mismatch_container" 2>&1 | grep -F "Phylax data volume is bound to contract-phylax/standalone/contract-number" >/dev/null
docker run --rm --platform "$platform" --entrypoint sh -v "$volume:/data" "$image" -c \
  'test "$(cat /data/whatsapp/session/contract-sentinel)" = "legacy-session-sentinel"'

for index in 0 1; do
  mode="${fixed_containers[$index]#zpf2-phylax-}"
  mode="${mode%-${suffix}}"
  fixed_container="${fixed_containers[$index]}"
  fixed_volume="${fixed_volumes[$index]}"
  docker volume create "$fixed_volume" >/dev/null
  docker run -d --platform "$platform" --name "$fixed_container" -P -v "$fixed_volume:/data" \
    -e CHASSIS_VAULT_MASTER_KEY="$(printf '55%.0s' {1..32})" \
    -e ACCOUNT_STATE_SECRET="zpf2-fixed-${mode}-account-state-secret" \
    -e PUBLIC_SIGNUP_ENABLED=0 \
    -e PHYLAX_API_TOKEN="phylax_fixed_${mode}_bearer_token" \
    -e PHYLAX_PREWARM_LOCAL_MODEL=0 \
    -e PHYLAX_INSTANCE_MODE="$mode" \
    -e PHYLAX_INSTANCE_ID="contract-${mode}" \
    -e PHYLAX_SERVICE_NUMBER_ID="contract-${mode}-number" \
    "$image" >/dev/null
  fixed_port="$(docker port "$fixed_container" 8080/tcp | head -n 1 | awk -F: '{print $NF}')"
  fixed_base_url="http://127.0.0.1:${fixed_port}"
  for _attempt in {1..120}; do
    if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$fixed_base_url/api/health" 2>/dev/null || true)" == "200" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$fixed_base_url/api/health" 2>/dev/null || true)" != "200" ]]; then
    docker logs "$fixed_container" >&2 || true
    exit 1
  fi
  for route in / /app /auth/signin /api/me /api/console/account /buy /checkout/complete /api/channels /api/phylax/settings; do
    status="$(curl -sS -o /tmp/zpf2-fixed-body-$$ -w '%{http_code}' --max-time 5 "$fixed_base_url$route")"
    if [[ "$status" != "404" ]]; then
      echo "fixed $mode unexpectedly served $route with status $status" >&2
      exit 1
    fi
    if grep -Eiq 'Sign in with GitHub|Choose your Phylax plan|One destination only|downstream agent binding|<div id="root"></div>' /tmp/zpf2-fixed-body-$$; then
      echo "fixed $mode leaked the standalone customer shell on $route" >&2
      exit 1
    fi
  done
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'content-type: application/json' --data '{}' "$fixed_base_url/create-checkout-session")"
  [[ "$status" == "404" ]] || { echo "fixed $mode mounted checkout: $status" >&2; exit 1; }
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X PUT -H 'content-type: application/json' --data '{"downstreamUrl":"https://hostile.invalid/mcp"}' "$fixed_base_url/api/phylax/settings")"
  [[ "$status" == "404" ]] || { echo "fixed $mode mounted arbitrary downstream settings: $status" >&2; exit 1; }
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$fixed_base_url/admin")"
  [[ "$status" == "404" ]] || { echo "fixed $mode exposed owner UI anonymously: $status" >&2; exit 1; }
  fixed_secret="zpf2-fixed-${mode}-account-state-secret"
  owner_cookie="$(session_cookie "$fixed_secret" alfablok 1)"
  product_cookie="$(session_cookie "$fixed_secret" product-customer 2)"
  admin_html="$contract_tmp/${mode}-admin.html"
  status="$(curl -sS -o "$admin_html" -w '%{http_code}' --max-time 5 -H "Cookie: $owner_cookie" "$fixed_base_url/admin")"
  [[ "$status" == "200" ]] || { echo "fixed $mode owner UI unavailable: $status" >&2; exit 1; }
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "Cookie: $product_cookie" "$fixed_base_url/admin")"
  [[ "$status" == "404" ]] || { echo "fixed $mode exposed owner UI to a product customer: $status" >&2; exit 1; }

  asset_list="$contract_tmp/${mode}-assets.txt"
  node -e '
    const html = require("node:fs").readFileSync(process.argv[1], "utf8");
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
      .map((match) => match[1]);
    process.stdout.write([...new Set(assets)].join("\n"));
  ' "$admin_html" > "$asset_list"
  [[ -s "$asset_list" ]] || { echo "fixed $mode owner UI referenced no JS/CSS assets" >&2; exit 1; }
  while IFS= read -r asset; do
    [[ "$asset" == /assets/* ]] || { echo "fixed $mode owner UI referenced unexpected asset URL: $asset" >&2; exit 1; }
    asset_headers="$contract_tmp/${mode}-$(basename "${asset%%\?*}").headers"
    status="$(curl -sS -D "$asset_headers" -o /dev/null -w '%{http_code}' --max-time 5 -H "Cookie: $owner_cookie" "$fixed_base_url$asset")"
    [[ "$status" == "200" ]] || { echo "fixed $mode owner asset unavailable ($asset): $status" >&2; exit 1; }
    case "${asset%%\?*}" in
      *.js) grep -Eiq '^content-type:.*javascript' "$asset_headers" || { echo "fixed $mode JS asset has wrong content type: $asset" >&2; exit 1; } ;;
      *.css) grep -Eiq '^content-type:.*text/css' "$asset_headers" || { echo "fixed $mode CSS asset has wrong content type: $asset" >&2; exit 1; } ;;
    esac
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$fixed_base_url$asset")"
    [[ "$status" == "404" ]] || { echo "fixed $mode exposed owner asset anonymously ($asset): $status" >&2; exit 1; }
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H "Cookie: $product_cookie" "$fixed_base_url$asset")"
    [[ "$status" == "404" ]] || { echo "fixed $mode exposed owner asset to a product customer ($asset): $status" >&2; exit 1; }
  done < "$asset_list"
  rm -f /tmp/zpf2-fixed-body-$$
done

echo "Phylax image contract passed: standalone customer surface, fixed owner-gated admin assets, fixed-mode isolation, immutable identity, restart, mismatch, and legacy data preservation."
