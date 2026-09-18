# Soft-editorial v2 — production spec
Status: ready for parallel slide production
Base: `docs/planning/zenod-story-diagrams/soft-editorial-v2/`
Source of truth: this spec + `pattern.css` + `PATTERN.md`

## Shared rules

- One standalone HTML file per slide in `slides/`, rendered to a same-name PNG.
- Reuse the shell structure in `slides/_shell.html`; do not copy the old
  raster deck. This pass uses editable vector/HTML layout for exact text and
  consistent identity.
- Do not edit `pattern.css`, `PATTERN.md`, `SPEC.md`, or `render-slides.sh`.
- Use the marks/line-art in `assets/marks.html` and
  `assets/librarian-snippet.html`. Inline them where useful.
- Keep every slide readable at 1678 × 937. The diagram stage is 590 px high.
- The librarian identity is a calm, older, bearded line-art custodian with a
  scroll/papyrus. Reuse the same SVG shape across slides; do not invent a new
  mascot or a photoreal statue.
- Cyan = flow, retrieval, source, active memory. Lime = what Zenod does,
  primary choice/action, and important verbs.
- No invented URLs, dates, fake terminal output or claims. No screenshot
  language unless explicitly asked. Use "Conceptual workflow".
- Keep exact words and headline fragments unless the slide brief says
  otherwise. Headlines are sentence case and may use multiple accent colors.

## Slide briefs

### 01-ownership.html
Eyebrow: `YOUR ACCOUNT STARTS HERE`
Headline: `Your memory.` (white) `Your library.` (cyan) `Your librarian.` (lime), with the three lines visually related.
Subtitle: `Zenod is not your memory. It is the librarian that gatekeeps it, connects it to your agents, and organizes it.`
Pattern: three-column ownership boundary.
Left: multiple entry points, not just one idea. Show a modern phone with an audio waveform and a 5:00 voice note; show named agents `WhatsApp`, `Codex`, `Claude`, `Grok` as compact chips. Add a small “Your entry points” label.
Centre: the librarian, label `ZENOD`, and a large lime callout `Stores · Organizes · Connects`. Small sublabel `24/7 memory gatekeeper`.
Right: `YOUR GOOGLE DRIVE ACCOUNT` boundary containing two clearly separate layers:
  - `ORIGINALS` — raw evidence: voice, image, source page, transcript.
  - `CONNECTED KNOWLEDGE` — Index, Projects, People, Preferences, Open questions.
Use bidirectional cyan connectors between left and librarian, and between librarian and the account boundary. The library belongs to the user; Zenod is outside the ownership boundary.
Bottom note: `This is your Google Drive account.`

### 02-capture.html
Eyebrow: `CAPTURE → MEMORY → AGENT`
Headline: `One contact.` (white) `A living memory.` (cyan)
Subtitle: `Send the voice note while it’s fresh. Zenod keeps the original, connects the meaning, and makes it available to your agents.`
Pattern: left-to-right journey with four zones.
1. Left: modern phone / WhatsApp voice note, waveform and `5:00`.
2. Centre: Zenod librarian, label `ZENOD`, verbs `Store · Transcribe · Organize`.
3. Upper right: `YOUR GOOGLE DRIVE` with `Original audio + transcript`; `YOUR OBSIDIAN BRAIN / GITHUB` with `Connected knowledge`.
4. Lower/right or far right: `Codex` and `Claude` retrieving with a source chip `Original voice note · transcript`; label `via MCP`.
Make the journey readable: raw voice note → Zenod → preserved original plus connected meaning → an agent retrieves the cited transcript. Keep the storage split visible. Use cyan flow and a lime `Saved` step.

### 03-value.html
Eyebrow: `CONTEXT COMPOUNDS`
Headline: `Cultivate your context.` (white) `Extract more intelligence.` (lime)
Subtitle: `Original evidence becomes connected meaning. Connected meaning becomes useful work.`
Pattern: inverted value pyramid, bottom-broad and upward-expanding in value.
Bottom layer: `ORIGINAL EVIDENCE` — voice waveform, picture, written note; label `Layer zero`.
Middle layer: `CONNECTED MEANING` — Preferences, Projects, People/Relationships, Open questions, linked by fine cyan lines.
Top layer: `USEFUL WORK / ACTIONS` — Plans, Decisions, Work, Answers, with `Your agents` at the top.
Arrows point upward and are labelled `Organize`, `Connect`, `Extract`. Along the side show `Higher intelligence / higher value / higher impact`. Do not make it literal Egyptian architecture.

