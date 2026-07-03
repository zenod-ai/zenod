# Backlog — 2026-07-03 morning-trace fixes

Source: live 3-task voice-note test (4h trace) + direct verification. Score: 1/3 tasks
succeeded (Phylax send), 1 hard-failed (tweet blocked on its own approval), 1 falsely
reported done (banana9 issue confirmed NOT created — Console verified directly).
Repo: `zenod-ai/zenod` unless noted. Worker config: claude engine, `claude-opus-4-8`,
effort `low` (repo defaults; verify Dokploy env doesn't override).

Priority order below. M-1 and M-2 are the load-bearing pair.

---

## M-1 · Stateful approval token — fix the approve→send handshake  (P0)

**Bug:** the draft-approval prompt solicited "yes/approve/post now…"; the user replied
"Tweet approved"; the **peer-tool guard** (a different layer than the iteration-6 reply
gate) blocked the send 3×: *"mutating peer tools require an explicit write/run/send
instruction from the user's current message."* The guard string-matches verbs in the
current message and knows nothing about standing drafts, so the handshake dead-ends on
the very affirmation it asked for.

**Fix — approval becomes state, not vocabulary:**
1. When the assistant issues a draft-approval prompt, register a **one-time approval
   token** on the conversation (draft content-hash, tool, expiry ~15 min).
2. Guard rule becomes: explicit write verb in current message **OR** (affirmative reply
   + valid standing token). Affirmative = broad natural-language yes ("yes", "approve",
   "approved", "tweet approved", "ok go", "ship it"…), consumed on use (single-use).
3. No token + bare affirmative → renderer's honest block: "Nothing pending to approve."
4. **Retry-stop:** on the first `Blocked` from a mutating tool in a turn, stop — render
   the block once and end the turn. Never re-attempt in-turn (kills the 3× duplicate
   error bubble).

5. **Friendly block template (iteration-6 follow-up):** the reply-gate currently passes
   the raw guard string through ("ERROR: Blocked post_tweet: mutating peer tools
   require…") — honest but leaky, and it appeared tripled on live WhatsApp. The
   renderer's `blocked` state must render the human affordance instead: e.g.
   *"Draft's ready — reply 'send' (or 'approve') to post it."* Raw error stays in the
   operator log only.

**Acceptance (replay this morning's trace):** draft prompt → reply "Tweet approved" →
exactly one post with live URL from the receipt. Bare "approved" with no standing draft →
"Nothing pending to approve." A forced block renders exactly one friendly message — no
raw ERROR strings, no duplicates.

## M-2 · "Done" requires evidence — no deliverable, no checkmark  (P0, promotes #237)

**Bug:** ephemeral `…077433167` reported `✅ done` for "create issue banana9 + comment
banana8"; direct verification confirms **no issue exists**. Success was reported with
zero deliverables — the exact E1-T2/#237 deferral, now demonstrated on a real task.

**Fix:**
1. The done/completion renderer requires **≥1 verified deliverable** (issue URL, PR URL,
   commit, file link) to render "done". A terminal run with none renders:
   *"Finished but produced nothing verifiable — treating as failed. [reason/log tail]"*
   and notifies as a failure, not a success.
2. Applies to both lanes (ephemeral + fanout) and to the Phylax notification composer.

**Acceptance:** replay the banana9 dispatch → completion message either carries a real
issue URL or plainly reports failure-to-produce. `complete-no-commits`-style runs can
never render ✅.

## M-3 · Issue-create intent routes to the issue-create flow  (P0, wiring for I5-2)

**Bug:** "create issue banana9 in the Zenod repo" was dispatched as a **generic
ephemeral** whose worker has no issue-create flow — so nothing was created. The I5-2
plumbing (gh issue create + issue-URL deliverable type) exists but the intent never
reaches it.

**Fix:** router: an ask whose primary intent is issue/ticket creation on a code repo
dispatches the **issue-create worker flow** (`gh issue create -R <repo>` under runner
auth, issue URL reported as the deliverable, comment posted if requested) — never a
generic ephemeral. Combined with M-2, a silent no-op becomes impossible.

**Acceptance:** replay verbatim: "create an issue called banana9 in the zenod repo with
a comment saying banana8" → issue exists (read-back), comment present, completion
message carries the URL. Run twice with distinct titles.

## M-4 · Approval turns are cheap turns  (P2)

**Bug:** the failed approval turn cost $0.089 (62k input) — 2.3× the turn that dispatched
all three tasks. Follow-up turns re-ingest full history + tool registry to process one
word.

**Fix:** when a standing approval token exists and the inbound message is a short
affirmative, short-circuit before full-context assembly: guard + token + draft + receipt
renderer only (no full history, no full registry). Target <10k input tokens on approval
turns.

**Acceptance:** replay M-1's acceptance and assert the approval turn's usage log is
<10k input tokens.

## M-5 · Vault filing closes the loop  (P1, promotes #236)

**Bug:** storage receipt honestly said "vault filing: still processing" — but
`vaultCommits`/`vaultEvidenceRefs` were still empty 5.5 min later and no completion
receipt ever arrived. Honest pending, but the loop never closes and nobody is told.

**Fix:**
1. On vault commit completion, emit a **filing-complete receipt** through the normal
   notification path: "Filed → <page> ^<evidence-anchor> (<commit sha>)."
2. **Stuck-job watchdog:** ingest job older than N minutes (default 10) without terminal
   state → operator alert via Phylax with the job id and last state.

**Acceptance:** send a voice note with a storable fact → within the SLA receive both the
storage receipt and the filing-complete receipt with a resolving page + anchor. Force a
stuck job (pause the queue) → watchdog alert fires.

## M-6 · Read-path honesty: never conclude from a filtered-empty read  (P1, closes #234 / R17)

**Bug (iteration-6 sweep):** `execution_status` returned a filtered-empty result — the
tool itself warned "Do NOT tell the user nothing ran… broaden the query" — and the
Console still replied "No basis for priorities" / "no work ran." Pre-existing #234;
the last honesty-critical test (R17) that isn't clean.

**Fix:** when a status/read tool returns empty WITH a broadening hint (or with total>0
behind a filter), the Console must either re-query broadened or reply "I couldn't get a
reliable read" — asserting an empty world is forbidden. Same receipt principle applied
to reads: no claim without a verified read.

**Acceptance:** replay R17 ("what did I work on this week / priorities?") ×3 → every run
either grounded in real items or an explicit couldn't-read; zero "no work ran" over a
non-empty queue.

---

## Suggested execution

One worker, one PR, commits per ticket, M-1+M-2+M-3 mandatory scope, M-4/M-5 included if
clean (else file as follow-ups in the PR body). All existing suites stay green. After
deploy: re-run this morning's 3-task voice note verbatim as the acceptance sweep —
3/3 tasks must complete with receipts (Phylax send, tweet posted via "Tweet approved",
banana-style issue with URL), plus the filing-complete receipt.
