> Historical design exploration, retained at Jordi’s request to merge all task work. Not the current landing page. The implemented site is `apps/site`; current evidence is [landing integration](../../evidence/landing-story-integration/README.md).

> Superseded preview: see [Revision 2](REVISION-2.md). The current index shows only the revised first section. Earlier validation below describes the rejected first version.

# Two-section landing preview

2026-09-22. User-authorized design checkpoint only; do not extend or publish before visual approval.

- Preview: `index.html` (serve this directory with `python3 -m http.server 4318 --bind 127.0.0.1`).
- Isolated branch: `codex/landing-two-section-preview`, base `99f9f228285053d1354474b089691d86fe090fef`.
- Scope: ownership overview and capture journey. No production application, pricing, auth or deployment changes.
- Sources inspected: ZLS spine; existing site hero; `01-ownership-v5.png`; `next/02-capture-journey.png`; prior `landing-assets/02-capture-journey.png`; `overview-story.md`.
- Method: adapt approved story and colors; BUILD native responsive HTML because prior diagram asset still contains rasterized labels. New text-free transparent librarian generated using built-in image generation, not CLI. All copy, labels, pills, connectors, and illustrative chat are HTML/CSS.
- Intentionally illustrative: chat is not a product screenshot; named-agent copy is conceptual and still needs capability verification before publication. No changed commercial offer.
- Browser checks: desktop and narrow mobile render, image loads, exactly two sections, anchor navigation works, no document horizontal overflow at observed 1333px and 361px CSS viewport widths. Full production SHIP journey is not claimed.
- Next: Jordi reviews composition and narrative before app integration or additional sections.

## Final illustration prompt

Use case: illustration-story. Create an illustration-only website asset using the attached image as STYLE reference, not as a layout to reproduce. A single older classical Greek librarian, curly hair and beard, draped robes, holding a scroll in one hand and presenting with the other. Waist-up portrait, full hands visible, centered, facing slightly right. Match the cool ivory and pale grey softly shaded engraved editorial illustration of the central librarian in the reference; elegant detailed lines, not photoreal stone, not cartoon. Genuine transparent background. No text whatsoever, no letters, no labels, no logos, no diagram, no arrows, no border, no website UI, no background architecture. Only the isolated librarian with softly fading lower robe edge. This will sit alongside independently rendered HTML typography and diagrams on a near-black website.
