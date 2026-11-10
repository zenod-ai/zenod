# Zenod health aggregator (EPIC-6 S2)

One JSON document per probe run, written every 5 min by `s1-live/probe.py` on VPS3 (systemd --user
`epic6-s1-health-probe.timer`) and served as `probe.json` next to the page:

- behind the sign-in: https://health.zenod.dev/probe.json (gate `s1-live/gate.py`, Dokploy app `zenod-health`)
- tailnet, no password: http://vps3.taild81fbb.ts.net:8742/probe.json
- on VPS1 as a file: `~t3agent/.local/share/zenod-health/www/probe.json` (rsynced each run)

Code: `s1-live/aggregate.py` (stdlib only, pure); status rules tested in `s1-live/test_aggregate.py`
(`python3 docs/health/s1-live/test_aggregate.py`). The page (`index.html`) is rendered from the document.
Evidence: [epic6-s2-2026-11-03.md](../evidence/epic6-s2-2026-11-03.md); review card: [S2](../cards/S2.md).

S3 seam: the smoke battery writes `~/.local/share/zenod-health/smoke/latest.json` (`zenod-smoke/v1`, keyed by
the component ids below) and S3 adds its cells to `page()` through `s1-live/smoke_view.py`.

## S4: a failed smoke check turns its row red

`probe.py` puts the latest smoke result into the raw probe (`raw.smoke`, `aggregate.smoke_summary()`), and
`aggregate.merge_smoke()` folds it into each row before transitions are computed. Probe status × smoke result:

| Probe | Smoke for this row | Row |
|---|---|---|
| grey | anything | grey (not deployed, never alerted) |
| any | no result, no check for this row, or result older than 45 min | probe status |
| any | all checks pass | probe status |
| green, amber or red | a check fails | **red**, `problem` = the probe's problem (if any) then `smoke check failed: <title>: <reason>`; a test run adds `[test run: check pointed at a test target]` |

So the smoke reason shows under the row's status, in its last error (source `smoke: red`), in the transition and in
the alert text; the 7-day strip records the red sample like any other. Each component also carries `probe_status`
and `smoke` (`at`, `ok`, `pass`, `fail`, `stale`, `simulated`, `reason`). Tests: `SmokeMerge` and
`SmokeThroughAggregate` in `test_aggregate.py`.

Alerts: a smoke red uses the same S5 sender and row key (`row-<n>`) as a probe red, so one outage seen by the probe,
the smoke battery and the VPS1 watchdog alerts once. The sender keeps which callers see a key red and sends the one
RECOVERED only when none does (a caller silent for 30 min no longer counts), so the watchdog's own green check does
not recover a row the page still has red from a smoke check (`scripts/watchdog/zenod-alert.sh`, tests in
`watchdog-logic.test.sh`).

## ZAL-A8: stalls turn a row red

From 2026-11-04 09:46Z to 11-06 07:15Z no save finished and no WhatsApp message got its "Saved" reply, while the
page showed only amber and nobody was alerted. Two rules (`STALL_MIN` = 60 min, tests in `test_aggregate.py`) now
turn a row red, which goes to Jordi's HQ thread through the S5 sender like any red:

- **row 4 Phylax:** a WhatsApp message (Phylax `markRead` log line) has had no "Saved" reply after it
  (tester-watch `last_saved_reply`) for over an hour (`aggregate.reply_stall`). A message that legitimately gets
  no "Saved" reply (an unbound sender, a cap notice) also counts until the next "Saved" reply.
- **row 3 database:** a save failed (`[task-job] <id> failed (store|media_ingest|enrich_memory)`, or an older
  line refused with `filing_recovery_pending`) and no save has finished since, for over an hour
  (`probe.py` `capturesFailingSince`, `aggregate.saves_failing`).

Both read the container logs since the container started, so a redeploy starts them fresh.

## EPIC-24 M2: alert rows 13 to 18, what a person would notice

Jordi, 2026-11-10: "I need to have some monitoring on Zenod because right now I think I am getting some errors."
Six rows turn red within one probe run (5 min) of a failure a person would notice, so the S5 sender puts it in the
HQ alert thread well inside 15 minutes, and each clears by itself once `ALERT_MIN` (15 min) pass without another:

