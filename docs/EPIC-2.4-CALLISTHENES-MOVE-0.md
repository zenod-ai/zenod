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

### 2026-07-08 · [worker] GATING X-auth verification + planner fold (pre-C-2)

**0 · Housekeeping receipt.** The 2.4 (this) + 2.6 docs existed only in unpushed local commit
`f3950f7` — the "reset-wiped" hazard, again. This PR carries them to origin so they stop being
strandable. No code shipped this session; this entry is the gating finding + a grounded fold.

**1 · GATING FINDING — X auth flows on our tier (receipted; blocks C-2 & resolves CD-3).**
Verified against X's live developer docs:
- **Device-code (RFC 8628): DOES NOT EXIST on X.** Absent from X's OAuth2 docs; only
  Auth-Code-with-PKCE + refresh is offered. → the doc's "device-code preferred" premise is
  **not buildable**. Source: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
- **OAuth 2.0 Auth-Code + PKCE: supported, but `redirect_uri` is MANDATORY** and must be
  pre-registered (localhost/127.0.0.1 banned) → a real callback route is required; not
  "zero callback." Source: same URL as above.
- **OAuth 1.0a PIN-based (`oauth_callback=oob`): supported & documented.** User visits x.com,
  authorizes, copies a **7-digit PIN** back — zero *runtime* redirect (fits the console-less
  thesis). Caveat: the app still must register a callback URL **once** and enable OAuth1.0a
  Read+Write. Source: https://developer.twitter.com/en/docs/authentication/oauth-1-0a/pin-based-oauth
- **Corroborating ground truth in-repo:** `services/x-mcp` already signs via the **OAuth1.0a**
  client and the upstream (pinned `XMCP_REF=63d34362d88ed9f94d54ccd5ecd5bb4d12e11759`) ships
  `run_oauth1_flow()` — the exact PIN/oob dance. Our `headless-oauth1.patch` currently *bypasses*
  it with a single owner token/secret from env. So the PIN machinery exists; C-2's real work is
  re-exposing it as **per-tenant** chat tools, not inventing a flow.

**→ CD-3 RESOLUTION (recommend, Jordi calls): PIN-first via OAuth 1.0a `oob`**, with a single
OAuth2/PKCE callback route kept only as the fallback for *future* providers (Reddit/email), not
X. This is the only path that delivers the literal "visit x.com, enter this PIN" chat story.

**2 · The real C-2 architecture note (multi-tenant is the work, not the flow).** Today x-mcp
signs every request as **one owner** (single env token/secret). A hosted Callisthenes serving
strangers needs **per-tenant OAuth1 access token+secret, keyed by the MCP access token**, with
`connect()` → returns authorize-URL+PIN instructions, `complete_connect(pin)` → exchanges &
stores that tenant's tokens, `revoke()` → drops them. The `headless-oauth1.patch` owner-token
path stays only for self-host single-user. Security (binding, already in doc): tool results
return **canonical x.com URLs only**; C-22 draft-never-send + conservative throttle ship ON — and
note both are **delegated to the Callisthenes agent layer**, NOT present in x-mcp itself, so C-1
must add them in the unit.

**3 · Concrete "clone Z-2" map (grounds C-3/C-4/C-5; explorer-verified).**
- **Website/checkout:** Zenod's live front door is `apps/site/src/App.tsx` (Stripe Payment Link
  hardcoded); `sites/callisthenes/index.html` is a **copy-complete skeleton** ("one mouth…"
  story) but has **no CTA/Stripe**. C-3 = add the SKU + link, mirror `apps/site`.
- **HARD DEPENDENCY / HAND-BACK SEAM:** the **webhook + provisioner live in the PRIVATE
  `zenod-ai/cloud` repo** (`provision-standalone.mjs`, `cloud.zenod.dev/webhook`), NOT here.
  C-3/C-4/C-5 cannot be completed from this repo alone — they need cloud-repo access + **LIVE**
  Stripe key + webhook signing secret. Ref: `docs/Z-3-CHECKOUT-WIRING.md`,
  `docs/Z-6-CUSTOMER-1-CHECKLIST.md`.
- **Meter:** per-call ledger `/data/usage.sqlite` via `packages/server/src/sessionLog.ts`,
  surfaced by `read_llm_timeline`. C-4's `usage()` = a Callisthenes-flavoured read of the same
  ledger (calls · **sends** · cost). Gateway-key = source of truth per D-5.
- **Watchdog:** `scripts/watchdog/zenod-watchdog.sh` + `units/PROVISIONING-RUNBOOK.md` step 4b
  (append containers+health URL to `/etc/zenod-watchdog.env`); restore drill in
  `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md`. C-5 = clone, registering the Callisthenes container.
- **Unit packaging gap (C-1):** there is **no** `units/callisthenes/` dir, standalone Dockerfile,
  or standalone compose. The outbound brain is baked into the monorepo `Dockerfile` as
  `AGENT=outbound`. C-1 must extract an atomic unit + stranger-grade README.

**4 · CD framing for Jordi (nothing built forecloses these):**
- **CD-1 (price):** recommend mirror Zenod's €5/mo shape — keeps one checkout template. Not blocking C-1/C-2.
- **CD-2 (channels):** X-only at Move 0 confirmed sensible — one OAuth dance, proven core.
- **CD-3:** RESOLVED above → PIN-first OAuth1 oob (device-code impossible).
- **CD-4 (dashboard):** recommend none — the `usage()` tool proves the console-less thesis; the
  ledger surface already exists so a page can be added later without rework.

**5 · Honest status & hand-back.** Completable-here = this gating finding + fold (DONE, this PR).
NOT done and NOT faked: C-1 unit extraction, C-2 per-tenant chat-auth code, C-3 LIVE Stripe/
provision, C-4 meter, C-5 watchdog — the infra lanes are **blocked on `zenod-ai/cloud` access +
LIVE secrets (Jordi)**. Recommended next dispatch once unblocked: C-1 ∥ C-2 (code, this repo) can
proceed immediately; C-3/C-4/C-5 after cloud-repo + LIVE-key access. Worker does not self-certify;
acceptance is the tester's + Jordi's per the exit criterion. — [worker]
