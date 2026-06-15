# Zenod Agent Runner Sidecar

The agent runner is a separate container for Codex fan-out work. Keep it separate from the Zenod app container: Zenod owns memory, MCP, chat, ingestion, and vault writes; the runner owns GitHub issue execution, worktrees, Codex subprocesses, draft PRs, and `.fanout` status.

## Build

```sh
docker build -f Dockerfile.agent-runner -t zenod-agent-runner .
```

The image uses Node 22 and installs `git`, `gh`, `ripgrep`, shell utilities, and the Codex CLI. The Codex version is pinned by the `CODEX_VERSION` build arg:

```sh
docker build -f Dockerfile.agent-runner --build-arg CODEX_VERSION=0.137.0 -t zenod-agent-runner .
```

## Run

Use durable volumes. `CODEX_HOME` and `GH_CONFIG_DIR` must persist so auth survives container restarts. Attach the shared `zenod-x-net` network so the runner can reach the X MCP instances by service name (see [X MCP wiring](#x-mcp-wiring)).

```sh
docker network create zenod-x-net   # once; no-op if it already exists

docker volume create zenod-agent-work
docker volume create zenod-agent-codex-home
docker volume create zenod-agent-gh

docker run -d --name zenod-agent-runner \
  --network zenod-x-net \
  -v zenod-agent-work:/runner/work \
  -v zenod-agent-codex-home:/runner/codex-home \
  -v zenod-agent-gh:/runner/gh \
  zenod-agent-runner
```

The image's entrypoint (`scripts/agent-runner-entrypoint.sh`) idempotently writes the X MCP client config into the `codex-home`/`HOME` volumes on every start, then runs the CMD.

## Auth

Codex auth is runner-scoped. Do not rely on `/root/.codex` from the VPS host inside this container.

Authenticate Codex inside the runner:

```sh
docker exec -it zenod-agent-runner codex login --device-auth
docker exec zenod-agent-runner codex login status
```

Authenticate GitHub inside the runner:

```sh
docker exec -it zenod-agent-runner gh auth login
docker exec zenod-agent-runner gh auth status
```

For automation, seed `/runner/codex-home/auth.json` and `/runner/gh` from a trusted secret store or a one-time login, then let those volumes persist. Use one Codex auth volume per serialized runner stream; do not share one `auth.json` across multiple concurrently refreshing containers.

## Smoke Test

```sh
docker exec zenod-agent-runner node --version
docker exec zenod-agent-runner codex login status
docker exec zenod-agent-runner gh auth status

docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 17,18,19 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Drain Zenod agent-owned launch issues into isolated branches, draft PRs, or structured blocked reports." \
  --dry-run \
  --concurrency 3
```

Then inspect the run:

```sh
docker exec zenod-agent-runner zenod-fanout-codex status \
  --workdir /runner/work/zenod \
  --run <run-id>

docker exec zenod-agent-runner zenod-fanout-codex inspect \
  --workdir /runner/work/zenod \
  --run <run-id> \
  --issue 19
```

## Real Run Sequence

Start with a single no-push worker:

```sh
docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 18 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Prove one Codex subagent can work an issue in the runner sidecar and report observable status." \
  --no-push \
  --concurrency 1
```

After that works, run the launch fan-out with draft PRs and GitHub status comments:

```sh
docker exec zenod-agent-runner zenod-fanout-codex start \
  --repo zenod-ai/zenod \
  --issues 17,18,19 \
  --workdir /runner/work/zenod \
  --goal "GOAL: Drain Zenod launch implementation issues #17, #18, and #19 into draft PRs or concrete blocked questions without merging to main." \
  --draft-pr \
  --github-status \
  --concurrency 3
```

No command in this flow merges to `main`.

## X MCP wiring

The runner consumes the vendored X (Twitter) MCP server (`services/x-mcp/`) as an MCP **client**. Two instances run on the shared `zenod-x-net` network, differing only by tool allowlist:

- **`x-mcp-readonly`** — wired into Codex (`$CODEX_HOME/config.toml`, `[mcp_servers.x]`). Autonomous fan-out workers run with approvals bypassed, so they get **read tools only** — they can research X but cannot post.
- **`x-mcp-postread`** — wired into Claude CLI (`$HOME/.claude.json`, `mcpServers.x`). Posting (`createTweet`) lives here, for **attended** use only (Claude CLI is interactive / has its own approval prompts).

The gate is topology, not prompt instructions: posting is simply absent from the endpoint the autonomous worker reaches. Bring the instances up from `services/x-mcp/` (`docker compose -f docker-compose.x-mcp.yml up -d`, or two Dokploy apps on `zenod-x-net`) before relying on X tools. Override the default endpoints with `X_MCP_READONLY_URL` / `X_MCP_POSTREAD_URL` env vars on the runner if needed.

Verify after start:

```sh
docker exec zenod-agent-runner cat /runner/codex-home/config.toml   # [mcp_servers.x] -> x-mcp-readonly
docker exec zenod-agent-runner cat /runner/.claude.json             # mcpServers.x   -> x-mcp-postread
docker exec zenod-agent-runner codex mcp list                       # x: read tools only
```

## Rebuild / recreate (preserving state)

Picking up entrypoint, Dockerfile, or `fanout-codex.mjs` changes means rebuilding the image and recreating the container. The three named volumes carry all state (Codex/gh auth, worktrees), so recreation is safe as long as you reuse them:

```sh
docker build -f Dockerfile.agent-runner -t zenod-agent-runner .
docker rm -f zenod-agent-runner
docker run -d --name zenod-agent-runner \
  --network zenod-x-net \
  -v zenod-agent-work:/runner/work \
  -v zenod-agent-codex-home:/runner/codex-home \
  -v zenod-agent-gh:/runner/gh \
  zenod-agent-runner
```

The entrypoint re-applies the X MCP config to the existing `codex-home` volume on start (it strips and rewrites only its own sentinel-marked block, leaving the rest of `config.toml` intact).
