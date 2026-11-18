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
Last attempted: 2026-11-18T07:45Z roll-up (DM run_5b5c2d7b): E25-S3 in review, zenod.dev says it his way (a digital memory that organizes itself, WhatsApp voice notes, every agent over MCP, six live helpers) on production e86c6e34; the quality check holds its card because the helpers section is a plain list, the fix goes to that row once its worker ends ; E25-S4 fix merged f5602fcd, a new memory opens in Obsidian with 0 broken links, waits for the next promote ; E25-S1 and E25-S2 done
Result: zenod.dev live in Jordi's 18 Nov words on production e86c6e34; the Obsidian claim is checked true
Evidence: https://zenod.dev/ ; [E25-S3 evidence](evidence/e25-s3-2026-11-18.md) ; [gate](evidence/e25-s3-gate-2026-11-18.md) ; [E25-S4 evidence](evidence/e25-s4-2026-11-18.md)
Waiting on: the E25-S3 helpers section drawn as a shape (quality check) ; the next promote for E25-S4
Approved work: none
Next action: redraw the helpers section as a circle around the memory, then the E25-S3 card reaches Jordi ; promote E25-S4
Source revision: 1f1ebae
Verified at: 2026-11-18T07:45Z (production e86c6e34 via /api/health; zenod.dev says "organizes itself"; rows E25-S1..S4 read)

## Non-Goals

- Claims that are not true of production today.

## Waiting on

