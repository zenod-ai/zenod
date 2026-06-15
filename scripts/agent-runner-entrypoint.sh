#!/usr/bin/env bash
# Idempotently provision X MCP client config on agent-runner startup, then hand
# off to the original CMD.
#
#   Codex  -> $CODEX_HOME/config.toml  ->  read-only X endpoint (autonomous workers)
#   Claude -> $HOME/.claude.json       ->  post+read X endpoint (attended use)
#
# Why an entrypoint and not files baked into the image: CODEX_HOME and HOME live on
# named volumes that shadow image content on already-provisioned runners, so the
# config must be (re)applied at runtime. Both writes are idempotent. Provisioning is
# best-effort — a failure here logs a warning but never blocks the runner from
# coming up.
set -uo pipefail

log() { printf '[agent-runner-entrypoint] %s\n' "$*" >&2; }

CODEX_HOME="${CODEX_HOME:-/runner/codex-home}"
CLAUDE_CONFIG="${HOME:-/runner}/.claude.json"
X_MCP_READONLY_URL="${X_MCP_READONLY_URL:-http://x-mcp-readonly:8000/mcp}"
X_MCP_POSTREAD_URL="${X_MCP_POSTREAD_URL:-http://x-mcp-postread:8000/mcp}"

BEGIN_MARK="# >>> zenod x-mcp (managed) >>>"
END_MARK="# <<< zenod x-mcp (managed) <<<"

provision_codex() {
  local config="${CODEX_HOME}/config.toml"
  mkdir -p "${CODEX_HOME}"
  touch "${config}"

  local block
  block="$(cat <<EOF
${BEGIN_MARK}
[mcp_servers.x]
url = "${X_MCP_READONLY_URL}"
startup_timeout_sec = 30
tool_timeout_sec = 120
${END_MARK}
EOF
)"

  # Strip any existing managed region, then append a fresh one (idempotent).
  local tmp
  tmp="$(mktemp)"
  awk -v b="${BEGIN_MARK}" -v e="${END_MARK}" '
    $0==b {skip=1}
    skip { if ($0==e) skip=0; next }
    {print}
  ' "${config}" > "${tmp}"
  printf '\n%s\n' "${block}" >> "${tmp}"
  mv "${tmp}" "${config}"
  log "codex: wrote [mcp_servers.x] -> ${X_MCP_READONLY_URL}"
}

provision_claude() {
  mkdir -p "$(dirname "${CLAUDE_CONFIG}")"
  # Start from {} if the file is missing or not valid JSON; otherwise merge in
  # place so any existing Claude config is preserved.
  if ! jq empty "${CLAUDE_CONFIG}" >/dev/null 2>&1; then
    echo '{}' > "${CLAUDE_CONFIG}"
  fi
  local tmp
  tmp="$(mktemp)"
  jq --arg url "${X_MCP_POSTREAD_URL}" \
     '.mcpServers = (.mcpServers // {}) | .mcpServers.x = {"type":"http","url":$url}' \
     "${CLAUDE_CONFIG}" > "${tmp}" && mv "${tmp}" "${CLAUDE_CONFIG}"
  log "claude: wrote mcpServers.x -> ${X_MCP_POSTREAD_URL}"
}

provision_codex  || log "WARN: codex X MCP config provisioning failed (continuing)"
provision_claude || log "WARN: claude X MCP config provisioning failed (continuing)"

exec "$@"
