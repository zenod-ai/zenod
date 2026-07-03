# EPIC 1 · SYSTEM STABILITY — iteration 7

Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md) · Test authority: [CANONICAL-TESTS.md](CANONICAL-TESTS.md)
**Exit criterion: the canonical board green on two consecutive builds. Then this epic closes and we stop.**

Board at `4550d11`: 8✅ / 2🟡 / 5❌. Open: C-02, C-03, C-08, C-09, C-12 (❌) · C-07c, C-13 receipt (🟡).

Context that shaped this iteration: the P-batch fix worker (`ephemeral-1783087427475`, carrying P-1/P-2/P-3)
ran 45 min / 406 turns and terminated "produced nothing verifiable." Two sibling ephemerals died the same
way. The verifier net (M-2) works; **executor throughput and visibility are the bottleneck** — so they are
tickets now, not background noise.

Standing rule (Jordi, 2026-07-03): **400+ turns / 30+ min / zero output is intolerable.** See S-7.

---

## Tickets (priority order; each maps to a canonical test or creates one)

### S-0 · Engine config canary — prove the model settings work at all  (P0, trivial, run FIRST)
Dispatch the dumbest possible run per engine config in use (claude `claude-opus-4-8` effort low, codex, any
override in Dokploy env): objective "Compute 2+2. Post the result as a comment on issue <canary issue> and
state your model id and effort setting."
**Accept:** comment appears on the issue within 5 min containing `4`, model id, effort; completion notify
carries the comment URL. Run ×2 per config. Any config that can't do this is pulled from the dispatch pool.
*New canonical test: **C-16 · Config canary.***

### S-1 · Worker output is readable — live and after death  (P0)
**Fact from code:** the full worker stream ALREADY exists — every run streams `events.jsonl` in the runner
workdir (`backlog-monitor.mjs`; fanout uses `.fanout/…events.jsonl`, the controller already parses it live).
Today only a 1800-char tail surfaces, and only on failure.
**Fix:** (a) persist each run's events.jsonl to durable storage keyed by execution id (survives deploys);
(b) `execution_status` mid-run returns elapsed + phase + last N events, human-rendered; (c) on terminal
state, completion notify links the full transcript artifact; (d) stretch: live tail streamed to the run's
ticket as periodic comments, so anyone can watch what the worker is up to in near-real-time.
**Accept:** for any run (including a forced failure): mid-run status shows real progress; after terminal,
the transcript link resolves and contains the whole stream. Closes the observability half of **C-09**.

### S-2 · Forensic: why did the P-batch worker die?  (P0, uses S-1 output)
Read `ephemeral-1783087427475`'s events.jsonl (and the two sibling failures). Answer: did it produce a
branch/PR that the verifier missed because no URL appeared in the final summary (false negative), or did it
genuinely deliver nothing? One page, verdict + evidence links, appended to this doc.
**Accept:** verdict backed by transcript excerpts; if false-negative, a verifier fix ticket is minted; if
genuine, the failure mode is named (lost context? tool auth? prompt?) with one concrete fix ticket.

### S-3 · Re-land the P-batch: approval is state, blocks are friendly, status counts sends  (P0)
Re-dispatch P-1/P-2/P-3 (spec: [BACKLOG-2026-07-03-MORNING-TRACE.md](BACKLOG-2026-07-03-MORNING-TRACE.md)
M-1, C-07 verifier, M-6/C-12) as ONE worker, after S-0 proves the config and S-1 makes it watchable.
**Accept:** morning-trace acceptance replayed verbatim — "Tweet approved" → one post + live URL (**C-02**);
bare "approved" → honest block (**C-03**); blocked send → one friendly affordance, no raw ERROR (**C-05**
stays green); status counts its own sends (**C-12**).

### S-4 · Every start-ping links its ticket  (#483 / F-1)  (P1)
**Accept:** **C-08** passes — every "execution started" notification carries a resolving ticket/run link,
ephemeral included.

### S-5 · Long runs heartbeat with substance  (#484 / F-2)  (P1, builds on S-1)
**Accept:** **C-09** passes — >10-min runs emit phase/partial progress at sane cadence, unprompted.

### S-6 · Smoke runs aren't failures  (#485)  (P1)
**Accept:** **C-07c** — declared-no-deliverable runs render "completed (no deliverable expected)".

### S-7 · Run budgets — kill zombie runs  (P1)
Per-run budget (default: 60 min wall, 200 turns, overridable per ticket). On breach with zero verified
artifacts: terminate, render "budget exceeded, nothing verifiable, transcript: <link>", notify as failure.
**Accept:** a forced zombie run is killed at budget with the honest message + transcript link.
*New canonical test: **C-17 · Budget kill.***

---

## Sequencing

S-0 → S-1 → S-2 (needs S-1's transcripts) → S-3 (one worker) → S-4/S-5/S-6 (one worker, after S-3 lands)
→ S-7. Then: full canonical run. Green → deploy nothing, run again. Green ×2 → epic closed.

## Worker/tester append zone (same doc, never a new file)

<!-- executors and testers: add dated entries below this line; deliverable URLs mandatory -->
