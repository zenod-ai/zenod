# EPIC 2.9: EPAMINON MOVE 0 - the executor unit

Status: active
Created: 2026-07-09
Updated: 2026-07-09
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-2.9-EPAMINON-MOVE-0.md`
GitHub issues: https://github.com/zenod-ai/zenod/issues/682 through https://github.com/zenod-ai/zenod/issues/692
Planner: Epic 0 Foundation / Epaminon-Fable
Worker: Codex epic worker, current thread (bound 2026-07-09)
Tester: Chandrasekhar `019f47c2-b343-7452-8ec0-4eb5a79f6fc1` for EPM-8 / #690

## Role Bindings

Active binding: Codex is bound as the Epic 2.9 epic worker for `docs/EPIC-2.9-EPAMINON-MOVE-0.md`.
Scope is the full Epaminon Move 0 delivery goal. No GitHub issue is bound yet; start from EPM-0
scope audit and issue minting, then dispatch ticket workers once issue rows are accepted and
unblocked. Referenced spines remain read-only unless explicitly delegated.

| Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|
| Planner | Epaminon unit scope | Edit this spine's planning sections and issue ledger; do not implement code by default. | Updated issue ledger, decisions, dispatch notes. |
| Epic worker | Epaminon Move 0 | Create/update GitHub issues within this scope, dispatch ticket workers, update delivery state. | Spine issue ledger, dispatch state, blockers, ready-for-test state. |
| Ticket worker | One issue row | Execute assigned issue; update issue and limited spine status/evidence/handoff. | PR/branch, implementation notes in issue, spine handoff. |
| Tester | Issue, PR, or milestone | Validate against acceptance; update validation evidence and pass/fail. | Test commands, result, risks, follow-up issues. |

## Write Scope

Bound spine: `docs/EPIC-2.9-EPAMINON-MOVE-0.md`

Writable by default:

- Epaminon planner: mission, decisions, issue ledger, dispatch notes.
- Assigned workers: assigned issue row, implementation status, handoff notes, evidence.
- Assigned testers: validation evidence, pass/fail state, residual risks.

Read-only linked spines:

- `docs/EPIC-0-FOUNDATION-SPINE.md` - parent/meta EpicSpine.
- `docs/EPAMINON-ARCHUS-PROTOCOL.md` - current execution protocol.
- `docs/SUITE-SCAFFOLD.md` - suite topology and unit shape.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` - atomic unit / MCP seam constraints.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` - comparable standalone-unit pattern.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` - comparable standalone-unit pattern.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless
explicitly granted write authority for the target spine.

## Mission

Make Epaminon a first-class cloud worker product: a standalone MCP server that accepts a text task,
effort level, and optional repo/output/MCP context, then dispatches an authenticated Codex/Claude
style harness on a VPS/container to completion in an orderly, durable way.

The user-facing outcome for Move 0 is concrete:

- a public Epaminon page with test Stripe purchase;
- purchase lands the user on their cloud instance UI;
- the instance UI shows Epaminon settings, MCP server address, and connection instructions for
  Claude/Codex;
- the user can connect Claude/Codex directly or ask the Ring/Council over WhatsApp to run a
  research/execution task;
- Epaminon runs the task, leaves the result in the requested repo or artifact target, and exposes
  status, transcript, receipts, and evidence.

Archus execution tickets remain one suite integration and receipt path, not the whole public product
surface. Ring 2.5 will connect to Epaminon as a product/MCP server.

## Scope Correction Under Discussion

Jordi's 2026-07-09 direction is accepted as the Move 0 target: Epaminon should be framed first as a
modular cloud worker harness, not only as Archus's execution-ticket drain. At the simplest level it
is an MCP server that accepts a prompt/task, runs an authenticated Codex/Claude-style CLI worker on a
VPS/container, and returns durable status/evidence. GitHub issues should be treated as receipts or
target work objects where useful, not as a mandatory prerequisite the caller must create before every
run. The current Council path already has a working Epaminon integration; this epic should simplify
and decouple it rather than rebuild a tighter Archus-only protocol.

Implications to resolve before minting worker tickets:

- Keep direct task execution as a first-class product path: `run_task(prompt, effort?, repo?,
  outputTarget?, mcpServers?, skills?, instructions?)` or equivalent.
- Preserve ticket-backed receipts for traceability, but prefer automatic execution receipts over
  forcing users to pre-create work issues.
- Authentication remit includes GitHub credentials for code/issue/PR work, model/CLI credentials
  for Codex/Claude-style execution, and per-agent MCP tokens for prewired memory/outbound/custom
  servers.
- Ring/Console should configure Epaminon as a connected product: endpoint, token, worker
  instructions, prewired MCP servers, skills, and health/status. The self-hosted/bare path can
  remain a headless MCP server configured by env/API.
- Do not expose internal Archus/Epaminon lane tools as the public user surface.

## Definition Of Done

- [ ] Epaminon has an explicit unit surface (`units/epaminon/` or equivalent) with README,
      Docker/compose story, SEAM-SURFACE, and headless MCP runbook.
- [ ] `sites/epaminon/` or equivalent public page exists with test Stripe checkout wired to
      `cloud-test.zenod.dev` / `STRIPE_MODE=test` per Epic 2 D-6A.
- [ ] Test purchase provisions or simulates provisioning a cloud Epaminon instance and lands the user
      on the instance UI.
- [ ] The cloud instance UI exposes Epaminon settings: MCP URL/token, GitHub auth status, model/CLI
      auth status, worker instructions, effort defaults, prewired MCP servers, skills, status, and
      copyable Claude/Codex connection commands.
- [ ] Standalone MCP exposes a durable public task-dispatch contract that accepts text, effort level,
      optional repo/path/output target, optional MCP/skills context, and returns an execution id.
- [ ] Epaminon dispatches work to a worker container/harness, tracks queued/running/blocked/review/done,
      and persists status, transcript, result artifact, and evidence after restart.
- [ ] A research task can be initiated through Ring/Council over WhatsApp and routed to Epaminon,
      with results left in the requested repo/artifact target.
- [ ] Internal Archus/Epaminon lane tools (`enqueue_execution`, `approve_execution`,
      `apply_execution_event`) remain private and identity-gated; public/aggregate MCP exposes only
      allowed Epaminon tools.
- [ ] Bare self-hosted mode remains a headless MCP server configured by env/API; it does not require
      the hosted UI to function.

## Non-Goals

