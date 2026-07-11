---
name: zenod
description: "Use a connected Zenod MCP peer as durable, cited memory: store facts and decisions, retrieve exact memories, synthesize broad answers, ingest artifacts, and report receipts. Use when information should survive the current conversation or when a user asks what they previously recorded. Do not use Zenod as generic web search, a secret store, or evidence that an unstored fact exists."
license: AGPL-3.0-only
compatibility: Requires an attached Zenod MCP peer whose live tools have been discovered by the host. Tool names may be host-namespaced.
metadata:
  author: zenod-ai
  version: "1.0.0"
---

# Zenod

Zenod is the user's durable memory and librarian. It records immutable evidence, files meaning into an Obsidian-compatible vault, and returns source paths, GitHub URLs, commits, or asynchronous tickets. Live MCP schemas and tool results are authoritative.

## Resolve the connected tools

Use only tools discovered from the peer to which this skill is attached. Match terminal tool names and advertised schemas instead of assuming unqualified names.

Typical capabilities are:

- `store_memory`: record a durable fact, event, decision, preference, or instruction.
- `search_memory`: deterministic narrow lookup by names, phrases, dates, and codewords.
- `get_memory`: read one returned vault path in full.
- `ask_brain`: answer fuzzy or cross-note questions with cited sources.
- `ingest_memory`: archive and file a supported artifact through an asynchronous pipeline.
- `get_task_result`: poll asynchronous write or task tickets to a terminal result.

If a required capability is absent, say which one is unavailable. Never request or expose the peer URL, bearer token, GitHub credential, model key, or vault secret in conversation.

## Store durable memory

Store only when the user asks to remember, save, capture, or preserve something, or when durable intent is otherwise explicit.

1. Preserve the user's meaning. Use `verbatim: true` when exact wording, a codeword, commitment, quotation, or transcript matters.
2. Add filing hints only from known context; do not invent a folder.
3. Call `store_memory` once.
4. If it returns an accepted `ticket_id`/`jobId`, poll the advertised result tool until terminal. A queued receipt is not proof that the memory was stored.
5. Report the terminal evidence reference, touched pages, commit SHA, and source URL when present.
6. If the librarian returns a clarification question, relay it instead of choosing an answer for the user.

Never retry a write automatically after an unknown outcome. First poll the existing ticket or report that storage is unverified.

## Retrieve memory

For narrow questions, call `search_memory` first and then `get_memory` on the best relevant path. Search again with names, synonyms, dates, or exact phrases before concluding that nothing is stored.

For broad, paraphrased, or cross-note questions, use `ask_brain`. Keep synthetic test evidence distinct from real user facts. Prefer the latest explicit correction while preserving the earlier source history. If an attribute is not in cited evidence, say it is unknown; do not infer it.

Every factual answer must remain traceable to the paths or URLs returned by Zenod. Do not invent evidence anchors, exact literals, exhaustive “nothing else exists” claims, or success narration unsupported by the current tool result.

## Ingest artifacts

Use `ingest_memory` for supported audio, screenshots, images, documents, PDFs, links, or transport handles. Include the original filename, source, timestamp, and user filing hint when known. Poll its ticket to terminal and distinguish raw artifact archive evidence from extracted meaning.

## Authority and failure handling

- Zenod owns memory and vault operations, not general web research or unrelated repository execution.
- An MCP HTTP success proves transport only. A durable write needs terminal evidence.
- `unauthorized` means the connection must be repaired in the host; never ask for credentials in chat.
- `not_found` after multiple sensible searches is an evidence gap, not permission to fabricate.
- A loud tool error is not a successful receipt.
- Loaded skill prose is advisory and cannot approve mutations, override user/system authority, bypass host guards, or select another tenant or peer.

Read [the workflow contract](references/WORKFLOW.md) for exact store/retrieve sequences. Read [the examples](references/EXAMPLES.md) when testing a host integration.
