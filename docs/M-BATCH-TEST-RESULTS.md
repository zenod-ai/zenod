# Morning-Trace Batch (M-1…M-6) — Test Results

Run date: 2026-07-03
Driver: Council chat lane (`chat_with_console`, `surface=web`) + live execution/transcript verification.
Deploy under test: `main` after the M-1…M-6 merge (approve token + friendly block + retry-stop; evidence-required
"done"; issue-create routing; read-path honesty/#234).

## Verdict: 🟢 Three real wins, one clean fail, one honest-but-inaccurate — no fabrications

The batch landed the two things that mattered most from the morning trace: **issue creation actually works
now** (a real issue was filed for the first time in the campaign), and the **#234 read-path "no work ran"
false-negative is fixed**. The tripled raw-error bubble is gone. But the **approval token (M-1) still doesn't
recognize a standing draft**, and the **evidence verifier (M-2) misfired to a false-negative**. Zero fabricated
state claims anywhere.

---

## Per-ticket results

### M-3 — issue-create routing → ✅ PASS (the headline win)
"Open a bug ticket on zenod-ai/zenod: …" now dispatches a **dedicated `gh issue create` worker** (the objective
literally reads "run `gh issue create -R zenod-ai/zenod` first (never skip it)… report the issue URL"). The
worker **cloned the repo, diagnosed the real cause** (`LONG_AUDIO_SECONDS = 300` + a matching 5-min HTTP
timeout), cross-checked related issues, and **filed a real ticket: [zenod-ai/zenod#479](https://github.com/zenod-ai/zenod/issues/479)**
("Bug: WhatsApp gateway drops voice notes longer than 5 minutes"), plus a comment on execution ticket #478.
This is the **first time issue-creation actually landed** — the banana9 / iteration-4/5 "dispatched but no
issue" failure mode is closed on the creation side. *(Issue #479 is worker-reported with concrete evidence; I
can't read the private repo from here — worth a 1-click confirm, but the diagnosis specificity makes it
credible.)*

### M-6 — read-path honesty (#234) → ✅ PASS
Replayed R17 ("what did I work on this week…"). `execution_status` again returned filtered-empty **with its own
warning** ("50 exist… broaden the query"). This time the Console did **NOT** say "no work ran": it grounded the
answer in the transcript (#227, #233, the ephemeral failures), explicitly stated *"No broader weekly ticket
list available from the filtered call (50 tickets exist; your query was too narrow),"* and offered to broaden.
That is exactly the M-6 acceptance — grounded or explicit couldn't-read, never a false empty world. **#234 fixed.**

### M-1 — friendly block + retry-stop → ✅ PASS (this half)
The morning trace's **tripled raw "ERROR: Blocked post_tweet…"** is gone. A blocked/again-approve turn now
renders a **single, friendly** line ("Nothing pending to approve.") — one message, no raw ERROR string, no
duplicates. The retry-stop and friendly-template halves of M-1 landed.

### M-1 — stateful approval token → ❌ FAIL (the core half)
The load-bearing fix — natural-language "Tweet approved" on a standing draft should post once — **does not
work.** Tested twice: draft a tweet, then reply "Tweet approved" → **"Nothing pending to approve."** and no
post, both times. The token isn't being registered on (or matched to) the standing `ask_outbound` draft, so the
exact real-user scenario from this morning **still doesn't post via approval**. (It now fails *cleanly* instead
of with a raw triple-error, but it still fails — and "Nothing pending" is itself wrong when a draft is
standing.) Also inconsistent: bare "approved" with *no* draft returned "Understood. What would you like to do
next?" rather than the specified "Nothing pending to approve." So the approve/no-draft states are effectively
swapped/misdetected.

### M-2 — evidence-required "done" → ⚠️ MIXED (honest direction, false-negative)
Good news: the verifier no longer renders a false ✅. On the M-3 run it rendered **"Finished but produced
nothing verifiable — treating as failed"** — the fail-closed honesty the ticket wanted, replacing the old
banana9 false-"done".
Bad news: it was a **false-negative** — the worker *did* report issue **#479** in its summary, yet the verifier
said "no commit/PR/issue URL in the final summary" and marked the run **failed**. So the evidence extractor
still isn't recognizing an **issue URL** as a valid deliverable (I5-2's intent). Net: erring toward honesty
(fails closed, no fake done) but inaccurate — a genuinely successful issue-creation is reported as failed.

### Reply-gate sanity (R2) → ✅ PASS
"Post this tweet now" → real live URL `…038694546637087`, `toolEvents:2`, delivered text byte-identical to the
receipt. The iteration-6 honesty gate holds through this deploy.

---

## Residual (not in this batch's scope, still open)

- **Per-task status accuracy:** the voice-note-task summary *still* lists Task 2 (the Phylax joke) as
  "unexecuted" — but the joke **was sent** at 11:17 (in the transcript). M-6 fixed the "no work ran"
  false-negative on the filtered read, but the Console still mis-attributes a task it actually completed. A
  read-accuracy follow-up (the status composer isn't counting its own outbound Phylax message as "executed").

## Scoreboard

| Ticket | Result |
|---|---|
| M-3 issue-create routing | ✅ **PASS** — real issue #479 filed |
| M-6 read-path honesty (#234) | ✅ **PASS** |
| M-1 friendly block + retry-stop | ✅ PASS (no more tripled raw ERROR) |
| M-1 stateful approval token | ❌ **FAIL** — "Tweet approved" → "Nothing pending to approve", no post |
| M-2 evidence-required "done" | ⚠️ MIXED — fail-closed honesty works, but false-negative (issue URL not recognized) |
| Reply-gate (R2) | ✅ PASS |
| Zero fabricated state claims | ✅ MET |

## Recommended next screws

1. **M-1 token wiring:** register the approval token when `ask_outbound` emits a draft (not just some paths), and
   match it on the next affirmative. Acceptance stays: "Tweet approved" on a standing draft → one post + live
   URL; no draft → "Nothing pending to approve." (Right now both branches misfire.)
2. **M-2 evidence extractor:** recognize `github.com/<owner>/<repo>/issues/N` as a first-class deliverable so a
   successful issue-creation renders "done (issue #479)" instead of "produced nothing verifiable." (The
   fail-closed default is fine; it just needs to see issue URLs.)
3. **Status-composer per-task accuracy:** count the Console's own sent outbound (e.g., the Phylax joke) as
   "executed" so task summaries stop under-reporting completed tasks.

## Housekeeping — real tweet this batch
`…038694546637087` (R2 sanity). The two M-1 approve tests correctly did **not** post (no accidental tweets).
Plus the campaign's prior test tweets, all still needing manual deletion on X.
