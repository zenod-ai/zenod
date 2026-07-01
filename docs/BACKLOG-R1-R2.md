# Backlog — R1 (result ingest + rich terminal notify) and R2 (notification authority)

**Date:** 2026-07-01
**Source:** [AUDIT-AGENTIC-EXPERIENCE-2026-07-01.md](AUDIT-AGENTIC-EXPERIENCE-2026-07-01.md) (Leaks 1, 2, 8, 9) and [EXECUTION-RESULT-INGEST.md](EXECUTION-RESULT-INGEST.md).
Every ticket below is written agent-runnable (objective / scope / done-condition) per backlog doctrine. Intended home: `zenod-ai/zenod`. Suggested labels: `epic` on E-tickets, `stability`, `owner:agent`.

**Ordering:** R1-T1 → R1-T4 → R1-T6 → R1-T2 → R1-T3 → R1-T5, then R2-T1 → R2-T2 → R2-T3 → R2-T4 → R2-T5 → R2-T6. R1-T1 and R2-T1 are the two load-bearing refactors; everything else layers on them. R1 and R2 are independent epics and can run in parallel.

---

## Epic R1 — Execution results become knowledge and narrative

> **Objective:** when an execution reaches a terminal/parked state, (a) the user's notification says what was done, how it went, and its honest merge state — not just a link; (b) a cited meaning note lands in the Zenod vault exactly once; (c) the deliverable file is fetchable on demand.
> **Done when:** the #105 legal-matrix replay passes end-to-end: ask → run → terminal notify with summary + "draft PR, unmerged" → `search_memory` finds the note → `fetch_execution_deliverable` returns the file body.

### R1-T1 — Deliverable manifest on execution outcome
- **Objective:** carry `{repo, issue, prUrl, branch, headSha, merged, paths[], handoffExcerpt}` from run completion onto the execution ticket and its journey artifact.
- **Scope:** `scripts/backlog-monitor.mjs::reportDispatched()` (build manifest from PR changed-files + reportback comment); `/api/exec/outcome` payload; `executionQueue.reportOutcome()` + ticket type; `executionArtifact()`. No new worker-side state — reconstruct from artifacts that already exist.
- **Done:** an outcome callback with a deliverable is visible on `GET /api/executions` and in the journey `execution_record`; unit test covers manifest passthrough including the no-PR (commit-only) case.

### R1-T2 — Auto-file cited meaning note to Zenod (idempotent)
- **Objective:** on execution terminal/parked (`done` / `needs-review` / `failed`), Console files one distilled note (ask / outcome / citation / honest state) via the Zenod peer `store_memory`, exactly once per `executionId`.
- **Scope:** `journeyAuthorityReconciler` completion branch; packet builder; peer call; `zenod_ingest` journey artifact as the idempotency guard; retry-on-next-reconcile when the Zenod call fails (no artifact written). Fires on `needs-review` too — stranded drafts must be findable. Never claims merged unless `merged: true`.
- **Done:** reconciling a terminal execution with a deliverable files exactly one note and is a no-op on re-reconcile; test asserts single-file + citation contents + unmerged honesty.

### R1-T3 — `fetch_execution_deliverable` retrieval tool
- **Objective:** resolve a ticket ref or meaning-note citation to the live file via the GitHub contents API at `headSha`/branch (works for unmerged PRs), returning contents + honest merge state.
- **Scope:** new Console/Zenod tool; wire into the mesh gateway; resolver accepts `owner/repo#N`, `executionId`, or explicit citation.
- **Done:** fetching #105's deliverable returns the file body and "draft PR #106, unmerged"; test covers merged and unmerged paths and a deleted-branch fallback (fetch at `headSha`).

### R1-T4 — Machine-parseable `Deliverables:` block in worker reportback
- **Objective:** the runner's final issue comment includes a stable `Deliverables:` list of changed paths + a ≤500-char summary block, so R1-T1's manifest has a deterministic source (not only a live git diff).
- **Scope:** `scripts/fanout-codex.mjs` final-comment formatter (and the Claude-worker equivalent); `AGENTS.md` contract; parser in `backlog-monitor.mjs`.
- **Done:** every completed run's reportback comment lists deliverable paths + summary; parser unit test; a run with no file changes emits `Deliverables: none`.

### R1-T5 — #105 replay verification (end-to-end)
- **Objective:** a replayable end-to-end test of the legal-matrix scenario proving ask → run → manifest → ingest → recall → fetch, including unmerged-draft honesty and the enriched terminal notification (R1-T6).
- **Scope:** replay fixture + assertions; runs in CI against stubbed GitHub/worker.
- **Done:** green replay in CI; asserts exactly one vault note, notification body contains summary + merge state, fetch returns file body.

### R1-T6 — Terminal notification carries summary + honest state
- **Objective:** replace `✅ <executionId> — ready for review: <url>` with a composed message: what was asked (issue title), what was done (`handoffExcerpt`), honest state ("draft PR #106 — **not merged**" / "merged to main" / "blocked: <full question>"), and the link.
- **Scope:** the terminal-notify call site in `executionLane.ts` / journey monitor; consumes R1-T1's manifest; ≤900 chars body budget with the summary prioritized over boilerplate. (Delivery/dedup mechanics belong to R2 — this ticket only fixes the *content*.)
- **Done:** a fresh execution's terminal WhatsApp/Telegram message contains issue title, ≥1 sentence of handoff summary, and the true merge state; snapshot test on the composer.

