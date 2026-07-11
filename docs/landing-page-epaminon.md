# Epaminon — Landing Page Structure

**URL:** `epaminon.zenod.dev`
**One-line value prop:** A cloud worker you buy, not build. Prompt in, durable result out.
**Competitive edge to land:** running coding agents yourself means babysitting VMs, credentials, and half-finished runs. Epaminon sells execution as a utility: send a prompt and an effort level, a sandbox is born for that one job, the transcript and artifacts persist to *your* storage, and the sandbox dies. Honest isolation + zero idle cost is the pitch no framework makes.

---

## 1. Hero

- **Headline:** "Delegate the work. Keep the evidence."
- **Subhead:** "Connect Claude or Codex, send a prompt and an effort level, get back a durable result — full transcript, artifacts, receipt. Every job runs in its own sandbox, born for the job and destroyed after."
- **Primary CTA:** `Get started` → GitHub sign-in
- **Secondary CTA:** `Self-host free`
- **Hero visual:** a `run_task` call on the left; on the right the job detail screen — status timeline, live transcript, artifacts list. Show the *result* screen, not an architecture diagram.
- Trust strip: `born · run · persist · destroyed`

## 2. The problem

- "Coding agents are easy to start and hard to trust: where did it run, what did it touch, what did it leave behind?" Two lines, straight to the isolation answer.

## 3. How it works (3 steps + screenshots)

1. **Connect GitHub + your worker CLI creds once** — screenshot: setup screen.
2. **Send prompt + effort** — screenshot: the tool call with `effort` parameter (the prompt-first differentiator — no tickets, no YAML).
3. **Collect the durable result** — screenshot: transcript viewer + artifacts persisted under your tenant.

## 4. Key claims (4 cards)

- **Honest isolation** — arbitrary agent code never runs in the shared service; one sandbox per job.
- **Minimum credentials** — a sandbox carries only that job's creds. Nothing else exists inside it.
- **Durable evidence** — transcripts and artifacts outlive the sandbox; query status any time.
- **Zero idle cost** — no always-on executor. You pay for jobs, not for waiting.

## 5. Show it working

- Looped recording: prompt sent from Claude → sandbox spins → transcript streams → PR/artifact appears → sandbox gone. End frame on the receipt.

## 6. Effort levels (make the metering tangible)

- Small table/cards: quick fix · standard task · deep run — what each buys (time/model budget). This doubles as the pricing explainer.

## 7. Pricing

- **Hosted — metered** (credit-based; tie visually to effort levels above).
- **Self-hosted — free**, same image, one tenant.

## 8. FAQ

What can a job access? (only its repo + job creds) / Where do results live? / What if a job hangs? (budgeted, reaped, reported) / Which harnesses? (Codex- and Claude-style CLI workers) / Does it keep my code? (works your repos with job-scoped creds, then forgets them)

## 9. Footer

Docs · GitHub · Pricing · the Council strip.

---

**Shot-list:** job detail with transcript · artifacts list · run_task call with effort · credential setup · status/history list.
**Tone:** military-quartermaster calm. Lead with evidence and cost honesty; the "born, run, persist, destroyed" cadence is the memorable hook.
