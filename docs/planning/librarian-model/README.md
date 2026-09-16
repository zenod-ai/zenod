# The librarian prompt, context and tools

[One-slide PowerPoint](zenod-librarian-context.pptx) · [Preview](zenod-librarian-context.png) · [Line-referenced audit](context-audit.md) · [M2 milestone](../zenod-basics-m2.md)

Checked on 2026-09-16 against live health SHA `2a4ff6623fc6efa48355c5e697dd38c9c4833f67`. The relevant chat/prompt/retrieval code matches `961793e`; other release code differs. This is a source audit, not an intercepted live provider payload. Conditional tools and tenant settings depend on the runtime.

## What is actually sent

The current system prompt is assembled from several pieces. It is not one short librarian instruction.

```text
SYSTEM
  Persona: "You are Zeno, the user's personal memory agent.
            Answer questions about their knowledge vault."
  Vault briefing: grounding rules, full vault AGENTS.md, compact catalog
  Optional host instruction
  Evidence support and submission protocol
  Recent capture identities and current/previous capture rules
  Conditional task, Drive and connected-agent instructions
  Tool budget, citation, retrieval and current/historical fact rules

PRIOR MESSAGES
  Up to 20 messages from this conversation within 48 hours

USER
  Current message, optionally preceded by channel contextNote

TOOLS
  Names, descriptions and JSON argument schemas

LATER IN THE LOOP
  Actual tool calls/results, fetched source passages, cursors and support IDs
```

The compact catalog includes the first80 meaning-page summaries (up to240characters each),20 recent log filenames and40 attachment paths. Recent capture context provides ten receipt identities, timestamps/statuses and references, not full transcripts. The full vault AGENTS.md has no overall cap in this construction, and prior message texts are not individually truncated here. Therefore the prompt is only partly bounded.

The model does not automatically see every stored memory or an entire hierarchical brain. A source reference and a catalog summary tell it where to look. It must read the relevant text. Search can automatically supply up to20,000characters across five evidence entries. Individual passage reads are bounded and return continuation cursors. The default model loop has eight rounds and a4,096-output-token cap per completion; runtime overrides may alter rounds.

Chat and direct ask differ: chat includes recent dialogue, capture context and available actions. Direct ask starts without conversation history or action tools. An ask supplied with exact contextRefs gets those evidence bodies up front. A benchmark that calls only direct ask cannot establish natural follow-up behavior.

## Tools in the memory interaction

| Job | Existing tool | What it supplies or does |
|---|---|---|
| Find newest/category/date-based evidence | `search_entries` | Typed immutable-entry search and bounded actual source reads |
| Find relevant notes | `search_vault` | Ranked discovery snippets, not proof by themselves |
| Browse the brain | `list_pages` | Meaning-page summaries |
| Read evidence | `read_note` | Exact source body, version, extent and continuation |
| Read current or historical structured facts | `read_facts` | Source-backed state, conflicts and supersession |
| Recover older dialogue | `search_chats` | Bounded conversation snippets across channels |
| Store a note | `capture_note` | Existing evidence-first storage and organizing pipeline |
| Finish a grounded memory answer | `submit_memory_answer` | Selected host-issued support IDs/modes and optional summary prose |

Task planning/execution, Drive and discovered peer tools may also be offered when configured. They bring more instructions and schemas. Their exact enabled catalog was not fetched for this audit. The API tools Codex calls, such as `chat_with_zenod`, are wrappers around this model loop, not the model's own tool inventory.

The answering model uses `model_ask`. The organizer uses `model_classify`. Last verified owner settings were Grok4.3 for answers and Luna/low for organizing. Changing the organizer does not change the answering model.

## Why the current foundations still produce poor service

Source preservation and citation checks establish data custody and provenance. They do not establish that the model found the right topic, read far enough, answered every clause or resolved "it" correctly. The September15 follow-up had a valid continuation but stopped before the requested content. The September16 screenshot shows an analysis request receiving a generic verification refusal; the exact runtime cause has not yet been traced.

The support protocol is currently organized around source-backed statements and summaries. M2 must prove that an opinion/analysis request can use grounded premises and then give clearly identified analysis. We must not solve this by treating speculation as a stored fact or simply disabling evidence checks.

## Proposed simple contract for M2

This is a target prompt contract, not a claim that the following text is deployed:

> You are the user's memory librarian. Help them save information, recall it and think about it.
>
> Resolve references such as "it", "that note" and "the second option" from recent conversation and capture references. Ask one brief clarification only when the target is genuinely ambiguous.
>
> When asked to remember something, preserve the original evidence and report the actual saved or pending state. Keep completed work when retrying. File independent ideas separately and expose unresolved ones.
>
> For recall, find the intended source and read enough to answer the question. Follow continuations or find a relevant passage. Preserve uncertainty, corrections, amounts and dates. Cite supporting evidence. Do not claim absence from a partial search.
>
> Answer the user's question directly. When asked for an opinion, ground the factual premises in the note and distinguish your analysis from what the user said. Do not require the opinion itself to already exist in memory.
>
> Use the smallest sufficient tool sequence within the budget. If evidence or context is missing, explain the specific gap. Never claim a write, action or complete read that did not happen.

Keep mechanical limits, ID validation, authorization and idempotency in the host. Expose a small memory tool set by default; attach other capabilities only when needed. First measure current behavior with the frozen suite, then make the smallest changes justified by its failures.

Source anchors: [engine context](https://github.com/zenod-ai/zenod/blob/2a4ff6623fc6efa48355c5e697dd38c9c4833f67/packages/core/src/engine/engine.ts#L599), [chat](https://github.com/zenod-ai/zenod/blob/2a4ff6623fc6efa48355c5e697dd38c9c4833f67/packages/core/src/engine/engine.ts#L2714), [prompt assembly](https://github.com/zenod-ai/zenod/blob/2a4ff6623fc6efa48355c5e697dd38c9c4833f67/packages/core/src/llm/aisdk.ts#L1691), [source-support protocol](https://github.com/zenod-ai/zenod/blob/2a4ff6623fc6efa48355c5e697dd38c9c4833f67/packages/core/src/engine/answerSupport.ts#L8).
