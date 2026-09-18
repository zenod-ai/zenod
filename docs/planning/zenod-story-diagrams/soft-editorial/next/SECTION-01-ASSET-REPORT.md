# Section 01 illustration-only asset report

Status: generated and integrated for review
Date: 2026-09-18

## Generation path

- Model: `google/gemini-3-pro-image`
- Helper: `tmp/imagegen/openrouter_generate_slide.py`
- Resolution: 2K
- Aspect ratio: 16:9
- Output: PNG + responsive WebP/JPEG derivatives

This is the same model used for the approved storyboard slide pass. The first attempt still contained residual labels, so a second precise-object-edit pass used the first generated layer as the edit target and removed the remaining typography.

## Reference roles

- Original slide: `docs/planning/zenod-story-diagrams/soft-editorial/next/01-ownership.png` — composition and non-text diagram reference.
- Canonical style: `/tmp/website-soft-editorial-openai.png` — visual identity reference.
- Generated v1: intermediate edit target for the text-removal pass.

## Final prompt

- `docs/planning/zenod-story-diagrams/soft-editorial/next/prompts/01-ownership-illustration-only-v2.txt`

The prompt explicitly preserves the librarian, entry points, account boundary, connected-knowledge/originals layers, cyan connectors, panel geometry and 16:9 composition while removing every word, label, numeral, wordmark and caption.

## Final asset

- Master: `apps/site/src/assets/story/slide-01/ownership-illustration-2752.png`
- Responsive: `ownership-illustration-1280.webp`, `ownership-illustration-640.webp`, `ownership-illustration-1280.jpg`
- SHA-256 master: `1f702dca4df867820e200223a0ffdd4b8ef5296aa1d6b92f81ac57e8e93cc8ea`
- Dimensions: `2752 x 1536`

## Validation

- Apple Vision OCR on the final master found no remaining words.
- The final asset remains 16:9 and source-sized.
- Structural similarity against the original slide is `0.8183` SSIM; differences are expected because the text was removed and the image model reconstructed the underlying illustration.
- The landing section now uses this asset as the visual layer and renders its headings, labels and copy as native HTML.

## Cost

- v1 generation: `$0.137946`
- v2 text-removal pass: `$0.138792`
- Total model cost: `$0.276738`

## Boundary

No deployment. This is a local review candidate.
