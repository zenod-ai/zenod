# Epaminon - SEAM SURFACE

Conforms to [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md): one MCP server over streamable HTTP,
per-unit bearer auth, long tools return an execution id immediately, reads return data or an
explicit empty result, and failures are loud structured errors.

This document separates two surfaces:

- **Public MCP surface:** what a user, Console/Council, Claude, Codex, or another authorized MCP
  client may call.
- **Private Archus/Epaminon lane:** internal execution-ticket protocol. It is lane-secret-gated and
  must not appear in the public or aggregate MCP tool list.

## Public MCP surface

### `run_task` - LONG (mutating, target product name)

Start one durable execution from a text task. This is the product-level "Codex/Claude in the cloud"
contract.

- **Input:**
  ```jsonc
  {
    "task": "string",
    "effort": "low | medium | high",       // optional; default is instance-configured
    "repo": "owner/repo",                  // optional
    "path": "subdir",                      // optional
    "outputTarget": "artifact destination",// optional
    "mcpServers": [{ "name": "zenod", "url": "https://..." }], // optional
    "skills": ["skill-name"],              // optional
    "instructions": "extra constraints"    // optional
  }
  ```
- **Class:** LONG. It returns immediately and does not hold the wire while the worker runs.
- **Accepted receipt:**
  ```jsonc
  {
    "execution_id": "exec-...",
    "state": "queued",
    "status_url": "https://.../executions/exec-...",
    "evidence": [{ "kind": "execution_created", "id": "exec-..." }]
  }
  ```
- **Completion:** event or poll result with the same `execution_id`, terminal `state`, transcript
  URL, and evidence URL/commit/PR/artifact when available.
- **Current code anchor:** target wrapper around the existing `epaminon.run_ephemeral_task` path in
  [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts) and the Console one-off
  journey in [../../packages/server/src/ephemeralJourney.ts](../../packages/server/src/ephemeralJourney.ts).

### `dispatch_worker` - LONG (mutating, structured alias)

Same execution semantics as `run_task`, but with a name that emphasizes worker launch. This should
be an alias or compatibility wrapper, not a second state machine.

- **Input:** same fields as `run_task`, with implementation-specific worker profile fields allowed
  only when they are documented in the instance config.
- **Receipt:** same `execution_id` / status / evidence shape.
- **Rule:** if both `run_task` and `dispatch_worker` exist, they enqueue into the same queue and
  status reads are indistinguishable.

### `run_existing_issue` - LONG (mutating, existing-ticket path)

Run an already-created GitHub work issue. This is one integration path, not the required workflow
for all Epaminon runs.

- **Input:** `{ target: "owner/repo#123", instructions?: string, repo?: "owner/repo", notifyOnStart?: boolean }`
- **Class:** LONG.
- **Accepted receipt:** execution ticket / id mapped to the target work issue.
- **Current code anchor:** `epaminon.run_existing_issue` in
  [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts), input shape
  `RUN_ISSUE_SHAPE` in [../../packages/server/src/mcpToolSchemas.ts](../../packages/server/src/mcpToolSchemas.ts).

### `execution_status` - FAST (read, compatibility)

Read the live execution queue using an optional natural-language filter.

- **Input:** `{ message?: string }`
- **Receipt:** queue entries with state, target, note, evidence URL, transcript URL, progress, and
  total/filter counts. Empty results must distinguish "no executions exist" from "filter matched
  none."
- **Current code anchor:** `execution_status` in
  [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts).

### `epaminon.execution_status` - FAST (read, v4 typed)

Read the execution queue with explicit fields only.

- **Input:**
  ```jsonc
  {
    "workIssue": "owner/repo#123",
    "executionIssue": "owner/repo#456",
    "executionId": "exec-...",
    "state": "queued | running | needs_review | blocked | done | failed",
    "since": "ISO timestamp",
    "limit": 20
  }
  ```
- **Receipt:** typed v4 tool response with execution evidence and loud errors.
- **Current code anchor:** `epaminon.execution_status` in
  [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts), schema
  `V4_EXECUTION_STATUS_SHAPE` in
  [../../packages/server/src/mcpToolSchemas.ts](../../packages/server/src/mcpToolSchemas.ts).

## Current public-name gap

