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

- [x] E22-1 A mockup of the app as the librarian of your memory, with the four modes, one input box, a mode label on each reply and tap to switch, is at one URL and Jordi has said yes or given feedback — round 2 approved (E22-A2)
- [x] E22-2 The live app (cloud.zenod.dev) works that way: retitled "Zenod · the librarian of your memory", one box where Zenod picks Keep, Look up, Talk it over or Job on the memory, labels each reply Kept, Looked up, Talking or Job sent, and lets him switch with a tap; Talk it over also starts from Personas — live on fa68fce since 2026-11-09 19:46Z, [evidence](evidence/e22-l2-live-2026-11-09.md)
- [x] E22-3 On a fixed set of his real messages the mode Zenod picks is right at least 9 times in 10, and "who are you?" gets a direct answer — 71 of 72 on the fixed set, 128 of 141 with held-out voice notes, [evidence](evidence/e22-l2-live-2026-11-09.md)

## Current State

Owner: L2 run_4b7a90b7-6a50-4887-9c53-d60a47f093af
Status: active (L3 monitoring; L2 closed by Jordi 2026-11-09)
Last attempted: 2026-11-09 L3 counted switches: 0 since the L2 roll (the L2 app did not record them); every switch is now recorded (#1568, aa46d5ee) and the tuning script is ready
Result: the live app is the librarian of your memory: five tabs, one box, Keep, Look up, Talk it over, Job on the memory, labelled and switchable; the mode is right on 71 of 72 of his real messages; memory numbers held
Evidence: [E22-L2 live](evidence/e22-l2-live-2026-11-09.md) · http://vps3.taild81fbb.ts.net:8921/e22-l2-live/ · [mockup round 2](evidence/e22-l2-2026-11-09.md)
Waiting on: nobody; L3 waits for 15 switches in the app
Approved work: E22-A2 (build it as in mockup round 2)
Next action: L3 next check 2026-11-12T21:00Z: count switches; tune at 15 or more
Source revision: aa46d5ee (production, /api/health 2026-11-09T21:52Z)
Verified at: 2026-11-09T21:52Z

## Waiting on

- [answered E22-A2 2026-11-09 @Jordi · done 2026-11-09 L2 build dispatched] Build the app as in mockup round 2? Open http://vps3.taild81fbb.ts.net:8921/e22-l2/ and click through it (about 3 minutes) — context: round 2 from your feedback: "Zenod" now leads the header and the tagline is smaller and quieter; five tabs (Chat, Inbox, Personas, Memory, Settings) instead of twelve, and a map on the page shows where every feature of today's app went, so nothing is lost; Memory holds the numbers and charts, the tree, the graph and the check where it landed list; Settings is one place for the rest; one box, four modes with labels, tap to switch and "who are you?" answered directly stay as in round 1; the examples are made up — impact: a yes starts the build in the live app, about a week plus two days for the regrouping and the new charts; today's panels are moved, not rewritten, and old links keep working — risk: low; the app changes how it groups and presents what it already does, WhatsApp replies do not change; rollback is reverting the release — recommend: yes, then give any wording feedback in the reply — why Jordi: it changes how the product presents itself — unblocks: L2 — details: [mockup round 2 evidence](evidence/e22-l2-2026-11-09.md) — answer: APPROVED
- [feedback E22-A1 2026-11-09 @Jordi · done 2026-11-09 fa1e68d3 round 2 E22-A2] Build the app as the librarian of your memory, as in this mockup? Open http://vps3.taild81fbb.ts.net:8921/e22-l1/ and click through it (about 3 minutes) — context: as you asked, Zenod is the librarian and the library is yours; one box "Talk to your librarian", Zenod picks Keep, Look up, Talk it over or Job on the memory and labels each reply Kept, Looked up, Talking or Job sent, tap the label to switch; Talk it over also starts from Personas; "who are you?" is answered directly; the examples are made up, not your notes — impact: a yes starts the build in the live app, mostly reusing today's chat decision, answers, personas and memory desk — risk: low; the app changes how it presents and routes what it already does; rollback is reverting the change — recommend: yes, then give any wording feedback in the reply — why Jordi: it changes how the product presents itself — unblocks: L2 — details: [mockup evidence](evidence/e22-l1-2026-11-09.md) — feedback: I like this direction a lot, but also I think you're losing a lot of functionality, so I agree with, and I think the name and the headline should be slightly different sizes or colors or something so that the tagline, it has less protagonism than the name itself. I like that the bars and settings are kind of more clear, but I think we're losing a lot of tabs. I'm kind of not unhappy about that, but like we don't need 10 million tabs, but inside of memory, we're missing a lot, I think, no? Like seeing the charts, the graphs, and also the settings, let's do another iteration before I approve. But good direction, it's getting cleaner. (voice note vn_723dd97e, audio https://team.alpha9.io/api/voice/notes/vn_723dd97e/audio)

## Outcome

Verdict: accomplished
Closed: 2026-11-09 by Jordi (closed on the console's review list)
Outcome: The live app is Zenod, the librarian of your memory: one box where Zenod picks Keep, Look up, Talk it over or Job on the memory, labels each reply and lets you switch with a tap, inside five tabs that keep every earlier feature.
Risk: the mode pick was measured on Zenod's plain rules, tuned after seeing the 72 messages, so the held-out 69 voice notes are the fairer number; Talk it over replies are not checked against the memories like answers are; WhatsApp and Telegram are unchanged.

| Done means | Evidence |
|---|---|
| E22-1 mockup at one URL, Jordi's yes or feedback | [round 1](evidence/e22-l1-2026-11-09.md), [round 2](evidence/e22-l2-2026-11-09.md); feedback E22-A1, yes E22-A2 |
| E22-2 the live app works that way | [live evidence](evidence/e22-l2-live-2026-11-09.md), production fa68fce since 2026-11-09 19:46:55Z |
| E22-3 the mode is right at least 9 in 10, who are you answered directly | [live evidence](evidence/e22-l2-live-2026-11-09.md): 71 of 72, 128 of 141 with held-out voice notes |

## Non-Goals

- Changing how memories are filed or found (other epics own that; E15-S1 owns the relevance floor).
- New personas or desk jobs beyond what exists; this is how the app presents and routes them.

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 | Ticket worker | run_176c4648-e252-4429-9dcf-dd90f47fb9e5 | E22-1: mockup of the librarian app with four modes, one box, mode labels and tap to switch, at one URL | done (fed E22-A1) | none | main-direct (docs only) | 875a7820 | http://vps3.taild81fbb.ts.net:8921/e22-l1/ | 2026-11-09 | mockup live; E22-A1 approve ask drafted for the Delivery manager; L2 waits on his answer |
| L2 | Ticket worker | run_4b7a90b7-6a50-4887-9c53-d60a47f093af | E22-2, E22-3: build it in the live app after the mockup is approved | done (approved by Jordi 2026-11-09) | E22-A2 approved 2026-11-09 | [#1565](https://github.com/zenod-ai/zenod/pull/1565) merged fa68fce1, live 19:46:55Z | 5b2109dd | http://vps3.taild81fbb.ts.net:8921/e22-l2-live/ ([evidence](evidence/e22-l2-live-2026-11-09.md), [card](cards/L2.md)) | 2026-11-09 | followups: started L3 |
| L3 | Ticket worker | run_3f905070-9db4-49f5-8a2f-4d213b70c3f9 — claimed 2026-11-09T20:42Z | tune the mode pick from your switches: follow-up of L2 | active | L2 | [#1568](https://github.com/zenod-ai/zenod/pull/1568) merged aa46d5ee, live 21:52Z | e7764ec0 | [evidence](evidence/e22-l3-2026-11-09.md) | 2026-11-09 | monitoring: 0 switches, under the 15 needed; next check 2026-11-12T21:00Z: run `scripts/e22-mode-switches.mjs count` on the proxy log; at 15+ read the switches file (needs read access to that one file, an ask raised only then), run `tune`, ship with 71/72 and 128/141 held |
| E22-S1 | Ticket worker | run_e9da6afd-145b-4f0d-a588-619c65ec8bd6 | A memory canvas: Zenod knows how to store a learning: Like EpicSpine's product canvas, Zenod gets a canvas for kinds of memory (a learning, feedback, a decision, a fact) and stores each the right way; a product promise on the landing; plus bundles: Zenod premium includes EpicTeam and vice versa at one price, one memory. | done (fed E22-A3) | none | main-direct (docs only) | main | http://vps3.taild81fbb.ts.net:8921/e22-s1/ ([evidence](evidence/e22-s1-2026-11-10.md), [card](cards/E22-S1.md)) | 2026-11-10 | plan: seven kinds (fact, decision, learning, feedback, idea, to-do, what happened), counted on 1,102 real log entries (his own 154: to-do 40, idea 33, fact 23, learning 0); landing line drafted; bundle = one ladder, EpicTeam plans include Zenod Plus at EpicTeam's price; E22-A3 (build the canvas?) drafted for the Delivery manager, E22-A4 (bundle) waits on agent_team E97-A2; build rows B1-B6 drafted in the evidence; followups: start build the memory canvas (B1-B5) on a yes to E22-A3; park the bundle (B6) until E97-A2 and E22-A4; confirm: yes — only Jordi can say which kinds his memory keeps and what Zenod promises |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-09 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-09 | accepted | Planned from Jordi's brief (Team desk 2026-11-09): "Zenod is not your memory, it is the librarian of your memory"; four modes Keep, Look up, Talk it over, Job on the memory; one input, mode label per reply, tap to switch; mockup first as a coded approve ask; reuse Epic Team modules | L1 mockup ready, L2 build draft until he approves the mockup | his brief | when the mockup ask is answered |
| 2026-11-09 | accepted | epic “Zenod is the librarian of your memory: four clear modes” ready on Jordi's ask (L-37, Team desk: "yes ok") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-09 | revised | E22-A1 was feedback (0db6fd54): Jordi likes the direction but wants the name to lead and the tagline quieter, fewer tabs without losing functionality, and Memory to keep the charts, graphs and settings; "let's do another iteration before I approve" | mockup round 2 (run_41ed542e) maps every feature of today's app to its new home; comes back as E22-A2; the live build waits | his voice note vn_723dd97e | when E22-A2 is answered |
| 2026-11-09 | accepted | Jordi approved E22-A2: build the app as in mockup round 2 | L2 builds it in the live app (five tabs, one box, four modes, Memory views, one Settings), panels moved not rewritten, old links kept; staged releases | 665b1886 | when L2 is in review |
| 2026-11-09 | accepted | L2 live on fa68fce: Talk it over is read-only and web only, a new Send action talk; the rules pick talk on openers like "let's talk", "should I", "what do you think", and the model's talk only for a message that asks nothing; spoken tags are not questions and a long note is kept whole | E22-3 71 of 72, 128 of 141 with held-out voice notes, rules tuned after seeing the 72 | [evidence](evidence/e22-l2-live-2026-11-09.md) | when his switches show a pattern |
| 2026-11-09 | accepted | L3: the L2 label tap was not recorded, so 0 switches so far (proxy log since 19:46:55Z: 0 sends, 0 redo calls); each switch is now kept in the tenant data folder with the message, the pick, rules or model, and the new mode; `scripts/e22-mode-switches.mjs` counts from the proxy log and tunes from 15 on | no tuning on 0 switches; floors 71/72 and 128/141 stay the guard | [evidence](evidence/e22-l3-2026-11-09.md) | 2026-11-12T21:00Z or 15 switches |
| 2026-11-10 | accepted | E22-S1 ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-10 03:54Z Zenod: Log/2026-11-10.md#^e-ecf0b8 I think there is this diagram in ") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | proposed | E22-S1 plan: a memory canvas of seven kinds stored in kind sections on topic pages, found by kind; repeated feedback becomes a suggested learning (Jordi states learnings in 0 of his 154 entries); landing line "Tell Zenod anything. It knows a decision from an idea from a lesson learned, and keeps each the way you will want it back."; bundle as one price ladder, Zenod Plus inside every EpicTeam plan at EpicTeam's price, L-7 seams kept | prepared, not decided: E22-A3 (canvas) to post now, E22-A4 (bundle) after agent_team E97-A2 | [evidence](evidence/e22-s1-2026-11-10.md) | on E22-A3 |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
