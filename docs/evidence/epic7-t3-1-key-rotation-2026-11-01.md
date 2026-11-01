# EPIC-7 T3.1: vault master key rotated in production (2026-11-01)

Run `run_79e412c2`. Bound epic: [EPIC-7](../EPIC-7-REAL-USER-TEST.md), row T3.1, under Jordi's answer to ask E7-A7 ("rotate now safely please"). The trigger was the old `CHASSIS_VAULT_MASTER_KEY` value being printed into a worker session during the [T3 live step](epic7-t3-live-2026-11-01.md). No secret value appears in this file.

## Result in one paragraph

`zenod-mt` now runs on a new `CHASSIS_VAULT_MASTER_KEY`. All 65 chassis ciphertexts (60 tenant vault key verifiers and 5 stored credentials) and all 4 Phylax-adapter binding tokens were re-encrypted under the new key. Counts before and after are the same: 65 = 65 and 4 = 4. The old key no longer opens any of them, and nothing was lost. The app was down for about 85 s (23:41:11 to 23:42:41 UTC, 00:41 Madrid). Health, readiness, Phylax/WhatsApp, the adapter bindings and tester-watch match the pre-rotation baseline. Every real stored credential still works with its provider (read-only calls). The new key is in the fleet secret store, and the old key is no longer in the env. **One new incident happened during the window:** a Dokploy API response printed the full `zenod-mt` env (old key and other secrets) into this run's session output. See [Incident](#incident-during-the-window) and the ask at the end.

## How the key is used (read-only survey)

| Store | Scheme | Count on prod |
|---|---|---|
| `/data/<tenant>/<file>.sqlite` `vault_entries` + `vault_metadata` key verifier (`ChassisStorage.vault()`) | AES-256-GCM. Per-file key = HKDF-SHA256(master, salt `zenod-mcp-chassis-vault-v1`, info `tenant\0file`). AAD `tenant\0file\0key`. Envelope prefix `mcp-chassis-vault:v1:` | 60 files (all `vault.sqlite`): 60 verifiers + 5 entries |
| `/data/<tenant>/chassis-settings.sqlite` secret settings + verifier (`encryptedValues`) | same envelope | 0 |
| `/data/zenod-phylax-adapter.sqlite` `zenod_phylax_bindings.token_*` | AES-256-GCM, key = sha256(master string), no AAD | 4 |

- No envelope or data-key ring existed, so a rotation means re-encrypting every ciphertext. A full scan of every text column of every SQLite file found no envelope outside these stores. The 52 `.m2-operator/*.mjs` hits are script source that contains the prefix literal, not ciphertexts.
- `zenod-mt` has no `ZENOD_CREDENTIAL_MASTER_KEY` (legacy) and no `PHYLAX_ARTIFACT_CAPABILITY_SECRET`. The artifact capability HMAC is a Phylax-unit path and is not used by `zenod-mt`.
- The Phylax companion's own `CHASSIS_VAULT_MASTER_KEY` is a **different** value (compared by hash), so it is out of scope and untouched. The 6 apps holding a `CHASSIS_VAULT_MASTER_KEY` all have distinct values (`secret find`).

## Code ([PR #1459](https://github.com/zenod-ai/zenod/pull/1459), merged on green `ci`, live as `96b86b4`)

- `rekeyChassisDataDir` (mcp-chassis) and `rekeyZenodPhylaxAdapterTokens` (server) do the work. The CLI is `node packages/server/dist/vaultRekey.js verify|rekey`, with keys from the env only (`CHASSIS_VAULT_MASTER_KEY`, `CHASSIS_VAULT_MASTER_KEY_PREVIOUS`). Its output is JSON counts only.
- The tool is offline (unit stopped) and idempotent. It refuses to write anything if any envelope is unaccounted for. It runs VACUUM and truncates the WAL afterwards, so old-key ciphertext does not linger on disk. Runtime behaviour is unchanged. The runtime has no dual-key mode, so there was never a "previous key" in the env.
- Tests: `packages/server/test/vaultRekey.test.ts` covers rekey, idempotency, read-back through `ChassisStorage` and settings, refusal on a stray envelope, and the key checks.

## Steps and evidence (UTC)