- Epaminon does not curate or hydrate the backlog; Archus owns backlog and execution-ticket minting.
- Epaminon does not own memory; Zenod owns memory ingest and recall.
- Epaminon does not own outbound credentials or direct sending; Callisthenes owns sending.
- This epic does not rewrite the Ring router or Phylax gateway.
- This epic does not build production billing beyond the test Stripe purchase path needed to validate
  purchase-to-instance handoff. TEST checkout/provisioning belongs on `cloud-test.zenod.dev`; the
  live switch is `cloud.zenod.dev` with live Stripe values.
- This epic does not make Archus execution tickets the required caller workflow for every Epaminon
  run.

## Current State

Phase: cloud-test setup route live; final acceptance blocked on Stripe price/provisioning credentials
Last verified: 2026-07-09
Next action: configure Stripe TEST `PRICE_EPAMINON` on `cloud-test.zenod.dev`, confirm webhook
signing and either enable `ZENOD_AUTO_PROVISION=1` with Dokploy credentials or run
`scripts/provision-epaminon.mjs` from the queue, then rerun EPM-8.
Blockers: local assembled acceptance passed, and `cloud-test.zenod.dev` now serves `/healthz` with
`stripe_mode=test` plus the Epaminon simulated setup page. The full Jordi-ready E2E is still blocked
because `/buy/epaminon` returns `Epaminon checkout is not configured (set PRICE_EPAMINON)`, this
environment lacks the real TEST Stripe/webhook values and deploy secrets, Dokploy list/deploy API
access returned 403 for broad discovery calls, and the real runner/model/WhatsApp/Phylax credentials
are absent here.

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPAMINON-ARCHUS-PROTOCOL.md` | Defines ownership, state machine, and Archus/Epaminon messages. | Always |
| 2 | `docker-compose.epaminon.yml` | Shows current headless internal container shape. | Always |
| 3 | `packages/server/src/executionQueue.ts` | Current Epaminon queue/state authority. | Worker |
| 4 | `packages/server/src/executionLane.ts` | Current launch/report/ship seams and gaps. | Worker |
| 5 | `packages/server/src/mcp.ts` | Current MCP tool exposure. | Worker/Tester |
| 6 | `packages/server/src/meshGateway.ts` | Current aggregate gateway and public tool filtering. | Worker/Tester |
| 7 | `docs/SUITE-SCAFFOLD.md` | Existing claim that Epaminon is live headless and unit-shaped. | Planner |
| 8 | `docs/AGENT-RUNNER.md` and `docker-compose.runner.yml` | Runner relationship and worker tool surface. | Worker |
| 9 | `sites/callisthenes/`, `apps/site/`, `docs/HERALD-BUY-BUTTON-PLAN.md` | Comparable public page, checkout, and hosted product patterns. | Public page/checkout worker |
| 10 | `apps/web/src/components/ring-control-surface.tsx`, `apps/web/src/views/settings/ConnectionsTab.tsx`, `apps/web/src/views/settings/TeamTab.tsx` | Existing Ring/connected-product UI and settings placement. | UI worker |

## Architecture And Context

Current grounded situation:

- `docker-compose.epaminon.yml` defines `zenod-epaminon` as an internal container on
  `dokploy-network`, `AGENT=epaminon`, reachable as `http://zenod-epaminon:8080`.
- `docs/SUITE-SCAFFOLD.md` lists Epaminon as `LIVE (headless)`.
- `packages/server/src/agent.ts` defines `EPAMINON_AGENT` as vaultless and executor-owned.
- `packages/server/src/executionQueue.ts` holds the queue state machine and transition rules.
- `packages/server/src/executionLane.ts` wires report-to-Archus, runner launch, and ship seams.
- `packages/server/src/mcp.ts` exposes `epaminon.run_existing_issue`,
  `epaminon.run_ephemeral_task`, `execution_status`, and `epaminon.execution_status` when the
  runtime has executor wiring.
- `packages/server/src/meshGateway.ts` advertises Epaminon tools through the aggregate gateway and
  explicitly keeps raw internal lane tools out of the worker-visible surface.

Known gap:

Epaminon is real as infrastructure and now has the local Move 0 product surfaces: unit docs, hosted
direct-worker compose, public page, Epaminon-specific settings UI, public MCP task aliases, Ring/
Council route-test wiring, and a Cloud checkout/setup/provisioner patch. What is not yet proven is
the deployed cloud-test journey: Stripe TEST purchase → `e-<slug>.zenod.dev` Epaminon instance →
MCP/WhatsApp dispatch → real repo/artifact evidence.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-09 | Number this draft Epic 2.9. | Avoids ambiguity with existing 2.7 Ring references and leaves 2.8 unclaimed. | `docs/EPIC-0-FOUNDATION-SPINE.md` handoff. |
| 2026-07-09 | Treat Epaminon as an executor unit, not as backlog, memory, send, or router. | Matches existing Archus/Epaminon protocol and agent persona. | `docs/EPAMINON-ARCHUS-PROTOCOL.md`; `packages/server/src/agent.ts`. |
| 2026-07-09 | Keep internal lane tools private. | Prevents workers/users from bypassing Archus/Epaminon identity-gated protocol. | `docs/AGENT-RUNNER.md`; `packages/server/test/meshGateway.test.ts`. |
| 2026-07-09 | Make Epaminon a modular cloud worker harness first; Archus execution tickets are one integration, not the whole product surface. | Jordi clarified the goal as "Codex/Claude in the cloud" with prompt dispatch, authenticated worker infrastructure, effort levels, prewired MCP servers, skills, and optional/automatic GitHub receipts. | Current code already has `epaminon.run_ephemeral_task`, Console ticket-backed one-offs, and Ring connected-product UI; user discussion 2026-07-09. |
| 2026-07-09 | Use `cloud-test.zenod.dev` for Epaminon Stripe TEST checkout/provisioning; reserve `cloud.zenod.dev` for live Stripe. | Keeps every hosted-product epic on the same safe test/live switch and prevents accidental test traffic through the live customer Cloud surface. | Epic 2 D-6A; Epic 2.3 ZD-12; Cloud `STRIPE_MODE` guard. |

## Issue Ledger

