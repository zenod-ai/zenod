# EPIC-6 S1 — Health inventory: what Zenod is made of, where it runs, how we know it is alive

Parent: [EPIC-6 health dashboard](../EPIC-6-HEALTH-DASHBOARD.md) (ledger row S1). Read-only probe of production on **2026-10-25 03:50–04:00 UTC** from VPS1 (`vps-a9-1`, tailnet `100.104.206.10`) after the infra-vps cleanup. No secret and no user content is on this page: env/key **names** only, counts and timestamps only, tenants unnamed. Method: public `curl` of the endpoints, Dokploy API `GET` (apps, domains, mounts, env names), and read-only `docker exec` (`node:sqlite` opened `readOnly`, `ls`) inside the running prod containers. Nothing was written, restarted or deployed.

Recorded decision respected: [EPIC-6-A1](../EPIC-6-HEALTH-DASHBOARD.md) (Jordi, 2026-10-25) — the health page is internal-only via Tailscale. So this inventory lists what is reachable **from the tailnet**, which is a superset of what is reachable from the internet.

## 1. What is reachable from the tailnet (the page's vantage point)

| Reach | How | Notes |
|---|---|---|
| Public product endpoints | `https://zenod.dev/`, `https://cloud.zenod.dev/api/health`, `https://phylax.zenod.dev/api/health` (Cloudflare → tunnel → Traefik) | Same answers inside and outside the tailnet. `mind.zenod.dev` answers 301 (redirect alias). |
| VPS1 services on the tailnet IP | `100.104.206.10`: Dokploy API `:3000/api` (key in `~t3agent/.config/alpha9/`), infra observatory `:8090`, health-gate `:8092`, whatgpt admin `:8091`, agent_team console `:8750` | Ports in use; a Zenod health page needs a new free port (or a Dokploy domain on a tailnet-only listener, the `whatgpt-admin-tailnet` socat pattern in infra-vps `hosts/vps1/whatgpt-admin-tailnet`). No public DNS record for `health.zenod.dev` (A1). |
| Prod containers (read-only inspection) | `docker exec` on VPS1 from a tailnet host with sudo | Not available to a Dokploy app without the docker socket or a volume mount; see §6 (design constraint for S2). |
| Dokploy API | `project.all`, `application.one` | Gives deployment history, status, domains, env **names**; good for "deployed image" and "last roll" rows. |
| Host timers on VPS1 | `systemctl`/`journalctl` | Deploy poller, watchdog, observatory build (§4). |

Tailnet peers today: `vps-a9-1` (VPS1), `vps3`, `vps1-egress`, Jordi's Mac and phone.

## 2. Components and where they run

Everything below runs on **one host, VPS1 (Hetzner)**, as Docker Swarm services deployed by Dokploy (project `zenod`) unless noted. There is no Postgres in the Zenod path: the database is SQLite files on two Docker volumes.

