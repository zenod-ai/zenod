# EPIC-17: Cloud app in the new Zenod style

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/cloud-app-in-the-new-zenod-style.md
Spine ID: cloud-app-in-the-new-zenod-style
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Carry the new landing page style across the whole logged-in app (chat, settings, choices, switches): minimal, clean, simple, one harmonized Zenod look. Also confirm the new landing page is live.

Goal sentence: The whole cloud app looks like Zenod, and every Zenod page shows the Z icon.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a paying user should meet one clean Zenod look from the landing page to every screen of the app.

## Done means

- [ ] E17-1 Every screen of the logged-in cloud app (chat, memory graph, settings, choices and switches) uses the new Zenod design language, checked live on phone and desktop.
- [x] E17-2 The Z favicon (16, 32, 180, 512 and SVG) shows on every Zenod surface (cloud app, zenod.dev, the health page), checked live; no Vite icon left.
- [x] E17-3 The new landing page is confirmed live on zenod.dev.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: 2026-11-08 D1 (run_09a7cd57): whole cloud app restyled in the paper look, Z favicon set on every Zenod surface, PR #1519 merged and live
Result: live on production sha 9ef8c0c7 (contains merge 5cd14132); the Z shows in real browser tabs on cloud.zenod.dev, zenod.dev, /connect and health.zenod.dev; the paper landing is live on zenod.dev. Signed-in screens checked on demo data only (no tester account yet, E7-A15)
Evidence: [e17-d1 evidence](http://vps3.taild81fbb.ts.net:8921/e17-d1/) · [docs/evidence/e17-d1-2026-11-08.md](evidence/e17-d1-2026-11-08.md) · card [docs/cards/E17-D1.md](cards/E17-D1.md)
Waiting on: nobody; the D1 card is in review
Approved work: D1
Next action: Jordi opens the D1 card; on his close, E17-1 is ticked and the epic closes
Source revision: main 9ef8c0c7 (code), docs after
Verified at: 2026-11-08 18:05Z (live health sha, live icon URLs, headed-browser tabs)

## Non-Goals

- No new features; looks only. WhatsApp unchanged (root L-6).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | Ticket worker | run_09a7cd57 | Harmonize the whole cloud app to the Zenod design language and put the Z favicon on every Zenod surface (E17-1..3) | done (approved by Jordi 2026-11-08) | none | PR #1519 merged (5cd14132) | main | [evidence](http://vps3.taild81fbb.ts.net:8921/e17-d1/), live sha 9ef8c0c7, card E17-D1 | 2026-11-08 18:05Z | followups: started D2 |
| D2 | Ticket worker | unassigned | check the signed-in screens on production once the first tester signs in: follow-up of D1 | ready | D1 | none | main | Jordi started it when closing D1 2026-11-08 | 2026-11-08 | worker |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | Epic stamped ready and D1 added (root L-37). Decided by Jordi via WhatsApp voice notes 2026-11-08 15:53Z: Log/2026-11-08.md#^e-032209 ("can we make the entire UX carry over the style… the UX with all the settings and choices and switches… That's in parallel. It can just be dispatched.") and Log/2026-11-08.md#^e-ffbbbc ("the favicon for the cloud version of Zenod is still not the Z, it's still some Vite… we need to get the favicons under control"). | his notes are the ready stamp | team desk note | — |
| 2026-11-08 | accepted | D1: the favicon artwork is the paper Z (Newsreader, ink on paper, favicon.svg since 37b81fc6), not the older Bodoni Z of the E10-R2 directory kit | it is the newest Z and matches the paper look; the `/brand/` kit stays as directories link it | [e17-d1 evidence](evidence/e17-d1-2026-11-08.md) | if Jordi wants the Bodoni Z |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
