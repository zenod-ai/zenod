# EPIC-6 S3: prod smoke battery

Parent: [EPIC-6 health dashboard](../EPIC-6-HEALTH-DASHBOARD.md) (ledger row S3, Done means E6-2). Inputs: [INVENTORY](INVENTORY.md) §6–§7.
Evidence: [epic6-s3-2026-11-03](../evidence/epic6-s3-2026-11-03.md) · review card [S3](../cards/S3.md).

```
npm run smoke:prod                                   # all checks, a table, exit 1 on any fail
npm run smoke:prod -- --json                         # the result JSON instead
npm run smoke:prod -- --out ~/.local/share/zenod-health/smoke   # also store latest.json + runs/<stamp>.json (last 96)
npm run smoke:prod -- --override site.home=https://bogus.invalid/   # test run: point one http check elsewhere
npm run smoke:prod -- --only phylax,readiness.proofs # a subset, by component or check id
```

Source `scripts/smoke-prod.mjs` (Node 18+, no dependencies), tests `scripts/smoke-prod.test.mjs` (run by `npm test`).

## Read-only by construction

Public `GET`s only, no credentials, no `POST`: the MCP check proves the endpoint *refuses* an unauthenticated
request. On VPS1 only what t3agent's narrow sudo already allows: `journalctl`, `systemctl is-active`,
`tester-watch --check --redact --no-stripe`, `df`. No login, no chat message, no vault write (root L-6); no
Dokploy, no env (root L-5). `scripts/exec-smoke.mjs` writes to prod and stays out (INVENTORY §7).

## Checks (17) and the page row each feeds

| Check | Component | Pass when |
|---|---|---|
| site.home | site | `zenod.dev/` 200, title has Zenod |
| site.connect | site | `zenod.dev/connect` 200, title has Connect |
| cloud.health | cloud | `/api/health` 200, status ok (sha, p99 reported) |
| cloud.deployed-sha | cloud | staging sha = newest successful `publish.yml` run on main (30 min grace for a roll; root D28: production moves only on a promote) |
| cloud.promote-lag | cloud | production = staging, or the hourly promote tick (`~/zenod-eval/promote-schedule.jsonl`, EPIC-24 M12) is waiting as designed; red when the tick is silent > 90 min, its last run failed (gate-failed, promote-failed, error), or 3 daytime ticks saw this staging sha without promoting it (EPIC-24 M22) |
| cloud.vault-recovery | cloud | production's running `zenod-mt` container log (24 h, read-only `docker logs`, same narrow sudo forms as M24) has no `[vault-recovery] UNRESOLVED` without a later `recovered`/`vault clean` for that tenant, and no `[quick-index] update failed` streak of 30 min or more still failing in the last 12 min (EPIC-24 M25; lines carry ` tenant=<id>` from the build after `98bec770`); the two July test tenants `jordiepic32test-5oqq39` and `jordiepic32clean-ml7rz0` are excluded, named in the detail ("2 test tenants excluded until E24-A4") and never red, until ask E24-A4 removes them (`VAULT_EXCLUDED_TENANTS`); any other tenant still goes red |
| mcp.unauthorized | cloud | `cloud.zenod.dev/mcp` 401 with `WWW-Authenticate … resource_metadata=` |
| mcp.resource-metadata | cloud | `/.well-known/oauth-protected-resource` names `…/mcp` and an auth server |
| mcp.auth-metadata | cloud | `/.well-known/oauth-authorization-server` has issuer, authorize and token endpoints |
| cloud.readiness | readiness | `/api/public/production-readiness` 200, `ready: true` |
| readiness.proofs | readiness | `zenod-readiness-watch` ran in the last 2 h, `ready=True`, no proof expired |
| phylax.health | phylax | `phylax.zenod.dev/api/health` ok, no restart required, worker heartbeat < 120 s |
| phylax.whatsapp | phylax | WhatsApp `connected`, receive path `ready` |
| testers.check | tester_watch | `tester-watch --check` exit 0, `OK …` |
| deploy.poller | deploy | `infra-vps-deploy-poller` logged a zenod-staging or zenod-mt run in 10 min, no error (since root D28 it polls zenod-staging every 5 min; zenod-mt lines appear only on a promote) |
| watchdog.timer | watchdog | S5 user timer `zenod-health-watchdog` (or the old root `zenod-watchdog`) active; delivery is S5's proof |
| ingress.tunnel | ingress | `cloudflared-vps1-sites.service` active |
| host.disk | host | VPS1 root disk < 85 % |
| host.observatory | host | tailnet `:8090` 200 |

Not covered: the memory search index has no exposed health signal (only container log lines, which the page's
probe already reads); database and agent runner likewise come from the probe, not the smoke battery.

## Result shape (`zenod-smoke/v1`)

```jsonc
{"schema": "zenod-smoke/v1", "battery": "prod", "host": "vps3",
 "startedAt": "…Z", "finishedAt": "…Z", "durationMs": 6059, "ok": true, "simulated": false,
 "overrides": {"site.home": "https://bogus.invalid/"},          // only on test runs
 "summary": {"pass": 17, "fail": 0, "total": 17},
 "components": {"site": {"name": "Marketing site zenod.dev", "ok": true, "pass": 2, "fail": 0,
                         "checks": ["site.home", "site.connect"], "reason": "first failing check, only when not ok"}},
 "checks": [{"id": "site.home", "component": "site", "title": "Home page answers", "ok": true,
             "status": "pass", "reason": "200, title “Zenod — …”", "ms": 238, "at": "…Z"}]}
```

Component keys are the S2 aggregate's component ids, so the aggregator and the page join on `id`.

## Schedule and storage (VPS3)

User timer `zenod-smoke-prod.timer` (`OnCalendar=*:0/15`), units in [s3-smoke/units/](s3-smoke/units/). The service
runs the installed copy `~/.local/lib/zenod-smoke/smoke-prod.mjs` (re-copy it and `s1-live/*.py` from `main` after every change, with the Install lines below: EPIC-24 M22 found the 3 and 10 Nov copies still running on 19 Nov, so M10's staging rules never went live and two checks raised false alarms), stores into
`~/.local/share/zenod-health/smoke/` (`latest.json`, `runs/` last 96 = 24 h), treats exit 1 as a result rather than a
unit failure, and then starts `epic6-s1-health-probe.service`, so the page shows a new result within a minute.
The page code [s1-live/smoke_view.py](s1-live/smoke_view.py) renders a banner (last run, pass count, the last 16 runs
as dots, test runs ringed) and per-row pass/FAIL lines with reason and timing; the probe copies `latest.json` to the
page as `smoke.json`.

Since S4 a failed check also turns its row red and alerts through the S5 sender (rule table in
[AGGREGATOR.md](AGGREGATOR.md#s4-a-failed-smoke-check-turns-its-row-red)).

Drill (S6): `echo 'SMOKE_DRILL="--override site.home=https://drill.invalid/"' > ~/.config/zenod-health/smoke-drill.env`
makes the next scheduled run a labelled test run with one failing check; `rm` the file and the run after that is the
real battery again. Nothing in production changes.

Install (VPS3, as t3agent):

```
mkdir -p ~/.local/lib/zenod-smoke && cp scripts/smoke-prod.mjs ~/.local/lib/zenod-smoke/
cp docs/health/s1-live/*.py ~/.local/lib/epic6-s1-health/   # probe, aggregate, timeline, smoke_view: always all of them
cp docs/health/s3-smoke/units/* ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now zenod-smoke-prod.timer
```
