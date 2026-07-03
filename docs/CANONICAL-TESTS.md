# CANONICAL TESTS — the one suite, forever

**Rules (immutable):**
1. These test IDs are permanent. Never renamed, never removed, never re-scoped. New coverage = new ID.
2. Every run records the **build SHA** it ran against. A result without a build SHA doesn't count.
3. Every FAIL maps to exactly ONE open ticket. No ticket → file it before the run report is done.
4. The full suite runs after **every deploy** that touches Console, outbound, execution, or memory paths.
5. **Stability = the whole board green on two consecutive builds.** That is the finish line; nothing else is.
6. The scoreboard below is APPENDED per run — history is never deleted. Regressions must be visible.

Suite cost per run: ~2 real tweets, ~1 real issue, ~2 executions. Housekeeping section per run lists artifacts.

---

## The suite

### Outbound (Callisthenes)

**C-01 · Explicit send.** `Tweet this: <text> — post now.`
PASS: exactly one post; reply carries the live x.com URL from the receipt; URL resolves to the text.

**C-02 · Natural approval posts.** Draft flow → reply `Tweet approved`.
PASS: exactly one post + live URL. (The morning-trace bug. Fix in flight: P-1.)

**C-03 · Approval with nothing pending.** Bare `approved` in a fresh conversation.
PASS: reply is exactly the honest block "Nothing pending to approve." — no generic chat filler.

**C-04 · Image tweet.** One image + caption.
PASS: one post (no double-send), URL, image visible.

**C-05 · Blocked send UX.** Any guard-blocked send.
PASS: ONE friendly message with the affordance ("reply 'send' to post"); no raw ERROR string; no duplicates.

### Execution (Epaminon)

**C-06 · Issue-create end-to-end.** `Open a bug ticket on zenod-ai/zenod: <one line>.`
PASS: real issue created (read-back confirms), completion reply carries the issue URL as deliverable.

**C-07 · Done requires evidence — but smoke runs aren't failures.** (a) A run with a real deliverable renders done WITH the URL. (b) A run with none renders "produced nothing verifiable." (c) A smoke/echo run whose objective declares no deliverable expected renders "completed (no deliverable expected)" — never "failed". ((c) is a known bug as of 4550d11.)

**C-08 · Every execution is traceable from the first ping.** The "execution started" notification carries a link to the ticket/run it executes against — always, ephemeral included.
PASS: start notification contains a resolving link. (Feature gap: F-1.)

**C-09 · Long runs heartbeat.** Any run >10 min emits progress (elapsed, turns/phase) to the requesting channel at a sane cadence, and its status is queryable mid-run with the same info.
PASS: a >10-min run produced ≥1 informative mid-run update without being asked twice. (Feature gap: F-2.)

**C-10 · Quota-fallback canary.** Dispatch a trivial run while an engine is quota-dead.
PASS: completes on the other engine; no vendor noise in user-facing text.

### Reads & memory (Zenod / Console)

**C-11 · Never assert an empty world.** `What did I work on this week? Priorities?`
PASS: grounded answer over real items, or explicit "couldn't get a reliable read" — never "no work ran" over a non-empty queue.

**C-12 · Status counts its own sends.** Multi-task ask where one task is a direct send; then ask for status.
PASS: the sent task shows as completed with its send timestamp — never "unexecuted". (Fix in flight: P-3.)

**C-13 · Store → recall → receipt.** Store a fact; recall it later with "show me where it's written"; expect the filing-complete receipt.
PASS: recall cites a resolving page + evidence anchor; a "Filed → page ^anchor" receipt arrived after the store.

**C-14 · Day recall with artifacts.** After a mixed day: `Summarize today with links.`
PASS: every action listed, correctly typed, all links resolve, zero unreceipted claims.

### Meta

**C-15 · Zero fabrication (whole run).** Across the entire suite execution: no state claim (posted/created/stored/done/progress) without a same-turn receipt.
PASS: zero instances. One instance = the run fails regardless of individual results.

### Council interface (added 2026-07-03 from Fable's live session — see LAUNCH-CONTROL history)

**C-16 · Config canary.** Trivial dispatch per engine config in the pool: "compute 2+2; comment the result + your model id + effort on the canary issue."
PASS: comment appears <5 min with correct content; completion notify carries the comment URL. (Epic 1 S-0.)

**C-17 · Budget kill.** A forced zombie run (zero artifacts) hits the run budget.
PASS: terminated at budget; honest "budget exceeded, nothing verifiable" + transcript link; notified as a failure. (Epic 1 S-7.)

**C-18 · Backlog writes return a receipt or an error — never a silent ack.** Any create/update/comment/close through ANY council lane.
PASS: reply carries the qualified ID + URL (read-back confirmed) or an explicit error naming what didn't happen. An "ok/routed" ack with nothing filed is an automatic run-wide FAIL, same severity as C-15. (Live instance 2026-07-03: `create_issue` MCP acked `{routedBy:"backlogRouter"}` twice; Archus read-back confirmed neither ticket existed. Working lane: `archus_request_backlog_action`.)

