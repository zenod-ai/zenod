# EPIC 2.5 · Repo-split risk memo + staged plan + per-unit build-independence audit

Owner: **W-F** (EPIC 2.5 Iteration 0). Parent: [EPIC-2.5-ATOMIC-UNITS.md](EPIC-2.5-ATOMIC-UNITS.md)
(RD-4 DECIDED — staged split) · Wire contract: [SEAM-SPEC.md](SEAM-SPEC.md) · Target layout:
[../units/README.md](../units/README.md). Date: 2026-07-05.

This memo is grounded in the real tree at commit `a422559` (HEAD). Every blocker is named as
`file:symbol`. No hand-waving.

---

## 0 · TL;DR (the one-paragraph verdict)

The suite is today **one image, one server package, one Runtime class** switched at boot by the
`AGENT` env var (`packages/server/src/main.ts:23 resolveAgent(process.env.AGENT)`). No unit has its
own Dockerfile or image — every `docker-compose.<unit>.yml` builds the **same root `Dockerfile`**
with `AGENT=<name>`. So **zero catalog units are independently-buildable TODAY** in the RD-4 sense
(own image from own folder alone). The **good news**, and why RD-4's staged bet is sound: (1)
inter-unit calls are **already pure MCP over HTTP** (`peerClient.ts` uses
`StreamableHTTPClientTransport`) — the seam is real, not aspirational; (2) each unit's **tool-builder
module is nearly self-contained** (outbound=1 sibling import, notifier=0, execution=0–3, backlog=0);
the coupling is one-directional — the shared **shell** (`runtime.ts` + `app.ts` + `mcp.ts` +
`settings.ts`) drags in every unit, not units dragging in each other. The carve is therefore a
**shell-decomposition job, not a spaghetti-untangle**. `services/x-mcp` and `services/reddit-mcp`
already prove the atomic pattern (own Dockerfile, own image, seam-only). The single hardest carve is
the **Ring channel gateways** (whatsapp=9, telegram=8 sibling imports) — exactly the component RD-1
isolated for being the flakiest.

---

## 1 · Grounding — what "a unit's image" is today

| Fact | Evidence (file:symbol) |
|---|---|
| One image runs as any unit | `packages/server/src/main.ts:23` `const agent = resolveAgent(process.env.AGENT)` → `agent.ts:166 resolveAgent` → `AGENTS` map (`agent.ts:156`) |
| Every unit compose = same root Dockerfile | `docker-compose.archus.yml` / `.epaminon.yml` / `.outbound.yml` / `.phylax.yml` all `build: { dockerfile: Dockerfile }`, differ only by `environment.AGENT` |
| Tool sets gated at RUNTIME, not build | `runtime.ts:323–380` — `vaultless`/`backlog`/`executor`/`outbound`/`notifier` booleans gate `buildOutboundTools`/`buildNotifierTools`/`buildExecutionQueue`; **imports are unconditional** (`runtime.ts:38,40,41`) so all unit code is compiled into every image |
| Inter-unit calls already over the seam | `peerClient.ts:2` `import { StreamableHTTPClientTransport }`; `peerClient.ts:68` opens transport to `peer.url` (e.g. `http://zenod-epaminon:8080/mcp`) — this is real MCP over HTTP, in-network |
| The mesh publishes tree edges | `meshGateway.ts` `chat_with_archus` / `chat_with_outbound` peerTools; called via `runtime.ts:474 callPeerTool(epaminon,"execution_status",…)`, `runtime.ts:504 callPeerTool(zenod,"store_memory",…)` |
| Atomic pattern already exists (reference) | `services/x-mcp/Dockerfile`, `services/reddit-mcp/Dockerfile` — own Dockerfile, own image, own compose, reached seam-only via `OUTBOUND_X_MCP_URL` |
| `packages/core` (`zenod`) does NOT import server | leak-scan clean: no `packages/core/src/**` imports `@zenod/server` — layering is one-way (server → core), so core is the natural shared-lib seed |

---

## 2 · Per-unit build-independence audit

**Rating = "can this unit's image build from its own folder + the published shared lib ALONE,
today?"** Answer is **NO for every catalog unit** (all share one Dockerfile/one server package), so
the useful column is *what specifically blocks it* — the named cross-imports whose removal makes the
carve a `git filter-repo`. "Sibling imports" = count of `./`-relative imports the unit's primary
module pulls from `packages/server/src` (the drag surface).

