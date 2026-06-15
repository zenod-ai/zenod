# X (Twitter) MCP service

Vendored [`xdevplatform/xmcp`](https://github.com/xdevplatform/xmcp) — a FastMCP server
exposing the X API as MCP tools — pinned by commit and patched to run headless so Zenod's
agents can read X and (in an attended path) post on your behalf.

- **Transport:** FastMCP `http` = Streamable HTTP at `$MCP_HOST:$MCP_PORT/mcp`. Codex 0.137+
  and Claude CLI connect directly; no SSE bridge needed.
- **Pin:** `XMCP_REF` in `Dockerfile` / `docker-compose.x-mcp.yml` (a commit SHA, never a branch).
- **Headless patch:** `headless-oauth1.patch` makes the server sign requests with the OAuth1
  user access token/secret from env instead of opening a browser for consent on startup.

## Why two instances

Posting is **gated by topology**, because autonomous Codex workers run with approvals
bypassed and can't be trusted to a prompt-level gate:

| Instance | Allowlist | Consumed by | Can post? |
|---|---|---|---|
| `x-mcp-readonly` | read operationIds only | Codex fan-out (autonomous) | No |
| `x-mcp-postread` | read + `createTweet`/`deleteTweetById` | Claude CLI (attended) | Yes |

Both authenticate as the **same** user via long-lived OAuth1 tokens, so sharing one X app's
credentials across both instances is fine — OAuth1 access tokens don't expire or rotate, so
there's no refresh contention.

## One-time setup

1. **X developer app.** In the [X developer portal](https://developer.x.com), create/select an
   app with **Read and Write** permissions. From **Keys and tokens**, collect:
   - API Key / Secret → `X_OAUTH_CONSUMER_KEY` / `X_OAUTH_CONSUMER_SECRET`
   - Bearer Token → `X_BEARER_TOKEN`
   - **Access Token and Secret** (generate for your own account) → `X_OAUTH_ACCESS_TOKEN` /
     `X_OAUTH_ACCESS_TOKEN_SECRET`

   These Access Tokens are what let the container post without an interactive consent flow. If
   you regenerate app permissions after minting them, re-mint the Access Token/Secret too.

2. **Secrets.** Copy `.env.example` → `.env` and fill it in (local), or set the same keys as
   Dokploy app secrets (production). Never commit a filled-in `.env`.

3. **Network.** The compose creates the `zenod-x-net` network itself (exact name, no project
   prefix). The runner joins it afterwards with `docker network connect zenod-x-net
   zenod-agent-runner` — see `docs/AGENT-RUNNER.md`.

## Run

```sh
# from services/x-mcp/ (compose auto-loads .env for the X_* values)
docker compose -f docker-compose.x-mcp.yml up -d --build
```

In Dokploy this is a single **Compose** service (project `zenod`) built from
`docker-compose.x-mcp.yml`: both instances come up together, the `X_*` secrets go in the
compose's Environment, and `autoDeploy` rebuilds on push like the rest of the stack.

## Tool allowlist

`X_API_TOOL_ALLOWLIST` is a comma-separated list of OpenAPI **operationIds**; the server only
exposes matching operations. The values shipped in `docker-compose.x-mcp.yml` are the intended
read vs read+post sets. **Confirm the exact ids against the server's startup log**, which prints
every loaded tool:

```sh
docker logs x-mcp-readonly | sed -n '/Loaded .* tools/,/^$/p'
```

If an id differs in the pinned spec, update the allowlist in the compose file. An over-broad
read-only allowlist that leaks a write operation defeats the gate, so keep it tight.

## Verify

```sh
# Streamable-HTTP handshake from a container on the network:
docker run --rm --network zenod-x-net curlimages/curl -s -X POST \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  http://x-mcp-readonly:8000/mcp
```

Then from the runner: `codex mcp list` (read tools only) and `claude mcp list` (post tools
present). A `createTweet` call should succeed from the attended Claude path and be absent from
the Codex/read-only path.

## Upgrading the pin

Bump `XMCP_REF` in both `Dockerfile` and `docker-compose.x-mcp.yml` to the new commit, then
re-validate `headless-oauth1.patch` applies (`git apply --check`) against that commit — the
patch targets `build_oauth1_client()` in `server.py` and will need regenerating if upstream
refactors that function.
