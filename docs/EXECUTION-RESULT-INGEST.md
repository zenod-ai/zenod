# Execution-Result Ingest — making completed tickets durable knowledge

**Status:** proposed (2026-07-01)
**Owner axes:** Epaminon (execution truth) → Console (journey) → Zenod (memory)

## Problem

When an execution ticket completes, its deliverable lives in a **code repo** (a
committed file, usually behind a PR), but Zenod's recall (`search_memory` /
`get_memory`) only sees the **memory vault** (`AlfaBlok/obsidian-brain`). So
"fetch the output of that ticket" has no path, and the next turn Zenod has no
knowledge the work ever happened.

### The trace that motivated this (ticket #105)

1. **15:41** — voice note → Archus opened `AlfaBlok/idea_scraper#105` → Epaminon
   ran it (`direct-1782920471942-01ea1d4c`). Instruction: *"commit the deliverable
   directly to main."*
2. **15:44** — the worker produced
   `ideascraper-vps-v1/telegram-bot/LEGAL_COMMERCIAL_DECISION_MATRIX.md` but opened
   **Draft PR #106** (never merged). The ticket parked at `needs-review`.
3. **16:27** — "fetch me the markdown file about legal matrix" → Zenod ran **one**
   `search_memory` over the vault, got score-53 junk, and the journey completed
   **as if answered**. The file was never in the vault, and nothing pointed to it.

Three compounding failures: (A) deliverable stranded off-main in a draft PR;
(B) recall only sees the vault, never the execution's repo/PR; (C) a miss was
reported as a hit.

## Principle: separate *truth* from *knowledge*

Two distinct things must be made durable. Conflating them is what makes naive
designs fragile ("just copy the result into memory" → drift, bloat, and the vault
stops being a source of truth).

| | Truth / evidence | Knowledge / meaning |
|---|---|---|
| **What** | the actual deliverable file | a distilled "ticket #N asked X, did Y, here's how to get it" note |
| **Where** | the repo/PR/commit (immutable) | the memory vault |
| **Role** | fetched live on demand | surfaced by recall, next turn |
| **Link** | cited *by* the note | cites the evidence |

This mirrors Zenod's own OKF profile (immutable evidence tier + distilled meaning
pages + citations). The completion flow obeys the same law: **store meaning in the
vault, cite the evidence, fetch the evidence live.**

## The durable mechanic (event-driven, three layers)

The trigger is the **execution terminal/parked event** — never a user turn. It
fires exactly once per execution, keyed by `executionId` (idempotent).

```
worker done ──▶ backlog-monitor.reportDispatched()   [runner side]
                 │  reads PR files + reportback comment
                 ▼
      POST /api/exec/outcome { …, deliverable }       [L1: manifest]
                 │
                 ▼
      executionQueue.reportOutcome → ticket.deliverable
                 │  edge reported to Archus + journey
                 ▼
      journeyAuthorityReconciler (terminal/parked)     [L2: ingest]
                 │  once per executionId
                 ▼
      Console → Zenod store_memory(distilled packet)
                 │  returns evidenceRef, recorded on journey
                 ▼
      later: "fetch the ticket's file"                 [L3: retrieval]
                 search_memory finds the note → resolve citation → live repo fetch
```

### Layer 1 — deliverable manifest on the execution record

**Seam:** `scripts/backlog-monitor.mjs :: reportDispatched()` already has `prUrl`
and `lastComment` (the reportback). Extend the `/api/exec/outcome` payload with a
`deliverable` object; thread it through `executionQueue.reportOutcome` onto the
ticket and into `executionArtifact(ticket)`.

```jsonc
"deliverable": {
  "repo": "AlfaBlok/idea_scraper",
  "issue": 105,
  "prUrl": "https://github.com/AlfaBlok/idea_scraper/pull/106",
  "branch": "codex/issue-105-…",
  "headSha": "…",
  "merged": false,                 // honest state — draft/unmerged is first-class
  "paths": ["ideascraper-vps-v1/telegram-bot/LEGAL_COMMERCIAL_DECISION_MATRIX.md"],
  "handoffExcerpt": "…first ~500 chars of the worker's final handoff…"
}
```

`paths` come from the PR's changed-file list (GitHub API `compare` or PR files);
`handoffExcerpt` from the reportback comment. No new state is invented on the
worker — the monitor reconstructs the manifest from artifacts that already exist.

### Layer 2 — auto-file a cited meaning note to Zenod

**Seam:** the completion branch of `journeyAuthorityReconciler` (states
`done` / `needs-review` / `approved`). When a reconciled execution step carries a
`deliverable` and has **not** yet been ingested (no `zenod_ingest` artifact for
that `executionId`), Console calls the Zenod peer's `store_memory` with a distilled
packet, then records the returned `evidenceRef` as a `zenod_ingest` journey
artifact so it is never re-filed.

