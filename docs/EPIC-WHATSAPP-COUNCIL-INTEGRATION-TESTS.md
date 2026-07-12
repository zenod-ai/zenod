# EPIC: WhatsApp → Phylax → Ring → Council integration tests

Status: ready for owner dispatch; browser acceptance remains blocked by unavailable signed-in Chrome control
Created: 2026-07-12
Updated: 2026-07-12
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md`
GitHub issues: draft rows below; not yet minted
Integration branch: `main`
Active spine steward: `/root`
Steward since: 2026-07-12 20:24 CEST
Last reconciled commit: `9ba7663`
Planner: `/root`
Worker: Ring, Phylax, Zenod, and Calli owner agents
Tester: `/root` through the real `web.whatsapp.com` customer surface

## Role Bindings

| Identity | Assignment Identity | Bound Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner / tester | `/root` | Whole batch | Reconcile live evidence, run WhatsApp journeys, steward this spine; no inferred passes. | Test package with prompts, receipts, screenshots, and issue disposition. |
| Epic worker | `ring-agent` | W-R1..W-R4 | Own the Ring lane, mint lane issues, dispatch isolated ticket workers, integrate reviewed fixes; do not change shared acceptance. | Issue/PR links, focused tests, exact live Ring SHA, WhatsApp reprove request. |
| Epic worker | `phylax-agent` | W-P1..W-P5 | Own the Phylax lane, mint lane issues, dispatch isolated ticket workers, integrate reviewed fixes; do not change Ring behavior. | Issue/PR links, focused tests, exact live Phylax SHA, WhatsApp reprove request. |
| Epic worker | `zenod-agent` | W-Z1 | Own the portable Zenod receipt contract; no Ring-specific response formatting. | Issue/PR, schema tests, store/poll receipt with canonical link. |
| Epic worker | `calli-agent` | W-C1..W-C2 | Own Calli's mutation-safety boundary; no Ring routing shortcuts or unapproved public mutations. | Issue/PR links, concurrency tests, held→approve→replay evidence. |

## Write Scope

Bound spine: this document. Active steward: `/root`.

- `/root` reconciles this spine.
- Owner agents write implementation detail to their GitHub issues, not here. They may propose a ledger/handoff update to `/root`, but only `/root` edits shared mission, acceptance, current state, decisions, or rollup.
- `docs/EPIC-P-PHYLAX-SPRINT.md`, `docs/EPIC-R-RING-SPRINT.md`, `docs/EPIC-Z-NIGHT-SPRINT.md`, and `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` are read-only context.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This spine | Test intent, cross-unit acceptance, issue ownership, rollup |
| Phylax WhatsApp SQLite audit | Provider inbound/outbound IDs, processing and delivery state |
| Ring `messages` / `chat_test_runs` | Exact prompt received, tool events, final reply, correlation |
| Zenod receipt + GitHub URL | Whether memory was stored/read and where |
| Calli receipt/ledger + canonical X readback | Whether a post was held, published once, or replayed |
| Real WhatsApp Web journey | Customer-visible acceptance |

## Mission

Prove four ordinary WhatsApp journeys end-to-end through Phylax and Ring: create a memory with a clickable receipt, publish an exact X post through a natural approval flow with a canonical permalink, retrieve a grounded past memory with a clickable source, and handle a voice note according to its transcript. Every success claim must be backed by the owning unit's receipt; transport success alone is not product success.

## Definition Of Done

- [ ] WJ-1..WJ-4 each pass once, uninterrupted, from the real signed-in WhatsApp Web surface.
- [ ] Every inbound provider message ID joins to one Phylax route, one Ring correlation, the owning-unit evidence, and one outbound provider ID/status.
- [ ] No raw MCP dump, duplicate reply, silent interruption, invented success, or missing clickable receipt appears.
- [ ] Exact tested Ring/Phylax/Zenod/Calli SHAs and screenshots are recorded.

## Non-Goals

- Product-specific shortcuts in Ring.
- Treating direct MCP calls or database inspection as substitutes for WhatsApp acceptance.
- Deleting or retrying public X posts without explicit authority.
- Solving Telegram inside this WhatsApp batch; competing Telegram pollers remain a separate Phylax issue.

## Current State

Phase: ready for four owner-agent dispatches
Last verified: 2026-07-12 20:24 CEST
Integration target: `main`
Fresh base commit: `9ba7663` (owners still fetch and record fresh `origin/main` at dispatch)
Next action: Jordi dispatches Ring, Phylax, Zenod, and Calli owner agents with the binding packets below; `/root` restores WhatsApp browser access in parallel for the final journey.
Blockers: No implementation blocker. Browser acceptance is blocked because Chrome extension control is unavailable and the in-app browser cannot satisfy WhatsApp persistent storage. Live durable traces already prove the implementation issues below.

## Bootstrap Map

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine | Test batch, issue ownership, current evidence | Always |
| 2 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Phylax journey and live deployment authority | Phylax / tester |
| 3 | `docs/EPIC-R-RING-SPRINT.md` | Ring routing, wallet, receipt laws | Ring / tester |
| 4 | `docs/EPIC-Z-NIGHT-SPRINT.md` | Zenod memory contract | Zenod |
| 5 | `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` | Calli approval and receipt evidence | Calli / Ring |

## Test Batch

Run sequentially in one verified WhatsApp conversation. Record provider message ID, Phylax timestamps/state, Ring correlation/tool events/reply, owning-unit receipt, outbound provider ID/status, and screenshot for every case.

| ID | Exact human journey | Pass condition | Current evidence |
|---|---|---|---|
| WJ-1 | `Remember this exact new memory: WhatsApp acceptance batch — cobalt fern.` | Ring routes once to Zenod; terminal reply contains a clickable evidence or GitHub commit/page URL; link opens the new memory; no raw dump. | PARTIAL analogue: “wind is vibe” stored successfully at commit `d37522c…`, but WhatsApp reply exposed only SHA + evidence ref, no clickable link. |
| WJ-2 | `Send a tweet with exactly this text: Hey still testing` → if held, reply naturally `Yes, publish exactly: Hey still testing` → replay approval once. | First turn is held/unpublished; exact confirmation publishes once; reply has canonical numeric X permalink; `getPostsById` matches exact text; replay returns existing receipt or nothing pending without a second post. | BLOCKED for WhatsApp. Equivalent Ring web flow passed on `2ea4dce`; cross-channel standing state remains unproved. |
| WJ-3 | `Tell me about one memory from last week and include one clickable source link.` | Zenod performs grounded search/synthesis; Ring returns one concise memory plus at least one clickable source URL; no unrelated catalog or raw MCP dump. | PARTIAL: correct memory and source URLs returned by Zenod, but Ring showed only backticked paths at top and buried URLs in a large raw dump. |
| WJ-4 | Record: `Please reply exactly: strawberry banana.` | Phylax stores transcript/provenance/artifact and forwards once; Ring replies exactly `strawberry banana`; total time and every correlation are visible; restart cannot leave it silent. | FAIL analogue: latest voice reached Ring with correct transcript/artifact, but Ring invoked catalog inspection twice and returned a catalog dump. Another PTT was left `interrupted` with no outbound row. |

### Regression additions discovered from recent real messages

| ID | Journey | Pass condition | Current evidence |
|---|---|---|---|
| WJ-5 | Send a captioned screenshot, then an uncaptioned screenshot. | Both create immutable artifact refs forwarded to Ring/Zenod; bytes are fetchable; response is grounded in the image. | FAIL: captioned image reached Ring as text only; uncaptioned image failed in Phylax with `text or media is required`. |
| WJ-6 | `Can you say hi to Zenod?` | One coherent delegation result or one concise refusal; never duplicate identical blocks/tool calls. | FAIL: Ring rendered the same blocked mutation result twice. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W-R1 | Ticket worker | Ring agent | Restrict catalog routing to explicit catalog/tool questions | draft | - | - | `c5768d3` | Voice command answers content; memory intent reaches Zenod; neither invokes catalog inspection. | `test_8158…` called catalog inspector twice for `say strawberry banana`; long memory-intent voice notes got catalogs. | 2026-07-12 20:24 CEST | Add host intent guard + regressions. |
| W-R2 | Ticket worker | Ring agent | Render concise clickable memory receipts and read citations | draft | W-Z1 helpful | - | `c5768d3` | Preserve canonical store/read URLs; suppress successful raw dumps. | `wind is vibe` dropped URL; retrieval buried GitHub links. | 2026-07-12 20:24 CEST | Fix generic structured result/receipt renderer. |
| W-R3 | Ticket worker | Ring agent | Enforce one logical peer call and one rendered outcome | draft | - | - | `c5768d3` | One resolved tool per operation unless explicit retry; one rendered result. | `say hi to Zenod` duplicated block; voice turn inspected catalog twice. | 2026-07-12 20:24 CEST | Add per-turn call/result dedupe. |
| W-R4 | Tester / ticket worker | Ring agent | Prove standing approval across WhatsApp turns | testing gap | W-C1 | - | `c5768d3` | Held draft survives channel round trip; exact approval and replay are safe. | Ring web passed; WhatsApp path unrun. | 2026-07-12 20:24 CEST | Run WJ-2 after browser access. |
| W-P1 | Ticket worker | Phylax agent | Forward captioned and uncaptioned images as artifacts | draft | - | - | `c5768d3` | Both image forms get fetchable artifact refs and reach Ring once. | `3B517…` lost media; `3BE76…` failed before Ring. | 2026-07-12 20:24 CEST | Extend media archive/handoff beyond audio. |
| W-P2 | Ticket worker | Phylax agent | Recover or fail loudly after interrupted media | draft | - | - | `c5768d3` | Restart yields resumed/replied or explicit notified failure, never silent interrupted. | PTT `3BBE…` interrupted with no outbound row. | 2026-07-12 20:24 CEST | Add durable recovery + restart test. |
| W-P3 | Ticket worker | Phylax agent | Persist transcript, artifact, forwarding, and correlation | draft | - | - | `c5768d3` | Provider-ID query returns transcript, artifact, Ring correlation, receipt, outbound status. | Voice rows empty/metadata-only; correlation is reply prose. | 2026-07-12 20:24 CEST | Add typed audit fields/writeback. |
| W-P4 | Ticket worker | Phylax agent | Coalesce identical media resends while retaining audit | draft | W-P3 | - | `c5768d3` | Same payload hash in bounded window processes once and reuses outcome. | Distinct IDs carried identical audio and produced two artifacts/replies. | 2026-07-12 20:24 CEST | Add payload linkage/idempotency window. |
| W-P5 | Tester | Phylax agent | Reprove serialized Telegram poller after merged fix | code merged; live unverified | - | `#923` / `9ba7663` | `9ba7663` | One poller per bot/tenant; no recurring 409 after deploy. | Prior live logs repeated `getUpdates 409 Conflict`; `9ba7663` now serializes gateway startup with regression coverage. | 2026-07-12 20:35 CEST | Verify exact deployed SHA and absence of 409 loop; do not reimplement unless it fails. |
| W-Z1 | Ticket worker | Zenod agent | Make terminal memory receipts linkable and schema-valid | draft | - | - | `c5768d3` | Strict result includes typed evidence ref and deep-linked canonical URL(s). | Runtime has URLs; v4 terminal schema omits them. | 2026-07-12 20:24 CEST | Update schema/runtime/tests generically. |
| W-C1 | Ticket worker | Calli agent | Enforce exact held draft inside `approve_send` | draft | - | - | `c5768d3` | Missing/altered standing action fails; exact pending action succeeds once. | Ring supplies safety; Calli accepts any nonempty approved text. | 2026-07-12 20:24 CEST | Add tenant-scoped standing action. |
| W-C2 | Ticket worker | Calli agent | Make publication exactly-once under concurrency/unknowns | draft | W-C1 | - | `c5768d3` | 20 approvals create one post; unknown outcome reconciles; action ID scopes same-text drafts. | Race-prone ledger; forever text dedupe; unknown retry gap. | 2026-07-12 20:24 CEST | Add action ID + atomic ledger/unknown state. |

