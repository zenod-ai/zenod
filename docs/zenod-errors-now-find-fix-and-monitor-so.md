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

## Waiting on

- [answered E24-A1 2026-11-10 @Jordi · done 2026-11-10 19c070ec key requested from alpha9, route switch is M9] Run Zenod's background text work (filing, desk jobs, helpers, the quick index) on alpha9's Anthropic startup credit (Claude Haiku), with Zenod's own labelled key on that account, instead of paying DeepSeek? — context: you said on 9 Nov "we can use the Anthropic API ... that should be our default ... we have a ton of credit"; alpha9 now holds 1,000 USD of Anthropic credit until 30 Apr 2027 and offered Zenod a share; today about half of DeepSeek's filing replies fail the format check (M8 is fixing it) — impact: no DeepSeek top-ups for months, and likely steadier filing; speech to text and voice stay on OpenAI; chat answers stay as they are — risk: low; a separate key with a monthly cap, DeepSeek stays as the fallback; rollback: switch the route back in one setting — recommend: yes, after M8 reports, so we compare both on your notes before switching — why Jordi: it widens access to another world's key and spends credit you hold — unblocks: cheaper, steadier background work — details: [alpha9 note](../desk/inbox/2026-11-10-alpha9-anthropic-startup-credit.md) — answer: APPROVED

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
| M7 | Ticket worker | run_43992fdf (monitoring until 2026-11-11T06:00Z: real search timings) | make memory search fast again after new notes are filed: follow-up of M1 | active | M1 | [#1589](https://github.com/zenod-ai/zenod/pull/1589) merged f4dfbf3 live 07:52Z; [#1596](https://github.com/zenod-ai/zenod/pull/1596) merged 1248463 live 2026-11-10T13:43:05Z | main | [evidence](evidence/e24-m7-2026-11-10.md), [page](http://vps3.taild81fbb.ts.net:8921/e24-m7/), [card draft](cards/E24-M7.md): lab on his vault copy, identical results, p50 874 -> 80 ms, Q2 93.8/100/1.6 unchanged; live 13:00Z check: only 2 real searches, both cold (5.6 s first after restart, 2.7 s after 1.5 h idle), so round 2 warms the index after boot (Jordi's tenant warmed in 4.6 s at 13:43:31Z) and logs refresh ms; event loop: no lag warning, 906 ms max in the boot minute only | 2026-11-10T13:50Z | monitoring: real searches on 1248463 (`[memory-search] ... refresh N ms ..., tool N ms`), next check 2026-11-11T06:00Z; then review with followups: start make searches more than a minute apart fast too (read pull in the background, a freshness decision); confirm: yes — only Jordi can say whether search feels fast again |
| M8 | Ticket worker | run_231ce603-4662-4aeb-978d-cb8d74ebde23 | About half of DeepSeek's filing replies fail the reply format filing expects (10 to 13 a run in the live checks); filing retries or fails, error rate 10.7 to 14.3% live vs 3.6% on the stand-in; fix so DeepSeek filing replies pass | done (no confirm: plumbing, filing calls stop failing; nothing new for Jordi to open) | M3 | [#1603](https://github.com/zenod-ai/zenod/pull/1603) merged e1b560e, live 2026-11-10T21:24Z | main | [evidence](evidence/e24-m8-2026-11-10.md): cause add candidates and sources shared one id form; live slice reconcile failures 17/32 before, 0/24 after; ingestion 87.5% and retrieval 90% unchanged; error rate 14.3% both, its filing part 1/28 = stand-in 3.6%, other 3 are cached answers missing facts (answer quality, not filing); spend $0.061, balance $8.63 | 2026-11-10T21:25Z | none; the nightly Q3 live check shows it on production; a `[reconcile] {"dropped"…}` log line counts repaired replies |
| M9 | Ticket worker | unassigned | Background text work (filing, desk jobs, helpers, quick index) on Claude Haiku via Zenod's own capped key on alpha9's Anthropic credit; compared with DeepSeek on his notes first (after M8); DeepSeek kept as fallback | blocked | M8; the key: agent_team E94-S7 (a Mac-agent ticket for Jordi creates it on the Alpha Analytics Anthropic org and stores zenod-mt ANTHROPIC_API_KEY) | none | main | none | 2026-11-10 | starts when the key is stored and M8 reports |
| M10 | Ticket worker | run_5e2f6ab3-5177-4574-9ce6-81609780f90b | A stable production and a separate staging: staging follows main, production moves only on a promote after the standard question set passes on staging (root D28) | review | none | zenod [#1622](https://github.com/zenod-ai/zenod/pull/1622) merged 7f36574; infra-vps 9980f3e | main | [evidence](http://vps3.taild81fbb.ts.net:8921/e24-m10/) ([md](evidence/e24-m10-2026-11-11.md)), [card](cards/M10.md): staging app zenod-staging (tailnet 100.104.206.10:8781, own volume and test tenant, no WhatsApp, Stripe or model keys) follows every publish via the VPS1 poller; production moves only on scripts/promote-production.sh (staging checks + question set at that sha vs floor.json, then deploy-poller --promote, auto rollback; --rollback undoes). Proof: staging bfef1a0 03:14Z while prod stayed 3831b06; staging 7f36574 03:50:56Z; gate demo 96/100/1.7, real notes 94.1/98.2/3.1; prod 3831b06 → 7f36574 at 04:04:13Z (health ok, 24 s), carrying E25-S1, U7, M10. Only the Delivery Manager promotes (DEPLOYMENTS.md). $0 model spend | 2026-11-11 | followups: park promote on a schedule — by hand until promotes are routine; confirm: yes — only Jordi can say whether this is the stable production he asked for |
| M11 | Ticket worker | unassigned | The promote gate failed on Jordi's newest notes: on vault a7774a6 the same build d9ebdd6 scored ingestion 41.2, retrieval 82.1, errors 17.2 (9 agent failures) against 94.1, 98.2, 3.1 on vault 6a5a370 an hour earlier; find whether a new note breaks filing on production or the test copy is broken, fix it, rerun the gate | ready | none | none | main | none | 2026-11-11 | dispatch |

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
| 2026-11-10 | accepted | decided by Delivery Manager: M8 opened ready from EPIC-15 Q3's first live checks (desk note 34ab35af): half of DeepSeek's filing replies fail the format check in production; a defect, allowed under the engine freeze | rollback per PR | Q3 evidence, #1600 | when M8 reports |
| 2026-11-10 | accepted | Jordi APPROVED E24-A1: Zenod's background text work on alpha9's Anthropic startup credit (Claude Haiku), own labelled key with a monthly cap | M9 opened; alpha9 asked to create the key and store it for zenod-mt; DeepSeek stays as fallback | his answer 19c070ec | when M9 reports |
| 2026-11-11 | accepted | Jordi, voice note 2026-11-11 02:05Z (Log/2026-11-11.md#^e-a1ef31, vn_f4ab8ad2): "could we also have like a staging environment and a production environment, and then we can have a stable production where things are kind of working in a state where we feel like, OK, we're gonna stop here, and then we can keep on the crazy development on another one" (root L-37); starts root D28 (planned 2026-10-10: split staging and prod) | M10 ready | his note | M10 result |
| 2026-11-11 | decided | decided by Delivery Manager: M11 opened as a fix for breakage (tier do): the second promote (04:34Z) stopped at the question set on Jordi's newest notes, so production stays on d9ebdd6; protects Jordi's ask for a stable production (02:05Z note, M10) — why: the drop may mean a new note breaks filing for him — rollback: close M11 if it is only the test copy | M11 ready | promote log, private run a7774a6 | M11 result |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
