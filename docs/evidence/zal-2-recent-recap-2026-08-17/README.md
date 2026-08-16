# ZAL-2 Recent-Conversation Recap Evidence

Date: 2026-08-17 CEST
Issue: [#1059](https://github.com/zenod-ai/zenod/issues/1059)
Branch: `codex/zal-2-recent-recap`
Base: `7454715a299b97ea410269b14586ac79c14334c9`
Integration target: `main`

## Outcome

The reported 2026-08-15 failure was recovered exactly from Ring's durable tenant state and reproduced on the current deployed Ring surface. Ring treated a Phylax transport-audit gap as the complete answer even though Zenod's structural memory ledger returned exact recent entries. The branch adds a narrow Ring grounding contract: list recent immutable memory entries structurally, read the exact refs used, treat transport/chat history as supplemental, cite the refs, and never add mutation-status prose to a read-only recap.

No production deployment, credential change, WhatsApp session reset, vault cleanup, or memory write was performed.

## Exact Reported Interaction

Read-only query against Ring's preserved `/data/github-63050995/zenod.sqlite` `chat_test_runs` and `messages` tables:

- Timestamp: `2026-08-15T21:50:35.615Z` (`chat_test_runs.at`; message append at `21:50:35.967Z`).
- Surface / conversation: `whatsapp` / the tenant's preserved WhatsApp conversation (phone identifier redacted from repository evidence).
- Correlation: `test_b61218de894c4ab4bc988ce91c2a1c6f`.
- Prompt: `What have we been talking about recently`
- Exact answer:

  ```text
  Nothing was changed: no verified same-turn mutation receipt was returned.

  I couldn't read the connected source. Nothing was changed. Please retry.
  ```

- Tool trace: one start/end pair for `phylax__get_recent_conversatio__f95bb49004449eeb` (`get_recent_conversation_transcript`).
- Recorded sources: `[]`.
- Durable limitation: the chat audit retains tool identity/start/end but not the peer's raw returned payload. Direct read-only inspection of the current Phylax tenant audit store found no inbound or outbound rows in the `2026-08-15T21:45:00Z`–`22:00:00Z` window, independently confirming the transport-evidence gap.

The follow-up voice note at `Log/2026-08-15.md#^e-063285` reports that this was the weird answer but does not quote it; Ring's durable chat state is therefore the best available exact source for the prompt and answer.

## Current Replay

Before replay, container metadata reported:

- Ring SHA: `0be407a10ff5cd50c306398f919009b4d8fc5734`
- Zenod MT SHA: `7365dbc1c7d869f6c78ee010e47e998f87091c4d`
- Phylax SHA: `399b3a8dc07154008553702b9c9d689ba92cb63b`
- Zenod vault checkout HEAD: `03729e0de9eac075902527a115c617fa0210d970`
- Zenod vault checkout status: clean

One isolated `chat_with_ring` replay used:

```json
{
  "message": "What have we been talking about recently?",
  "surface": "whatsapp",
  "conversationKey": "zal-2-recent-recap-20260817-v2",
  "testRunId": "zal-2-1059-replay-20260817-v2"
}
```

Result:

- Timestamp: `2026-08-16T22:05:49.507Z` (`2026-08-17T00:05:49.507+02:00`).
- Correlation: `test_71d92d7de7f447718cd4e2e6e6f4b22e`.
- Exact answer: `I couldn't read the connected source. Nothing was changed. Please retry.`
- Tool trace: one start/end pair for the same Phylax recent-conversation tool.
- Recorded sources: `[]`.
- Post-replay vault HEAD: `03729e0de9eac075902527a115c617fa0210d970`.
- Post-replay vault status: clean.

The replay therefore reproduces the read failure and proves no vault/read-side mutation.

## Exact Memory Evidence And Expected Answer Boundary

Direct structural `search_memory` on Zenod MT with `source=whatsapp`, `contentType=voice_note`, `capturedAfter=2026-08-15T00:00:00Z`, `order=newest`, and `limit=10` returned the two required project-direction entries first:

1. `Log/2026-08-15.md#^e-063285` — captured `2026-08-15T21:55:19.162Z`; reports the bad recap, asks for launch-readiness sanity checks, defines alpha-user onboarding as the milestone, and asks for a clear backlog/reporting loop.
2. `Log/2026-08-15.md#^e-5c1e43` — captured `2026-08-15T21:50:01.378Z`; discusses Zenod's working voice-memory habit, launch/promotion/package questions, EpicSpine, and the future explicit store-only versus store-and-execute lane.

Exact `get_memory` reads returned only each requested anchored entry with matching typed WhatsApp/voice-note provenance. A grounded current recap should say, at minimum, that recent Zenod discussion centered on alpha-launch readiness and trustworthy recap behavior, plus the longer-term voice-memory-to-Codex execution lane and its explicit store/execute choice. It must cite the exact refs above and must not introduce unrelated Poly-Maker, housing, or generic infrastructure claims unless separately returned as in-window evidence.

## Proven Failure Boundary

The failure is not missing stored evidence:

- Zenod's generic structural memory seam returns the exact recent entries and exact reads.
- Ring selected only the Phylax transport audit, which had an evidence gap, and terminated with no sources.
- Ring's persisted wallet catalog was last refreshed on `2026-07-29`; its Zenod `search_memory` contract was the old required-keyword schema and did not include `get_memory`, even though the current Zenod deployment advertises structural chronology and exact reads.
- A direct Zenod natural-language replay also chose keyword `search_chats` and returned older unrelated matches with no sources, confirming that keyword relevance is not a valid substitute for chronology.

The smallest in-scope correction is a Ring-specific grounding contract. On the next authorized Ring deployment, startup discovery will refresh the connected Zenod catalog; the contract then requires structural newest-first memory enumeration plus exact evidence reads before synthesis. It explicitly makes transport/chat evidence supplemental and forbids mutation-status prose on this read-only path. No generic authorization, output scanner, regex router, one-off voice-note tool, or librarian policy change is added.

## Validation

The focused regression checks both sides of the boundary:

- Ring's persona places the recent-recap rule after the inherited Console prompt and names structural `search_memory`, `order: newest`, exact `get_memory`, evidence-gap handling, citations, and read-only outcome language.
- Ring wallet discovery preserves a downstream structural recent-memory schema and exact-read schema, and forwards the exact accepted arguments to `search_memory` then `get_memory`.

Final command/results are recorded in the issue handoff after the branch validation completes.

Passing branch validation:

```text
npm ci
  802 packages installed from lockfile; 0 vulnerabilities

npm run build -w zenod && npm run build -w @zenod/mcp-chassis
  pass

npx vitest run packages/server/test/ringUnit.test.ts packages/server/test/ringCatalogFidelity.test.ts
  2 files passed; 17 tests passed

npm test -w @zenod/server
  95 files passed; 904 tests passed

npm run typecheck
  all workspace builds/typechecks passed

npm run build -w @zenod/server
  TypeScript build passed; 27 per-tool schemas verified

git diff --check
  pass

frozen-surface audit (taskingPolicy.ts / replyGate.ts)
  pass; neither file changed

added lexical-policy pattern audit (RegExp / match / test / replace)
  pass; no added pattern
```
