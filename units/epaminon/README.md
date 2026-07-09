# Epaminon - the executor unit

Epaminon is the suite's worker harness. It accepts explicit execution work, launches a
Codex/Claude-style runner, tracks the run, and returns durable evidence: status, transcript,
artifact URL, pull request, commit, or blocked report.

It is not the backlog owner, memory owner, router, or sender:

- Archus owns backlog curation and execution-ticket minting.
- Zenod owns memory.
- Ring/Council own human routing.
- Callisthenes owns outbound sending.
- Epaminon owns execution state, worker launch, transcript capture, and evidence reporting.

## Status

Epaminon is real today as a headless executor selected from the root image with `AGENT=epaminon`.
The current Dokploy shape is [../../docker-compose.epaminon.yml](../../docker-compose.epaminon.yml):
`zenod-epaminon` runs on `dokploy-network`, stores state in `/data`, boots unprovisioned, and is
reachable internally at `http://zenod-epaminon:8080`.

This folder is the standalone unit surface of record for Epic 2.9 EPM-1. It documents the target
public product contract separately from the already-existing private Archus/Epaminon execution
lane. The public `run_task` / `dispatch_worker` names are the product contract. Current code anchors
still include `epaminon.run_ephemeral_task`, `epaminon.run_existing_issue`, and
`epaminon.execution_status`; see [SEAM-SURFACE.md](SEAM-SURFACE.md).

## Public contract

Epaminon's public MCP surface is a durable worker-dispatch contract:

```jsonc
// run_task / dispatch_worker target shape
{
  "task": "Research X and leave a markdown report in the repo.",
  "effort": "medium",
  "repo": "owner/repo",
  "path": "optional/subdir",
  "outputTarget": "docs/report.md or summary-only",
  "mcpServers": [{ "name": "zenod", "url": "https://zenod.example/mcp" }],
  "skills": ["optional-skill-name"],
  "instructions": "Additional constraints or acceptance criteria."
}
```

The call returns immediately with an execution id / ticket id. A status read returns
`queued`, `running`, `blocked`, `needs-review`, `approved`, `done`, or `failed`, plus evidence
handles when they exist. Long-running work must not hold the MCP call open.

GitHub issues are receipts or target work objects, not a mandatory caller prerequisite. A caller may
run an existing issue, but a plain task should still be accepted and recorded durably.

## Private lane

The Archus/Epaminon lane is internal and identity-gated. It is not the public user or aggregate MCP
surface.

Private lane verbs map to HTTP endpoints in [../../packages/server/src/app.ts](../../packages/server/src/app.ts):

| Lane verb | Direction | Endpoint | Purpose |
|---|---|---|---|
| `enqueue_execution` | Archus -> Epaminon | `POST /api/exec/enqueue` | Add a freshly minted execution ticket to Epaminon's queue. |
| `approve_execution` | Archus -> Epaminon | `POST /api/exec/approve` | Release a `needs-review` outward result after human approval. |
| `apply_execution_event` | Epaminon -> Archus | `POST /api/exec/event` | Report execution state and evidence back to Archus. |
| runner outcome | runner -> Epaminon | `POST /api/exec/outcome` | Mark a launched run done or awaiting review with evidence. |
| runner blocked | runner -> Epaminon | `POST /api/exec/blocked` | Park a run at `blocked` with a precise reason. |
| runner progress | runner -> Epaminon | `POST /api/exec/progress` | Attach observed phase and recent events to a running ticket. |
| transcript upload | runner -> Epaminon | `POST /api/exec/transcript` | Persist a durable transcript URL on the execution ticket. |

These endpoints require the cross-provisioned `X-Lane-Secret` / `exec_lane_secret`, are executor-only
where applicable, and are intended for the internal mesh. They must not be advertised by the
Console aggregate gateway as user-callable tools.

## Auth remit

Epaminon needs several credentials, each with a distinct boundary:

| Credential | Holder | Used for | Notes |
|---|---|---|---|
| MCP bearer token | Epaminon server | Public/headless MCP calls | `Authorization: Bearer <token>` on `/mcp`; minted by Console or pinned by env. |
| `exec_lane_secret` | Archus, Epaminon, runner | Private lane endpoints | Not an MCP token; never expose through public tools. |
| GitHub token or GitHub App installation | Epaminon / runner | Clone, issue, PR, status, evidence reads | Needed for code and issue work. |
| Model or CLI auth | runner | Codex/Claude-style execution | Stored in runner-scoped volumes; see [../../docs/AGENT-RUNNER.md](../../docs/AGENT-RUNNER.md). |
| Peer MCP tokens | Epaminon / runner config | Optional prewired memory, outbound, or custom tools | Each token is scoped to the peer unit or external MCP server. |
| Provisioning token/config | Console -> Epaminon | Initial hosted setup | Posted to `/api/provision` while `ZENOD_AWAIT_PROVISION=1`. |

Bare headless mode still requires auth. It does not depend on the hosted Console UI, but it must be
configured by env or API with an MCP token, GitHub/model credentials, worker instructions, and any
prewired MCP servers the worker should see.

