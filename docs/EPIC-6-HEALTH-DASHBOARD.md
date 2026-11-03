# EPIC-6: health.zenod.dev — one page that shows whether Zenod is up

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/EPIC-6-HEALTH-DASHBOARD.md
Spine ID: HEALTH
Root spine: [EPIC 0 · Foundation Spine — operating behavior and document-centered delivery](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Zenod Alpha Launch — milestone A: Zenod is production-ready](EPIC-ZENOD-ALPHA-LAUNCH.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct (repo `AGENTS.md` Deploy gate applies: gated code paths go via a self-merged PR; this spine and other docs push straight to `main`; root spine D34).

Goal sentence: One page that shows whether Zenod is up.

## Goal

Before testers arrive, anyone can see in one page whether the site, the database, the WhatsApp relay and the agents are alive, and when each last did real work.

## Serves

[Zenod Alpha Launch — milestone A: Zenod is production-ready](EPIC-ZENOD-ALPHA-LAUNCH.md): DOD-1 puts 10 testers on prod; we must see an outage before a tester does, and A0's re-check becomes a page anyone can open instead of a one-off.

## Done means

- [x] E6-1 `health.zenod.dev` serves, on the Tailscale network only (EPIC-6-A1 answered 2026-10-25), one page with a row per component: marketing site (`zenod.dev`), cloud app (`cloud.zenod.dev/api/health`, deployed SHA vs `main`), database (incl. the credits/usage ledger), WhatsApp relay, agent runner + Phylax. Each row shows green/amber/red, when it was checked, when it last did real work (last WhatsApp message in/out, last DB write, last agent run) and the last error from its logs with a timestamp. No secrets or user data on the page. Evidence: live at https://health.zenod.dev behind Jordi's own sign-in (Jordi 2026-11-03 chose public with a password over tailnet-only), tailnet copy http://vps3.taild81fbb.ts.net:8742/; [S1](evidence/epic6-s1-it5-2026-11-03.md), [S2](evidence/epic6-s2-2026-11-03.md).
- [x] E6-2 A read-only prod smoke battery (one `npm run` command) checks the same components, runs every 15 min, and the page shows its last result and time; it exits non-zero on any red. Evidence: `npm run smoke:prod`, 17 checks every 15 min, results on the page ([S3](evidence/epic6-s3-2026-11-03.md), [S4](evidence/epic6-s4-2026-11-03.md)).
- [x] E6-3 Proven red: one component deliberately broken (or simulated) turns its row red within 15 min and an alert reaches Jordi; back to green once fixed. Evidence: [S6](evidence/epic6-s6-2026-11-03.md) — red in 7 min 45 s, alert to the HQ thread, green and one recovery message; alerts [S5](evidence/epic6-s5-2026-11-03.md).
- [ ] E6-4 Jordi opens the page and accepts it.

## Current State

Owner: Delivery manager
Status: review
Last attempted: 2026-11-03 20:45Z S2 worker run_8f6d7ad7 finished (93742e4): cloud row false amber fixed by picking the newest publish by time, redeploy survival recorded, S2 in review ; Jordi closed S1, S3, S5 done
Result: health.zenod.dev shows 12 parts with live status, 7-day timelines, smoke results every 15 min, last errors kept across redeploys, and red reaches Jordi's HQ thread; proven red then green 2026-11-03
Evidence: [S1 iteration 2](evidence/epic6-s1-it2-2026-11-03.md), [S1 card](cards/S1.md), [INVENTORY](health/INVENTORY.md) 8d67cf3
Waiting on: Jordi reviews the S2, S4 and S6 cards and accepts the page (E6-4)
Approved work: none
Next action: Jordi's verdict on S2, S4, S6 and E6-4 ; nothing for agents until then
Source revision: uncommitted scaffold
Verified at: 2026-11-03 20:45Z tailnet page 200 ; probe 10 green, 0 amber, 0 red at 20:38Z ; S2 card fields re-checked against the gate

## Non-Goals

- Per-user analytics or owner screens (ZAL-11…ZAL-16, deferred by ZAL).
- A full observability stack (Prometheus/Grafana/log shipping) unless S1 shows it is the cheapest route.
- Auto-remediation (restarts, redeploys); the page reports, people act.
- Fixing the components themselves: breakages found go to ZAL A0 or their own spine.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Ticket worker | run_7ff4f183 | Inventory: each component, where it runs on today's infra (post infra-vps cleanup), its health signal, the log/table that shows last real activity and last error; what test batteries exist (`npm test`, `acceptance:*`, `packages/server/test/health.test.ts`) | done (approved by Jordi 2026-11-03) | none | `wt/e6-s1-inventory` | `main` | [https://health.zenod.dev](https://health.zenod.dev) (7-day strip per service: hourly worst status plus the key number, backfilled read-only from logs, gaps hatched), [card](cards/S1.md), [evidence](evidence/epic6-s1-it5-2026-11-03.md); tailnet page http://vps3.taild81fbb.ts.net:8742/; fe8b32a | 2026-11-03 | Jordi reviews whether the 7-day strips read at a glance |
| S2 | Ticket worker | run_8f6d7ad7 | Health aggregator: one read-only JSON endpoint/service returning per-component status, last activity, last error (no secrets) | review | S1 | none | `main` | [S2 evidence](evidence/epic6-s2-2026-11-03.md), [card](cards/S2.md), [interface](health/AGGREGATOR.md): one zenod-health document per 5-min probe (status, since, signal, last activity, last error kept across redeploys, recent changes, alert transitions for S5); live on health.zenod.dev; 32 tests; c359aeb, 34f5607; redeploy survival seen live after the 18:44Z roll of 58563d9; false cloud amber (old publish run 779f74c read as newest) fixed, cloud green 20:33Z | 2026-11-03 | Jordi reviews the S2 card. followups: none; confirm: yes — only Jordi can judge whether the page shows what broke and when, kept across redeploys |
| S3 | Ticket worker | run_53e90946 | Prod smoke battery: one `npm run` command, read-only, scheduled every 15 min, result stored for the page (E6-2) | done (approved by Jordi 2026-11-03) | S1 | [#1490](https://github.com/zenod-ai/zenod/pull/1490), [#1492](https://github.com/zenod-ai/zenod/pull/1492) | `main` | [S3 evidence](evidence/epic6-s3-2026-11-03.md), [card](cards/S3.md): `npm run smoke:prod`, 17 read-only checks every 15 min on VPS3, 17/17 pass on prod, simulated failure shown red with a reason; result per part on the page; installed copies match main | 2026-11-03 | Jordi reviews; a failed smoke check turning its row red is S4 |
| S4 | Ticket worker | run_4d8c2774 | health.zenod.dev: already live behind Jordi's own password since S1 (Jordi 2026-11-03 superseded tailnet-only EPIC-6-A1); what remains is to feed it from the S2 aggregator and S3 smoke results (E6-1) | review | S2, S3 (both live) | [#1493](https://github.com/zenod-ai/zenod/pull/1493) | `main` | [S4 evidence](evidence/epic6-s4-2026-11-03.md), [card](cards/S4.md): a failed smoke check turns its row red with the reason, records it on the 7-day strip and alerts once through the S5 sender (recovery only when no caller still sees red); d57c250, live 58563d9 | 2026-11-03 | Jordi reviews whether a red row with its reason reads clearly |
| S5 | Ticket worker | run_e48fbc21 | Alert on red to Jordi (channel picked in S1, e.g. WhatsApp via Phylax or email) | done (approved by Jordi 2026-11-03) | none (repoints the existing watchdog; later also reads S2) | [#1491](https://github.com/zenod-ai/zenod/pull/1491) | `main` | [S5 evidence](evidence/epic6-s5-2026-11-03.md), [card](cards/S5.md), proof page http://vps3.taild81fbb.ts.net:8742/s5/: watchdog repointed at today's parts (user timer on VPS1, every 2 min); red and back-to-green delivered to the HQ alerts thread in under a minute, deduped; page red rows use the same sender; watchdog row green | 2026-11-03 | Jordi reviews; leftover: the old root watchdog unit still logs undelivered alerts (needs root to switch off; harmless, noted for infra-vps) |
| S6 | Tester | run_4d8c2774 | Prove red then green on one component (E6-3); Jordi acceptance (E6-4) | review | S4, S5 | none | prod | [S6 evidence](evidence/epic6-s6-2026-11-03.md), [card](cards/S6.md), proof page http://vps3.taild81fbb.ts.net:8742/s6/: test break 18:22:30, row red 18:30:15, alert 18:31:30, fixed 18:33:46, green 18:45:12, one recovery 18:46:15 UTC; no false recovery; prod untouched | 2026-11-03 | Jordi opens the page and accepts it (E6-4) |

## Outcome

Outcome: one page at health.zenod.dev, behind Jordi's own password, shows whether each of Zenod's 12 parts is up, with a 7-day timeline, last activity and last error, read-only smoke checks every 15 minutes, and any red reaches Jordi in his HQ alerts thread — proven red then green on 2026-11-03.
Risk: if VPS1 itself is down there is no second alert channel (the page shows a stale banner after 15 min); the old root watchdog unit on VPS1 still logs undelivered alerts until someone with root switches it off; the health test suites are not in CI; history for some rows only starts 2026-11-03 (full 7 days by 2026-11-10).

| Done means | Evidence |
|---|---|
| E6-1 page with a row per component | https://health.zenod.dev; [S1 it.5](evidence/epic6-s1-it5-2026-11-03.md), [S2](evidence/epic6-s2-2026-11-03.md) |
| E6-2 smoke battery every 15 min on the page | [S3](evidence/epic6-s3-2026-11-03.md), [S4](evidence/epic6-s4-2026-11-03.md), PRs #1490, #1492, #1493 |
| E6-3 proven red then green with an alert | [S6](evidence/epic6-s6-2026-11-03.md), [S5](evidence/epic6-s5-2026-11-03.md), PR #1491 |
| E6-4 Jordi accepts | Jordi's review of the S6 card |

## Waiting on

- [answered E6-A3 2026-11-03 @Jordi · done 2026-11-03 S4, S6 stamped ready] Finish the health page: let a failed smoke test turn its row red and alert you, then prove it once? — context: the live list, its 7-day timelines, the 15-minute smoke tests and alerts to your HQ thread are all live and in your review list; today a failed smoke test shows on its row but does not yet turn the row red or alert — impact: S4 closes that gap; S6 then breaks one test part on purpose so you see a row go red, get the alert, and see it go green again — risk: low, read-only checks; the S6 test never touches real users; rollback: turn the wiring off — recommend: yes, ready S4 and S6 — why Jordi: only you ready rows — details: https://health.zenod.dev — answer: APPROVED
- [answered E6-A2 2026-11-03 @Jordi · done 2026-11-03 S5, S2, S3 stamped ready] Build the rest of the health page: fix the alarm first, then the aggregator and the smoke tests? — context: you accepted the live list at health.zenod.dev; the next steps are drafts and only you ready them — impact: S5 makes the red alarm reach you (today its warnings go to retired servers, so nobody hears them); S2 and S3 make each row a real check every 15 minutes; S4 and S6 then wire and prove it — risk: low, all read-only checks plus one alert channel; rollback: switch the alert off — recommend: yes, ready S5, S2 and S3 now, S5 first — why Jordi: only you ready rows — details: https://health.zenod.dev — answer: APPROVED
- [answered EPIC-6-A1 2026-10-25 @Jordi · done 2026-10-25 f9e26a3] Should `health.zenod.dev` be public? — answer: no, this is only via tailscale for us, or if it's public like zenod.dev we should then password it separately, but goal now is internal only — acted on: S4 is tailnet-only (no public DNS/exposure); a public page would need its own password and its own ask — unblocks: S4

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-03 | accepted | Jordi approved E6-A3: ready S4 (a failed smoke test turns its row red and alerts) and S6 (red-then-green proof) | rows ready | bd3768a | — |
| 2026-11-03 | accepted | Jordi approved E6-A2: ready S5, S2, S3 (S5 first); decided by Delivery Manager: S5 no longer waits on S2 — it first repoints the existing watchdog | rows ready | a4a0118 | — |
| 2026-11-03 | accepted | Jordi accepted S1 (review: step complete) — the live list at health.zenod.dev behind his own password | S1 done; ask E6-A2 for S2/S3/S5 | cbd6a86 | — |
| 2026-11-03 | accepted | Jordi on the S1 review: "that's awesome, can it be on health.zenod.dev? and be pwd protected, yeah?" — supersedes EPIC-6-A1 (tailnet-only): the page goes on health.zenod.dev behind a password | S1 iteration 2 | ac5c8ee | — |
| 2026-10-24 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |
| 2026-10-25 | accepted | EPIC-6-A1 answered by Jordi: health page is internal-only via Tailscale; if it is ever made public (like zenod.dev) it gets its own password first | exposure of prod state stays inside the tailnet; S4 builds tailnet-only | this row, EPIC-6-A1 | a public page is wanted |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