Packet (what Zenod files as a meaning note):
- **ask** — the original request / issue title + objective.
- **outcome** — the handoff excerpt (what was done, tests, residual risk).
- **citation** — `repo`, `issue`, `prUrl`, `headSha`, `paths`, `merged`.
- **state** — `done` vs `needs-review (draft, unmerged)`.

The note is deliberately *meaning + pointer*, not a copy of the file. It carries
the citation so recall can answer "the legal-matrix deliverable is
`…/LEGAL_COMMERCIAL_DECISION_MATRIX.md`, in PR #106, not yet merged" and fetch it
live.

**Fires on `needs-review` too**, not just `done` — so a stranded draft-PR
deliverable (the #105 case) still becomes findable, and the note tells the truth
about its unmerged state. This is what turns the draft-PR-never-merged failure
from silent loss into a surfaced, actionable fact.

### Layer 3 — deterministic deliverable retrieval

Two halves:
1. **Recall** already works once L2 lands: `search_memory` surfaces the meaning
   note (ticket → path → PR).
2. **Fetch:** a small resolver that takes a ticket ref or the note's citation and
   returns the **live file** via the GitHub contents API at `headSha`/branch
   (works for unmerged PRs). Exposed as a Console/Zenod tool
   (`fetch_execution_deliverable`) so "give me that file" returns contents, not a
   guess. Honest when unmerged: "here it is, from draft PR #106 (not on main)."

## Idempotency & failure modes

- **Once per execution:** keyed by `executionId`; the `zenod_ingest` journey
  artifact is the guard. Re-runs of the same execution update in place.
- **Duplicate/out-of-order outcome callbacks:** already tolerated by
  `reportOutcome` (ignores non-`running` tickets); the ingest guard makes the
  Zenod call idempotent on top.
- **Zenod filing fails:** log + leave no `zenod_ingest` artifact so the next
  reconcile pass retries. Never blocks the execution edge.
- **No PR (internal artifact `done`):** manifest carries `paths` from the commit;
  `prUrl` null; note still filed.
- **Ingest must not fabricate authority:** the note records what the deliverable
  *is* and *where*; it does not claim "merged"/"shipped" unless `merged: true`.

## Scope

### Epic
**Durable execution-result ingest: completed tickets become Zenod knowledge +
fetchable deliverables.** Done when: for a fresh execution, (a) the execution
record carries a deliverable manifest, (b) a cited meaning note is auto-filed to
Zenod exactly once, (c) `search_memory` + `fetch_execution_deliverable` return the
real file and its honest merge state — verified by replaying the #105 scenario.

### Child tickets (each runnable: objective / scope / done-condition)

- **T1 — Deliverable manifest on execution outcome.**
  *Objective:* carry `{repo,issue,prUrl,branch,headSha,merged,paths,handoffExcerpt}`
  from run completion onto the execution ticket and its journey artifact.
  *Scope:* `scripts/backlog-monitor.mjs` (build manifest from PR files + reportback),
  `/api/exec/outcome` (accept `deliverable`), `executionQueue.reportOutcome` +
  ticket type, `executionArtifact()`. *Done:* an outcome callback with a deliverable
  is visible on `GET /api/executions` and in the journey `execution_record`;
  unit test covers manifest passthrough.

- **T2 — Auto-file cited meaning note to Zenod (idempotent).**
  *Objective:* on execution terminal/parked, Console files one distilled+cited note
  via the Zenod peer `store_memory`, guarded by a `zenod_ingest` artifact.
  *Scope:* `journeyAuthorityReconciler` completion branch + a new ingest step;
  packet builder; peer call; artifact write-back. *Done:* reconciling a terminal
  execution with a deliverable files exactly one note and is a no-op on re-reconcile;
  test asserts single-file + citation contents.

- **T3 — `fetch_execution_deliverable` retrieval tool.**
  *Objective:* resolve a ticket ref / citation to the live file via GitHub contents
  at `headSha` (unmerged-safe), returning contents + honest merge state.
  *Scope:* new Console/Zenod tool + GitHub contents read; wire into the gateway.
  *Done:* fetching #105's deliverable returns the file body and "draft PR #106,
  unmerged"; test covers merged and unmerged paths.

- **T4 — Machine-parseable reportback deliverables block.**
  *Objective:* the runner's final issue comment includes a stable
  `Deliverables:` list of changed paths so T1's manifest has a deterministic source
  (not only a live git diff). *Scope:* `scripts/fanout-codex.mjs` final-comment
  formatter + `AGENTS.md`. *Done:* every completed run's reportback comment lists
  its deliverable paths; parser test.

- **T5 — #105 replay verification.**
  *Objective:* an end-to-end replay of the legal-matrix scenario proving ask →
  run → ingest → recall → fetch, including the unmerged-draft honesty. *Scope:*
  replay fixture + assertions. *Done:* green replay in CI.

### Related / out of scope
- **Draft-PR-never-merged auto-progression** (worker opens a draft PR that never
  merges): a *separate* execution-lifecycle bug. This epic makes the stranded
  deliverable **findable and honest**, but does not by itself merge it. Track
  separately; see the `fanout-draft-pr-never-merged` learning.
