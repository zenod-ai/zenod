# ZLS canonical retouch handoff — issue #1342

Status: review
Supersedes: PR #1350 (`codex/zls-slide-retouches`), retained for history
Branch: `codex/zls-slide-retouches-canonical`
Base commit: `b0d0c27268e82723a544c96d840202d339f3c3ef`
Canonical style reference: `reference/website-soft-editorial-openai.png`
Canonical librarian crop: `reference/canonical-librarian-crop.png`
Generation model: `google/gemini-3-pro-image`
Output: 16:9, 2K, PNG (`2752 x 1536`)

## Final assets

| Slide | Final file | SHA-256 | Notes |
|---|---|---|---|
| 02 | `02-capture-journey-canonical-final.png` | `27f889a1c864c2414245e6ad821aef7e7a64188f2df453f7594d16d8fca6b42c` | Canonical style pass; all labels and flow verified. The librarian remains a full-body seated figure rather than the canonical waist-up bust. |
| 05 | `05-recall-canonical-final.png` | `4bb16e0ce16b73883fffada678536a49d7f0f61a508808dc018567590391481c` | Canonical style plus exact bust pass; question, grounded answer, one source label, Grounded by facts, and read path verified. |
| 06 | `06-agent-mcp-canonical-final.png` | `7b978af4196fe90198e7ca254b1ef592584aebf7f13bf28f16699b40ba8203b0` | Canonical style pass with corrected arrows; missing context line added deterministically after generation. |
| 07 | `07-custodians-canonical-final.png` | `e2003ac91b6a643cc1c30b808a4f4e4f87afc2dd924396a1f258451d04aed9d8` | Canonical style plus bust pass; timeline, unchanged originals, Meaning today, Meaning rebuilt, and future-custodian treatment verified. |

## Prompts

- Slide 02: `prompts/02-capture-journey-canonical-v3.txt`
- Slide 05: `prompts/05-recall-canonical-v2.txt`
- Slide 06: `prompts/06-agent-mcp-canonical-v2.txt` (the final context line was added after generation with a deterministic text overlay)
- Slide 07: `prompts/07-custodians-canonical-v2.txt`

## Changes made

- **Slide 02:** re-rendered the capture journey in the canonical soft-editorial identity. Kept WhatsApp voice note -> Zenod -> Google Drive + Obsidian preserved artifacts -> MCP -> Codex/Claude/Grok Bot/Other agents. All required labels and the flow are present.
- **Slide 05:** re-rendered the recall slide in the canonical identity and replaced the librarian with the canonical bust reference. Removed duplicate source-label artifacts. The question, grounded answer, source link, Grounded by facts note, and read path are legible.
- **Slide 06:** re-rendered the radial agent/MCP diagram in the canonical identity. Preserved the distinct library and gateway, colorful Google Drive mark, Codex/Claude/Grok Bot labels, and corrected Retrieve/Write semantics. Added the missing `Everyone contributes to your context.` line after generation.
- **Slide 07:** re-rendered the custodians timeline in the canonical identity and replaced the Zenod custodian with the canonical bust. Kept the future custodian abstract, preserved the timeline, and corrected `Meaning rebuilt`.
- **Slide 08:** intentionally not generated. It remains blocked on the exact public price/currency/VAT and legal copy decision in issue #1343.

## Generation cost

Canonical-pass model spend was approximately **$1.380008**:

- Slide 02: $0.414242 across three passes
- Slide 05: $0.276182 across two passes
- Slide 06: $0.414202 across three passes
- Slide 07: $0.275382 across two passes

These are generation costs only. Vision-model QA calls and deterministic text cleanup are excluded.

## Verification performed

- All final images are PNG, 16:9, and `2752 x 1536`.
- Canonical reference and librarian crop are stored under `next/reference/` for reproducibility.
- OCR and vision QA checked required labels, flow, duplicate labels, and the main illustration identity.
- Slide 05 final: canonical bust style confirmed, no duplicate `Original voice note`.
- Slide 06 final: correct arrow semantics confirmed on the canonical v2 base; context line confirmed visible and non-overlapping after the deterministic addition.
- Slide 07 final: identity, librarian bust style, timeline, `Meaning rebuilt`, and abstract future custodian confirmed.
- No app code, landing-page component, spine, or production deployment was changed.

## Residual concerns

- **Slide 02** still uses a full-body seated librarian rather than the canonical waist-up bust. Its overall identity, labels, and flow match, but the figure silhouette is not exact.
- **Slide 06** uses a deterministic text overlay for `Everyone contributes to your context.`; inspect that line at full resolution during integration.
- The canonical reference itself is 1678x937; all delivery images are upscaled to the required 2752x1536 output.
- Slide 08 remains blocked by the pricing/legal decision in #1343.
