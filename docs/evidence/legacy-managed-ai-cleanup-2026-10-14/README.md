# Legacy managed-AI key cleanup receipt, 2026-10-14

Decision: D30. Jordi gave an explicit go on 2026-10-14 to delete the leftover per-customer OpenRouter keys and stored data. No secret values are recorded here.

## OpenRouter keys

Inventory used the provisioning key (Keychain `alpha9-openrouter-provisioning-key`). The default list hides disabled keys; `?include_disabled=true` shows them.

Retired (disabled, soaked, then deleted):

| Label | Hash prefix | Note |
|---|---|---|
| `zenod-tenant:alfablok-63050995` | `5dadaf30` | $20/month; last used 2026-10-12 18:09 UTC, before the platform key took over |
| `zenod-tenant:jorditestzenod0000-4ptjqj` | `5a1e716a` | last used 2026-07-09 |
| `zenod-tenant:jordi-f2c7a6` | `fa8fcf05` | last used 2026-07-10 |
| `zenod-tenant:jordi` | `466658c1` | never used |
| `zenod-tenant:testco` | `e8393228` | last used 2026-07-04 |
| 3 x `zenod-tenant:testco`, 1 x `zenod-tenant:tw1` | n/a | already disabled before this work; same managed-lifecycle name prefix; deleted |

Kept:

| Label | Why |
|---|---|
| `zenod-platform` (`ef1322bf`) | the platform key (D30) |
| `phylax transcribe` | Phylax's key, used 2026-10-13 |
| `zenod-mt` | unattributed generic key, last used 2026-08-26 |
| `ring-ship-test-2026-07-11`, `idea scraper`, `z2`, `zenod` | unrelated or unattributable |

Soak: alfablok key disabled at 17:38 UTC. About 50 minutes later zenod-mt and Phylax health were 200, a probe with the platform key through zenod-mt returned 200 (cost about $0.0000067), and 0 lines matching openrouter/401/403/unauthorized in either service's logs. Deletion followed at about 19:00 UTC.

## Data cleanup (code, not by hand)

Idempotent startup migration `packages/server/src/legacyManagedAiCleanup.ts`:
- tenant `openrouter_api_key` setting, only for accounts that recorded a managed child key (`managed_ai_key_hash` or a `zenod-tenant:` `managed_ai_key_name`);
- all `managed_ai_*` fields in the customer-accounts JSON;
- files `customer-managed-ai-audit.jsonl` and `customer-managed-ai-admission.sqlite`, `customer-managed-ai-coordination.sqlite`, `managed-ai-downstream.sqlite` (plus -wal/-shm/-journal).

PRs: #1409 (merge `30e82b9`, customer layer, zenod-mt) and #1410 (merge `ec3968c`, zenod-mode Phylax has no customer layer so the files-only cleanup is called from `phylaxUnit`).

Production results (counts only):
- zenod-mt on `30e82b9`: `tenant_keys_deleted=1 tenant_keys_failed=0 account_rows_cleaned=6 account_fields_removed=48 files_deleted=4 errors=0`. Verified after: 0 `managed_ai_*` fields in `customer-accounts.json`, tenant `github-63050995` has no `openrouter_api_key`; health 200; CPU 0.49%. zenod-mt later auto-rolled to `ec3968c`.
- Phylax: first rolled to `30e82b9` (digest `826663d5...`; no migration line because zenod-mode Phylax has no customer layer; 9 files remained), then to `ec3968c` (digest `d7169c2b...`), each with one `application.update` + one `application.redeploy`. Log: `files_deleted=9 errors=0`; 0 managed-ai files left in `/data`. Health 200 sha `ec3968c`, worker ok, WhatsApp connected, no restart required, CPU 0.52%, 87 MiB, 0 restarts. Previous digest (rollback target): `a5617ab` `sha256:06f23c29...`. Phylax has no Telegram channel configured in health.

## Left in place

- Stored `openrouter_api_key` in tenants `jordiepic32clean-ml7rz0` and `jordiepic32test-5oqq39` (Aug 2026 test tenants with no customer account). Provenance is unattributable, so they were kept. They are unused (platform key wins); delete on request.
- Rollback to per-tenant stored keys is no longer possible.
- Other zenod instances (`ring`, `herald`, `zenod-cloud-test`) run old images and were not touched.

## Follow-up checks (2026-10-14, evening)

- Other instances unaffected: `ring`, `herald`, `zenod-cloud-test` health 200 on their old images, 0 OpenRouter 401/403/unauthorized lines in 24 h of logs. Only tenant `github-63050995` on ring and herald holds a stored OpenRouter key (vault, `provider=openrouter`); both keys still authenticate at OpenRouter (HTTP 200), i.e. they are not among the deleted keys. Those images predate the platform key (D30), so nothing there depends on it.
- Telegram lives on Phylax (Dokploy env `TELEGRAM_ENABLED/BOT_TOKEN`, bot `@zenod_bot`), not on zenod-mt. Phylax `/api/health` lists only WhatsApp by design (`phylaxUnit.ts`); Telegram `getMe` ok, no webhook, 0 pending updates, 0 poll failures in logs.
- The two leftover test-tenant keys are removed by the same idempotent startup cleanup, extended to the exact tenant ids `jordiepic32clean-ml7rz0` and `jordiepic32test-5oqq39` (skipped if an account references them); log field `accountless_keys_deleted`.
