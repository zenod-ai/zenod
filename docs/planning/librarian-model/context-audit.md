# Librarian context audit — 2026-09-16

Read-only source audit. Parent reports current live SHA `2a4ff6623fc6efa48355c5e697dd38c9c4833f67`. Git comparison against reviewed `961793e2f81a5ba6c9fa72636d0e3a6ff1592c5a` shows **no changes to core engine/LLM/state or server runtime/agent prompt paths**. Other release differences exist outside these relevant paths; this audit does not claim the whole releases are equivalent. References below use repository-relative file:line in `/Users/jordi/Documents/GitHub/wt-zmr-m1-idea-isolation`; no live settings/requests were fetched, so enabled external tools and configured model/step overrides remain runtime-dependent.

## Initial chat request

1. `packages/core/src/engine/engine.ts:2714–2785`: sync for read; derive conversation ID from surface/key; load prior recent window and capture tickets; append current user message; build briefing and tools; call `llm.answer`. `contextNote`, if supplied, precedes `Original user message`. A narrow existing remember/store/save/capture/log-this/that/it check can call store before answering (2737); ordinary read chat does not classify the question.
2. `packages/core/src/state/sqlite.ts:19–20,240–260`: at most **20 previous messages within48h**, same conversation ID, chronological order. Receipt-only assistant capture tickets excluded. Stored texts passed in full here: no per-message character cap or conversation summarization in this path. Older/cross-channel chats require tool lookup.
3. `state/sqlite.ts:263`: latest **10 capture tickets**, maximum20 if explicitly configured at call; engine uses default. These are typed identities, summary, evidenceRef, terminal status and time, **not transcript bodies**. Adapter instructs current/previous capture refs and delegates exact refs to connected memory Q&A; summaries are explicitly metadata (`llm/aisdk.ts:1675–1690`).
4. `engine/engine.ts:599–665`: initial briefing is persona + mandatory search/read grounding contract + two-tier/provenance/partial-read instructions + **entire vault AGENTS.md** + map of first **80 meaning pages**, each path/title/tags and summary truncated to**240chars** + last **20 Log filenames** + last **40 attachment paths**. This is a scan-derived map, not full Index.md or complete note contents. Counts/omissions are explicit. AGENTS.md, path/title/tag sizes and total composed system prompt do not have an overall character/token cap here.
5. Persona is `server/agent.ts:60–63` (“You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.”), with local project registry appended by `server/runtime.ts:665`; no backlog-router section for Zenod.

## Exact adapter prompt/message layers

`packages/core/src/llm/aisdk.ts:1691–1713` joins, in order: **vaultBriefing; optional hostInstruction; ANSWER_SUPPORT_INSTRUCTION; typed capture context; conditional task/Drive/peer instructions; tool-budget note; citation/retrieval/temporal instructions**. This becomes one system message with provider cache options. Then previous conversation messages, then current user question (`1091–1094`). SDK appends actual tool calls/results during the loop. Tool descriptions and schemas are supplied separately in the same model request.

- `aisdk.ts:1623–1648`: task capability/approval rules; connected-owner routing, exact peer identifiers, subordinate untrusted peer guidance, when available. Available connected schemas are runtime-dependent, not a static universal catalog.
- `aisdk.ts:1653–1674`: search/read early; latest-item category/order/count before topical filtering; full-note coverage or explicit partial summary; source facts/current/historical distinctions; synthetic-source labeling. These are instructions, not proofs of semantic relevance/completeness.
- `engine/answerSupport.ts:8`: select host-issued support IDs/modes, preserve attribution/negation/conditions, summaries in summaryText, IDs alone are excerpts. Host does **not** prove summary entailment.

## Model and loop

`server/runtime.ts:620–629` passes tenant/provider `model_ask`, `model_classify`, organizer effort/provider order, optional maxSteps. `aisdk.ts:644–653,1705` uses **askModel for chat and ask**, separate from organizing classify/reconcile. Organizing Luna does not by itself mean chat uses Luna. No new live model values inferred here.

