# EPIC CF: Callisthenes Hybrid Agentic Façade

Status: draft — recommended architecture ready for planner approval
Created: 2026-07-12
Updated: 2026-07-12
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-CF-CALLISTHENES-HYBRID-FACADE.md`
GitHub issues: same repository; draft ledger only, no tickets minted
Integration branch: `main`
Active spine steward: Callisthenes hybrid-façade planner
Steward since: 2026-07-12 22:08 CEST
Last reconciled commit: `e5599b3c8e9ce0dcb8201711e9f6fe49cedfe921`
Planner: Callisthenes hybrid-façade planner
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic Zero steward | Project rollup only | Read this spine; record cross-epic health in Epic Zero. | Rollup and dependency state. |
| Planner | Callisthenes hybrid-façade planner | This document and draft ledger | Refine accepted intent, mint issues, and dispatch; do not implement by default. | Executable backlog or one named decision. |
| Epic worker | unassigned | Whole epic after planner approval | Deliver accepted scope, steward this spine, dispatch isolated ticket workers. | Live test package or precise blocker. |
| Ticket worker | unassigned | One future CF issue | Implement only the assigned issue in a dedicated worktree. | PR, tests, evidence, blocker, next action in issue. |
| Tester | unassigned | CF-S6 integration milestone | Validate exact deployed commit; do not silently fix production code. | Pass/fail evidence and follow-up issues. |
| Reviewer | unassigned | Architecture or PR review | Read and report; no mutation unless promoted. | Findings and recommended next action. |

## Write Scope

Bound spine: `docs/EPIC-CF-CALLISTHENES-HYBRID-FACADE.md`
Active steward: Callisthenes hybrid-façade planner

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers write detailed execution state to their future GitHub issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-C-CALLISTHENES-SPRINT.md` — shipped Calli product and live evidence.
- `docs/EPIC-R-RING-SPRINT.md` — shipped Ring discovery, skills, and receipt boundaries.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — original outbound-broker product intent.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — suite laws D12, D14, D16–D18.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless the target steward explicitly grants write authority.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Hybrid-façade intent, scope, decisions, acceptance, dependencies, rollup state |
| GitHub issue | Detailed execution state for one CF ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Calli/Ring parent spines | Existing shipped behavior and cross-unit ownership |

## Mission

Evolve Callisthenes from a mostly low-level MCP proxy into a hybrid domain agent: a small, truthful, channel-independent public façade for ordinary agents; a larger private connector toolbox; optional Calli-owned language intelligence for drafting, revision, clarification, and internal tool selection; and deterministic authority for tenancy, approval, exact content, throttling, exactly-once effects, deletion, and provider-derived receipts. Ring remains a generic conversational host and MCP client. It learns Calli through standard discovery and Calli's skill, but it does not need X/Reddit endpoint knowledge and can never establish that a send occurred through prose.

## Definition Of Done

SHIP:

- [ ] A normal Ring-scoped Calli credential lists only the seven domain façade tools defined in CF-D2; raw X/Reddit and connection-administration tools are absent from that catalog.
- [ ] `prepare_message` accepts a natural-language brief and returns either one structured held draft or one bounded clarification; it can never publish.
- [ ] `respond_to_draft` understands natural-language approve/revise/cancel/unclear responses, including short affirmatives and ordinary typos, while negation, edits, ambiguity, expired state, or multiple candidates fail closed without publication.
- [ ] A valid approval publishes the exact server-stored draft once and returns a provider-derived canonical permalink; replay returns the stored receipt without a second post.
- [ ] Calli's intelligence cannot mint approval, bypass throttle/custody, call raw mutators directly outside the controller, or create success receipts. Every state transition and receipt is structurally evidenced.
- [ ] Existing self-host/advanced clients retain an explicit scoped path to the raw connector catalog; the default Ring integration is migrated without a Calli-specific Ring profile.
- [ ] One exact live build passes: Ring natural-language draft → Calli held draft → natural-language revision → approval → canonical X permalink → approved deletion, plus zero-tool/fabricated-receipt negative tests and two-tenant isolation.

HARDEN:

- [ ] Add Reddit to the same façade state machine after X passes; email/Instagram remain separate future channel adapters.
- [ ] Add MCP `notifications/tools/list_changed` and progressive authorization challenges when tenant connection or scopes change.
- [ ] Evaluate MCP Tasks for long-running channel operations and client sampling fallbacks after the synchronous X journey is stable.

## Non-Goals

- Rewriting the working Python `xmcp` engine or changing provider connector behavior.
- Giving Ring a Calli-specific profile, hard-coded tool names, X endpoint logic, or authority over Calli's state machine.
- Moving Phylax channel transport, pairing, or transcription into Calli or Ring.
- Letting any LLM decide receipt truth, generate a permalink, bypass a confirmation, or retry an uncertain mutation.
- Publishing the entire upstream `xmcp` catalog to every client.
- Replacing explicit MCP tools with one opaque `ask_calli` tool.
- Shipping new channels before the X façade is live-proven.

## Current State

Phase: planning
Last verified: 2026-07-12 22:08 CEST
Integration target: `main`
Fresh base commit: `e5599b3c8e9ce0dcb8201711e9f6fe49cedfe921`
Next action: Jordi approves, amends, or rejects the recommended CF-D1–CF-D9 decisions; planner then mints CF-S1..CF-S6 and dispatches the first independent wave.
Blockers: product architecture approval only; no implementation blocker investigated yet.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep this child epic visible without absorbing its implementation detail. | Project rollup and dependency state current. |
| Planner | Turn the approved façade and trust boundaries into executable issues. | CF-S1..CF-S6 minted and dependencies explicit. |
| Epic worker | Deliver the façade without regressing shipped Calli or Ring. | Exact live journey ready for Jordi. |
| Ticket worker | Complete one bounded CF issue. | Reviewed PR ready for integration or precise blocker. |
| Tester | Prove language behavior, state safety, receipts, and isolation on one build. | Pass/fail with exact environment and evidence. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine | Accepted target, trust boundaries, façade, backlog, gates | Always |
| 2 | `docs/EPIC-C-CALLISTHENES-SPRINT.md` | Current deployed Calli shape and behavior freeze | Always |
| 3 | `docs/EPIC-R-RING-SPRINT.md` | Generic discovery, skill, catalog, receipt, and stream authority | Always |
| 4 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Original broker intent: custody + evidence; smart layer optional | Planner and architecture workers |
| 5 | `packages/server/src/callisthenesUnit.ts` | Current public front, `approve_send`, proxy and receipt reducer | CF-S1/CF-S2/CF-S4 |
| 6 | `packages/server/src/peerClient.ts`, `packages/server/src/runtime.ts` | Current Ring discovery and argument passthrough | CF-S5 |
| 7 | `units/callisthenes/` | Private engine, auth, throttle, draft guard, connectors | CF-S2/CF-S4 |
| 8 | MCP tools, sampling, and security specifications linked below | Protocol constraints and supported agentic-server patterns | Planner/reviewer |

## Architecture And Context

### Current deployed shape

Calli's live authenticated `tools/list` exposes 18 tools:

- Connection/admin: `connect`, `complete_connect`, `connections`, `revoke`, `usage`.
- Reddit: `post_reddit`.
- Raw X/media: `mediaUpload`, `getPostsByIds`, `createPosts`, `searchPostsRecent`, `getPostsById`, `deletePosts`, `getUsersByUsername`, `getUsersMe`, `getUsersById`, `getUsersMentions`, `getUsersPosts`.
- Front façade: `approve_send`.

Ring copies this public catalog, collision-safe namespaces every tool, gives its schemas/descriptions/annotations to the Council model, applies generic intent/mutation/receipt controls, then forwards the chosen tool and arguments over MCP. Calli has no deployed LLM. The Node front authenticates and tenant-binds; it special-cases `approve_send` and otherwise proxies to the Python engine. The engine applies deterministic tenant context, draft guard, throttle, custody, and connector execution.

Numerically, `n < m` already exists: upstream `xmcp` contains roughly 140 operations, while `X_API_TOOL_ALLOWLIST` admits eleven X/media operations. The defect is architectural rather than numerical: the default public `n` remains a low-level API selection instead of a product/domain façade, and several listed tools lack complete descriptions, schemas, or safety annotations.