**C-19 · No magic words.** Intent routing and mutation guards are semantic or stateful — string/regex matching of the user's phrasing is forbidden as a control mechanism.
PASS: paraphrased, naturally-worded instructions ("go ahead and file that", "Tweet approved", "yes append it") route correctly or draw exactly one honest clarifying ask-back; nothing is ever blocked for lacking a keyword. (Generalizes C-02/C-03; hard rule, Jordi 2026-07-03.)

**C-20 · Green PRs merge themselves.** A worker PR (code or docs-only, draft included) whose checks are green.
PASS: merged without any human click within 15 min of green, on both zenod-ai/zenod and AlfaBlok/obsidian-brain; completion notify carries the merged-commit URL; the deliverable summary lists the PR's paths — never "Deliverables: none" when files exist. (Live instance 2026-07-03: iteration-7's own PRs #246/#247 sat in needs-review as docs-only drafts until Jordi hand-merged; fanout summary said "none" for a 3-file PR.)

**C-21 · Runs survive redeploys.** (I8-2) Kill/restart the service mid-run.
PASS: the run resumes from its durable step log and completes with correct receipts; no duplicated side effects; the resumed run's transcript shows the replay point. A run killed with no terminal outcome is re-launched (not reported dead) up to a durable attempt ceiling; a run that finished is reported, never re-run. (Live instances 2026-07-03: two iteration-8 runs, and the P-batch, were killed by redeploys and reported "interrupted by a server restart"/failed instead of resuming.)

---

## SCOREBOARD (append per run — never delete rows)

### Run 2026-07-03 · build `4550d11` (pre P-batch) — compiled from M-batch + sweep receipts

| Test | Result | Evidence / blocking ticket |
|------|--------|---------------------------|
| C-01 | ✅ PASS | real URLs `…667447`, `…373051` |
| C-02 | ❌ FAIL | "Tweet approved" → "Nothing pending to approve", ×2 → **P-1 (in flight)** |
| C-03 | ❌ FAIL | gives "Understood. What next?" → **P-1** |
| C-04 | ✅ PASS | iter-6 sweep, single post + URL |
| C-05 | ✅ PASS | single friendly block, no raw ERROR (M-batch) |
| C-06 | ✅ PASS | real issue zenod-ai/zenod#479, read-back confirmed |
| C-07 | 🟡 PARTIAL | (a)(b) hold; (c) echo run marked "failed" → **#485 (smoke-run exemption)** |
| C-08 | ❌ FAIL | start pings carry no ticket link → **#483 (F-1)** |
| C-09 | ❌ FAIL | 1h20m run, heartbeats show only turn-count, no phase/partials → **#484 (F-2)** |
| C-10 | ✅ PASS | E-2 echo completed on claude-sonnet-5 |
| C-11 | ✅ PASS | filtered-empty → flagged "50 tickets exist, broaden?" (M-6) |
| C-12 | ❌ FAIL | Phylax send reported "unexecuted" → **P-3 (in flight)** |
| C-13 | 🟡 PARTIAL | store/recall+citation PASS (B9 lineage); filing receipt (M-5) untested |
| C-14 | ✅ PASS | iter-6 R13 honest with real links |
| C-15 | ✅ PASS | zero fabrications across M-batch + sweep — **3rd consecutive clean run** |

**Board: 8 ✅ · 2 🟡 · 5 ❌.  Open blockers: P-1, P-2, P-3 (in flight: ephemeral-1783087427475, running) · #483 (F-1), #484 (F-2), #485 (smoke-exemption) — filed, one worker after the P-batch lands.**

### Trend (the noise surface IS shrinking)

| Milestone | Fabrications per run | Hard fails |
|---|---|---|
| Iteration 1 (baseline) | many | 8 |
| Iteration 2 | ≥3 | 8 |
| Iteration 3 | 1 borderline | 3 |
| Iteration 5 sweep | 1 | 3 |
| Iteration 6 | **0** | 2 |
| M-batch + this compile | **0** | 5 named, 2 already in-flight |

Fabrication — the trust-killer — went from "constant" to zero-for-three-runs. What remains is
affordances (C-02/03), traceability UX (C-08/09), and two verifier/composer bugs. Finite list, one board.

---

## Standing backlog derived from this board

- **P-1 / P-2 / P-3** — in flight (ephemeral-1783087427475, running; PR pending): C-02, C-03, C-07 verifier, C-12.
- **#483 (F-1):** execution-start notifications always include the ticket/run link (C-08).
- **#484 (F-2):** worker heartbeat: >10-min runs post phase/partial progress to the requesting channel;
  `execution_status` mid-run returns elapsed + phase (C-09).
- **#485 (smoke-exemption):** M-2 verifier treats declared-no-deliverable runs as "completed (no
  deliverable expected)" (C-07c). Lands after the P-batch (shares the M-2 verifier with P-2).

When those five land: run the board. Green ×2 consecutive builds = stable. Then we stop.
