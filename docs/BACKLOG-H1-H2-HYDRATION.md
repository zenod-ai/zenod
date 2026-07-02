# Backlog — Epics H1 & H2: Always-On Memory Hydration (the jot channel)

Status: **approved design (2026-07-02), pending GitHub issue creation.**
Archus could not file these (GitHub App not installed on `AlfaBlok/backlog`); this doc is the
source of truth until the issues exist. Once the app is installed, file exactly this set.

## Context

Audit (2026-07-02): vault hydration is ~5–10% — only explicit `store_memory` calls reach the
vault. Root cause: the full librarian pipeline (classify → compose → lint → commit, ~2 min,
several LLM calls) runs per store, so filing was made rare (#68 disabled auto-filing after
flooding). Decision (Jordi): **make writes cheap instead of rare.** Nightly-cron distillation
explicitly rejected — memory must be up to date every turn, not once a day.

**Goal statement:** every turn leaves a trace; freshness comes from cheap appends; coherence
comes from lazy distillation. Capture is encouraged in prompts, not forced in code.

## Design summary

Two-tier write path:

1. **Jot** — append-only note to today's Log. Pre-synthesized by the calling agent (it already
   has the context in its window; ~50 output tokens), carries provenance (source agent, session
   key, evidence link). Zero LLM on Zenod's side. Immediately searchable (lexical over Log).
2. **Lazy distillation** — pending jots promoted into meaning pages in one LLM pass per batch,
   event-driven (volume / distill-on-read / idle), never blocking answers.

Search reads jots the instant they land: fresh ≠ distilled, and only freshness must be instant.

---

## Epic H1 — The jot channel (always-on cheap writes)

Labels: `epic` `H1` `memory` `jot`

### H1-T1 · New `jot` tool on Zenod  *(blocks R1-T2)*

Append-only write to today's Log: one-line pre-synthesized note + provenance frontmatter/tags
(source agent, session/conversation key, optional evidence link — PR URL, transcript ref).
Zero LLM calls on Zenod's side — no classify, no compose.

**Acceptance:** jot lands in Log with provenance; searchable via `search_memory` within
seconds; zero Zenod-side LLM tokens.

### H1-T2 · Commit strategy for jots  *(depends: T1)*

Decide + implement per-jot vs debounced batch commit. Default proposal: one commit per N jots
or per 60s window, one Log line per jot preserved. Durable SQLite queue before push.

**Acceptance:** ≤ ~1 commit/min under burst; no jot ever lost on crash.

### H1-T3 · Capture policy rollout — prompts, not code  *(depends: T1)*

Standing instruction in every governor persona and every Epaminon worker brief:
> "If this turn produced something with future value (decision, fact, preference, outcome,
> correction), call `jot` with a one-line synthesized note + evidence link. Before escalating
> a question to Jordi, `ask_brain` first."

Encouraged, not forced.

**Acceptance:** policy text present in all agent definitions; jots observed from ≥3 distinct
agents in a live day.

### H1-T4 · Outbound auto-jot  *(depends: T1)*

Every send (`post_tweet`, `post_reddit`, `send_email`) files a jot: what was sent, where,
link/id. One call in the send path.

**Acceptance:** a sent tweet is findable via `search_memory` minutes later.

### H1-T5 · Router hydration — top-k injection  *(depends: T1; otherwise independent)*

Council router prepends top-k lexical `search_memory` hits for the incoming message into the
routed agent's context. Lexical only (no LLM cost), size-capped.

**Acceptance:** routed agents receive relevant memory snippets without asking; verifiable in
transcript.

---

## Epic H2 — Lazy distillation (jots → meaning)

Labels: `epic` `H2` `memory` `distillation` · Depends on: H1

### H2-T1 · Batch distiller  *(depends: H1-T1, H1-T2)*

Promote pending jots into meaning pages (Areas/Projects/Notes) in **one LLM pass per batch**:
dedup repeated jots, cite back to jot evidence lines, keep existing proposal-gating for
renames/merges. Event-driven only — no schedule.

**Acceptance:** batch distilled with citations; provenance preserved.

### H2-T2 · Triggers  *(depends: H2-T1)*

(a) **Volume:** N pending jots touching one area → distill that area.
(b) **Distill-on-read:** query touches an area with pending jots → tidy after answering.
(c) **Idle sweep** as fallback.

**Acceptance:** no jot un-distilled >24h under normal load; answers never wait on distillation.

### H2-T3 · Anti-slop guards  *(depends: H2-T1)*

Distiller output passes existing lint (no orphans, valid frontmatter, in-vocab tags); jot
evidence lines immutable; human vs agent provenance preserved on meaning pages.

**Acceptance:** lint passes on every batch; provenance immutable.

---

## Amendment — R1-T2 files via the jot channel  *(depends: H1-T1)*

R1-T2 (auto-file cited note on terminal execution, see `BACKLOG-R1-R2.md`) now files through
the jot channel instead of the full store pipeline: on terminal execution event, jot the
deliverable manifest summary (what was produced, PR URL, honest merge state).

**Acceptance:** one jot call; zero extra LLM cost; deliverable findable via `search_memory`
immediately after terminal notification.

---

## Sequencing

H1-T1 → H1-T2 → (H1-T3 ∥ H1-T4) → R1-T2 → H2-T1 → (H2-T2 ∥ H2-T3).
H1-T5 independent, any time after H1-T1.

## Open decisions

- Commit granularity default (debounced batch proposed; per-jot kept as config option?).
- Router top-k injection size cap and ranking.
- Whether Phylax notifications also jot (deferred; revisit after R2).