## Owner Commentary

### Ring owner — routing and truth, not transport

Phylax demonstrably delivered the recent text and voice turns into the Ring conversation. Zenod demonstrably stored and retrieved memory. The Ring failures begin after handoff: it mistakes ordinary phrases such as “able to hear me” and memory-intent voice notes for MCP catalog questions; selects the same logical tool more than once; duplicates one blocked result; and discards or buries URLs that connected peers already returned. Fix these as generic host boundaries. Do not special-case WhatsApp, Phylax, Zenod, Calli, `strawberry banana`, or any hashed tool name. Catalog inspection must be authorized by explicit catalog/tool intent, not generic words such as “able” or “capabilities” appearing in another task. Successful generic reads and mutations must render concise structured evidence without leaking a raw MCP transcript.

### Phylax owner — transport works, media custody does not

The authoritative live ingress is the Swarm service mounted on `phylax-data`; do not diagnose from the unrelated standalone `zenod-phylax` container. Text and the latest voice transcript reached Ring, so do not rewrite routing intelligence into Phylax. Own the channel custody seam: image bytes are never archived/forwarded, image-only messages are rejected, an interrupted media turn can disappear silently, successful voice transcripts remain absent from the local audit, identical payloads under different provider IDs are processed twice, and correlation exists only as prose. Preserve zero intelligence: receive, transcribe/archive, route once, deliver once, and make the full chain queryable.

