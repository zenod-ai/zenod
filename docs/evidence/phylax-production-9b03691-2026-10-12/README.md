# Phylax-only production promotion to 9b03691 (O(1) quota check)

Date: 2026-10-12 (deploy 02:11 UTC)

Approval: Jordi explicitly authorized deploying PR #1380 (`fix(mcp-chassis): O(1) quota check`), merged as `9b036915af84f0f7e6e34cd49e2d6879158fd16c`, to the live private Phylax companion. Rollback was required if health failed, the service crash-looped or latency worsened (none happened).

## Why

Phylax burned roughly 80-100% of a core. Every `/mcp` request ran `usage.checkQuota()`, which ran a full COUNT/SUM GROUP BY over `/data/usage.sqlite` (262 MB, one new row per request) on the event loop, about 2.5 s CPU per request. Two tenants' remote MCP clients reconnect every 1.5-3 s, so the scan never stopped. The fix keeps running totals (`tenant_usage_totals`), answers the quota check from them, and skips the ledger entirely when no quota applies. Evidence: infra-vps `docs/cleanup-history-and-plan.md`, entry "2026-10-12 Phylax CPU root cause"; generic-projects `epics/E1-remote-workbench-and-vps-cleanup.md`.

## Target

| Item | Value |
|---|---|
| Dokploy application | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) |
| Swarm service | `app-index-back-end-panel-6zm3qg` |
| Volume | `phylax-data:/data` (untouched) |
| Previous image (rollback target) | `ghcr.io/zenod-ai/phylax:sha-52418e3` = `ghcr.io/zenod-ai/phylax@sha256:7b4c0b139736e8c4bf7d2cdddb81a1d4ed2e81bd4b007f8c1c1f68513ec76449`, health sha `52418e3da6f54aa8220531fecf00c9f80e6c5b53` |
| New image | `ghcr.io/zenod-ai/phylax@sha256:9f0326f458fb94380e973863759734cb7c56497ff178760c06ca9c0a5ffb3c6e` (= `phylax:sha-9b03691`, published by Publish image run 38194364802) |

## Preflight

- Dokploy desired config matched the Swarm runtime: previous image, 37 environment entries, one mount (`/data`). No queued, running or delayed Dokploy deployments.
- No volume backup was taken for this deploy. The change is a schema migration on `usage.sqlite` (adds `tenant_usage_totals` and `usage_meta`, replaces one index with a covering index); the previous code ignores the new tables, so rollback is code-only. See Residual for the one consequence.

## Action

1. `application.update` with only `dockerImage` set to the new digest.
2. `application.redeploy` (title `Phylax O(1) quota check 9b03691`), started 02:11:40 UTC; no queueing.

Environment and mount untouched. No docker CLI restarts or service updates.

## Verification

- Swarm `UpdateStatus` `completed` (start-first) at 02:12:08 UTC, one running task on the new digest, old task `Shutdown`, no failed tasks. Container OCI revision `9b036915af84f0f7e6e34cd49e2d6879158fd16c`.
- `https://phylax.zenod.dev/api/health`: HTTP 200, `status: ok`, `sha: 9b036915af84f0f7e6e34cd49e2d6879158fd16c`, worker `ok`, WhatsApp `connected`, no restart required.
- Boot logged `listening on :8080` within seconds of container start; the migration/backfill duration is not logged separately.

| Metric (about 10 min window) | Before (52418e3) | After (9b03691) |
|---|---|---|
| Phylax container CPU (`docker stats`) | 95.8% | 0.2% |
| `/mcp` `duration_ms` median | 2999.8 ms (n=234) | 37.7 ms (n=432) |
| `/mcp` `duration_ms` p90 | 7832.2 ms | 157.6 ms |
| `[telegram] poll failed` (10 min) | 13 | 0 (8 min window) |
| Memory | 341 MiB | 121 MiB |

`vps-history 6` before: VPS1 load1 avg 7.44 (max 18.36), swap avg 3.3 GB; Phylax was the top container at 76.9% average CPU.

## Residual

- Start-first overlap: while the old task was still live it kept inserting `mcp.request` rows without updating `tenant_usage_totals`. Totals can lag by those few rows; they only feed quota checks.
- Rolling back and forward again leaves the totals stale for the rollback period (the backfill flag is already set). Delete the `totals_backfilled` row in `usage_meta` to force a re-backfill if exact totals matter.
- Follow-ups are tracked as GitHub issues: ledger retention, client/IP logging and Traefik access log, the reconnecting MCP clients, and a re-check of Telegram `poll failed`.
- Rollback was not needed. Rollback path: update `dockerImage` back to the 52418e3 digest above and redeploy.
