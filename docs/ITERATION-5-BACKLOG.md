# Iteration 5 — Final Stabilization Batch (three screws)

Date: 2026-07-03. Scope FROZEN: these three items only. Source: `ITERATION-4-TEST-BATCH-RESULTS.md`
review. When these land and the sweep passes at 3×, stabilization is SIGNED OFF and closed.

**Worker config (important):** run on the claude engine, model `claude-opus-4-8`, effort `low`
(this is the repo default in `scripts/fanout-codex.mjs` — verify the deployed Dokploy env does not
override `ZENOD_WORKER_MODEL` / `ZENOD_WORKER_EFFORT` away from opus-4.8/low, and fix the env if it does).

---

## I5-1 · Kill the third reply shape (fixes R1 + "Ticket opened" — one disease)

**Diagnosis:** E-1 allows exactly two reply shapes — receipt-rendered success, receipt-rendered
block/failure. Iteration 4 showed a THIRD shape still exists: optimistic narration authored by the
LLM after initiating an action ("Posting the tweet now", "Ticket opened + run dispatched") with no
receipt. Somewhere a code path still lets the model compose the user-facing reply post-action.

**Fix (structural, not per-affordance):**
1. Find every path where action-initiating turns produce user-facing text NOT emitted by the
   receipt renderer; route them all through it. After this, strings like "posting now"/"opened"
   are impossible to emit except from a verified receipt.
2. Make bare **"approve"** (and "yes" in reply to a standing draft-confirmation) a **valid write
   verb** when exactly one standing draft exists in the conversation: approve → send → receipt.
   No standing draft → receipt-rendered block: "Nothing pending to approve."

**Acceptance:**
- R1 replay ×3: every run either posts (one post, real URL from receipt) or renders the honest
  block. Grep-level guarantee: the optimistic strings cannot be produced outside the renderer.
- No path exists where the model authors post-action status text (code-review assertion + test).

## I5-2 · gh worker: make issue creation land, with the issue URL as the receipt

**Diagnosis:** iteration 4's E-4 worker dispatched cleanly (claude fallback, no App error) but
created no issue and exited "evidence: unverified — no commit/PR URL". Likely cause: the execution
evidence contract only recognizes commits/PRs as deliverables, so an issue-creation task has no way
to report success — and the worker flow (branch/commit/PR shaped) may skip `gh issue create`
entirely. Secondary suspect: gh auth volume not mounted/visible on the claude-engine path.

**Fix:**
1. Add **issue URL** as a first-class deliverable/evidence type in the worker reportback and the
   execution verifier (alongside commit/PR URLs).
2. Ensure the issue-creation worker flow actually runs `gh issue create -R <repo>` under the
   runner's existing auth, captures the returned URL, and reports it as the deliverable.
3. Verify gh auth availability on the claude-engine worker path (same volume as codex path).

**Acceptance:** "file a bug on zenod-ai/zenod" via chat → worker creates the issue → completion
reply carries the real issue URL → `gh issue view` confirms it exists. Run twice (idempotent
tickets, two distinct titles).

## I5-3 · Dispatch replies say "dispatched" until an issue-URL receipt upgrades them

**Diagnosis:** the handoff reply claimed "Ticket opened + run dispatched" before any issue existed.

**Fix:** dispatch-time reply renders only what is receipted at that moment: "Dispatched Epaminon
worker (execution <id>) — I'll confirm with the ticket link when it lands." The "opened" claim is
only ever rendered from an issue-URL receipt (arriving via I5-2's deliverable). This is I5-1's
renderer rule applied to the dispatch composer — implement together.

**Acceptance:** E-4 handoff replay: initial reply contains no "opened/created" claim; follow-up
notification carries the real issue URL.

---

## Sign-off sweep after deploy (the runner's job, unchanged rules)

- R1 ×3 (must be 3/3 under the new renderer), R2 ×1 (regression), N7 ×3, E-4 worker-route ×2
  (both issue URLs verified), E-2 ×1 (regression).
- Zero state claims without receipts anywhere — progress claims included (tightened definition,
  iteration-3 ruling).
- Pass → stabilization SIGNED OFF; close the epics with pointer comments; delete test tweets;
  return to launch work.
