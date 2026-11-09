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
Last attempted: 2026-11-09 L2 mockup round 2 live at http://vps3.taild81fbb.ts.net:8921/e22-l2/ (after E22-A1 feedback)
Result: created, not started
Evidence: [E22-L2 mockup round 2](evidence/e22-l2-2026-11-09.md) · [round 1](evidence/e22-l1-2026-11-09.md)
Waiting on: nobody
Approved work: none
Next action: Jordi answers E22-A2 on mockup round 2; on yes, L2 builds it in the live app
Source revision: uncommitted scaffold
Verified at: 2026-11-09

## Waiting on

- [answered E22-A2 2026-11-09 @Jordi · done 2026-11-09 L2 build dispatched] Build the app as in mockup round 2? Open http://vps3.taild81fbb.ts.net:8921/e22-l2/ and click through it (about 3 minutes) — context: round 2 from your feedback: "Zenod" now leads the header and the tagline is smaller and quieter; five tabs (Chat, Inbox, Personas, Memory, Settings) instead of twelve, and a map on the page shows where every feature of today's app went, so nothing is lost; Memory holds the numbers and charts, the tree, the graph and the check where it landed list; Settings is one place for the rest; one box, four modes with labels, tap to switch and "who are you?" answered directly stay as in round 1; the examples are made up — impact: a yes starts the build in the live app, about a week plus two days for the regrouping and the new charts; today's panels are moved, not rewritten, and old links keep working — risk: low; the app changes how it groups and presents what it already does, WhatsApp replies do not change; rollback is reverting the release — recommend: yes, then give any wording feedback in the reply — why Jordi: it changes how the product presents itself — unblocks: L2 — details: [mockup round 2 evidence](evidence/e22-l2-2026-11-09.md) — answer: APPROVED
- [feedback E22-A1 2026-11-09 @Jordi · done 2026-11-09 fa1e68d3 round 2 E22-A2] Build the app as the librarian of your memory, as in this mockup? Open http://vps3.taild81fbb.ts.net:8921/e22-l1/ and click through it (about 3 minutes) — context: as you asked, Zenod is the librarian and the library is yours; one box "Talk to your librarian", Zenod picks Keep, Look up, Talk it over or Job on the memory and labels each reply Kept, Looked up, Talking or Job sent, tap the label to switch; Talk it over also starts from Personas; "who are you?" is answered directly; the examples are made up, not your notes — impact: a yes starts the build in the live app, mostly reusing today's chat decision, answers, personas and memory desk — risk: low; the app changes how it presents and routes what it already does; rollback is reverting the change — recommend: yes, then give any wording feedback in the reply — why Jordi: it changes how the product presents itself — unblocks: L2 — details: [mockup evidence](evidence/e22-l1-2026-11-09.md) — feedback: I like this direction a lot, but also I think you're losing a lot of functionality, so I agree with, and I think the name and the headline should be slightly different sizes or colors or something so that the tagline, it has less protagonism than the name itself. I like that the bars and settings are kind of more clear, but I think we're losing a lot of tabs. I'm kind of not unhappy about that, but like we don't need 10 million tabs, but inside of memory, we're missing a lot, I think, no? Like seeing the charts, the graphs, and also the settings, let's do another iteration before I approve. But good direction, it's getting cleaner. (voice note vn_723dd97e, audio https://team.alpha9.io/api/voice/notes/vn_723dd97e/audio)

## Non-Goals

- Changing how memories are filed or found (other epics own that; E15-S1 owns the relevance floor).
- New personas or desk jobs beyond what exists; this is how the app presents and routes them.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 | Ticket worker | run_176c4648-e252-4429-9dcf-dd90f47fb9e5 | E22-1: mockup of the librarian app with four modes, one box, mode labels and tap to switch, at one URL | done (fed E22-A1) | none | main-direct (docs only) | 875a7820 | http://vps3.taild81fbb.ts.net:8921/e22-l1/ | 2026-11-09 | mockup live; E22-A1 approve ask drafted for the Delivery manager; L2 waits on his answer |
| L2 | Ticket worker | unassigned | E22-2, E22-3: build it in the live app after the mockup is approved | ready | E22-A2 approved 2026-11-09 | main-direct (docs only, mockup) | 0db6fd54 | http://vps3.taild81fbb.ts.net:8921/e22-l2/ ([evidence](evidence/e22-l2-2026-11-09.md)) | 2026-11-09 | mockup round 2 at http://vps3.taild81fbb.ts.net:8921/e22-l2/; waits on E22-A2 |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-09 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-09 | accepted | Planned from Jordi's brief (Team desk 2026-11-09): "Zenod is not your memory, it is the librarian of your memory"; four modes Keep, Look up, Talk it over, Job on the memory; one input, mode label per reply, tap to switch; mockup first as a coded approve ask; reuse Epic Team modules | L1 mockup ready, L2 build draft until he approves the mockup | his brief | when the mockup ask is answered |
| 2026-11-09 | accepted | epic “Zenod is the librarian of your memory: four clear modes” ready on Jordi's ask (L-37, Team desk: "yes ok") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-09 | revised | E22-A1 was feedback (0db6fd54): Jordi likes the direction but wants the name to lead and the tagline quieter, fewer tabs without losing functionality, and Memory to keep the charts, graphs and settings; "let's do another iteration before I approve" | mockup round 2 (run_41ed542e) maps every feature of today's app to its new home; comes back as E22-A2; the live build waits | his voice note vn_723dd97e | when E22-A2 is answered |
| 2026-11-09 | accepted | Jordi approved E22-A2: build the app as in mockup round 2 | L2 builds it in the live app (five tabs, one box, four modes, Memory views, one Settings), panels moved not rewritten, old links kept; staged releases | 665b1886 | when L2 is in review |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
