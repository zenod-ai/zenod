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
Last attempted: 2026-11-03 roll-up from the ledger — S1 (review): the inventory of Zenod's 12 parts is a live page at https://health.zenod.dev behind a sign-in (tailnet copy http://vps3.taild81fbb.ts.net:8742/), refreshed every 5 min, on Jordi's request; S2–S6 (draft): aggregator, smoke battery, page polish and deploy, alert to Jordi, red-then-green proof, all waiting for Jordi to accept S1 and stamp the next steps
Result: Jordi can already see whether Zenod is up at health.zenod.dev: 10 parts green, the agent runner grey (not deployed), and the host watchdog red because its alerts still go to retired servers (S5 fixes that)
Evidence: [S1 iteration 2](evidence/epic6-s1-it2-2026-11-03.md), [S1 card](cards/S1.md), [INVENTORY](health/INVENTORY.md) 8d67cf3
Waiting on: Jordi reviews the S1 card (in his review list); no coded ask
Approved work: none
Next action: on Jordi's accept of S1, he stamps S2 and S3 ready; S5 (repoint the watchdog alerts) is the most useful next fix
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
| S1 | Ticket worker | run_7205d65a | Inventory: each component, where it runs on today's infra (post infra-vps cleanup), its health signal, the log/table that shows last real activity and last error; what test batteries exist (`npm test`, `acceptance:*`, `packages/server/test/health.test.ts`) | active (iteration 2, relaunched by Jordi 2026-11-03: I was able to sign in and it works, but I need to control the password, I can't ask you for new link every 30d - can't you add via BW a pwd on my ring without seeing it???) | none | `wt/e6-s1-inventory` | `main` | [https://health.zenod.dev](https://health.zenod.dev) (sign-in: one-click one-time link shown on the card's live tailnet page), [card](cards/S1.md), [evidence](evidence/epic6-s1-it3-2026-11-03.md); tailnet page http://vps3.taild81fbb.ts.net:8742/ | 2026-11-03 | iteration 4: Jordi controls his own password, saved in his Bitwarden, nobody else sees it; session renews while used (worker run_7205d65a) |
| S2 | Ticket worker | unassigned | Health aggregator: one read-only JSON endpoint/service returning per-component status, last activity, last error (no secrets) | draft | S1 | none | `main` | none | 2026-10-24 | after S1 |
| S3 | Ticket worker | unassigned | Prod smoke battery: one `npm run` command, read-only, scheduled every 15 min, result stored for the page (E6-2) | draft | S1 | none | `main` | none | 2026-10-24 | after S1 |
| S4 | Ticket worker | unassigned | `health.zenod.dev` (internal, tailnet-only per EPIC-6-A1; no public DNS record, no public exposure): page + Dokploy deploy (E6-1) | draft | S2, S3 | none | `main` | none | 2026-10-24 | after S2/S3 |
| S5 | Ticket worker | unassigned | Alert on red to Jordi (channel picked in S1, e.g. WhatsApp via Phylax or email) | draft | S2 | none | `main` | none | 2026-10-24 | after S2 |
| S6 | Tester | unassigned + Jordi | Prove red then green on one component (E6-3); Jordi acceptance (E6-4) | draft | S4, S5 | none | prod | none | 2026-10-24 | last |

## Waiting on

- [answered EPIC-6-A1 2026-10-25 @Jordi · done 2026-10-25 f9e26a3] Should `health.zenod.dev` be public? — answer: no, this is only via tailscale for us, or if it's public like zenod.dev we should then password it separately, but goal now is internal only — acted on: S4 is tailnet-only (no public DNS/exposure); a public page would need its own password and its own ask — unblocks: S4

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-03 | accepted | Jordi on the S1 review: "that's awesome, can it be on health.zenod.dev? and be pwd protected, yeah?" — supersedes EPIC-6-A1 (tailnet-only): the page goes on health.zenod.dev behind a password | S1 iteration 2 | ac5c8ee | — |
| 2026-10-24 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |
| 2026-10-25 | accepted | EPIC-6-A1 answered by Jordi: health page is internal-only via Tailscale; if it is ever made public (like zenod.dev) it gets its own password first | exposure of prod state stays inside the tailnet; S4 builds tailnet-only | this row, EPIC-6-A1 | a public page is wanted |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
