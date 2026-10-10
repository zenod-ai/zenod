# Phylax-only production promotion to 52418e3

Date: 2026-10-10 (deploy 18:33 UTC)

Approval: Jordi explicitly authorized deploying PR #1370 (typed transcription failure codes), merged as `52418e3da6f54aa8220531fecf00c9f80e6c5b53`, to the live private Phylax companion. Code-only; rollback required if verification failed (it did not).

## Scope

Only the private Phylax Dokploy application changed. Public Zenod, the protected legacy Phylax compose `uCoS_Zr0qKZyQHu4UDVjx`, Epaminon, Outbound, Callisthenes, x-mcp, zenod-mt, Ring and Herald were not touched.

Note: `52418e3` is a merge on `main`, so the image also carries everything merged since the previous live revision `6f2a048` that reaches the Phylax artifact: #1370 (typed transcription failure codes), #1373 (user-created static MCP tokens on `/mcp`), #1374 (MCP auth failure rate-limit prototype/logging) and the UI/site/spine changes around them.

## Target

| Item | Value |
|---|---|
| Dokploy application | `urbFsgl6eImbQ4MTIZl5N` (`phylax`) |
| Swarm service | `app-index-back-end-panel-6zm3qg` |
| Volume | `phylax-data:/data` (preserved) |
| Previous image | `ghcr.io/zenod-ai/phylax:sha-6f2a048` (index `sha256:4f1875cda3e126bbbd3228a8f27a71c3b746da4c2e3639af40a5661d83b4f881`, image id `sha256:b2edacc03f9e9fd40f603dd83bea8913caeaeda3217170757d757aec6babbffe`), health sha `6f2a0484d890e0f4587073c25a33698fc1824192` |
| New image | `ghcr.io/zenod-ai/phylax@sha256:7b4c0b139736e8c4bf7d2cdddb81a1d4ed2e81bd4b007f8c1c1f68513ec76449` (= `phylax:sha-52418e3`), image id `sha256:e0a46db6e63f757ca1dac036ad44c23a71325497f0bbe1725d6c12a0a8fa7bc4` |
| `GIT_SHA` | baked into the dedicated image; the Dokploy env has no `GIT_SHA` entry and none was added |

## Preflight

- The live app was the dedicated `ghcr.io/zenod-ai/phylax` image (the `zenod:sha-*` + `AGENT=phylax` variant in older docs is not what runs). No image-repository switch was needed.
- Dokploy desired config and Swarm runtime matched exactly: image, 37 environment entries (key and value), one mount. Deployment queue had zero waiting/active/delayed jobs.
- Baseline was already degraded: `/api/health` returned 503 `unhealthy`, WhatsApp `error` with `transport-outage-sustained` (outage about 3.98 days, last reason `WhatsApp credential flush exceeded 2000ms`, generation 45, restart required) and recurring `[telegram] poll failed: fetch failed`. The running revision itself was correct (`6f2a048`).
- Backup: `scripts/zenod-volume-backup.sh` (byte-identical to the VPS copy `/root/zenod-volume-backup-587c005.sh`) quiesced the single task, archived `phylax-data`, resumed, checksummed, restored into a disposable volume and verified with `verify-zenod-data.mjs` from `zenod:sha-07b44cc` (the Phylax image does not ship the verifier): 5,036 files, 4,766 JSON, 28 SQLite, all OK. Archive `zenod-data-20261010T182613Z.tar.gz` (2,345,936,580 bytes, mode 0600 in a mode 0700 directory on the VPS data disk), restore-verified at 18:32:44 UTC. The task was paused for roughly four minutes during archiving. A Mac copy was started; its checksum is recorded privately. Never restore it over the live volume.

## Action

1. `application.update` with only `dockerImage` set to the digest above.
2. `application.redeploy` (title `Phylax typed transcription failure codes 52418e3`); Dokploy started it immediately, no queueing.

Environment (37 entries) and mount are identical before and after.

## Verification (18:33-18:38 UTC)

- Swarm: `UpdateStatus` `completed` (start-first), one running task on the new digest, old task `Shutdown`, restart count 0.
- Running container image id `e0a46db6e63f...` equals the pulled digest's image; `org.opencontainers.image.revision` is `52418e3da6f54aa8220531fecf00c9f80e6c5b53`; container `GIT_SHA` is the same.
- `https://phylax.zenod.dev/api/health`: HTTP 200, `status: ok`, `sha: 52418e3da6f54aa8220531fecf00c9f80e6c5b53`, worker `ok`, `restart.required: false`, instance `phylax-for-zenod / zenod / zenod-primary`.
- WhatsApp: `connected`, receive path `ready`, generation 1, no QR or operator action; the session persisted on `phylax-data` and reconnected by itself, which cleared the pre-deploy outage. No real messages were sent.
- Mount `phylax-data:/data` preserved; tenant MCP traffic resumed immediately in logs.

## Residual

- Telegram `poll failed: fetch failed` continues at about the pre-deploy rate (the old container logged it throughout); outbound connectivity and `getMe` succeed from the container. It is pre-existing and not caused by this deploy; Telegram expansion remains parked.
- The typed transcription failure codes themselves were not exercised live (would need a real voice note or credit/auth failure); only code identity and service health are proven.
- Rollback was not needed. Rollback path: update `dockerImage` back to `ghcr.io/zenod-ai/phylax:sha-6f2a048` and redeploy; this changes code, not data.
- Private receipt (configuration records, rollback target, checksums): `/Users/jordi/.local/state/phylax-deploy-20261010`.
