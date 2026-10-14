# Phylax usage retention enabled: 7-day raw rows, daily rollups kept forever (D29, #1382)

Date: 2026-10-14. Approval: Jordi's explicit go (2026-10-14). Long-term export (e.g. S3) is a possible future feature, not in scope.

## Code check (no change needed)
Read `packages/mcp-chassis/src/usage.ts` and `usageRetention.test.ts` (from #1387/#1390):
- Totals and quota unaffected: `tenant_usage_totals` is never modified by pruning; `checkQuota` reads the totals. Prune only touches rows with `id <= totals_watermark`. Covered by the "keeps totals, summaries and quota correct" and "never prunes rows above the totals watermark" tests.
- Rolls up before deleting: each batch inserts into `tenant_usage_daily` and deletes the same ids in one `BEGIN IMMEDIATE` transaction; the cutoff is aligned to a UTC day.
- Bounded: 1000 rows per transaction, `setImmediate` yield between batches, first run 60 s after boot, then hourly. No VACUUM is ever run; incremental_vacuum only if the file is already `auto_vacuum=INCREMENTAL` (it is not, so the file does not shrink).

## Change
- Dokploy app `phylax` (`urbFsgl6eImbQ4MTIZl5N`): added `USAGE_RETENTION_DAYS=7`. Env variable names before: 37; after: the same 37 plus `USAGE_RETENTION_DAYS` (38). No other variable changed. One `application.redeploy` (HTTP 200) at 19:37 UTC. No docker restart, no volume touched, no VACUUM.

## Result (read-only checks over SSH)
| | Before | After first prune |
|---|---|---|
| `tenant_usage` raw rows | 1,904,313 (oldest 2026-07-11) | 281,933 (oldest 2026-10-07 00:00 UTC) |
| `tenant_usage_daily` rows | 0 | 76 |
| `usage.sqlite` size | 353 MB | 353 MB (expected: pages reused, file not shrunk) |

- Health: `https://phylax.zenod.dev/api/health` 200, same running sha `a5617ab`.
- Logs: the job ran; the only usage line is the expected one-time notice that auto_vacuum is not INCREMENTAL. No errors or failures in the 25 min window after deploy.
- `/mcp` after redeploy (25 min of logs): 498 x 200, 3 x 202, 3 x 405, 1 x 401 (unauthenticated probe); tenant `tools/call` traffic kept succeeding.
- CPU (`docker stats`): boot 34.7% then 11.3% (container start), then 0.2%, 0.1%, 0.6% across the first prune window, 0.17% and 0.37% later. Memory 60-115 MiB. Caveat: `docker stats --no-stream` took 15-20 s per sample on this host, so sampling was sparse and a stalled sampler lost the rest; no sample above 1% after container start.
