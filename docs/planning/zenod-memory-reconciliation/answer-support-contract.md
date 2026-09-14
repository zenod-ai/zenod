# ZMR-23 answer support contract

Bound issue: [#1263](https://github.com/zenod-ai/zenod/issues/1263). This repairs finalization; it does not establish release or production acceptance.

The prior finalizer guessed relevant facts from lexical overlap or exact quotation wording. Correct multilingual answers could disappear. The existing final model completion now selects turn-local supports:

```json
{"supportSelections":[{"id":"as_<24 hex characters>","mode":"current"}]}
```

The host attaches these IDs to actual bounded passage reads and source-verified fact views. Facts retain keys and allowed current/historical/prior/conflict modes. Raw paragraph handles permit only `raw_report`. The host ignores generated answer prose and renders selected canonical facts and whole-key histories, or complete source paragraphs with report qualifications and host citations. A valid current ID paired with wrong model prose cannot introduce an old date or reversed negation.

Relevant-subject selection remains semantic model work. Identity, custody, snapshots, temporal status, canonical wording and citations remain host authority. This does not prove arbitrary paraphrase entailment: free paraphrases never become final facts. Questions may use different wording or languages because the model selects IDs. Canonical quotations may remain in their source language.

No model/provider, output ceiling, tool-round budget or storage changes. No extra verifier or unconditional completion. Body and frontmatter reads of selected meaning pages can trigger the existing four-note bounded source-verification projection, including questions requesting current and prior information together. These are additional host reads and tool-result metadata, not another model request. Legacy prose finalization still does not substitute automatic current views for historical answers.

Raw previews are limited to 160 characters; at most 32 new paragraph hints are returned per registration. Earlier IDs remain usable in the turn. Paragraphs over 4,000 characters, incomplete edges and metadata budget omissions are explicitly marked partial. Pinned support reuses the already resolved entry and the ordinary reader's content-version calculation. Selected fact views and raw versions are independently revalidated, including an old automatic view followed by a newer explicit view. Unknown IDs, incompatible modes, unavailable facts and changed snapshots fail closed. Correct-looking discovery snippets do not become source support.

AISDK buffers the opt-in vault completion before decoding; tool-progress events remain available, but internal JSON never reaches text callbacks. Ordinary prose and general JSON without support reads remain compatible. Legacy adapters without the optional result field retain conservative temporal finalization, without the discarded lexical selector.

Validation covers generic bilingual/mixed/current/prior/conflict cases, actual engine/HTTP seams and all recorded regression read sequences. Historical outputs predate IDs, so replay uses evaluator-simulated selection and cannot prove live model compliance. A search-only case lacks source support; an unread unconfirmed report cannot be invented. Fresh evaluation remains a separate gate, and independent ASR fixtures are not development inputs.
