#!/usr/bin/env bash
# Idempotently provision MCP client config on agent-runner startup, then hand off
# to the original CMD.
#
#   Codex  -> $CODEX_HOME/config.toml  ->  Console gateway + X endpoint
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
# Console MCP gateway: one endpoint that republishes enabled suite agents'
# curated semantic tools. Bearer = the Console instance's own api_token, carried
# in ZENOD_CONSOLE_TOKEN. Do not use ZENOD_API_TOKEN here; that belongs to Zenod.
ZENOD_CONSOLE_MCP_URL="${ZENOD_CONSOLE_MCP_URL:-${ZENOD_CONSOLE_URL:-http://zenod-console:8080}/mcp}"

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

[mcp_servers.console]
url = "${ZENOD_CONSOLE_MCP_URL}"
bearer_token_env_var = "ZENOD_CONSOLE_TOKEN"
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
  log "codex: wrote [mcp_servers.console] -> ${ZENOD_CONSOLE_MCP_URL}"
}

provision_claude() {
  # Claude Code reads its config from CLAUDE_CONFIG_DIR (not $HOME/.claude.json), so
  # use the official `claude mcp add --scope user` — it writes to the right place and
  # the headless worker (`claude -p`, non-bare) auto-loads user-scope MCP servers
  # regardless of which worktree cwd it runs in. Idempotent (remove-then-add).
  command -v claude >/dev/null 2>&1 || { log "claude: not installed, skipping MCP provisioning"; return 0; }
  # Console MCP gateway: gives the worker the suite's curated semantic tools
  # (search_memory/get_memory/ask_zenod, execution_status, etc.) so a code/research
  # run can consult the vault and backlog mid-task. Bearer = the Console api_token.
  claude mcp remove console --scope user >/dev/null 2>&1 || true
  if [ -n "${ZENOD_CONSOLE_TOKEN:-}" ]; then
    if claude mcp add --transport http --scope user console "${ZENOD_CONSOLE_MCP_URL}" \
         --header "Authorization: Bearer ${ZENOD_CONSOLE_TOKEN}" >/dev/null 2>&1; then
      log "claude: added mcp 'console' -> ${ZENOD_CONSOLE_MCP_URL}"
    else
      log "WARN: claude mcp add console failed"
      return 1
    fi
  else
    log "claude: ZENOD_CONSOLE_TOKEN unset — skipping console MCP"
  fi
}

provision_codex  || log "WARN: codex X MCP config provisioning failed (continuing)"
provision_claude || log "WARN: claude X MCP config provisioning failed (continuing)"

exec "$@"
