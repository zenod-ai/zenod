# Filing Latency And Schema Proposal

Status: proposal from issue #79, researched against the implementation on 2026-06-14.

This document maps the current filing path, identifies likely latency and cost drivers, and proposes the next filing schema iteration for high-volume voice/document ingestion.

## Current Filing Flow

The live filing path is `BrainEngine.store()` in `packages/core/src/engine/engine.ts`. Google Drive ingestion enters it through `IngestQueue.process()` in `packages/server/src/ingestQueue.ts`; WhatsApp/tasking paths use the same engine contract when they explicitly capture or store.

Step by step:

1. **Source adapter prepares text.**
   - Drive downloads the file, transcribes audio through `transcribeAudio()` or exports/downloads text, builds a header containing source filename, Drive URL, and transcription provider, then calls `engine.store({ source: "drive", verbatim: true })`.
   - This adapter work is outside filing latency for text captures, but it is user-visible ingestion latency for voice notes.
2. **Write queue serializes the store.**
   - `store()` runs inside `WriteQueue`, so only one write can file at a time per engine instance.
3. **Git pull.**
   - The repo pulls before writing. Pull failure is tolerated so offline/local stores can proceed.
4. **Load schema config and choose verbatim mode.**
   - `.brain/config.yml` provides tag vocabulary and confidence threshold.
5. **Append immutable evidence.**
   - `appendEvidence()` writes the full capture into `Log/YYYY-MM-DD.md` with a block anchor, source, and verbatim flag.
6. **Scan the vault.**
   - `scanVault()` builds the meaning page index used by classification.
7. **Classify with the cheaper classification model.**
   - `llm.classify()` receives the capture, caller hints, all scanned meaning pages, and tag vocabulary. It returns confidence, summary, tags, and one to three target meaning pages.
8. **Low confidence fallback.**
   - If confidence is below threshold or no pages are returned, Zenod writes `Inbox/needs-filing-*.md`, commits the evidence plus inbox stub, and returns a concrete question.
9. **Compose each meaning page with the ask model.**
   - For each classified page, Zenod reads current content or a template, supplies the evidence entry, citation token, tag vocabulary, required type, and link hints, then asks `llm.composePage()` to return the complete replacement markdown.
10. **Validate and retry composition.**
    - After every composed page, Zenod runs `lintVault()` on that page plus `checkEvidenceImmutability()` over pending changes. Composition retries up to two times with lint errors fed back to the model.
11. **Composition failure fallback.**
    - If any page cannot validate, Zenod discards all changes, appends the evidence again, writes an Inbox stub explaining the failure, and commits that fallback.
12. **Commit and push.**
    - A successful store commits one `memory:` commit containing the log update and meaning page changes.
13. **Optional proactive backlog digestion.**
    - For Drive/WhatsApp captures, `shouldDigestForBacklog()` may call `llm.extractBacklog()` after the store commit. It returns advisory candidates only; it does not write backlog files unless the explicit digest tool is used.

## Filing Versus Digestion

Filing currently means preserving the source evidence, deciding which memory pages it touches, and integrating distilled claims into those pages with citations. It is invoked by `store()`.

Digestion means mining filed evidence or supplied text for actionable backlog records: actions, blockers, dependencies, owner, difficulty, acceptance criteria, and open questions. It is implemented by `digestBacklog()` and `llm.extractBacklog()`.

The boundary is mostly clean in the API, but Drive/WhatsApp stores blur it by opportunistically running backlog extraction after filing. That extra call can make a "filing" job look slower even though the durable memory write has already completed. The UI/status model should report these as separate phases: `filing memory` and `mining backlog proposals`.

## Likely Latency And Cost Drivers

The dominant filing costs are not deterministic file writes. They are model calls and serialized git/network work:

| Driver | Why it costs time | Cost profile |
|---|---|---|
| Classification LLM call | Sends the full capture plus page index and tag vocabulary. | Usually necessary, already on the classify model. |
| Full-page composition LLM call per page | Sends current page/template plus the new evidence; rewrites complete markdown. Multiple pages multiply latency. | Highest reasoning/cost stage. Uses the ask model today. |
| Validation retries | A bad composed page can add up to two more full composition calls. | Rare in tests, expensive when it happens. |
| Large voice transcripts | The full transcript is appended to evidence and also sent to classification and composition. | Scales with transcript length. |
| Git pull/commit/push | Network and remote latency, serialized behind the write queue. | Required for audit trail, but can be optimized around batching/status. |
| Proactive backlog extraction | Additional structured LLM call for long Drive/WhatsApp captures. | Digestion, not filing; should be measured separately. |
| Write queue serialization | One slow file blocks later stores. | Preserves correctness; high-volume ingestion needs a queue UX and phase metrics. |

Substeps requiring strong reasoning:

- Deciding whether a capture belongs in an existing page or needs a new page when the topic is ambiguous.
- Integrating a new claim into an existing dense meaning page without duplicating or contradicting prior content.
- Choosing useful wikilinks and preserving page-level retrieval summaries.
- Detecting that the capture is actually a task/backlog item rather than durable memory.

Routine or lower-intelligence substeps:

- Emitting fixed evidence metadata.
- Extracting source fields from adapter headers.
- Normalizing dates, source URLs, MIME/file metadata, and provider info.
- Producing constrained classification candidates from a small candidate set.
- Generating an append-only index record once the schema is deterministic.
- Backlog prefiltering before invoking a real digester.

## Lower-Cost Filing Strategy

A credible cheaper strategy is to split filing into an atomic receipt write plus bounded classification, and defer meaning-page synthesis.

Recommended split:

1. **Deterministic receipt write.**
   - Always create a machine-readable capture record with stable IDs, source metadata, transcript text, and source links.
   - No LLM required.