## Deployment modes

### Hosted suite mode

The suite/provisioner starts Epaminon as a headless container and provisions it:

1. Start the root image with `AGENT=epaminon`, `ZENOD_AWAIT_PROVISION=1`, and persistent
   `ZENOD_DATA_DIR=/data`.
2. Attach it to the suite network so Console, Archus, and the runner can reach it.
3. Console/keyring mints the Epaminon MCP token and lane secret.
4. Console posts token/config/secrets to `/api/provision`.
5. The runner receives its own persistent GitHub and Codex/Claude auth volumes.
6. The Console or public page shows the user's MCP URL/token and connection commands.

### Hosted direct worker mode

Use [docker-compose.hosted.yml](docker-compose.hosted.yml) for the paid cloud worker product. The
Cloud provisioner deploys it at `https://e-<slug>.zenod.dev` with a unique container name and a
project-scoped volume, sets `AGENT=epaminon`, injects the MCP bearer token, and routes the public UI
directly to the Epaminon instance. This is the `cloud-test.zenod.dev` purchase-to-instance target
for Epic 2.9 EPM-9.

The direct worker mode is intentionally not the internal singleton:

- use `docker-compose.hosted.yml` for hosted customer instances;
- use [../../docker-compose.epaminon.yml](../../docker-compose.epaminon.yml) for the internal suite
  singleton on `dokploy-network`;
- use [docker-compose.epaminon.yml](docker-compose.epaminon.yml) for local/unit headless testing.

### Bare headless mode

Run Epaminon alone as an MCP server. The unit has no UI in this mode.

```sh
# from repo root
docker build -t zenod-epaminon .

docker run --rm -p 8080:8080 \
  -v "$PWD/epaminon-data:/data" \
  -e AGENT=epaminon \
  -e ZENOD_DATA_DIR=/data \
  -e ZENOD_API_TOKEN="pick-a-long-secret" \
  -e GITHUB_TOKEN="github-token-or-use-app-config" \
  -e ZENOD_RUNNER_POKE_URL="http://host.docker.internal:8787" \
  zenod-epaminon
```

Epaminon serves MCP at `http://localhost:8080/mcp`; call it with
`Authorization: Bearer <ZENOD_API_TOKEN>`.

For compose, use either the current root compose
[../../docker-compose.epaminon.yml](../../docker-compose.epaminon.yml) or this folder's
[docker-compose.epaminon.yml](docker-compose.epaminon.yml), which is the unit-local equivalent.

## Runbook

See [RUNBOOK.md](RUNBOOK.md) for build, provision, auth, smoke-test, and troubleshooting steps.

## Current code anchors

| Area | Anchor |
|---|---|
| Agent identity | [../../packages/server/src/agent.ts](../../packages/server/src/agent.ts) (`EPAMINON_AGENT`) |
| Public MCP tools | [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts) |
| Aggregate gateway filtering | [../../packages/server/src/meshGateway.ts](../../packages/server/src/meshGateway.ts) |
| Tool input schemas | [../../packages/server/src/mcpToolSchemas.ts](../../packages/server/src/mcpToolSchemas.ts) |
| Private lane HTTP endpoints | [../../packages/server/src/app.ts](../../packages/server/src/app.ts) |
| Queue state machine | [../../packages/server/src/executionQueue.ts](../../packages/server/src/executionQueue.ts) |
| Queue persistence | [../../packages/server/src/executionStore.ts](../../packages/server/src/executionStore.ts) |
| Runner/report/ship seams | [../../packages/server/src/executionLane.ts](../../packages/server/src/executionLane.ts) |
| Transcript persistence | [../../packages/server/src/executionTranscript.ts](../../packages/server/src/executionTranscript.ts) |
| Console one-off journey | [../../packages/server/src/ephemeralJourney.ts](../../packages/server/src/ephemeralJourney.ts) |
| Create-issue-then-run journey | [../../packages/server/src/createIssueRunJourney.ts](../../packages/server/src/createIssueRunJourney.ts) |
| Runner CLI | [../../scripts/fanout-codex.mjs](../../scripts/fanout-codex.mjs) |
| Runner sidecar docs | [../../docs/AGENT-RUNNER.md](../../docs/AGENT-RUNNER.md) |

## Files in this unit

| File | What it is |
|---|---|
| [README.md](README.md) | Unit overview, deployment modes, auth remit, and code map. |
| [SEAM-SURFACE.md](SEAM-SURFACE.md) | Public MCP contract and private lane contract. |
| [RUNBOOK.md](RUNBOOK.md) | Operational story for Docker, compose, provisioning, auth, and smoke checks. |
| [Dockerfile](Dockerfile) | Root-image reuse note. |
| [docker-compose.epaminon.yml](docker-compose.epaminon.yml) | Unit-local compose wrapper for the current headless executor. |
| [docker-compose.hosted.yml](docker-compose.hosted.yml) | Cloud provisioner-safe hosted Epaminon worker template. |