| Issue | Role | Title | Status | Depends On | PR/Branch | Acceptance | Latest Evidence | Next Action |
|---|---|---|---|---|---|---|---|---|
| [#682](https://github.com/zenod-ai/zenod/issues/682) | Epic worker | EPM-0 scope finalization and dispatch | in-progress | - | - | GitHub issues exist for accepted rows and workers are dispatched. | Issues #682..#690 minted 2026-07-09. | Dispatch workers and record owners. |
| [#683](https://github.com/zenod-ai/zenod/issues/683) | Worker | EPM-1 unit surface and seam contract | ready-for-test | [#682](https://github.com/zenod-ai/zenod/issues/682) | agent `019f47a5-5442-7352-8b3b-10c910358080`; local docs | `units/epaminon/` has README, SEAM-SURFACE, Docker/compose/runbook, auth remit, and maps current code paths. | `units/epaminon/` docs added 2026-07-09; local markdown links OK; public/private terminology grep passed. | Tester review. |
| [#684](https://github.com/zenod-ai/zenod/issues/684) | Worker | EPM-2 public page and test Stripe checkout | ready-for-test | [#682](https://github.com/zenod-ai/zenod/issues/682) | agent `019f47a5-7b61-7372-a076-2476dfab67d7`; local public-site files | Public Epaminon page has test purchase path and clear offer; checkout hands off to cloud-test instance setup or documented simulation. | `sites/epaminon/index.html` rewritten with literal cloud worker offer and simulated Stripe test receipt; cloud-test URL correction applied 2026-07-09; static validation passed 2026-07-09. | Tester review; replace simulated checkout with real `cloud-test.zenod.dev` Stripe test route when cloud provisioner exposes it. |
| [#685](https://github.com/zenod-ai/zenod/issues/685) | Worker | EPM-3 cloud instance landing and executor settings UI | ready-for-test | [#682](https://github.com/zenod-ai/zenod/issues/682) | agent `019f47a5-a363-7731-9bf5-d0e9ca541ef1`; local web/server files | Purchased/provisioned user lands on instance UI with MCP address, token, connection commands, auth status, worker instructions, effort defaults, prewired MCP servers, and skills. | 2026-07-09: Connections tab renders Epaminon executor settings on Epaminon instances; targeted web/server typechecks pass; mocked local DOM check passed. | Tester review against real provisioned Epaminon instance/settings store. |
| [#686](https://github.com/zenod-ai/zenod/issues/686) | Worker | EPM-4 standalone MCP task contract | ready-for-test | [#683](https://github.com/zenod-ai/zenod/issues/683) | agent `019f47a5-c75b-78e1-aed3-0df61419c86e`; local server files | Public MCP exposes durable `run_task`/equivalent with prompt, effort, repo/path/output target, MCP/skills context, and returns execution id/status. | 2026-07-09: direct Epaminon MCP aliases added and targeted typecheck/tests passed. | Tester verify direct aliases, status readback, and aggregate private-lane hiding. |
| [#687](https://github.com/zenod-ai/zenod/issues/687) | Worker | EPM-5 worker harness dispatch and lifecycle | ready-for-test | [#686](https://github.com/zenod-ai/zenod/issues/686) | local workspace | Epaminon dispatches containerized Codex/Claude-style worker with orderly queue, effort levels, auth, transcript, status, and artifact capture. | 2026-07-09: effort persists to execution tickets and runner launch body; missing runner/GitHub auth fails loudly; runner preflights GitHub/Codex/Claude auth; fan-in uploads launch logs as transcripts before terminal/blocked reports. | Tester run real runner-auth smoke with `ZENOD_RUNNER_POKE_URL`, GitHub auth, and Codex/Claude auth. |
| [#688](https://github.com/zenod-ai/zenod/issues/688) | Worker | EPM-6 auth, private lanes, and receipt model | ready-for-test | [#686](https://github.com/zenod-ai/zenod/issues/686) | local workspace | GitHub/model/CLI/MCP auth remit is implemented or documented; private Archus/Epaminon lane tools remain hidden; every run has durable receipt/evidence. | 2026-07-09: executor settings/auth status reflected by concurrent settings work; runner compose now persists Claude auth; private-lane negative mesh tests still pass; queue/store records effort and transcript/evidence pointers durably. | Tester verify public gateway still omits internal lane tools after EPM-4 aliases are merged. |
| [#689](https://github.com/zenod-ai/zenod/issues/689) | Worker | EPM-7 Ring/Council integration and WhatsApp research path | ready-for-test | [#685](https://github.com/zenod-ai/zenod/issues/685), [#686](https://github.com/zenod-ai/zenod/issues/686) | local server/web files | Ring/Council can route a WhatsApp research/execution request to Epaminon and leave results on requested repo/artifact target. | 2026-07-09: Console/Gateway expose prompt-first Epaminon run tools; Ring named Epaminon route-test carries WhatsApp provenance, effort, repo, and output target to `epaminon.run_task`; targeted typecheck/tests passed. | Tester review against `cloud-test.zenod.dev` provisioned Epaminon instance and real WhatsApp/Phylax path. |
| [#690](https://github.com/zenod-ai/zenod/issues/690) | Tester | EPM-8 end-to-end acceptance run | blocked | [#683](https://github.com/zenod-ai/zenod/issues/683)..[#689](https://github.com/zenod-ai/zenod/issues/689), [#692](https://github.com/zenod-ai/zenod/issues/692) | agent `019f47c2-b343-7452-8ec0-4eb5a79f6fc1` | `cloud-test.zenod.dev` Stripe TEST purchase → cloud instance UI → connect Claude/Codex or WhatsApp/Council → run research task → result/evidence in repo. | 2026-07-09: local automated acceptance passed; deployed `cloud-test` health/setup route now pass, but `/buy/epaminon` is blocked by missing `PRICE_EPAMINON`; real E2E also still needs provisioning and runner/channel credentials. | Configure `PRICE_EPAMINON`/webhook/provisioner env, then rerun EPM-8 against the real cloud-test instance. |
| [#692](https://github.com/zenod-ai/zenod/issues/692) | Worker | EPM-9 cloud-test Epaminon checkout/setup/provisioner deploy | in-progress | [#684](https://github.com/zenod-ai/zenod/issues/684), [#685](https://github.com/zenod-ai/zenod/issues/685), [#690](https://github.com/zenod-ai/zenod/issues/690) | private Cloud repo local patch; `units/epaminon/docker-compose.hosted.yml`; partial deploy visible on `cloud-test` | `cloud-test.zenod.dev` exposes Epaminon TEST checkout/setup/status, separates Stripe TEST from live, and provisions a hosted Epaminon instance or records the exact missing credential/deploy blocker. | 2026-07-09: local patch adds `PRICE_EPAMINON`, `/buy/epaminon`, `/setup/epaminon`, `/epaminon/status`, webhook receipt, direct hosted Epaminon compose, `provision-epaminon.mjs`, auto-provision wiring, and watchdog target; deployed `cloud-test` returns 200 for health/setup and 503 for `/buy/epaminon` with missing `PRICE_EPAMINON`. | Set TEST `PRICE_EPAMINON`/webhook and Dokploy provisioner env on `cloud-test`, then rerun EPM-8. |

## Planner Queue

- Confirm whether 2.9 numbering remains permanent.
- Decide final public tool name: `run_task`, `dispatch_worker`, or compatible alias around
  existing `run_ephemeral_task`.
- Confirm whether EPM-9 should enable `ZENOD_AUTO_PROVISION=1` immediately on `cloud-test` or leave
  paid Epaminon sessions queue-first until a human operator runs `scripts/provision-epaminon.mjs`.

## Worker Queue

- Build public page and test checkout handoff.
- Build cloud instance settings UI and MCP connection affordances.
- Build/normalize public standalone MCP task contract with effort levels.
- Close worker harness launch/status/transcript/artifact gaps.
- Wire Ring/Council route and WhatsApp research path.
- Audit auth and private/public tool exposure.

## Tester Queue

- Test Stripe purchase and cloud-instance landing.
- Claude/Codex MCP connection smoke.
- Direct prompt task dispatch with effort levels.
- WhatsApp/Council research dispatch.
- Needs-review/approve/ship test.
- Restart/status/transcript persistence test.
- Negative test: aggregate gateway must not expose private lane tools.

## Validation Evidence

| Date | Scope | Command / Method | Result | Evidence |
|---|---|---|---|---|
| 2026-07-09 | Existing state audit | Repo read: `docker-compose.epaminon.yml`, `docs/EPAMINON-ARCHUS-PROTOCOL.md`, `packages/server/src/executionQueue.ts`, `packages/server/src/mcp.ts`, `packages/server/src/meshGateway.ts` | partial/pass | Epaminon exists as headless internal executor; unit product spine missing. |
| 2026-07-09 | Deliverables deck structural check | Node parser verified title, 8 slides, progress bar, navigation buttons, and counter. | pass | `docs/EPIC-2.9-EPAMINON-DECK.html` |
| 2026-07-09 | Issue board creation | `gh issue create --repo zenod-ai/zenod` for EPM-0..EPM-8 | pass | Issues [#682](https://github.com/zenod-ai/zenod/issues/682) through [#690](https://github.com/zenod-ai/zenod/issues/690). GitHub connector timed out, CLI fallback succeeded. |
| 2026-07-09 | EPM-1 unit surface docs | Node local markdown link checker over `units/epaminon/{README.md,SEAM-SURFACE.md,RUNBOOK.md}`; `rg` terminology check for public/private/auth/bare-mode terms. | pass | `units/epaminon/README.md`, `units/epaminon/SEAM-SURFACE.md`, `units/epaminon/RUNBOOK.md`, `units/epaminon/docker-compose.epaminon.yml`, `units/epaminon/Dockerfile`. |
| 2026-07-09 | EPM-2 public page and simulated checkout | `npx --yes html-validate sites/epaminon/index.html`; `git diff --check -- sites/epaminon/index.html sites/README.md`; Node hash-link/acceptance-copy check; `curl -fsS http://127.0.0.1:4177/epaminon/` against local static server. | pass | `sites/epaminon/index.html` contains literal cloud Codex/Claude-style MCP worker offer, prompt + effort, prewired MCP/skills, GitHub artifacts, simulated Stripe receipt `epm2_epaminon_checkout_simulated`, and cloud setup link. Playwright screenshot attempt was stopped after no timely output; no local browser binary was available. |
| 2026-07-09 | EPM-3 executor settings UI | `npm run typecheck -w web`; `/Users/jordi/Documents/GitHub/zenod/apps/web/node_modules/typescript/bin/tsc -p packages/server/tsconfig.json --noEmit`; local Vite + mocked Epaminon API DOM check | pass | Web typecheck passed. Server typecheck passed via the web workspace TypeScript binary because root/server `tsc` symlink target is missing. DOM check confirmed Epaminon panel, MCP URL/token, Claude/Codex commands, GitHub/provider/CLI/lane statuses, effort default, prewired MCP server, skills textarea value, worker instructions textarea value, and save control. |
| 2026-07-09 | EPM-4 MCP task contract | `./node_modules/.bin/tsc --noEmit -p packages/server/tsconfig.json`; `./node_modules/.bin/vitest run --exclude='.claude/**' packages/server/test/mcp.test.ts packages/server/test/meshGateway.test.ts` | pass | Direct Epaminon MCP exposes `epaminon.run_task` and `epaminon.dispatch_worker`, returns execution id/ticket readable through `execution_status`; legacy `epaminon.run_ephemeral_task` and Console one-offs remain compatible; mesh test keeps private lane tools hidden. |
| 2026-07-09 | EPM-7 Ring/Council integration | `./node_modules/.bin/tsc --noEmit -p packages/server/tsconfig.json`; `./node_modules/.bin/vitest run --exclude='.claude/**' packages/server/test/mcp.test.ts packages/server/test/meshGateway.test.ts packages/server/test/ringRouter.test.ts packages/server/test/health.test.ts`; `rg "cloud\\.zenod\\.dev\|cloud-test\\.zenod\\.dev" <EPM-7 scoped files>` | pass | 68 targeted tests passed. Fused Console now prefers `epaminon_run_task` for prompt-first execution; mesh gateway publishes `epaminon.run_task`/`epaminon.dispatch_worker`; Ring named Epaminon route preserves same-channel mailbox provenance and passes prompt, effort, repo, output target, and origin instruction to `epaminon.run_task`. No EPM-7 scoped code/test wording points TEST provisioning at `cloud.zenod.dev`; tester should use `cloud-test.zenod.dev`. |
| 2026-07-09 | EPM-5/EPM-6 lifecycle/auth worker validation | `npm run test -w @zenod/server -- test/executionQueue.test.ts test/executionLane.test.ts test/mcp.test.ts test/meshGateway.test.ts` | pass | 80 focused Vitest tests passed. Covers queue persistence, lane-gated launch, effort payload, loud missing-runner/auth failure, MCP run tools, and private gateway exposure. |
| 2026-07-09 | EPM-5/EPM-6 runner-script validation | `node --test scripts/backlog-monitor.test.mjs scripts/fanout-codex.test.mjs` | pass | 146 script tests passed. Covers runner auth preflight, effort normalization/propagation, heartbeat/transcript helpers, fanout lifecycle, and blocker/report helpers. |
| 2026-07-09 | EPM-5/EPM-6 typecheck | `npm run typecheck -w @zenod/server` | pass | TypeScript server typecheck passed. |
| 2026-07-09 | EPM-8 assembled local acceptance | `npm run typecheck -w @zenod/server`; `npm run typecheck -w web`; `npx --yes html-validate sites/epaminon/index.html`; `npm run test -w @zenod/server -- test/executionQueue.test.ts test/executionLane.test.ts test/mcp.test.ts test/meshGateway.test.ts test/ringRouter.test.ts test/health.test.ts`; `node --test scripts/backlog-monitor.test.mjs scripts/fanout-codex.test.mjs`; `git diff --check -- <EPM-8 scoped files>` | pass | Server typecheck, web typecheck, and HTML validation passed. Focused server suite passed 112 tests, covering MCP task aliases, status readback, queue/lane lifecycle, executor settings, Ring route-test, health, and private-lane hiding. Runner scripts passed 146 tests. Diff whitespace check passed. |
| 2026-07-09 | EPM-8 cloud-test and credential E2E gate | `curl -I --max-time 15 https://cloud-test.zenod.dev/`; `curl -I --max-time 15 'https://cloud-test.zenod.dev/setup/epaminon?receipt=epm2_epaminon_checkout_simulated'`; env presence check for Stripe, runner, model, WhatsApp, and Phylax variables. | blocked | `cloud-test.zenod.dev` is reachable through Cloudflare but returns HTTP 404 for both `/` and the simulated setup path. Missing exact inputs in this tester environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_MODE`, `ZENOD_RUNNER_POKE_URL`, `ZENOD_CONSOLE_TOKEN`, `ZENOD_EPAMINON_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `PHYLAX_URL`, and `PHYLAX_TOKEN`. |
| 2026-07-09 | EPM-9 Cloud route patch local validation | In `/Users/jordi/Documents/GitHub/cloud/services/webhook`: `npm run typecheck`; `npm run build`; local `STRIPE_MODE=test PRICE_EPAMINON=price_test_epaminon PORT=4259 node dist/server.js`; `curl -I 'http://127.0.0.1:4259/setup/epaminon?receipt=epm2_epaminon_checkout_simulated'`; `curl -fsS http://127.0.0.1:4259/healthz`. | pass/local-only | Cloud webhook typecheck/build passed. Local health returned `{"ok":true,"stripe_mode":"test"}` and simulated Epaminon setup returned HTTP 200 with `PRICE_EPAMINON`, `/buy/epaminon`, `/epaminon/status`, and `cloud-test` copy. `/buy/epaminon` reached Stripe code but failed with expected 401 because the smoke used a dummy `sk_test_replace_me` key. |
| 2026-07-09 | Epaminon static-page image packaging | `apps/site/Dockerfile` inspection and patch. | pass/local-only | Runtime image now copies `sites/epaminon/index.html` into `/usr/share/nginx/html/epaminon/index.html`, matching the already-present Ring public page copy. |
| 2026-07-09 | EPM-9 hosted Epaminon provisioner bridge | `docker compose -f units/epaminon/docker-compose.hosted.yml config`; in `/Users/jordi/Documents/GitHub/cloud`: `node scripts/provision-epaminon.mjs --name epm9test --email test@example.com --image test --dry-run`; `npm run typecheck`; `npm run build`; local port 4260 health/setup/buy smoke. | pass/local-only | Hosted compose resolves to a direct `AGENT=epaminon` service on `dokploy-network`. Provisioner dry-run printed `https://e-epm9test.zenod.dev`, `https://e-epm9test.zenod.dev/mcp`, bearer token, and watchdog target. Cloud typecheck/build passed after auto-provision wiring. Local health/setup smoke returned 200; `/buy/epaminon` failed at expected dummy Stripe auth. |
| 2026-07-09 | Deployed cloud-test Epaminon route check | `curl -I https://cloud-test.zenod.dev/healthz`; `curl -I 'https://cloud-test.zenod.dev/setup/epaminon?receipt=epm2_epaminon_checkout_simulated'`; `curl https://cloud-test.zenod.dev/buy/epaminon`; setup body grep. | blocked | Deployed health is HTTP 200 with `{"ok":true,"stripe_mode":"test"}`. Simulated Epaminon setup is HTTP 200 and contains `Epaminon TEST receipt`, `PRICE_EPAMINON`, `/buy/epaminon`, `/epaminon/status`, `cloud-test`, and live-only `cloud.zenod.dev` copy. Real checkout is HTTP 503 body `Epaminon checkout is not configured (set PRICE_EPAMINON)`. |

## Residual Risks

- Real purchase-to-instance flow is not proven. The public page has a documented simulated receipt,
  and the private Cloud repo now has a local setup/status/checkout route patch, but the patch is not
  deployed to `cloud-test.zenod.dev`.
- Real Stripe TEST checkout/provisioning is not proven because this environment has no live test
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `PRICE_EPAMINON` value. The local `/buy/epaminon`
  smoke reached Stripe session creation and failed only because a dummy test key was used.
- Hosted Epaminon provisioning is implemented locally but not deployed. The chosen target is a direct
  `AGENT=epaminon` hosted compose at `e-<slug>.zenod.dev`; it still needs cloud-test deployment and
  real Dokploy/Stripe TEST credentials before EPM-8 can prove it.
- Real worker dispatch is not proven against a live runner because `ZENOD_RUNNER_POKE_URL`,
  `ZENOD_CONSOLE_TOKEN`, `ZENOD_EPAMINON_URL`, and runner-scoped GitHub/Codex/Claude auth are absent.
- Real WhatsApp/Council/Phylax dispatch is not proven because no WhatsApp or Phylax credentials or
  live channel endpoint are present. The synthetic Ring route-test coverage passed.
- Result artifact creation in a real repo is not proven by EPM-8; it is covered only by local queue,
  runner, and evidence-path tests until a real runner-auth smoke can execute.

## Handoff Journal

### 2026-07-09 - Codex epic worker - EPM-9 cloud-test route patch prepared

Context: Jordi asked to keep Epic 2.9 Stripe TEST work on `cloud-test.zenod.dev`, separate from the
live `cloud.zenod.dev` Stripe setup, and to resume after updating impacted tickets.

Result: Created EPM-9 / #692 as the cloud-test control-plane ticket. In the private Cloud repo
(`/Users/jordi/Documents/GitHub/cloud`), the local webhook patch adds Epaminon as a hosted unit with
`PRICE_EPAMINON`, `/buy/epaminon`, `/setup/epaminon`, `/api/epaminon/status`,
`/epaminon/status`, webhook queue receipts for `unit=epaminon`, auto-provision wiring, and a
watchdog target. In this repo, `units/epaminon/docker-compose.hosted.yml` now provides the direct
hosted worker template and `apps/site/Dockerfile` copies the Epaminon standalone page into the
static site image at `/epaminon/index.html`.

Validation: Cloud webhook `npm run typecheck` and `npm run build` passed. Local Cloud smoke returned
`{"ok":true,"stripe_mode":"test"}` from `/healthz` and HTTP 200 from
`/setup/epaminon?receipt=epm2_epaminon_checkout_simulated`. `docker compose -f
units/epaminon/docker-compose.hosted.yml config` passed, and `node scripts/provision-epaminon.mjs
--name epm9test --email test@example.com --image test --dry-run` printed the expected
`e-<slug>.zenod.dev` UI/MCP/token receipt. The checkout smoke failed only at Stripe auth because it
intentionally used `sk_test_replace_me`.

Blocker: The deployed `cloud-test.zenod.dev` service now serves health and the simulated Epaminon
setup page, but `/buy/epaminon` returns `Epaminon checkout is not configured (set PRICE_EPAMINON)`.
This environment does not have the real TEST Stripe key/webhook/price, Dokploy deploy permission for
broad service discovery, runner credentials, model/CLI auth, or WhatsApp/Phylax access.

Next: Set `PRICE_EPAMINON` and TEST Stripe webhook values on `cloud-test.zenod.dev`, decide whether
to enable `ZENOD_AUTO_PROVISION=1` or run the provisioner manually from the queue, then rerun EPM-8.

### 2026-07-09 - Codex tester - EPM-8 blocked after local acceptance

Context: Bound as tester for issue #690 with write scope limited to validation evidence, issue ledger
status, residual risks, and handoff journal. Read the bound spine, issue handoffs #683 through #690,
the Epaminon public page, executor settings UI, MCP/mesh/Ring server files, runner docs, and runner
compose. Treated concurrent local implementation changes as worker handoffs and did not edit
production behavior.

Result: Local assembled acceptance passed. The public page/deck/spine route TEST wording to
`cloud-test.zenod.dev`; live `cloud.zenod.dev` is only referenced as live-only context. MCP and mesh
code expose `epaminon.run_task` / `epaminon.dispatch_worker` and status tools while keeping private
lane tools covered by negative gateway tests. Ring route-test coverage verifies WhatsApp-style
provenance, effort, repo, and output target forwarding to `epaminon.run_task`.

Validation: Server typecheck, web typecheck, HTML validation, focused server suite (112 tests),
runner script suite (146 tests), and scoped diff whitespace check all passed on 2026-07-09.

Blocker: Full E2E is not ready for Jordi's real test yet. `cloud-test.zenod.dev` returns HTTP 404
for `/` and `/setup/epaminon?receipt=epm2_epaminon_checkout_simulated`, and this environment lacks
the exact Stripe TEST, runner, model/CLI, WhatsApp, and Phylax credentials listed in Residual Risks.

Next: Provision or expose the cloud-test Epaminon TEST checkout/setup route, seed runner auth and
channel credentials, then rerun EPM-8 from purchase/simulation through direct MCP and
WhatsApp/Council dispatch to a real repo/artifact result.

### 2026-07-09 - Codex ticket worker - EPM-5/EPM-6 ready for tester review

Context: Bound as ticket worker for EPM-5/EPM-6, issues #687 and #688. Worked in a concurrent
workspace where EPM-3 settings UI and EPM-4 public task-contract edits were already present; kept the
public tool names currently in the workspace and did not expose private lane tools through the gateway.

Result: Implemented effort persistence and launch propagation across execution queue/store, lane
enqueue, MCP run handlers, fanout CLI, and prompt-only runner path. Changed launch behavior so missing
runner/GitHub auth fails the execution loudly instead of leaving fake-running work. Added runner `/run`
preflight for GitHub, Codex, and Claude auth. Fan-in now uploads runner launch logs as durable
transcript evidence before terminal/blocked reports. Runner compose now persists Claude auth state.

Validation: Focused server tests, runner-script tests, and server typecheck passed on 2026-07-09.

Next: Tester should run a real runner-auth smoke with `ZENOD_RUNNER_POKE_URL`, GitHub auth, and either
Codex or Claude auth present, then verify a direct task produces transcript/status/evidence after
restart. Planner should reconcile concurrent EPM-4 public tool aliases with this lifecycle slice before
PR finalization.

### 2026-07-09 - Codex/cloud-billing - Epaminon adopts cloud-test for Stripe TEST

Cross-epic billing note folded after Jordi's decision: Epaminon test checkout/provisioning should
target `cloud-test.zenod.dev` with `STRIPE_MODE=test`. `cloud.zenod.dev` is reserved for the live
Stripe switch once the product is ready for production. Existing simulated checkout text is a
placeholder; the real EPM-2/EPM-8 route should be `cloud-test`. VPS receipt: `cloud-test.zenod.dev`
is bound, `/healthz` reports `{"ok":true,"stripe_mode":"test"}`, and the Ring/default test routes
return Stripe `cs_test_...` checkouts. Epaminon still needs `PRICE_EPAMINON` / provisioner routing
before its own test checkout can replace the simulated receipt.

Authority: canonical billing decision lives in Epic 2 D-6A and Epic 2.3 ZD-12; this spine consumes
that shared hosted-control-plane rule for Epaminon.

### 2026-07-09 - Codex - EPM-7 dispatched

Context: EPM-3 executor settings UI and EPM-4 public MCP task contract are ready for tester review,
which unblocks the Ring/Council integration worker.

Dispatch: EPM-7 / #689 assigned to Socrates, agent `019f47b1-7cd0-7710-b9f5-8719c452fffd`.

Next: Await EPM-7 handback, then dispatch EPM-8 tester after EPM-5/EPM-6 also hand back.

### 2026-07-09 - Codex ticket worker - EPM-7 ready for tester review

Context: Bound to issue #689 with write scope limited to Ring/Council integration code, peer-tool
catalog sections, Ring control-surface copy, and corresponding tests. The 2026-07-09 cloud-test
correction is applied to EPM-7 acceptance: Stripe TEST/provisioned-instance validation should use
`cloud-test.zenod.dev`; `cloud.zenod.dev` remains the live customer surface.

Result: Updated the fused Console/Council persona and peer-tool catalog so prompt-first execution
requests route to `epaminon_run_task` / `epaminon.run_task` without requiring a pre-created work
issue. The aggregate gateway now publishes `epaminon.run_task` and `epaminon.dispatch_worker`.
Ring's named Epaminon route-test path calls `epaminon.run_task` and carries prompt, effort,
repo/output target, same-channel mailbox provenance, and origin instructions. Ring connected-product
UI copy now frames Epaminon as a cloud worker harness with status/evidence receipts.

Validation: Server typecheck passed. Targeted Vitest run passed for MCP, mesh gateway, Ring router,
and server health suites (68 tests). Scoped EPM-7 code/tests contain no `cloud.zenod.dev` TEST
provisioning wording.

Issue handoff: https://github.com/zenod-ai/zenod/issues/689

Next: Tester should validate against a `cloud-test.zenod.dev` provisioned Epaminon instance and a
real WhatsApp/Phylax message path once channel access is available.

### 2026-07-09 - Codex ticket worker - EPM-3 ready for tester review

Context: Bound to issue #685 with write scope limited to `apps/web/src/**` and the minimal
`packages/server/src/app.ts` / `settings.ts` API needed for executor settings.

Result: Added an Epaminon-only Connections tab executor panel showing MCP URL/token, copyable
Claude/Codex commands, GitHub/provider/CLI/lane readiness, effort default, worker instructions,
prewired MCP servers, skills, and a save action. Added `/api/executor/settings` with write-only MCP
server token handling and secret-free status payloads.

Validation: `npm run typecheck -w web` passed. Server typecheck passed with the web workspace
TypeScript binary because the root/server `tsc` symlink target is missing. Local Vite plus a mocked
Epaminon API DOM check passed for the EPM-3 surface and textarea values.

Next: Tester should validate against a real provisioned Epaminon instance and confirm persisted
settings are consumed by the worker/harness path once EPM-5/EPM-6 land.

### 2026-07-09 - Codex ticket worker - EPM-4 ready for tester review

Context: Bound to issue #686 with write scope limited to the public MCP contract and corresponding
tests.

Result: Added direct Epaminon public task aliases `epaminon.run_task` and
`epaminon.dispatch_worker` over the existing durable execution queue, accepting prompt, effort,
repo/path, output target, MCP server context, skills, and instructions. The legacy direct
`epaminon.run_ephemeral_task`, exact issue run tool, and Console ticket-backed one-off path remain
compatible; descriptions now distinguish direct prompt-first execution from Console ticket-backed
receipts.

Validation: `./node_modules/.bin/tsc --noEmit -p packages/server/tsconfig.json` passed.
`./node_modules/.bin/vitest run --exclude='.claude/**' packages/server/test/mcp.test.ts
packages/server/test/meshGateway.test.ts` passed (36 tests).

Issue handoff: https://github.com/zenod-ai/zenod/issues/686#issuecomment-4927272146

Next: Tester should verify issue #686 against acceptance, especially direct alias registration,
status readback via `execution_status`, and aggregate gateway private-lane hiding.

### 2026-07-09 - Codex ticket worker - EPM-2 ready for tester review

Context: Bound to issue #684 with code write scope limited to public-site files.

Result: Rewrote `sites/epaminon/index.html` from the ticket-first skeleton into the Move 0 public
offer: a cloud Codex/Claude-style worker exposed as an MCP server, accepting prompt + effort and
prewired MCP/skills context, with GitHub artifacts and receipts as the output. Added an explicit
Stripe test-mode simulation: the CTA lands on a receipt section and links to a simulated Cloud
setup URL. Post D-6A correction: the real route should be `cloud-test.zenod.dev`, not
`cloud.zenod.dev`, once the Epaminon provisioner exposes it. Updated the
Epaminon row in `sites/README.md` to match the public offer.

Validation: HTML validation, diff whitespace check, local served-page curl, and Node
hash-link/acceptance-copy checks passed. Browser screenshot capture was attempted with Playwright
but stopped after it produced no timely output; no local browser binary was available.

Issue handoff: https://github.com/zenod-ai/zenod/issues/684#issuecomment-4927255134

### 2026-07-09 - Codex epic worker - cloud-test correction applied

Context: Jordi clarified that all Epic 2.9 Stripe TEST purchase/provisioning work must target
`cloud-test.zenod.dev`, running alongside the live `cloud.zenod.dev` Stripe setup.

Result: Updated the Epaminon public page and HTML deck so the simulated receipt, setup handoff,
MCP example URL, and delivery narrative point at `cloud-test.zenod.dev` for test mode. Live
`cloud.zenod.dev` remains documented only as the separate production Stripe surface.

Tickets updated: #684, #685, #689, and #690.

Next: Tester should review issue #684 against acceptance. The remaining product boundary is replacing
the simulated hash receipt with a real Stripe test Checkout URL once the cloud Epaminon provisioner
route exists.

### 2026-07-09 - Codex ticket worker - EPM-1 ready for tester review

Context: Bound to issue #683 with write scope limited to `units/epaminon/**` and minimal updates to
this spine.

Result: Added Epaminon's unit surface docs: README, SEAM-SURFACE, RUNBOOK, Dockerfile note, and
unit-local compose. The docs separate the public `run_task` / `dispatch_worker` target from the
private Archus/Epaminon lane, document auth remit and bare headless mode, and map current code
anchors.

Validation: Local markdown link checker passed for the new markdown files. `rg` terminology check
confirmed public/private/auth/bare-mode terms are present.

Issue handoff: https://github.com/zenod-ai/zenod/issues/683#issuecomment-4927240306

Next: Tester should review issue #683 against acceptance and decide whether EPM-2/EPM-6 can use
the documented public surface as their contract.

### 2026-07-09 - Codex - First worker wave dispatched

Context: Independent ticket workers were launched for the first executable batch. EPM-7 is held
until the UI and public MCP contract stabilize; EPM-8 remains blocked until worker handback.

Dispatches:

- EPM-1 / #683: Anscombe, agent `019f47a5-5442-7352-8b3b-10c910358080`.
- EPM-2 / #684: Popper, agent `019f47a5-7b61-7372-a076-2476dfab67d7`.
- EPM-3 / #685: Franklin, agent `019f47a5-a363-7731-9bf5-d0e9ca541ef1`.
- EPM-4 / #686: Russell, agent `019f47a5-c75b-78e1-aed3-0df61419c86e`.
- EPM-5 and EPM-6 / #687, #688: Euler, agent `019f47a5-f2ce-7f30-a1ac-4565c24f1e7b`.

Next: Review handbacks, integrate non-conflicting changes, then dispatch EPM-7 Ring/Council
integration and EPM-8 tester.

### 2026-07-09 - Codex - GitHub issue board minted

Context: Jordi accepted the final Epic 2.9 goal and asked to create all tickets per EpicSpine
doctrine, then dispatch agents until the epic is ready.

Result: Created GitHub issues #682 through #690 in `zenod-ai/zenod`.

Next: Dispatch independent workers for EPM-1 through EPM-7 and keep EPM-8 blocked until worker
handback.

Links:

- https://github.com/zenod-ai/zenod/issues/682
- https://github.com/zenod-ai/zenod/issues/683
- https://github.com/zenod-ai/zenod/issues/684
- https://github.com/zenod-ai/zenod/issues/685
- https://github.com/zenod-ai/zenod/issues/686
- https://github.com/zenod-ai/zenod/issues/687
- https://github.com/zenod-ai/zenod/issues/688
- https://github.com/zenod-ai/zenod/issues/689
- https://github.com/zenod-ai/zenod/issues/690

### 2026-07-09 - Codex - Scope correction pass

Context: Jordi clarified that Epaminon should stay modular: a VPS-hosted worker harness that can run
Codex/Claude-style tasks from a prompt with prewired MCP servers and skills. The existing
Council/Console path already had working Epaminon behavior; the new epic should simplify and
decouple rather than require every caller to arrive with a pre-created GitHub work issue.

Current implementation read: live fused Council is `AGENT=console`; `units/council/` and
`units/ring/` are blueprints staged behind the split trigger; `AGENT=epaminon` is a real headless
executor; Team/Ring UI enables Epaminon without a repo picker and wires it as a peer product; the
Console one-off path now mints a GitHub execution ticket as a receipt, while the direct Epaminon MCP
`run_ephemeral_task` still supports issue-less queue entries.

Next: Rewrite EPM-0 recommendations around a public modular harness surface plus private
Archus/Epaminon lane, then update the deck/ledger if Jordi accepts this direction.

Risks: Do not turn GitHub execution tickets into mandatory UX friction. Do not lose durable receipts.
Do not make self-hosted/bare mode depend on the Console UI.

### 2026-07-09 - Codex - Deliverables deck created

Context: Jordi asked for a simple HTML deck showing the deliverables the bound Epic 2.9 worker will
work on.

Next: Use the deck as a human-readable companion to EPM-0 scope audit, then mint/update GitHub
issues for accepted EPM rows.

Links:

- `docs/EPIC-2.9-EPAMINON-DECK.html`

### 2026-07-09 - Codex - Epic worker bound

Context: Jordi bound the current Codex thread as the Epic 2.9 worker under the EpicSpine role-binding
protocol.

Next: Start from EPM-0: audit the Epaminon Move 0 scope, reconcile draft ledger rows, then create
GitHub issues for accepted executable tickets or record the exact planner/user blocker.

Risks: Keep parent and sibling spines read-only. Do not change product acceptance, expose internal
lane tools, or decide hosted-vs-internal scope without explicit planner/user input.

Links:

- `skills/epic-spine/SKILL.md`
- `docs/EPAMINON-ARCHUS-PROTOCOL.md`
- `docker-compose.epaminon.yml`

### 2026-07-09 - Epic 0 Foundation - Draft spine created

Context: Jordi asked whether Epaminon should get its own epic like Zenod 2.3 and Callisthenes 2.4.
Audit confirms Epaminon is already a headless internal MCP/server shape but lacks the unit
productization spine.

Next: Review numbering/scope, then mint GitHub issues for EPM-0..EPM-7.

Risks: Do not blur Epaminon with Archus. Do not expose internal lane tools publicly. Do not claim
shipping/merge behavior is complete while `shipExecution` still has known gaps.

Links:

- `docs/EPAMINON-ARCHUS-PROTOCOL.md`
- `docker-compose.epaminon.yml`
- `packages/server/src/executionQueue.ts`
- `packages/server/src/executionLane.ts`
- `packages/server/src/mcp.ts`

## Open Questions

- Is 2.9 permanent, or should it be renumbered once Ring numbering settles?
- Is Epaminon Move 0 internal-suite only, or should it have a hosted setup UI like other units?
- Should issue-less ephemeral execution remain part of Epaminon, or be hidden behind durable
  execution tickets only?
- Which outward shippers belong in Move 0: PR merge only, Callisthenes send, both, or neither?
- Should the public Epaminon surface be renamed/reframed from `run_ephemeral_task` to a durable
  `run_task`/`dispatch_worker` contract where GitHub issue creation is an automatic receipt option,
  not a caller prerequisite?
- Where should Epaminon's worker configuration live first: Console/Ring connected-product settings,
  a future Epaminon settings tab, or headless env/API only for Move 0?

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-09 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Register this as a child spine spun out by Epic 0 Foundation. | This file. | Epic 0 Foundation planner | proposed |
| 2026-07-09 | `docs/SUITE-SCAFFOLD.md` | If accepted, point Epaminon row to this spine as the active executor-unit plan. | Existing row says Epaminon is live headless. | Suite planner | proposed |
| 2026-07-09 | `docs/EPIC-2.5-ATOMIC-UNITS.md` and `units/ring/SEAM-SURFACE.md` | Update the Ring/Council target seam to include named Epaminon direct prompt-first dispatch (`epaminon.run_task` / `dispatch_worker`) with origin mailbox provenance, effort, repo/path, output target, MCP servers, and skills. Keep internal lane tools private. | EPM-7 implementation and tests route named WhatsApp-style Epaminon requests directly through `epaminon.run_task`; current 2.5 seam still describes Epaminon mainly as `dispatch_epaminon` with target/task/depth. | Epic 2.5 planner / Ring seam owner | proposed |
| 2026-07-09 | Epic 2.5 Ring settings/API follow-up | Persist Ring connected-product `tools.runTask` in configured product settings, or otherwise document that EPM-7 currently supplies it only when Ring products are derived from Console peers. | `ringServerFromPeer` can map Epaminon peers to `runTask`, but the generic Ring connected-product settings normalizer does not yet persist `runTask`; editing settings normalization was outside EPM-7 write scope. | Epic 2.5 planner / settings owner | proposed |

## Appendix

Useful current-code anchors:

- `docker-compose.epaminon.yml`
- `packages/server/src/agent.ts` (`EPAMINON_AGENT`)
- `packages/server/src/executionQueue.ts`
- `packages/server/src/executionLane.ts`
- `packages/server/src/executionStore.ts`
- `packages/server/src/executionTranscript.ts`
- `packages/server/src/mcp.ts`
- `packages/server/src/meshGateway.ts`
- `docs/EPIC-2.9-EPAMINON-DECK.html`
- `scripts/fanout-codex.mjs`
- `scripts/backlog-monitor.mjs`
