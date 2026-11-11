# EPIC-25: Landing: literals kept forever, a living graph, your data stays yours

Spine profile: compact
Repository: zenod-ai/zenod
Primary document: docs/landing-literals-kept-forever-a-living-g.md
Spine ID: landing-literals-kept-forever-a-living-graph-your-data-stays-yours
Root spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: main-direct

## Goal

Animated sections early on: raw words kept forever in your own Drive/GitHub; a cloud of thoughts with weighted links built from them; helpers that read it and make new memories; we are the librarian of your library; one memory every AI (WhatsApp, Claude, Codex, Gemini, Cursor, MCP) reads and writes.

Goal sentence: zenod.dev shows early, in moving pictures, that your words are kept forever and grow into a living graph you own.

## Serves

[EPIC-0: Zenod — a paying user on WhatsApp](EPIC-0-FOUNDATION-SPINE.md): strangers understand in seconds why Zenod is worth trying.

## Done means

- [x] E25-1 (G1, live 2026-11-10 on 1f1ebae, [evidence](evidence/e25-g1-2026-11-10.md)) zenod.dev opens with short animated sections, true of production today: your raw words kept forever in your own Drive or GitHub; a cloud of thoughts with weighted links built from them; helpers that read it and make new memories; Zenod the librarian of your library; one memory every AI reads and writes (WhatsApp, Claude, Codex, Gemini, Cursor, MCP)
- [ ] E25-2 Jordi says yes to the live page

## Current State