### Zenod owner — portable evidence contract, not Ring UX

Zenod's backend succeeded for both observed memory journeys. `store_memory` produced a real commit/evidence reference and the retrieval path produced correct `sources[{path, githubUrl}]`. The portable terminal schema is nevertheless incomplete: it omits typed canonical evidence URL fields that a generic MCP host can render without parsing prose. Add schema-valid `evidenceRef` plus canonical/deep-linked `url` or `githubUrls`, preserving meaning-page URLs separately. Do not implement WhatsApp formatting or Ring-specific response text in Zenod; Ring owns presentation after the portable contract is complete.

### Calli owner — defend mutation safety even without Ring

The prior Ring web flow proved the expected UX: held draft, exact natural approval, one canonical permalink, safe replay, and independent readback. Calli must still make that contract safe for any generic MCP client. `approve_send` should not accept arbitrary nonempty approved text without a matching tenant-scoped held action. Receipt check plus dispatch must be atomic, identical concurrent approvals must collapse to one upstream mutation, unknown outcomes must be reconciled before retry, and a later explicitly new same-text draft must not be confused with a retry forever. Do not post or delete anything while implementing; the only public WhatsApp acceptance text already authorized is `Hey still testing` during the later tester-run journey.

## Dispatch Packets

Copy one packet into each owner-agent task. The owner must bind before inspecting or editing code.

