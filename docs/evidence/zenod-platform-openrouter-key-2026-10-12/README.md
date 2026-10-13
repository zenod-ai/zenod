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

## Follow-up 1: managed_ai_* readers removed (PR #1402, merge `3bee448`)

- Readers of the dead fields were all in the Phylax adapter and unit wiring. Replacements:
  - `processingPaused` (Phylax `customerTenant` and the non-Phylax hosted-channels path) read `managed_ai_status === "paused"`. It now means "not entitled": Stripe `active`/`past_due`, or the account is in `ZENOD_PHYLAX_COMPED_ACCOUNT_IDS` (fixed window from #1367). Canceled, paused, pending and unknown are paused. Phylax bootstrap uses the same check.
  - Local capacity (three call sites), local usage and operator projection read `managed_ai_limit_usd`. They now use the D30 shadow allowance (`ZENOD_TENANT_MONTHLY_ALLOWANCE_USD`, local capacity 0 while unset). Spend still comes from the tenant's `llm_usage` month-to-date; Phylax capacity from Phylax's own allowance ledger.
  - Admin overview API and the admin UI "AI state" column read `managed_ai_status`; both removed.
- All `managed_ai_*` fields are gone from the `CustomerAccount` type and defaults. The stored JSON values in `customer-accounts.json` (for example github-63050995's stale `managed_ai_status`) are left in place; removing them would be a destructive data migration, and nothing reads them now.
- Tests: comped not paused, Stripe active/past_due not paused, canceled/paused/pending paused, platform mode with no shadow allowance reports capacity normal.
- Production (2026-10-13, container on `3bee448`, 0 restarts, no `current-key refresh failed` or `waiting_for_usage` lines): Phylax health 200; github-63050995 (comped) and user-usr_450335af676221c44d2d4394 (Stripe active) both entitled, `processingPaused` false, Phylax binding `active`, no binding error.

## Follow-up 2: transcription cost is real (PR for this receipt)

- Live probe from inside `zenod-mt` with the platform key (key never printed): a 1.5 s 440 Hz WAV to `openai/whisper-large-v3-turbo`, once raw and once through `transcribeAudio`.
- OpenRouter's response body is `{ "text": string, "usage": { "seconds": 1.5, "cost": 0.000004995 } }`. There is no `id` in the body; the generation id is in the `x-generation-id` response header.
- `usage.cost` was already read correctly: the `llm_usage` report had `providerCostUsd` 0.000004995 (the per-minute estimate would have been 0.0000167, 3.3x too high), and spend uses `COALESCE(provider_cost_usd, cost_usd)`.
- Gap fixed: the generation id was never captured because the code read `body.id`. It now falls back to the `x-generation-id` header. Since real cost is returned inline, the async `GET /api/v1/generation?id=` lookup is not needed.
- Cost source convention: `provider_cost_usd` NOT NULL means real provider cost; NULL means the per-minute estimate (`cost_usd`), used only when a response lacks `usage.cost`. No new column.
- Production rows: as of 2026-10-13 neither live tenant has any `transcribe` row in `llm_usage` yet (the probe bypassed the ledger), so there is nothing to mis-source. Rows written from now on take the real cost path.
- Spend of the probe: about $0.00001.
