# EPIC-24: Zenod errors now: find, fix, and monitor so we hear first

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-errors-now-find-fix-and-monitor-so.md
Spine ID: zenod-errors-now-find-fix-and-monitor-so-we-hear-first
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Jordi is getting errors on Zenod now: find and fix them today; then monitoring that alerts the team before he notices (failed saves, replies, answers, sign-ins), in the launch board.

Goal sentence: The errors Jordi is hitting are fixed today, and the team hears of any new error before he does.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): testers start today, so Zenod has to work and the team has to hear about errors first.

## Done means

- [ ] E24-1 Every error Jordi hit on 9 to 10 Nov (WhatsApp replies, chat answers, sign-ins, saves, the new app) is found in the logs, fixed live and proven, listed on one page
- [x] E24-2 Monitoring on production alerts the team within 15 minutes of a failed save, a missed reply, a failed answer, a failed sign-in or an app error, before he notices, shown on the launch board
- [ ] E24-3 A week with no error he finds first

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-10 stamped ready on Jordi's ask and planned; M1 and M2 dispatched
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: M1 finds and fixes today's errors; M2 builds the alerts
Source revision: uncommitted scaffold
Verified at: 2026-11-10

## Non-Goals

- New features; only errors and the alerts for them.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Ticket worker | run_eb8ab45a-7ccd-45bf-b610-b0cd0cf1a502 — claimed 2026-11-10T02:37Z, lease until 2026-11-10T04:37Z | E24-1: find and fix today every error Jordi is hitting (logs of the last 24 h: WhatsApp, chat, sign-in, saves, app), one page | done (approved by Jordi 2026-11-10) | none | [#1579](https://github.com/zenod-ai/zenod/pull/1579) merged d94ef24 | main | [errors page](http://vps3.taild81fbb.ts.net:8921/e24-m1/), [evidence](evidence/e24-m1-2026-11-10.md), [card](cards/E24-M1.md): 7 error kinds in 24 h; DeepSeek filing failed about half its calls (thinking hit the 8192 cap, reconcile reason over 240) and fell back; #1579 live d94ef24 03:56:48Z then exposed an out-of-memory crash loop (3 restarts 04:00-04:07Z) on one DeepSeek classification; stopped by `ZENOD_BACKGROUND_ROUTE=filing=openrouter` on zenod-mt 04:07:03Z, note filed 04:10Z, up since; release 502s (13 req) and slow search (1-4.5 s) open; WhatsApp, saves, sign-ins clean | 2026-11-10T04:12Z | followups: started M5, M6, M7 |
| M2 | Ticket worker | run_7ea46bf8-ba5d-48db-a2d8-300133163fcd | E24-2: alerts within 15 minutes for failed saves, missed replies, failed answers, failed sign-ins and app errors, on the launch board | done (approved by Jordi 2026-11-10) | none | [#1580](https://github.com/zenod-ai/zenod/pull/1580) merged 317a333, live 2026-11-10T03:35:01Z | main | [evidence](evidence/e24-m2-2026-11-10.md), [card](cards/E24-M2.md): rows 13-18 drilled and real faults alerted once, cleared | 2026-11-10 | followups: none (E24-3 is the epic's own week-long watch); confirm: yes — Jordi judges whether the six alarms cover what he wants to hear first |
| M3 | Ticket worker | run_fa9393bf (round 2, monitoring until 2026-11-10T13:00Z: DeepSeek filing on production) | E24-1 follow-up: one DeepSeek filing answer made Zenod run out of memory (3 restarts 04:00-04:07Z); find why, fix, and move filing back to DeepSeek (now on OpenRouter as a stopgap, ZENOD_BACKGROUND_ROUTE=filing=openrouter) | active | M1 | [#1584](https://github.com/zenod-ai/zenod/pull/1584) 1f1ebae; [#1588](https://github.com/zenod-ai/zenod/pull/1588) 943e30d (filing jobs survive a restart, sweep); [#1592](https://github.com/zenod-ai/zenod/pull/1592) cfd0fc3 (leak), live in 3952447 2026-11-10T08:34Z | main | [evidence](evidence/e24-m3-2026-11-10.md): 50 unfiled notes now 0, none filed twice; crash = search cache pinned whole file text (+8-14 MB per filing, any model), fixed; filing back on DeepSeek 08:36Z, no restart to 09:04Z but no filings yet | 2026-11-10T13:05Z | monitoring: 13:00Z recheck clean (no restart, 0 of 128 unfiled, none twice, memory flat 137 MiB) but no DeepSeek filing happened to judge by; next check 19:00Z, then close done (no confirm: plumbing); if any restart, put back ZENOD_BACKGROUND_ROUTE=filing=openrouter |
| M4 | Ticket worker | unassigned | E24-1 follow-up: a few seconds of failed requests on each release (13 across 3 releases), and memory search taking 1 to 4.5 s while holding other requests | done (no confirm: split into M6 and M7, started by Jordi) | M1 | none | main | none | 2026-11-10 | covered by M6 and M7 |
| M5 | Ticket worker | unassigned | find why one filing answer used all of Zenod's memory, then move filing back to the cheaper model: follow-up of M1 | done (no confirm: same work as M3 round 2, run_fa9393bf, which builds it) | M1 | none | main | Jordi started it when closing M1 2026-11-10 | 2026-11-10 | covered by M3 |
| M6 | Ticket worker | run_ebd55a5d-4f20-45d1-b361-e5d4a17526ef — claimed 2026-11-10T07:18Z, lease until 2026-11-10T09:18Z | make releases seamless so a new version never answers with an error: follow-up of M1 | done (no confirm: deploy plumbing, proven by the request loop) | M1 | [#1587](https://github.com/zenod-ai/zenod/pull/1587) ceb7959, [#1590](https://github.com/zenod-ai/zenod/pull/1590) cb72902, [#1591](https://github.com/zenod-ai/zenod/pull/1591) 50af8a1, live 08:12:09Z | main | [evidence](evidence/e24-m6-2026-11-10.md): start-first behind a healthcheck, 60 s drain; 5 real releases, 0 failed at a swap in 15,391 requests (3 POST 502 near 943e30d from a keep-alive race, fixed by #1591); no alert at any release | 2026-11-10T08:30Z | followups: none; also: out-of-heap crash again at 08:07:37Z on f4dfbf3 (after the 640 MiB raise), 155 failed requests, alert row 17 → M3 |
| M7 | Ticket worker | unassigned (lease of run_43992fdf-21b1-477d-a87d-46e5af576910 expired 2026-11-10T15:05Z: re-dispatch) | make memory search fast again after new notes are filed: follow-up of M1 | ready | M1 | [#1589](https://github.com/zenod-ai/zenod/pull/1589) merged f4dfbf3 live 07:52Z; [#1596](https://github.com/zenod-ai/zenod/pull/1596) merged 1248463 live 2026-11-10T13:43:05Z | main | [evidence](evidence/e24-m7-2026-11-10.md), [page](http://vps3.taild81fbb.ts.net:8921/e24-m7/), [card draft](cards/E24-M7.md): lab on his vault copy, identical results, p50 874 -> 80 ms, Q2 93.8/100/1.6 unchanged; live 13:00Z check: only 2 real searches, both cold (5.6 s first after restart, 2.7 s after 1.5 h idle), so round 2 warms the index after boot (Jordi's tenant warmed in 4.6 s at 13:43:31Z) and logs refresh ms; event loop: no lag warning, 906 ms max in the boot minute only | 2026-11-10T13:50Z | monitoring: real searches on 1248463 (`[memory-search] ... refresh N ms ..., tool N ms`), next check 2026-11-11T06:00Z; then review with followups: start make searches more than a minute apart fast too (read pull in the background, a freshness decision); confirm: yes — only Jordi can say whether search feels fast again |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | Ready on Jordi's own ask (L-37), Chat voice note 2026-11-10 02:30Z vn_8f8279fe: "I need to have some monitoring on Zenod because right now I think I am getting some errors. So what the fuck, man?"; urgent | M1 fixes today's errors, M2 the alerts, side by side | his voice note | when M1 reports |
| 2026-11-10 | accepted | M2: alerts are health-page rows 13-18 fed by count-only `[ops-alert]` server lines, red for 15 min after a failure, through the existing S5 sender to the HQ thread | builds on the probe, no new service or key; a drill (`probe.py --drill`) proves each row without touching an account | [e24-m2-2026-11-10](evidence/e24-m2-2026-11-10.md) | if a row alerts too often in tester week |
| 2026-11-10 | accepted | decided by Delivery Manager: M3 opened ready from M1's findings (tier do: a crash and a stopgap that spends OpenRouter credit production depends on); M4 draft | rollback per PR | M1 evidence 310335c9 | when M3 reports |
| 2026-11-10 | accepted | decided by M3 worker (tier do: reversible, inside the goal): zenod-mt memory 320 to 640 MiB at 07:36:53Z | filing ran out of heap at 07:22:53Z on OpenRouter too, after 10 back-to-back filings; memory climbs to about 230 MiB within a few filings against a heap of about 256 MB, so the crash is not DeepSeek-only; VPS1 had 3.2 GB free | [e24-m3](evidence/e24-m3-2026-11-10.md) | if VPS1 runs short of memory, or once the per-filing peak is found and cut |
| 2026-11-10 | accepted | decided by M6 worker (tier do: reversible deploy plumbing inside the goal): zenod-mt rolls Swarm start-first behind a healthcheck with automatic rollback, 60 s stop grace (`ZENOD_STOP_GRACE_MS=60000`) | two tasks share /data safely (vault write lock, leased jobs, SQLite WAL); undo = null the four Dokploy swarm fields | [e24-m6-2026-11-10](evidence/e24-m6-2026-11-10.md) | if a storage change is not additive (use the manual quiesce path) |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
