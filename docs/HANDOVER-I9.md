# HANDOVER — close Epic 1 at 100/100, then light the first lane

For a local Claude Code worker with repo + gh + VPS access. Fable, updated 2026-07-04 (post-A1
verification, post-WhatsApp restore). Context: `docs/CANONICAL-TESTS.md` · `docs/I8-TEST-RESULTS.md` ·
`docs/EPIC-1-SYSTEM-STABILITY.md` · `docs/LAUNCH-CONTROL.md`. Work top to bottom; every step ends with a
receipt (URL/SHA) in the epic doc's append zone. Nothing dispatches through the Zenod/Epaminon pipeline
until Epic 1 is closed — you are the worker.

## ✅ Done (receipts)

- **A1 safety gate** merged (`450b456`) and VERIFIED: 10/10 draft-only requests → `toolEvents:0`, zero
  premature sends (old bug ~50%); approve → real URL; R2 "post now" → real URL. Verdict flipped in
  `docs/I8-TEST-RESULTS.md`. C-22 chat-lane acceptance met.
- **WhatsApp notifications RESTORED** (Jordi, Dockerfile fix — channel confirmed working). C-08/C-09/
  C-12/C-14 are testable again.
- I8 engine live: durable executor #509 · typed writes #510 (typed `backlog_*` MCP tools live, silent-ack
  lane retired) · budget kill #511 · auto-merge #495.
- No tweet housekeeping required (Jordi: keep everything posted).

### Part 1 receipts (worker, 2026-07-04 — pen held until Part 1 done)
- **STEP 1 · orphans reconciled:** `ephemeral-1783121852777` (B1) and `-1783122025508` (docs) both DEAD — no PRs/branches produced (same silent-death signature). Work falls to Part 2.
- **STEP 2 · deployed SHA `8c44d89`** (runner image built 02:23:08+02:00 — the Dockerfile `COPY scripts/lib/` fix). ⚠️ #403: the runner's *volume* checkout is stale at `e89eb17` — harmless for the monitor (runs the baked image copy) but flag it for the board (a C-06/C-08 receipt could trip on it).
- **STEP 3 · notifications RESTORED (root-caused, not re-paired):** #509 added `import "./lib/durable.mjs"` but `Dockerfile.agent-runner` never copied `scripts/lib/` → monitor crash-looped `ERR_MODULE_NOT_FOUND` every 5s → dead runner → no `/api/notify`. Fixed in `8c44d89`; verified on host + WhatsApp (start+terminal pings land, with ticket links).
- **STEP 3 · C-21 durable resume — PASS (live-fire):** dispatched a multi-step run, restarted `zenod-agent-runner` mid-flight. Journal: `{launch attempt:1}` → `{resume from:"server-restart" attempt:2}` → `{launch attempt:2}`; monitor log: *"pid 4030 gone, no terminal outcome; resuming (attempt 2/3) — durable resume"* (vs the OLD orphans in the same log: *"pid gone with no outcome — reporting"*). Worker confirmed: *"resumed cleanly from the existing STEP_LOG.md … without repeating work or duplicating side effects."* (`ephemeral-1783125188617-113493ee`.)
  - Minor: that run was mislabeled "failed: nothing verifiable" — a **C-07c** detector phrasing gap ("no deliverable/PR expected" didn't trip `declaresNoDeliverableExpected`). Board radar; not a resume failure.
- **STEP 4 · budget override landed as the B1 mechanism** (per-run `budget {minutes,turns}` from task context → env fallback; `parseRunBudget` in backlog-monitor.mjs). C-17 live-fire result appended after deploy.

## PART 1 — Epic 1 to 100/100. No parked rows; everything scored for real.

**1 · Reconcile two orphaned runs** (no heartbeat since dispatch): `ephemeral-1783121852777` (B1 lane
foundation) · `ephemeral-1783122025508` (ITERATION 9 doc section). `gh pr list -R zenod-ai/zenod` +
recent branches → adopt sane PRs (review, merge on green); otherwise mark dead in the epic doc and the
work falls to Part 2. Neither blocks the board.

**2 · Deploy** latest `main` (Dokploy, clean fast-forward + rebuild). Record the deployed SHA — a board
run without a SHA doesn't count (canonical rule 2).

**3 · C-21 live-fire — runs survive redeploys.** Start a deliberately long ephemeral run (a multi-step
dummy mission). Mid-run: restart/redeploy the runner container. PASS: the run RESUMES from its durable
step log and completes with correct receipts, no duplicated side effects, transcript shows the replay
point. (#509 is the code under test.)

**4 · C-17 live-fire — budget kill.** Don't wait 60 minutes: dispatch a non-terminating dummy mission
with a small budget override (e.g. 3 min / 10 turns). PASS: terminated at the ceiling with the honest
"budget exceeded, nothing verifiable" message + transcript link, notified as a failure. (#511 under test.)

**5 · THE BOARD — full C-01…C-22 live-fire** against the deployed SHA, per `docs/CANONICAL-TESTS.md`
rules: append-only scoreboard row, receipt per test, every FAIL maps to exactly one ticket, housekeeping
section listing artifacts (expect ~2 real tweets, 1 real issue, 2 executions). C-16 evidence: zenod#487.
C-17/C-21: fresh evidence from steps 3–4. C-22: re-verify with 2 fresh drafts (`toolEvents:0`).

**6 · Close or loop.** Reds → one fix batch (from the mapped tickets) → redeploy → re-run the board.
**All 22 green = EPIC 1 CLOSED, 100/100.** Update `docs/LAUNCH-CONTROL.md`: Epic 1 → ✅ CLOSED in the
board table; history entry with SHA + scoreboard link. The ×2 confirmation rides the next routine deploy.

## PART 2 — Workstream B: the first lane alive (STRICTLY after Part 1 is green)

**7 · Land B1 — lane foundation.** If step 1 adopted its PR, verify against spec; else build: `lanes/`
dir + YAML schema (`enabled`, `trigger` cron, `mission`, `model`, `toolbelt` explicit allowlist,
`budget {minutes,turns,usd}`, `throttle`, `escalation {ring_council[], notify_direct[]}`), loader with
validation, deterministic scheduler firing enabled lanes and spawning workers through the durable
executor with EXACTLY the lane's toolbelt/budget — enforced at the gateway, not by politeness. Example
`lanes/replier.yml` committed `enabled: false`. Tests: schema validation, scheduler firing, toolbelt
scoping, budget passthrough. (The per-run budget mechanism — `parseRunBudget` — landed early in STEP 4.)

**8 · B2 — escalation wiring:** lane workers → existing `raise_event` (ring the Council) + Phylax
`notify_direct` rules read from the lane config.

**9 · B3 — graduation (minimal):** Council-callable `lane_create`/`lane_edit` that writes + commits a
lane file and returns the SHA receipt. "Make this a daily thing" = one tool call.

**10 · B4 — go live, customer #0.** Add `lanes/poster.yml` (memory-fed posting, throttled) alongside
replier. **Jordi personally flips `enabled: true` on ONE lane** — the enable-time Council decision from
the canon. Then a 3-day unattended soak: zero unauthorized sends, every action receipted, daily digest
via Phylax. Any unauthorized send = lane off, ticket filed, soak restarts.

**Exit: board 22/22 green + one lane through a 3-day clean soak = ITERATION 9 COMPLETE.** Epic 1 closed
at full strength, the architecture alive, and every hour after goes to Epic 2 — the hosted product and
the first paying customer.
