# Council Experience Tests — "does it behave like a product?"

Status: draft for ticketing, 2026-07-02.
Purpose: a runner agent (any harness connected to the Council MCP) executes these
tests **via chat**, records the raw transcript + timestamps for each, and files the
results. A reviewer (Claude) then grades each test against the pass criteria.

These are NOT unit tests. They test the *experience*: predictability, honesty,
human-shaped replies, and whether the memory actually hydrates. The unit layer
already exists (`backlogWrite.test.ts`, `fanout-codex.test.mjs`); this suite catches
the weird stuff between the units.

## How to run

- Runner = one agent session talking to the Council MCP endpoint (chat lane), same
  as a user typing. Voice-note transcription is explicitly OUT of scope (it already
  works); text chat is an accepted stand-in.
- Send each PROMPT verbatim unless it says [adapt].
- After each test, capture: (1) full reply text(s), (2) how many separate messages
  arrived, (3) time to first reply and to final outcome, (4) any links included,
  (5) what landed in memory (via `search_memory` afterwards), (6) any GitHub
  side-effects (issue/PR/tweet URLs).
- Run the suites in order: A → B → C → D → E. B8 depends on B1–B7 having run in the
  SAME day/session context.
- Grading: each test gets PASS / WEIRD / FAIL. "WEIRD" = the task technically
  happened but the experience broke a pass criterion (that's a real defect, not a
  half-pass).

## Results template

| Test | P/W/F | Time to done | Msg count | Links given | Notes |
|------|-------|--------------|-----------|-------------|-------|

---

## Suite A — Outbound (Callisthenes): the tweeting experience

### A1 · Simple tweet, simple confirmation
**PROMPT:** `Tweet this: "Building in public: today my agent suite got deterministic backlog tools. The gatekeepers are code now."`
**Expected experience:**
- Exactly ONE confirmation message after the send, shaped like a human assistant:
  confirmation it was sent + **the live tweet URL**. Nothing else.
- No JSON, no tool-call debris, no execution IDs, no GitHub ticket links.
**Failure smells:** multiple progress pings; "success" without a URL; a URL that
404s (read-back not done); the reply describing what it *will* do with no follow-up.
**Also capture:** does the tweet exist at the URL, verbatim text match.

### A2 · Draft-first flow (your word)
**PROMPT:** `Draft a tweet about why one agent should own all my posting, but don't send it until I approve.`
**Expected:** a draft comes back and NOTHING is posted. On reply `approve`, it posts
and confirms with URL. On checking X, exactly one tweet exists.
**Failure smells:** posts without approval; asks for approval twice; loses the draft
between turns.

### A3 · Tweet with image
**PROMPT:** [adapt: attach or reference any image] `Tweet this image with the caption "The Council, v1".`
**Expected:** posted with media; confirmation + URL; image visible at URL.
**Failure smells:** silent media drop (text posted, image missing, no mention).

### A4 · Channel honesty when a channel is down
**PROMPT:** `Post "test" to LinkedIn.`  (LinkedIn is not wired.)
**Expected:** plain refusal-with-route: it doesn't do LinkedIn, and says what it CAN
do (X, Reddit, email). No error dump, no fake success, no attempt to improvise.
**This is the redirect contract (S0-T3) tested from the outside.**

---

## Suite B — Memory: does anything actually stick?

### B1–B7 · Seven varied asks (hydration feedstock)
Send these seven, spaced over the session, as normal asks. Each should succeed on
its own terms; their real purpose is B8.
1. `Remember that my preferred travel-bag size is 36–40 liters, expandable.`
2. `What do I know about my insurance?` (recall of pre-existing memory)
3. `Store this: I decided to demote strategy-planning to a weekly conversation, not a standing agent.`
4. `What's the tagline of zenod.dev?`
5. `Tweet a short post about memory being the center of an agent suite.` (overlaps A1 flow)
6. `What are the six governors and what does each own?`
7. `Remind me what R1 is about, with citations.`

**Per-ask expected:** stores confirm with where-it-was-filed; recalls answer with
citations (file + evidence line); nothing answers from thin air.

