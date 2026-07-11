# Zenod workflow contract

Always prefer the peer's live `tools/list` schema. Host namespaces may change the visible tool names.

## Durable write

```text
user asks to remember
  -> store_memory(exact content + known hints)
  -> accepted ticket_id
  -> get_task_result(ticket_id) until done/error
  -> evidenceRef + pagesTouched + commitSha + URLs
```

Only the terminal receipt proves storage. Poll the same ticket; do not issue a duplicate store.

## Narrow retrieval

```text
search_memory(high-signal terms)
  -> ranked paths + snippets + URLs
  -> get_memory(best relevant path)
  -> answer from the full note with its source
```

Retry sensible synonyms or exact names before reporting no result.

## Broad retrieval

Use `ask_brain` for paraphrases, project summaries, temporal corrections, or joins across notes. A valid answer distinguishes evidence from inference and cites the paths actually consulted. Missing attributes remain unknown.

## Corrections

When evidence contains an explicit correction, report the corrected current value and identify the superseded value when relevant. Do not erase history or substitute a near-match from another marker/project.

## Artifact ingest

Queue one `ingest_memory` call with the supported artifact reference and provenance. Poll the returned ticket. Terminal results should identify the raw archive and the filed evidence separately; a processor-unavailable or extraction error is a loud failure.
