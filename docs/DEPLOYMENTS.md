# Zenod deployments: procedure and live state

The live page for deploying Zenod: the boundary, how production rolls, how to upgrade and undo by hand, where the credentials are, and what is running now. It replaces the closed [Deployments and upgrades spine (ZDU)](EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md) as the place to look; that spine is history (its Outcome, the 2026-09 rollout receipts and the Phylax-only promotions). Open deploy work is not tracked here: it is a ledger row in an open epic (`spines.py --repo . --active`); today the broken auto-roll is [ZAL A0](EPIC-ZENOD-ALPHA-LAUNCH.md).

## Live state

Update this section whenever a deploy is verified (record the SHA from health, the date and how it was checked).

- **Production health** (`https://cloud.zenod.dev/api/health`, 2026-10-24 ~23:00 UTC): status ok, sha `6cf125af7c8f14f931139b27da886f9708f50ad9` (`main` at that time).
- **Push-to-main auto-roll (root D27) is failing:** the `deploy` job of the Publish image workflow fails since 2026-10-24 with `curl: (22) ... 404` on the first Dokploy API call (e.g. run [40139987176](https://github.com/zenod-ai/zenod/actions/runs/40139987176) on `6cf125a`); `publish` succeeds. Health still reports current `main`, so some other path rolled it; the cause is unverified. Fix and proof belong to [ZAL A0](EPIC-ZENOD-ALPHA-LAUNCH.md) (likely the Dokploy app/project or API base moved in the infra-vps cleanup).
- **Phylax:** deliberate manual deploys only; last recorded promotion `a5617ab` (2026-10-13, see the [ZDU history](EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md#2026-10-13--phylax-only-promotion-to-a5617ab)).
- Merged code is not deployed proof: confirm the live sha at `/api/health` and record it here.

## Boundary

Set by Jordi on 2026-09-07: this repository deploys **live Zenod production images and, when appropriate, the default Phylax/WhatsApp companion only**. No other agent or service (Epaminon, Outbound, Callisthenes, x-mcp, Ring, Herald, ...) may deploy automatically from pushes, merges or releases here; their legacy triggers stay disabled. Default Phylax is not a blanket authorization to restart unrelated private services on every release. Independent agents move to their own repositories and lifecycles as separate follow-up work; preserve running services and data during any extraction.

## Automatic Zenod production roll (PR #964)

Owner decision (root spine D27): a push to `main` re-pins and redeploys Zenod production without a manual step. `publish.yml` builds the images, then its `deploy` job runs `scripts/deploy-fleet.sh` with `IMAGE=ghcr.io/zenod-ai/zenod:sha-<short>` through the Dokploy API (`application.update` + `application.deploy`).

- **Auto-deployed:** only the Dokploy app named in `DEPLOY_APPS` (default `zenod-mt`, project `zenod`, environment `production`; `cloud.zenod.dev`). The script refuses any app whose current image is not `ghcr.io/zenod-ai/zenod`.
- **Never auto-deployed:** the dedicated `ghcr.io/zenod-ai/phylax` image (published only; the private `phylax` app, `urbFsgl6eImbQ4MTIZl5N`, stays a deliberate manual deploy "when appropriate"), Ring, Herald, Epaminon, Outbound, Callisthenes, x-mcp and any other independent service. Do not widen `DEPLOY_APPS` to include them.
- **Activation:** repo secrets `DOKPLOY_API_KEY` and `DOKPLOY_API_BASE` (set from the Keychain loader, see "Dokploy credentials — where they live"). With either unset the job skips cleanly (exit 0). `DRY_RUN=1` prints the planned change without mutating.
- **Success check:** the script waits until `VERIFY_URL` (default `https://cloud.zenod.dev/api/health`) reports the new sha, since Dokploy can accept a deploy and leave it queued (lesson 9 below); Dokploy `error` or a timeout fails the job. Runs are serialized (`deploy-zenod-production` concurrency group).
- **Rollback:** pins are immutable, so re-pin the previous sha. Each run logs `zenod-mt: <previous> -> <new>`; to undo, run the script locally with `IMAGE=ghcr.io/zenod-ai/zenod:sha-<previous> VERIFY_SHA=<previous>` (or set the image in Dokploy and redeploy). The next push to `main` rolls forward again. Code rollback only; data is not restored.
- **Downtime and safety:** this path does not take the recoverable backup or quiesce step of the manual helper above, so it fits code-only changes with unchanged storage contracts. A storage/migration change still follows the manual procedure. The image defines no `HEALTHCHECK`, and `zenod-mt` has a single `/data` volume (SQLite) with stop-first replacement (`scripts/zmr-production-image.py` deliberately avoids start-first), so expect a restart blip of seconds, accepted while the owner is the only user. Zero-downtime needs the staging/prod split and a healthcheck (root spine D28, planned).
- Merged code is not deployed proof: confirm the live sha at `/api/health` and record it.
- **First live run failed falsely (2026-10-10, merge of #1375, `066ab3d`).** The roll itself worked: `application.update` + `application.deploy` started a Dokploy deployment within a second, Swarm replaced the task, and the running task image and OCI revision were `sha-066ab3d`/`066ab3d4`. But `/api/health` kept reporting `587c005` and the script timed out ("Dokploy status 'done', live sha 587c005"). Root cause: the Dokploy app env carried an explicit `GIT_SHA=587c00521ddd...` line (left by the manual `zmr-production-image.py` roll). A runtime env var overrides the `GIT_SHA` the image bakes at build time, so health reported the stale value for any new image. It was not a missing tag, a queue stall, a wrong endpoint (`deploy` is fine) or a Swarm registry-auth/force-update issue.
- **Fix:** `deploy-fleet.sh` now detects a `GIT_SHA=` line in the app env and removes it in the same `application.update` (all other env lines preserved), also when the image already matches, so health reflects the image that is running. It still only reports success when live health matches the target sha. Production was repaired by removing the override and redeploying (about 2-4 s of 502, stop-first restart). Tests: `scripts/deploy-fleet.test.mjs` (fake Dokploy). Do not re-add a `GIT_SHA` env override to `zenod-mt`; manual helper rolls that still rewrite it must be followed by the next auto-roll, which strips it again.

## Manual upgrade and undo

The existing helper supports this September 6 release and reviewed code-only repairs using its frozen recovery receipt. The reviewed helper is merged through [PR #1218](https://github.com/zenod-ai/zenod/pull/1218). It is not a generic backup/deployment framework. Reuse the flags below rather than copying or editing release constants.

From `/Users/jordi/Documents/GitHub/wt-zmr-production` (or the repository after integration):

```sh
eval "$(dokploy-env)"
python3 scripts/zmr-production-image.py deploy
# A reviewed code-only repair using this same approved recovery receipt:
python3 scripts/zmr-production-image.py deploy --candidate-sha FULL_SHA --candidate-image ghcr.io/zenod-ai/zenod@sha256:FULL_DIGEST --state-dir SECURE_RECEIPT_DIR
# Undo this release while retaining the current data volume:
python3 scripts/zmr-production-image.py rollback
```

Replace the uppercase repair placeholders with the reviewed full source SHA, matching immutable image digest and existing secure receipt path; both candidate flags are required together. The helper atomically records approved attempted/prior images, so rollback still works after an interrupted repair. Three offline simulations cover override→rollback, sequential overrides→rollback, and a failed second override→rollback.

The matching secure receipt defaults to `/Users/jordi/.local/state/zenod-zmr-production-20260906`; `ZMR_DEPLOY_STATE` may point to that receipt's recovered location. Rollback targets prior source `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22`, image `sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d`. No live rollback was performed during this successful image switch. Do not invoke `deploy` merely to check status.

For every upgrade:

1. Pin reviewed source and immutable published image; compare actual running state and OCI source. Select only the service affected by the change.
2. Save exact configuration and rollback image privately. Require a recoverable backup under the policy below. Use the existing Keychain-backed loader and SSH alias `hetzner_vps_1`; never paste credentials into Git or chat.
3. Update the image and necessary source-SHA override through Dokploy. Refuse unexpected runtime or pending Dokploy configuration drift. Preserve volumes, sessions and unrelated settings.
4. Require completed Swarm update, the actual running task's exact image, actual container OCI revision, correct health SHA and the product's live smoke checks. Desired state or a healthy endpoint alone is insufficient. On failure, inspect the receipt before retrying; use code rollback when appropriate.

If a future candidate remains queued, first cancel that exact pending candidate request through the supported queue operation after rechecking its application and waiting state, then invoke rollback. Otherwise an already queued upgrade could run after the undo. Do not cancel unrelated jobs.

Rollback changes code, not data. It retains captures written after deployment. Restoring an older data archive can erase later writes and needs a separately scoped recovery decision; never silently restore over the live volume.

## Dokploy credentials — where they live

On VPS1 the Dokploy API key is in `~t3agent/.config/alpha9/` (see the [secrets catalog](https://github.com/AlfaBlok/infra-vps/blob/main/docs/secrets-catalog.md)); on the owner's Mac:

The Dokploy API credentials already exist on the owner's Mac. Agents must load them and must never ask the owner for them.

- **Keychain item:** login keychain, generic password, service `alpha9-dokploy-api-key`, account `jordi`. It holds the Dokploy API key. Never read it with `-w` into logs, chat, files or PRs.
- **Non-secret profile:** `~/.config/alpha9/dokploy.env` holds only the Keychain item names and the public values (`DOKPLOY_API_BASE`, `DOKPLOY_PUBLIC_URL`, `DOKPLOY_VPS_SSH_HOST`, `DOKPLOY_VPS_HOST`). No key.
- **Loader:** `/Users/jordi/.local/bin/dokploy-env` reads the profile and the Keychain item and prints `export` lines. Use `eval "$(dokploy-env)"`; it exports `DOKPLOY_API_BASE` and `DOKPLOY_API_KEY`. Auth header is `x-api-key`. Verify by behavior, for example an authenticated `GET "$DOKPLOY_API_BASE/project.all"` returning HTTP 200 with the `phylax` and `zenod-mt` apps visible; never print the key.
- **GitHub repo secrets:** `DOKPLOY_API_KEY` and `DOKPLOY_API_BASE` are set on `zenod-ai/zenod` for the auto-roll job above. To rotate, set them again from the loader with the value on stdin (`gh secret set DOKPLOY_API_KEY --repo zenod-ai/zenod` fed from the loader, never as an argument).
- **Rule:** an agent that needs Dokploy runs `eval "$(dokploy-env)"` itself. If the loader fails, report the exact error (missing profile, missing Keychain item, HTTP status); do not ask the owner to supply or paste the key.

## Backup policy

The current mechanism is `scripts/zenod-volume-backup.sh`: quiesce, archive, resume, checksum, then restore into a disposable volume and verify JSON/SQLite. This rollout paused public Zenod approximately three minutes (19:56–19:59 UTC): 1.6 GB source produced a 1.4 GB archive. Restore passed at 20:01:48 UTC with 1,127 files, 10 JSON files and 69 SQLite databases. Full backup and encrypted transfer dominated preparation time; the image update itself completed in seconds.

Today's accepted recovery proof is the fresh verified VPS archive plus independent checksum-matched Mac copy, mode 0600 inside a mode-0700 directory. Configuration receipts are already encrypted-uploaded and download-checked. The full 1,498,818,408-byte encrypted object upload and decrypted download comparison subsequently passed; the rollout did not wait for that redundant transfer. The established remote is `zenod-prod-crypt:` backed by `s31:vps-archives/zenod-production-encrypted`.

For future code-only upgrades with unchanged storage contracts, prefer a fresh recoverable scheduled backup and an already validated restore mechanism. Reuse within one repair rollout only when its recovery point and subsequent writes are recorded and accepted; do not repeatedly pause for identical proof. If a qualifying backup is absent, take a fresh one. A new destructive/storage migration needs fresh backup and a separate restoration plan. This is the reuse rule, not a claim that a qualifying scheduled backup currently exists. Incremental backup redesign is deferred. Another measured source of delay is CI/publishing: documentation-only PRs run the full product suite, and publication serially builds/checks both product images even when only public Zenod is being deployed. Path-aware documentation checks and affected-product publication are future simplifications; no pipeline redesign was mixed into this repair.

## Durable lessons

1. **Production authorization persists within scope.** Jordi authorized this single-user deployment, tests and fixes. Do not re-ask for staging/provider setup already supplied by production. Future upgrades require their own applicable authorization.
2. **Deploy the smallest service set.** Memory-only code needed public Zenod; restarting private Phylax added no benefit.
3. **Prove the actual version.** Merge, publication, desired image and health are different facts. Require actual task/container identity and OCI source too.
4. **Preserve both runtime and pending configuration.** This release changed only `GIT_SHA` among 53 runtime entries. Refuse drift in both Swarm and Dokploy before writing the captured environment back.
5. **Code rollback is not data rollback.** No migration occurred, but additive memory metadata and later composition have compatibility limits. Preserve raw captures; never promise zero risk or automatic reversal of written semantics.
6. **Backup cost needs proportion.** A full cold archive caused the pause; cloud transfer took longer. Independent verified recovery allowed the slow redundant transfer to continue separately, explicitly disclosed.
7. **Reuse safe working transport.** Cloudflare rejected Python urllib's admin request fingerprint; existing curl worked. Keep API headers in temporary mode-0600 files, out of process arguments and exception messages.
8. **Test the real memory paths separately.** Exact reads/chat passed while natural-query recall and automatic filing failed. A saved raw record or healthy deployment does not prove customer acceptance; retain these live regressions.

9. **Accepted is not started.** Dokploy can return HTTP 200 with an empty body while the request waits in its global BullMQ queue. The deployment-history endpoint only showed worker-started records. Both deploy and redeploy were working; changing endpoint names was not a demonstrated fix. A convergence timeout must trigger read-only queue inspection before any retry. Preserve the earliest request; cancel only verified duplicates with a supported operation. Never restart shared services or force Swarm merely to bypass the queue.
