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
Pinned base: b0d0c27268e82723a544c96d840202d339f3c3ef; no rebases until the SHIP journey passes

## Current State

Owner: /root landing-story delivery manager
Status: review — illustration-only HTML section pass
Last attempted: replaced the post-hero landing chapters with the storyboard order 01–10 as native HTML sections and a real responsive layout
Result: the hero is preserved; every following chapter has native copy and a code-native diagram or illustration panel; the librarian image is a single illustration-only asset, not a full slide; the current pricing section is reused for chapter 08 without changing the public offer.
Evidence: `912c5f4`; [PR #1359](https://github.com/zenod-ai/zenod/pull/1359); `apps/site/src/components/story-flow.tsx`; `apps/site/src/components/story-flow.css`; `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` passing
Waiting on: visual review of the normal responsive section 01; production deployment remains a separate named gate
Approved work: regenerate illustration/background assets with the same image model, then render normal responsive HTML sections with the existing landing typography and spacing
Next action: review section 01 on the local preview, then integrate the parallel 02–10 batches; do not deploy
Source revision: `912c5f4` on `codex/zls-html-sections`, based on `f2fb7af`
Verified at: 2026-09-18 16:52 Europe/Paris

## Mission

Turn the approved Zenod story narrative into a responsive, visually consistent landing-page journey, including the two new slides and the requested retouches, without losing the existing soft-editorial identity or publishing unapproved offer claims.

## Non-Goals

- Do not change memory, retrieval, MCP, billing, account, or deployment behavior outside the public landing page.
- Do not deploy unrelated services.
- Do not treat the generated concept images as product screenshots or integration proof.
- Do not embed full slide images or reproduce baked-in slide text as landing content.
- Do not publish a changed hosted price until the exact public price, currency, VAT treatment, and legal copy are reconciled.

## Definition Of Done

SHIP

Manager execution contract: `/root` personally executes each numbered browser step, stops at the first failure, dispatches a scoped fix, reprepares the candidate, and restarts at step 1 until one uninterrupted clean pass. The test package handoff records the exact commit, named environment, live URL, per-step browser screenshots, and remaining limits so Jordi can reproduce the same journey.

- [ ] 1. KEEP the existing hero unchanged as the page opening.
- [ ] 2. BUILD the post-hero landing as ten narrative chapters in storyboard order 01–10, matching the deck’s sequence without copying slide chrome or page layouts.
- [ ] 3. BUILD every heading, label, paragraph, diagram node, and CTA as native HTML text and accessible markup.
- [ ] 4. BUILD chapter illustrations and diagrams from illustration-only assets or code-native diagram primitives. Do not embed full slide images or slide text.
- [ ] 5. COVER chapters 01–08 with ownership, capture, cultivation, grounding, recall, agent/MCP, custodians, and run-it-your-way.
- [ ] 6. COVER chapters 09–10 with the Zenodotus/Alexandria origin and the closing Library of Alexandria invitation.
- [ ] 7. PRESERVE the current public offer and storage truths in chapter 08; no changed price, currency, VAT, signup, or hosting claim may publish without the human gate.
- [ ] 8. VERIFY desktop, tablet, and mobile rendering with no horizontal overflow, clipped copy, failed assets, or broken CTAs.
- [ ] 9. RECORD the exact source SHA and live URL only after an authorized deployment.

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
| [#1344](https://github.com/zenod-ai/zenod/issues/1344) | Ticket worker | /root | Integrate ten-slide story into landing page | blocked | #1340, #1341, #1342, #1343 | [#1339](https://github.com/zenod-ai/zenod/pull/1339) | 33cb9d6 | story shell merged; image revisions under review | 2026-09-18 15:55 Europe/Paris | integrate accepted revisions after review and pricing decision |
| [#1343](https://github.com/zenod-ai/zenod/issues/1343) | Planner | /root | Reconcile public offer and ownership copy | blocked | none | docs/EPIC-ZENOD-LANDING-STORY.md | b0d0c27 | issue created | 2026-09-18 15:00 Europe/Paris | receive exact price and copy decision |
| [PR #1359](https://github.com/zenod-ai/zenod/pull/1359) | Epic worker | /root landing-story delivery manager | Landing story sections as native HTML | review | - | `codex/zls-html-sections` | `f2fb7af` | Section 01 regenerated with `google/gemini-3-pro-image` and a text-free illustration layer; Apple Vision OCR found no remaining words; typecheck, lint, 12 tests and production build pass | 2026-09-18 17:34 Europe/Paris | human review of section 01; then apply the same asset-and-overlay pattern to slides 02–10; no deployment |

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-09-18 | accepted | Use image generation with `01-ownership-v5.png` as the identity reference | Preserves the approved soft-editorial typography and illustration language better than a hand-coded HTML/CSS rebuild | User feedback in this thread | If a future model cannot preserve the identity |
| 2026-09-18 | accepted | Integrate the story as a responsive landing-page sequence rather than a separate deck-only page | The user asked for the content to be promoted into the landing page | User request | If the page becomes too long or slows down materially |
| 2026-09-18 | accepted | Keep the current public offer authoritative until pricing/legal copy is reconciled | The proposed $3 hosted price conflicts with the live €9/month + VAT offer and legal copy | User feedback plus public offer tests and legal pages | When Jordi supplies the final price/legal treatment |
| 2026-09-18 | accepted | Add slide 09 before the pricing chapter and slide 10 after it | The user requested the librarian story and a closing library invitation in the narrative | User feedback | If narrative testing shows a better position |
| 2026-09-18 | accepted | Revert the story-deck landing integration | Full-slide images are not the desired landing implementation. Future sections should use real HTML text plus illustration-only assets in the hero visual language. | User request; revert of PR #1339 | If Jordi approves a new section-by-section HTML direction |
| 2026-09-18 | accepted | Build the post-hero landing as slides 01–10 translated into native HTML sections with illustration-only assets and code-native diagrams | The deck is the narrative and visual reference, not the shipping asset. The actual page owns its text, accessibility, responsive behavior, links, and offer truth. | User direction in this thread; `codex/zls-html-sections` first pass | If the illustrative density or section rhythm needs a different treatment |
| 2026-09-18 | accepted | Treat each slide as a brief for a normal responsive web section, not as a slide to reproduce | The user clarified that the slide represents a section. Keep normal landing-page section title/subtitle typography and spacing; use the slide only to generate illustration/background assets, then lay out the content below in a responsive web section. Do not create fixed 16:9 slide canvases or slide-positioned copy. | User clarification in this thread; section-01 revision | If the page needs a different section-level composition |