| Row | Red while, in the last 15 min | Source |
|---|---|---|
| 13 failed or stuck saves | a save job failed, or a save (store, media_ingest) still waits 15 min after it arrived | `[task-job] … failed (store\|media_ingest\|enrich_memory)`, `[ops-alert] save stuck` (checked every 5 min per tenant) |
| 14 WhatsApp messages with no reply | a message has had no “Saved” reply and no chat answer for 15 min (the ZAL-A8 rule at 15 min, row 4 keeps 60) | Phylax log, tester-watch, chat replies |
| 15 chat and ask_brain answers that fail | a WhatsApp or app chat answer failed, or MCP ask_brain errored or timed out | `[task-job] … failed (chat)`, `[chat] stream failed`, `[ops-alert] answer` |
| 16 failed sign-ins | a Google or GitHub sign-in came back and failed (expired, other browser, signup closed, provider error) | `[ops-alert] signin` |
| 17 app errors | a 5xx on cloud.zenod.dev or zenod.dev, or the app reported a script error, an unhandled rejection or a failed API call | Traefik access log, `[ops-alert] app` from `POST /api/public/client-error` |
| 18 helper runs that fail | a helper run failed, could not save its notes, or could not start | `[ops-alert] helper` |

`[ops-alert] <kind> <reason> key=value…` lines come from `packages/server/src/opsAlert.ts`: fixed words, counts,
minutes, error class names and route templates only (no message text, emails, ids or tokens). The probe keeps 24 h
of these events in its VPS1 cache (`raw.vps1.zenod_log.ops`, `[time, kind, reason]`), so a redeploy does not lose them.

**Drill (a staged fault, nobody's account touched):** `python3 probe.py --drill save|reply|answer|signin|app|helper`
appends one line to `~/.local/state/zenod-health-remote/drill.jsonl` on VPS1; the next run reads it like a log line
with reason `drill_staged`, the row turns red with `[drill: staged fault]`, the HQ thread gets one alert, and the row
clears and sends one RECOVERED 15 min later. Tests: `AlertRows` in `test_aggregate.py`, `Folds` in `test_probe.py`,
`packages/server/test/opsAlerts.test.ts`, `apps/web/src/lib/client-errors.test.ts`.

## Document (`schema: zenod-health/v1`)

| Field | Meaning |
|---|---|
| `checked_at` | when this run probed |
| `summary` | count per status: `green`, `amber`, `red`, `grey` (grey = not deployed, never alerted) |
| `components[]` | `id`, `name`, `where`, `status`, `status_since`, `signal` (text), `signal_value` (numbers), `checked_at`, `last_activity {at, what, from_history}`, `last_error {at, first_seen, what, source}`, `errors[]` (last 10 distinct, newest first), `error_now`, `problem`, `source`, `tests` |
| `transitions[]` | the last 50 status changes, oldest first: `component`, `name`, `from`, `to`, `at`, `reason`, `alert` |
| `history_since` | when the persisted history began |
| `raw` | the raw probe values the rules read (counts, states, timestamps) |

Component ids: `site`, `cloud`, `database`, `phylax`, `agent_runner`, `memory_index`, `deploy`, `watchdog`,
`readiness`, `tester_watch`, `ingress`, `host`, and the EPIC-24 M2 alert rows `alert_saves`, `alert_replies`,
`alert_answers`, `alert_signins`, `alert_app`, `alert_helpers`.

**Last errors survive redeploys.** Docker stdout resets when a container is redeployed, so `last_error`,
`errors` and `last_activity` come from a history file on VPS3 (`~/.local/state/zenod-health/history.json`,
0600) that each run folds the new source events into. A source event is a timestamped log error line, 5xx,
or WhatsApp drop; a red or amber status is also recorded as an error from `probe: <status>` at the check
time. When the same error repeats, `at` moves forward and `first_seen` keeps the start.

## Interface for S5 (alert sender)

A transition has `alert: true` when it goes to red or comes back from red. S5 keeps its own cursor (the `at`
of the last transition it sent) and reads either form:

```sh
python3 aggregate.py transitions --doc ~/.local/share/zenod-health/www/probe.json --after "$CURSOR" --alert-only
# one JSON line per transition, oldest first; empty output = nothing new
python3 aggregate.py status --doc probe.json        # one line per component, for humans
```

```python
import aggregate
doc = aggregate.load_doc(path_or_url)
for t in aggregate.transitions_after(doc, cursor, alert_only=True): send(t)
```

The document keeps 50 transitions and is rewritten every 5 min, so a sender checking every 2 to 30 min
misses nothing. `--doc` also takes a URL (tailnet URL needs no password). Everything is read-only against
production: the aggregator adds no new access, it reuses the S1 probe's sources (INVENTORY.md §6).

## 7-day timeline (EPIC-6 S1 iteration 5)

`s1-live/timeline.py` keeps two compact stores next to the history file: `samples.json` (status per probe run, 5-min
for 24 h, worst-per-hour for 8 days, written by `probe.py` through `timeline.record(doc)`) and `hours.json` (one key
number and, where a log states it, a rebuilt status per component and UTC hour, written by `timeline.py collect`,
user timer `epic6-s1-timeline.timer` every 15 min). `page()` renders one strip per row with `timeline.cell()`; keep
that call when restructuring the page. Sources and backfill: [epic6-s1-it5-2026-11-03.md](../evidence/epic6-s1-it5-2026-11-03.md).