| Unit | Independently-buildable TODAY | Own Dockerfile? | Own image? | Primary files | Drag (sibling imports) | Carve difficulty |
|---|---|---|---|---|---|---|
| **Ring / Phylax-gateway** | **NO** | No (root Dockerfile) | No (`AGENT`-switched) | `whatsappGateway.ts`, `telegramGateway.ts`, `channelAudio.ts`, `transcribe.ts`, `voiceArchive.ts`, `conversationTranscript.ts`, `whatsappStore.ts` | **9 (whatsapp) / 8 (telegram)** | **HARD** |
| **Council guy (Mentor)** | **NO** | No | No | `runtime.ts:684–815 buildConsoleJourneyTools`, `runtime.ts:603–682 buildPeerTools`, `meshGateway.ts`, `peerClient.ts` | IS the shell (n/a) | HARD (it's the fused core) |
| **Zenod** | **NO** | No | No | `driveTools.ts`, `ingestQueue.ts`, `ingestStore.ts`, `transcribe.ts`; MCP tools `mcp.ts:608–712` | ~2 | MEDIUM |
| **Archus** | **NO** | No | No | `backlogRouter.ts` (0 sibling), `runtime.ts:922–1348 buildBacklogIssueReader`; MCP `mcp.ts:506–604` | 0 (router) | MEDIUM |
| **Epaminon** | **NO** | No | No | `executionQueue.ts` (0), `executionStore.ts` (1), `executionLane.ts` (3); MCP `mcp.ts:398–503` | 0–3 | MEDIUM |
| **Callisthenes (outbound)** | **NO** | No | No | `outboundTools.ts` (1 sibling → `outboundReceipt.ts`); connectors `services/x-mcp`, `services/reddit-mcp` **already atomic** | 1 | **EASY** |

### Named blocking cross-imports, per unit (file:symbol → what to remove/cut)

**Ring / Phylax-gateway — HARDEST.**
- `whatsappGateway.ts:15 import {Settings} from "./settings.js"` — shared config store (universal).
- `whatsappGateway.ts:16 import {transcribeChannelAudio} from "./channelAudio.js"` → `channelAudio.ts:1 import {Settings}` → `transcribe.ts` (STT). Media pipeline is a legit ring-owned subtree; carve it whole.
- `whatsappGateway.ts:17 import {extractJobId,pollPeerJob} from "./pollPeerJob.js"` — mesh-poll of a peer's async job; today an in-package import, must become a **seam call** to the routed guy.
- `whatsappGateway.ts:19 import {formatStorageReceipt} from "./storageReceipt.js"` and `:41 linkifyGithubRefs from "./githubLinks.js"` — presentation helpers; either duplicate into the ring or move to the shared lib.
- `telegramGateway.ts:3 import type {BrainEngine} from "zenod"` — **type-only from the shared lib (fine).** The gateway must NOT hold a `BrainEngine`; per RD-1 it holds no intelligence and calls ring-core over the seam. **Removal ticket: replace the in-process `engine.chat()` path with a `message_received` MCP call into ring-core.**

**Council guy (Mentor) — it IS the shell.**
- `runtime.ts:32–77` — the whole god-import block (`buildDriveTools`, `buildOutboundTools`, `buildNotifierTools`, `buildExecutionQueue`, `callPeer*`, all the stores). The council guy is what's left of `runtime.ts` after every other unit's tool-builder is extracted. **Removal ticket: extract each unit's builder to its own `units/<unit>/` module so `runtime.ts` shrinks to: engine + peerTools (seam) + journeys.**
- `app.ts:35 import {buildMeshGatewayServer} from "./meshGateway.js"` — the single HTTP+MCP shell that serves every agent; must become the council-guy's own server, peers reached seam-only.

**Zenod.**
- `runtime.ts:39 import {buildDriveTools} from "./driveTools.js"` — Zenod-owned; moves WITH Zenod.
- `runtime.ts:364 this.buildPeerTools()` (always called) — wires `ask_<peer>` delegation to Archus etc. For a standalone Zenod, peer wiring must be gated to zero peers (memory unit is a leaf). **Removal ticket: make `buildPeerTools` return `{}` when the unit has no configured peers, not assume the Console's peer set.**
- Shared: `driveTools.ts:1 import {Settings} from "./settings.js"` — the universal `settings.ts` coupling (see §3).

**Archus.**
- `backlogRouter.ts` — **0 sibling imports; cleanest unit.** `LIFE_BACKLOG_REPO` hard-codes `AlfaBlok/obsidian-brain` (`backlogRouter.ts`) — must become config, not a constant, before it's a generic product.
- `runtime.ts:30 import {…mintExecutionIssue,setExecutionState} from "zenod"` — GitHub write primitives from the shared lib (fine, they're generic).
- `runtime.ts:922–1348 buildBacklogIssueReader` — lives in `runtime.ts`; **removal ticket: extract to `units/archus/backlogReader.ts`.**

**Epaminon.**
- `runtime.ts:38 import {buildExecutionQueue,mergedGithubPullEvidence} from "./executionLane.js"` → `executionLane.ts:1–3` imports `./executionQueue.js`, `./executionStore.js`, `./settings.js` — a **tight, self-contained 3-file subtree**; carve whole.
- `runtime.ts:474 callPeerTool(epaminon,"execution_status",…)` — the Console reads Epaminon over the **seam already**; this edge is conformant and needs no change.

**Callisthenes (outbound) — EASIEST.**
- `outboundTools.ts:5 import {VERSION} from "zenod"` + `:6 import type {PeerTools} from "zenod"` — **shared-lib only (fine).**
- `outboundTools.ts:13 import … from "./outboundReceipt.js"` — its ONE sibling; moves with it.
- Send capability is **already a separate atomic MCP** (`services/x-mcp`, `services/reddit-mcp`) reached via `OUTBOUND_X_MCP_URL`. Callisthenes-the-brain is a thin `AGENT=outbound` shell over `buildOutboundTools`. **This unit is one `buildOutboundTools` extraction away from atomic.**

---

## 3 · The top 3 blocking cross-imports OVERALL (the shared shell)

These three are the universal drag — every unit's image contains them today, and each is what a
`filter-repo` carve must resolve. In priority order:

1. **`packages/server/src/runtime.ts` — the god-Runtime.** One class instantiates every store,
   gateway, and tool-builder in its constructor + `getEngine()` (`runtime.ts:206–449`); unconditional
   imports at `runtime.ts:38 buildExecutionQueue`, `:40 buildOutboundTools`, `:41 buildNotifierTools`
   compile all units into every image. **This is the single highest-value carve:** split `runtime.ts`
   so each unit's builder lives in `units/<unit>/`, and what remains is the council-guy's engine +
   seam.
2. **`packages/server/src/settings.ts:Settings`** — the shared config/state store imported by
   ~everything (`auth.ts`, `app.ts`, `executionLane.ts`, `channelAudio.ts`, `driveTools.ts`,
   `ingestQueue.ts`, `oauth.ts`, `whatsappGateway.ts`, `voiceArchive.ts`, …). It's the ambient
   dependency each unit assumes. **Resolution: promote the generic slice of `Settings` into the
   published shared lib; unit-specific keys move to each unit's own config.**
3. **`packages/server/src/app.ts:35 buildMeshGatewayServer` + `mcp.ts:buildMcpServer`** — the ONE
   HTTP+MCP server shell (`app.ts:115 createApp`) that serves whichever `AGENT` booted, wiring all
   tool-readers from the single Runtime. Every unit today ships this whole shell. **Resolution: each
   unit owns a minimal `createApp` that mounts only its own tools; the mesh becomes seam-only peer
   URLs (already the wire format).**

Honorable mention (not top-3 but real): **`peerClient.ts:callPeerTool`** is imported everywhere, but
it is *correct* coupling — it's the seam client and belongs in the shared lib. It's a **keep**, not a
blocker.

> Note on `packages/core` (`zenod`, the shared-lib seed): it is import-clean upward (no server
> imports), BUT `engine.ts` (1413 lines) is **not yet generic** — it hard-references `whatsapp`/
> `telegram`/`backlog`/`notification` semantics (`engine.ts:66–68`, `:207`, `:519`, `:781`). Before
> `packages/core` can be *the* published shared lib, that channel/domain awareness must move out to
> the units. **Blocking: `engine.ts` domain-purity ticket.**

---

## 4 · Risk memo

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Split-before-stable freezes interfaces mid-refactor** (RD-4 (a) rejected) | — | high | RD-4 (b): monorepo until the split trigger; this memo is the discipline. |
| R2 | **Carving `runtime.ts` blind breaks the live Console** (one image serves prod today) | med | high | Do NOT move fused code in W-F. Restructure = skeleton + audit only; each unit's carve is its own lane, behind the trigger, verified by `docker build units/<unit>` from a fresh clone. |
| R3 | **`settings.ts` split leaks config** (every unit assumes ambient Settings) | high | med | Split `Settings` into shared-generic + per-unit; add a scan asserting no unit imports another unit's config keys. |
| R4 | **`engine.ts` domain-impurity** blocks a clean shared lib | high | med | Domain-purity ticket: move channel/backlog/notification awareness out of core into units before publishing the lib. |
| R5 | **Ring gateway carve is the hardest** (whatsapp=9/telegram=8 sibling imports; Baileys ToS-flaky) | high | med | RD-1 already isolates Phylax as its own container/folder; do it LAST, after the easy units validate the pattern. |
| R6 | **6× CI/publish plumbing at split** (per-unit build+publish+deploy) | med | med | `services/x-mcp` proves the per-unit CI shape; reuse it. Shared lib publishes once, units consume by version. |
| R7 | **Cross-repo PR storms after split** | med | low | Split only after the seam is frozen (trigger); the shared lib absorbs churn, not the units. |
| R8 | **Import leak re-introduced during parallel lanes** (W-A/W-B/W-C editing concurrently) | med | med | CI scan: no `units/A → units/B` source import; only `units/* → shared`. Enforce as a check, not prose. |

---

## 5 · Staged plan — dated gates tied to the RD-4 split trigger

**Split trigger (RD-4, binding): the physical repo split executes only once SEAM-SPEC v1 passes the
tester on ≥2 units without spec edits.** Gates before that are monorepo-internal restructuring.

| Gate | Date target | Owner | Done-condition | Trigger-coupled? |
|---|---|---|---|---|
| **G0 — Skeleton** | 2026-07-05 (this ticket) | W-F | `units/` exists; `units/README.md` (target layout + filter-repo doctrine); per-unit folders scaffolded by W-A/W-B/W-C; this memo landed. | pre-trigger |
| **G1 — Seam proven on ≥2 units** = **THE TRIGGER** | on W-D tester pass | tester | SEAM-SPEC v1 conformance checklist (items 1–16) passes on Archus **and** ≥1 more unit (Zenod) with **zero spec edits**. Records: two tool-call transcripts. | **IS the trigger** |
| **G2 — Easy units carve** (post-trigger) | trigger + 3 days | W-per-unit | `outboundTools`→`units/callisthenes/`, `executionLane/Queue/Store`→`units/epaminon/`, `backlogRouter`+reader→`units/archus/`. Each: own Dockerfile; `docker build units/<unit>` from fresh clone succeeds; cross-import scan clean. | post-trigger |
| **G3 — Shared lib published** | trigger + 5 days | shared-lib lane | `packages/core` domain-purified (R4), the generic `Settings` slice folded in, published to the registry with a version; units depend by version not workspace path. | post-trigger |
| **G4 — Ring/Phylax carve** (hardest, last) | trigger + 8 days | W-A follow-on | `whatsappGateway`/`telegramGateway`/media pipeline → `units/ring/` + `units/phylax/`; the gateway↔ring-core `engine.chat()` in-process path replaced by a `message_received` seam call; ring-core = council-guy shell minus channel code. | post-trigger |
| **G5 — filter-repo cutover** | trigger + 10 days | Jordi calls | For each unit whose folder builds standalone + scans clean: `git filter-repo --path units/<unit>` into its own zenod-ai repo; websites (W-G) repoint. **No unit splits until its folder passes G2/G4.** | post-trigger |

**Explicit constraint honored:** no physical carve of `packages/core`/`packages/server` in this
ticket (G0). G2–G5 are staged behind G1 (the trigger). This memo + `units/README.md` + the
per-unit folder scaffolds (other lanes) are the entire pre-trigger deliverable.

---

## 6 · What exceeded budget / is left

- I did **not** read every one of the ~50 `packages/server/src/*.ts` files line-by-line; the audit is
  grounded in import-graph scans (sibling-import counts, `from "zenod"` vs `from "./"`) + reads of
  the load-bearing files (`agent.ts`, `runtime.ts` head, `peerClient.ts`, gateways, tool-builders,
  the composes, both `services/*/Dockerfile`). The per-unit **removal tickets** are named but not yet
  filed as GitHub issues — that's a planner action, not W-F's pen.
- The `engine.ts` domain-purity work (R4) is flagged, not scoped — it deserves its own ticket sizing.