2. **Cheap constrained router.**
   - Use the classify model or a smaller model with strict JSON output over a compact candidate list from lexical search, not the entire page index.
   - Output only candidate page IDs, confidence, tags, and a one-line evidence summary.
3. **Fast index hydration.**
   - Write an atomic receipt/index entry that is searchable immediately even if no meaning page has been rewritten.
4. **Deferred meaning synthesis.**
   - Run the stronger model only for captures that cross a confidence/importance threshold, affect existing high-value pages, or are selected by a later compaction/digestion job.

This preserves "never lose evidence" while making the common ingest path cheaper. The risk is that meaning pages lag behind evidence, so retrieval must search evidence records directly and not rely only on distilled pages. The roadmap already identifies this as required work.

## Proposed Filing Schema V2

Keep the two-tier model, but make the evidence tier more atomic and queryable. Instead of treating `Log/YYYY-MM-DD.md` as the only structured receipt, introduce one capture record per source item plus a lightweight daily log pointer.

Proposed vault layout:

```text
Captures/YYYY/MM/YYYY-MM-DD-<short-id>.md
Log/YYYY-MM-DD.md
Projects/
Areas/
Notes/
Backlog/
```

Proposed capture frontmatter:

```yaml
schema: filing-v2
id: cap_20260614_ab12cd
type: capture
source:
  surface: drive
  source_id: file-1
  title: Zenod voice note.m4a
  url: https://drive.google.com/file/d/file-1/view
  mime_type: audio/mp4
  captured_at: "2026-06-14T02:48:42Z"
processing:
  transcript_provider: groq
  filed_at: "2026-06-14T02:50:10Z"
  filing_status: routed
  router_model: claude-haiku-4-5
  synth_status: deferred
routing:
  confidence: 0.82
  tags: [repo, backlog]
  targets:
    - path: Projects/RepoMiningFunding.md
      action: update
      reason: Mentions repo-mining funding plan and launch backlog.
provenance:
  evidence_ref: Captures/2026/06/2026-06-14-ab12cd.md#transcript
  original_ref: https://drive.google.com/file/d/file-1/view
summary: Voice note about filing latency and storage schema tradeoffs.
```

Capture body:

```markdown
# Zenod voice note.m4a

## Summary

Voice note about filing latency and storage schema tradeoffs.

## Extracted Signals

- filing latency appears dominated by meaning-page synthesis
- evidence retrieval needs first-class source links

## Transcript

> Verbatim transcript...
^transcript
```

Daily log entry:

```markdown
## 02:50 Zenod voice note.m4a ^e-ab12cd
- capture: [[Captures/2026/06/2026-06-14-ab12cd]]
- source: drive
- status: routed
- targets: [[Projects/RepoMiningFunding]]
```

Meaning pages should carry a compact `## Sources` or `## Evidence` section containing capture links and original URLs for claims they summarize. That makes provenance answerable from both tiers.

## Tradeoffs

Speed:

- Faster first durable write because receipt/index generation is deterministic and independent of full-page synthesis.
- The expensive compose call moves out of the critical path for routine ingestion.
- Queue head-of-line blocking drops if captures can be committed quickly and synthesis jobs run separately.

Robustness:

- Better, because raw evidence and source metadata land before any ambiguous reasoning.
- More states must be represented clearly: `recorded`, `routed`, `synthesized`, `needs-filing`, `synthesis-failed`.

Indexing quality:

- Better for provenance and artifact questions because the evidence tier becomes searchable by structured fields.
- Meaning-page quality may temporarily lag unless deferred synthesis is scheduled and monitored.

Cost:

- Lower for common ingestion because cheap routing can be the only immediate LLM call.
- Strong model spend becomes targeted at synthesis/compaction, not every capture.

Maintenance:

- Slightly more schema surface than daily logs alone.
- Lower long-term maintenance if each capture is immutable and independently addressable.

## Recommended Experiments

1. **Instrument phase timings.**
   - Add per-store measurements for pull, evidence append, scan, classify, each compose attempt, lint, commit/push, and backlog extraction.
   - Include model IDs, estimated input tokens, output tokens when provider usage is available, number of target pages, and transcript character count.
2. **A/B cheap router.**
   - Compare current classify prompt against a constrained router that receives only top lexical candidate pages plus controlled tags.
   - Score exact target page match, confidence calibration, Inbox rate, duplicate-page rate, and latency.
3. **Deferred synthesis prototype.**
   - Land capture records immediately, then run meaning-page composition asynchronously for a sample of captures.
   - Measure whether ask/search can answer provenance and content questions before synthesis.
4. **Backlog phase separation.**
   - Move proactive backlog extraction into a distinct queue phase and report its timing separately from filing.
   - Validate that perceived filing latency drops when memory filing is marked done before backlog mining.
5. **Schema retrieval benchmark.**
   - Build a fixture vault with daily logs, capture records, meaning pages, and source links.
   - Test questions like "where is the original audio?", "what did I say about X?", and "which notes mention blocker Y?" against current v1 and proposed v2 layouts.

## Recommendation

Do not make the stronger model responsible for every part of filing. Keep strong reasoning for meaning synthesis and ambiguous routing, but make evidence capture, source metadata, and searchable receipt indexing deterministic.

The next iteration should be:

1. Add phase timing/instrumentation before changing behavior.
2. Split backlog extraction metrics and UI status from filing.
3. Prototype `Captures/` records as the atomic evidence/indexing unit.
4. Route with a cheap constrained model over a small candidate set.
5. Defer expensive meaning-page synthesis when confidence is adequate for retrieval but not urgent for distilled memory.

This should reduce apparent filing latency and ingestion cost without weakening the core promise: every memory remains durable, cited, source-linked, and recoverable.
