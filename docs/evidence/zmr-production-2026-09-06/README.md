# ZMR production rollout — 2026-09-06

Operator: `/root/zmr_deploy_audit`, delegated by delivery manager. Jordi explicitly approved production deployment, testing and fixes, and requested easy undo. This supersedes the earlier pre-deployment test-provider waiting gate. Production deployment verified on2026-09-06 at20:06:05UTC; parent owns customer MCP/browser acceptance.

Target is public Zenod only: Dokploy application `2dkayH_eAur427leH64MT`, Swarm service `zenod-mt-fxpzoo`, durable mount `zenod-mt-data:/data`. Private Phylax remains untouched. Candidate is exact locally validated product `392d058a599bdf5fc69d17157282b8f9154dcf28`, immutable image `ghcr.io/zenod-ai/zenod@sha256:d21468dbf09f33550c52eb53bed32adea616842b4a144cd5cda428861f151a93`.

Compared with deployed `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22`, this is a substantial memory-behavior release delivered in reviewed increments, not a tiny patch. No database migration, startup migration, environment schema, Dockerfile, auth or billing change exists in the delta. Capture updates retain raw evidence and previous body lines; oversized summaries retain their old text in the body. New `aliasEvidence` and `memoryFacts` frontmatter are additive and parsable by the old version. Rolling code back removes the new retrieval semantics; old-version future composition is not proven to preserve all new structured metadata. Code rollback does not erase captures or restore old data.

Phylax dispatches its established `store_memory`/`ingest_memory`/chat tools to Zenod; this release removes no channel protocol. Therefore the minimal scope is Zenod-only, avoiding an unnecessary private channel restart. Real channel sends remain outside this deployment check.

Only environment delta: set the existing `GIT_SHA` override to the exact candidate; preserve the other 52 runtime environment entries, mounts, session material, signup flags and all commercial/provider settings. Save complete Dokploy and Swarm configuration outside Git under mode-0700 directory `/Users/jordi/.local/state/zenod-zmr-production-20260906`.

## Easy code rollback

From this worktree, run:

```sh
eval "$(dokploy-env)"
python3 scripts/zmr-production-image.py rollback
```

The script pins prior immutable image `ghcr.io/zenod-ai/zenod@sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d`, restores the captured exact prior application environment, redeploys through Dokploy and checks one running task, completed Swarm update, exact task/service image and health SHA. It refuses mount/non-SHA runtime environment drift. It never restores, deletes or overwrites the data volume. The source snapshot directory must be available; it is also copied through the existing encrypted backup remote.

Backups use the repository's quiesced-volume archive script, disposable-volume JSON/SQLite integrity verification, and configured `zenod-prod-crypt:` remote, backed by `s31:vps-archives/zenod-production-encrypted`. This established client-encryption mechanism supersedes copying unencrypted raw files to an S3 prefix. For this code-only no-migration update, the parent explicitly accepted deployment after verified independent laptop copy and successful VPS restore drill while the redundant encrypted cloud upload continues. Cloud completion must be recorded separately, never inferred.

## Fresh backup evidence

Source1.6GB, compressed archive approximately1.4GB. Public process paused from19:56UTC until19:59UTC for consistency, then resumed before the disposable restore. Verified2026-09-06T20:01:48Z:1127 files,10 JSON,69 SQLite databases, all valid. Archive `/var/backups/zenod/zmr-20260906/zenod-data-20260906T195603Z.tar.gz`; SHA256 `a2f21b3850b4fa60e90acad7ab85bbc7601119766dafc5dd91c10090ec2a164c`. Local copy hash matches. Encrypted object `zenod-prod-crypt:zmr-20260906/public/zenod-data-20260906T195603Z.tar.gz`; upload/download verification pending. Full protected before-config JSON snapshots already uploaded and download-checked in `zenod-prod-crypt:zmr-20260906/config`.

## Live deployment evidence

Dokploy normal `application.update` + `application.redeploy` succeeded. Swarm update started2026-09-06T20:05:58.627408496Z and completed2026-09-06T20:06:05.773768396Z. One desired/running task uses the exact candidate index. Container image ID `sha256:f0b913fb3cfc6de695a04262e1d53af3e1eafc973ed1f9d742665d2c37ec5405`; actual image OCI revision and public `/api/health` both equal the exact candidate SHA. Mount and52 non-SHA environment entries compare unchanged. Private Phylax remains at `ghcr.io/zenod-ai/phylax@sha256:1ae6607fb5cabf059a7058ae0b80abc2a492dab32d034b903dc920b73759b53e`.

The user's existing tenant is available for parent-run authenticated MCP tests. No production data restore, billing action, channel send, signup change or credential change was performed. Real customer behavior is a separate parent validation receipt.

## Operator learnings

- Docker publication was separate from deployment. This release now has exact running-image proof rather than relying on merged source or image tags.
- Do not restart private channel runtime for Zenod-only memory work when its existing dispatch contract is unchanged.
- Consistent1.6GB backup caused roughly3minutes pause. Future upgrades should reuse supported incremental backup machinery or prepare copies before the live window; do not equate backup duration with deployment duration.
- Independent verified laptop copy plus verified VPS restore provided recovery before redundant cloud upload completed. Its pending state was explicitly accepted and disclosed; keep transport completion separate from restore integrity.
- Python urllib default fingerprint was rejected by Cloudflare1010 before mutation. Existing curl admin transport works; API headers now live in a temporary mode0600 file so neither process args nor exception tracebacks expose credentials.
- Verify actual running task image, completed Swarm update, exact health SHA and preserved configuration, not desired-image configuration alone.
- Current helper is a pinned operator for this release; further upgrades should parameterize the same reviewed flow and freeze a receipt, not copy/edit its constants ad hoc.
