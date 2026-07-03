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

### S-8 · One front door — backlog writes are receipt-or-error, no silent routers  (P0, added 2026-07-03)
**Live evidence (Fable's own session):** the `create_issue` MCP tool acked `{"deterministic":true,
"routedBy":"backlogRouter"}` twice and filed NOTHING — Archus read-back confirmed neither ticket
existed. The working lane was `archus_request_backlog_action`. Three tools advertise the same job;
one lies by omission, and the caller has to tool-hop to get one ticket filed.
**Fix:** (a) every backlog-write lane returns qualified ID + URL (read-back verified) or an explicit
error — fire-and-forget acks abolished; (b) ONE advertised front door that routes semantically:
central backlog → Archus, target-repo work → handed to Epaminon internally, never bounced back to the
caller; (c) remove keyword/regex gating from routing and guards — semantic intent + approval state only.
**Accept:** **C-18** and **C-19** pass; replaying Fable's two `create_issue` calls yields real URLs or
loud errors; a target-repo work ticket filed through the front door lands without the caller switching
tools.

### S-9 · Auto-merge actually fires — no green PR waits for a human click  (P1, added 2026-07-03)
**Live evidence:** iteration-7's own deliverables (obsidian-brain PRs #246/#247 — docs-only drafts, nothing
failing) sat in needs-review until Jordi merged by hand, while doctrine says auto-merge on green. The fanout
summary also rendered "Deliverables: none" for a PR carrying three files.
**Fix:** (a) fan-in controller marks worker drafts ready once checks pass (or opens non-draft for docs-only
branches); (b) auto-merge on green enabled for worker PRs in BOTH repos, honoring the existing
HOLD-FOR-REVIEW escape hatch; (c) deliverable renderer counts PR paths — "none" with files present is a lie.
**Accept:** **C-20** passes — a replayed docs-only worker PR merges unattended ≤15 min after green, notify
carries the merged-commit URL, deliverables list the paths.

### S-7 · Run budgets — kill zombie runs  (P1)
Per-run budget (default: 60 min wall, 200 turns, overridable per ticket). On breach with zero verified
artifacts: terminate, render "budget exceeded, nothing verifiable, transcript: <link>", notify as failure.
**Accept:** a forced zombie run is killed at budget with the honest message + transcript link.
*New canonical test: **C-17 · Budget kill.***

---

## Sequencing

S-0 → S-1 → S-2 (needs S-1's transcripts) → S-3 (one worker) → S-4/S-5/S-6/S-8/S-9 (one worker, after
S-3 lands) → S-7. Then: full canonical run (now C-01…C-20). Green → deploy nothing, run again. Green ×2
→ epic closed.

## Worker/tester append zone (same doc, never a new file)

<!-- executors and testers: add dated entries below this line; deliverable URLs mandatory -->

### Receipt · 2026-07-03 · iteration-7 master run (issue hydration)
Tracking issues minted with verbatim acceptance criteria (S-4/S-5/S-6 pre-existing, linked not duplicated):
- S-0 · https://github.com/zenod-ai/zenod/issues/487
- S-1 · https://github.com/zenod-ai/zenod/issues/488
- S-2 · https://github.com/zenod-ai/zenod/issues/489
- S-3 · https://github.com/zenod-ai/zenod/issues/490
- S-4 · https://github.com/zenod-ai/zenod/issues/483 (pre-existing, F-1)
- S-5 · https://github.com/zenod-ai/zenod/issues/484 (pre-existing, F-2)
- S-6 · https://github.com/zenod-ai/zenod/issues/485 (pre-existing)
- S-7 · https://github.com/zenod-ai/zenod/issues/491
- S-8 · https://github.com/zenod-ai/zenod/issues/492
Council mirror (AlfaBlok/obsidian-brain): Council/{LAUNCH-CONTROL,EPIC-1-SYSTEM-STABILITY,EPIC-2-HOSTED-READINESS}.md.
Ticket *execution* (S-0 canary dispatch, S-1 runner code, S-3 re-land, S-7 budgets) requires the zenod codebase + production dispatch — pending runtime/Epaminon executor; not performable from the obsidian-brain sandbox worker.

### S-2 Verdict · 2026-07-03 · Forensic: why did the P-batch worker "die"?

**Verdict: FALSE NEGATIVE — all three runs delivered; the verifier mislabeled every one.** The P-batch
worker did not die producing nothing. It opened a real, now-**merged** PR whose URL was in its final summary.
Both "sibling failures" also completed with real, verifiable deliverables. The "45 min / 406 turns / produced
nothing verifiable" verdict was the completion verifier's error, not the executor's.

Evidence read directly from the surviving runner transcripts under
`.fanout/ephemeral/<id>/events.jsonl` (+ `prompt.md`), cross-checked against live GitHub state.

**1 · `ephemeral-1783087427475-e9692fcd` (the P-1/P-2/P-3 batch) — FALSE NEGATIVE.**
Transcript is 1448 events over 3 resume segments (186 turns, ~37.8 min summed; the run paused twice on
sub-agent `task-notification` and resumed). The final `result` event is verbatim:
> `Status: complete` … **PR:** https://github.com/zenod-ai/zenod/pull/486 — P-1 (`9d8af29`), P-2 (`562d6f4`), P-3 (`f0cd0bd`).

The transcript shows the worker actually running `git push -u origin m-batch-final-polish` and
`gh pr create … --head m-batch-final-polish`, whose tool_result returned `https://github.com/zenod-ai/zenod/pull/486`.
Live GitHub confirms: **PR #486 is MERGED** (2026-07-03T18:49:06Z), branch `m-batch-final-polish`, exactly
three commits matching P-1/P-2/P-3. The URL was present in the worker's own final answer. Real work existed;
the summary carried the URL; the verifier still scored it "nothing verifiable." Textbook false negative.

**2 · `ephemeral-1783085737906-b0b21cb9` (the #479 issue-filing run) — FALSE NEGATIVE.** Final `result`:
`Status: complete`, created execution ticket **#478**, filed bug **#479** ("WhatsApp gateway drops voice notes
longer than 5 minutes"), reported evidence as a comment. Both issues exist live (OPEN). This is the *exact*
run P-2 was written to fix: the M-2 verifier had already false-negatived it because an issue URL sat in the
handoff text, not in a structured `prUrl`/`headSha` field.

**3 · `ephemeral-1783089239412-dc654b90` (`sweep-e2` probe) — MISCLASSIFIED, not a delivery failure.** 7
events, 2 turns, 6.6 s. Final `result`: `Status: complete` — `echo "sweep-e2"` ran, engine=claude, "No repo
work was performed, per instructions." A declared-no-deliverable smoke run counted as a failure — the S-6 /
C-07c gap, not lost work.

**Root cause (named):** *not* lost context / tool auth / prompt. It is a **verifier evidence-parsing gap on
the fan-out/dispatched completion lane.** The completion verdict judged deliverables from the run manifest's
structured fields only; a PR/issue URL living in the worker's free-text final summary was invisible to it, so
"finished" collapsed to "produced nothing verifiable." P-2 (`562d6f4`, in the very PR this run produced)
already unifies the parser for the M-2 tool composer — but the forensic proves the fan-out completion verdict
that mislabeled run #1 needs the same shared parser applied to the worker's final summary, plus a regression
test replaying this run's summary. **Fix ticket minted: S-2a → https://github.com/zenod-ai/zenod/issues/496.**

Excerpts and live-state checks in this verdict are reproducible from the paths above; no production code was
changed by this forensic (read-only per scope).