---

## Epic R2 — Single notification authority (Phylax pipe)

> **Objective:** every proactive outbound message flows through one choke point that dedups, orders, coalesces, and composes — so one task produces a handful of coherent messages instead of a contradictory storm.
> **Done when:** replaying the recorded `idea_scraper#102` event stream (3 executions, 1 fan-out run, 2 recipients, blocked→PR sequence) emits ≤4 messages, none contradictory, blocker question untruncated.
> **Design decision (encoded here):** build the authority as a **Console module behind the existing `POST /api/notify` pipe**; migrating it into the Phylax agent is a later, separate move. Noise reduction must not wait on standing up a fifth agent.

### R2-T1 — Notification event bus: one ingress for all proactive sends
- **Objective:** no call site sends directly via `whatsapp.notifyOwner()` / `telegram.notifyOwner()`; all proactive sends emit a structured event `{eventType, targetIssue?, executionId?, runId?, severity, payload, dedupeKey?}` to a single `notify(event)` API.
- **Scope:** define the event schema; refactor all emit sites — `executionLane.ts` (start/blocked/terminal), journey monitor, filing/storage-receipt worker, gateway error paths — to emit events; `/api/notify` becomes the external ingress for the same bus. Pure refactor: pass-through behavior, message content unchanged.
- **Done:** grep shows zero direct `notifyOwner` calls outside the bus module; all existing notification tests still pass; every event is journaled to a `notifications` table (id, event, composedText, recipients, sentAt, status) in `/data`.

### R2-T2 — Dedup + coalescing keyed by (target, runId, eventType)
- **Objective:** the same underlying fact is announced once. Sibling executions on one issue sharing a fan-out run collapse into one message; recipient list is owned centrally, not by call sites.
- **Scope:** dedupe window keyed `(targetIssue ?? executionId, runId ?? '-', eventType)`; coalescer that folds N sibling-execution events arriving within a short window into one message listing the executions; recipient policy in settings.
- **Done:** replay of the #102 stream produces one "blocked" and one "terminal" message instead of 4 + 6; unit tests for the key, the window, and sibling folding; journal records suppressed duplicates with a `suppressedBy` pointer.

### R2-T3 — State-machine ordering guard per run
- **Objective:** never emit ✅ after ⛔ for the same run without explaining the transition; never emit stale events.
- **Scope:** track last-emitted state per `(targetIssue, runId)`; legal emission transitions mirror the execution state machine; a terminal event arriving after a blocked emission composes as "previously blocked (<reason>) — now completed: …"; events older than the last emitted state are dropped (journaled as stale).
- **Done:** test: blocked-then-terminal sequence yields a terminal message containing the unblock explanation; terminal-then-late-blocked yields no second message.

### R2-T4 — Composer with a no-truncation guarantee for actionable content
- **Objective:** the actionable core of a message (blocker question, error, decision ask) is never cut; boilerplate (headers, IDs, repeated links) is what yields to the channel length budget.
- **Scope:** composer with content priority tiers (actionable > summary > metadata); per-channel budgets (WhatsApp/Telegram); full blocker text always included, splitting into a follow-on message if needed; execution IDs demoted to a short suffix.
- **Done:** the #102 blocked event composes with the complete "no SSH route… no bot secrets (TELEGRAM/OPENROUTER/…)" question; snapshot tests; property test that `actionable ⊆ composed` for arbitrary payload lengths.

### R2-T5 — Receipt policy: quiet success, loud failure
- **Objective:** storage/filing receipts stop being one bubble per voice note. Success is a single line folded into the substantive reply (or omitted); failure notifies immediately; "still processing" is never the last word — every filing job emits a terminal receipt event (success or failure) into the bus.
- **Scope:** filing/store worker emits `filing.completed` / `filing.failed` events; composer folds success receipts into the reply for the same inbound message when available, else suppresses to the journal; failures compose as their own high-severity message. Requires the filing lane to actually report terminally — includes fixing the currently-stalled "no final vault receipt" path and metering filing ops in `usage.sqlite` so a stall is visible in `read_llm_timeline`.
- **Done:** a voice-note turn produces at most 2 messages (reply, and terminal notify if an execution was started); a simulated filing failure produces a visible failure message; filing operations appear in the LLM timeline.

### R2-T6 — #102 replay verification (end-to-end)
- **Objective:** an end-to-end replay of the recorded 2026-07-01 #102 event stream through the bus proving the epic's done-condition.
- **Scope:** fixture built from the real journaled events (3 executions, duplicate re-runs, blocked ×2, PR #107 terminal ×3, 2 recipients); assertions on count, ordering, contradiction-freedom, truncation.
- **Done:** green replay in CI: ≤4 messages, blocked question complete, terminal message references the prior block, single recipient-set expansion.

---

## Explicitly out of scope (tracked elsewhere)
- Single-flight executions per issue (audit R3) — removes the *cause* of sibling storms; R2-T2 removes the *symptom*. Both wanted.
- Draft-PR auto-merge / ship policy (audit R6, #197).
- Startup requeue + report outbox (audit R7, #85).
- Moving the notification authority from Console module into the Phylax agent.
