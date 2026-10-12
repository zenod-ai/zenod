# Phylax-only production promotion to 0361a7a (CPU-escalation fixes) plus resource limits

Date: 2026-10-12 (Phylax deploy 19:41 UTC)

Approval: Jordi explicitly authorized deploying the CPU-escalation fixes. Rollback was required only if health failed, the service crash-looped or `/mcp` errored (none happened).

## Why

Follow-up to `phylax-production-9b03691-2026-10-12`. That deploy removed the 2.5 s per-request ledger scan; this one ships the rest of the hardening on `main` @ `0361a7a`:

- #1388 event-loop health block in `/api/health`.
- #1387 self-healing usage totals via an id watermark (fixes the rollback/forward double-count and start-first overlap lag noted in the 9b03691 receipt).
- #1389 meter only tool calls, `405` on `GET /mcp`, per-tenant rate limit.
- #1393 SQLite hot-path rule: new indexes, trigger-maintained counters, no O(table) request/poll queries.
- #1390 opt-in usage retention with daily rollup (code present, retention stays OFF; no env changed).

Plus Swarm resource limits on the Phylax service, set through Dokploy's own fields.

## Target

| Item | Value |
|---|---|
| Dokploy application | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) |
| Swarm service | `app-index-back-end-panel-6zm3qg` |
| Volume | `phylax-data:/data` (untouched) |
| Previous image (rollback target) | `ghcr.io/zenod-ai/phylax:sha-9b03691` = `ghcr.io/zenod-ai/phylax@sha256:9f0326f458fb94380e973863759734cb7c56497ff178760c06ca9c0a5ffb3c6e`, health sha `9b036915af84f0f7e6e34cd49e2d6879158fd16c` |
| New image | `ghcr.io/zenod-ai/phylax@sha256:ef83838691b1e0dc9ceb3b087f67e08587dc2e9016ce0d7302c2b872dbd7331c` (= `phylax:sha-0361a7a`, Publish image run on `0361a7a`, success) |
| Limits | CPU 1.5 cores, memory 1 GiB |

## Preflight

- Main CI and Publish image on `0361a7a` both completed `success` before anything was touched.
- Dokploy desired config matched the Swarm runtime: 9b03691 digest, 37 environment entries, one mount (`/data`), no resource limits set anywhere on the service. No queued or running Dokploy deployments.
- No volume backup taken (no Docker volume touched). The new code only adds indexes/triggers/watermark state on `usage.sqlite`; the old code ignores them. Rolling back and forward again is safe from the totals point of view once #1387 is running, but rolling back to 9b03691 and forward still double counts rows inserted by 9b03691 (#1387 caveat).

## Action

1. `application.update` with only `dockerImage` (new digest), `cpuLimit` and `memoryLimit`. Dokploy's `calculateResources` passes these straight through `parseInt` into Swarm `NanoCPUs` and `MemoryBytes`, so the units are nano-CPUs and bytes: `cpuLimit=1500000000`, `memoryLimit=1073741824` (verified in the running Dokploy dist, not just the OpenAPI schema, which declares them as bare strings).
2. `application.redeploy` (title `Phylax CPU-escalation fixes 0361a7a + resource limits`) at 19:41:35 UTC. One redeploy.

Environment and mounts untouched (re-read after update: 37 env entries, 1 mount). No docker CLI restarts or service updates.

## Verification

- Swarm `UpdateStatus` `completed` (19:42:03 to 19:42:10 UTC), one running task on the new digest, old task `Shutdown`, no failed tasks, no restarts over the 11+ minute window.
- `docker service inspect` Resources: `Limits: NanoCPUs 1500000000, MemoryBytes 1073741824`.
- `https://phylax.zenod.dev/api/health`: HTTP 200, `sha: 0361a7a6efb4648a52481ea65078c303efe46c58`, worker `ok`, WhatsApp `connected`, no restart required, new `eventLoop` block present (p50 20.2 ms, p99 28.1 ms, utilization 0.033, complete window). One curl issued about 40 s after the Swarm cutover returned connection failure (000); the next three calls were 200.
- Boot logged `listening on :8080` within seconds; the totals watermark rebuild and index/trigger build are not logged separately, and boot-to-listening was a few seconds, so any backfill was fast.
- `vps-history 6` (after): CPU alerts section present, `none` for the last 6 h; Phylax no longer in the top-5 CPU list; Phylax container average memory 119 MiB.

## Before / after (about 10 min windows)

Before is the 9b03691 task immediately before the redeploy (already past the O(1) quota fix); after is the 0361a7a task starting about 1 min post cutover.

| Metric | Before (9b03691) | After (0361a7a) |
|---|---|---|
| Container CPU (`docker stats`) | 0.07% | 0.5-0.9% |
| Memory | 131 MiB / 7.57 GiB | 123 MiB / 1 GiB limit |
| `/mcp` `duration_ms` median | 35.4 ms (n=576) | 14.3 ms (n=552) |
| `/mcp` `duration_ms` p90 | 137.7 ms | 48.0 ms |
| `/mcp` `duration_ms` p99 | 332.8 ms | 89.5 ms |
| `[telegram] poll failed` (10 min) | 0 | 0 |

Status mix, `/mcp` only, 10 min:

| Method / status | Before | After |
|---|---|---|
| POST 200 | 288 | 276 |
| POST 202 | 144 | 138 |
| GET 200 | 144 | 0 |
| GET 405 | 0 | 138 |
| any 429 | 0 | 0 |

## Reconnecting clients after the 405

The two clients (`github-63050995` and `user-usr_450335af676221c44d2d4394`) each did 69 GET `/mcp` per 10 min after the fix, all answered 405, versus 72 GET 200 per 10 min before. They did NOT stop: the cycle per tenant is unchanged (GET, then POST 202 notification, then two POST 200). `405` is cheap (no SSE stream is held open any more) but the loop itself is a client behaviour and continues at about one cycle every 8-9 s per tenant. No 429s for any tenant. See #1384.

## Zenod production (zenod-mt), verified only

zenod-mt auto-deployed from the push to `main` (not touched manually): Swarm service `zenod-mt-fxpzoo` on `ghcr.io/zenod-ai/zenod:sha-0361a7a`, update `completed` 19:39:55 UTC, one running task, no crash loop. `https://cloud.zenod.dev/api/health`: HTTP 200, sha `0361a7a6efb4648a52481ea65078c303efe46c58`, eventLoop p50 20.2 ms, p99 23.5 ms, utilization 0.011. Boot reached `listening on :8080` about 1 s after the first boot log line, so the #1393 index build and trigger-table backfill were fast and logged no errors. The only recurring errors are the pre-existing `[customer] current-key refresh failed for account github-63050995` (OpenRouter key vs allowance policy), also present before this deploy and unrelated.

## Residual

- Rolling back to 9b03691 and forward again double counts rows inserted by 9b03691 (the #1387 caveat); only roll back if health fails, the service crash-loops or `/mcp` errors.
- Retention (#1390) stays off. Turning it on is a separate env change.
- The two reconnecting clients still loop (see above).
- Rollback path: update `dockerImage` back to the 9b03691 digest above (and optionally clear the two limits) and redeploy.
