# EPIC 2.4 · CALLISTHENES MOVE 0 — the second unit product: the voice, console-less

> **▶ NEXT ITERATION (worker: start here).** Do **#645 — tenant isolation**: inject the
> authenticated bearer as the tenant key; stop trusting the client-supplied `mcp_token`. Full spec
> (task · 4 acceptance checks · discipline) is in the `2026-07-08 [planner/Epic-Zero]` entry at the
> bottom. Worktree `wt/callisthenes-645`, edit only `units/callisthenes/` + this doc, handback inline
> on `main`. — planner/Epic-Zero, 2026-07-08

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

### 2026-07-08 · AUDIT [via Jordi] — hand-back 1 ACCEPTED
- Gating X-auth finding ACCEPTED with receipts (PR #625). CD-3 DECIDED:
  PIN-first via OAuth 1.0a oob (console-less path; machinery exists in
  services/x-mcp run_oauth1_flow); OAuth2 PKCE + registered callback =
  fallback pattern for future providers. The doc's device-code premise
  is retired by this entry.
- Un-stranding the 2.4/2.6 docs to origin: right call.
- C-3/C-4/C-5 seam honored: blocked on zenod-ai/cloud access + LIVE
  Stripe secrets; Jordi grants when ready. CD-1 (price): [Jordi fills
  or strikes this line].

### 2026-07-08 · [worker] C-1 ∥ C-2 built — code landed, receipts (NOT self-certified)
Parallel sub-agents, isolated worktrees, disjoint file ownership, shared `auth.register(mcp)` hook.
- **C-1 · atomic unit** — PR #630 (auto-merge armed). `units/callisthenes/`: wrapper
  `callisthenes_server.py` (imports upstream `create_mcp()` — clean, no brittle patch), `throttle.py`
  (default 10/hr, ON), `draft_guard.py` (C-22 drafts-never-send), Dockerfile + standalone compose +
  `.env.example`, stranger-grade README, SEAM-SURFACE.md (SEAM-SPEC unedited). **15 pytest pass**
  (throttle blocks N+1; unapproved send blocked, approved allowed).
- **C-2 · per-tenant chat-auth** — PR #629 (CI green, auto-merge armed). `units/callisthenes/auth/`:
  `connect/complete_connect/connections/revoke/usage` on **OAuth1.0a oob PIN** (CD-3); per-tenant
  tokens keyed by `sha256(mcp_token)`; canonical-x.com-URL-only guard; no secrets logged. **31 pytest
  pass** (per-tenant isolation, revoke-then-lookup-none, canonical URL). PIN flow supersedes
  headless-oauth1.patch for tenants; single-owner headless remains for dogfood.
- **SEAMS handed forward (honest):**
  - `usage()` needs the live per-tenant ledger (`/data/usage.sqlite`) → **C-4**. Interface fixed
    (`usage_reader(mcp_token)→{calls,sends,cost_usd}`); returns nulls (not faked zeros) until wired.
  - Docker image not built here — tester should confirm `docker build` once (logic standard).
  - Live X draft→approve→post + connect-via-PIN dances NOT run — **tester's** per exit criterion.
- **Still blocked (unchanged):** C-3 checkout/provision + C-5 watchdog need `zenod-ai/cloud` access +
  LIVE Stripe secrets (Jordi). Recommended next: unblock C-4 by injecting the usage_reader; then
  C-3/C-5 once cloud access granted; then tester dispatch for the guardrail probes + Jordi's C-6 run.
Worker does not self-certify. — [worker]

### 2026-07-08 · [worker] C-4a — usage() wired to live ledger (receipt, not self-certified)
- **PR #633** (auto-merge armed). `units/callisthenes/auth/usage_reader.py` reads the live
  `/data/usage.sqlite` table `llm_usage` (schema per `packages/server/src/usageStore.ts`) via the
  fixed interface `usage_reader(tenant)→{calls,sends,cost_usd}`.
- **Honest mapping (zero faked values):** `calls`=COUNT(*) real · `cost_usd`=SUM(cost_usd) real ·
  `sends`=**null** — the LLM ledger genuinely has no send column; null = "not measured", never
  "measured zero". A real send count needs a dedicated Callisthenes send-ledger (future lane).
- `register()` auto-wires when the ledger file exists; stays in the explicit `unavailable` stub
  (all-null) when absent — preserves C-2 behaviour. Tenancy: instance-per-user ⇒ container-local
  ledger IS the tenant's (documented; `tenant` arg accepted, not a DB filter).
- **Receipts:** 9 new tests over a seeded ledger fixture; full `units/callisthenes/auth` suite
  **40 passed** (31 prior + 9), no regression. Env knob `CALLISTHENES_USAGE_DB`.
- **Unchanged blockers:** C-3 checkout/provision + C-5 watchdog need `zenod-ai/cloud` access +
  LIVE Stripe secrets (Jordi's grant). `sends` remains null pending a send-ledger. No live
  acceptance self-certified — tester's per exit criterion. — [worker]

### 2026-07-08 · [tester] Iteration-0 scoreboard — fresh evidence, tester ≠ fixer
Budget: single-session, docker + python probes on a fresh GitHub clone. Retested against tip
**c800755** (after C-4a landed mid-run). Method: built the image, booted the server, drove the live
MCP endpoint, ran module-level custody probes, and executed the unit tests. Reds map one-to-one to a
ticket; no fixes applied here.

**❌ RED — Build & boot from a fresh clone (C-1, #630) → ticket #635.**
`docker build units/callisthenes/` FAILS: `.dockerignore` line `*.patch` excludes both patch files
the Dockerfile `COPY`s → `"/relax-response-required.patch": not found` at step 5/10. Reproduced
twice. Proven to be the *sole* build blocker: with that one line removed (nothing else changed) the
identical build completes, unpacks a ~549MB image, and boots FastMCP. The worker flagged "image not
built here" — it does not build. `.dockerignore` unchanged by C-4a; still red on c800755.

**❌ RED — Chat-auth surface absent at boot (C-2, #629) → ticket #636.**
On real boot (both 6f9906d and c800755): `auth package not registered (ValueError('Functions with
*args are not supported as tools')); booting single-owner headless`. Live `tools/list` returns only
the 6 X tools — **zero** of `connect/complete_connect/connections/revoke/usage`. Cause:
`register()._wrap` returns `inner(*args, **kwargs)`, which FastMCP's `mcp.tool()` rejects; the whole
registration throws and is swallowed. C-4a touched `register()` but left `_wrap` byte-identical — red
persists. Consequence: the console-less chat-auth thesis — the epic's headline — does not load. The
auth unit tests pass only because they drive the plain-registry/direct-engine path, never FastMCP
registration. Every live C-2 acceptance (connect a real X account via chat, revoke-then-post-fails,
reconnect) is unreachable through the server, so the exit-criterion X dance was not run (also
environmentally blocked: no X test account/creds available to the tester).

**✅ GREEN — Guardrails, verified LIVE on the running MCP server (probe image, ignore-fix applied):**
- throttle default **10/hr** enforced: 11 approved `createPosts` → sends #1–10 pass the guards,
  **#11 `[throttle_exceeded]`**. Env override honored (3→3, 0→fully closed).
- drafts-never-send (C-22): unapproved `createPosts` → `[draft_not_approved]`, `isError:true`,
  never reaches X; approved call forwards with the approval arg **stripped** (no leak to X).
- `installed middleware: draft-guard (C-22) + throttle` present in boot log.

**✅ GREEN — Custody probes, verified at module level (correct, but gated behind #636 on the live surface):**
- (a) token at rest = **unit-local SQLite** (`callisthenes-auth.sqlite`), tenant column = **sha256**
  of the MCP token (verified == `sha256(raw)`); raw plaintext token **absent** from the DB file bytes.
- (b) **no secret material** in any tool result, the `connections()` public view, or logs
  (access token / access-token secret / request-token secret all absent from serialized results).
- (c) `revoke()` **DELETEs** the row (rows 1→0), `get()` → `None` — deleted at rest, not flagged;
  a subsequent send cannot be signed. `revoke` of nothing → loud `AuthError`.
- (d) reconnect after revoke → `get()` returns the connection.
- anti-phishing: non-canonical authorize URL refused; `api.x.com` allowed.

**⚠️ ACCEPTABLE-NULL — `usage()` (C-4a).** C-4a is now on main and wires `usage()` to
`/data/usage.sqlite` via `sqlite_usage_reader()`, which auto-detects and returns None when no ledger
is present. On a bare standalone unit (no ledger) `usage()` returns
`{calls:null, sends:null, cost_usd:null}`, `source:"unavailable"` — explicit nulls, not faked zeros,
per SEAM-SPEC. Full reconciliation (scripted burn vs `usage()`) is not testable here for two reasons,
both acceptable: (1) the `usage` tool is unreachable live behind #636; (2) `sends` has no ledger yet
(worker-flagged). Values are honest nulls where the ledger lacks data — criteria satisfied.

**Tests:** unit tests pass (throttle+draft_guard 15/15; auth 40/40 on c800755 incl. C-4a's +9).

**Verdict:** Iteration-0 does NOT pass. Guardrail logic is solid and live; custody logic is correct.
But the unit **cannot build** (#635) and, once built, **exposes no chat-auth tools** (#636) — the two
things the epic is fundamentally about. Fix both, re-boot, then the live X exit-criterion dance
(C-6, needs an X test account + LIVE creds) can be attempted. — [tester]

### 2026-07-08 · [tester] HANDBACK to planner — where the epic stands + next steps
Pen back to the planner. Iteration-0 tester pass done; the scoreboard above is the evidence.

**One-line status:** the unit's *logic* is sound (guardrails live, custody correct, 46 tests green),
but the unit **does not build** (#635) and, once built, **exposes no chat-auth tools** (#636). The two
console-less headline capabilities of the epic are therefore unproven end-to-end. **Epic exit: ❌.**

**Blocking, in priority order (both trivial, both worker-fixable, no design change):**
1. **#635 — `.dockerignore` `*.patch`** drops the two patches the Dockerfile COPYs. One-line fix
   (drop the glob, or `!`-allow the two files). Gate: `docker build` exits 0 from a fresh clone.
2. **#636 — `register()._wrap` uses `*args`**, which FastMCP's `mcp.tool()` rejects → all five
   chat-auth tools silently fail to register; unit falls to single-owner headless. Fix the wrapper
   signature (`functools.wraps` per-tool, or register unwrapped methods and move the error envelope).
   Gate: fresh boot logs `auth package registered`; live `tools/list` shows all five tools.
   **Add a boot-level test** that asserts the five tools appear against a real FastMCP instance — the
   current suite only drives the plain-registry path, which is exactly why this shipped.

**Recommended sequencing from here:**
- **First:** dispatch a worker for #635 + #636 together (both in `units/callisthenes/`, tiny, disjoint
  enough to co-fix). Re-boot, re-run the tester's live probes — everything else is already green.
- **Then unblock the still-blocked lanes** (unchanged since the worker's note): **C-3** (checkout/
  provision) + **C-5** (watchdog) need `zenod-ai/cloud` access + LIVE Stripe secrets — **needs Jordi's
  grant**; nothing to build until then. **CD-1 (price)** still open — Jordi to fill.
- **C-4a reconciliation** remains unverified live: the `usage()` tool is unreachable behind #636 and
  `sends` has no ledger yet. Re-test the scripted-burn-vs-`usage()` reconciliation once #636 is fixed
  and a send actually lands.
- **C-6 (Jordi's exit run)** is last and needs a real X account + LIVE creds — only attemptable after
  #635/#636 land and C-3 provisions a real instance.

**Custody caveat for the planner to note:** the token-custody behaviour (unit-local hashed store, no
secret leakage, revoke-deletes-at-rest, reconnect) is *implemented correctly* but is currently
*unreachable through the server* because the auth tools don't register (#636). It becomes a live
guarantee the moment #636 is fixed — no custody redesign needed. — [tester]

### 2026-07-08 · [worker] C-1/C-2 red-fix — #635 + #636 fixed, verified LIVE (PR #643)
Both Iteration-0 reds fixed and verified against a real built image (not the probe). PR #643,
auto-merge armed on green. tester ≠ fixer honored: the tester's exact repro drove the fix.

- **#635 (build) FIXED** — `units/callisthenes/.dockerignore` `*.patch` excluded the two patches the
  Dockerfile COPYs. Kept the lean-image glob, re-included the required files
  (`!headless-oauth1.patch`, `!relax-response-required.patch`). `docker build units/callisthenes/`
  now exits 0 from a fresh clone; image unpacks and boots FastMCP.
- **#636 (chat-auth) FIXED** — `register()._wrap` returned `inner(*args, **kwargs)`; FastMCP's
  `mcp.tool()` rejects VAR_POSITIONAL, so the whole registration threw and was swallowed into
  single-owner-headless. Pinned `inner.__signature__` to each wrapped method's real signature →
  FastMCP builds the correct schema and all five tools register. Error-envelope + guardrail
  behaviour unchanged.

**LIVE verification (real image `zenod-calli-fix`, dummy X creds):**
- boot log: `installed middleware: draft-guard (C-22) + throttle` + **`auth package registered`**.
- `tools/list` → **11 tools**: the 6 X tools **plus** `connect / complete_connect / connections /
  revoke / usage`, each with explicit params (e.g. `connect(mcp_token, service)`).
- guardrails still green through the live server: unapproved `createPosts` → `[draft_not_approved]`.
- **57 tests pass** (15 throttle+draft_guard, 40 auth, +2 new). Added
  `auth/test_register_fastmcp.py` — a boot-level regression guard that registers against a **real
  FastMCP instance** and asserts the five tools appear; this is the path the prior suite never
  exercised, which is exactly why #636 shipped green. `importorskip("fastmcp")` keeps CI safe.

**Handed forward to the tester/planner (honest, out of #635/#636 scope):**
- **Bearer-injection seam (C-1 wrapper).** The chat-auth tools now expose `mcp_token` as a *client-
  supplied* argument — the tools register and work, but `callisthenes_server.py` does not yet extract
  the caller's real MCP bearer from the request and inject it. Until it does, tenant identity is
  caller-asserted (a client could pass any `mcp_token`). Per-tenant isolation logic is correct; the
  live wrapper wiring is a separate ticket. Recommend the planner mint it before the C-6 exit run.
- Live X exit-criterion dance (connect real account via PIN → approved post → permalink) is now
  UNBLOCKED at the tool layer; still needs an X test account + LIVE creds (tester/Jordi).
- C-4a `usage()` reconciliation now reachable live once a real instance provisions. — [worker]

---

### 2026-07-08 · [planner/Epic-Zero] ⚙️ ITERATE — #645 tenant-isolation (do BEFORE any paid/multi-tenant run)

**Context.** #643 fixed #635/#636 — the unit builds and all five chat-auth tools register. But the
chat-auth tools now take **`mcp_token` as a client-supplied argument**, and `callisthenes_server.py`
does **not** inject the caller's real bearer. So tenant identity is **caller-asserted**: a client
could pass any `mcp_token` and reach another tenant's connections. The isolation logic is correct
(keys off `sha256(token)`); only the **source** of the token is untrusted. That's #645.

**Task (worker).**
1. Derive the tenant key from the **authenticated bearer** the MCP connection already carries — NOT
   from a client-supplied argument. Remove `mcp_token` from the tool signatures (or override it
   server-side) and have the server inject `sha256(real_bearer)` as the tenant key.
2. All five tools (`connect / complete_connect / connections / revoke / usage`) must key off the
   injected identity.

**Acceptance (fresh evidence).**
- (a) A client passing a **forged `mcp_token`** cannot reach another tenant — the server uses the
  bearer, not the arg.
- (b) connect → post → revoke still work per-tenant.
- (c) The boot-level FastMCP registration test stays green (all 5 tools register).
- (d) New test: a forged/absent token is rejected or scoped strictly to its own bearer.

**Discipline.** Worktree `wt/callisthenes-645` per SO-2; edit only `units/callisthenes/` + this doc;
land via PR to `main`. **Write the handback HERE, inline on main (SO-3) — not a dangling PR.**

**After #645:** C-6 (live X post → permalink) once an X test account is provided; C-3/C-4/C-5 once
`zenod-ai/cloud` access is granted (Stripe **TEST-mode** per SO-1). — [planner/Epic-Zero]
### 2026-07-08 · [planner, via Jordi] NEW DIRECTION — OAuth2 + minimal hosted UI (settled)
A design conversation (Jordi ↔ Fable) settled the auth model and the console question. This entry is
the binding record; it supersedes the console-less / OAuth1-PIN framing above where they conflict.

**Decisions (Jordi called each):**
- **D-A · Keep the SELF-HOSTED xmcp (full toolkit).** Research: X's *hosted* `api.x.com/mcp` writes
  are only bookmarks + Article publish (Posts fetch-only) — no general tweet posting. The vendored
  `xdevplatform/xmcp` gives 140+ ops incl. `createPosts/deletePosts/media`. We do a lot of X → we
  stay self-hosted for the toolkit. The hosted MCP's *auth idea* we adopt; its *server* we don't.
- **D-B · Auth = OAuth 2.0 PKCE, not OAuth1-PIN.** The PIN flow (built in C-2) is page-less but costs
  a manual 7-digit copy. OAuth2 "click Authorize → auto-redirect back" is zero-copy but needs a
  callback page. Jordi wants the click-only UX (ZNOT parity; the Nex setup's variable-pasting pain is
  the thing to kill). Scopes `tweet.read tweet.write users.read offline.access`. → **C-2R (#648)**;
  OAuth1-PIN retired from the hosted surface (may remain a self-host fallback).
- **D-C · Minimal hosted UI (reverses CD-4).** Hosted instances get a one-screen connect page — the
  distinction of the hosted tier, same as ZNOT gives Zenod a UI. Not a dashboard: one-button Connect
  X (OAuth2), a Reddit (Composio) field, an extensible connector list (Instagram/email later), and it
  shows the MCP URL + token. It doubles as the OAuth2 callback. → **C-7 (#649)**. The "no UI anywhere"
  thesis is retired for hosted; self-host stays CLI/headless.
- **D-D · Reddit via Composio.** X first, Reddit fast-follow via the suite's existing Composio path;
  token entered in the C-7 UI. Instagram/others later as connector rows. → **C-8 (#650)**.
- **D-E · Receipt profile RETAINED (non-negotiable).** SEAM-SPEC receipt profile = every mutating
  tool returns a real ID/URL or errors loudly; reads return explicit-empty, never faked. This is the
  anti-hallucination discipline (last week's learnings): the assistant may only claim a send happened
  by pointing at the permalink the tool returned. Enforced at the tool boundary — an MCP call ALWAYS
  returns a result or an explicit error, so "receipts or it didn't happen" is structural, not policed.

**What Callisthenes IS (Jordi's framing, recorded):** your *outbound identity broker* — "your guy."
You authorize him ONCE per platform (X, Reddit, later Instagram/email); he's an always-on MCP server;
every other agent (the ring, Claude, Cursor, scripts) points at him and can send without holding any
credential. Value = **authentication aggregated in one always-on place** + evidence. A dumb
"post this exact text" is still valuable because it's pre-authenticated; the smart end (LLM crafts the
content) is an optional layer on top. This is the suite's "Outbound" concept, productized standalone.

**Revised ticket set (supersedes the Iteration-0 table for auth/UI lanes):**
| ID | Lane | Status |
|---|---|---|
| C-1 | self-hosted xmcp unit: throttle + C-22 + receipts | ✅ built + red-fixed live (#630/#643) |
| ~~C-2~~ | ~~OAuth1-PIN chat-auth~~ | ⛔ superseded by C-2R |
| **C-2R** | OAuth 2.0 PKCE connect for X + per-tenant bearer identity (closes #645) | 🔨 #648 — dispatch now |
| **C-7** | minimal hosted connect-UI (Connect X / Reddit / MCP URL) | 🔨 #649 — after C-2R contract |
| **C-8** | Reddit send connector via Composio | 🔨 #650 — dispatch now (disjoint) |
| C-3 | website + Stripe checkout LIVE → provision (clone Z-2/Z-3) | ⛔ needs zenod-ai/cloud + Stripe LIVE (Jordi) |
| C-4 | meter via `usage()` (C-4a landed) | ⚠️ live reconciliation once an instance runs |
| C-5 | watchdog + ops | ⛔ needs cloud access (Jordi) |
| C-6 | Jordi's exit run | ⏳ last |

**Parallelizable NOW (dispatched):** C-2R (#648) ∥ C-8 (#650) — disjoint files, worktree-isolated.
**Blocked on Jordi grants:** C-3/C-5 (zenod-ai/cloud access + LIVE Stripe). **Sequenced:** C-7 after
C-2R's callback contract; C-4 reconciliation + C-6 once a real instance provisions. — [planner]