### Target hybrid shape

```text
Ring / Claude / Codex
  -> scoped public Calli façade (n=7 for calli:operate)
      -> deterministic Calli action controller
          -> optional domain interpreter (draft/revise/classify/clarify only)
          -> private connector adapters and raw tools (m > n)
              -> X / Reddit / future channels
```

The domain interpreter may propose content, select private read operations, or classify a natural-language response. It cannot execute an outward mutation. The deterministic controller owns draft IDs, tenant binding, exact content hashes, target account/channel, expiration, confirmation state, idempotency ledger, throttle, connector invocation, and receipt reduction.

### Recommended public catalogs

Default Ring scope `calli:operate` — seven tools:

| Tool | Purpose | Mutation rule |
|---|---|---|
| `prepare_message` | Convert a natural-language brief into one held draft or clarification. | State-only; never publishes. |
| `respond_to_draft` | Interpret natural-language approve/revise/cancel/unclear for a named draft. | Only controller may transition an unambiguous approval to publish. |
| `get_draft` | Read exact draft, target, state, expiry, and receipt if present. | Read-only. |
| `search_publications` | Search/read the tenant's connected account through private adapters. | Read-only. |
| `prepare_deletion` | Resolve a publication and hold an exact deletion proposal. | State-only; never deletes. |
| `respond_to_deletion` | Interpret approve/cancel/unclear for a named deletion proposal. | Destructive transition only through controller. |
| `outbound_status` | Report connected identities, channel availability, throttle, usage, and façade version. | Read-only. |

Administration scope `calli:admin` may additionally list `start_connection`, `complete_connection`, and `revoke_connection`. The dashboard uses the same controller APIs but does not need to inject them into Ring's model context.

Advanced scope `calli:raw` may list the existing connector operations for self-hosted power users and compatibility. Raw scope is explicit, separately consented, auditable, and never granted to Ring by default.

### Natural-language response contract

`respond_to_draft` receives `{draft_id, message}`. The interpreter returns a constrained proposal:

```json
{
  "intent": "approve | revise | cancel | unclear",
  "replacement_text": "present only for revise",
  "clarification": "present only for unclear"
}
```

The controller then independently validates tenant, one live draft, exact server-stored text, target, expiry, negation/ambiguity flags, and prior receipt. `revise` creates a new version and invalidates prior approval. `unclear` changes nothing. `approve` may publish only the stored version named by `draft_id`. The raw user utterance and interpreter proposal are audit evidence, not a receipt.

### Intelligence runtime

Calli owns the domain prompt, tool selection rules, constrained output schemas, and evaluation suite. Preferred first implementation is MCP client sampling when the connected client declares support, because the client retains model/provider/key control while Calli retains domain behavior. A provider adapter may be added for standalone clients that lack sampling. No intelligence path is required for exact-text drafting or deterministic state reads; lack of an interpreter must degrade to clarification, never to guessed approval.

Protocol basis:

