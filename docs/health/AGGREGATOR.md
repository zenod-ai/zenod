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
`readiness`, `tester_watch`, `ingress`, `host`.

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