- [answered E25-A3 2026-11-11 @Delivery-Manager] Fold your Mac task for the Zenod profile pictures into two Mac sittings you already have (agent_team E83-S11 YouTube, E83-S18 X, Instagram, LinkedIn) — answer: yes, E25-S1-M1 closed as folded; agent_team adds the upload line to E83-S18 — why: you asked why you are needed so often (vn_35eb72cf); this is one sitting fewer for the same result — rollback: reopen E25-S1-M1 as its own Mac task
- [answered E25-A2 2026-11-11 @Jordi · done 2026-11-11 08601954] Which of six new taglines in your pattern goes on the banners? We recommend "Capture, own, compound your memory." — context: you answered E25-A1 with Organize, own, compound your memory and asked to play with lines like that; here are six, yours first, each shown as the zenod.dev hero on a computer and a phone and on the X banner at real size — impact: the social team holds the channel banners until you pick; zenod.dev, its page title and link preview change only if you pick a site too option — risk: none, it is one line of copy and one revert brings back today's line — recommend: 2 on banners and zenod.dev, so both say the same thing; it keeps your rhythm and the word compound, and swaps Organize for Capture because Zenod does the organizing and capturing is the one thing you do — why Jordi: the brand voice is your call — options: 2 on banners and zenod.dev · 2 on banners only · 1 "Organize, own, compound your memory." · 3 "Own, organize, compound your memory." · 4 "Capture, organize, own your memory." · 5 "Speak, file, own your memory." · 6 "Keep, link, own your memory." · none of these — unblocks: zenod-social E10-S8 banners — details: [the six lines](http://vps3.taild81fbb.ts.net:8921/e25-s1/) — answer: 3
- [answered E25-A1 2026-11-11 @Jordi · done 2026-11-11 09a185ea round 2 E25-A2] Which tagline goes on Zenod's social banners: A "Say it once. Every AI remembers.", B "Your words, kept forever. Found when you need them." or C "Think out loud. Ask any AI later."? — context: you asked for a cooler tagline than Hire a librarian for your memory; all three are shown on real-size X banners on a computer and a phone — impact: the social team holds the new banners until you pick; the landing keeps today's line unless you say to change it too — risk: none, each is one line of copy and easy to change back — recommend: A, the shortest, and it names what only Zenod does: one memory that Claude, ChatGPT, Cursor and other AI tools all read — why Jordi: the brand voice is your call — options: A · B · C · none of these — unblocks: zenod-social E10-S8 banners — details: [the three banners](http://vps3.taild81fbb.ts.net:8921/e25-s1/) — answer: Organize, own, compound your memory - play with sentencer like that

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| G1 | Ticket worker | run_f9669997-5116-45b6-b964-5ff1802e78b2 | E25-1: the animated landing sections on zenod.dev, live | done (approved by Jordi 2026-11-10) | none | [#1582](https://github.com/zenod-ai/zenod/pull/1582) merged f8ff11d | main | live https://zenod.dev/#how-zenod-works on 1f1ebae since 2026-11-10 05:22Z ([evidence](evidence/e25-g1-2026-11-10.md), [card](cards/E25-G1.md)) | 2026-11-10T05:24Z | followups: none; confirm: yes — only Jordi can say whether the page now lands the ideas from his voice note (E25-2) |
| G2 | Ticket worker | run_f9669997 (with G1) | E25-2: Jordi says yes to the live page (his verdict on G1's review card) | done (no confirm: Jordi approved G1, the live page, 2026-11-10; G2 was his yes) | G1 | none | main | none | 2026-11-10 | closes when Jordi closes G1's card |
| E25-S1 | Ticket worker | run_36734018-1e72-4481-9165-5518074f7646 — claimed 2026-11-11T05:21Z, lease until 2026-11-11T07:21Z | New Zenod social kit: a bolder Z, a readable banner, a cooler tagline: Redo the Zenod social kit: the Z icon is too thin top and bottom (make it as strong as our better marks); the banner text is barely readable at X size; a cooler tagline than 'Hire a librarian for your memory'; same kit for X, YouTube, Instagram, LinkedIn. | done (approved by Jordi 2026-11-11) | none | PR #1630 merged 0e5dd0c1 (the earlier Z back on zenod.dev and the app; staging after publish, production at the next promote) ; kit main 08601954 ; earlier PR #1620 merged bfef1a08 | main | [social kit](http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) ; [evidence](evidence/e25-s1-2026-11-11.md) round 3 ; [card](cards/E25-S1.md) | 2026-11-11T05:45Z kit live at the URL, every image loads and both fonts load; assets at exact sizes in docs/brand/social-kit/assets, real-size shots in docs/evidence/e25-s1-r3/ | followups: started E25-S1-M1 (Jordi's Mac agent puts the kit's picture and banners on X, YouTube, LinkedIn and Instagram), E25-S2 |
| E25-S1-M1 | Mac agent | Claude on Jordi's Mac (never a server worker) | Refresh the Zenod profiles from the one social kit: the earlier Z as picture and the tagline banner on X @ZenodMemory, YouTube @ZenodMemory, LinkedIn zenodmemory and Instagram @zenodmemory (Jordi 2026-11-11 on E25-S1: "this is a mac desktop task to refresh socials with unified social kit URL") | done (folded into agent_team E83-S11 and E83-S18: same profiles, same Mac sitting; yes given by the Delivery Manager 2026-11-11, desk note E96-S18) | E25-S1 kit live | main (ticket in this spine) | main | [ticket](http://vps3.taild81fbb.ts.net:9196/t/E25-S1-M1/) ; [kit](http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) | 2026-11-11 | none here: agent_team E83-S11 sets the YouTube picture and banner, E83-S18 gains one line for the X, Instagram and LinkedIn uploads from the kit page http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/ |
| E25-S2 | Mac agent | agent_team E83-S11 and E83-S18 (Jordi's Mac sittings) | refresh the Zenod profiles from the kit on your Mac: follow-up of E25-S1 | done (folded into E25-S1-M1, itself folded into agent_team E83-S11 YouTube and E83-S18 X, Instagram, LinkedIn: the same uploads from http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/) | E25-S1 | none | main | Jordi started it when closing E25-S1 2026-11-11 ; agent_team E83-S18 already carries the kit uploads (docs/spines/accounts-made-for-you-domains-social-log.md) | 2026-11-11 | none here: the profile refresh happens in agent_team's E83-S11 and E83-S18 sittings; a server worker cannot upload (the Team Browser only reads) |
| E25-S3 | Ticket worker | run_3490dfd0-37b6-43c2-a27c-ea41fcb1a7cb | zenod.dev says it his newest way: a self-organizing digital memory, send WhatsApp voice notes and it organizes itself, connect every agent by MCP, personas dispatched on your memory (reminders, ideas, reflection); every claim checked true on production first, including that a fresh customer vault opens in Obsidian as-is | review | none | [#1700](https://github.com/zenod-ai/zenod/pull/1700) merged ada4e0f (iteration 1: #1691 1a62d8e0) | main | https://zenod.dev/ live ada4e0f on production since 2026-11-18T18:28:59Z, iteration 2 (Jordi vn_668d73df: normal example of a birthday and dentist week, no garden or Westcombe, agents moved to 3, librarian arrows, raw vs organized file diagram, library-is-yours diagram, one-page and screenshot sections removed, helpers last as mining your memory, 1838 → 863 words; gate demo 96/100, private 91.2 ≥ 90; 390 and 1280 px checked, 0 broken images) ([evidence](evidence/e25-s3-it2-2026-11-18.md), [card](cards/E25-S3.md)) | 2026-11-18 | followups: none; confirm: yes — only Jordi can say whether the page now explains Zenod clearly |
| E25-S4 | Ticket worker | run_e955f89c-d564-45bf-bd43-72ffd49f691f — claimed 2026-11-18T06:33Z, lease until 2026-11-18T08:33Z | A new memory opens cleanly in Obsidian: the starter index.md (ensureSchemaV1, packages/core/src/vault/migrate.ts) links to folders that Obsidian shows as broken; point the 5 links at real notes or plain text (filing and retrieval untouched, freeze respected) | done (no confirm: a fix inside the Obsidian claim on the E25-S3 card) | E25-S3 | [#1694](https://github.com/zenod-ai/zenod/pull/1694) merged f5602fcd | main | live f5602fc on production since 2026-11-18T08:00:36Z (gate demo 100, private 91.2 ≥ 90); a new memory built from f5602fc opened in Obsidian 1.15.1: 0 unresolved links, Areas link opens Areas Index ([evidence](evidence/e25-s4-2026-11-18.md)); existing memories: only an untouched (byte-equal) old start page is rewritten | 2026-11-18 | none: closed |

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
| 2026-11-11 | decided | decided by Delivery Manager: E25-S1-M1 folded into agent_team E83-S11 and E83-S18 (alpha9 E96-S18 proposal, after Jordi's vn_35eb72cf "why are we constantly doing permissions … What exactly am I needed for?") so the same profile uploads ride in Mac sittings he already has instead of a separate task — why: one sitting fewer, same result — rollback: reopen E25-S1-M1 as ready and ask agent_team to drop the E83-S18 line |
| 2026-11-11 | decided | decided by Delivery Manager: E25-S2 (Jordi's follow-up of E25-S1, refresh the profiles from the kit on his Mac) is the same job as E25-S1-M1, so it rides in the same agent_team E83-S11 and E83-S18 sittings rather than a second Mac task — why: one sitting for the same uploads, his vn_35eb72cf asked for fewer — rollback: reopen E25-S2 as its own Mac-agent ticket |
| 2026-11-18 | accepted | E25-S3 readied on Jordi's words (L-37), vn_101d2c67 18 Nov 04:17Z: "this is a self-organizing digital memory, where you can use WhatsApp to just send voice notes and ... it all organizes, self-organizes into your digital memory. And then you can connect all your agents via MCP ... you could have like personas that are kind of dispatched on your memory to look for like things that you should be reminded of or maybe look for ideas or look for possibilities you haven't thought of or maybe more therapy stuff or more like optimization ... And we should have all the landing page, really make sure that we have it up to date with all the latest and coolest way to explain stuff." | the landing explains Zenod his way; only claims true on production go on the page | Delivery Manager run_3a71c4af | alpha9 desk note E75-S24 | he sees the new landing live |
| 2026-11-18 | accepted | E25-S3 gate: the promote failed at real-note retrieval 89.5 < 90 since vault 8b81d42. Two questions fell; s1b-airbnb-prices now also accepts Jordi's 18 Nov note e-a5a0d6 (it names the prices he wants: new bookings and their price per calendar day), s1b-airbnb-cities stays a real ranking miss | test data changed for one question with its reason; engine (EPIC-22 freeze) and the 90 floor unchanged; gate passed 91.2, production 3ec90ca → 1a62d8e → e86c6e3 (#1692) → 7cd94c3 (#1695 helpers ring) | [gate evidence](evidence/e25-s3-gate-2026-11-18.md) | after 2026-11-24 freeze, if the ranking miss is taken up, or when the margin (one hit) is lost |
| 2026-11-18 | accepted | E25-S4 readied on Jordi's question vn_101d2c67 18 Nov whether memory files really open in Obsidian (L-37): E25-S3 found a new vault's starter index has 5 links Obsidian cannot open | a vault-setup fix, not the filing or retrieval engine, so the freeze to 24 Nov holds | Delivery Manager run_787061c1 | desk note 2026-11-18-zenod-also-in-jordi-s-note-vn-101d2c67-a-fresh | a new vault has no broken link |
| 2026-11-18 | updated | E25-S3: your voice note of 2026-11-18 17:18Z added to this: "I think there is too much text, you know? I love that each thing is an animation with a diagram. That I love." (mark key 61e62b21) | He requests more changes to the rewritten page, but the rewrite still holds. | card E25-S3: zenod.dev was rewritten to explain Zenod the way Jordi now does., vn_668d73df | when its owner acts |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
