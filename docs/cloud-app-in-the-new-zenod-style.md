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
- [ ] E17-2 The Z favicon (16, 32, 180, 512 and SVG) shows on every Zenod surface (cloud app, zenod.dev, the health page), checked live; no Vite icon left.
- [ ] E17-3 The new landing page is confirmed live on zenod.dev.

## Current State

Owner: Delivery Manager (Zenod launch)
Status: active
Last attempted: scaffolded with spine_new.py on 2026-11-08
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: D1 dispatched
Source revision: uncommitted scaffold
Verified at: 2026-11-08

## Non-Goals

- No new features; looks only. WhatsApp unchanged (root L-6).

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | Ticket worker | unassigned | Harmonize the whole cloud app to the Zenod design language and put the Z favicon on every Zenod surface (E17-1..3) | ready | none | `wt/e17-d1` | main | none | 2026-11-08 | dispatch |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-08 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-08 | accepted | Epic stamped ready and D1 added (root L-37). Decided by Jordi via WhatsApp voice notes 2026-11-08 15:53Z: Log/2026-11-08.md#^e-032209 ("can we make the entire UX carry over the style… the UX with all the settings and choices and switches… That's in parallel. It can just be dispatched.") and Log/2026-11-08.md#^e-ffbbbc ("the favicon for the cloud version of Zenod is still not the Z, it's still some Vite… we need to get the favicons under control"). | his notes are the ready stamp | team desk note | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
