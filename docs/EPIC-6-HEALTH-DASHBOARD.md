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

- [ ] E6-1 `health.zenod.dev` serves, on the Tailscale network only (EPIC-6-A1 answered 2026-10-25), one page with a row per component: marketing site (`zenod.dev`), cloud app (`cloud.zenod.dev/api/health`, deployed SHA vs `main`), database (incl. the credits/usage ledger), WhatsApp relay, agent runner + Phylax. Each row shows green/amber/red, when it was checked, when it last did real work (last WhatsApp message in/out, last DB write, last agent run) and the last error from its logs with a timestamp. No secrets or user data on the page.
- [ ] E6-2 A read-only prod smoke battery (one `npm run` command) checks the same components, runs every 15 min, and the page shows its last result and time; it exits non-zero on any red.
- [ ] E6-3 Proven red: one component deliberately broken (or simulated) turns its row red within 15 min and an alert reaches Jordi; back to green once fixed.
- [ ] E6-4 Jordi opens the page and accepts it.

## Current State

Owner: unassigned
Status: active
Last attempted: 2026-10-25 Epic Spine health wake (run_bad0b5fb) dispatched S1 as run_661d3443; earlier: defined 2026-10-24 from Jordi's ask, after a quick read-only check
Result: defined, not started. Check 2026-10-24: `zenod.dev` 200, `cloud.zenod.dev/api/health` ok on `e2930b8` (= `main`), `health.zenod.dev` 404 (does not exist); CI green, but Publish image still reports failure on every push (ZAL finding); no DB, WhatsApp or runner signal is visible from outside today
Evidence: EPIC-ZENOD-ALPHA-LAUNCH.md
Waiting on: none (EPIC-6-A1 answered 2026-10-25: internal-only via Tailscale)
Approved work: none
Next action: S1 (inventory) dispatched 2026-10-25 by Epic Spine health, alongside ZAL A0; then S2/S3 once Jordi stamps them ready
Source revision: uncommitted scaffold
Verified at: 2026-10-25

## Non-Goals

- Per-user analytics or owner screens (ZAL-11…ZAL-16, deferred by ZAL).
- A full observability stack (Prometheus/Grafana/log shipping) unless S1 shows it is the cheapest route.
- Auto-remediation (restarts, redeploys); the page reports, people act.
- Fixing the components themselves: breakages found go to ZAL A0 or their own spine.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Ticket worker | run_661d3443 | Inventory: each component, where it runs on today's infra (post infra-vps cleanup), its health signal, the log/table that shows last real activity and last error; what test batteries exist (`npm test`, `acceptance:*`, `packages/server/test/health.test.ts`) | review | none | `wt/e6-s1-inventory` | `main` | [docs/health/INVENTORY.md](health/INVENTORY.md) (probe 2026-10-25; S5 channel and findings inside) | 2026-10-25 | propose done on that evidence; S2/S3 may start once stamped ready; S5 first repoints the watchdog |
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
| 2026-10-24 | accepted | Created as a goal under ZAL | one node in the epic log | EPIC-ZENOD-ALPHA-LAUNCH.md | never |
| 2026-10-25 | accepted | EPIC-6-A1 answered by Jordi: health page is internal-only via Tailscale; if it is ever made public (like zenod.dev) it gets its own password first | exposure of prod state stays inside the tailnet; S4 builds tailnet-only | this row, EPIC-6-A1 | a public page is wanted |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
