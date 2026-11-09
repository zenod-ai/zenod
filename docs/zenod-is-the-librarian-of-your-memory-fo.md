# EPIC-22: Zenod is the librarian of your memory: four clear modes

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/zenod-is-the-librarian-of-your-memory-fo.md
Spine ID: zenod-is-the-librarian-of-your-memory-four-clear-modes
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Reframe the app as the librarian of your memory (not a hosted workspace, not your memory). Four modes: Keep, Look up, Talk it over (a persona discussing your memory), Job on the memory (memory desk); one box, a mode label on each reply, tap to switch. Mockup first.

Goal sentence: Zenod becomes the librarian of your memory, with four clear modes and one box to talk to it.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): a paying user understands in one look what Zenod does for them and gets the right kind of answer every time.

## Done means

- [ ] E22-1 A mockup of the app as the librarian of your memory, with the four modes, one input box, a mode label on each reply and tap to switch, is at one URL and Jordi has said yes or given feedback
- [ ] E22-2 The live app (cloud.zenod.dev) works that way: retitled "Zenod · the librarian of your memory", one box where Zenod picks Keep, Look up, Talk it over or Job on the memory, labels each reply Kept, Looked up, Talking or Job sent, and lets him switch with a tap; Talk it over also starts from Personas
- [ ] E22-3 On a fixed set of his real messages the mode Zenod picks is right at least 9 times in 10, and "who are you?" gets a direct answer

## Current State

Owner: unassigned
Status: ready
Last attempted: 2026-11-09 planned from Jordi's brief; L1 mockup dispatched
Result: created, not started
Evidence: EPIC-0-FOUNDATION-SPINE.md
Waiting on: none
Approved work: none
Next action: L1 mockup in flight; the mockup comes back as an approve ask
Source revision: uncommitted scaffold
Verified at: 2026-11-09

## Non-Goals

- Changing how memories are filed or found (other epics own that; E15-S1 owns the relevance floor).
- New personas or desk jobs beyond what exists; this is how the app presents and routes them.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 | Ticket worker | run_176c4648-e252-4429-9dcf-dd90f47fb9e5 — claimed 2026-11-09T16:37Z, lease until 2026-11-09T18:37Z | E22-1: mockup of the librarian app with four modes, one box, mode labels and tap to switch, at one URL | active | none | none | main | none | 2026-11-09 | dispatched 2026-11-09; closes done (fed ask) once the approve ask is posted |
| L2 | Ticket worker | unassigned | E22-2, E22-3: build it in the live app after the mockup is approved | draft | L1 | none | main | none | 2026-11-09 | waits on the mockup ask |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-09 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-09 | accepted | Planned from Jordi's brief (Team desk 2026-11-09): "Zenod is not your memory, it is the librarian of your memory"; four modes Keep, Look up, Talk it over, Job on the memory; one input, mode label per reply, tap to switch; mockup first as a coded approve ask; reuse Epic Team modules | L1 mockup ready, L2 build draft until he approves the mockup | his brief | when the mockup ask is answered |
| 2026-11-09 | accepted | epic “Zenod is the librarian of your memory: four clear modes” ready on Jordi's ask (L-37, Team desk: "yes ok") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