The target public name is `run_task` or `dispatch_worker`. Today the native executor MCP anchor is
named `epaminon.run_ephemeral_task`, and the Console path now treats one-offs as durable,
ticket-backed receipts. Until the target alias lands, docs and tests should treat
`epaminon.run_ephemeral_task` as the implementation anchor and `run_task` / `dispatch_worker` as the
product contract.

## Private Archus/Epaminon lane

These are not public MCP tools. They are internal HTTP lane calls in
[../../packages/server/src/app.ts](../../packages/server/src/app.ts), guarded by `X-Lane-Secret`
matching the cross-provisioned `exec_lane_secret`.

| Private verb | Direction | Endpoint | Receipt / effect |
|---|---|---|---|
| `enqueue_execution` | Archus -> Epaminon | `POST /api/exec/enqueue` | `{ ok: true }` after Epaminon accepts the execution ticket into the queue. |
| `approve_execution` | Archus -> Epaminon | `POST /api/exec/approve` | `{ ok: true }` after Epaminon accepts human approval for a `needs-review` result. |
| `apply_execution_event` | Epaminon -> Archus | `POST /api/exec/event` | `{ ok: true, ... }` after Archus records the state edge/evidence. |
| runner outcome | runner -> Epaminon | `POST /api/exec/outcome` | Transitions `running` to `done` or `needs-review` with evidence. |
| runner blocked | runner -> Epaminon | `POST /api/exec/blocked` | Transitions `running` to `blocked` with a note. |
| runner progress | runner -> Epaminon | `POST /api/exec/progress` | Annotates `running` with phase/progress; no state transition. |
| transcript upload | runner -> Epaminon | `POST /api/exec/transcript` | Stores transcript and pins a URL to the execution ticket. |

Private-lane rules:

- The lane uses `exec_lane_secret`, not the public MCP bearer token.
- The lane is inert until Console/provisioning installs `exec_lane_secret` and peer URLs.
- Lane calls stay on the internal network.
- The Console aggregate gateway must not advertise `enqueue_execution`, `approve_execution`, or
  `apply_execution_event`.
- `origin_ticket_id` and depth propagation remain a known seam gap from the Council surface; future
  public dispatch should carry origin/depth when invoked from Ring/Council.

## Consumed surfaces

Epaminon consumes these dependencies while executing work:

| Dependency | Surface | Purpose |
|---|---|---|
| Runner sidecar | `ZENOD_RUNNER_POKE_URL` -> `POST /run` | Launch Codex/Claude-style work on command. |
| Archus | `/api/exec/event` | Record state and evidence on the execution ticket. |
| GitHub | REST/CLI through runner or server credentials | Clone repos, inspect issues/PRs, create PRs, verify merged PR evidence. |
| Model/CLI provider | Codex/Claude auth in runner volume | Run the actual worker harness. |
| Peer MCP servers | configured MCP client entries | Optional memory, outbound, or custom tools available to the worker. |

## Auth and errors

- Public MCP calls require `Authorization: Bearer <Epaminon token>`.
- Private lane calls require `X-Lane-Secret: <exec_lane_secret>`.
- GitHub and model/CLI credentials are worker execution credentials, not public MCP credentials.
- Failures must be loud and structured with stable codes such as `unauthorized`, `not_found`,
  `invalid_input`, and `unavailable`.
- A disabled or unprovisioned unit must reject calls loudly; it must not return success-shaped
  placeholders.

## Code anchors and tests

| Contract area | Anchor |
|---|---|
| Executor identity | [../../packages/server/src/agent.ts](../../packages/server/src/agent.ts) |
| MCP tool registration | [../../packages/server/src/mcp.ts](../../packages/server/src/mcp.ts) |
| Aggregate gateway tool list/filtering | [../../packages/server/src/meshGateway.ts](../../packages/server/src/meshGateway.ts) |
| Private lane HTTP endpoints | [../../packages/server/src/app.ts](../../packages/server/src/app.ts) |
| Queue state machine | [../../packages/server/src/executionQueue.ts](../../packages/server/src/executionQueue.ts) |
| Queue persistence | [../../packages/server/src/executionStore.ts](../../packages/server/src/executionStore.ts) |
| Runner/report/ship seams | [../../packages/server/src/executionLane.ts](../../packages/server/src/executionLane.ts) |
| Existing MCP tests | [../../packages/server/test/mcp.test.ts](../../packages/server/test/mcp.test.ts) |
| Gateway privacy tests | [../../packages/server/test/meshGateway.test.ts](../../packages/server/test/meshGateway.test.ts) |
