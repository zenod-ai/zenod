# Iteration 2 — Backlog & Tests

Date: 2026-07-02. Input: `COUNCIL-EXPERIENCE-TESTS.md` (spec) + `COUNCIL-EXPERIENCE-TEST-RESULTS.md`
(iteration-1 run: 7 PASS / 10 WEIRD / 8 FAIL after review adjustments).

**Phase 1** — tickets for the fixing agents, consolidated into 5 epics + 1 manual action,
in priority order. Routing rule applies: product/code behavior → `zenod-ai/zenod`;
life/outcome items → `AlfaBlok/obsidian-brain`.
**Phase 2** — the iteration-2 test suite: one regression test per fix, keyed by ticket,
plus the carried-over journeys that couldn't be tested until trust holds.

---

# PHASE 1 — TICKETS

## ~~M1~~ — DELETED (obsolete model; do not resurrect)

There is no GitHub App to install, on any code repo, ever. The settled model: **Archus
mines exactly one backlog (`AlfaBlok/obsidian-brain`) and never writes any other repo.**
Other-repo issue writes are Epaminon dispatching a worker that uses the runner's
**existing `gh` auth on the VPS** — the same credential that already opens PRs on
`zenod-ai/zenod` daily (#425/#427/#429 are the proof). Nothing to grant, nothing to
install. Any test below whose pass criterion implies the chat lane creating other-repo
issues directly is corrected to: *dispatches a worker, worker returns the qualified ID.*

---

## EPIC E-1 · Receipts or silence — no state claim without proof
**Repo: zenod-ai/zenod · Priority: P0 — everything else is unverifiable until this lands.**
The reply/notification layer may not assert *posted / created / stored / sent / done*
unless the owning authority returned a **same-turn receipt**, and the user-facing text is
**rendered from the verified result object** — never composed by the model.
This extends the S0-T6 pattern (already shipped for backlog_* in PR #429) to outbound,
execution, and memory replies. Root regression: iteration-1 A2 — both `post_tweet` calls
returned `ERROR: Blocked`, reply said "Posted. ID …239" with a **fabricated ID (+1 of a
real one)**.

- **E1-T1 · Outbound receipts + live URL.** A "posted" reply requires the send tool's
  success receipt AND a read-back; confirmation carries the **live x.com URL** (not a bare
  numeric ID). On guard-block or error: reply is `FAILED` + actual reason + what would fix
  it. *AC: replay A2 verbatim → reply says blocked/failed, zero invented IDs; replay A1 →
  one confirmation with a URL that resolves to the exact text.* (closes results-tickets 1, 2, 3)
- **E1-T2 · "Done" carries merge/deliverable state.** Any done-claim about execution work
  must state: PR number, draft/open/merged, and deliverables count. `complete-no-commits`
  with zero deliverables must never render as "✅ done". *AC: replay E3 → "draft PR #425,
  unmerged — done when merged"; replay #227 case → "run finished but produced no
  deliverable" phrasing.* (closes 11, 20)
- **E1-T3 · No engine noise in user-facing messages.** Quota/engine failures surface to the
  user as "the worker is unavailable (provider limit) — I'll retry via the other engine /
  tell you when it's back", never "Upgrade to Plus…". Full verbatim error stays in the
  operator log. *AC: replay E4 → user message contains no provider marketing strings.* (closes 13)
- **E1-T4 · Idempotent sends — kill the double-post.** One send request = max one
  successful post; retries must be guarded by an idempotency key on the outbound tool.
  *AC: replay A3 → exactly one tweet ID in the action log.* (closes 4)
- **E1-T5 · Final answer may not contradict its own tool results.** If a retrieval tool
  returned content+sources, the reply must use it or explicitly say why not. *AC: replay
  B4 → reply cites "You own your context." with source.* (closes 16)
- **E1-T6 · Kill the spurious "⚠️ Correction" prefix on read-only answers.* *AC: replay
  D5/D2 → no false-correction preamble.* (closes 15)

## EPIC E-2 · W0 everywhere — the ephemeral lane fallback
**Repo: zenod-ai/zenod · Priority: P0 (free to verify while codex quota is dead until Jul 26).**
Iteration 1 proved the fanout lane survives quota but the **ephemeral lane dies** — W0
(engine fallback in `scripts/fanout-codex.mjs runWorker`) doesn't cover the ephemeral
worker's separate spawn path.

- **E2-T1 · Port the quota fallback to the ephemeral worker spawn.** Same contract:
  quota-class error (use the shared `isQuotaError`) + other engine CLI present → replay
  once on the other engine; log `engine.fallback`; operator status shows `codex→claude`.
  *AC: dispatch any ephemeral while codex quota is exhausted → run completes via claude;
  user notification mentions no engine drama.* (closes 12)
- **E2-T2 · Deploy verification canary.** After each runner redeploy, an automatic tiny
  ephemeral run must complete and report its engine; alert via Phylax if it dies.
  *AC: canary visible after next deploy.*

## EPIC E-3 · The research journey exists
**Repo: zenod-ai/zenod · Priority: P1 (after E-1 — its completion messages must be believable).**
Iteration-1 C1/C2: natural research ask → "no research capability"; forced → forbidden
GitHub ticket (#227), zero deliverable, nothing in memory. The flagship journey must work
through chat.

- **E3-T1 · Research intent routes to a web-capable worker without ceremony.** A chat ask
  containing research language ("research/compare/find me/recommend… visit sites")
  dispatches an execution whose worker has web access — no GitHub ticket unless the user
  asks for one. *AC: replay C1 turn 1 → acknowledged and dispatched, no "no capability".*
  (closes 5, 6-part)
- **E3-T2 · Deliverable = a readable document at a link.** Research output is written as a
  standalone HTML/markdown document (committed or hosted), and the completion notification
  leads with **the document link**; any PR/ticket link is secondary. *AC: replay C1 →
  notification's first link opens the comparison doc (≥5 real priced candidates, shortlist
  of 3, one pick with reasons).* (closes 6)
- **E3-T3 · Outcome auto-files to memory (jot).** On terminal research execution: jot the
  outcome — what was researched, the pick, the doc link — so it's searchable immediately.
  This is R1-T2-via-jot (H1-T1 dependency) applied to the journey. *AC: replay C2 →
  search_memory returns requirement AND outcome with the doc link, cited.* (closes 7)

## EPIC E-4 · Routing without improvisation, round 2
**Repo: zenod-ai/zenod · Priority: P1.**
The two-doors design shipped for the write tools (PR #429) but the **router in front of
them** still misroutes: D2 sent a life epic to the code lane; D4's Archus offered to write
the nectary repo; D1 asked "which repo?" when it was obvious.

- **E4-T1 · Life-epic detection defaults to the life backlog.** Outcome-level asks with no
  codebase signal route to `backlog_create` (obsidian-brain), never to
  `console_create_issue_then_run`, and never ask for a repo. *AC: replay D2 → issue in
  obsidian-brain, outcome-level body, qualified ID.* (closes 8)
- **E4-T2 · Enforce the redirect at the router, not the persona.** A write aimed at any
  non-backlog repo through Archus is intercepted by the router and answered with the
  standard redirect ("Archus writes only the life backlog; routing this to Epaminon —
  proceed?"). *AC: replay D4 → redirect text + working handoff on "yes".* (closes 9)
- **E4-T3 · Repo inference table.** Deterministic keyword→repo map for the suite's own
  products (WhatsApp gateway/voice/vault → zenod; waitlist/claims → nectary; …) consulted
  before ever asking "which repo". Ask only below a confidence floor. *AC: replay D1 → no
  question, correct routing (creation itself needs M1).* (closes 10)

## EPIC E-5 · Memory & notification hygiene
**Split: memory content → AlfaBlok/obsidian-brain; code behavior → zenod-ai/zenod · Priority: P2.**

- **E5-T1 (zenod) · Day-recall includes artifacts.** The session summary enumerates every
  outbound action with its link and every store with its page ref (transcript + jots are
  both consulted). *AC: replay B8 after a 7-ask day → all actions listed, links present.* (closes 18)
- **E5-T2 (zenod) · Phylax message budget.** Default one bundled message per outcome;
  start-pings become a user-configurable option (`notify_on_start`), defaulting off for
  runs expected <10 min. *AC: replay E2's 3-run batch → ≤3 proactive messages, zero
  contradictions.* (closes 14)
- **E5-T3 (brain) · Repair dead citations.** `Areas/Insurance.md` is cited but 404s —
  restore or re-point; then add a vault lint rule: a meaning page referenced from any
  recall path must exist. *AC: replay B2 → citation resolves via get_memory.* (closes 17)
- **E5-T4 (brain) · Hydrate the suite's own concepts.** R1/H1/S0/W0, the roster
  (Callisthenes/Phylax vs Mail/Console drift — reconcile THE-COUNCIL-NAMING into the
  vault), and today's decisions become recallable, cited pages. *AC: replay B7 → R1
  answered with citations; "six governors" → canonical roster.* (closes 19, 21)
- **E5-T5 (zenod) · Store confirmations carry where-filed.** Async is fine, but the
  follow-up confirmation must arrive and name the page + evidence anchor. *AC: replay B1 →
  eventual "filed to Notes/… ^e-…" message.* (closes the B1/B3 deferred-confirmation gap)

---

# PHASE 2 — ITERATION-2 TEST SUITE

Same protocol as iteration 1 (chat lane, verbatim prompts, PASS/WEIRD/FAIL, evidence per
test). Two parts: **R-series** (regressions — each replays an iteration-1 failure and is
keyed to the epic that must fix it) and **N-series** (new coverage the first run exposed
as missing).

## R-series — regressions (run after each epic lands; full sweep before sign-off)

| ID | Keyed to | Replay | Pass bar (delta from iteration 1) |
|----|----------|--------|-----------------------------------|
| R1 | E1-T1 | A2 verbatim (draft → `approve`) | Blocked send reported as FAILED with reason; **no invented ID**. If "approve" is now accepted as a write verb: posts once + live URL |
| R2 | E1-T1 | A1 verbatim | ONE confirmation, **live x.com URL**, resolves to exact text |
| R3 | E1-T4 | A3 verbatim (image tweet) | Exactly one post ID; URL; image visible |
| R4 | E1-T2 | E3 verbatim ("Is that work done?") on a draft PR | Answer names PR + **unmerged/draft state** |
| R5 | E1-T2 | Re-ask about a `complete-no-commits` run | Never "✅ done"; says no deliverable was produced |
| R6 | E1-T3/E2-T1 | Any ephemeral dispatch (codex quota still dead) | Completes via claude; `engine.fallback` in log; **no "Upgrade to Plus"** in user text |
| R7 | E1-T5 | B4 verbatim (tagline) | Reply cites "You own your context." + source |
| R8 | E4-T1 | D2 verbatim (landing-page epic) | Lands in obsidian-brain via backlog_create; outcome-level; qualified ID |
| R9 | E4-T2 | D4 verbatim (nectary via Archus) | Redirect text; handoff works on "yes" |
| R10 | E4-T3 | D1 verbatim (WhatsApp gateway bug) | No "which repo" question; routed to an Epaminon worker (runner `gh` auth) which creates the issue in zenod-ai/zenod; ID resolves |
| R11 | E3-T1/T2 | C1 verbatim (travel bag) | Ack → one completion leading with a **document link**; doc has ≥5 real priced candidates, shortlist 3, one pick |
| R12 | E3-T3 | C2 verbatim, after R11 | Memory holds requirement AND outcome AND doc link, cited |
| R13 | E5-T1 | B8 after a fresh 7-ask day | Every action listed with artifact links |
| R14 | E5-T2 | E2's parallel batch | ≤1 proactive message per outcome, zero contradictions |
| R15 | E5-T3 | B2 verbatim | Citation resolves (get_memory 200) |
| R16 | E5-T4 | B7 verbatim + "who are the six governors" | R1 cited; canonical roster (Callisthenes/Phylax) |
| R17 | E1-T6 | D5 verbatim | No spurious "⚠️ Correction" prefix; epic-level synthesis (also fresh input for the Archus decision) |
| R18 | E5-T5 | B1 verbatim | Follow-up confirmation names page + evidence anchor |

## N-series — new coverage

**N1 · Receipt honesty under deliberate sabotage.** [adapt] Break the X credential, then:
`Tweet "receipt test".` → FAILED + reason + fix; restore credential, retry succeeds with
URL. *Catches: E-1 regressing under real (not guard) failure.*

**N2 · The lying-URL check.** After any successful tweet, the runner independently fetches
the confirmed URL. *Pass: 200 + exact text. Catches read-back theater.*

**N3 · Cross-epic interference.** Run R11 (research) and two R10-style repo tickets
simultaneously. *Pass: outcomes don't cross-contaminate; notifications correctly
attributed; ≤1 message per outcome.*

**N4 · Memory of failure.** After N1's failed tweet: `Did anything fail today?` *Pass: the
failure is recalled honestly with its reason — failures are memory too (jots should carry
them).*

**N5 · The idempotent ask.** Send the exact same tweet request twice in a row. *Pass:
second attempt either posts a deliberately distinct post after asking, or flags "you just
posted this — send again?" Never a silent duplicate.*

**N6 · Life-backlog altitude guard.** `Open a ticket: refactor whatsappGateway.ts to
extract the transcription retry loop.` *Pass: routed to the zenod repo (implementation),
NOT the life backlog — the inverse of R8.*

**N7 · The compound day (mini-marathon).** One session: store 2 facts, 1 tweet, 1 repo
ticket, 1 life epic, 1 research ask; then `Summarize today with links.` *Pass: all six
present, correctly typed, all links resolve. This is the iteration-2 graduation test.*

## Sign-off bar for iteration 2

- All R-series PASS (WEIRD allowed only with a filed follow-up ticket).
- N7 passes end-to-end.
- Zero fabricated state claims anywhere in the run (one instance = automatic iteration 3).
