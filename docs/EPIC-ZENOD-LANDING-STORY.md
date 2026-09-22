# EPIC ZLS · Zenod landing story

Spine profile: compact
Ticket backend: github
Spine dialect: v2
Acceptance surface: browser
Repository: zenod-ai/zenod
Primary document: docs/EPIC-ZENOD-LANDING-STORY.md
Spine ID: ZLS
Spine Type: branch
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Active steward: /root landing-story delivery manager
Steward since: 2026-09-18 15:00 Europe/Paris
Pinned base: 99f9f228285053d1354474b089691d86fe090fef for the 2026-09-22 local integration; no rebases during this review

## Current State

Owner: /root landing-story integration worker
Status: review
Last attempted: harmonized recall and hosting artwork locally toward the unchanged hero on 2026-09-22; muted ivory/cyan and classical engraving replace bright white/smooth figures
Result: all ten diagram-led chapters and the corrected Hellenic capture/MCP illustration are live at https://zenod.dev/; original hero preserved. No other service deployment or non-SHA environment/mount changes.
Evidence: [production receipt](evidence/landing-story-integration/production.md); CI/image publication pass; 17 site tests and build pass; exact running image/OCI/health and live browser desktop/mobile checks verified
Waiting on: visual review and exact-version deployment approval for the new illustration-only revision; the prior landing remains live
Approved work: Jordi explicitly approved public deployment of exact source c1d8357; no changed price, signup settings, credentials, billing or unrelated-service deployment
Next action: review the [style harmony revision](evidence/landing-story-integration/style-harmony.md) in the local preview; publish only after a new exact-version approval
Source revision: deployed `c1d835774aaccbc3accc764738e47871c23ad107`; PR #1364 merged as `60239a3a51c1577302c7483ed390314b28e76c41`; prior live `99f9f228285053d1354474b089691d86fe090fef`
Verified at: 2026-09-22 03:06 UTC

## Mission

Turn the approved Zenod story narrative into a responsive, visually consistent landing-page journey, including the two new slides and the requested retouches, without losing the existing soft-editorial identity or publishing unapproved offer claims.

## Non-Goals

- Do not change memory, retrieval, MCP, billing, account, or deployment behavior outside the public landing page.
- Do not deploy unrelated services.
- Do not treat the generated concept images as product screenshots or integration proof.
- Do not publish a changed hosted price until the exact public price, currency, VAT treatment, and legal copy are reconciled.

## Definition Of Done

SHIP

Manager execution contract: `/root` personally executes each numbered browser step, stops at the first failure, dispatches a scoped fix, reprepares the candidate, and restarts at step 1 until one uninterrupted clean pass. The test package handoff records the exact commit, named environment, live URL, per-step browser screenshots, and remaining limits so Jordi can reproduce the same journey.

The 2026-09-22 approved contract below supersedes the earlier full-slide integration checklist. Checked steps are verified on the local frontend candidate, not production.

- [x] 1. PORT from the current landing hero: preserve its JSX, artwork, animation helpers and existing CSS exactly.
- [x] 2. BUILD from the approved board diagrams: render all ten chapters below the hero; remove legacy narrative, FAQ and final CTA sections; retain functional footer/legal links.
- [x] 3. BUILD the diagram-only asset treatment: real HTML headings, introductions, captions and CTAs; no full-slide screenshots. Short diagram labels may remain rasterized.
- [x] 4. DUPLICATE the approved ownership diagram visual language across the remaining diagram adaptations; preserve each board’s composition and illustrated objects.
- [x] 5. BUILD corrected MCP arrows, coherent raw/source images, and distinct hosting/storage bands; preserve the current offer with no $3 price in artwork.
- [x] 6. PORT existing pricing/account behavior: preserve €9/month + VAT, signup readiness gating, sign-in routes and /pricing; embed the native plan controls in chapter 08.
- [x] 7. BUILD local browser verification: desktop and mobile chapter walkthroughs, loaded assets, working pricing navigation, no horizontal overflow; 17 tests and production build pass.
- [x] 8. PORT the deployment gate from `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`: deploy only after approval for the exact source SHA, then record production health and live browser evidence.

HARDEN

- [ ] Add alt-text coverage and image-loading budgets for all story assets.
- [ ] Add automated browser regression coverage for the story section.
- [ ] Revisit image-generation model choice and prompt history if future retouches cause identity drift.
- [ ] Add a reusable slide-to-landing asset pipeline if the story deck becomes an ongoing production surface.

## Human Gates

