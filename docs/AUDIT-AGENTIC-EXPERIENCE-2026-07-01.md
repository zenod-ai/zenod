# Agentic-Experience Audit — Console design, agent handover, live WhatsApp traces

**Date:** 2026-07-01
**Method:** design review (SUITE-AGENT-PATTERN, SUITE-SCAFFOLD, EPAMINON-ARCHUS-PROTOCOL, EXECUTION-RESULT-INGEST) + code map (Console gateways, mesh, execution lane) + live evidence: 24h WhatsApp transcript (`get_recent_conversation_transcript`), LLM ledger (`read_llm_timeline`), and the full execution queue (`execution_status`, 49 tickets).

---

## 1. What the last 24 hours actually looked like

The trace window covers one real working day: the Telegram-bot health investigation (`idea_scraper#102`, three executions), the legal/commercial decision matrix (`#105`, two runs, PRs #106/#109), the meta-ticket about result visibility (`#103` → PR #104), plus recall questions ("what have we been doing", "fetch me the legal matrix markdown").

The pipeline **works**: voice note → ticket → dispatch → worker → PR → notification, often inside 5 minutes. That is the good news. The leaks are all in the *seams* — what the user is told, when, how many times, and whether the system remembers what it just did.

### The #102 saga (worst single trace)

1. 14:33 — voice note: "go into the Dokploy logs of the telegram bot, fix, merge." Ticket #102 minted, dispatched. ✅
2. Reply arrives **prepended with "⚠️ Correction — don't rely on the run/pickup claim below"** followed by "✅ … now running". One bubble, contradicting itself.
3. 14:38 — blocked: `needs-log-access`. Blocker question **truncated mid-word** ("no bot secrets (TELEGRA"). Sent twice (two recipients).
4. 15:51–15:52 — user sends two voice notes ("re-run it, you DO have access"). Each note independently triggers a re-run → **two sibling executions** on the same issue, racing.
5. 15:57 — both block with the same `needs-host-access` answer → **4 blocked notifications**.
6. 15:59 — the single fan-out run opens PR #107 and the completion event is broadcast **once per execution ID × per recipient = 6 "✅ ready for review" messages**, for executions announced blocked two minutes earlier. Blocked → ✅ with no explanation.
7. Net: the user was told 14 things about one task, several contradictory, and the task itself never got what it needed (the worker genuinely has no VPS host access — see Leak 5).

### The #105 recall failure (already spec'd, confirming it live)

Worker produced `LEGAL_COMMERCIAL_DECISION_MATRIX.md` in **draft PR #106**. 40 minutes later: "fetch me the markdown about legal matrix" → Zenod searched the vault only, found nothing, and offered to *create* the file — the Console had itself announced that PR two hours earlier. This is exactly [EXECUTION-RESULT-INGEST.md](EXECUTION-RESULT-INGEST.md) (spec'd, not built).

### The user told us the requirement, verbatim

The 14:46 voice note (which became #103) is the product spec in the user's own words:

> "when Epaminon finishes … a brief summary of hey, this was done, here is the ticket … what did he do, was it successful, problems, learnings … something needs to bubble back up for me … the write-up belongs in the issue itself, and the agent should retrieve it from GitHub and make a small summary back for me."

Today the terminal notification is a bare link (`✅ … ready for review: <PR url>`). No summary, no learnings, no honest merge state.

---

## 2. Leak inventory

Ranked by user pain. Each: symptom (from trace) → root cause (component) → fix.

### Leak 1 — Execution results never become knowledge or narrative *(critical)*

- **Symptom:** legal-matrix file undiscoverable (#105); terminal notify is a bare PR link; "what have we been doing" answers reconstructed from chat context, not from execution records.
- **Root cause:** no result ingest (spec exists, unbuilt); `notifyOwner` completion message built from execution ID + evidence URL only — the worker's handoff comment (which contains exactly the summary the user wants) never travels back into chat or vault.
- **Fix:** build the ingest epic T1–T5 as spec'd, **plus** change the terminal notification to carry `handoffExcerpt` + honest merge state ("draft PR #106, **not merged**"). The manifest (T1) and the notification body share the same source; do them together.

### Leak 2 — Notification storm: duplication, contradiction, truncation *(critical)*

- **Symptom (trace):** every event × 2 recipients; fan-out run events re-broadcast per sibling execution (6 ✅ for one PR); ✅ sent minutes after ⛔ for the same run with no reconciliation; blocker question cut mid-word; "🤖 working on…" + "✅ Task received" + "Storage receipt" = 3 bubbles for one voice note.
- **Root cause:** notifications are emitted point-to-point from wherever an event happens (`executionLane` report path, gateway, filing worker), keyed by `executionId` not by `(issue, fanoutRunId, event)`. No dedup, no ordering, no length budget for the *payload* (the header is preserved, the actionable question is truncated).
- **Fix:** **one notification authority.** You already designed it — Phylax. Route every proactive event through a single choke point that: (a) dedups on `(target-issue, runId, eventType)`; (b) enforces state-machine ordering — a run that reported `blocked` cannot emit ✅ without an intermediate "unblocked because…" line; (c) never truncates the blocker question (it's the only actionable content — truncate the boilerplate instead); (d) coalesces sibling-execution events into one message; (e) owns the recipient list. This converts ~14 messages in the #102 saga into ~4.

### Leak 3 — Re-runs mint sibling executions on the same issue *(high)*

- **Symptom:** two voice notes 8s apart → executions `8b71434b` and `05cb4557`, both on #102, both dispatched, both blocked identically, doubling every downstream message.
- **Root cause:** `run_issue`/re-run path has no single-flight guard per target; each inbound message is handled independently and the fast-lane happily enqueues.
- **Fix:** Archus enforces **one active (non-terminal) execution per `owner/repo#N`**. A run request while one is active *attaches context* to the existing execution (append to run context / issue comment + poke) instead of minting a sibling. This is also the correct semantic for what the user meant ("re-run it *with this new context*").

### Leak 4 — The grounding guard argues with its own message *(high)*

- **Symptom:** "⚠️ Correction — do not rely on any claim below…" prepended to a reply that then says "✅ now running", and to an innocent "last few days" recap. Three occurrences in 24h.
- **Root cause:** commit `465ae48` grounds status claims via `execution_status`, but the guard is a **post-hoc banner** stapled above the drafted text rather than a gate that fixes the draft. When evidence is merely *missing* (not contradicting), it still fires.
- **Fix:** make grounding a pre-send rewrite: if the claim can't be evidenced, rewrite the sentence ("dispatched — pickup not yet confirmed") or fetch `execution_status` in-turn and state what it returned. Never ship claim + disclaimer in the same bubble. A reply that contradicts itself costs more trust than either alternative.

### Leak 5 — Dispatch is blind to worker capabilities *(high)*

- **Symptom:** a task that requires VPS host access (Dokploy logs, mounted DuckDB, service env secrets) was dispatched to the fan-out sandbox **three times**, blocking identically each time, while the user insisted "you are literally on the host." Both sides were right: the runner container is on the VPS, but the fan-out worker sandbox has no SSH alias, no service secrets, no DuckDB mount.
- **Root cause:** no capability model. Archus/Epaminon mint and dispatch on issue text alone; the worker discovers the mismatch at runtime and can only emit `blocked`.
- **Fix:** (a) each worker lane declares a **capability manifest** (repo-only / network / host-mounts / service-secrets); (b) intake tags tasks that need host access (heuristic: mentions of logs, Dokploy, containers, mounted files) and Epaminon refuses-fast at dispatch with an honest "this needs the host lane, which doesn't exist yet" — before the user waits; (c) actually build the host lane: a worker profile that runs with the Dokploy socket/log access and the service env (this is the recurring troubleshooting scenario — it happened "yesterday, no problem" via a different path, so capture that path as the lane). Also store the learning the user explicitly requested ("if this is not a z0 memory yet, it needs to be") so the next run self-serves.

### Leak 6 — Everything parks at `needs-review`; draft PRs strand deliverables *(high)*

- **Symptom:** PRs #95, #104, #106, #107, #109 — all `needs-review`, none merged, despite instructions like "commit directly to main" / "merge so it triggers redeploy." Known failure mode (`fanout-draft-pr-never-merged`).
- **Root cause:** ship stub (#197) only recognizes already-merged PRs; workers open draft PRs by convention; nothing carries the user's pre-authorization ("merge it") into the lifecycle.
- **Fix:** thread a `shipPolicy` on the execution ticket, set at mint time from user intent (`review` | `auto-merge-on-green`). With `auto-merge-on-green`: worker opens a *ready* PR, monitor merges when checks pass, ✅ notification then means shipped. Keep `review` as default for outward/irreversible work. This closes the loop the user keeps asking for ("finished = merged and deployable to test").

### Leak 7 — Interrupted executions are permanently lost *(medium)*

- **Symptom:** 8 of 49 queue tickets terminal-blocked with "interrupted by a server restart" — every deploy strands in-flight runs; nobody is told.
- **Root cause:** no resume/requeue on startup (issue #85); report path Epaminon→Archus is best-effort (timeout → warning log → state stuck "running" forever).
- **Fix:** startup reconciler: any `running` ticket with no live worker → requeue (idempotent branch naming already exists) or mark blocked *with a notification*. Wrap `reportToArchus` in a durable outbox (retry with backoff, journal unsent events) so a restart can't eat a state transition.

### Leak 8 — The filing lane stalls silently; receipts never resolve *(medium)*

- **Symptom:** every voice note gets "Vault filing: still processing; no final vault receipt yet" — and no final receipt ever arrives in-window. Meanwhile `read_llm_timeline` shows **only `answer` operations** in 24h: filing/digest/librarian work is either not running or not metered.
- **Root cause:** async store jobs report only if polled (`get_task_result`); no terminal receipt push; filing ops missing from the usage ledger so the stall is invisible even to forensics.
- **Fix:** guarantee a terminal receipt (success or failure) per filing job — pushed through the same Phylax pipe, coalesced (one receipt per note, or a daily digest, not a bubble per voice note — see Leak 9); meter every engine operation (`file`, `digest`, `transcribe`) in usage.sqlite so an empty timeline means "nothing ran," which right now it can't.

### Leak 9 — Receipt noise drowns the signal *(medium, UX)*

- **Symptom:** each voice note produces reply + "🤖 working" + storage receipt (+ blocked/✅ later). The transcript is majority ceremony.
- **Fix:** storage receipts are Drive links the user almost never needs in the moment — collapse to a single line appended to the substantive reply, or move them to an on-demand tool ("where's the audio for X?") and a daily digest. Keep the *failure* case loud (filing failed → notify), the success case quiet. This matches the existing doctrine ("filing is automatic/transparent; errors only").

### Leak 10 — Voice-note artifacts are enshrined verbatim in tickets *(low)*

- **Symptom:** ticket #93's body contains "a panminon", "codec's", "dog ploy" — mis-transcriptions committed as the permanent work spec. Workers must reverse-engineer them.
- **Fix:** a normalization pass at intake using the known glossary (Zenod, Codex, Claude, Epaminon, Dokploy, DuckDB…) applied to *ticket bodies only* — keep the verbatim transcript as the linked evidence (Drive/vault), normalize the operative text. Cheap, deterministic, zero-LLM.

### Leak 11 — Observability stops at the LLM ledger *(low, but caps everything else)*

- **Symptom:** you can see cost per LLM call and the WhatsApp transcript, but not: which tools a turn called, peer request/response, queue transitions over time, or worker-side spend. Diagnosing #102 required correlating three sources by timestamp.
- **Fix:** add a `tool_calls` ledger (turn id, tool, args digest, ok/error, latency) alongside usage.sqlite, and stamp a `turnId` across transcript ⇄ usage ⇄ tool ledger so one query reconstructs a turn. This is the substrate every other fix gets verified against.

---

## 3. Architecture recommendations (priority order)

The theme across every leak: **the plumbing between agents is event-rich but meaning-poor, and events reach the user raw.** Tighten by inserting two authorities that already exist in the design but aren't load-bearing yet — Phylax (outbound attention) and the journey reconciler (result meaning) — and by making dispatch capability-aware.

1. **R1 — Ship the ingest epic + rich terminal notifications** (Leak 1). T1–T5 from [EXECUTION-RESULT-INGEST.md](EXECUTION-RESULT-INGEST.md), extended: the terminal notify carries handoff summary + honest merge state. *Done when:* the #105 replay passes and a fresh execution's ✅ message contains what/outcome/state/link.
2. **R2 — Phylax becomes the single notification authority** (Leaks 2, 8, 9). All proactive sends route through one dedup/order/coalesce/compose point; state-machine ordering (no ✅ after ⛔ without an unblock line); blocker questions never truncated; receipts coalesced. *Done when:* replaying the #102 event stream yields ≤4 messages, none contradictory.
3. **R3 — Single-flight executions per issue** (Leak 3). Re-run = attach context + poke, not sibling mint. Enforced in Archus (`queue_execution` contract), not prose.
4. **R4 — Worker capability manifests + host lane** (Leak 5). Declare envelopes, refuse-fast on mismatch at dispatch, and stand up the host-access worker profile for the recurring "investigate the live service" scenario. Store the runbook as Zenod memory.
5. **R5 — Grounding as pre-send rewrite, not banner** (Leak 4). The guard edits or evidences the claim; it never disclaims it.
6. **R6 — Ship policy on the ticket** (Leak 6). `review` vs `auto-merge-on-green`, set from user intent at mint; closes draft-PR stranding and makes "ready to test" true.
7. **R7 — Durable lane: startup requeue + report outbox** (Leak 7). Deploys stop eating runs.
8. **R8 — Turn-stamped tool/ops ledger** (Leaks 8, 11). Meter everything; one `turnId` joins transcript, usage, tools.
9. **R9 — Intake normalization glossary** (Leak 10). Deterministic find/replace on ticket bodies; verbatim transcript stays as evidence.

### Suggested sequencing

R1+R2 are the experience; do them first and the daily feel changes immediately (results bubble up, noise drops ~70%). R3–R5 kill the trust-eroding contradictions and dead-end retries. R6–R7 make "done" mean done. R8–R9 are enablers/polish.

---

## 4. What is already right (don't touch)

- Ticket-backed one-offs (no issue-less executions) — the #102/#103/#105 chain is fully traceable *because* of this.
- The deterministic lane (no LLM on state reports) — every failure above was observable precisely because the lane writes facts.
- Durable ledgers + `read_llm_timeline`/`get_recent_conversation_transcript` — this audit was possible from a laptop without SSH; that is the payoff of the forensics work.
- Fast-lane intake — "I added a comment on 105, take another pass" → re-queued and PR'd in under 5 minutes. When the seams hold, the core loop is genuinely fast.
