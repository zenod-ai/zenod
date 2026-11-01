# zenod-readiness-keeper (EPIC-7 T2.3)

Keeps Zenod production checkout open. Checkout needs `/api/public/production-readiness` `ready:true`
(`packages/server/src/productionReadiness.ts`), and three blocking checks there are dated proofs that age out.
This host tool on VPS1 renews the two an agent can renew and alerts on everything else.

| check | env on Dokploy `zenod-mt` | window | renewed by |
|---|---|---|---|
| `backup_restore` | `ZENOD_BACKUP_RESTORE_VERIFIED_AT` | 31 d | **automatic**: `keeper.py run` runs the two-volume drill when the proof is ≥ 24 days old |
| `stripe_profile` | `ZENOD_STRIPE_PROFILE_VERIFIED_AT` | 90 d | **automatic**: `keeper.py run` re-checks the live Stripe profile read-only when the proof is ≥ 60 days old |
| `google_drive_vault_oauth` (only while `ZENOD_PUBLIC_GOOGLE_SIGNUP=1`) | `ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT` | 90 d | **Jordi**: needs his Google Cloud console login (see below) |

## Units (VPS1, root)

- `zenod-readiness-keeper.timer`: daily 04:30 Europe/Madrid (off-peak for WhatsApp, after the 03:17 pg0 backup
  and 03:40 pg1 dump). `keeper.py run` does nothing unless a proof is due. When the backup proof is due it:
  1. preflight: both services 1/1 and healthy, ≥ 12 GB free;
  2. `zenod-volume-backup.sh` on `zenod-mt-data` (Zenod) then `phylax-data` (Phylax; verifier image = the Zenod
     image): pause, tar, resume, checksum, restore into a disposable volume, JSON + SQLite `integrity_check`,
     health probe;
  3. waits for Phylax WhatsApp `state: connected`;
  4. copies both archives + `.sha256` to Hetzner object storage
     `s31:vps-archives/archives/vps-a9-1/zenod-backups/<yyyymmdd>-keeper/{public,channels}/` with the shared
     `hetzner-s3` key (`secret run`, never printed) and runs `rclone check --download --one-way`;
  5. only then writes `ZENOD_BACKUP_RESTORE_VERIFIED_AT` = the later restore completion (and
     `ZENOD_STRIPE_PROFILE_VERIFIED_AT` when that check ran and passed) in one Dokploy `saveEnvironment`
     (refuses if any other key would change), redeploys, and waits until the running container has the new
     value and readiness is `ready:true`;
  6. keeps the newest 2 `keeper-*` archive dirs per volume under `/var/backups/zenod/{public,channels}`
     (other dirs untouched). Off-host copies are not pruned.

  A failure at any step changes no proof and queues an `[ALERT]`; the next night retries. Because the drill
  starts at 24 days, a broken drill gets 7 nightly retries and 7 days of `[WARN]` before the proof lapses.
  State: `/var/lib/zenod-readiness-keeper/last-run.json`; logs: `journalctl -u zenod-readiness-keeper`.
- `zenod-readiness-watch.timer`: hourly at :17. Queues `[ALERT]` when readiness is `ready:false` or a proof has
  expired, `[WARN]` when a proof is within 7 days of expiry or an endpoint is unreachable, re-alerts every 24 h
  while it persists, `[RECOVERED]` when it clears. State: `/var/lib/zenod-readiness-keeper/watch-state.json`.

Alerts go to the existing ops channel: the agent_team relay-watchdog queue
`/home/t3agent/agent_team_m0/alerts.pending/` (same file contract as infra-vps `disk_guard.py`), delivered to
the T3 thread "HQ — vps1 alerts" (agent_team `docs/m0/relay-outage.md`). The old `zenod-watchdog` WhatsApp path
targets the retired `c1.zenod.dev` and delivers nothing (docs/health/INVENTORY.md §4.2); EPIC-6 S5 owns moving
prod alerts to WhatsApp via Phylax, and this watcher can switch sender then.

## Commands

```sh
sudo bash scripts/readiness-keeper/install.sh            # install/upgrade from a main checkout; re-run after
                                                         # changes to keeper.py or scripts/zenod-volume-backup.sh
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py status                 # proofs + expiry
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py run --dry-run --force-drill --force-stripe
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py run --force-drill      # drill now (pauses Zenod ~2 min, Phylax ~3-5 min)
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py stripe-profile [--apply]
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py watch --dry-run --now 2026-11-25T00:00:00Z
sudo python3 /usr/local/lib/zenod-readiness-keeper/keeper.py test-alert --note "why"
python3 scripts/readiness-keeper/keeper.test.py         # unit tests (also asserts the windows match productionReadiness.ts)
```

Settings are overridable in `/etc/zenod-readiness-keeper.env` (`KEEPER_*`, see `DEFAULTS` in `keeper.py`).
The Phylax pause is owned by `scripts/zenod-volume-backup.sh` (EPIC-7 T2.7 is reducing it); the keeper only calls
that script, so a better script needs just `install.sh` again. Change the time in `zenod-readiness-keeper.timer`.

## Drive login check (`google_drive_vault_oauth`)

The proof is an operator review of the Google Cloud project: exact Drive OAuth client, redirect URI, branding,
`drive.file` scope and verification status (docs/evidence/zenod-google-drive-vault-release-acceptance-2026-08-30).
No Google Cloud credential exists on the fleet (`secret find gcloud|gcp|service-account` empty), so only Jordi can
do it. Current proof 2026-08-30T15:48:22Z expires **2026-11-28T15:48:22Z**; the watcher warns from 2026-11-21.
To renew: Jordi checks the OAuth client in Google Cloud console, then an agent sets
`ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT` to the time of that check (never ahead of it) and redeploys.

## Fallback if a proof lapses anyway

Checkout already has an allowlist that bypasses `ready:false` for named owners (`checkoutEnabledForOwner`):
`ZENOD_LIVE_CHECKOUT_TESTER_GOOGLE_EMAILS` (comma-separated verified Google emails; also `_GITHUB_IDS`,
`_USER_IDS`) on Dokploy `zenod-mt`. Putting the testers' emails there keeps them able to check out while public
checkout is closed. It is a production env change, so the delivery manager decides; this tool never sets it.