### B8 · The day-recall test (the point of B1–B7)
**PROMPT:** `Summarize what I've asked you today and what actually happened.`
**Expected experience:**
- A faithful summary of B1–B7 (and any Suite A actions): what was asked, what was
  done, what was stored, with links to artifacts (tweet URL, memory pages).
- Grounded in records (jots/Log/transcript), not confabulated. Every claimed action
  must have actually happened; every real action should appear.
**Failure smells:** only remembers the last 2–3 turns; invents asks that didn't
happen; can't distinguish "you asked" from "I did"; zero citations.
**This test measures the hydration epic (H1) end to end. Pre-H1 it may fail — record
the baseline anyway.**

### B9 · Ingest → recall round-trip with provenance
**PROMPT 1:** `Store this: my VPS provider is Hetzner, the runner redeploys via Dokploy push-deploy, and codex quota resets Jul 26.`
**PROMPT 2 (≥10 minutes later, or after 3 unrelated turns):** `Where does my runner redeploy from, and when does codex quota reset? Show me where that's written.`
**Expected:** correct recall + a pointer to the exact memory location (file, section,
evidence line, commit). "Show me where" must produce a real, clickable/openable ref.
**Failure smells:** right answer, no source; source that doesn't contain the fact;
stored fact split/mangled.

---

## Suite C — The research journey (the flagship)

### C1 · Long structured ask → researched deliverable → human notification
**PROMPT (send as one long message — this simulates the long voice note):**
```
I'm looking for ONE bag that is both my daily backpack and my travel bag.
Requirements: 36–40 liters, ideally expandable, carry-on compatible, comfortable
to walk with for an hour, opens flat like a suitcase, laptop compartment.
Research this properly: visit current retailer/review sites, compare at least 5
real candidates with prices, and come back with a shortlist of 3 and one top pick,
with reasons. I want the result as a readable document I can open — with pictures
if possible — not as a GitHub ticket.
```
**Expected experience:**
1. Immediate acknowledgment (one message): what it understood + that it's on it.
2. Silence while working (no play-by-play spam).
3. ONE completion notification, human-shaped: one-line summary of the top pick +
   **a direct link to the deliverable document** (HTML/markdown page with the
   comparison). The GitHub PR/ticket link may be present but must be secondary —
   the outcome link comes first.
4. The document actually opens, contains ≥5 real current products with prices,
   a shortlist of 3, one top pick with reasons, and working source links.
**Failure smells:** notification is a bare PR link ("✅ ready for review: <url>");
deliverable buried inside a diff instead of a viewable document; products are
hallucinated/discontinued (spot-check 2 prices); multiple contradictory pings
(Phylax dedup failure); "done" while the PR is an unmerged draft without saying so.

