# Voice-note recency incident — 2026-09-08

## Finding

Confirmed live retrieval compatibility defect: `search_memory(contentType="voice_note", order="newest")` returns August 27 as its newest entry. September WhatsApp voice notes exist, but are typed `audio` and therefore excluded. This reproduces the screenshot's precise cutoff without an LLM.

Initial diagnosis below was read-only. The authorized repair and deployment follow-up are recorded at the end.

## Runtime and logs

Inspected production Zenod MT container `aae51dc7dc59`, started 2026-09-08T11:09:08.842Z. OCI revision `779f74c8210b31de7c71fe406a3c2d992a5fb5bf`; local image ID `sha256:92d41533cb8528cac9cc03db02ad902c38e16fb4b65951258fafbf245eaee10a`.

Docker HTTP logs for 11:25–11:45 UTC show successful MCP requests for the affected tenant around the screenshot's 13:34 Europe/Paris time, but do not preserve tool names/arguments/results. The exact original tool sequence is therefore unproven. The MCP raw usage timeline returned 403 (`raw_usage` capability); no permission changes were attempted.

## Reproduction

- `{contentType:"voice_note",order:"newest",limit:5}`: 65 total matches across 415 local evidence entries; newest 2026-08-27T18:05:46.860Z, `Log/2026-08-27.md#^e-171b11`.
- `{source:"whatsapp",contentType:"audio",order:"newest",limit:100}`: 14 matches, complete page; entries begin August 28 and continue through September 8.
- `{capturedAfter:"2026-09-01T00:00:00Z",order:"newest",limit:12}`: 12 entries, complete page, including five WhatsApp audio entries.
- Exact `get_memory` reads succeeded for all five September audio entries. All contain a transcription-provider marker and stored transcript; none contains the explicit skipped-transcription marker. This confirms availability, not transcription accuracy or proof that every sent note was captured.

| Captured UTC | Exact evidence | Stored entry characters |
|---|---|---:|
| 2026-09-03 18:14:47 | Log/2026-09-03.md#^e-cb79fa | 18,711 |
| 2026-09-06 19:37:48 | Log/2026-09-06.md#^e-95a3e7 | 34,081 |
| 2026-09-07 14:54:37 | Log/2026-09-07.md#^e-77c11c | 2,181 |
| 2026-09-08 11:48:55 | Log/2026-09-08.md#^e-791b98 | 42,162 |
| 2026-09-08 14:16:31 | Log/2026-09-08.md#^e-4a2a19 | 14,604 |

The two September 8 captures are after the screenshot's apparent 11:34 UTC query time. September 3, 6, and 7 entries still establish that its August 27 recency claim was wrong at that time.

## Code cause at deployed revision

- `packages/server/src/taskJobQueue.ts:446`: media evidence uses `contentType: input.mediaType ?? extraction.kind`. Audio transcription produces `kind: "audio"`, while its human label is "Voice note".
- `packages/core/src/engine/evidence.ts:203`: structural filtering requires exact equality `entry.contentType === query.contentType`.
- `packages/server/src/mcp.ts:575–579`: retained media-ingest receipts also preserve `mediaType`; older WhatsApp store jobs fall back to `voice_note`. Receipt enrichment therefore preserves the split.
- Live evidence changes category between August 27 and August 28. The generic media-type assignment predates this (blame: `399b3a8d`, August 1); late-August WhatsApp routing/archive changes activated that path. Exact first deployment responsible was not established.
- September's memory-reliability upgrade is present in deployed ancestry. It did not resolve this category compatibility defect. Its recorded bounded acceptance covered other filing/recall cases; broader release acceptance remains open.

## Recommended repair and acceptance

1. Preserve explicit voice-note identity in new WhatsApp capture metadata.
2. Make semantic voice-note retrieval include legacy audio entries when voice-note provenance identifies them, without conflating every arbitrary audio attachment with a voice note. Preserve immutable historical logs.
3. Have recent-note answers check date coverage and sibling media categories before making a freshness claim.
4. Add an integration regression spanning old `voice_note` and new media-ingest `audio` receipts, date filtering, pagination, exact reads and natural-language recent-VN answers.
5. Verify live retrieval returns September 3, 6, 7 and 8 before declaring repaired.

Immediate read-only workaround: enumerate WhatsApp captures newest-first without the narrow content-type filter, or query both categories and merge by captured timestamp.


## Authorized repair — implementation contract

Jordi authorized implementation and deployment on September 8, emphasizing simplicity, actual source voice-note identity, reliable ingestion/retrieval and preservation of the working flow.

