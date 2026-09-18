# Zenod soft-editorial v2 — slide pattern

This deck is a deterministic HTML/SVG iteration of the approved
`soft-editorial` concept. It is intentionally **not** another opaque
image-generation pass: every slide is source-controlled, editable, and
renderable to PNG with the same command.

## Shared visual grammar

- Canvas: 1678 × 937 (16:9), near-black `#080d0f`.
- Navigation: tiny `ZENOD` wordmark at left; sparse secondary nav at right.
- Eyebrow: cyan uppercase micro-label, 12–13 px, letter-spacing `.16em`.
- Headline: 58–78 px, weight 750–850, tight tracking, white with one or two
  accent fragments. Never let the headline compete with the diagram.
- Subtitle: 19–24 px, muted cool grey, maximum two lines.
- Accent colors: cyan `#83e5ed` for paths, source links and active memory;
  lime `#baff58` for what Zenod does and for primary actions.
- Surface: cool white `#f5f7f5`, soft graphite `#9aa7ab`, hairline
  `rgba(255,255,255,.14)`.
- Illustration: restrained SVG/vector line work. Classical architectural
  traces live at the margins. The librarian is a calm, dignified line-art
  figure, never a photoreal statue or a cartoon.
- Diagram rule: one dominant visual idea per slide. Use labelled arrows,
  few words, and generous negative space. No fake terminal dumps, no
  invented URLs, dates, prices or integration claims.
- Every slide carries `Conceptual workflow` in the bottom-right when it
  depicts a workflow or product capability.

## Reusable page shell

Every slide file is a standalone HTML document with the same composition:

1. `header` — wordmark and secondary navigation.
2. `main` — eyebrow, `h1`, subtitle, diagram stage.
3. `footer` — optional note and the conceptual-workflow marker.

The diagram stage is the only part that should differ substantially between
slides. Reuse `.panel`, `.node`, `.arrow`, `.source-chip`, `.agent-chip`,
`.memory-boundary`, `.librarian`, `.eyebrow`, `.stage` and `.legend`.

## Slide assignments

| Slide | Story job | Dominant pattern |
|---|---|---|
| 01 | Ownership and gatekeeper | three-column ownership boundary |
| 02 | Capture → memory → agent | left-to-right journey |
| 03 | Cultivate context | inverted value pyramid |
| 04 | Keep originals, connect meaning | two-layer evidence diagram |
| 05 | Ask the librarian | question → cited source |
| 06 | MCP gateway for every agent | hub-and-spoke, bidirectional |
| 07 | Replace the librarian | timeline / future custodians |
| 08 | Where the library lives | two choices + GitHub/Drive |

## Rendering

From `docs/planning/zenod-story-diagrams/soft-editorial-v2`:

```sh
./render-slides.sh
```

The script renders each `slides/*.html` file into a sibling `.png` at the
canonical 1678 × 937 deck size. Keep the HTML as the source of truth.
