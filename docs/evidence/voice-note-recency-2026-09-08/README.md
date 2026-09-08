# Voice-note recency incident — 2026-09-08

## Finding

Confirmed live retrieval compatibility defect: `search_memory(contentType="voice_note", order="newest")` returns August 27 as its newest entry. September WhatsApp voice notes exist, but are typed `audio` and therefore excluded. This reproduces the screenshot's precise cutoff without an LLM.

Read-only diagnosis; no production, vault, or application code changes.

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
