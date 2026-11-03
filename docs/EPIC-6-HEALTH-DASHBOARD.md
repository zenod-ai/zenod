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

- [ ] E6-1 `health.zenod.dev` serves, on the Tailscale network only (EPIC-6-A1 answered 2026-10-25), one page with a row per component: marketing site (`zenod.dev`), cloud app (`cloud.zenod.dev/api/health`, deployed SHA vs `main`), database (incl. the credits/usage ledger), WhatsApp relay, agent runner + Phylax. Each row shows green/amber/red, when it was checked, when it last did real work (last WhatsApp message in/out, last DB write, last agent run) and the last error from its logs with a timestamp. No secrets or user data on the page.
- [ ] E6-2 A read-only prod smoke battery (one `npm run` command) checks the same components, runs every 15 min, and the page shows its last result and time; it exits non-zero on any red.
- [ ] E6-3 Proven red: one component deliberately broken (or simulated) turns its row red within 15 min and an alert reaches Jordi; back to green once fixed.
- [ ] E6-4 Jordi opens the page and accepts it.

## Current State

Owner: Delivery manager
Status: active
Last attempted: 2026-11-03 wake run_91a8edfe: E6-A2 approved; dispatched S5 (run_e48fbc21), S2 (run_e1f220d2), S3 (run_53e90946); before: 2026-11-03 roll-up from the ledger — S1 (review): the inventory of Zenod's 12 parts is a live page at https://health.zenod.dev behind a sign-in (tailnet copy http://vps3.taild81fbb.ts.net:8742/), refr
Result: Jordi can already see whether Zenod is up at health.zenod.dev: 10 parts green, the agent runner grey (not deployed), and the host watchdog red because its alerts still go to retired servers (S5 fixes that)
Evidence: [S1 iteration 2](evidence/epic6-s1-it2-2026-11-03.md), [S1 card](cards/S1.md), [INVENTORY](health/INVENTORY.md) 8d67cf3
Waiting on: nobody (E6-A2 approved)
Approved work: none
Next action: on E6-A2, S5 first (the watchdog's alerts reach nobody), then S2 aggregator and S3 smoke battery, then S4 wiring and S6 red-then-green proof
Source revision: uncommitted scaffold
Verified at: 2026-11-03 (health.zenod.dev answers 401 without sign-in; tailnet page 200 with fresh probes; ledger read)

## Non-Goals

- Per-user analytics or owner screens (ZAL-11…ZAL-16, deferred by ZAL).
- A full observability stack (Prometheus/Grafana/log shipping) unless S1 shows it is the cheapest route.
- Auto-remediation (restarts, redeploys); the page reports, people act.
- Fixing the components themselves: breakages found go to ZAL A0 or their own spine.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Ticket worker | run_7205d65a | Inventory: each component, where it runs on today's infra (post infra-vps cleanup), its health signal, the log/table that shows last real activity and last error; what test batteries exist (`npm test`, `acceptance:*`, `packages/server/test/health.test.ts`) | active (iteration 2, relaunched by Jordi 2026-11-03: I want to see timeline splines for each, not only the color, but last 7d spline for each service) | none | `wt/e6-s1-inventory` | `main` | [https://health.zenod.dev](https://health.zenod.dev) (Jordi sets his own password, saved by his Bitwarden, only a hash stored; session renews while used), [card](cards/S1.md), [evidence](evidence/epic6-s1-it4-2026-11-03.md); tailnet page http://vps3.taild81fbb.ts.net:8742/ | 2026-11-03 | accepted by Jordi 2026-11-03 (review: step complete, cbd6a86) |
| S2 | Ticket worker | run_e1f220d2 | Health aggregator: one read-only JSON endpoint/service returning per-component status, last activity, last error (no secrets) | active | S1 | none | `main` | [S2 evidence](evidence/epic6-s2-2026-11-03.md), [card](cards/S2.md), [interface](health/AGGREGATOR.md): one zenod-health document per 5-min probe (status, since, signal, last activity, last error kept across redeploys, recent changes, alert transitions for S5); live on health.zenod.dev; 21 tests; c359aeb, 34f5607 | 2026-11-03 | confirm a last error survives the next real redeploy on the live page, then review |
| S3 | Ticket worker | run_53e90946 | Prod smoke battery: one `npm run` command, read-only, scheduled every 15 min, result stored for the page (E6-2) | active | S1 | none | `main` | none | 2026-10-24 | after S1 |
| S4 | Ticket worker | unassigned | health.zenod.dev: already live behind Jordi's own password since S1 (Jordi 2026-11-03 superseded tailnet-only EPIC-6-A1); what remains is to feed it from the S2 aggregator and S3 smoke results (E6-1) | draft | S2, S3 | none | `main` | none | 2026-10-24 | after S2/S3 |
| S5 | Ticket worker | run_e48fbc21 | Alert on red to Jordi (channel picked in S1, e.g. WhatsApp via Phylax or email) | active | none (repoints the existing watchdog; later also reads S2) | none | `main` | none | 2026-10-24 | first: make red reach Jordi |
| S6 | Tester | unassigned + Jordi | Prove red then green on one component (E6-3); Jordi acceptance (E6-4) | draft | S4, S5 | none | prod | none | 2026-10-24 | last |

## Waiting on

- [answered E6-A2 2026-11-03 @Jordi · done 2026-11-03 S5, S2, S3 stamped ready] Build the rest of the health page: fix the alarm first, then the aggregator and the smoke tests? — context: you accepted the live list at health.zenod.dev; the next steps are drafts and only you ready them — impact: S5 makes the red alarm reach you (today its warnings go to retired servers, so nobody hears them); S2 and S3 make each row a real check every 15 minutes; S4 and S6 then wire and prove it — risk: low, all read-only checks plus one alert channel; rollback: switch the alert off — recommend: yes, ready S5, S2 and S3 now, S5 first — why Jordi: only you ready rows — details: https://health.zenod.dev — answer: APPROVED
- [answered EPIC-6-A1 2026-10-25 @Jordi · done 2026-10-25 f9e26a3] Should `health.zenod.dev` be public? — answer: no, this is only via tailscale for us, or if it's public like zenod.dev we should then password it separately, but goal now is internal only — acted on: S4 is tailnet-only (no public DNS/exposure); a public page would need its own password and its own ask — unblocks: S4

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-03 | accepted | Jordi approved E6-A2: ready S5, S2, S3 (S5 first); decided by Delivery Manager: S5 no longer waits on S2 — it first repoints the existing watchdog | rows ready | a4a0118 | — |
| 2026-11-03 | accepted | Jordi accepted S1 (review: step complete) — the live list at health.zenod.dev behind his own password | S1 done; ask E6-A2 for S2/S3/S5 | cbd6a86 | — |
| 2026-11-03 | accepted | Jordi on the S1 review: "that's awesome, can it be on health.zenod.dev? and be pwd protected, yeah?" — supersedes EPIC-6-A1 (tailnet-only): the page goes on health.zenod.dev behind a password | S1 iteration 2 | ac5c8ee | — |
| 2026-10-24 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |
| 2026-10-25 | accepted | EPIC-6-A1 answered by Jordi: health page is internal-only via Tailscale; if it is ever made public (like zenod.dev) it gets its own password first | exposure of prod state stays inside the tailnet; S4 builds tailnet-only | this row, EPIC-6-A1 | a public page is wanted |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
