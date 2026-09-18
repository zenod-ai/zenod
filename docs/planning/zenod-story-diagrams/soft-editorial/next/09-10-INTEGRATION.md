# Slides 09/10 landing integration handoff

## Added by the 09/10 worker

- `apps/site/src/components/slide-09-10-story.tsx`
- `apps/site/src/components/slide-09-10-story.css`
- `apps/site/src/assets/story/slide-09/librarian-gate-illustration-{640.webp,1280.webp,1280.jpg}`
- `apps/site/src/assets/story/slide-10/library-threshold-illustration-{640.webp,1280.webp,1280.jpg}`
- Prompts: `docs/planning/zenod-story-diagrams/soft-editorial/next/prompts/09-illustration-only-landing.txt` and `10-illustration-only-landing.txt`

The components intentionally preserve the existing section titles, copy, typography, spacing system, and CTAs. Only the illustration layer changes.

## Intended wiring

In `apps/site/src/components/story-flow.tsx`:

1. Import both components:
   `import { SlideNineStorySection, SlideTenStorySection } from "@/components/slide-09-10-story";`
2. Replace the old Alexandria section usage with `<SlideNineStorySection />`.
3. Replace the old closing section implementation with:
   `export function ClosingStorySection() { return <SlideTenStorySection />; }`

When doing this, remove the now-unused legacy `SectionAlexandria`, `ClosingStorySection`, and `LibrarianArt` bodies and their imports (`alexandria`, `zenodPlate`, `librarian640`, `librarian1280`, `ArrowUpRightIcon`, `CloudIcon`). The app uses `noUnusedLocals`; leaving the old bodies in place will fail TypeScript even though Vite can still bundle.

## Asset-generation note

The benchmark path was attempted first with the existing helper and model:

- Helper: `/Users/jordi/Documents/GitHub/zenod/tmp/imagegen/openrouter_generate_slide.py`
- Model: `google/gemini-3-pro-image`
- References: canonical `01-ownership.png`, clean slide-01 illustration, and the 09/10 full-slide references

Both image requests failed before generation with OpenRouter HTTP 402: insufficient credits. To avoid blocking the landing work, the final assets were derived deterministically from the approved full-slide references:

1. Crop the illustration region away from the headline/navigation.
2. Remove the remaining in-image labels and closing copy with `ffmpeg` `delogo` on the near-black background.
3. OCR-verify that the resulting PNG contains no words.
4. Export 1280/640 WebP plus a 1280 JPG fallback.

This produces text-free illustration layers suitable for native HTML overlays. If OpenRouter credits are restored, the prompts above can be rerun for a generative cleanup pass without changing the component contract.
