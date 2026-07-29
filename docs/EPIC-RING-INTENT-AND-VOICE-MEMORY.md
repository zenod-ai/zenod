# EPIC: Ring Typed Intent And Voice-Memory Stabilization

Status: ready for dispatch
Created: 2026-07-29
Updated: 2026-07-29
Repository: zenod-ai/zenod
Primary document: `docs/EPIC-RING-INTENT-AND-VOICE-MEMORY.md`
GitHub issues: `https://github.com/zenod-ai/zenod/issues`
Integration branch: main
Active spine steward: `/root` planner
Steward since: 2026-07-29 15:00 CEST
Last reconciled commit: `cb7b966b1092f566c4af62f25ec4260d5075ec49`
Planner: `/root`
Worker: unassigned until Jordi launches agents
Tester: `/root` plus real human web-chat and WhatsApp journey walker

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | `/root` | This spine and issues RIV-1..RIV-7 | Steward planning, decisions, dependency order, and issue ledger. Do not implement by default. | Dispatch-ready spine, linked issues, exact base, next human decision. |
| Epic worker | To be launched by Jordi | This spine | Coordinate ticket workers, review passing PRs, integrate only accepted generic contracts, reconcile this spine. | Issue/PR links, exact candidate SHA, tests, residual risks, next live prompt. |
| Ring worker | To be assigned | [#982](https://github.com/zenod-ai/zenod/issues/982), [#985](https://github.com/zenod-ai/zenod/issues/985), [#984](https://github.com/zenod-ai/zenod/issues/984), [#983](https://github.com/zenod-ai/zenod/issues/983), or [#986](https://github.com/zenod-ai/zenod/issues/986), exactly one issue per worker | Implement only the bound Ring contract on a dedicated `codex/*` branch and worktree. No channel, peer, or production changes. | PR, base/latest commit, focused and regression tests, risks, next action in the issue. |
| Phylax worker | To be assigned | [#987](https://github.com/zenod-ai/zenod/issues/987) | Implement only bounded connection lifecycle and receive-path health. The review-blocked draft is evidence, not approved code. | PR, lifecycle tests, base/latest commit, risks, next action in the issue. |
| Integration tester | To be assigned after reviewed integration | [#988](https://github.com/zenod-ai/zenod/issues/988) | Walk real browser/WhatsApp journeys against one exact candidate. No deploy, public post, or historical replay without the Human Gate. | Screenshot/log package, exact SHA, pass/fail per journey, next live prompt. |
| Reviewer | Separate from each ticket worker | One PR at a time | Inspect scope, genericity, safety, tests, and regression risk. No mutation unless promoted. | Findings in the issue/PR and explicit approve/block decision. |

## Write Scope

Bound spine: `docs/EPIC-RING-INTENT-AND-VOICE-MEMORY.md`
Active steward: `/root` until an explicit stewardship transfer is journaled

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers write detailed state and structured handoffs to their assigned GitHub issue.
- Each ticket worker changes only files necessary for that ticket and works on a dedicated branch/worktree.
- Explicit narrow delegation: none yet.

Read-only linked spines:

- `docs/EPIC-R-RING-SPRINT.md` — Ring catalog, skill, receipt, exact-name, and cross-unit laws.
- `docs/EPIC-P-PHYLAX-SPRINT.md` — Phylax channel ownership, media custody, sender-to-tenant routing, and typed downstream handoff.
- `docs/EPIC-Z-NIGHT-SPRINT.md` — Zenod memory ownership and receipt semantics.
- `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` — external-action approval and exactly-once receipt evidence.
- `docs/EPIC-WHATSAPP-ZENOD-STABILIZATION.md` — local parent stabilization state; currently unlanded and therefore not a worker dependency.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent spine writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Mission, scope, accepted architecture, risk policy, dependencies, epic acceptance, and rollup state |
| Linked GitHub issue | Detailed execution state and acceptance for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Exact deployed SHA plus logs | Runtime behavior that actually ran |
| Verified MCP mutation receipt | What changed, and only what changed |
| Persisted host approval record | The exact held action a later approval may authorize |
| MCP `tools/list` catalog | Which exact tools, descriptions, schemas, and annotations are callable |
| Optional peer skill | Advisory usage guidance only; never authority or proof |
| Model output | A proposed typed interpretation only; never authority, policy, or proof |
| Validation evidence | What passed or failed for an exact commit in a named surface |

## Mission

Make Ring simple and truthful for ordinary human chat, especially WhatsApp voice notes: one typed interpretation of the current turn, a small deterministic host policy, one generic MCP operation at most, and one receipt-grounded customer reply. A long voice note explicitly submitted for memory is captured once; action-like material inside it remains content until the user separately asks to act. The design must work with any connected MCP server, whether its operations are immediate, asynchronous, approval-held, read-only, or mutating, without peer- or channel-specific hacks.

## Definition Of Done

- [ ] A plain text, link, short voice, or long voice turn with an explicit outer request to save/store/remember produces exactly one authorized private-memory operation and exactly one verified receipt/link.
- [ ] A representative 20-minute transcript containing questions, tasks, draft posts, and other action-like prose is captured once; embedded actions remain inert.
- [ ] Ring uses one validated typed turn plan and deterministic policy instead of the universal positive-mutation regex as its authorization boundary.
- [ ] Private tenant-scoped non-destructive writes may execute from explicit current-turn authority; external, public, destructive, financial, ambiguous, or unknown-risk operations remain held or clarified.
- [ ] Natural-language approval resolves only to an exact persisted held action; no magic approval phrase is required and no approval can invent state.
- [ ] One logical mutation has one upstream call identity, survives async polling/resume, and ends in one terminal receipt, failure, cancellation, or honest unknown result.
- [ ] Mutation rendering is deterministic and concise; no raw tool hashes, MCP envelopes, guard diagnostics, duplicate failure blocks, placeholder URLs, or unsupported success claims reach the user.
- [ ] Phylax cannot remain HTTP-green while silently stuck in an unbounded WhatsApp connection phase; receive-path health is bounded, observable, and recoverable or terminally alerted.
- [ ] Two-tenant testing proves no crossing of transcripts, tools, keys, approvals, receipts, jobs, or history.
- [ ] One uninterrupted real browser and WhatsApp acceptance pass is evidenced at an exact deploy-candidate SHA before Jordi is asked to test.

## Non-Goals

- Replaying or repairing the historical 20-minute note.
- Adding a new agent, router, workflow engine, queue abstraction, or second interpretation loop.
- Auto-executing multiple asks extracted from a long artifact.
- Making Ring understand Zenod, Calli, tweets, WhatsApp, or any named peer/channel through hard-coded branches.
- Replacing peer-owned internal reasoning, storage, idempotency, or canonical receipt contracts.
- Weakening exact-tool discovery, tenant isolation, SSRF protections, approval persistence, receipt provenance, or fail-closed behavior.
- Redesigning Phylax transcription providers or the tenant settings UI.
- Production deployment, public posting, real financial mutation, QR/session reset, or destructive action without the Human Gate.
- Elaborate synthetic product logic created only to make tests pass.

## Current State

Phase: planning review
Last verified: 2026-07-29 15:20 CEST
Integration target: main
Fresh base commit: `9e64f392e1329e3651374511b7351925dec5f4e0`
Next action: review and land planning PR [#989](https://github.com/zenod-ai/zenod/pull/989), transfer stewardship to the launched epic worker, then dispatch Wave 1 from a fresh `origin/main`.
Blockers: no planning blocker; implementation agents are intentionally not launched in this turn.

The current production failure is cross-layer but has two distinct causes:

1. Phylax previously stopped receiving while HTTP health stayed green because a connection lifecycle phase could wait without a deadline. Restart restored transport but did not fix the lifecycle contract.
2. After transcription succeeded, Ring's model selected the correct generic memory mutation, but a separate regex guard re-read the entire transcript. A question inside the transcript made the turn appear read-oriented, while the explicit outer phrase did not match the guard's narrow positive grammar. Ring blocked the correct operation and the reply gate duplicated raw internal diagnostics.

The provider/model is not the root of the Ring failure. A configured OpenRouter model transcribed the recent 20:13 note in about 21 seconds. The failure after that point was Ring interpretation/authority policy and reply rendering.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Make the accepted design executable without adding product scope. | Spine and issues landed, dependency graph clear, epic worker ready to bind. |
| Epic worker | Deliver RIV-1..RIV-7 through isolated issue/PR/review loops. | Exact candidate ready for Jordi's live test, or one named human decision required. |
| Ring worker | Implement one generic Ring contract. | Reviewed passing PR or explicit blocker with evidence. |
| Phylax worker | Make receive lifecycle bounded and observable. | Reviewed passing PR with lifecycle/fault tests. |
| Integration tester | Prove simple truthful behavior through real human interactions. | Acceptance package for exact SHA or evidenced failure routed to one owner. |
| Reviewer | Prevent narrow fixes, policy regressions, duplicated architecture, and unsupported claims. | Approve/block with specific evidence and residual risk. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine, top to bottom | Accepted architecture, decisions, ownership, dependencies, and gates | Everyone |
| 2 | `docs/EPIC-R-RING-SPRINT.md` | Existing generic MCP catalog, skill, exact-name, receipt, and standing-action laws | Every Ring worker/reviewer |
| 3 | The assigned GitHub issue | Detailed single-ticket scope and acceptance | Ticket worker/reviewer |
| 4 | `packages/core/src/llm/aisdk.ts`, `packages/core/src/engine/engine.ts` | Current Ring model/tool execution loop | RIV-1, RIV-3, RIV-5 |
| 5 | `packages/core/src/taskingPolicy.ts`, `packages/core/src/approvalTokens.ts` | Current brittle language authority and exact held-action approval boundaries | RIV-2 |
| 6 | `packages/core/src/replyGate.ts` | Current receipt gate and duplicated/raw customer rendering | RIV-3, RIV-4 |
| 7 | `packages/server/src/phylaxPortedRuntime.ts` and typed inbound handoff code | Channel-to-Ring payload boundary | RIV-5 |
| 8 | `packages/server/src/whatsappGateway.ts` plus `docs/EPIC-P-PHYLAX-SPRINT.md` | Connection lifecycle, credential, and receive-path ownership | RIV-6 |
| 9 | `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` | Zero-tool lie, held-action, async receipt, and exactly-once evidence | RIV-2, RIV-3, RIV-4, RIV-7 |
| 10 | Relevant focused/full tests and the RIV-7 issue | Exact regression and human acceptance protocol | Tester |

## Architecture And Context

### Simple target flow

```text
Human message / voice note
          |
          v
Phylax: tenant resolution + media custody + STT
  deterministic custody; 1 STT inference only for audio
          |
          v
Ring: one structured intent/reasoning call
  -> validated TurnPlan (proposal, not permission)
          |
          v
Ring host policy (no LLM)
  exact current-turn authority + exact tool + risk/annotations
  -> allow | hold | clarify | deny | cancel
          |
          v
Generic MCP executor (no LLM)
  one logical call ID -> invoke once -> poll/resume if async
          |
          v
Peer implementation
  owns its internal reasoning/storage and canonical receipt
          |
          v
Ring receipt gate + renderer (no LLM)
  one verified terminal human reply
          |
          v
Phylax transport -> WhatsApp
```

### Model-call budget by layer

| Layer | Model Calls | Prompt / Input | Expected Output | Deterministic Boundary |
|---|---:|---|---|---|
| Phylax STT | 1 for audio; 0 for text | Audio bytes plus provider transcription settings | Transcript and provider metadata, or typed failure | Tenant resolution, artifact identity, timeout/cancellation, and handoff are host-owned |
| Ring intent and answer planning | 1 normal call | Current outer instruction, one typed payload/artifact reference, conversation context, exact discovered MCP schemas/annotations, response schema | Strict `TurnPlan`: outer intent, exact authority span, exact requested tool/operation, payload reference, embedded inert candidates, ambiguity | JSON/schema validation, exact-name binding, and policy are host-owned |
| Ring authority/risk | 0 | Validated `TurnPlan`, tool annotations, trust/risk, tenant/turn identity, held-action records | `allow`, `hold`, `clarify`, `deny`, or `cancel` with reason code | Entirely deterministic |
| Ring MCP execution/polling | 0 | Allowed exact operation and canonical logical-call key | Terminal verified receipt/failure/cancelled/unknown | Entirely deterministic and exactly-once |
| Current Zenod peer internals | Currently 2 logical calls for classifier + composer; generic peers may use any implementation | Exact memory payload and peer-owned context | Canonical memory commit receipt/link or typed failure | Peer-owned; not part of Ring authorization |
| Ring mutation rendering | 0 | Policy outcome plus matching terminal receipt state | One bounded customer reply | Entirely deterministic |

Therefore the expected current Zenod path is four model inferences for audio-to-memory (STT + one Ring call + two Zenod-owned calls) and three for text-to-memory. Ring itself spends exactly one LLM call on a normal mutation turn and zero after tool execution. A generic peer may internally use zero, one, or more calls; Ring must not depend on that number.

### Example at each layer

Human outer instruction:

> Save this entire voice note to my memory. It contains ideas and questions; do not execute them.

The transcript may contain:

> What is the launch date? Send a tweet tomorrow. Add a task for Sam.

Phylax typed handoff concept:

```json
{
  "kind": "voice_transcript",
  "providerMessageId": "wa-msg-…",
  "artifactRef": "artifact://…",
  "transcriptRef": "transcript://…",
  "outerInstruction": "Save this entire voice note to my memory. It contains ideas and questions; do not execute them."
}
```

Ring `TurnPlan` concept:

```json
{
  "outerIntent": "mutate",
  "authorityQuote": "Save this entire voice note to my memory",
  "operation": {
    "toolId": "exact-discovered-tool-id",
    "capability": "private_non_destructive_write",
    "payloadRef": "transcript://…"
  },
  "embeddedCandidates": [
    {"text": "Send a tweet tomorrow", "active": false},
    {"text": "Add a task for Sam", "active": false}
  ],
  "needsClarification": false
}
```

Deterministic policy result:

```json
{
  "decision": "allow",
  "reason": "explicit_current_turn_authority_for_private_non_destructive_write"
}
```

Generic terminal receipt concept:

```json
{
  "status": "succeeded",
  "logicalCallId": "tenant:conversation:provider-message:tool:payload",
  "operation": "private_non_destructive_write",
  "safeUrl": "https://peer.example/returned-by-peer"
}
```

Deterministic customer reply:

> Saved the full voice note to memory: https://peer.example/returned-by-peer
> I did not execute the ideas inside it. If you want, ask me to extract actions in a separate pass.

If there is no matching terminal receipt, that success reply is impossible. The renderer must instead say held, failed, cancelled, needs clarification, or could not be verified.

### Ownership boundaries

- Phylax owns WhatsApp/Telegram transport, sender-to-tenant routing, media custody, transcription settings, progress/cancellation, and delivery.
- Ring owns exact MCP discovery, one typed interpretation, deterministic authority/risk policy, logical-call dedupe, polling/resume, and truthful presentation.
- Connected peers own their tool schemas, internal implementation, idempotency contract, and canonical receipt.
- Zenod owns memory composition and commit; it is the first acceptance peer, not a Ring special case.
- The user owns current-turn intent and explicit approval of held high-risk actions.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-29 | Alter the mutation guard as proposed | The universal positive-language regex is a brittle second intent parser and blocked the correct tool after the model had already selected it. | Jordi approval in the planning conversation; [#982](https://github.com/zenod-ai/zenod/issues/982), [#985](https://github.com/zenod-ai/zenod/issues/985) |
| 2026-07-29 | One typed Ring intent/reasoning call | One schema-validated plan keeps interpretation inspectable and avoids multiple disagreeing language classifiers. | [#982](https://github.com/zenod-ai/zenod/issues/982) |
| 2026-07-29 | Typed model output is not authority | The host must still bind exact current-turn text, exact tool identity, risk, tenant, and held state deterministically. | Ring seam laws; [#985](https://github.com/zenod-ai/zenod/issues/985) |
| 2026-07-29 | Risk-tier policy replaces universal phrase matching | Private non-destructive writes and external/destructive actions have different consequences; one regex cannot safely govern both. | [#985](https://github.com/zenod-ai/zenod/issues/985) |
| 2026-07-29 | Natural-language approval, exact typed authorization | Humans should not need a magic regex phrase, but approval must resolve to one exact persisted held action. | Existing standing-action law; [#985](https://github.com/zenod-ai/zenod/issues/985) |
| 2026-07-29 | Capture-first long artifacts | A long note is one artifact. Explicit outer capture stores it; embedded action-like prose remains inert until a later request. | Jordi-approved proposal; [#986](https://github.com/zenod-ai/zenod/issues/986) |
| 2026-07-29 | No post-tool LLM for mutations | Mutation truth comes from the verified receipt. A model cannot strengthen, invent, or prettify the outcome. | Zero-tool fabricated publication incident; [#983](https://github.com/zenod-ai/zenod/issues/983), [#984](https://github.com/zenod-ai/zenod/issues/984) |
| 2026-07-29 | Preserve exact catalog/skill/receipt separation | Catalog defines callable shape, skill advises, receipt proves. The new plan cannot merge these authorities. | `docs/EPIC-R-RING-SPRINT.md` |
| 2026-07-29 | Transport liveness is separate from HTTP health | A web server can be healthy while a WhatsApp socket is stalled. Both states must be visible and bounded. | Live restart diagnosis; [#987](https://github.com/zenod-ai/zenod/issues/987) |
| 2026-07-29 | The existing reconnect draft is blocked | Independent review found unbounded/orphan paths, credential flush risk, retry storms, timer races, and missing lifecycle tests. | [#987](https://github.com/zenod-ai/zenod/issues/987) |
| 2026-07-29 | No historical replay as a substitute for repair | Acceptance is a fresh normal user message working correctly end to end. | Jordi explicit direction |
| 2026-07-29 | Direct human testing is the release proof | Synthetic tests support contracts, but the milestone is a clean browser/WhatsApp journey at an exact SHA. | [#988](https://github.com/zenod-ai/zenod/issues/988) |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#982](https://github.com/zenod-ai/zenod/issues/982) | Ring ticket worker | unassigned / RIV-1 | Compile each Ring turn into one typed intent plan | ready | - | reserved `codex/riv-1-typed-turn-plan` | `9e64f392e1329e3651374511b7351925dec5f4e0` | Strict generic `TurnPlan`; one Ring reasoning call; invalid plans fail closed | Issue created; prior regex failure RCA captured here | 2026-07-29 15:00 CEST | Bind worker after spine lands; record fresh base before worktree creation |
| [#985](https://github.com/zenod-ai/zenod/issues/985) | Ring ticket worker | unassigned / RIV-2 | Replace regex mutation authority with deterministic risk policy | ready | #982 | reserved `codex/riv-2-risk-policy` | integrated RIV-1 SHA | Low-risk explicit writes allowed; high/unknown risk held; natural approval binds exact held action | Issue created; #965 proves prior grammar patch was insufficient | 2026-07-29 15:00 CEST | Dispatch only after RIV-1 contract is reviewed |
| [#984](https://github.com/zenod-ai/zenod/issues/984) | Ring ticket worker | unassigned / RIV-3 | Make generic MCP mutations exactly-once through terminal receipts | ready | #982, #985 | reserved `codex/riv-3-terminal-receipts` | integrated RIV-1/RIV-2 SHA | One logical call, one upstream invocation, one terminal verified result | Issue created; existing Ring/Calli dedupe laws referenced | 2026-07-29 15:00 CEST | Dispatch after RIV-2 integration |
| [#983](https://github.com/zenod-ai/zenod/issues/983) | Ring ticket worker | unassigned / RIV-4 | Render one clean deterministic reply for Ring mutations | ready | #982; coordinate with #984 | reserved `codex/riv-4-clean-replies` | integrated RIV-1 SHA | One concise customer reply; no raw/duplicate diagnostics or invented links | Issue created; live duplicate guard output reproduced | 2026-07-29 15:00 CEST | Dispatch after RIV-1 types stabilize; rebase-free integrate after review |
| [#986](https://github.com/zenod-ai/zenod/issues/986) | Ring ticket worker | unassigned / RIV-5 | Apply capture-first semantics to long voice and artifact turns | ready | #982, #985 | reserved `codex/riv-5-capture-first` | integrated RIV-1/RIV-2 SHA | Explicit outer capture produces one store; embedded actions inert; transcript referenced once | Issue created; 20-minute failure shape captured | 2026-07-29 15:00 CEST | Dispatch after RIV-2 integration |
| [#987](https://github.com/zenod-ai/zenod/issues/987) | Phylax ticket worker | unassigned / RIV-6 | Bound reconnects and expose real receive-path health | ready | - | reserved `codex/riv-6-phylax-liveness` | `9e64f392e1329e3651374511b7351925dec5f4e0` | Bounded lifecycle, no orphan/storm/race, durable creds, truthful liveness | Review-blocked draft findings recorded in issue | 2026-07-29 15:00 CEST | Bind independent Phylax worker in Wave 1; do not merge draft as-is |
| [#988](https://github.com/zenod-ai/zenod/issues/988) | Integration tester | unassigned / RIV-7 | Prove voice-to-memory through real human chat journeys | ready | #982-#987 | reserved `codex/riv-7-live-acceptance` | exact integrated deploy candidate | One uninterrupted web/WhatsApp pass, screenshots/logs, two-tenant isolation | Issue created with nine human journeys | 2026-07-29 15:00 CEST | Start only after reviewed implementation is integrated and deploy gate is approved |

## Branch And Integration

- Default integration branch: `main`.
- Planning branch: `codex/ring-intent-voice-spine`, created in `/Users/jordi/Documents/GitHub/zenod-ring-intent-voice-spine` from exact `origin/main` SHA `9e64f392e1329e3651374511b7351925dec5f4e0`; draft PR [#989](https://github.com/zenod-ai/zenod/pull/989).
- The shared checkout is not an implementation surface. Do not checkout branches there, discard its edits, or mix its untracked evidence into ticket commits.
- Worker isolation: one ticket worker per dedicated `codex/*` branch and separate worktree.
- Every worker fetches fresh `origin/main`, records the exact base in its issue, then creates the worktree. Later waves base on the latest reviewed integrated SHA recorded by the steward.
- Wave 1: RIV-1 [#982](https://github.com/zenod-ai/zenod/issues/982) in parallel with RIV-6 [#987](https://github.com/zenod-ai/zenod/issues/987).
- Wave 2: after RIV-1 review/integration, RIV-2 [#985](https://github.com/zenod-ai/zenod/issues/985) in parallel with RIV-4 [#983](https://github.com/zenod-ai/zenod/issues/983).
- Wave 3: after RIV-2 review/integration, RIV-3 [#984](https://github.com/zenod-ai/zenod/issues/984) in parallel with RIV-5 [#986](https://github.com/zenod-ai/zenod/issues/986).
- Wave 4: reconcile all reviewed changes, run focused/full regression, then RIV-7 [#988](https://github.com/zenod-ai/zenod/issues/988).
- Review gate: issue acceptance implemented, PR open, focused tests and relevant full suites passing, separate reviewer explicitly approves genericity and safety.
- Testing gate: exact integrated commit available in a named non-production or approved production surface; acceptance validation in progress.
- Done gate: all journeys pass, evidence linked, residual risk recorded, candidate SHA reconciled, Jordi invited with one exact next prompt.
- Integration rule: merge small reviewed work in dependency order. Do not stack all tickets into one hidden branch or carry the review-blocked reconnect draft forward by default.
- Any discovery that changes the accepted number of Ring calls, risk tiers, capture-first semantics, or ownership boundary returns to Jordi before implementation continues.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Architecture changes beyond this spine | Jordi | Worker proposes a second Ring LLM loop, new router/agent/workflow, different risk tiers, or proactive embedded-action execution | Explicit approval of the named change and tradeoff | Existing accepted issue work that does not depend on the change |
| Production deploy | Jordi or `/root` acting under explicit current authorization | Reviewed integrated candidate is ready | Exact candidate SHA and target service approval | Local/CI/review work |
| Public/external/financial/destructive acceptance action | Jordi | RIV-7 wants to prove an approval-required mutation | Exact held action and explicit permission to execute it; otherwise use hold-only or sandbox proof | All private/read/failure tests |
| WhatsApp QR/session reset | Jordi | RIV-6 determines credentials are terminally invalid | Approval to re-pair the named Phylax number | Code/tests and non-destructive diagnostics |
| Long real voice note | Jordi | RIV-7 reaches long-voice journey | Jordi sends or approves use of a representative note; raw content remains private | All other journeys |
| Two-tenant live isolation identities | Jordi | RIV-7 reaches isolation journey | Two approved tenant/sender identities or an approved equivalent test surface | Single-tenant journeys |
| Final user acceptance | Jordi | RIV-7 has one uninterrupted passing package | Run the supplied exact next prompt/journey | Observation and issue reconciliation |

## Recovery And Takeover

Stale assignment policy: a ticket worker posts a concise issue heartbeat at least every 30 minutes while active. At 90 minutes without a runnable handoff or explicit blocker, the epic worker reviews the branch and may reassign from the last verified commit.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| #987 draft predecessor | unbound draft in `zenod-phylax-reconnect-watchdog` | future RIV-6 worker | `9e64f392e1329e3651374511b7351925dec5f4e0` | `codex/phylax-reconnect-open-watchdog`; review-blocked and not mergeable as-is | 2026-07-29 15:00 CEST |

Takeover rules:

- Read the issue and last reviewer report before inspecting unverified commits.
- Never merge or deploy unverified work merely because tests passed locally.
- Preserve useful tests or observations only after independently validating their contract.
- Record accepted/rejected predecessor commits in the issue handoff.

## Planner Queue

- Land this planning-only spine so issue backlinks resolve for every worker.
- Transfer stewardship to the launched epic worker with exact landed SHA and next action.
- Do not mint additional implementation tickets unless a reviewed issue demonstrates a distinct owner/file boundary or Jordi changes scope.

## Worker Queue

- Wave 1 ready: #982 Ring typed plan in parallel with #987 Phylax receive-path liveness.
- Waves 2–4 remain dependency-gated.
- No agent has been launched by this planning turn.

## Tester Queue

- Build small contract fixtures during each ticket, but reserve the real cross-layer walk for #988.
- Test human interactions directly through Ring web chat and WhatsApp.
- Ask Jordi for a voice note only at the Human Gate; do not ask him to click an unclicked UI step that the tester can perform.
- Evidence every claim with exact SHA, correlation ID, tool-call count, receipt, final reply, and screenshot.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-29 | Planning base | `9e64f392e1329e3651374511b7351925dec5f4e0` | local isolated worktree | `git fetch origin main && git rev-parse origin/main` | pass | Exact base recorded before branch/worktree creation |
| 2026-07-29 | Existing issue overlap audit | n/a | GitHub `zenod-ai/zenod` | Search mutation, voice-note, reconnect, prior #965/#972 and related issues | pass | New tickets are scoped follow-ups; earlier grammar/timeout fixes are not misrepresented as absent |
| 2026-07-29 | GitHub ticket creation | n/a | GitHub | Connected app attempted first; 403; authenticated `gh issue create` fallback | pass | [#982](https://github.com/zenod-ai/zenod/issues/982), [#983](https://github.com/zenod-ai/zenod/issues/983), [#984](https://github.com/zenod-ai/zenod/issues/984), [#985](https://github.com/zenod-ai/zenod/issues/985), [#986](https://github.com/zenod-ai/zenod/issues/986), [#987](https://github.com/zenod-ai/zenod/issues/987), [#988](https://github.com/zenod-ai/zenod/issues/988) |
| 2026-07-29 | Spine structure | `cb7b966b1092f566c4af62f25ec4260d5075ec49` | local isolated worktree | `python3 skills/epic-spine/scripts/validate_spine.py docs/EPIC-RING-INTENT-AND-VOICE-MEMORY.md --strict` plus `git diff --check` | pass | Draft PR [#989](https://github.com/zenod-ai/zenod/pull/989) |
| pending | RIV-7 clean journey | exact candidate SHA | Ring web chat + WhatsApp + connected MCPs | Nine journeys in #988 | pending | Screenshot/log test package |

## Handoff Journal

### 2026-07-29 - Planner - Root cause and accepted repair shape captured

Context: A real long WhatsApp voice note exposed two separate failures. Phylax could lose receive-path liveness while HTTP stayed green. After transport and STT recovered, Ring's model chose the correct connected memory mutation, but a second regex-based language guard contradicted that interpretation and blocked it. The reply gate then exposed duplicated internal failure diagnostics. Jordi approved replacing the mutation guard with one typed plan plus deterministic risk policy and approved capture-first semantics for long notes.

Next: create a self-contained child spine and runnable GitHub tickets without implementing or deploying.

Risks: converting model output directly into authority would replace one unsafe shortcut with another; weakening receipt gates would re-open fabricated success; mixing transport and Ring logic would violate unit ownership.

Assignment identity: `/root` planner.

Branch / latest commit: `codex/ring-intent-voice-spine` at base `9e64f392e1329e3651374511b7351925dec5f4e0`.

Last verified: 2026-07-29 15:00 CEST.

Links: `docs/EPIC-R-RING-SPRINT.md`, issues #982-#988.

### 2026-07-29 - Planner - Seven-ticket dependency graph created

Context: The GitHub connector could read but returned 403 for issue creation, so the repository's authenticated GitHub CLI created the same seven tickets. Existing open/closed issues were searched first. #965 and #972 are treated as prior partial fixes and evidence; the new tickets address the broader typed-policy and lifecycle contracts rather than duplicating their narrow acceptance.

Next: review and land draft PR #989, then wait for Jordi to launch the epic worker and Wave 1 agents.

Risks: issue numbers are not sequential by dependency because parallel creation returned #983-#986 in completion order; the ledger and titles are authoritative.

Assignment identity: `/root` planner.

Branch / latest commit: `codex/ring-intent-voice-spine` / `cb7b966b1092f566c4af62f25ec4260d5075ec49`.

Last verified: 2026-07-29 15:00 CEST.

Links: [#982](https://github.com/zenod-ai/zenod/issues/982), [#985](https://github.com/zenod-ai/zenod/issues/985), [#984](https://github.com/zenod-ai/zenod/issues/984), [#983](https://github.com/zenod-ai/zenod/issues/983), [#986](https://github.com/zenod-ai/zenod/issues/986), [#987](https://github.com/zenod-ai/zenod/issues/987), [#988](https://github.com/zenod-ai/zenod/issues/988), draft PR [#989](https://github.com/zenod-ai/zenod/pull/989).

## Open Questions

- No implementation-blocking product question remains. Owner: Jordi only if a worker proposes scope outside the accepted decisions. Needed by: before that change.
- Which exact non-public approval-held mutation should RIV-7 exercise? Owner: Jordi. Needed by: RIV-7; a hold-only or sandbox fixture is the default if no live action is approved.
- Which two tenant/sender identities may be used for final live isolation? Owner: Jordi. Needed by: RIV-7 only.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-29 | `docs/EPIC-R-RING-SPRINT.md` | Add a child-spine pointer and record that typed current-turn intent replaces regex language authorization while receipt/standing-action laws remain unchanged | This spine; #982-#986 | Ring spine steward | proposed |
| 2026-07-29 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Add #987 receive-path liveness follow-up and distinguish HTTP/process health from channel receive health | #987 and live restart RCA | Phylax spine steward | proposed |
| 2026-07-29 | `docs/EPIC-WHATSAPP-ZENOD-STABILIZATION.md` | Roll up this child spine as the accepted durable repair and replace stale operational status after integration/testing | This spine; #988 | Parent stabilization steward | proposed |

## Appendix

### Prior related issues

- [#965](https://github.com/zenod-ai/zenod/issues/965) added a broader natural mutation grammar but remained a phrase matcher and did not survive the long-transcript case.
- [#972](https://github.com/zenod-ai/zenod/issues/972) addressed a fixed long-transcription deadline but not provider configuration drift, channel receive liveness, or Ring policy after STT.
- [#967](https://github.com/zenod-ai/zenod/issues/967) established clean generic mutation receipt rendering; #983 is a regression/follow-up for duplicated raw policy failures.
- [#935](https://github.com/zenod-ai/zenod/issues/935) established logical-call dedupe; #984 extends the contract through async terminal receipt/resume.
- [#925](https://github.com/zenod-ai/zenod/issues/925) and [#926](https://github.com/zenod-ai/zenod/issues/926) establish exact held-action approval and atomic publication behavior.
- [#390](https://github.com/zenod-ai/zenod/issues/390) and its long-voice subissues are older digest/action-decomposition work. This epic intentionally chooses capture-first and does not reactivate proactive multi-action execution.

### Source proposal

The approved layer-by-layer proposal was drafted locally at:

`docs/evidence/whatsapp-zenod-stabilization-2026-07-29/ring-phylax-voice-memory-root-cause-and-fix-proposal.html`

This spine is self-contained and authoritative even while that evidence artifact remains outside the planning branch.