`aisdk.ts:155–159,317–319,1705–1735`: default**8 model rounds**, configurable clamped**2–20**, **4096 output tokens per completion request**. Typed submission ends turn without another completion. Final read-only round allows submission; mixed chat retains action availability earlier, final round no action tools. Specific ungrounded standing-action claim can trigger a second answer call with corrective instruction (`engine.ts:2786–2795`); there is not a blanket guarantee of one8-round loop per chat.

## Tools and context arriving later

- `aisdk.ts:1757–1866`: **search_vault**, **read_note**, **list_pages**, **read_facts**, **search_entries**, **search_chats** when provided. search_vault ranked snippets are discovery only; one weak-search deterministic retry is available. list_pages returns meaning-page summaries, not source authority (`engine.ts:713–742`).
- read_note schema `aisdk.ts:63–71`: exact path, body/frontmatter, literal query≤1000chars OR cursor≤2048; **256–8000 UTF16chars/read, default8000**. Host tracks source identity, extent/version, exact anchor, omitted scope and continuation. Model sees short turn-local cursor aliases; underlying cursors/path/version still validated.
- search_entries `aisdk.ts:1845–1857`: query/source/sourceId/contentType/date/order/limit1–20/cursor/exhaustive; lexical typed filters. Shared session can auto-read at most**5 exact entries using20000bodychars total**, across repeated searches, each piece≤8000; continuation followed within that allowance (`engine.ts:2354–2355,2440ff`). These actual bodies and support hints appear after lookup, not initially. Exhaustive budget**8 catalog pages**, passage budget**64 reads** (`engine/retrievalCoverage.ts:4–5`).
- read_facts: up to**32records/24000metadatachars**, current/historical/conflict/unsupported labels and verified sources (`aisdk.ts:1833`). Actual meaning-page read may trigger source-verified temporal projection; search alone does not. Automatic fact projection budget4notes (`engine.ts:2371ff`).
- search_chats: up to**6 conversations**, message snippets≤240chars (`engine.ts:193,683–697`); state-backed running conversation, distinct from durable vault evidence.
- Chat also gets local capture/propose/execute task tools when vault/tasking exists, configured Drive tools, and discovered peer tools (`engine.ts:2744,2779`). `buildTaskTools:1006` and `aisdk.ts:1104ff` define schemas. Ask does not get these mutation/peer toolsets.
- `submit_memory_answer`, `aisdk.ts:1065–1070,1739`: at most**24 selections**, valid support-ID syntax + current/historical/prior/conflict/raw_report mode; required nullable summaryText, nonempty text≤1200 or explicit null. Host checks actual support membership/mode; text only for source passage summaries. Complete-source summary-only handle exists only after contiguous full anchored reads at one version; requires text. Registry emits≤32hints/read,≤256registered supports (`engine/answerSupport.ts:89–150`).

## Chat versus ask

`engine.ts:2258–2333`: ask has **empty conversation**, no capture-ticket context, no action/Drive/peer tools, memory_only submission scope. Ordinary ask uses same briefing/retrieval session. With≤10 exact contextRefs, host reads each entire anchored entry and puts those bodies + support IDs **in initial system context**, replacing broad briefing; instructs pinned-first. No per-entry character cap in this pinned construction. Chat does not automatically pin refs from an arbitrary user mention; it must discover/read them or use connected capability.

## Rendering/safety boundary and practical limits

`engine.ts:2544–2638`: fail-fast busy, coverage accounting, source/fact snapshot rechecks, partial/unknown guards, typed host rendering. A stale selected version yields refusal. Source summaries keep model text with host citations; facts retain canonical temporal wording. `engine.ts:2796–2830` then gives mutation receipts/approval reply gate priority and only emits final gated text (streaming buffered beforehand).

Initial context is a map plus recent dialogue—not the user's complete memory. Tools supply the source bytes. Valid citation/identity/coverage prevents invented source authority but does not establish that selected prose answers every requested clause. A reliable-basics milestone should separately prove natural discovery of the intended note, complete bounded reading, correct qualified summary, preservation of completed filing on retry, and honest visibility of unresolved source—rather than equating tool execution or filed counts with semantic success.