| # | Component (E6-1 row) | What runs it today | Image / pin | State 2026-10-25 |
|---|---|---|---|---|
| 1 | Marketing site `zenod.dev` | **Same container as the cloud app**: Dokploy app `zenod-mt` (`2dkayH_eAur427leH64MT`), service `zenod-mt-fxpzoo`, domains `zenod.dev`, `cloud.zenod.dev`, `mind.zenod.dev` → port 8080; the static site is chosen by Host header (`packages/server/src/staticSurfaces.ts`, `ZENOD_PUBLIC_SITE_HOST`) | `ghcr.io/zenod-ai/zenod:sha-a544887` | up; `GET /` 200 in 0.16 s |
| 2 | Cloud app `cloud.zenod.dev` | same `zenod-mt` container (multi-tenant Zenod, Stripe live, public Google/GitHub signup and paid signup on) | same | `/api/health` ok, sha `a544887a6ca1…` |
| 3 | Database incl. credits/usage ledger | SQLite on volumes `zenod-mt-data` (`/data` in `zenod-mt`, 61 tenant dirs, ~1.7 GB) and `phylax-data` (`/data` in `phylax`, ~2.9 GB). Ledgers listed in §3.3 | n/a | files present and written (see §3.3) |
| 4 | WhatsApp relay | **Phylax** (Dokploy app `phylax`, `urbFsgl6eImbQ4MTIZl5N`, service `app-index-back-end-panel-6zm3qg`, domain `phylax.zenod.dev`; instance `phylax-for-zenod`, provider mode `self_host_dev` = a linked WhatsApp session stored in `/data/whatsapp/session`). Phylax also does the voice transcription and the allowance (credits) ledger for WhatsApp | `ghcr.io/zenod-ai/phylax@sha256:13c5710c…` (health sha `dc24572`, the 2026-10-22 Node 22.23.4 rebuild of `ec3968c`) | up since 2026-10-23 17:37; WhatsApp `connected`, reconnect generation 11, last connect 2026-10-24 05:05 |
| 5a | Agent runner | **Not deployed.** `zenod-agent-runner`, Epaminon, Archus compose apps are stopped/idle in Dokploy (`epaminon`, `callisthenes`, `ring`, `herald`, `zenod-cloud-test` all `idle`); volume `zenod-agent-work` (7.9 GB) is unattached. `execution_tickets`, `journeys`, `ingest_jobs` are empty in every tenant. | n/a | nothing to probe; row should be grey "not deployed", not red |
| 5b | Agents inside the app | Zenod's in-process job queue + LLM calls (`tasks.sqlite` `task_jobs`, per-tenant `usage.sqlite` `llm_usage`) | part of `zenod-mt` | last job done 2026-10-24 06:57 UTC |
| 5c | Phylax | see row 4 | | |

Adjacent, not E6-1 rows but they decide whether rows 1–4 can change: **deploy path** (§4.1), **host watchdog** (§4.2), `zenod-outbound` (running, `ghcr.io/zenod-ai/zenod:sha-2c34984`, compose app `outbound`), `x-mcp-readonly`/`x-mcp-postread` (running). Out of scope for the page unless Jordi wants them.

## 3. Health signal, last real activity, last error — per component

Thresholds below are proposals for S2/S3 (not yet built or agreed). "Today" values were read during this probe.

### 3.1 Marketing site (row 1)

- **Health signal:** `GET https://zenod.dev/` → 200 and `<title>` contains `Zenod`. Today 200, 0.16 s.
- **Last real activity:** none meaningful (static). Show "n/a".
- **Last error:** none recorded; Traefik access log is the only source (not collected). Use the probe's own last failure time.
- **Caveat:** it is the same process as the cloud app, so a green site and a red cloud app can only differ on routing/Cloudflare, not on process death. Keep the row (users see it) but note the dependency.

### 3.2 Cloud app (row 2)

- **Health signal:** `GET https://cloud.zenod.dev/api/health` → `{"status":"ok","name":"zenod","version","sha","eventLoop":{p50Ms,p99Ms,maxMs,utilization}}` (`packages/server/src/zenodUnit.ts:996`). Today ok, p99 22 ms, utilization 0.009. Amber when `eventLoop.p99Ms` > 200 or `utilization` > 0.8 (the same thresholds the app uses for its own warnings, `eventLoopHealth.ts`). The endpoint answers 200 even when Stripe/Google/DB paths are broken: it proves the process and event loop only.
- **Deployed SHA vs `main`:** `sha` today `a544887a6ca1779b8b561e8db9dae7bc9358515a`; `main` is `b297ce7`. Do **not** compare to `main` HEAD: docs-only pushes no longer publish or deploy (root D34), so HEAD moves without prod changing. Compare to the latest commit on `main` that touches AGENTS.md's `Deploy gate:` paths (today `4e5d17b`, a workflow-only change, so a gap here may not mean a stale image; S2 should compare to the last commit touching image inputs, or to the newest `Publish image` run whose `publish` job succeeded). Amber if behind for more than the deploy poller interval (2 min) + build time.
- **Last real activity:** last LLM call and last finished job: per-tenant `usage.sqlite` `llm_usage.ts` and `tasks.sqlite` `task_jobs.updated_at`. Today 2026-10-24 06:57:38 UTC (llm_usage), 06:57:41 (task_jobs).
- **Last error:** `llm_usage` rows with `status<>'succeeded'` (columns `status`, `error_code`): 45 rows, newest 2026-10-22 17:58 UTC. `task_jobs.status='error'` (`error` column): 26 rows, newest 2026-09-14. Docker stdout is **not** a usable error history: `zenod-mt` logged 30 lines since its last recreate (2026-10-24 23:13 UTC) because stdout resets on every deploy (json-file, 3 × 50 MB). Prefer the SQLite ledgers (the same point the app makes in `meshGateway.ts` for the session-log tool).
- **Related per-binding signal:** `zenod-phylax-adapter.sqlite` `zenod_phylax_bindings` has 4 rows: 3 `active`, 1 `unavailable` with `last_error_code = phylax_unavailable`, refreshed every few minutes (newest 2026-10-25 03:50 UTC). Not diagnosed here (may be a dormant test account); S2 should show "bindings unavailable: 1 of 4" so it is seen, and A0/ZAL should decide whether it is real.

