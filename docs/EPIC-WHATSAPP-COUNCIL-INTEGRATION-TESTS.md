# EPIC: WhatsApp → Phylax → Ring → Council integration tests

Status: ready for owner dispatch; browser acceptance remains blocked by unavailable signed-in Chrome control
Created: 2026-07-12
Updated: 2026-07-13
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
| W-P5 | Tester | Phylax agent | Reprove serialized Telegram poller after merged fix | live verified | - | `#923` / `9ba7663` | `9ba7663` | One poller per bot/tenant; no recurring 409 after deploy. | Exact live SHA `080fe729`; Telegram TLS established after restart with zero `getUpdates` 409 conflicts and zero restarts during quiet observation. | 2026-07-13 03:20 CEST | Retain regression and monitor; do not reimplement. |
| [#947](https://github.com/zenod-ai/zenod/issues/947) | Ticket worker | `wp2-transcription-sla` | W-P2 follow-up: bound and accelerate Phylax voice transcription | deployed; live voice re-test pending | W-P2/W-P3 merged | [#953](https://github.com/zenod-ai/zenod/pull/953) / `codex/w-p2-transcription-sla` | `a99db25e`; rebased onto `1974e7e` | Preserve FIFO peak 1; bound transcription; typed failure handoff; truthful progress; exactly one terminal reply. | Live `080fe729`; Swarm task healthy with `phylax-data`, preserved WhatsApp credentials, and prewarmed 465 MiB `small` model. No deploy-generated outbound. | 2026-07-13 03:20 CEST | Run one fresh real voice note and capture provider-ID SLA evidence. |
| [#948](https://github.com/zenod-ai/zenod/issues/948) | Ticket worker | `wp3-log-timing` | W-P3 follow-up: redact Baileys session logs and persist timing audit | deployed; live trace pending | W-P3 merged | [#952](https://github.com/zenod-ai/zenod/pull/952) / `codex/w-p3-log-timing` | `a99db25e` | No session secrets in logs; safe health logs remain; additive provider-ID queue/transcription/downstream/outbound timings. | Live schema contains all six timing columns; quiet restart observation found zero sensitive session dumps, Telegram conflicts, runtime errors, or restarts. | 2026-07-13 03:20 CEST | Populate and verify deterministic timings on the next real provider-ID trace. |
| W-Z1 | Ticket worker | Zenod agent | Make terminal memory receipts linkable and schema-valid | draft | - | - | `c5768d3` | Strict result includes typed evidence ref and deep-linked canonical URL(s). | Runtime has URLs; v4 terminal schema omits them. | 2026-07-12 20:24 CEST | Update schema/runtime/tests generically. |
| W-C1 | Ticket worker | Calli agent | Enforce exact held draft inside `approve_send` | integrated | - | `main` / `7f5fdb0` | `c5768d3` | Missing/altered standing action fails; exact pending action succeeds once. | Tenant-scoped opaque action IDs, exact-byte matching, expiry, and legacy fallback are merged. | 2026-07-13 02:34 CEST | Retain backward compatibility while W-C1a adds the preferred safe draft surface. |
| W-C1a | Ticket worker | Calli agent | Expose first-class safe `draft_post` held-state tool | live-verified | W-C1 | [#949](https://github.com/zenod-ai/zenod/issues/949) / [#950](https://github.com/zenod-ai/zenod/pull/950) / code `32a7d58`; live `e50effd4` | `a99db25` | Zero upstream call; typed tenant-held action; old `createPosts` flow remains compatible. | Exact live health SHA; authenticated 20-tool catalog includes `draft_post`, `approve_send`, and `reconcile_send`; both containers healthy with zero restarts/errors. | 2026-07-13 20:49 CEST | Calli lane complete; Ring owns catalog refresh/selection and `/root` owns the later public WJ-2 journey. |
| W-C2 | Ticket worker | Calli agent | Make publication exactly-once under concurrency/unknowns | integrated | W-C1 | `main` / `7f5fdb0` | `c5768d3` | 20 approvals create one post; unknown outcome reconciles; action ID scopes same-text drafts. | SQLite claim/lease/receipt state is atomic across instances; unknown cannot auto-retry; reconciliation is provider-read-only. | 2026-07-13 02:34 CEST | No Calli correctness work remains; retain regression coverage. |

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
| 2026-07-13 | W-C1a first-class held draft | `c0df55c` | local Callisthenes front + shared SQLite | PASS: `draft_post` makes no upstream call, returns typed `action_id`, isolates tenants, and feeds existing atomic approval | 16 focused Calli tests; full server 759/759; server typecheck; 4 skill contract tests. |
| 2026-07-13 | W-C1a production deployment | `09fe2c451163df28ba9c89eb9c469b5c2acf6802` | canonical Dokploy Calli compose / `calli.zenod.dev` | PASS: exact SHA healthy; `draft_post` discovered and creates held state only | `/`, `/app`, `/healthz`, MCP 401; authenticated 20-tool catalog; action `act_69a86129c6794d589f5a636e95b47040` pending with zero receipts; issue #949 production comment. |
| 2026-07-13 | Calli current-main redeploy | `e50effd4d27716b7054ad6df86bf602980ff11ff` | canonical Dokploy Calli compose / `calli.zenod.dev` | PASS: configured/live SHA exact; catalog and safety tools preserved; no mutation | `/` 200, `/app` 200, health exact SHA, MCP 401; authenticated 20-tool catalog; front/engine running with zero restarts/errors; [#949 receipt](https://github.com/zenod-ai/zenod/issues/949#issuecomment-4961447557). |
| 2026-07-13 | Phylax W-P1..W-P5 deployment | `d8c93d34e9041af13a52617da78f115179cd658d` | Authoritative Swarm service + `phylax-data` | PASS for additive custody/audit/coalescing migrations and Telegram singleton: exact health SHA, zero restart, zero Telegram 409 across multiple long polls, WhatsApp session/model preserved. | [#932 deployment evidence](https://github.com/zenod-ai/zenod/issues/932#issuecomment-4953235191) |
| 2026-07-13 | Post-deploy voice diagnosis | Phylax `d8c93d34`; Ring live service | Real WhatsApp provider IDs + Phylax/Ring SQLite | Transport/custody PASS; experience FAIL on latency: three accurate transcripts with artifacts/correlations/replies took 118s, 160s, and 179s. | Provider IDs `3B7FFB8B77C0D8A2D9E4`, `3B9B3CB95659D4E1EAC5`, `3B756E1FE8131DA72E8A`; issues #947/#948. |
| 2026-07-13 | Phylax experience evolution | `080fe729ded8c64e850ba53e756465b677d62a63` | Exact detached merged-main worktree | PASS: 85 combined local queue/Phylax/Drive/WhatsApp/Telegram tests, server typecheck, diff check, both independent reviews, and both PR CIs. | [#952](https://github.com/zenod-ai/zenod/pull/952), [#953](https://github.com/zenod-ai/zenod/pull/953); worktree `wt-phylax-evolution-final`. |
| 2026-07-13 | Phylax experience deployment | `080fe729ded8c64e850ba53e756465b677d62a63` | Authoritative Swarm service `app-index-back-end-panel-6zm3qg` + `phylax-data` | PASS: immutable digest deployed, public health exact, zero restarts, session preserved, `small` prewarmed, six timing columns present, WhatsApp/Telegram TLS established, zero 409/sensitive dumps/runtime errors, and no deploy-generated outbound. | [#947 deploy evidence](https://github.com/zenod-ai/zenod/issues/947#issuecomment-4953607488), [#948 deploy evidence](https://github.com/zenod-ai/zenod/issues/948#issuecomment-4953607572). |

## Handoff Journal

### 2026-07-12 - planner/tester - batch prepared from live evidence

Context: Text transport is healthy. Zenod stored `wind is vibe`; memory retrieval was grounded; the latest voice transcript reached Ring. Failures are link rendering, catalog misrouting, image artifact loss, silent interruption, and missing typed correlation. Ring web already proved Calli's normal held→approve→receipt→replay flow, but WhatsApp remains unproved.
Next: restore signed-in WhatsApp Web control and execute WJ-1..WJ-4 sequentially; mint owner tickets from the issue ledger with the observed failures attached.
Risks: `Hey still testing` may already exist because Calli idempotency is tenant+text; that ambiguity is W-C2, not permission to change the requested text.
Assignment identity: `/root`
Branch / latest commit: `main` / `9ba7663`
Last verified: 2026-07-12 20:35 CEST
Links: `docs/EPIC-P-PHYLAX-SPRINT.md`, `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md`

### 2026-07-13 - calli-agent - first-class safe held-draft surface ready

Context: The recent Ring conversation rendered a local hold but Calli had no held action, so the later natural approval correctly found nothing pending. Calli's exact approval boundary was healthy; the public draft surface still overloaded upstream `createPosts`.
Changes: Added `draft_post` as a simple Calli-owned MCP tool with non-destructive/idempotent annotations, typed held-action output, zero X/upstream call, tenant isolation, and exact-text reuse while active. Preserved `createPosts -> [draft_not_approved] -> approve_send` unchanged for older clients. Updated only the Callisthenes skill/workflow/examples to prefer `draft_post` when discovered and fall back otherwise.
Validation: Focused Calli suite 16/16; full server suite 759/759; server typecheck; skill contract 4/4. The 20-concurrent-approval test now begins from `draft_post` and still proves one upstream post plus one canonical receipt.
Next: Review and integrate [#949](https://github.com/zenod-ai/zenod/issues/949) from `codex/w-c1-draft-post`; production deployment and the WhatsApp/public-X walk remain `/root` human-gated work.
Risks: Ring must refresh and select the newly discovered tool; Calli does not alter Ring caching, routing, or mutation-intent policy in this lane.
Assignment identity: `calli-agent`
Branch / latest commit: `codex/w-c1-draft-post` / `c0df55c`
Base / integration target: `a99db25` / `main`
Last verified: 2026-07-13 02:34 CEST

### 2026-07-13 - calli-agent - W-C1a integrated

Outcome: [#950](https://github.com/zenod-ai/zenod/pull/950) passed repository CI and Docker build, then squash-merged to `main` as `32a7d581a4f2e9de5928d0d6c9f816ae518ce248`; [#949](https://github.com/zenod-ai/zenod/issues/949) is closed.
Scope confirmation: Only the Callisthenes public facade, its tests, its attached skill bundle, and this Calli ledger/handoff were changed. Ring behavior was not edited.
Next: `/root` may deploy the Calli service from `32a7d58` and ask Ring to refresh/discover `draft_post`; no public post is needed to prove the held step.
Assignment identity: `calli-agent`
Last verified: 2026-07-13 02:39 CEST

### 2026-07-13 - calli-agent - W-C1a deployed and held-state smoke passed

Outcome: The canonical Dokploy Compose service `callisthenes` was reconciled through the API to current `main`, then its documented generated-runtime recovery rebuilt and recreated only `calli-front`. Public health reports exact SHA `09fe2c451163df28ba9c89eb9c469b5c2acf6802`; landing/app return 200 and unauthenticated MCP returns 401. `calli-engine` retained its original start time and the tenant volume was untouched.
Evidence: Authenticated `tools/list` returns 20 tools including typed, non-destructive/idempotent `draft_post`. A production smoke created held action `act_69a86129c6794d589f5a636e95b47040`; SQLite records it as `pending` with zero receipts. No X connector mutation, post, or delete occurred. Detailed operational evidence is attached to [#949](https://github.com/zenod-ai/zenod/issues/949#issuecomment-4953624822).
Recovery note: Dokploy API deploy/redeploy returned no new deployment record after the environment pin. The first host recovery command inherited a directory-derived Compose project name and created an extra un-routed front/network; both were removed immediately before the canonical project was recreated and verified. No engine or data state changed.
Next: Calli has no remaining implementation or deployment work. Ring owns refreshing/selecting `draft_post`; `/root` owns WJ-2 and any public X approval.
Assignment identity: `calli-agent`
Live commit: `09fe2c451163df28ba9c89eb9c469b5c2acf6802`
Last verified: 2026-07-13 03:24 CEST

### 2026-07-13 - calli-agent - canonical main pin redeployed

Outcome: Jordi authorized deployment. The canonical Dokploy Compose service `callisthenes` was pinned through the API to current `origin/main` and redeployed once through the supported `compose.redeploy` endpoint. Public health and the configured environment now report exact SHA `e50effd4d27716b7054ad6df86bf602980ff11ff`; Dokploy is `done` on branch `main` with auto-deploy enabled.
Evidence: Landing and app return 200, unauthenticated MCP returns 401, and an authenticated initialize/session discovery returns 20 tools including `draft_post`, `approve_send`, and `reconcile_send`. Both Calli containers are running with restart count zero and no error lines; the only warning is Node's expected experimental SQLite warning. The engine retained its prior start time. Diff audit from the prior live SHA contains only Phylax files and this spine, so no Calli runtime semantics changed.
Safety: No draft, X post, approval, delete, receipt reconciliation, tenant mutation, or Ring/Phylax deployment was performed. The git webhook rejected both ref encodings before queueing; one documented Dokploy `compose.redeploy` call produced the successful deployment.
Next: No Calli implementation or deployment work remains. Ring owns refreshed tool selection; `/root` owns WJ-2 and any public X approval.
Assignment identity: `calli-agent`
Live commit: `e50effd4d27716b7054ad6df86bf602980ff11ff`
Last verified: 2026-07-13 20:49 CEST
Links: [#949 deployment receipt](https://github.com/zenod-ai/zenod/issues/949#issuecomment-4961447557), `https://calli.zenod.dev/api/health`

### 2026-07-13 - phylax-agent - custody shipped; experience evolution completed

Context: Phylax `d8c93d34` is live on the authoritative Swarm service with additive channel audit, restart recovery, media coalescing, image custody, and singleton Telegram polling. A real post-deploy WhatsApp walk proved three short voice notes were downloaded, transcribed accurately, stored as authenticated artifacts, forwarded once with typed Ring correlation, and replied once, but took 118s, 160s, and 179s. Live logs also exposed libsignal SessionEntry structures outside the configured silent Pino logger.

Outcome: #952 merged as `1974e7ee` and #953 merged as `080fe729`. Phylax now narrowly redacts the installed libsignal session-dump signatures while retaining unrelated and health logs; persists nullable media-download, queue-wait, transcription-runtime, downstream, outbound-send, and total-lifecycle timings; honors valid tenant local-model selection; defaults and prewarms `small`; requires tenant keys for cloud audio; keeps local FIFO peak concurrency at one; bounds transcription at a configurable 60-second default; forwards artifact plus typed timeout instead of remaining silent; and sends one owner-only non-terminal processing receipt without acknowledging coalesced duplicates.

Validation: exact merged commit `080fe729ded8c64e850ba53e756465b677d62a63` passed 85 combined tests, server typecheck, and diff check in a clean detached worktree. Both PRs passed CI and independent review. No Ring, Zenod, or Calli routing/semantics changed.

Next: production remains on Phylax `d8c93d34`. Human gate is required to deploy exact candidate `080fe729`, allow the one-time `small` model prewarm on `phylax-data`, and run one fresh real voice note. Record provider ID, progress receipt (only if processing exceeds five seconds), transcript/artifact, six timing fields, Ring correlation, one terminal outbound ID, and customer screenshot. No pairing or session reset is needed.

Assignment identity: `phylax-agent`; workers `wp2-transcription-sla`, `wp3-log-timing`; independent reviewers `wp2-review`, `wp3-review`.

Links: [#947 handoff](https://github.com/zenod-ai/zenod/issues/947#issuecomment-4953499224), [#948 handoff](https://github.com/zenod-ai/zenod/issues/948#issuecomment-4953465690), [PR #952](https://github.com/zenod-ai/zenod/pull/952), [PR #953](https://github.com/zenod-ai/zenod/pull/953).

### 2026-07-13 - phylax-agent - experience candidate deployed

Outcome: Jordi authorized deployment and the authoritative Swarm service completed its update to immutable image `ghcr.io/zenod-ai/zenod:sha-080fe72@sha256:141ed432226f385b8f54e8865a9f4ab68c1115cfad25380087c91f37bf0ebd76`. Public `/api/health` reports exact SHA `080fe729ded8c64e850ba53e756465b677d62a63`; the task remained running with restart count zero and the existing `phylax-data:/data` mount.

Recovery and safety: `/data/whatsapp/session/creds.json` and the existing session files remained in place; no QR reset or provider-session deletion occurred. The 465 MiB `ggml-small.bin` model downloaded and prewarmed while the existing large model remained untouched. WhatsApp and Telegram TLS connections re-established. Quiet observation found zero sensitive libsignal session dumps, zero Telegram polling conflicts, zero runtime errors, and zero outbound audit rows created by deployment.

Schema: the authoritative WhatsApp audit table contains `media_download_ms`, `transcription_queue_wait_ms`, `transcription_runtime_ms`, `downstream_ms`, `outbound_send_ms`, and `total_lifecycle_ms`. Existing pre-deploy rows remain nullable as designed.

Next: the smallest remaining Phylax re-test is one fresh short WhatsApp voice note. Record its provider ID, owner-only progress receipt if processing exceeds five seconds, transcript/artifact, all six timing fields, Ring correlation, exactly one terminal outbound provider ID, and customer screenshot. Do not reset pairing or change Ring routing.

Assignment identity: `phylax-agent`
Branch / deployed code: `codex/phylax-live-deploy-evidence` / `080fe729ded8c64e850ba53e756465b677d62a63`
Base / integration target: `09fe2c45` / `main`
Last verified: 2026-07-13 03:20 CEST
Links: [#947 deployment evidence](https://github.com/zenod-ai/zenod/issues/947#issuecomment-4953607488), [#948 deployment evidence](https://github.com/zenod-ai/zenod/issues/948#issuecomment-4953607572).

## Open Questions

- None for dispatch. Each owner should mint the issue rows in its bound scope immediately; final acceptance remains `/root`'s real WhatsApp journey after integration.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-12 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Add image artifact, interrupted-media recovery, and typed correlation gaps. | W-P1..W-P4 | Phylax steward | proposed |
| 2026-07-12 | `docs/EPIC-R-RING-SPRINT.md` | Add catalog over-routing, clickable evidence, and logical-call dedupe gaps. | W-R1..W-R4 | Ring steward | proposed |
| 2026-07-12 | `docs/EPIC-Z-NIGHT-SPRINT.md` | Add portable canonical memory receipt schema gap. | W-Z1 | Zenod steward | proposed |
| 2026-07-12 | `docs/EPIC-RING-CALLISTHENES-INTEGRATION-TESTS.md` | Add Calli server-side standing state and atomic idempotency gaps. | W-C1..W-C2 | Calli/Ring integration steward | proposed |