- MCP tools are the server's public model-controlled capabilities; the protocol does not require internal functions to be published: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP supports agentic servers requesting model work through client-controlled sampling and tool use: https://modelcontextprotocol.io/specification/2025-11-25/client/sampling
- MCP security guidance recommends progressive least privilege rather than omnibus scopes: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- Large MCP catalogs benefit from progressive disclosure or tool search rather than injecting every definition: https://www.anthropic.com/engineering/code-execution-with-mcp

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-12 | CF-D1: Hybrid, not raw-only and not one opaque agent tool. | Preserve typed composability and auditability while moving domain judgment out of Ring. | Current live 18-tool audit; original 2.4 broker intent. |
| 2026-07-12 | CF-D2: Default Ring catalog is the seven-tool `calli:operate` façade above. | Ring should know outbound intentions, not provider endpoint mechanics. | MCP `tools/list` is a public contract, not reflection. |
| 2026-07-12 | CF-D3: Admin and raw catalogs require distinct scopes. | Least privilege, smaller model context, compatibility for power users. | MCP security guidance; existing auth/tool allowlist. |
| 2026-07-12 | CF-D4: Calli owns domain intelligence; Ring remains a generic host. | Skills and discovery teach routing, but Calli should interpret outbound-domain language. | D16 self-description; observed Ring/Calli approval failure. |
| 2026-07-12 | CF-D5: Intelligence is advisory to a deterministic action controller. | An LLM may misunderstand language but must never create authority or evidence. | D12 conduct kit; Calli receipt profile. |
| 2026-07-12 | CF-D6: Draft/action IDs are opaque, tenant-bound, versioned, expiring, and one-time. | Natural language can select intent while exact state remains structurally bound. | Existing exactly-once ledger and tenant isolation. |
| 2026-07-12 | CF-D7: Provider-derived receipts are the only success authority. | Prevent model-authored placeholders or prose from becoming outcome claims. | `outboundReceipt.ts`; live fabricated `{POST_ID}` incident. |
| 2026-07-12 | CF-D8: Sampling-first intelligence with fail-closed fallback. | Keeps model choice/key with the client while making domain behavior Calli-owned. | MCP 2025-11-25 sampling specification. |
| 2026-07-12 | CF-D9: X proves the architecture before Reddit/email expansion. | One real channel and one real journey are stronger than a broad untested façade. | Epic C SHIP discipline. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft CF-S1 | Ticket worker | unassigned | Scoped public catalog and capability firewall | draft | approval | - | `e5599b3` | `calli:operate`, `calli:admin`, `calli:raw`; complete schemas/annotations; tenant-aware list | current catalog audit | 2026-07-12 22:08 CEST | mint after approval |
| draft CF-S2 | Ticket worker | unassigned | Durable draft/deletion action controller | draft | approval | - | `e5599b3` | opaque IDs, versions, expiry, tenant binding, exactly-once, receipts | existing ledger/guard code | 2026-07-12 22:08 CEST | mint after approval |
| draft CF-S3 | Ticket worker | unassigned | Calli domain interpreter and constrained evaluations | draft | CF-S2 | - | `e5599b3` | prepare/revise/classify/clarify; sampling adapter; fail-closed corpus | MCP sampling research | 2026-07-12 22:08 CEST | sequence after controller contract |
| draft CF-S4 | Ticket worker | unassigned | Façade handlers over private connector adapters | draft | CF-S1, CF-S2 | - | `e5599b3` | no raw default exposure; controller-only mutation; raw compatibility scope | current proxy audit | 2026-07-12 22:08 CEST | sequence after contracts |
| draft CF-S5 | Ticket worker | unassigned | Ring migration and canonical Calli skill update | draft | CF-S3, CF-S4 | - | `e5599b3` | generic refresh; no profile; new façade/skill; same-turn receipt authority | Ring HARDEN evidence | 2026-07-12 22:08 CEST | cross-spine handoff before dispatch |
| draft CF-S6 | Epic worker / tester | unassigned | Live hybrid journey, adversarial approval, and isolation | draft | CF-S5 | - | `e5599b3` | full SHIP journey plus false-positive and receipt-negative matrix | none | 2026-07-12 22:08 CEST | final milestone |

## Branch And Integration

- Default integration branch: `main`.
- CF-S1 and CF-S2 may run in parallel after shared types/file ownership is partitioned explicitly.
- CF-S3 follows the CF-S2 state contract; CF-S4 follows CF-S1+CF-S2; CF-S5 follows CF-S3+CF-S4; CF-S6 is last.
- One ticket worker per dedicated branch; concurrent workers use separate worktrees.
- Dispatch records branch, worktree, base, integration target, owner, expected validation, and verified time.
- Review gate: implementation complete, PR open, relevant focused/full suites and CI passing.
- Testing gate: exact commit available on named live Calli and Ring surfaces.
- Done gate: SHIP passes on one deployed build, evidence linked, residual risk recorded, and this spine reconciled.
- No engine behavior change may hide inside a catalog/intelligence PR; connector and controller changes remain reviewable separately.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Architecture approval | Jordi | Before issues or implementation | Approve/amend/reject CF-D1–CF-D9, especially the seven-tool façade and sampling-first intelligence. | Read-only refinement only. |
| Production posting | Jordi | CF-S6 live send/delete journey | Approve test text/account under existing Calli test-post-and-delete rule. | All non-mutating tests. |
| Raw-scope compatibility change | Jordi | If an existing client cannot migrate without default raw tools | Choose temporary compatibility window or explicit client migration. | Façade work not touching that client. |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

