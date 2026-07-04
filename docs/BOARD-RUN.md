# BOARD RUN — full canonical live-fire, C-01…C-22

Tester runbook. You are the TESTER, not the fixer: score with receipts, fix nothing (rule exception:
none). Every claim needs a same-turn receipt; one fabricated claim anywhere = the run fails (C-15).
Authority: `docs/CANONICAL-TESTS.md`. Expected build: **`6559e87`** — verify, don't trust this doc.

## 0 · Pre-flight

- **0.1** Verify the deployed SHA on the VPS (app container + runner image). Record it — a run without a
  build SHA doesn't count. If it isn't `6559e87`+, stop and report.
- **0.2** Channel check: trigger a Phylax test ping → confirm it lands on Jordi's WhatsApp.
- **0.3** Radar (expected trouble, score honestly if hit): #403 stale runner *volume* checkout
  (`e89eb17`) may affect worker checkouts · C-07c detector phrasing gap (known, may FAIL → ticket).
- **0.4** Banked evidence you may cite without re-firing (note SHA on the row):
  **C-17** budget-kill live-fire PASS on `6559e87` (`ephemeral-1783126896084`: journal budget-kill
  41>10, monitor "terminating pid 846", ⛔ WhatsApp + transcript link) · **C-21** durable-resume
  live-fire PASS (`ephemeral-1783125188617`: attempt:2 "resuming", no dup work; image `8c44d89` — code
  identical to `6559e87` except the C-17 wiring fix; re-fire only if you want purity) · **C-16** canary
  evidence on zenod#487.

## A · Outbound (drive via the Console chat lane; Jordi's phone verifies pings)

- **A1 → C-22 · Drafts never send.** Two fresh draft-only requests, different natural phrasings
  ("draft a tweet about X, don't send", "prep a post for my approval"). PASS: both `toolEvents:0`,
  draft rendered with approve affordance. *(Sets up A2.)*
- **A2 → C-02 · Natural approval posts.** On the standing draft reply exactly `Tweet approved`.
  PASS: exactly one post, live x.com URL in the reply, URL resolves to the text.
- **A3 → C-03 · Approval with nothing pending.** In a FRESH conversation, bare `approved`.
  PASS: exactly the honest "Nothing pending to approve." — no generic filler.
- **A4 → C-01 · Explicit send.** `Tweet this: <text> — post now.` PASS: one post + resolving URL.
- **A5 → C-04 · Image tweet.** One image + caption. PASS: one post (no double-send), URL, image visible.
- **A6 → C-05 · Blocked send UX.** Force a guard-blocked send (e.g. a mutating ask phrased read-only).
  PASS: ONE friendly message with the affordance; no raw ERROR string; no duplicates.

## B · Execution

- **B1 → C-06 · Issue-create end-to-end.** `Open a bug ticket on zenod-ai/zenod: <one line>.`
  PASS: real issue (read-back confirms), reply carries the issue URL as deliverable.
- **B2 → C-08 · Traceable from the first ping.** From B1's (or any) dispatch: the "execution started"
  WhatsApp ping carries a resolving ticket/run link. PASS: link present and resolves.
- **B3 → C-07 · Done requires evidence.** (a) B1's completion renders done WITH the URL. (b) cite the
  banked C-17 kill: "nothing verifiable" rendered for a no-artifact death. (c) dispatch a tiny echo run
  whose objective states "no deliverable expected" → PASS only if it renders "completed (no deliverable
  expected)", never "failed". *(c is the radar item — score honestly.)*
- **B4 → C-09 · Long runs heartbeat.** Any >10-min run emits elapsed/phase progress unprompted, and
  `execution_status` mid-run returns the same. Cite last night's heartbeat pings + one mid-run status
  read from any run in this board. PASS: ≥1 informative unprompted update.
- **B5 → C-10 · Quota fallback.** Trivial echo dispatched to the secondary engine (or forced fallback).
  PASS: completes on the other engine; zero vendor noise in user-facing text.
- **B6 → C-16 · Config canary.** Cite #487; optionally one fresh "2+2 + model id + effort" comment.
- **B7 → C-17 / C-21.** Score from banked live-fire receipts (0.4). Note SHAs on the rows.

## C · Memory & reads

- **C1 → C-13 · Store → recall → receipt.** Store a distinctive fact ("board-run canary fact:
  <unique string>"). PASS: filing-complete receipt arrives ("Filed → page ^anchor", commit SHA); later
  recall with "show me where it's written" cites a resolving page + anchor.
- **C2 → C-11 · Never assert an empty world.** `What did I work on this week? Priorities?`
  PASS: grounded answer over real items OR explicit "couldn't get a reliable read" — never "no work ran".
- **C3 → C-12 · Status counts its own sends.** Multi-task ask where one task is a direct send; then ask
  status. PASS: the sent task shows completed with its send timestamp — never "unexecuted".
- **C4 → C-14 · Day recall with artifacts.** `Summarize today with links.` PASS: every action listed,
  correctly typed, all links resolve, zero unreceipted claims. *(Run LAST — today's board gives it a
  rich day to summarize.)*

## D · Council interface

- **D1 → C-18 · Receipt-or-error, never a silent ack.** Via the typed tools: one `backlog_create` +
  `backlog_close`. PASS: qualified ID + URL, read-back confirmed, or explicit error. Replay the old
  failure shape: two creates back-to-back → both land with URLs.
- **D2 → C-19 · No magic words.** Paraphrased instructions with no canonical verbs ("go ahead and file
  that", "yes append it to the ticket"). PASS: routed correctly or exactly one honest clarifying
  ask-back; nothing blocked for lacking a keyword.
- **D3 → C-20 · Green PRs merge themselves.** Specimen = this run's own scoreboard PR (see §Scoring):
  open it as a draft, checks go green. PASS: merged unattended ≤15 min after green; notify carries the
  merged-commit URL; deliverable summary lists the paths.

## Meta

- **C-15 · Zero fabrication (whole run).** Audited over everything above. One unreceipted state claim
  anywhere = the entire run FAILS regardless of row results.

## Scoring & close

1. Append ONE scoreboard row-table to `docs/CANONICAL-TESTS.md` (append-only; never edit history):
   build SHA, per-test ✅/🟡/❌ with receipt links, housekeeping section (tweets posted this run,
   issues created, runs dispatched — nothing gets deleted per Jordi).
2. Every ❌ maps to EXACTLY ONE ticket (typed backlog tools or `gh -R zenod-ai/zenod`) — no ticket, no
   finished report.
3. Open the scoreboard change as a **draft PR** → that PR is the C-20 specimen. Score C-20, then it
   merges itself.
4. **22/22 green:** update `docs/LAUNCH-CONTROL.md` — Epic 1 → ✅ CLOSED in the board table + history
   entry (SHA + scoreboard link) — and append the closing receipt to `docs/EPIC-1-SYSTEM-STABILITY.md`.
   **Epic 1 is closed at 100/100.** The ×2 confirmation rides the next routine deploy.
5. **Any red:** stop after scoring. List the fix batch (the mapped tickets) and hand the pen back to
   Fable/Jordi. One fix batch → redeploy → re-run. Do not fix inside the board run.
