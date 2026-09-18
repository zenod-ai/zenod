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
Status: deferred
Last attempted: reverted the responsive story-deck landing integration at Jordi’s request
Result: landing source is restored to the previous version before PR #1339; the story deck and its optimized image assets are removed from `apps/site`. The section-01 prototype PR was closed. Image-only slide PRs remain unmerged for history/review.
Evidence: `codex/revert-landing-story` revert of merge `33cb9d6`; closed PR #1357
Waiting on: new landing direction. Full-slide images should not be embedded directly; the requested direction is real HTML text with illustration-only assets and hero-style composition.
Approved work: preserve the reverted landing; no further landing integration until Jordi approves the new section pattern
Next action: keep the previous landing version live; await direction on whether to pursue the illustration-only HTML section pattern
Source revision: c1b4761 (pre-revert main)
Verified at: 2026-09-18 16:20 Europe/Paris

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

- [ ] 1. PORT from `apps/site/src/components/story-deck.tsx`: the landing page includes the story sequence with slides 01–10 in narrative order.
- [ ] 2. DUPLICATE from `01-ownership-v5.png`: slides 01–08 retain the approved soft-editorial identity, typography, and illustration language.
- [ ] 3. BUILD (no suitable source beyond the current slide image found in recorded scope): slide 02 shows WhatsApp, Zenod, Google Drive, Obsidian, and named agent retrieval with the intended flow.
- [ ] 4. BUILD (image-generation retouch): slide 05 restores the approved font and librarian illustration style.
- [ ] 5. BUILD (image-generation retouch): slide 06 places the library and Zenod gateway distinctly at the center, uses colorful Google Drive and agent marks, and fixes retrieve/write arrow directions.
- [ ] 6. BUILD (image-generation retouch): slide 07 keeps the timeline structure while restoring the approved font and illustration style.
- [ ] 7. BUILD (offer copy and image retouch): slide 08 presents accurate storage and hosting choices, with Telegram on the self-hosted side and Telegram + WhatsApp on the hosted side, using the actual public offer.
- [ ] 8. BUILD (new narrative image): slide 09 tells the Zenodotus/Alexandria story: Zenodotus was the librarian, not the library; he controlled ingestion and created the index at the gate.
- [ ] 9. BUILD (new closing image): slide 10 closes with the invitation to start building a personal Library of Alexandria today and routes to GitHub or the current hosted plan.
- [ ] 10. BUILD (no existing responsive story regression suite found in recorded scope): the live landing page passes desktop, tablet, and mobile browser checks with no horizontal overflow, clipped copy, failed assets, or broken CTAs.
- [ ] 11. PORT from `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`: the exact deployed source SHA and live URL are recorded after authorized deployment.

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

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-09-18 | accepted | Use image generation with `01-ownership-v5.png` as the identity reference | Preserves the approved soft-editorial typography and illustration language better than a hand-coded HTML/CSS rebuild | User feedback in this thread | If a future model cannot preserve the identity |
| 2026-09-18 | accepted | Integrate the story as a responsive landing-page sequence rather than a separate deck-only page | The user asked for the content to be promoted into the landing page | User request | If the page becomes too long or slows down materially |
| 2026-09-18 | accepted | Keep the current public offer authoritative until pricing/legal copy is reconciled | The proposed $3 hosted price conflicts with the live €9/month + VAT offer and legal copy | User feedback plus public offer tests and legal pages | When Jordi supplies the final price/legal treatment |
| 2026-09-18 | accepted | Add slide 09 before the pricing chapter and slide 10 after it | The user requested the librarian story and a closing library invitation in the narrative | User feedback | If narrative testing shows a better position |
| 2026-09-18 | accepted | Revert the story-deck landing integration | Full-slide images are not the desired landing implementation. Future sections should use real HTML text plus illustration-only assets in the hero visual language. | User request; revert of PR #1339 | If Jordi approves a new section-by-section HTML direction |