## Recovery And Takeover

Stale assignment policy: 90 minutes without issue heartbeat; epic worker records the stale state and redispatches from the last verified commit.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-12 22:08 CEST |

## Planner Queue

- Obtain architecture approval for CF-D1–CF-D9.
- After approval, mint CF-S1..CF-S6 using the issue template and reconcile exact file ownership.
- Notify the Ring steward of CF-S5 without editing the Ring spine unless granted authority.

## Worker Queue

- None dispatched while status is draft.

## Tester Queue

- Prepare adversarial utterance classes for approval, revision, cancellation, negation, ambiguity, stale IDs, cross-tenant IDs, replay, timeout, and fabricated receipt claims after CF-S2 schemas land.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-12 | Current public catalog | live Calli health SHA recorded by Epic C | `calli.zenod.dev` authenticated MCP | initialize + `tools/list`, no tool calls | 18 tools observed; mostly low-level passthrough | Planner research; no mutation |
| 2026-07-12 | Current Ring forwarding architecture | `e5599b3` | local code + shipped Ring spine | inspect discovery, runtime tool construction, peer passthrough | direct argument forwarding confirmed after generic host guards | `peerClient.ts`, `runtime.ts` |
| 2026-07-12 | Hybrid pattern research | n/a | MCP 2025-11-25 + Anthropic engineering | primary-source review | façade/subset, scopes, sampling, progressive disclosure supported | links in Architecture And Context |

## Handoff Journal

### 2026-07-12 22:08 CEST - Planner - Hybrid façade spine created

Context: Jordi asked whether downstream MCPs should publish every tool or expose a smaller intelligent surface and proposed `n` public tools over `m` internal tools. Live Calli exposes 18 tools; Ring selects and forwards them without a second LLM in Calli. The original Epic 2.4 deliberately valued a deterministic outbound broker and left intelligence optional. Current MCP supports both curated public catalogs and server-owned agentic behavior. This spine recommends a hybrid: seven operating tools, separately scoped admin/raw catalogs, Calli-owned domain interpretation, deterministic mutation authority, and provider-derived receipts.
Next: Jordi approves or amends CF-D1–CF-D9; no tickets or implementation before that gate.
Risks: nested intelligence adds latency and another failure mode; natural-language approval is probabilistic, so the controller and adversarial false-positive suite are non-negotiable.
Assignment identity: Callisthenes hybrid-façade planner.
Branch / latest commit: `main` / document commit pending.
Last verified: 2026-07-12 22:08 CEST.
Links: current Calli/Ring spines, MCP sources above.

## Open Questions

- None required to understand the recommendation. CF-D1–CF-D9 are intentionally explicit so Jordi can approve or amend them as one architecture gate.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-12 | `docs/EPIC-C-CALLISTHENES-SPRINT.md` | After approval, link this as the active façade/intelligence child epic without rewriting shipped evidence. | This spine | Calli steward | proposed |
| 2026-07-12 | `docs/EPIC-R-RING-SPRINT.md` | After CF-S4, add a migration handoff from raw Calli tools to the generic seven-tool façade; keep Ring profile-free. | CF-S5 | Ring steward | proposed |
| 2026-07-12 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` | Record the public-façade/private-toolbox pattern as a possible D16 refinement only after live proof. | CF-S6 evidence | Epic 3/Epic Zero steward | proposed |

## Appendix

The spine uses “intelligence” narrowly: language composition, classification, clarification, and private read-tool selection. It never means authority. Authority remains code and durable state.

The seven-tool façade is a recommendation, not a claim that seven is universally optimal. The stable architectural rule is that default clients see domain operations appropriate to their scope, while connector mechanics stay private or explicitly elevated.