### Ring agent packet

```text
Use $epic-spine.
Identity: epic worker
Bound spine: docs/EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md
Bound scope: W-R1, W-R2, W-R3, W-R4 only
Spine steward: /root
Assignment identity: ring-agent
Goal: deliver the Ring-owned routing, structured-result rendering, logical-call dedupe, and WhatsApp standing-approval scope until ready for live re-test.
Authority: create/update GitHub issues for W-R1..W-R4, dispatch ticket workers on dedicated codex/* branches and separate worktrees, integrate reviewed passing fixes. Do not change shared acceptance, Phylax transport, Zenod/Calli contracts, or referenced spines.
Write scope: detailed work goes to lane GitHub issues. Do not edit shared mission/current state/decisions/rollup; send a structured handoff to /root.
Base: fetch fresh origin/main after this spine lands; record the exact SHA before creating worktrees. Integration target: main.
Required reads: this spine; docs/EPIC-R-RING-SPRINT.md; docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md; packages/server/src/runtime.ts; packages/core/src/taskingPolicy.ts and replyGate.ts.
Acceptance: the W-R rows plus WJ-2/WJ-3/WJ-4/WJ-6. All behavior must remain generic across MCP peers and channels.
Human gates: no production deploy or public post. Ask /root for the live re-test after reviewed code lands.
Handoff: issue/PR links, branches/bases/latest commits, focused and regression tests, residual risks, exact deploy candidate SHA, and next live prompt.
```

### Phylax agent packet

```text
Use $epic-spine.
Identity: epic worker
Bound spine: docs/EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md
Bound scope: W-P1, W-P2, W-P3, W-P4, W-P5 only
Spine steward: /root
Assignment identity: phylax-agent
Goal: deliver reliable channel media custody, restart recovery, typed correlation/audit, payload coalescing, and singleton Telegram polling without adding routing intelligence.
Authority: create/update lane GitHub issues, dispatch ticket workers on dedicated codex/* branches and separate worktrees, integrate reviewed passing fixes. Do not change Ring routing or unit semantics.
Write scope: detailed work goes to lane GitHub issues. Do not edit shared mission/current state/decisions/rollup; send a structured handoff to /root.
Base: fetch fresh origin/main after this spine lands; record the exact SHA before creating worktrees. Integration target: main.
Required reads: this spine; docs/EPIC-P-PHYLAX-SPRINT.md; packages/server/src/phylaxPortedRuntime.ts, phylaxChannels.ts, whatsappGateway.ts, whatsappStore.ts.
Operational authority: the live Swarm service using volume phylax-data is authoritative; the standalone zenod-phylax container is not the current ingress.
Acceptance: W-P rows plus WJ-4/WJ-5, including forced-restart evidence and a deterministic provider-ID trace.
Human gates: no pairing reset, provider-session deletion, production deploy, or message send without /root/Jordi authorization.
Handoff: issue/PR links, branches/bases/latest commits, migration/recovery safety, focused tests, exact deploy candidate SHA, and smallest WhatsApp re-test.
```

