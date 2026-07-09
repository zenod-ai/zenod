# Epaminon runbook

This runbook covers the current headless executor shape and the Epic 2.9 target unit surface.

## Build

Epaminon reuses the repo root image. Select the unit with `AGENT=epaminon`.

```sh
# from repo root
docker build -t zenod-epaminon .
```

For the runner sidecar, use [../../docs/AGENT-RUNNER.md](../../docs/AGENT-RUNNER.md).

## Run with Docker

```sh
docker volume create zenod-epaminon-data

docker run -d --name zenod-epaminon \
  -p 8080:8080 \
  -v zenod-epaminon-data:/data \
  -e AGENT=epaminon \
  -e ZENOD_DATA_DIR=/data \
  -e ZENOD_API_TOKEN="pick-a-long-secret" \
  -e ZENOD_RUNNER_POKE_URL="http://host.docker.internal:8787" \
  zenod-epaminon
```

Smoke check:

```sh
curl -s http://localhost:8080/api/health
```

MCP is at `http://localhost:8080/mcp` and requires:

```text
Authorization: Bearer <ZENOD_API_TOKEN>
```

## Run with compose

Current production-like compose lives at
[../../docker-compose.epaminon.yml](../../docker-compose.epaminon.yml). The unit-local equivalent is
[docker-compose.epaminon.yml](docker-compose.epaminon.yml).

```sh
# from repo root
docker compose -f units/epaminon/docker-compose.epaminon.yml up -d --build
```

The compose joins `dokploy-network` and exposes port `8080` to other containers on that network. It
does not publish the port to the public internet by default.

## Run hosted direct worker compose

For the cloud worker product, use [docker-compose.hosted.yml](docker-compose.hosted.yml). This is
the collision-safe template used by the Cloud `provision-epaminon.mjs` script.

```sh
docker compose -f units/epaminon/docker-compose.hosted.yml config
```

Cloud provisioning sets:

- `EPAMINON_CONTAINER_NAME=epaminon-<slug>`
- `ZENOD_IMAGE_TAG`
- `ZENOD_API_TOKEN` and `MCP_BEARER_TOKEN`
- optional GitHub/model/CLI/runner env vars

The public host is `https://e-<slug>.zenod.dev`, the instance UI is the same origin, and the MCP
endpoint is `https://e-<slug>.zenod.dev/mcp`.

## Hosted provisioning flow

There are two hosted provisioning shapes:

1. Customer direct worker: Cloud deploys `docker-compose.hosted.yml`, injects `ZENOD_API_TOKEN`, and
   routes `e-<slug>.zenod.dev` directly to `AGENT=epaminon`.
2. Internal suite singleton: Console starts Epaminon with `ZENOD_AWAIT_PROVISION=1`, mints the MCP
   bearer token and `exec_lane_secret`, then posts token/config to `POST /api/provision`.

Runner is separately authenticated for GitHub and Codex/Claude CLI in both shapes.

`/api/provision` is one-shot: once provisioned, another call returns `already provisioned`.

## Bare headless mode

Bare mode is the integration path for a user who wants only Epaminon as a headless MCP server. It
does not require the hosted UI.

Required configuration:

- `AGENT=epaminon`
- `ZENOD_DATA_DIR=/data`
- public MCP token, usually `ZENOD_API_TOKEN`
- GitHub credentials (`GITHUB_TOKEN` or app config) for repo/issue/PR work
- runner URL, usually `ZENOD_RUNNER_POKE_URL`
- runner-side model/CLI credentials
- optional prewired MCP server config for memory/outbound/custom tools

Bare mode still enforces auth. There is no tokenless mode for MCP.

## Runner auth

The runner owns worker execution auth. Do not rely on host-level `gh` or Codex credentials being
present inside the runner container.

Follow [../../docs/AGENT-RUNNER.md](../../docs/AGENT-RUNNER.md):

```sh
docker exec -it zenod-agent-runner codex login --device-auth
docker exec zenod-agent-runner codex login status

docker exec -it zenod-agent-runner gh auth login
docker exec zenod-agent-runner gh auth status
```

Persist `CODEX_HOME` and `GH_CONFIG_DIR` volumes so restarts do not lose credentials.

## Smoke tests

List MCP tools with a standard MCP client or inspector:

```sh
npx @modelcontextprotocol/inspector
# transport: Streamable HTTP
# URL: http://localhost:8080/mcp
# header: Authorization: Bearer <token>
```

Expected current tool anchors on a configured executor:

- `epaminon.run_existing_issue`
- `epaminon.run_ephemeral_task`
- `execution_status`
- `epaminon.execution_status`

The target product aliases are:

- `run_task`
- `dispatch_worker`

Check queue state without launching work:

```sh
curl -s \
  -H "Authorization: Bearer $ZENOD_API_TOKEN" \
  "http://localhost:8080/api/executions"
```

## Private lane checks

These endpoints are internal. They require `X-Lane-Secret` and should not be callable through the
public MCP gateway.

```sh
curl -s -X POST http://localhost:8080/api/exec/enqueue \
  -H "Content-Type: application/json" \
  -H "X-Lane-Secret: $EXEC_LANE_SECRET" \
  -d '{"execution_id":"smoke-1","target":"owner/repo#1","context":"smoke"}'
```

Expected unauthenticated behavior:

```sh
curl -s -X POST http://localhost:8080/api/exec/enqueue \
  -H "Content-Type: application/json" \
  -d '{"execution_id":"smoke-1","target":"owner/repo#1"}'
# -> unauthorized / execution lane not provisioned / not an executor agent, depending on config
```

Gateway privacy regression test:

```sh
npm test -- --runInBand packages/server/test/meshGateway.test.ts
```

The aggregate gateway must not list:

- `enqueue_execution`
- `approve_execution`
- `apply_execution_event`

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP calls return unauthorized | Confirm `Authorization: Bearer <token>` matches `ZENOD_API_TOKEN` or provisioned token. |
| `/api/exec/*` returns unauthorized | Confirm `X-Lane-Secret` matches `exec_lane_secret`; do not use the MCP token. |
| `/api/exec/*` returns not an executor | Confirm the container has `AGENT=epaminon`. |
| Runs stay `running` | Confirm `ZENOD_RUNNER_POKE_URL` reaches the runner and the runner accepts `/run`. |
| Runner cannot clone or PR | Check runner `gh auth status` and repo permissions. |
| Worker cannot call peer tools | Check runner MCP config and peer bearer tokens. |
| No transcript URL | Confirm runner uploads `/api/exec/transcript` with the lane secret. |

## Evidence locations

- Queue state persists in `/data` through `ExecutionStore`.
- Transcripts persist through `executionTranscript` and are served at `/api/exec/transcript/:executionId`.
- Status reads come from `execution_status` / `epaminon.execution_status`.
- GitHub PR/commit/issue URLs are the durable external evidence handles.