### 3.3 Database and credits/usage ledger (row 3)

The "database" is a set of SQLite files; there is no server to ping. Signals are (a) the owning app's health, (b) a read-only query that opens each file, (c) freshness of the newest row in the ledger tables.

| Ledger | File (volume) | Table / columns | Newest row today | Notes |
|---|---|---|---|---|
| Platform per-tenant usage units (credits consumed) | `/data/usage.sqlite` (`zenod-mt-data`) | `tenant_usage(id,tenant_id,ts,kind,units,metadata_json)`, `tenant_usage_totals`, `tenant_usage_daily` | tenant_usage: 2026-10-24 06:53 UTC (70,901 rows) | zenod side |
| LLM provider-billed calls with error code | `/data/<tenant>/usage.sqlite` | `llm_usage(ts,operation,provider,model,tokens,cost_usd,status,error_code)` | 2026-10-24 06:57 UTC | 833 rows in Jordi's tenant, 45 failed |
| Zenod↔Phylax allowance bindings | `/data/zenod-phylax-adapter.sqlite` | `zenod_phylax_bindings(state,last_error_code,updated_at,…)`, `zenod_phylax_allowance_operations` | updated 2026-10-25 03:50 (polled) | the "is Phylax reachable per account" signal |
| WhatsApp allowance (the credits ledger) | `/data/phylax-allowance.sqlite` (`phylax-data`) | `phylax_allowance_entries(kind grant/usage/expiry, amount_units, occurred_at)`, `phylax_paid_work(state, pause_reason)` | usage 2026-10-24 06:53:45, grant 2026-10-15, expiry 2026-10-15; paid_work 223 `done`, none paused | paused work = credits exhausted |
| Phylax request meter | `/data/usage.sqlite` (`phylax-data`, **353 MB**) | `tenant_usage` | 2026-10-25 03:50 (204,030 rows) | written every minute by background polling: **freshness here is not user activity**; do not use it as "last real work" |
| Accounts | `/data/customer-accounts.json` (`zenod-mt-data`) | JSON | modified 2026-10-25 03:49 | file mtime only |