Owner: run_f9669997-5116-45b6-b964-5ff1802e78b2 (G1)
Status: active
Last attempted: 2026-11-10 G1 built five animated moves right after the hero on zenod.dev: words kept forever in your own Drive or GitHub; a cloud of thoughts with weighted links; helpers that add new memories; Zenod the librarian; one memory every AI reads and writes (WhatsApp in; Claude, ChatGPT, Codex, Gemini CLI, Cursor, VS Code, any MCP tool)
Result: live on zenod.dev since 2026-11-10 05:22Z (production 1f1ebae, merge f8ff11d, PR #1582); every claim checked against production, Codex's OAuth connect included; E25-1 met pending Jordi's look
Evidence: https://zenod.dev/#how-zenod-works ; [evidence](evidence/e25-g1-2026-11-10.md) ; [card](cards/E25-G1.md)
Waiting on: nobody (G1's card is in Jordi's review, E25-2)
Approved work: none
Next action: Jordi opens zenod.dev and says yes or what to change; on his yes write the Outcome
Source revision: 1f1ebae
Verified at: 2026-11-10T05:24Z (live bundle carries the new headings; desktop and phone captured)

## Non-Goals

- Claims that are not true of production today.

## Waiting on

- [answered E25-A1 2026-11-11 @Jordi] Which tagline goes on Zenod's social banners: A "Say it once. Every AI remembers.", B "Your words, kept forever. Found when you need them." or C "Think out loud. Ask any AI later."? — context: you asked for a cooler tagline than Hire a librarian for your memory; all three are shown on real-size X banners on a computer and a phone — impact: the social team holds the new banners until you pick; the landing keeps today's line unless you say to change it too — risk: none, each is one line of copy and easy to change back — recommend: A, the shortest, and it names what only Zenod does: one memory that Claude, ChatGPT, Cursor and other AI tools all read — why Jordi: the brand voice is your call — options: A · B · C · none of these — unblocks: zenod-social E10-S8 banners — details: [the three banners](http://vps3.taild81fbb.ts.net:8921/e25-s1/) — answer: Organize, own, compound your memory - play with sentencer like that

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| G1 | Ticket worker | run_f9669997-5116-45b6-b964-5ff1802e78b2 | E25-1: the animated landing sections on zenod.dev, live | done (approved by Jordi 2026-11-10) | none | [#1582](https://github.com/zenod-ai/zenod/pull/1582) merged f8ff11d | main | live https://zenod.dev/#how-zenod-works on 1f1ebae since 2026-11-10 05:22Z ([evidence](evidence/e25-g1-2026-11-10.md), [card](cards/E25-G1.md)) | 2026-11-10T05:24Z | followups: none; confirm: yes — only Jordi can say whether the page now lands the ideas from his voice note (E25-2) |
| G2 | Ticket worker | run_f9669997 (with G1) | E25-2: Jordi says yes to the live page (his verdict on G1's review card) | active | G1 | none | main | none | 2026-11-10 | closes when Jordi closes G1's card |
| E25-S1 | Ticket worker | unassigned | New Zenod social kit: a bolder Z, a readable banner, a cooler tagline: Redo the Zenod social kit: the Z icon is too thin top and bottom (make it as strong as our better marks); the banner text is barely readable at X size; a cooler tagline than 'Hire a librarian for your memory'; same kit for X, YouTube, Instagram, LinkedIn. | ready | none | PR #1620 merged bfef1a08 | main | [evidence](evidence/e25-s1-2026-11-11.md) ; [page](http://vps3.taild81fbb.ts.net:8921/e25-s1/) ; [card](cards/E25-S1.md) | 2026-11-11T04:05Z staging reports bfef1a08 and serves the new Z; production 3831b06; round 2: six taglines in Jordi's pattern on the evidence page | Delivery manager: post ask E25-A2 (which tagline, recommend 2 'Capture, own, compound your memory.' on banners and zenod.dev); run the promote (D28) that takes bfef1a08 or later to production, check zenod.dev/favicon.svg shows the heavy Z, add the production sha to the evidence, then set review with cards/E25-S1.md. On Jordi's pick: a ticket worker puts it on zenod.dev if he chose that, and the social team gets the banner file. followups: started E10-S8 in zenod-social (channel avatars and banners from the new Z, desk note sent); start tagline on banners and site — Jordi picks in E25-A2; confirm: yes — only Jordi can judge whether the new Z is as strong as he wanted |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-11-10 | accepted | Created as a goal under Foundation | one node in the epic log | EPIC-0-FOUNDATION-SPINE.md | never |
| 2026-11-10 | accepted | epic “Landing: literals kept forever, a living graph, your data stays yours” ready on Jordi's ask (L-37, Team desk: "🎙 Voice note (WhatsApp → Zenod), 2026-11-10 03:54Z Zenod: Log/2026-11-10.md#^e-ecf0b8 I think there is this diagram in ") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-10 | accepted | Planned from Jordi's voice note (WhatsApp 2026-11-10 03:54Z, Zenod Log 2026-11-10 ^e-ecf0b8); ready on his ask (L-37) | G1 builds the sections live, he judges the page | his voice note | when G1 is in review |
| 2026-11-10 | accepted | G1: five moves after the hero; move 5 replaces the old MCP path figure (same #mcp anchor); WhatsApp drawn one way in (root L-6); Codex named after an OAuth connect check | one section of five moves, no new routes | [evidence](evidence/e25-g1-2026-11-10.md) | on Jordi's verdict |
| 2026-11-11 | accepted | E25-S1 ready on Jordi's ask (L-37, Team desk: "I need another social kit for Z-NOT for some reason you gave me the... an icon for this Z that is worse than a lot of th") | Jordi's ask is his ready stamp: the Delivery manager's next wake works it | console commit | — |
| 2026-11-11 | attempted | E25-S1: the heavy Z (parchment Z on the ink tile, bars a fifth of its height like the T and E marks, upright) replaced the thin Newsreader Z for site, app and listing icon; three taglines on X banner mocks | Merged #1620 bfef1a08, on staging; production waits on the D28 promote. Landing tagline unchanged until Jordi picks A, B or C (recommend A). The social team (E10-S8) makes each channel's avatar and banner from these files | [evidence](evidence/e25-s1-2026-11-11.md) | after the promote: set review; on Jordi's tagline pick |
| 2026-11-11 | attempted | E25-S1 round 2: Jordi answered E25-A1 "Organize, own, compound your memory - play with sentencer like that"; six taglines in that pattern shown as the zenod.dev hero and on the X banner, computer and phone | Recommend 2 "Capture, own, compound your memory." on banners and zenod.dev; his own line is option 1. Nothing deployed; row stays active until the promote and his pick (ask E25-A2 for the Delivery manager to post) | [evidence](evidence/e25-s1-2026-11-11.md) ; [page](http://vps3.taild81fbb.ts.net:8921/e25-s1/) | on Jordi's E25-A2 pick |
| 2026-11-11 | revised | Jordi answered E25-A1 (commit 975624f7): "Organize, own, compound your memory - play with sentencer like that" — none of A, B, C; he wants lines in that pattern | E25-S1 round 2 (run_be9b412a): five to eight options in his pattern on the same banner and hero mocks, back as new ask E25-A2 | his answer | round 2 result |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
