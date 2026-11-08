# Paper deck starter kit

Copy this folder to make a deck or a one-page site in the paper deck style (spec: [../DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md); worked example: the Zenod product deck, [../vision-deck.html](../vision-deck.html)).

- `index.html`: eight slides, one of each pattern: cover, four-verb spine, split with a chat scene, a node joining a graph, retrieval lighting up with strengths, a ruled table, price cards, the closing band.
- `paper.css`: the tokens (top of the file) and every pattern. A brand changes only the tokens.
- `scenes.js`: the animation timeline, no dependencies. Put `data-len` on a `.scene` and `data-at` on its steps; the comment at the top lists every attribute.

To use it: open `index.html` in a browser (any static server works, e.g. `python3 -m http.server`), replace the words, delete what you do not need, keep one idea per slide. Add `?still` to the URL for final frames (for screenshots and reviews); reduced motion gets the same.

Fonts: Newsreader and Instrument Sans (OFL) from Google Fonts; self-host them for production.