- **Health signal (proposal):** all of the above open read-only and `PRAGMA quick_check`-style reads succeed; plus volume free space (host root and the volume's filesystem) and file growth for the 353 MB Phylax meter.
- **Backups:** the recovery proof `ZENOD_BACKUP_RESTORE_VERIFIED_AT` in the app env is 2026-08-30; no timer or cron on VPS1 references `scripts/zenod-volume-backup.sh`; the newest archive under `/var/backups/zenod` (now a symlink to the HC volume) is 2026-09-16, plus a 2026-10-12 manifest. A "last verified backup age" row would be **red from day one**; that is a real finding for ZAL, not a dashboard bug.
- **Last error:** `llm_usage.error_code`, `task_jobs.error`, `zenod_phylax_bindings.last_error_code`, `phylax_paid_work.pause_reason`.

### 3.4 WhatsApp relay — Phylax (row 4)

- **Health signal:** `GET https://phylax.zenod.dev/api/health` (`phylaxUnit.ts:396`, public, 503 when a restart is required): `status` ok/degraded/unhealthy, `worker.lastHeartbeatAt` (stale after 20 s), `channels.whatsapp.state` + `receivePath.status` (`ready` today, socket `connected`), `restart.required`, `eventLoop`. Today ok, worker heartbeat fresh, outage `null`.
- **What that does not prove:** the payload says `scope: "transport-lifecycle-only"`. A connected socket does not prove a message round-trips. Pair it with the activity row below.
- **Last real activity (messages):** `/data/whatsapp/whatsapp.sqlite`: `whatsapp_messages` (`direction`, `received_at`) newest inbound 2026-10-24 06:53:14 UTC (371 inbound total); `whatsapp_outbound_audit` newest `sent` 2026-10-24 06:53:45 (298 sent). So ~21 h without traffic at probe time; "idle" is amber only if testers are expected (after DOD-1 starts), otherwise informational.
- **Last error:** `whatsapp_outbound_audit.error_text/status` (`error`, `failed`, `recovery_failed`; newest `failed` 2026-10-02 19:25), `whatsapp_voice_jobs.failure_*` (11 `failed`, newest 2026-10-02), `whatsapp_channel_audit.failure_code` (`downstream_rejected` 16, newest 2026-09-14; `downstream_schema_drift` 3, newest 2026-10-01). Stale error history is old and not recurring in the last 3 weeks.
- **Logs:** Phylax stdout is structured JSON (pino, `level`, `event`, `tenant_id`) at 76,879 level-30 lines and 0 warn/error in the retained last-48 h window; Phylax has not been recreated since 2026-10-23, so its stdout retains more history than `zenod-mt` but is still lost at the next deploy.
- **Notification reachability:** see §5 (Jordi's tenant has WhatsApp notify on, verified).

### 3.5 Agent runner and Phylax (row 5)

- **Phylax** is row 4 (the E6-1 wording "agent runner + Phylax" mixes two things; propose splitting into "Phylax / WhatsApp relay" and "Agents").
- **Agent runner:** not deployed (see §2); no health endpoint exists for it in the hosted fleet, and `scripts/watchdog/zenod-watchdog.sh` still lists `zenod-agent-runner` in its container list (skipped silently when absent). If it returns, its signal is the container restart count and `execution_tickets` freshness; until then show grey.
- **Agents as users see them:** the in-app agent path is row 2's `llm_usage` + `task_jobs` freshness. `scripts/exec-smoke.mjs` exercises the execution lane end to end but **writes** (fires a no-op ephemeral) and needs a bearer token, so it is not a read-only smoke and must not go into S3.

## 4. Adjacent signals the page should know about

### 4.1 Deploy path (what actually rolls prod today)

The GitHub `deploy` job of *Publish image* fails (Dokploy API 404, e.g. run 40139987176: `publish` success, `deploy` failure) and is owned by ZAL A0. Prod is in fact rolled by a **VPS1 user timer**: `infra-vps-deploy-poller.timer` every 2 min (`infra-vps` `hosts/vps1/deploy-poller.json`: target `zenod-mt`, workflow `publish.yml`, branch `main`, publish job `publish`, verify `https://cloud.zenod.dev/api/health`). Its last runs say `deploy-poller zenod-mt: noop up to date`. Signal: `journalctl --user -u infra-vps-deploy-poller` newest line + Dokploy `application.one` deployment `status`/`title` (`Zenod production roll -> …:sha-<short>`). Phylax is never auto-rolled (AGENTS.md boundary).

### 4.2 Existing watchdog — pages into the void

`zenod-watchdog.timer` (host systemd, every 2 min, outside the stack; source `scripts/watchdog/zenod-watchdog.sh`) is still running on VPS1 but is configured for hosts that no longer exist: health URLs `c1.zenod.dev`, `z2.zenod.dev`, a `z-jordi-…` tenant host (all 404 now), notify target `https://c1.zenod.dev` (dead), `ZENOD_WATCHDOG_FALLBACK_URL` empty. In the last 24 h the journal shows **141 `delivery=no` and 0 delivered**: it "alerts" every 30 min and nobody hears it. Its docker/disk/crash-loop checks are sound and worth keeping. Fixing or replacing it is S5's job (§5); it also means any current "no alert" silence is not evidence of health.

### 4.3 Observatory

infra-vps already serves a host-level page (disk, containers, cgroup CPU) on tailnet `:8090` (and `health.alpha9.io` behind a login). It covers VPS1 as a host, not Zenod's product signals. S4 should link to it rather than copy it.

## 5. Alert channel for S5 — recommendation

Facts: Jordi's Phylax tenant has WhatsApp notifications **on, verified, phone set**; Telegram is enabled in Phylax but **no tenant has a Telegram binding** and `telegram/` data was last touched 2026-07-12; no email sender exists (`secret find email|smtp|resend|sendgrid|mailgun|postmark|ntfy` all empty); the old watchdog fallback is unset. Phylax exposes an MCP `notify` tool (`phylaxChannels.ts:2297`) that delivers to the tenant's configured channels; the Console-era `POST /api/notify` (`app.ts:2729`) only exists in the retired standalone app.

**Recommendation: two tiers, same shape as the watchdog's design.**
1. **Primary: WhatsApp to Jordi through Phylax's `notify`** (his tenant). It is the channel he uses and it is already configured and verified. Needs a credential for his Phylax MCP/tenant token: an S5 step (reuse via `secret`, or `request_secret` if `secret find` has none), not needed for S1–S3.
2. **Independent fallback when Phylax itself is red** (the exact case where tier 1 cannot send): a Telegram bot message sent straight from the health service host (needs only outbound HTTPS). The Phylax bot token already exists on the fleet (`secret find telegram` → `TELEGRAM_BOT_TOKEN`, app `phylax`), but Jordi must open the bot once so a chat id exists (what only Jordi can do; S5 raises it as an ask when it is the blocking step, not now).
3. **Email: not recommended** until a sender is provisioned (no provider key on the fleet, no MX).

Repoint rather than rebuild: S5 should repoint `zenod-watchdog.sh` (its two-tier routing, dedupe and 30-min re-alert are already tested in `scripts/watchdog/watchdog-logic.test.sh`) to today's URLs and to tier 1/2, and have the S2 aggregator reuse the same sender for page-red alerts. Silent today = delivery failed, so S5's proof (E6-3) must show an actually received message.

## 6. Constraints for S2/S3 (aggregator and smoke battery)

- **Cheap, safe signals first:** three public endpoints (§3.1, 3.2, 3.4) need no credentials and cover process liveness, deployed sha, WhatsApp transport and worker heartbeat.
- **Activity and error signals live inside SQLite on the VPS1 volumes.** A Dokploy app on the same host can reach them only by mounting `zenod-mt-data`/`phylax-data`, and a read-only mount of a live **WAL** database may not open (SQLite needs a writable `-shm`; not tested here, S2 must test before relying on it). The alternatives are a small bearer-authed, tailnet-only status endpoint inside each app returning counts and timestamps only (no message text), or `docker exec` from a host timer that writes a JSON file the page reads. S2 chooses; this page's recommendation is the endpoint (no volume sharing, no docker socket), with the host timer as the fast fallback.
- **No user data:** every query above needs only `max(ts)`, `count(*)` and status/error codes; never select `body_text`, `transcript_text`, `input_json` or `result_json`.
- **Docker stdout is not a history** (reset on deploy); the page should persist its own last-error record per component.
- **Probe vantage:** the page runs on the tailnet, so it sees Cloudflare-fronted URLs the same as users do; also record the tunnel unit `cloudflared-vps1-sites.service` (active) as the ingress signal for rows 1, 2 and 4.

## 7. Test batteries that exist

| Battery | Command | What it covers | Targets prod? | Use in EPIC-6 |
|---|---|---|---|---|
| Unit/integration (monorepo) | `npm test` = `npm run test --workspaces` + `node --test scripts/*.test.mjs` + `schemas:check` | test files by count: `packages/core` 65, `packages/mcp-chassis` 13, `packages/server` 131, `apps/*` 31, `scripts/*.test.mjs` 9 (plus 12 `.sh`/`.py` script tests not run by `npm test`) | No (fixtures, temp dirs) | Release gate in CI; not a prod probe |
| `packages/server/test/health.test.ts` | `npm test -w @zenod/server -- test/health.test.ts` | 22 in-process API cases (`createApp(runtime)` on a temp dir): `/api/health` returns 200/`ok`/version/sha/eventLoop, `GIT_SHA` override, auth gates, setup/login, notifications, journeys. Despite the name it tests the server API, not a live host. | No | Template for the shape of `/api/health`; shows what the endpoint does *not* check (DB, Stripe, channels) |
| Server health unit tests | `eventLoopHealth.test.ts`, `phylaxUnit.test.ts`, `productionReadiness.test.ts` | event-loop thresholds; Phylax `/api/health` incl. restart rules; production readiness gate (signup/checkout/legal/Drive config and SHA match) | No | Spec for amber/red rules |
| Acceptance | `npm run acceptance:zal17:drive`, `acceptance:zal20:drive`, `acceptance:gdv10` | Managed-Drive journeys (vitest subsets run in CI-style fixtures) and the GDV-10 release gate (clean tree, exact candidate SHA/base SHA); each writes a receipt | No (fixture-driven; `gdv10` needs `GDV10_EXPECTED_SHA`/`GDV10_EXPECTED_BASE_SHA`) | Release evidence only |
| Phylax image contract | `npm run test:phylax-image-contract` | builds/starts disposable Phylax containers and checks the image contract | Local Docker only | CI step |
| Prod execution-lane smoke | `node scripts/exec-smoke.mjs` | live execution round-trip, 3 rounds | **Yes, and it writes** (needs `ZENOD_CONSOLE_URL` + bearer token) | Not read-only: exclude from S3 |
| Data check | `node scripts/verify-zenod-data.mjs [dir]` | walks a data dir, parses JSON and opens SQLite files | On a copy/volume; read-only | Candidate building block for a DB-integrity row |
| Watchdog logic | `scripts/watchdog/watchdog-logic.test.sh` | disk levels, crash-loop delta, alert dedupe | No | Reuse for S5 |
| Deploy script | `scripts/deploy-fleet.test.mjs` | fake-Dokploy test of the roll script | No | n/a |

CI (`.github/workflows/ci.yml`, Node 22): `npm ci`, `npm run build`, Docker build check, `build:phylax`, `test:phylax-image-contract`, `npm test`. The host `vps-a9-1` has Node 18.19 only, so `npm ci`/`npm test` do not run on VPS1 itself (the repo requires Node ≥ 22 and `node:sqlite`; an `npm ci` attempt under 18 in this probe failed installing `@whiskeysockets/baileys`); prod containers run Node 22.23.4. A prod smoke battery (S3) therefore must be plain `curl`/Node-22-container based, not "run `npm test` on the host". There is **no existing read-only prod smoke**; S3 builds the first one.

## 8. Day-one picture the page would show (so nobody is surprised)

| Row | Colour | Why |
|---|---|---|
| Site | green | 200, title ok |
| Cloud app | green | health ok, p99 22 ms; deploy poller up to date (sha rule per §3.2) |
| Database / ledger | amber | files open, ledgers fresh to 2026-10-24; backup proof is 2026-08-30 and no scheduled backup found; one Phylax binding unavailable |
| WhatsApp relay | green (transport), idle ~21 h | connected, worker heartbeat fresh; no traffic since 2026-10-24 06:53 |
| Agent runner | grey | not deployed |
| Alerts | red | watchdog pages into dead hosts: 141 failed deliveries in 24 h |

## 9. Findings to route (none changes EPIC-6's goal)

1. Watchdog delivers nothing (§4.2) → S5 (fix first; also an immediate gap for ZAL, one-line note recorded in the EPIC-6 row).
2. No scheduled Zenod volume backup; restore proof dated 2026-08-30 (§3.3) → ZAL/A0 or a backup ticket; the page will show it.
3. One Zenod↔Phylax binding `unavailable` (§3.2) → ZAL A0 to confirm real vs dormant.
4. Auto-deploy: GitHub `deploy` job red while the VPS1 poller rolls prod (§4.1) → ZAL A0 (already its scope).
5. Phylax meter DB 353 MB despite `USAGE_RETENTION_DAYS=7` and 204k rows written every minute (§3.3) → growth watch; candidate row "volume headroom".
