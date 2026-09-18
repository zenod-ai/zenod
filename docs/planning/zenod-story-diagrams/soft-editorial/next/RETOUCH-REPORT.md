# ZLS retouch handoff — issue #1342

Status: review
Branch: `codex/zls-slide-retouches`
Base commit: `b0d0c27268e82723a544c96d840202d339f3c3ef`
Identity reference: `docs/planning/zenod-story-diagrams/soft-editorial/01-ownership-v5.png`
Generation model: `google/gemini-3-pro-image`
Output: 16:9, 2K, PNG (`2752 x 1536`)

## Final assets

| Slide | Final file | SHA-256 | Generation notes |
|---|---|---|---|
| 02 | `02-capture-journey-retouched-final.png` | `caa71ecf20395d59cb91eebe3bed585f479af65806a2edd01a17a13ae25033ba` | Two-pass generation. Final pass used the first retouch as the edit target plus the v5 identity and a focused v5 librarian crop. |
| 05 | `05-recall-retouched-final.png` | `572fae7fbf008a257fe778459ff8126b2b05abe3ec591c01017f3a085f323e0f` | Two-pass generation plus deterministic cleanup to remove a duplicate `Original voice note` label. |
| 06 | `06-agent-mcp-retouched-final.png` | `086fd6429f714124199a13691c9a09b9d8933b9bdd2df0dd119a5a1770a68641` | One generation pass with the v5 identity plus deterministic text cleanup to correct the Codex `Retrieve`/`Write` labels. The image model would not reliably swap those two labels. |
| 07 | `07-custodians-retouched-final.png` | `eaac1cead449b78d93a838ed944bd8f2a565417476fbc64e3afe366efb7a0d52` | Two-pass generation. Final pass corrected `Meaning rebuilt` and restored the v5 librarian identity. |

Base candidates retained for reproducibility:

- `05-recall-retouched-base.png`
- `06-agent-mcp-retouched-base.png`

## Prompts

- Slide 02: `prompts/02-capture-journey-identity-fix.txt`
- Slide 05: `prompts/05-recall-identity-fix.txt`
- Slide 06: `prompts/06-agent-mcp-retouch.txt`, then `prompts/06-agent-mcp-codex-arrow-swap.txt` for the deterministic label correction
- Slide 07: `prompts/07-custodians-identity-fix.txt`

## Changes made

- **Slide 02:** preserved the left-to-right capture journey and replaced the generic `Agent retrieves` stage with `Codex`, `Claude`, `Grok Bot`, and `Other agents`; kept WhatsApp, Zenod, Google Drive, Obsidian, original voice note, transcript, and MCP visible.
- **Slide 05:** restored the v5 typography and librarian identity, preserved the question -> grounded answer -> original voice note path, and removed a duplicate `Original voice note` label.
- **Slide 06:** kept the library and Zenod MCP gateway distinct, kept the colorful Google Drive mark, preserved Codex/Claude/Grok Bot marks, and corrected the Codex connector semantics so outward gateway -> agent is `Retrieve` and inward agent -> gateway is `Write`.
- **Slide 07:** preserved the left-to-right timeline and unchanged-originals foundation, restored the v5 librarian identity for the Zenod custodian, and corrected `Meaning rebuilt`.
- **Slide 08:** intentionally not generated. It remains blocked on the exact public price/currency/VAT and legal copy decision in issue #1343. The target layout remains Telegram on the self-hosted side and Telegram + WhatsApp on the hosted side, pending that decision.

## Generation cost

Model spend for the four slides was approximately **$1.38 total**:

- Slide 02: $0.276882
- Slide 05: $0.415518 (including one discarded identity variant)
- Slide 06: $0.412706 (including two discarded arrow-corrected variants)
- Slide 07: $0.276634

These are generation costs only. Additional vision-model QA calls were used during review and are not included in the per-slide totals.

## Verification performed

- All final images are PNG, 16:9, and `2752 x 1536`.
- OCR and vision QA confirmed the required content labels were present and the main flow was readable.
- Slide 06 was independently QA-checked after the deterministic fix: the Codex, Claude, and Grok Bot connectors were reported with outward `Retrieve` and inward `Write`, with no black-patch or broken-line artifact.
- Slide 05 was independently QA-checked after cleanup: `Original voice note` appears once.
- Slide 07 was independently checked for `Meaning rebuilt` and the `Zenod is the first custodian, not the last.` sentence.
- No application code, landing-page component, spine, or other slide ticket was changed.

## Residual concerns

- The generated slides are a strong visual-identity pass, but the v5 librarian figure remains model-generated rather than an exact cutout. Manual visual review is still required before integration.
- The deterministic cleanup changes are text-only and should be reviewed at full resolution in the final integration PR.
- Slide 08 remains blocked by the pricing/legal decision and is not part of this handoff.
