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

Owner: Delivery manager (zenod)
Status: active
Last attempted: 2026-11-11 roll-up: G1 done, approved by Jordi 2026-11-10 (the five animated moves live on zenod.dev) ; G2 done, his yes was the G1 approval ; E25-S1 active, iteration 2 running (run_36734018): one social kit page with the earlier Z, clean type and the tagline Own, organize, compound your memory. (his E25-A2 answer 3, banners only) ; E25-S1-M1 ready, the Mac-agent ticket that refreshes the social profiles from that kit
Result: the landing story is live on zenod.dev; the social kit is being rebuilt in one place after Jordi preferred the earlier Z and found typos in the last kit
Evidence: https://zenod.dev/#how-zenod-works ; [evidence](evidence/e25-g1-2026-11-10.md) ; [card](cards/E25-G1.md)
Waiting on: nobody (E25-S1 worker running)
Approved work: none
Next action: E25-S1 kit page to Jordi's review; then E25-S1-M1 on his Mac refreshes the profiles
Source revision: 1f1ebae
Verified at: 2026-11-11T06:00Z (ledger read)

## Non-Goals

- Claims that are not true of production today.

## Waiting on

- [answered E25-A2 2026-11-11 @Jordi · done 2026-11-11 08601954] Which of six new taglines in your pattern goes on the banners? We recommend "Capture, own, compound your memory." — context: you answered E25-A1 with Organize, own, compound your memory and asked to play with lines like that; here are six, yours first, each shown as the zenod.dev hero on a computer and a phone and on the X banner at real size — impact: the social team holds the channel banners until you pick; zenod.dev, its page title and link preview change only if you pick a site too option — risk: none, it is one line of copy and one revert brings back today's line — recommend: 2 on banners and zenod.dev, so both say the same thing; it keeps your rhythm and the word compound, and swaps Organize for Capture because Zenod does the organizing and capturing is the one thing you do — why Jordi: the brand voice is your call — options: 2 on banners and zenod.dev · 2 on banners only · 1 "Organize, own, compound your memory." · 3 "Own, organize, compound your memory." · 4 "Capture, organize, own your memory." · 5 "Speak, file, own your memory." · 6 "Keep, link, own your memory." · none of these — unblocks: zenod-social E10-S8 banners — details: [the six lines](http://vps3.taild81fbb.ts.net:8921/e25-s1/) — answer: 3
- [answered E25-A1 2026-11-11 @Jordi · done 2026-11-11 09a185ea round 2 E25-A2] Which tagline goes on Zenod's social banners: A "Say it once. Every AI remembers.", B "Your words, kept forever. Found when you need them." or C "Think out loud. Ask any AI later."? — context: you asked for a cooler tagline than Hire a librarian for your memory; all three are shown on real-size X banners on a computer and a phone — impact: the social team holds the new banners until you pick; the landing keeps today's line unless you say to change it too — risk: none, each is one line of copy and easy to change back — recommend: A, the shortest, and it names what only Zenod does: one memory that Claude, ChatGPT, Cursor and other AI tools all read — why Jordi: the brand voice is your call — options: A · B · C · none of these — unblocks: zenod-social E10-S8 banners — details: [the three banners](http://vps3.taild81fbb.ts.net:8921/e25-s1/) — answer: Organize, own, compound your memory - play with sentencer like that

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| G1 | Ticket worker | run_f9669997-5116-45b6-b964-5ff1802e78b2 | E25-1: the animated landing sections on zenod.dev, live | done (approved by Jordi 2026-11-10) | none | [#1582](https://github.com/zenod-ai/zenod/pull/1582) merged f8ff11d | main | live https://zenod.dev/#how-zenod-works on 1f1ebae since 2026-11-10 05:22Z ([evidence](evidence/e25-g1-2026-11-10.md), [card](cards/E25-G1.md)) | 2026-11-10T05:24Z | followups: none; confirm: yes — only Jordi can say whether the page now lands the ideas from his voice note (E25-2) |
| G2 | Ticket worker | run_f9669997 (with G1) | E25-2: Jordi says yes to the live page (his verdict on G1's review card) | done (no confirm: Jordi approved G1, the live page, 2026-11-10; G2 was his yes) | G1 | none | main | none | 2026-11-10 | closes when Jordi closes G1's card |
| E25-S1 | Ticket worker | run_36734018-1e72-4481-9165-5518074f7646 — claimed 2026-11-11T05:21Z, lease until 2026-11-11T07:21Z | New Zenod social kit: a bolder Z, a readable banner, a cooler tagline: Redo the Zenod social kit: the Z icon is too thin top and bottom (make it as strong as our better marks); the banner text is barely readable at X size; a cooler tagline than 'Hire a librarian for your memory'; same kit for X, YouTube, Instagram, LinkedIn. | review (iteration 2 delivered 2026-11-11: one social kit page with the earlier Z, Jordi: "I actually prefer the before, but give me the before in the social kit for it ... let's standardize so all have it in one place, to create all future assets and iterations") | none | PR #1630 merged 0e5dd0c1 (the earlier Z back on zenod.dev and the app; staging after publish, production at the next promote) ; kit main 08601954 ; earlier PR #1620 merged bfef1a08 | main | [social kit](http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) ; [evidence](evidence/e25-s1-2026-11-11.md) round 3 ; [card](cards/E25-S1.md) | 2026-11-11T05:45Z kit live at the URL, every image loads and both fonts load; assets at exact sizes in docs/brand/social-kit/assets, real-size shots in docs/evidence/e25-s1-r3/ | followups: started E25-S1-M1 (Jordi's Mac agent puts the kit's picture and banners on X, YouTube, LinkedIn and Instagram); start promote of PR #1630 — the earlier Z reaches zenod.dev only at the Delivery Manager's next promote; park TikTok picture — @zenodmemory is not made yet (agent_team E83-S9); confirm: yes — only Jordi can judge whether the kit and its type look right |
| E25-S1-M1 | Mac agent | Claude on Jordi's Mac (never a server worker) | Refresh the Zenod profiles from the one social kit: the earlier Z as picture and the tagline banner on X @ZenodMemory, YouTube @ZenodMemory, LinkedIn zenodmemory and Instagram @zenodmemory (Jordi 2026-11-11 on E25-S1: "this is a mac desktop task to refresh socials with unified social kit URL") | ready | E25-S1 kit live | main (ticket in this spine) | main | [ticket](http://vps3.taild81fbb.ts.net:9196/t/E25-S1-M1/) ; [kit](http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) | 2026-11-11 | label: needs Mac agent; Jordi runs it from the [Mac list](http://vps3.taild81fbb.ts.net:9196/mac/); its Done or Stuck report files here |

### Laptop ticket E25-S1-M1

Title: Refresh the Zenod profiles from the one social kit
Task: Open the Zenod social kit page and put its profile picture and banner on each Zenod profile below that exists, in Jordi's Chrome. The kit page is the only source: download each file from its button, never from anywhere else.
Minutes: 20
Order: 40
Profile: alpha9.io
Sites:
- http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/
- https://x.com/ZenodMemory
- https://studio.youtube.com/
- https://www.linkedin.com/company/zenodmemory/admin/
- https://www.instagram.com/zenodmemory/
Details:
- Kit: http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/
- X @ZenodMemory: Edit profile, header = Header 1500 x 500, photo = Profile picture 400 x 400
- YouTube @ZenodMemory: YouTube Studio, Customization, Branding: banner = Banner 2560 x 1440, picture = Profile picture 800 x 800 (the channel sits under Jordi's jordi@alpha9.io Google login; if no Zenod channel shows there, skip it and say so)
- LinkedIn page zenodmemory: Edit page, logo = Logo 400 x 400, cover = Cover 1128 x 191
- Instagram @zenodmemory: Edit profile, picture = Profile picture 1080 x 1080 (Instagram has no banner)
- TikTok @zenodmemory is not made yet: skip it
- When a site crops: keep the whole Z inside the circle, and keep every word of the banner visible
Done looks like:
- Each listed profile shows the Z picture on paper and, where the platform has one, the banner reading Own, organize, compound your memory.
- The report lists each profile address with done or skipped and why.
By hand:
- The file picker for each upload: download the files from the kit first, then tell Jordi which file goes where.
- Any sign-in, code or confirmation the site asks for.
Never also:
- Never change a name, handle, bio or link, never post, follow or message.
- Never touch any other account in this Chrome.

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
| 2026-11-11 | accepted | E25-A2 answered by Jordi: "3", the tagline "Own, organize, compound your memory." goes on the banners only (option 3, not the site); with his E25-S1 iteration 2 feedback ("I actually prefer the before ... bad banner typo bad logo typo ... a mac desktop task to refresh socials with unified social kit URL ... standardize so all have it in one place") the next E25-S1 round makes one social kit page with the earlier Z, clean type and this line, then a Mac-agent ticket to refresh the profiles | E25-S1 | docs/landing-literals-kept-forever-a-living-g.md | the kit page is live |
| 2026-11-11 | attempted | E25-S1 round 3: one Zenod social kit page, http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/, the single source for every profile picture and banner; the earlier Newsreader Z back (site and app in PR #1630, merged 0e5dd0c1); X, YouTube and LinkedIn banners with "Own, organize, compound your memory." rendered in the real fonts at exact sizes | Jordi's iteration 2 feedback and his E25-A2 answer 3; profile uploads are Mac-agent row E25-S1-M1; zenod-social told by desk note that the kit is the one source | [evidence](evidence/e25-s1-2026-11-11.md) ; [kit](http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) | Jordi's verdict on the card |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
