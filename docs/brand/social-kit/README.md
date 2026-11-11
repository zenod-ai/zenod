# Zenod social kit

The one source for every Zenod profile picture and banner (E25-S1 round 3, Jordi 2026-11-11: "unified social kit URL ... all have it in one place, to create all future assets and iterations").

Live: http://vps3.taild81fbb.ts.net:8921/zenod-social-kit/ (served straight from this folder on the main checkout).

- `src/zenod-avatar.svg`: the Z (Newsreader 500 glyph, ink on paper).
- `src/banner.html`: one banner template, `?p=x|youtube|linkedin`.
- `render.mjs`: renders `assets/` at exact platform sizes and `previews/` (each profile as its platform lays it out). Stops if a font did not load. Run: `PW=~/github/agent_team/browser/node_modules/playwright node render.mjs previews` from this folder.
- `fonts/`: Newsreader and Instrument Sans, OFL.

A new asset or version: change `src/`, render, add a line to the Versions table in `index.html`.
