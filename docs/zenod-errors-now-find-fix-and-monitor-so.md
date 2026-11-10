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
| M3 | Ticket worker | run_fa9393bf-b3d4-4679-82a1-6d912b074216 — claimed 2026-11-10T05:54Z, lease until 2026-11-10T07:54Z | E24-1 follow-up: one DeepSeek filing answer made Zenod run out of memory (3 restarts 04:00-04:07Z); find why, fix, and move filing back to DeepSeek (now on OpenRouter as a stopgap, ZENOD_BACKGROUND_ROUTE=filing=openrouter) | active | M1 | [#1584](https://github.com/zenod-ai/zenod/pull/1584) merged 1f1ebae, live 05:23:03Z (bounds whole-vault searches; real risk, not this crash) | main | [evidence](evidence/e24-m3-2026-11-10.md): back on DeepSeek 05:23:17Z, OOM again 05:42:51Z 3 s after a first-pass classify, stopgap `filing=openrouter` restored 05:43:57Z; cause still open (vault is 11.5 MB, so not search); separate: 48 of today's 01:04-01:10Z captures never filed, jobs ended by 02:05Z, not crash-related, end state only in the tenant job DB | 2026-11-10T06:10Z | round 2: heap snapshot near the limit on a copy running DeepSeek filing on a vault copy; find the 48 jobs' end state and re-file them once (needs a read path to the tenant job DB) |
| M4 | Ticket worker | unassigned | E24-1 follow-up: a few seconds of failed requests on each release (13 across 3 releases), and memory search taking 1 to 4.5 s while holding other requests | done (no confirm: split into M6 and M7, started by Jordi) | M1 | none | main | none | 2026-11-10 | covered by M6 and M7 |
| M5 | Ticket worker | unassigned | find why one filing answer used all of Zenod's memory, then move filing back to the cheaper model: follow-up of M1 | done (no confirm: same work as M3 round 2, run_fa9393bf, which builds it) | M1 | none | main | Jordi started it when closing M1 2026-11-10 | 2026-11-10 | covered by M3 |
| M6 | Ticket worker | run_ebd55a5d-4f20-45d1-b361-e5d4a17526ef — claimed 2026-11-10T06:00Z, lease until 2026-11-10T08:00Z | make releases seamless so a new version never answers with an error: follow-up of M1 | active | M1 | none | main | Jordi started it when closing M1 2026-11-10 | 2026-11-10 | dispatched 2026-11-10 |
| M7 | Ticket worker | run_43992fdf-21b1-477d-a87d-46e5af576910 — claimed 2026-11-10T06:00Z, lease until 2026-11-10T08:00Z | make memory search fast again after new notes are filed: follow-up of M1 | active | M1 | none | main | Jordi started it when closing M1 2026-11-10 | 2026-11-10 | dispatched 2026-11-10 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | Ready on Jordi's own ask (L-37), Chat voice note 2026-11-10 02:30Z vn_8f8279fe: "I need to have some monitoring on Zenod because right now I think I am getting some errors. So what the fuck, man?"; urgent | M1 fixes today's errors, M2 the alerts, side by side | his voice note | when M1 reports |
| 2026-11-10 | accepted | M2: alerts are health-page rows 13-18 fed by count-only `[ops-alert]` server lines, red for 15 min after a failure, through the existing S5 sender to the HQ thread | builds on the probe, no new service or key; a drill (`probe.py --drill`) proves each row without touching an account | [e24-m2-2026-11-10](evidence/e24-m2-2026-11-10.md) | if a row alerts too often in tester week |
| 2026-11-10 | accepted | decided by Delivery Manager: M3 opened ready from M1's findings (tier do: a crash and a stopgap that spends OpenRouter credit production depends on); M4 draft | rollback per PR | M1 evidence 310335c9 | when M3 reports |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
