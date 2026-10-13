# Phylax-only production promotion to a5617ab (/mcp client logging, managed-AI removal, transcription metering)

Date: 2026-10-13 (Phylax deploy 00:24 UTC)

Approval: Jordi explicitly authorized deploying this CPU and simplification work. Rollback was required only if health failed, the service crash-looped or `/mcp` errored (none happened).

## Why

Follow-up to `phylax-production-0361a7a-2026-10-12`. This ships `main` @ `a5617ab`:

- #1395 `/mcp` request log now records `user_agent` and, for `initialize`, `mcp.client_name` / `mcp.client_version`, plus `mcp.methods` (part of #1383).
- #1400 and #1402 managed-AI removal; Phylax-side reads of the old fields are gone.
- #1399 and #1403 transcription metering and cost (OpenRouter generation id from the `x-generation-id` header).

## Target

| Item | Value |
|---|---|
| Dokploy application | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) |
| Swarm service | `app-index-back-end-panel-6zm3qg` |
| Volume | `phylax-data:/data` (untouched) |
| Previous image (rollback target) | `ghcr.io/zenod-ai/phylax:sha-0361a7a` = `ghcr.io/zenod-ai/phylax@sha256:ef83838691b1e0dc9ceb3b087f67e08587dc2e9016ce0d7302c2b872dbd7331c` |
| New image | `ghcr.io/zenod-ai/phylax@sha256:06f23c29f7479fb7354ca6ccce9006b34c4600a58ddfadd8d058995fa99344c1` (= `phylax:sha-a5617ab`, from Publish image run 38326419164, success) |
| Limits | CPU 1.5 cores, memory 1 GiB (unchanged) |

## Preflight

- Main CI and Publish image on `a5617ab` both `success` before anything was touched.
- Dokploy config matched runtime: 0361a7a digest, 37 environment entries, one mount (`/data`), `cpuLimit` 1500000000, `memoryLimit` 1073741824, status `done`, no queued deployments.
- No volume backup (no volume touched).

## Action

1. `application.update` with only `dockerImage` (new digest). Re-read after: 37 env entries, 1 mount, limits unchanged.
2. `application.redeploy` at 00:24:06 UTC. The call returned an empty body, and Swarm still showed the old image six seconds later, so a second `application.redeploy` was issued at 00:24:17 UTC. Both ran (Dokploy deployments finished 00:24:41 and 00:24:41). Net effect was two back-to-back rolls to the same digest: one task shutdown mid-roll, final `UpdateStatus` `completed` 00:24:48 UTC. Lesson: an empty body from `application.redeploy` can still mean it was accepted; check `deployment.all` before retrying.

No docker CLI restarts or service updates; all reads over `ssh hetzner_vps_1`.

## Verification (about 10 to 22 minutes after the roll)

- Swarm `UpdateStatus` `completed`, one running task on the new digest, container `RestartCount` 0, no failed tasks.
- `docker service inspect` Resources: `Limits: NanoCPUs 1500000000, MemoryBytes 1073741824`.
- `https://phylax.zenod.dev/api/health`: HTTP 200, sha `a5617ab`, worker `ok`, WhatsApp `connected`, `restart.required` false, eventLoop p50 20.2 ms, p99 25.2 ms, utilization 0.017. One transient 502 during the second roll.
- `docker stats`: CPU 0.47%, memory 88 MiB / 1 GiB.
- WhatsApp logged one `disconnected (440)` right at boot (the overlapping old task from the double redeploy) and `reconnect_succeeded` about 3 s later; connected since.
- `[telegram] poll failed`: 0 in the 10 min window.
- Zenod production (zenod-mt) auto-deployed `zenod:sha-a5617ab`; `https://cloud.zenod.dev/api/health` 200, sha `a5617ab`, eventLoop p99 25.0 ms.

## /mcp, 10 min window (n=132)

| Metric | 0361a7a receipt | a5617ab |
|---|---|---|
| `duration_ms` median | 14.3 ms (n=552) | 34.3 ms (n=132) |
| `duration_ms` p90 | 48.0 ms | 93.1 ms |
| `duration_ms` p99 | 89.5 ms | 212.2 ms |

The populations differ. In this window both live tenants sent only `POST /mcp` `tools/call` (66 each, all 200), with no `GET`, no 405, no `initialize`, no 202 notifications, so the reconnect loop seen in the 0361a7a receipt is not occurring and the sample is all real tool calls (heavier than the notification/initialize mix before). No 429 for any tenant, nothing paused, tenants `github-63050995` and `user-usr_450335af676221c44d2d4394` both normal.

## Logging (#1383)

Live: every `/mcp` line carries `user_agent` and `mcp.methods`. Example (no tokens in it):

```
{"level":30,"tenant_id":"github-63050995","event":"http.request.completed","http":{"method":"POST","path":"/mcp","status_code":200},"user_agent":"node","mcp":{"methods":["tools/call"]},"duration_ms":16.85,"msg":"request completed"}
```

Not yet observed in production: `mcp.client_name` / `mcp.client_version`. The code only fills them from an `initialize` request, and neither tenant sent one in the first ~22 minutes (long-lived sessions, no reconnect). An unauthenticated probe with `user-agent: deploy-verify/1` showed `user_agent` is logged for a 401 (`tenant_id` null) and that client info is only attached after auth. Both tenants report `user_agent` `node`, so the client name is not otherwise distinguishable until one re-initializes. Source IP and the Traefik access log are not part of this deploy.

## Residual

- Rollback path: `application.update` `dockerImage` back to the 0361a7a digest above and redeploy; rolling back loses nothing the new code wrote that the old code needs (not exercised).
- #1383 remains open for the source-IP field and the Traefik access log.