- WhatsApp's existing `audioMessage.ptt` determines `voice_note` versus `audio`. Technical mediaType stays audio. Preserve both provider ID and original sender timestamp, including durable queue restart, using the existing inbound message table.
- Existing ingest input stores explicit contentType in immutable evidence and enrichment. Non-audio inputs cannot claim an audio content category. No extra transcription or pipeline is introduced.
- MCP, internal chat and web ask use the same existing receipt-enriched entry catalog. Its code is moved into a shared module rather than duplicated. Exact evidence reads retain original transcript bodies and citations.
- Historical labels are not inferred from generated text: original source records prove **11 PTT voice notes and 3 ordinary audio attachments** among the 14 post-August-27 audio captures. All five September entries are PTT. The old producer called even ordinary audio “Voice note,” so heading/sourceHint heuristics are rejected.
- `scripts/repair-voice-note-metadata.py` performs a bounded, source-verified repair of the existing completed task input metadata (contentType and senderTimestamp), with dry-run, tenant/ID/exact-evidence checks, transaction and protected prior-input receipt. Raw logs, transcripts, results, job status and timestamps stay untouched. No schema migration or new metadata store is introduced. Existing task metadata is durable and has no automatic pruning.
- Restore proof and rollback snapshots are required for the affected Zenod/default Phylax pair. Deploy the accepting Zenod schema before the Phylax emitter. No other services or settings are part of the release.

The initial screenshot predates today's two captures. The earlier September 3/6/7 captures establish the original error; live acceptance also covers September 8.


## Deployment and historical recovery

PR #1232 merged as `d02493cc0a7cb658ee5eedeea57039dd6fc264cb`. CI run 34243883547 and image publication 34244664653 passed. Both public Zenod MT and its default Phylax companion are deployed at this exact revision; actual tasks, OCI image revisions, public health, preserved environment/mounts and WhatsApp connected/ready were checked. Fresh independent volume backups passed restore checks before deployment.

The source-verified metadata correction checked and changed exactly 14 completed receipts: 11 PTT voice notes and three ordinary audio files. A second dry run changed zero. Raw September transcript reads remained identical. Protected rollback input receipts and volume archives remain outside the repository.

Live deployed deterministic acceptance: all five September voice notes returned with original source timestamps; all 76 VNs paginated across four pages, complete, unique and newest-first; only the three ordinary attachments remained `audio`. See `historical-repair.json` and `initial-deployed-acceptance.json`.

## Conversational acceptance follow-up

The first ordinary-language live test stopped after catalog searches without reading evidence; the second fell back to lexical matching and read an older subset. These are failures, not passing acceptance. A diagnostic prompt explicitly using `voice_note`, newest order and no lexical query successfully read and summarized the correct latest five September refs. This isolates a model query-selection problem after catalog recovery; the recorded audit does not expose its exact filter arguments.

The bounded follow-up clarifies existing internal and MCP tool instructions: category-only recency uses the content type and newest order; literal query terms are for an actual subject, and requested date/source constraints are preserved. Read exact returned refs, and use catalog `capturedAt` rather than processing timestamps in immutable Log headings. Filtering semantics and the capture pipeline remain unchanged. Unhinted live conversational replays must pass on the follow-up deployment before this incident is marked complete.


## General retrieval correction after deployment testing

On `d2183da0cb3565a82bc473a395f8526ab3808816`, the original screenshot wording and recent-VN summary found September correctly, but “What are my latest VNs?” still stopped without source reads. A durable read-only task (`d0181839-220d-4b9c-8f89-683aafcba102`) exposed the exact action: `{contentType:"voice_note",order:"newest",limit:5}` returned the correct five September entries, followed by zero reads. Thus the residual failure is confirmed as missing source-text reading, not an inferred filter error. See `guidance-deployed-acceptance.json`.

Jordi explicitly rejected phrase-specific fixes and asked that retrieval simply read the log. The follow-up uses the same generic entry catalog and existing exact passage reader: return bounded source passages alongside selected entries, retaining source metadata, continuation, read failures and budgets. Typed selection supplies exact scope to the existing answer-grounding guard, which otherwise incorrectly expects category words such as “VNs” to occur in transcript content. Neighboring log entries remain outside that scope. No question matcher, hard-coded dates/IDs, separate VN index or new storage is introduced. The VN-specific guidance example is removed in favor of generic category/ordering/query instructions.

Final production and fresh-phone acceptance are still pending for this follow-up. The most recent source audit at 15:56:59 UTC found no new inbound message after rollout; a genuine new phone VN has been requested from Jordi.