### Zenod agent packet

```text
Use $epic-spine.
Identity: epic worker
Bound spine: docs/EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md
Bound scope: W-Z1 only
Spine steward: /root
Assignment identity: zenod-agent
Goal: make the terminal memory-store evidence contract schema-valid, portable, and canonically linkable for any MCP consumer.
Authority: create/update the W-Z1 GitHub issue and one dedicated codex/* branch/worktree; integrate only after schema/runtime/focused tests pass. Do not change Ring/WhatsApp formatting.
Write scope: detailed work goes to W-Z1; do not edit shared mission/current state/decisions/rollup; send a structured handoff to /root.
Base: fetch fresh origin/main after this spine lands; record the exact SHA. Integration target: main.
Required reads: this spine; docs/EPIC-Z-NIGHT-SPRINT.md; docs/tool-output-schemas.v4.json; Zenod store/poll result formatting in packages/core and packages/server.
Acceptance: strict schema accepts typed evidenceRef and canonical/deep-linked URL(s); async store→poll exposes them without prose parsing; existing consumers remain compatible.
Human gates: no live memory write or Zenod deploy; /root owns final WhatsApp WJ-1 re-test.
Handoff: issue/PR, branch/base/latest commit, schema compatibility note, focused tests, example structured terminal result, residual risks.
```

### Calli agent packet

```text
Use $epic-spine.
Identity: epic worker
Bound spine: docs/EPIC-WHATSAPP-COUNCIL-INTEGRATION-TESTS.md
Bound scope: W-C1, W-C2 only
Spine steward: /root
Assignment identity: calli-agent
Goal: make Calli independently enforce exact held-action approval and atomic exactly-once publication for generic MCP clients.
Authority: create/update W-C1/W-C2 GitHub issues, dispatch isolated ticket workers if useful, and integrate reviewed passing fixes. Do not add Ring-specific routes or perform live mutations.
Write scope: detailed work goes to lane issues. Do not edit shared mission/current state/decisions/rollup; send a structured handoff to /root.
Base: fetch fresh origin/main after this spine lands; record the exact SHA before creating worktrees. Integration target: main.
Required reads: this spine; docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md; Callisthenes unit, observation ledger, skill workflow, and receipt tests.
Acceptance: approval without exact held action fails; altered text fails; exact pending action succeeds once; 20 concurrent identical approvals produce one upstream post and one canonical permalink; unknown outcome cannot auto-retry; later explicit same-text action is distinguishable from retry.
Sequencing law (spine Decisions): your work PRECEDES EPIC-CF — the CF controller will PORT from your result; do not read CF as scope. Herald's frozen SHIP candidate publishes via the current draft→approve_send flow: keep that flow back-compatible, or hold production deploy until /root confirms Jordi's Herald walk is complete.
Human gates: no public post/delete and no production deploy. /root owns the authorized WhatsApp WJ-2 test using exact text Hey still testing.
Handoff: issue/PR links, branches/bases/latest commits, concurrency/restart tests, migration/idempotency semantics, deploy candidate SHA, residual risks.
```

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-12 | Ownership follows the failed seam, not the observed surface. | Phylax owns transport/artifacts; Ring owns routing/state/rendering; Zenod/Calli own portable evidence and mutation safety. | Recent provider, Ring, and unit traces. |
| 2026-07-12 | Do not infer WhatsApp tweet acceptance from Ring web success. | Cross-channel standing-action persistence is part of the product contract. | WJ-2. |
| 2026-07-12 | Existing recent messages count as acceptance evidence where prompts match. | They are real user journeys with provider IDs and durable correlations. | WJ-1, WJ-3, WJ-4, WJ-5, WJ-6. |
| 2026-07-12 | W-C1/W-C2 land BEFORE EPIC-CF; the CF controller (CF-S2) then PORTs from their result. | Two tracks converging on Calli's approval seam must not rebuild the same organ in parallel; safety fix first, façade wraps it. | Planner ruling (Jordi + Epic 3.0 planner); `docs/EPIC-CF-CALLISTHENES-HYBRID-FACADE.md`. |
| 2026-07-12 | W-C1 keeps back-compat with the existing draft→`approve_send` flow, OR its production deploy waits until Jordi's Herald SHIP walk completes. | Herald's frozen SHIP candidate (`7cf13ae`) publishes via the current `approve_send` contract; a pinned proof in flight quiesces provider-surface changes (dialect law 7). | `docs/EPIC-5-HERALD-SPRINT.md` step 9. |