### 04-organize.html
Eyebrow: `GROUNDED BY FACTS`
Headline: `Keep the original.` (white) `Connect the meaning.` (cyan)
Subtitle: `Raw evidence stays grounded. Connected meaning builds on top of it.`
Pattern: two-layer evidence diagram.
Left: three inputs with short legible labels:
  - voice waveform: `I loved the light`;
  - picture/photo: `Flat listing`;
  - text/note: `The commute matters`.
Centre: small librarian connecting them.
Right: a clear two-layer stack:
  - `CONNECTED MEANING` — collection titled `Finding a home` with `What matters`, `Places considered`, `Open questions`; linked preferences `Light` and `Commute`.
  - `RAW EVIDENCE` — the same three original thumbnails directly underneath, visibly preserved.
Thin cyan source links must run from each connected thought back to a raw thumbnail. Label `Every thought leads back to its source.` Do not put the sources far away in a separate baseline; keep thumbnails on the right beside the meaning.

### 05-recall.html
Eyebrow: `ASK → CITE → RETURN`
Headline: `Ask the librarian.` (white) `Get back to the source.` (cyan)
Subtitle: `Find the thought you remember vaguely. Return to what you actually said.`
Pattern: one dominant illustrative question/answer path, plus a restrained read path.
Question: `What did I say about the light in that flat?`
Answer: `You loved the natural light.`
Visible source chip: `Original voice note · 5:00`.
Read path under it: `Connected thought → Original recording → Cited answer`.
Keep the chat mockup dominant and uncluttered. No extra full-size librarian; a small librarian mark is allowed.

### 06-agents.html
Eyebrow: `MCP · SHARED CONTEXT`
Headline: `Every agent.` (white) `One gateway.` (cyan) `One library.` (lime)
Subtitle: `Your agents retrieve from — and write back to — one shared context through MCP.`
Pattern: hub-and-spoke with the library in the centre.
Centre: `YOUR LIBRARY` boundary containing `Originals` + `Connected knowledge`, with the librarian and a visible `MCP` gateway ring/badge. Label `ZENOD · MCP GATEWAY`.
Around it: `Codex`, `Claude`, `Grok`, `ChatGPT`, `Cursor` (or another restrained set) arranged in a balanced orbit. Not just three on one side.
Use bidirectional arrows: `Retrieve` from library outward to agents; `Save` from agents inward to library. Label `Everybody contributes to your context.` Keep it open and balanced; do not use a dense network or a wall of chat text.

### 07-replace.html
Eyebrow: `YOUR ORIGINALS OUTLIVE THE TOOL`
Headline: `Keep the books.` (white) `Replace the librarian.` (cyan)
Subtitle: `Your originals stay fixed. Future custodians can build new meaning from them.`
Pattern: horizontal timeline with stable raw data underneath.
Bottom band: `YOUR ORIGINALS · UNCHANGED` with voice, transcript and document artifacts.
Timeline left: `Today` — Zenod librarian + `Current understanding`.
Timeline right: `In 10 years` — a neutral next-custodian symbol + `New understanding`.
Thin cyan source lines rise from both meaning states to the same original artifacts.
Caption: `The value of your raw thoughts is maintained by all your future agents. Zenod is just the first one.`
No cluttered arrows; let the timeline do the work.

### 08-choice.html
Eyebrow: `OPEN SOURCE · YOUR WAY`
Headline: `Your library.` (white) `Your choice.` (lime)
Subtitle: `Keep it on Google Drive or GitHub. Run the engine yourself — or let us run it for you.`
Pattern: two clear choice lanes around one open-source engine.
Lane A — `WHERE IT LIVES`: `Google Drive` or `GitHub`, with a single `Your library stays yours` band. Show Drive and GitHub marks.
Lane B — `HOW IT RUNS`: `Self-host` on `Your VPS` or `Hosted` at `$3 / month` with `Always-on on our infrastructure`. Make the price and choice explicit but mark the slide `Conceptual offer · illustrative`.
Bottom action row: `View on GitHub` and `Explore setup`.
Include a small open-source-engine/librarian mark in the centre. No fake checkout, no free promise, no hidden lock-in.

## Handoff requirements

For every slide assignment:
- create the HTML file;
- run `./render-slides.sh`;
- verify the PNG exists and `sips -g pixelWidth -g pixelHeight` reports `1678 × 937`;
- report the exact files and any content that could not fit cleanly.