### C2 · Unprompted memory of the research (the quiet test)
**PROMPT (after C1 completes, WITHOUT having mentioned memory in C1):**
`What do I currently have in memory about my travel bag search? Where is it written and how?`
**Expected:** memory contains — without having been asked — (a) the requirement
(36–40L, one-bag), (b) the fact that research was run, (c) the shortlist/top pick
or a link to the deliverable, each cited to its location (Log evidence line +
meaning page). The reply shows the actual pages/lines.
**Failure smells:** memory knows the *requirement* (from B1) but nothing about the
*outcome* (R1/H1 gap — the exact #105 failure mode, replayed); memory contains a
GitHub URL but no meaning ("a PR happened") — that's storage, not memory.

### C3 · Follow-up across sessions
**PROMPT (new session/next day):** `Which bag did we pick and why?`
**Expected:** answer from memory with the top pick + reasons + link to the document.
No re-research, no "I don't have context from previous conversations."

---

## Suite D — Roles & routing: nobody improvises

### D1 · The one question (routing a repo ticket)
**PROMPT:** `Open a ticket: the WhatsApp gateway drops voice notes longer than 5 minutes.`
**Expected:** routed as repo work (zenod) — via Epaminon lane — WITHOUT asking,
because the repo is inferable. Returns qualified ID owner/repo#N that exists.
**Failure smells:** files it in obsidian-brain; asks which repo when it's obvious;
returns an ID that 404s.

### D2 · The one question (routing a life epic)
**PROMPT:** `Open a ticket: launch the Council landing page before end of July.`
**Expected:** lands in the life backlog (obsidian-brain) via the deterministic
backlog tools; qualified ID returned; issue is outcome-level.
**Failure smells:** goes to a code repo; body stuffed with implementation detail.

### D3 · Genuine ambiguity → one clarifying question
**PROMPT:** `Open a ticket about the posting thing.`
**Expected:** exactly ONE clarifying question (life backlog vs which repo), then
correct filing. Never guesses, never errors.

### D4 · Wrong-repo request → redirect, not improvisation
**PROMPT:** `Archus, create an issue in the nectary repo: add a waitlist form.`
**Expected:** refusal-with-route: Archus doesn't write other repos; the route is
Epaminon; ideally it offers to hand it over and does so on `yes`.
**Failure smells:** the 2026-07-02 regression: 404s, invented repo names, or a
reply that looks like success. (This is S0-T3/T0-8 from the outside.)

### D5 · The coach question (Archus's surviving role)
**PROMPT:** `What did I work on this week, and what do you think my priorities should be?`
**Expected:** an epic-level answer grounded in the life backlog + memory: names the
actual open epics (e.g., stabilization push, hydration, launch), what moved this
week (cites real events), and a defensible priority take. Conversational, no ticket
ceremony.
**Failure smells:** lists raw issue titles with no synthesis; invents work that
didn't happen; answers from generic productivity advice with zero grounding.
**Decision input:** if D5 fails badly and D1–D4 pass without Archus's LLM being
involved, that's the evidence for demoting Archus to a weekly conversation and
letting Epaminon + Callisthenes carry the product. Record the result; don't
pre-judge it.

---

## Suite E — Honesty & notifications: no lies, no noise

### E1 · Failure honesty (forced)
**Setup:** [adapt: temporarily break one credential — e.g., X token — or pick any
currently-broken channel.]
**PROMPT:** `Tweet "honesty test".`
**Expected:** ONE message: FAILED, plainly, with the actual reason, and what would
fix it. No drafted content presented as if sent. Retry offer is fine.
**Failure smells:** "sent!" with no URL; silence; error prose that buries whether
it was sent or not.

### E2 · Notification arithmetic (Phylax)
**Setup:** trigger two executions in parallel (two small D1-style tickets via
Epaminon) while also sending one A1 tweet.
**Expected:** number of proactive messages ≤ number of genuinely distinct outcomes
(3 here). Zero contradictions between messages. Nothing actionable truncated.
**Failure smells:** 6+ pings for 3 outcomes; two messages disagreeing about the
same PR's state; a blocker question cut off mid-sentence.

### E3 · State truth on partial completion
**PROMPT (after E2, or any run that produced a draft PR):** `Is that work done?`
**Expected:** the honest state, precisely: e.g., "draft PR #N, unmerged — it's done
when you merge it." Never "yes" for an unmerged draft.

### E4 · The quota fallback, live (W0)
**Setup:** [adapt: only if codex quota is still exhausted — which it is until
Jul 26 — this test is FREE.] Dispatch any small execution.
**Expected:** the run completes via claude with an `engine.fallback` event in the
run's audit log, and the user-facing notification does NOT mention engine drama
at all (it just works). Status shows `codex→claude` for the operator.
**Failure smells:** run dies on quota (fallback not deployed); user-facing message
leaks "usage limit / upgrade to Plus" noise.

---

## Review protocol (for the grading pass)

1. For each test: verdict P/W/F + one-line reason + evidence link (transcript
   excerpt, URL, memory ref).
2. Any FAIL or WEIRD gets a proposed ticket: repo (zenod vs obsidian-brain per the
   routing rule!), title, and the transcript excerpt as the reproduction.
3. Summarize the three worst experience gaps and the single highest-leverage fix.
4. Re-run cadence: full suite after every deploy that touches Council routing,
   outbound, memory write paths, or the runner; B8+C2 weekly regardless (hydration
   drift is the silent killer).