## Branch And Integration

- Default target: `main`.
- Each owner issue uses a dedicated `codex/` branch and separate worktree.
- Sequence W-Z1 before final W-R2 reprove; W-C1 before W-C2; W-P3 before W-P4.
- W-R1, W-R3, W-P1, W-P2, W-Z1, and W-C1 can be implemented in parallel when minted.
- Deploy only the owning unit for its fix, record exact SHA, then rerun the smallest affected WhatsApp journey.

## Human Gates

| Gate | Owner | Trigger | Exact input | What May Continue |
|---|---|---|---|---|
| Signed-in WhatsApp Web control | Jordi / Codex browser connection | Execute WJ-1..WJ-4 from the browser | Restore/enable the Chrome browser extension session with the signed-in `web.whatsapp.com` tab. | Read-only diagnosis, issue drafting, local tests. |
| Public X mutation | Jordi | WJ-2 approval turn | Already authorized exact text: `Hey still testing`; no other public text or delete is authorized. | Held-draft and read-only checks. |

## Recovery And Takeover

Stale assignment policy: reassign after 30 minutes without a progress/evidence handoff; preserve issue/branch history.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | `9ba7663` | none | 2026-07-12 20:35 CEST |

## Validation Evidence

| Date | Scope | Commit | Surface | Result | Evidence |
|---|---|---|---|---|---|
| 2026-07-12 | Recent real WhatsApp traces | Ring `2ea4dce`; Phylax live service | Phylax SQLite + Ring tenant SQLite | WJ-1 partial; WJ-3 partial; WJ-4 fail; WJ-5 fail; WJ-6 fail | Provider IDs, Ring correlations, receipts summarized above. |
| 2026-07-12 | Browser availability | n/a | `web.whatsapp.com` | BLOCKED: Chrome extension unavailable; in-app browser persistent storage denied. | Browser session diagnostics. |

## Handoff Journal

### 2026-07-12 - planner/tester - batch prepared from live evidence

Context: Text transport is healthy. Zenod stored `wind is vibe`; memory retrieval was grounded; the latest voice transcript reached Ring. Failures are link rendering, catalog misrouting, image artifact loss, silent interruption, and missing typed correlation. Ring web already proved Calli's normal held→approve→receipt→replay flow, but WhatsApp remains unproved.
Next: restore signed-in WhatsApp Web control and execute WJ-1..WJ-4 sequentially; mint owner tickets from the issue ledger with the observed failures attached.
Risks: `Hey still testing` may already exist because Calli idempotency is tenant+text; that ambiguity is W-C2, not permission to change the requested text.
Assignment identity: `/root`
Branch / latest commit: `main` / `9ba7663`
Last verified: 2026-07-12 20:35 CEST
Links: `docs/EPIC-P-PHYLAX-SPRINT.md`, `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md`

## Open Questions

- None for dispatch. Each owner should mint the issue rows in its bound scope immediately; final acceptance remains `/root`'s real WhatsApp journey after integration.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-12 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Add image artifact, interrupted-media recovery, and typed correlation gaps. | W-P1..W-P4 | Phylax steward | proposed |
| 2026-07-12 | `docs/EPIC-R-RING-SPRINT.md` | Add catalog over-routing, clickable evidence, and logical-call dedupe gaps. | W-R1..W-R4 | Ring steward | proposed |
| 2026-07-12 | `docs/EPIC-Z-NIGHT-SPRINT.md` | Add portable canonical memory receipt schema gap. | W-Z1 | Zenod steward | proposed |
| 2026-07-12 | `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` | Add Calli server-side standing state and atomic idempotency gaps. | W-C1..W-C2 | Calli/Ring integration steward | proposed |
