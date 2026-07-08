# EPIC 2.4 · CALLISTHENES MOVE 0 — the second unit product: the voice, console-less

Owner: **Zenod-Fable** (recommended: same planner as 2.3 — the unit-product playbook repeats; see
CD-0) · Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md)
Origin: Jordi, 2026-07-05 — "bring up Callisthenes as 2.4; auth via chat; truly light, no
webserver; once authenticated as MCP it sends you links via chat."
Siblings: clones the funnel shape of [EPIC-2.3-ZENOD-MOVE-0.md](EPIC-2.3-ZENOD-MOVE-0.md)
(checkout → provision → meter); conforms to 2.5's SEAM-SPEC unedited.

**EXIT CRITERION:** Jordi pays for hosted Callisthenes (real card, LIVE), connects his X account
**entirely via chat-auth** (no admin UI exists to touch), posts a tweet from **his own Claude**
through his paid instance — permalink receipt in the tool result — and reads his usage via the
`usage` tool. Instance watchdog-registered. A tester repeats the funnel as a stranger, then
verifies the guardrails: throttle enforced, drafts-never-send (C-22 discipline) holds, revocation
via chat works.

## Roles & document flow (binding)
Ten rules of HANDOVER-EPIC2 §THE DOCUMENT FLOW. Planner/worker/tester in THIS doc; receipts or it
didn't happen; tester ≠ fixer; budgets on every dispatch; worker fans out parallel sub-agents.

## What this product is

**"One mouth for all your agents."** Callisthenes standalone = one MCP server holding your
outbound keys — X (first), Reddit, email later — with throttle, pacing, and receipts built in.
Your agents draft anywhere (Claude, Cursor, scripts); exactly one unit sends, and every send
returns a permalink. No UI anywhere: **the signature of this product is console-lessness.**

### The chat-auth pattern (the epic's innovation — becomes a SEAM-SPEC convention)
- `connect(service)` → tool result carries the auth link or device-code instructions
  ("visit x.com/…, enter PIN") — the chat you're already in IS the setup flow.
  Device-code/PIN flows preferred (zero callback); one bare `/oauth/callback` route as fallback
  for providers without them. No pages, no forms, no session cookies.
- `complete_connect(pin)` for PIN flows · `connections()` for status · `revoke(service|token)`
  for hygiene · `usage()` for calls/sends/cost from the ledger.
- MCP access token issued once at provision (shown post-checkout; CLI prints it for self-host).
- **Convention names + receipt shapes get written up as an RFC appendix to SEAM-SPEC** (Ring-
  Fable's artifact — routed via Jordi): every future unit auths this way. 2.3's Zenod keeps its
  €5-consumer setup wizard for hosted, but gains the chat-auth path for self-host.
- Security notes (binding): tool results must return canonical provider URLs only (phishing
  surface); tokens scoped + revocable via chat; the receipt profile is the audit trail; C-22
  (drafts never send) and default throttles (conservative N/hour) ship ON.

## CD decisions — planner frames, Jordi calls

- **CD-0 · Who runs this epic — DECIDED 2026-07-08 (Jordi): direct dispatch.** Jordi fires the
  worker and tester prompts himself from this doc; receipts audited at hand-back. **Full product
  parity with Zenod confirmed (Jordi, verbatim): "we need everything we have for Zenod, for
  Callisthenes. Everything."** Website, Stripe LIVE, auto-provision, meter, watchdog — no
  half-product. 2.6 (Herald) follows; its H-4 blocks on this epic's C-1.
- **CD-1 · Price.** €5/month shape like Zenod? (Jordi carries to Product-Fable.)
- **CD-2 · Channels at Move 0:** X only (recommended — one OAuth dance, the proven x-mcp core)
  → Reddit fast-follow → email later (Gmail scopes are their own project).
- **CD-3 · Callback strategy:** device-code/PIN-first with single callback route as fallback
  (recommended) vs callback-only (simpler code, worse story).
- **CD-4 · Dashboard:** none — chat tools only (recommended; this epic PROVES the console-less
  thesis) vs reuse 2.3's usage page (dilutes the point; add later only if customers ask).

## Iteration 0 — lanes (parallel; sub-agents mandatory)

| ID | Lane | Deliverable + acceptance | Test criteria (tester, fresh evidence) |
|---|---|---|---|
| **C-1** | Unit GA | outbound/x-mcp hardened as one container; SEAM-SPEC conformance unedited; throttle defaults + C-22 discipline in the unit itself; stranger-grade README (token → Claude config → first post) | external MCP client completes draft→approve→post on a fresh instance from README alone; throttle + draft-never-send probed |
| **C-2** | Chat-auth | `connect/complete_connect/connections/revoke/usage` tools per the pattern above; device-code/PIN path live for X; fallback callback route if needed (CD-3); SEAM-SPEC auth-convention RFC drafted | tester connects a fresh X account using ONLY chat, zero UI; revoke → post fails loudly; reconnect works |
| **C-3** | Website + checkout LIVE | one-pager ("one mouth for all your agents"; copy from Epic 0) + Stripe SKU (CD-1) → webhook → provision (clone Z-2 machinery); ToS/privacy links | real card → instance + token delivered; stranger completes funnel from the public page |
| **C-4** | Meter via chat | per-tenant key/ledger wired; `usage()` returns calls · sends · cost; warn/block behaviors per D-5 pattern | scripted burn matches `usage()` output; block-at-zero + top-up + resume receipted |
| **C-5** | Watchdog + ops | provision registers with fleet watchdog; restore runbook | forced crash-loop → operator alert; restore drill green |
| **C-6** | Customer #1 | Jordi's run per the exit criterion | scored ✅/❌ with receipts inline (Stripe ID, tweet permalink, usage() transcript) |

Sequencing: C-1 ∥ C-3-page immediately; C-2 with C-1; C-4 after provision path; C-6 last;
tester's stranger-run + guardrail probes close the epic.

## Boundaries
- **↔ 2.3:** funnel machinery cloned, not re-invented; if CD-0 = same planner, 2.4 starts when
  2.3's Z-2/Z-3 are tester-green (the templates exist then).
- **↔ 2.5 (Ring-Fable):** SEAM-SPEC stays theirs; the chat-auth RFC is offered as an appendix via
  Jordi. In ring deployments, the ring's keyring supersedes chat-auth (central issuance); the
  unit supports both — standalone-mode = chat-auth, ring-mode = keyring. Callisthenes remains
  the only holder of outbound keys in every topology.
- **↔ Epic 0:** one-pager copy + the "console-less" story (it's a hell of a movement post:
  "this product has no UI — you set it up by talking to it").
- Jordi is the only router.

## APPEND ZONE (dated, role-tagged, append-only)

### 2026-07-05 · [scribe/Story-Fable] Doc created
- Materializes Jordi's 2.4 ask + the chat-auth idea, generalized to the console-less unit
  pattern (device-code/PIN-first, single callback fallback, chat as dashboard). CD-0..CD-4
  framed with recommendations. Pen hands to the 2.3/2.4 planner per CD-0.
