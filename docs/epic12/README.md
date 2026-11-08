# EPIC-12 vision deck (P1)

The plan deck for [EPIC-12](../zenod-app-chat-first-memory-graph-retrie.md), served tailnet-only at http://vps3.taild81fbb.ts.net:8912/ (user unit `zenod-e12-deck.service` on VPS3, serving `/home/t3agent/artifacts/e12-p1-deck/`).

- `vision-deck.html`: the built page (a copy of what is served).
- `template.html` + `build.py`: the source. `python3 build.py <out.html> template.html` writes the page; the demo graph, the lit-up graph, the results list and the digestion flow are generated into it as static SVG/HTML (no script needed to read it).
- `shoot.mjs`: per-slide screenshots through the local headless Chromium (`node shoot.mjs <url> <outdir> 1440 900`; add `?still` to the URL for each animation's final frame).
- `record.mjs`: frames of one animated scene for a GIF (`node record.mjs <url> <selector> <outdir> <ms>`, then ffmpeg).

Round 2 (after E12-A1) leads with Jordi's positioning and the live product: `shots/` holds the real product screens with demo content (copied from `apps/site/src/assets/shots/`) and the live zenod.dev hero; `build.py` copies them beside the built page. All memories, names and scores in the mockups are invented demo data. Evidence: [epic12-p1-2026-11-07](../evidence/epic12-p1-2026-11-07.md).

Round 3 (after E12-A2, "this is the product deck"): three looping scenes in CSS and a small script (WhatsApp replies in production wording, a memory joining the graph, retrieval lighting up with strengths), plus ownership and pricing slides; `shots/history.webp` is the live commit-history screen from `apps/site`.

To update (E12-5, S5): edit `template.html`, rebuild into the served directory and into `vision-deck.html`, re-shoot, commit.

Round 4 (after E12-A4, "pricing at the end", "promote this design style"): the pricing slide moved to slide 14, just before the closing ask; nothing else changed. The style is written down as a reusable spec, [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md), with a copyable starter in [design-kit/](design-kit/) and its images in `design-language/` (`specimen.html` is the source of the palette and type images).