| Step | Result |
|---|---|
| Key generation | 32 bytes from a CSPRNG (`secrets.token_hex`), hex64 like the old key, written to a root 0600 file under a root 0700 dir on VPS1. Never displayed |
| Copy rehearsal 23:39 | On a fresh copy of the volume, with image `sha-96b86b4`: verify-old 65/65 + 4/4 · rekey 65 + 4 rekeyed · rekey again 0 rekeyed (idempotent) · verify-new 65/65 + 4/4 · verify-old 0/65 + 0/4 |
| Baseline 23:3x | Read-only credential check in the running container: comped tenant `github-63050995` Drive refresh token → Google token refresh **200** (platform OAuth client; its legacy self-hosted client was already `unauthorized_client` before the rotation). Drive-vault tenant `user-usr_450335af…` refresh **200**. Two GitHub tokens (`jordiepic32*`) → `api.github.com/rate_limit` **200**. Readiness `ready=true`. Phylax ok `1707c9f`, WhatsApp connected. Bindings: 3 active, 1 `unavailable` (canceled subscription, as in T3) |
| 23:41:10 | Fresh env backup (Dokploy record) to `~t3agent/.config/alpha9/rollback/zenod-mt-env-2026-11-01T2341Z-pre-key-rotation.json` (0600) + root copy. `infra-vps-deploy-poller.timer` paused so no roll could start the app mid-rekey |
| 23:41:11–17 | `application.stop`. 0 containers |
| 23:41:30 | Snapshot of the stopped volume → `/root/zenod-key-rotation-2026-11-01/prod-snapshot-20261101T2341Z/` |
| 23:41:54–23:42:26 | verify-old 65/65 + 4/4 → rekey 65 + 4 → rekey again 0 → **verify-new 65/65 + 4/4, ok** → verify-old 0 |
| 23:42:31 | `saveEnvironment` changed only `CHASSIS_VAULT_MASTER_KEY`. Read-back: every other line byte-identical. `application.deploy` |
| 23:42:41 | `/api/health` ok, sha `96b86b4`. The container's key equals the new key and not the old one (hash compare) |
| 23:43 | Credential check repeated: **identical to the baseline** (200 / 200 / 200 / 200). Readiness `ready=true` (same 4 advisory items: stripe_webhook, billing_portal, live_billing_journey, google_drive_vault_acceptance). Phylax ok, WhatsApp connected. 0 error or decrypt log lines. Poller timer back on |
| 23:53:39 | Phylax adapter reconcile after the restart: all 4 bindings refreshed, same states, no new error (the tokens decrypt under the new key) |
| after | `tester-watch --check`: OK, no alerts. `secret put zenod-mt CHASSIS_VAULT_MASTER_KEY --stdin`: stored (the store copy equals the new key). `secret check zenod-mt`: ok 14, red 0 |

## Leftovers and retention

- Kept, root-only, until **2026-11-08**: `/root/zenod-key-rotation-2026-11-01/` (pre-rotation snapshot with old-key ciphertext, old key, env record, scripts) and the two rollback env JSONs in `~t3agent/.config/alpha9/rollback/` (the T3 one from 22:10 and this one; both hold the old key). The exact delete commands are in `DELETE-AFTER-2026-11-08.txt` in that dir.
- Deleted: the scan copy, the rehearsal copy, the new-key file and the key env files (shredded). The new key lives only in Dokploy env and `/etc/alpha9-secrets/zenod-mt/`.
- Residual: any older backup of the `zenod-mt-data` volume made before today still holds old-key ciphertext. It can be opened only with the retired key.

## Rollback

Stop `zenod-mt`, copy `prod-snapshot-20261101T2341Z/data` back over the volume, set `CHASSIS_VAULT_MASTER_KEY` from `old.key` (or restore the env from the pre-rotation JSON), then deploy. Valid until the backup is deleted on 2026-11-08.

## Incident during the window

At 23:41:11 the helper script printed the response of Dokploy `application.stop`. That endpoint returns the whole application record, so the full `zenod-mt` env went into this run's agent session output. The old (now retired) vault key was in it, along with the live Stripe secret key and webhook secret, the GitHub and Google OAuth client secrets, `ACCOUNT_STATE_SECRET`, `CONTROL_PLANE_TOKEN`, `ZENOD_CHANNELS_PRIVATE_TOKEN`, `ZENOD_PHYLAX_CONTROL_TOKEN`, the platform OpenRouter key, the Typesafe key and the Dokploy app refresh token. The new vault key was not in it, because it was set afterwards. The helper was fixed within a minute to print only "requested". The values went nowhere else: not to repos, files, logs or this document. The fix needs rotations at third parties (Stripe, Google, GitHub, OpenRouter) and coordinated Phylax token changes, so it is raised as an ask rather than done here.

Lesson for any Dokploy script: `application.stop/start/deploy/one` responses contain the env. Never print a response body; print a fixed word.

## Proposed T3.1 row update (for the Delivery Manager)

`T3.1 | … | done | E7-A7 (Jordi: rotate now safely) | #1459 | main | [T3.1 evidence](evidence/epic7-t3-1-key-rotation-2026-11-01.md): new key live 2026-11-01 23:42 UTC on 96b86b4, 65/65 vault ciphertexts + 4/4 Phylax tokens verified under the new key (counts unchanged), old key out of env, stored via secret put; health/readiness/Phylax/credentials verified; ~85 s downtime | 2026-11-01 | delete pre-rotation backup on/after 2026-11-08; new ask: rotate the zenod-mt secrets exposed during the window`
