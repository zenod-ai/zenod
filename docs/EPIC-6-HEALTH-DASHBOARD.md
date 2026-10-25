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

## Goal

Before testers arrive, anyone can see in one page whether the site, the database, the WhatsApp relay and the agents are alive, and when each last did real work.

## Serves

[Zenod Alpha Launch — milestone A: Zenod is production-ready](EPIC-ZENOD-ALPHA-LAUNCH.md): DOD-1 puts 10 testers on prod; we must see an outage before a tester does, and A0's re-check becomes a page anyone can open instead of a one-off.

## Done means

- [ ] E6-1 `https://health.zenod.dev` serves one page with a row per component: marketing site (`zenod.dev`), cloud app (`cloud.zenod.dev/api/health`, deployed SHA vs `main`), database (incl. the credits/usage ledger), WhatsApp relay, agent runner + Phylax. Each row shows green/amber/red, when it was checked, when it last did real work (last WhatsApp message in/out, last DB write, last agent run) and the last error from its logs with a timestamp. No secrets or user data on the page.
- [ ] E6-2 A read-only prod smoke battery (one `npm run` command) checks the same components, runs every 15 min, and the page shows its last result and time; it exits non-zero on any red.
- [ ] E6-3 Proven red: one component deliberately broken (or simulated) turns its row red within 15 min and an alert reaches Jordi; back to green once fixed.
- [ ] E6-4 Jordi opens the page and accepts it.

## Current State

Owner: unassigned
Status: ready
Last attempted: defined on 2026-10-24 from Jordi's ask, after a quick read-only check
Result: defined, not started. Check 2026-10-24: `zenod.dev` 200, `cloud.zenod.dev/api/health` ok on `e2930b8` (= `main`), `health.zenod.dev` 404 (does not exist); CI green, but Publish image still reports failure on every push (ZAL finding); no DB, WhatsApp or runner signal is visible from outside today
Evidence: EPIC-ZENOD-ALPHA-LAUNCH.md
Waiting on: none
Approved work: none
Next action: dispatch S1 (inventory); it can run alongside ZAL A0
Source revision: uncommitted scaffold
Verified at: 2026-10-24

## Non-Goals

- Per-user analytics or owner screens (ZAL-11…ZAL-16, deferred by ZAL).
- A full observability stack (Prometheus/Grafana/log shipping) unless S1 shows it is the cheapest route.
- Auto-remediation (restarts, redeploys); the page reports, people act.
- Fixing the components themselves: breakages found go to ZAL A0 or their own spine.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Ticket worker | unassigned | Inventory: each component, where it runs on today's infra (post infra-vps cleanup), its health signal, the log/table that shows last real activity and last error; what test batteries exist (`npm test`, `acceptance:*`, `packages/server/test/health.test.ts`) | ready | none | none | `main` | none | 2026-10-24 | dispatch; output a linked page `docs/health/INVENTORY.md` |
| S2 | Ticket worker | unassigned | Health aggregator: one read-only JSON endpoint/service returning per-component status, last activity, last error (no secrets) | draft | S1 | none | `main` | none | 2026-10-24 | after S1 |
| S3 | Ticket worker | unassigned | Prod smoke battery: one `npm run` command, read-only, scheduled every 15 min, result stored for the page (E6-2) | draft | S1 | none | `main` | none | 2026-10-24 | after S1 |
| S4 | Ticket worker | unassigned | `health.zenod.dev`: page + Cloudflare DNS + Dokploy deploy (E6-1) | draft | S2, S3, EPIC-6-A1 | none | `main` | none | 2026-10-24 | after S2/S3 |
| S5 | Ticket worker | unassigned | Alert on red to Jordi (channel picked in S1, e.g. WhatsApp via Phylax or email) | draft | S2 | none | `main` | none | 2026-10-24 | after S2 |
| S6 | Tester | unassigned + Jordi | Prove red then green on one component (E6-3); Jordi acceptance (E6-4) | draft | S4, S5 | none | prod | none | 2026-10-24 | last |

## Waiting on

- [ask EPIC-6-A1: decide @Jordi since 2026-10-24] Should `health.zenod.dev` be public? — options: public summary (green/red + times only), details behind Console login | all behind login | all public — recommend: public summary, details behind login — impact: public lets testers self-check outages; risk: public exposes uptime and component names, never user data — unblocks: S4 — effort: ~1 min — why Jordi: exposure of prod state is an owner call — context: E6-1

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-10-24 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
