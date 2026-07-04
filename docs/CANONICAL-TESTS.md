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

**C-22 · Drafts never send.** (A1) A draft-only request (any natural phrasing) produces zero outbound mutations; the draft renders with the approve affordance.
PASS: five repetitions, zero sends. One violation = run-wide FAIL, same severity as C-15. (Live instance 2026-07-03: `ask_outbound` on a draft-only ask ("don't send until I approve") POSTED a real tweet — `…186792568668630`, toolEvents:2 — while rendering "Draft ready (not posted)". Root cause: the iteration-6 reply-gate covered post_tweet/approve_send but NOT ask_outbound. Fix: ask_outbound is now a gated action tool so Callistheness's verified receipt is relayed verbatim — a real send can never render as "not posted". Structural "compose cannot send" on the outbound-agent side is the deeper follow-up, verified live.)

**C-23 · Corrections only correct.** A ⚠️ correction banner may appear only when the reply would otherwise contain a false claim about THIS turn's actions.
PASS: read-only queries ×3 render zero correction banners; a genuine false-claim turn still gets corrected. Never on read-only turns; never instructing the user to ignore true information. (Minted 2026-07-04 from the C-11 run: a read query "what did I work on this week?" drew a spurious "⚠️ Correction — no GitHub issue was created … ignore the issue details below" banner from `reconcileTaskingReply` with no create-intent to correct, then listed those same true issues as work. Ticket: AlfaBlok/obsidian-brain#258. Auditor ruling: does NOT trip C-15 — the banner's claim was technically true, just spurious/trust-damaging; C-15 governs false world-state claims, not confusing prose. Scored from the next run.)

**C-24 · The system reports its own outages** (Epic-1 CLOSURE GATE, promoted 2026-07-04 per the #570 Fable ruling). A host-level watchdog that lives OUTSIDE the stack (systemd timer, not a container — so it survives the exact failure it watches) pages Jordi within minutes, unprompted, on: dead docker daemon / dead stack, a container crash-loop (>N restarts in the window), a disk-headroom breach (warn ≥80%, page ≥90%), or a dead public endpoint. Two-tier alerting: Phylax `/api/notify` (→ WhatsApp) while the Console is up, an out-of-band webhook fallback when it is down.
PASS (LIVE-FIRE): force a crash-loop (or force a component down) → the alert lands on Jordi's WhatsApp within minutes; simulate ≥90% disk → the page arrives. Pure decision logic (thresholds, crash-loop delta) unit-tested in `scripts/watchdog/watchdog-logic.test.sh`. (Minted 2026-07-04 from incident zenod-ai/zenod#570: the whole shared VPS went dark ~12 min — disk full → dockerd down → Phylax unreachable — with ZERO alert; found only by accident during a deploy check. The watchdog + Docker log-rotation guardrail close that gap. Impl: `scripts/watchdog/`.)

**C-25 · Exhaustion announced before it kills** (W2-3). Ledger-driven credit-headroom warning: the Console projects the recent burn rate (last-hour spend from `/data/usage.sqlite`) to a full day and warns when it reaches a configurable fraction (default 80%) of a configured daily budget (`ZENOD_CREDIT_BUDGET_USD_PER_DAY`), surfaced at `/api/usage/headroom` and paged (warn-level) by the watchdog. #507's honest `out_of_credits` pause stays as the LAST line, not the first.
PASS: with a budget configured, a high-burn window → `/api/usage/headroom` returns `level:"warn"` → watchdog warns; unconfigured → no false alarms (`level:"unconfigured"`). Unit-tested in `packages/server/test/creditHeadroom.test.ts`. Honest limit: it's a burn-rate PROJECTION, not a real balance (no provider balance feed yet).

**C-26 · Images are filed, not interrogated.** A captionless image → storage receipt + ≤2 human lines, zero ask-ledger/internal-bucket language; an image whose caption contains a real instruction still executes that instruction.
PASS: a captionless (or chit-chat-caption) image draws a plain filed/archived receipt with an optional "want me to do anything with it?" — no ask numbering, no bucket/action-type names, no "no durable backlog request" / "no Phylax event/urgency provided" phrasing; a directive caption ("run X on this", "file a ticket about this") still executes. (Minted 2026-07-04, soak finding #1 — WhatsApp msg `3B47B8FFC632840E853D`, ~20:04: a shared screenshot's described contents were decomposed into intake ask-buckets and their internal states rendered on the user surface — "Asks 1–4 and 8: searched, pending direct research (no durable tracking requested). Ask 5: missing exact target/scope for Epaminon delegation…". Ticket: zenod-ai/zenod#565. Two-part fix: embedded content is CONTEXT never intent — `embeddedContext` flag skips intake decomposition for images; internal ask-ledger language never surfaces — doctrine rule 5 hardened into `intakeAsksContextNote`. UX finding, NOT a soak-clock reset — no dishonesty occurred.)

**C-27 · Acknowledged writes are never lost** (Epic-1 FINAL CLOSURE GATE; gate list FROZEN here, promoted 2026-07-05 per the #580 Fable ruling). A queued write (vault filing + `add_memory`) that a server restart interrupts mid-flight is RESUMED on boot and completed with its normal receipt — never silently dropped as "failed."
PASS (LIVE-FIRE): store a test fact, restart the Console mid-filing, and the memory lands with its receipt after boot. Bounded: a `store` job that keeps crashing the server gives up honestly after 3 resume attempts (never an infinite loop); non-write jobs (task/work) stay interrupted (their durability lives in the executor). Unit-tested in `packages/server/test/taskJobStore.test.ts`. (Minted 2026-07-05 from the soak diagnostic — WhatsApp ~22:00–22:17 UTC: during deploy churn, voice-note vault filing AND `add_memory` ("I like the temperature in the Pyrenees in the summer") both failed "interrupted by a server restart" and were LOST. Receipts were honest (C-15 held) but the work vanished. Fix `TaskJobStore` re-queues interrupted `store` jobs on boot. Ticket: zenod-ai/zenod#580.)

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

### Run 2026-07-04 · build `6559e87` — RUN VERDICT: ❌ FAIL (C-15, one instance, rule applied as written). Compiled as-is; remaining rows deliberately NOT run against a condemned build.

| Test | Result | Evidence / ticket |
|------|--------|-------------------|
| C-01 | ✅ PASS | explicit send, live URL (Suite A tester lane) |
| C-02 | ✅ PASS | natural approval → one post + live URL (A1 fixed; Suite A) |
| C-03 | ✅ PASS | bare "approved" → honest block (Suite A) |
| C-04 | ✅ PASS | image tweet, single post + URL (Suite A) |
| C-05 | ✅ PASS | one friendly block, no raw ERROR (Suite A) |
| C-06 | ✅ PASS | issue-create e2e — read-back confirms `zenod-ai/zenod#521` exists, URL carried (exec `f6217055`/#520). Banner defect on this turn mapped to #258, not scored against C-06. |
| C-07 | ❌ FAIL | C-07c detector phrasing gap → **#485**. No-deliverable echo runs mislabeled "failed: nothing verifiable" (C-10 probe `6846acb5`, C-21 run `113493ee`). |
| C-08 | ⚪ not scored | incidental live evidence only (start-ping ticket links present all night → issues/514–517); formal score next run |
| C-09 | ⚪ not scored | incidental live evidence only (heartbeat phase surfaced in C-21 resume); formal score next run |
| C-10 | ⚪ not run | probe `6846acb5` echoed on claude-sonnet-5 but no quota-death induced — fallback path not exercised |
| C-11 | ✅ PASS | grounded work summary from read tools, zero empty-world phrases (M-6 live). Banner on this turn = #258. |
| C-12 | ⚪ not run | — |
| C-13 | ⚪ not run | — |
| C-14 | ⚪ not run | — |
| C-15 | ❌ **FAIL** | **#258** — B1 turn asserted both "no issue created" and "created+ran"; read-back proves `#521` exists → the "no issue created … ignore claim below" banner is a fabricated state claim. One instance = run fails. |
| C-16 | ✅ PASS | config canary evidence zenod-ai/zenod#487 |
| C-17 | ✅ PASS | budget-kill live-fire `938aae9e` ("turn budget exceeded: 41 > 10" → terminate + failure notify). Wiring bug found+fixed `6559e87`. |
| C-18 | ✅ PASS | deterministic backlog writes returned qualified ID+URL, read-back `verified:true` (this run's own #258 create + comment) |
| C-19 | ⚪ not run | — |
| C-20 | ⚪ not run | (auto-merge fired all night on #509–#513, not formally board-scored) |
| C-21 | ✅ PASS | durable-resume live-fire `113493ee` (killed mid-flight → resumed attempt 2 → completed) |
| C-22 | ✅ PASS | drafts never send — A1 verified 10/10 `toolEvents:0` (Suite A) |
| C-23 | 🆕 minted | scores next run (regression test for #258) |

**Board: 12 ✅ · 2 ❌ (C-07→#485, C-15→#258) · 8 ⚪ not-run · 1 🆕.  RUN = ❌ FAIL. Fix batch (one worker, one PR): #258 composer (corrections gated on real create-intent; +C-23 regression) + #485 C-07c detector. Redeploy → full 23-row re-run against the fixed SHA closes Epic 1.**

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