- Human owner: Jordi
- Trigger: publishing a changed hosted price, currency, or VAT treatment
- Exact approval / input required: final public price and legal copy for the hosted offer
- Work that may continue independently: all image generation, landing-page layout work, and staging verification that does not alter the live public offer
- Human owner: Jordi
- Trigger: production deployment after SHIP passes
- Exact approval / input required: authorization for the exact source SHA and public Zenod deployment
- Work that may continue independently: implementation, PR review, CI, and local/browser verification

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| [#1340](https://github.com/zenod-ai/zenod/issues/1340) | Ticket worker | image_a | Produce slide 09 librarian at the gate of Alexandria | review | none | [#1347](https://github.com/zenod-ai/zenod/pull/1347) | b0d0c27 | commit `58a37d3`; 4/5 identity match; slightly lighter background | 2026-09-18 15:55 Europe/Paris | steward review and integration decision |
| [#1341](https://github.com/zenod-ai/zenod/issues/1341) | Ticket worker | image_b | Produce slide 10 start your library today | review | none | [#1346](https://github.com/zenod-ai/zenod/pull/1346) | b0d0c27 | commit `015f5e5`; OCR clean; minor cyan endpoint concern | 2026-09-18 15:55 Europe/Paris | steward review and integration decision |
| [#1342](https://github.com/zenod-ai/zenod/issues/1342) | Ticket worker | image_c | Retouch slides 02, 05, 06, 07 and 08 | review | #1343 for slide 08 | [#1350](https://github.com/zenod-ai/zenod/pull/1350) | b0d0c27 | commit `0f74971`; four retouched PNGs + report; slide 08 held | 2026-09-18 15:55 Europe/Paris | full-resolution review of slides 02/05/06/07 |
| [#1344](https://github.com/zenod-ai/zenod/issues/1344) | Ticket worker | /root landing-story integration worker | Integrate diagram-led story below unchanged hero (PORT board narrative; BUILD diagram-only assets) | testing | user pattern approval received; current offer retained | `codex/landing-two-section-preview` (local, no PR) | 99f9f22 | [handoff](evidence/landing-story-integration/README.md); 17 tests and build pass | 2026-09-22 | visual review, then separate deployment gate |
| [#1343](https://github.com/zenod-ai/zenod/issues/1343) | Planner | /root | Reconcile public offer and ownership copy | blocked | none | docs/EPIC-ZENOD-LANDING-STORY.md | b0d0c27 | issue created | 2026-09-18 15:00 Europe/Paris | receive exact price and copy decision |

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-09-18 | accepted | Use image generation with `01-ownership-v5.png` as the identity reference | Preserves the approved soft-editorial typography and illustration language better than a hand-coded HTML/CSS rebuild | User feedback in this thread | If a future model cannot preserve the identity |
| 2026-09-18 | accepted | Integrate the story as a responsive landing-page sequence rather than a separate deck-only page | The user asked for the content to be promoted into the landing page | User request | If the page becomes too long or slows down materially |
| 2026-09-18 | accepted | Keep the current public offer authoritative until pricing/legal copy is reconciled | The proposed $3 hosted price conflicts with the live €9/month + VAT offer and legal copy | User feedback plus public offer tests and legal pages | When Jordi supplies the final price/legal treatment |
| 2026-09-18 | accepted | Add slide 09 before the pricing chapter and slide 10 after it | The user requested the librarian story and a closing library invitation in the narrative | User feedback | If narrative testing shows a better position |
| 2026-09-18 | accepted | Revert the story-deck landing integration | Full-slide images are not the desired landing implementation. Future sections should use real HTML text plus illustration-only assets in the hero visual language. | User request; revert of PR #1339 | If Jordi approves a new section-by-section HTML direction |
| 2026-09-22 | accepted | Preserve the existing hero exactly; replace only sections below it | Jordi explicitly rejected hero replacement and approved extending the diagram-centered preview to all sections. Large illustrated diagrams closely follow the board; headings/supporting copy/captions/CTAs remain HTML. Internal diagram labels may remain rasterized as in the approved preview. | Current user instructions; local integration evidence | Only on explicit user request |
| 2026-09-22 | accepted | Keep current offer and functional pricing flow | The old $3 storyboard offer is not authority. Diagram 08 has no price; HTML offer remains €9/month + VAT, signup-gated, with existing customer behavior. All ten boards are represented in order 01–07, 09, 08, 10, retaining the approved Alexandria-before-pricing placement. | Current code and public-offer tests | On a new approved pricing decision |
