#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${PHYLAX_CONTRACT_IMAGE:-zenod-phylax-contract:local}"
platform="${PHYLAX_PLATFORM:-linux/amd64}"
suffix="${USER:-codex}-$$"
container="zpf2-phylax-contract-${suffix}"
mismatch_container="zpf2-phylax-mismatch-${suffix}"
volume="zpf2-phylax-data-${suffix}"

cleanup() {
  docker rm -f "$container" "$mismatch_container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
}

wait_for_health
assert_surface
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

echo "Phylax image contract passed: exact customer surface, immutable identity, restart, mismatch, and legacy data preservation."
