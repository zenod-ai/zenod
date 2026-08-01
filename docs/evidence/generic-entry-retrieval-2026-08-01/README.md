# Generic Typed Entry Retrieval — Live Evidence

Date: 2026-08-01  
Repository: `zenod-ai/zenod`  
Production unit: Zenod MT  
Deployed SHA: `d4eaac46f3322840c8c28c1bd64929e1fa68cd53`

## Outcome

Zenod now retrieves durable memory entries through the existing generic MCP seam. This is not a voice-note helper and does not query the WhatsApp transport-audit database.

- `search_memory` accepts optional `query`, `source`, `contentType`, `capturedAfter`, `capturedBefore`, `order`, and `limit`.
- Structural results carry `evidenceRef`, source, content type, capture time, source ID, character count, snippet, and canonical GitHub file URL.
- `get_memory` accepts an exact anchored evidence reference and returns only that immutable entry.
- Future stores persist typed provenance with the immutable entry. Existing immutable entries are enriched from their durable terminal task receipt without rewriting history.
- The production Zenod catalog does not expose `get_recent_conversation_transcript`; transport audit remains operationally separate from memory retrieval.

This contract is reusable for any source and content type represented by the shared enums: text, voice note, audio, image, screenshot, PDF, document, and link.

## Changes

- [PR #1050](https://github.com/zenod-ai/zenod/pull/1050), merged as `399b3a8dc07154008553702b9c9d689ba92cb63b`: generic typed entry model, structural search, exact read, capture provenance, legacy receipt enrichment, and catalog separation.
- [PR #1051](https://github.com/zenod-ai/zenod/pull/1051), merged as `d4eaac46f3322840c8c28c1bd64929e1fa68cd53`: exact reads reuse the same provenance merger as structural lists, keeping list and read identity consistent.

No changes touched `taskingPolicy.ts`, `replyGate.ts`, Ring, or the librarian's classification policy. No regex or output-text policy scan was added.

## Automated Gates

The final consistency diff passed:

- focused MCP integration: 29/29;
- full server suite: 893/893;
- all workspace typechecks;
- `git diff --check`;
- net-free lexical-policy diff audit for added `RegExp`, `.match(`, `.test(`, and `.replace(` patterns;
- frozen-file audit for `taskingPolicy.ts` and `replyGate.ts`;
- GitHub CI run `30705089349`;
- runtime image build, boot smoke, and publish run `30705230336`.

Published image: `ghcr.io/zenod-ai/zenod:sha-d4eaac4`.

## Live Catalog Proof

An authenticated tenant-scoped MCP `tools/list` on the deployed SHA reported:

```text
search_memory fields:
capturedAfter, capturedBefore, contentType, limit, order, query, source

get_recent_conversation_transcript present: false
```

## Live Structural Query

The following generic call was made directly against the deployed Zenod MCP:

```json
{
  "name": "search_memory",
  "arguments": {
    "source": "whatsapp",
    "contentType": "voice_note",
    "order": "newest",
    "limit": 10
  }
}
```

Acceptance result:

```json
{
  "count": 10,
  "newestFirst": true,
  "allTypedWhatsAppVoiceNotes": true,
  "newest": {
    "evidenceRef": "Log/2026-08-01.md#^e-9b0c3d",
    "capturedAt": "2026-08-01T14:08:15.673Z",
    "source": "whatsapp",
    "contentType": "voice_note",
    "sourceId": "3B197EF5C54D74CDFA72",
    "chars": 4174
  }
}
```

The ten results spanned 2026-07-30 through 2026-08-01 and were sorted strictly newest-first.

## Live Exact Read

The first result's exact reference was passed to the generic reader:

```json
{
  "name": "get_memory",
  "arguments": {
    "path": "Log/2026-08-01.md#^e-9b0c3d"
  }
}
```

Acceptance result:

```json
{
  "exactRefMatched": true,
  "provenanceMatched": true,
  "source": "whatsapp",
  "contentType": "voice_note",
  "sourceId": "3B197EF5C54D74CDFA72",
  "capturedAt": "2026-08-01T14:08:15.673Z",
  "chars": 4174,
  "expectedCharsMatched": true,
  "containsNeighborEntryMarker": false
}
```

The exact read therefore returned the requested transcript intact, with the same typed identity as the list result, and did not expose the adjacent `^e-4e5a6b` entry from the same daily log.

## Deployment Receipt

Public health after rollout:

```json
{
  "status": "ok",
  "name": "zenod",
  "version": "0.0.1",
  "sha": "d4eaac46f3322840c8c28c1bd64929e1fa68cd53"
}
```

Dokploy's saved Zenod application record points to `ghcr.io/zenod-ai/zenod:sha-d4eaac4`, its persisted `GIT_SHA` is the full deployed SHA, and the Swarm service runs the corresponding immutable digest.
