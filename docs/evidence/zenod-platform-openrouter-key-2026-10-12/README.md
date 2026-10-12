# Zenod platform OpenRouter key evidence — 2026-10-12

Decision: D30 in `docs/EPIC-0-FOUNDATION-SPINE.md`. Hosted Zenod now uses one platform OpenRouter key, like Phylax. No secret values are recorded here.

## Code

- PR #1396 (`23eb898`, merged 2026-10-12 22:07 UTC): platform key with per-tenant metering and shadow allowance.
- PR #1397 (`6ae3383`, merged 2026-10-12 22:25 UTC): platform-key usage projection reports 0% instead of unavailable.
- Bug window: #1396 introduced paid web asks being queued as `waiting_for_usage` in platform mode; #1397 fixed it. The merges are 18 minutes apart (`git log`: 00:07 and 00:25 +02:00). Publish image finished 22:14 UTC for #1396 and 22:32 UTC for #1397, so the buggy image was available for about 18 minutes. The current `zenod-mt` container started at 22:32:05 UTC, i.e. on the #1397 image.

## Configuration

- Env `ZENOD_PLATFORM_OPENROUTER_KEY` on Dokploy app `zenod-mt` (env entries 58 to 59).
- OpenRouter key `zenod-platform`, hash prefix `ef1322bf`, $26 monthly limit, monthly reset. Created from keychain item `alpha9-openrouter-provisioning-key`.
- Metering: per-tenant `llm_usage`, plus the OpenRouter `user` field set to the tenant id.
- `ZENOD_TENANT_MONTHLY_ALLOWANCE_USD` is unset: the allowance check is shadow-only and never blocks.
- With the platform key active, tenant model, provider and base URL overrides are ignored.
- Unused but still present: stored tenant keys and OpenRouter key `zenod-tenant:alfablok-63050995` (hash 5dadaf30, $20/month). Deletion and revocation are Human Gates.
- Last-30-day spend: about $8.55 estimated, of which about $7.27 is github-63050995.

## Log check (read-only, `ssh hetzner_vps_1`)

Container `zenod-mt` started 2026-10-12 22:32:05 UTC. Checked after at least 10 minutes of uptime; env values never printed.

- `current-key refresh failed`: 0
- `waiting_for_usage`: 0
- Checked at: 2026-10-12 22:43 UTC (about 11 minutes uptime, 18 log lines total)

## Rollback

Remove the `ZENOD_PLATFORM_OPENROUTER_KEY` env entry from Dokploy app `zenod-mt` and redeploy via Dokploy. Tenants fall back to their stored keys, which are still present.
