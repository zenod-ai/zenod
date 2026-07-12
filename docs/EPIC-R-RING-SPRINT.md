# EPIC R · Ring Sprint — duplicate Zenod, the middle is the Council

Status: shipped
Created: 2026-07-11
Updated: 2026-07-12
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-R-RING-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Ring delivery manager
Steward since: 2026-07-11T02:20:29+02:00
Last reconciled commit: `6f72b26775d51f3e51165379446ce13435ad1c1a`
Planner: Jordi + Epic 3.0 planner
Worker: Ring delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | Ring delivery manager | This spine | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, walk the journey, iterate until SHIP. | The test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. PORT/DUPLICATE means move code, adapt only imports/config — a scratch-written duplicate line is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-R-RING-SPRINT.md`
Active steward: Ring delivery manager

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-Z-NIGHT-SPRINT.md` — the completed Zenod template.
- `docs/EPIC-C-CALLISTHENES-SPRINT.md` — the first duplicate; copy its answers where they apply.
- `docs/EPIC-P-PHYLAX-SPRINT.md` — depends on THIS epic's MCP face; do not block on it.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D14/D15/D16/D19–D21 apply verbatim.
- `docs/EPIC-3.4-RING-MULTITENANT.md` — superseded by this spine.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Product shape, journey, PORT/DUPLICATE markings, pre-made decisions |
| The live zenod unit + `docs/EPIC-Z-NIGHT-SPRINT.md` | The customer-layer template being duplicated |
| `apps/web/src/views/ChatTab.tsx`, the console persona, `peer-agents.tsx` + `/api/peers` `/api/team/*` | The product middle being ported/evolved |
| GitHub issue | One ticket's execution detail |
| Validation evidence | The journey screenshots |

## Mission

Stand up the Ring — the front door: a web chat with your own Council, wired to your other units — as the next self-contained unit at `ring.zenod.dev`. DUPLICATE the proven Zenod customer layer (landing, GitHub sign-in, Stripe, tenants, dashboard shell). The product middle is code that already lives in this codebase: the Council web chat (`ChatTab` — streaming, markdown, tool testing), the console persona brain, and the wallet (an evolution of the existing peers/team surface: which units this tenant's council holds MCP URL+token for). Per D14 the Ring owns ZERO channel code — webchat is its only channel at SHIP; WhatsApp arrives later via Phylax calling the Ring's own MCP face. Done = the journey walked clean by the manager, then Jordi.

## Definition Of Done

SHIP — the journey, walked in a REAL BROWSER on the LIVE deployment, loop until ONE uninterrupted clean pass, screenshots per step:

- [x] 1. Open `ring.zenod.dev` logged out → normal landing: what the Ring is ("your council — one chat, wired to all your agents"), Get started, Pricing, Sign in. No public token field. (DUPLICATE)
- [x] 2. Pricing: Self-hosted (free) / Monthly / Yearly, Stripe TEST. (DUPLICATE)
- [x] 3. Sign in with GitHub — same account system as Zenod/Callisthenes, one identity across units. (DUPLICATE)
- [x] 4. Subscribe (TEST card) → `client_reference_id` binding → tenant row in THIS container → land in the dashboard. (DUPLICATE)
- [x] 5. Dashboard: the COUNCIL CHAT front and center (ported ChatTab); **My Units wallet** panel (add a unit by pasting its MCP URL + token; status per unit); **Keys** (tenant's OpenRouter key via UI — never env); the Ring's own MCP URL + token with copy button (this is what Phylax and external agents will call); usage; back-link to landing. No channel tabs, no other units' panels. (PORT ChatTab + persona; EVOLVE peers→wallet; DUPLICATE the rest)
- [x] 6. Enter OpenRouter key → chat answers as the council. (PORT — existing chat path)
- [x] 7. Wallet: paste the tenant's own Zenod MCP URL + token → unit shows connected. Tell the council "remember this: the ring is alive" → council routes to that Zenod → the Zenod commit receipt appears in the chat reply. THE golden-path moment. (PORT peer-call machinery)
- [x] 8. The Ring's MCP FACE works: an external MCP client `initialize`s against the tenant's Ring URL and one chat tool call gets a council reply — this is the exact contract Phylax will consume. (PORT — existing /mcp plumbing)
- [x] 9. Logout/login persists chat wallet keys; second tenant sees none of the first tenant's wallet, chat history, or keys.
- [x] 10. Test package: "I manually walked the full journey and it works. URL + screenshots. Now you test."

HARDEN: generic MCP tool discovery plus tenant-attached Agent Skills is now approved and tracked as R-H1..R-H5 below. Multiple-unit routing rules, Google sign-in, and standing-directives remain future work.

## Non-Goals

- ANY channel code (D14 — Phylax's job). Webchat is the only channel at SHIP.
- New chat UI design — ChatTab moves as-is.
- Suite composition, Herald, machine tenants.
- Touching live Zenod/Callisthenes units beyond reading code as template.

## Current State

Phase: shipped; HARDEN complete — generic MCP, advertised/tenant-managed Agent Skills, and receipt provenance live
Last verified: 2026-07-12T01:58:31+02:00
Integration target: main
Live Ring artifact: `ghcr.io/zenod-ai/zenod:sha-4e09029` (`4e09029ac7634a818cadf3ecb285a32581d47eeb`)
Validated Zenod skill publisher: `ghcr.io/zenod-ai/zenod:sha-e7dc215` (`e7dc215a566189c317a68533a7006c6d8a5b2d8f`)
Next action: none; SHIP, R-H1–R-H5, advertised Zenod skill import, and post-HARDEN truthfulness corrections are delivered.
Blockers: none.

## Steward Commentary And Reasoning

Reconciled 2026-07-12 against `main` at `6f72b26` and live `ring.zenod.dev` health at exact SHA `4e09029ac7634a818cadf3ecb285a32581d47eeb`.

- **Advertised skill import (`e7dc215`):** Ring imports a peer's canonical bundle only after successful MCP discovery and only from the peer's own origin. Manual attach/replace/detach remains authoritative. This makes first connection useful without turning the peer into an authority over the tenant.
- **Host-evidenced catalogs (`a730417`):** the Council and My Units render the catalog Ring actually discovered, including exact names and schemas. Reason: models and skill prose must not invent aliases, capabilities, or replacement schemas.
- **Receipt provenance (`1b72a7c`):** a mutation success claim must come from verified same-turn tool evidence at the reply boundary. Reason: neither model prose nor a loaded skill can establish that an external side effect occurred.
- **Schema-warning honesty (`bf366b5`):** unsupported or reduced peer output schemas are surfaced as warnings instead of silently replaced with an invented contract. Reason: degraded interoperability must remain visible and debuggable.
- **Natural mutation intent (`eb0f095`):** ordinary requests such as "draft this and show me" can invoke the matching discovered mutation, while capability questions and negated sends remain read-only. Reason: safety should bind intent to the exact operation family, not require magic command phrasing.
- **Generic approval holds (`4e09029`):** approval-required peer results render as "held; nothing changed," include only non-sensitive proposed arguments, and preserve the peer response as quoted untrusted data. Reason: a draft hold is neither a failure nor a completed mutation, and secrets must never be echoed to make it actionable.

Summarized authority model: **the MCP catalog defines what can be called; the Agent Skill advises how to use it; a verified same-turn receipt proves what happened.** Keeping these three layers separate is the main defense against invented tools, authority escalation, and fabricated success.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic worker | Journey passes clean; test package delivered. | Package posted, or "BLOCKED ON JORDI: <one question>" as entire status. |
| Ticket worker | Ticket done in own worktree, PR opened. | PR + one-line result. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine, top to bottom | Everything is here. | Always |
| 2 | `docs/EPIC-Z-NIGHT-SPRINT.md` + `docs/EPIC-C-CALLISTHENES-SPRINT.md` (ledgers/journals) | The template and the first duplicate — copy their answers. | Always |
| 3 | Live zenod unit customer-layer code | Being DUPLICATED. | R-S1 worker |
| 4 | `apps/web/src/views/ChatTab.tsx`, console persona in `packages/server/src/agent.ts`, `peer-agents.tsx`, `/api/peers`, `/api/team/*`, `peerClient.ts` | Being PORTED/EVOLVED. | R-S2/R-S3 workers |
| 5 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D14/D15/D16/D19–D21 | The laws. | Manager |

## Architecture And Context

One Dokploy application `ring`, one hostname `ring.zenod.dev`, one container. Tickets:

- **R-S1 · Front duplicate** (DUPLICATE) — Zenod customer layer + landing, Ring branding/pricing copy, its own tenants table.
- **R-S2 · Council middle** (PORT) — ChatTab as the dashboard centerpiece; console-persona chat path tenant-scoped; per-tenant OpenRouter key via Keys (existing pattern); per-tenant chat history on the tenant storage.
- **R-S3 · Wallet** (EVOLVE peers/team surface — the ONE genuinely new-ish seam, flagged: budget 90 min, escalate rather than invent) — per-tenant list of {unit name, MCP URL, token(vault), status}; council brain gets the wallet as its tool surface (the existing peer-call machinery pointed at wallet entries). SECURITY (2026 MCP-gateway guidance): validate wallet URLs — https only, hostname must not resolve to private/loopback ranges except the unit fleet's own allowlist (SSRF guard); downstream tokens live in the vault and the tenant's Ring bearer is NEVER passed through to units (per-hop, audience-bound credentials — already the design, now stated as a check).
- **R-S4 · Billing + domain** (DUPLICATE Z-N3/Z-N5/C-S4 recipe) — three TEST prices; webhook → tenant row; Traefik `ring.zenod.dev`; guarded cutover.
- **R-S5 · Journey loop** (manager) — SHIP 1–10 including the MCP-face check (step 8) that Phylax depends on.

Wave 1: R-S1 ∥ R-S2. Wave 2: R-S3, R-S4. Then R-S5. Heartbeat 30 min: `lap/state | blocker | ETA`. 90-min ticket budgets; silence past budget = reassign.

## Decisions

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Domain | `ring.zenod.dev`. Landing at root, dashboard `/app`, `/mcp`, `/healthz`. |
| 2026-07-11 | Accounts | Same GitHub OAuth app + account system as Zenod (DUPLICATE; creds from the zenod unit's Dokploy env). Callback addition if needed → BLOCKED ON JORDI with the exact URL. GitHub only. |
| 2026-07-11 | SHIP scope | Chat + wallet + ONE wired unit (the tenant's Zenod) with one routed action returning a receipt (SHIP 7). Chat-only is NOT ship. (Jordi 2026-07-11.) |
| 2026-07-11 | Channels | NONE in the Ring (D14). Webchat only. Phylax integrates later by calling the Ring's MCP face — which is why SHIP 8 exists. |
| 2026-07-11 | LLM key | Per tenant, entered via the Keys UI. Never injected. Manager's laps use the capped TEST OpenRouter key entered through the UI. |
| 2026-07-11 | Pricing | Self-hosted (free) / Monthly / Yearly, Stripe TEST, same account. |
| 2026-07-11 | Conduct kit | Register async ticket shapes with any receipt middleware BEFORE walking (the Zenod silent_ack lesson). |
| 2026-07-11 | Anything unanswered | Simplest option, journal it, keep moving. |
| 2026-07-11 | Generic wallet tools | Ring discovers every peer through MCP `tools/list`; it never assumes `ask_brain` and never carries product-specific profiles. Names are collision-safe; descriptions and JSON Schemas reach the Council; saved peers auto-refresh on boot and edit without reconnecting. |
| 2026-07-11 | Per-peer skills | A peer may advertise one canonical same-origin Agent Skills bundle in its D16 card. Ring imports it on successful connection/refresh when no skill or explicit detach opt-out exists. Manual attach/replace/detach remains authoritative; detach persists the opt-out. Cross-origin, redirected, malformed, or oversized advertisements are ignored without breaking MCP discovery. Ring stores accepted bundles as tenant artifacts and exposes them only through progressive `load_peer_skill` disclosure. |
| 2026-07-11 | Skill runtime boundary | Current AI SDK 6 provider-independent pattern first. AI SDK 7 `uploadSkill` and provider containers are a separate future decision. Scripts stay inert; skill prose cannot override authority or mutation guards. |
| 2026-07-11 | Generic peer receipt gate | Verified receipts from mutating wallet peer tools render verbatim from the tool result. Do not special-case `add_memory`, Zenod, or Calli; preserve the existing separate reconciliation path for backlog/execution tools. |
| 2026-07-11 | Authoritative stream completion | Streaming deltas are transient UX. The `done` event must carry `engine.chat`'s final authoritative text, and the UI must replace the draft with it. This applies generically to every final reply, not only wallet receipts. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#837](https://github.com/zenod-ai/zenod/issues/837) | Ticket worker | R-S1-worker | R-S1 front duplicate (landing, auth, tenants) | done | - | [#841](https://github.com/zenod-ai/zenod/pull/841) / `codex/r-s1-front-duplicate` | `fcac83f` | SHIP 1–4 | CI green; merged `0bbd045` | 2026-07-11T02:33:31+02:00 | integrated |
| [#836](https://github.com/zenod-ai/zenod/issues/836) | Ticket worker | R-S2-worker | R-S2 council middle (ChatTab + persona + Keys, tenant-scoped) | done | - | [#842](https://github.com/zenod-ai/zenod/pull/842) / `codex/r-s2-council-middle` | `fcac83f` | SHIP 5–6 | CI green; Ring namespace fix; merged `4ed9440` | 2026-07-11T02:33:31+02:00 | integrated |
| [#838](https://github.com/zenod-ai/zenod/issues/838) | Ticket worker | R-S3-worker | R-S3 wallet (peers surface → per-tenant unit wallet) | done | #837, #836 done | [#850](https://github.com/zenod-ai/zenod/pull/850) / `codex/r-s3-wallet` | `4ed9440` | SHIP 7 | CI green; 46 focused tests; merged `9e5862c` | 2026-07-11T02:46:31+02:00 | integrated |
| [#839](https://github.com/zenod-ai/zenod/issues/839) | Ticket worker | R-S4-worker | R-S4 billing + domain (duplicate recipe) | done | #837 done | [#849](https://github.com/zenod-ai/zenod/pull/849) / `codex/r-s4-billing-domain` | `4ed9440` | SHIP 2, 4 live | CI green; guarded runbook/script; merged `6352ee1` | 2026-07-11T02:46:31+02:00 | integrated; manager cutover |
| [#840](https://github.com/zenod-ai/zenod/issues/840) | Epic worker | Ring delivery manager | R-S5 journey loop + MCP-face check + isolation + package | done | #837, #836, #838, #839 done | `main`; final fixes [#869](https://github.com/zenod-ai/zenod/pull/869), [#882](https://github.com/zenod-ai/zenod/pull/882) | `5ac9f37` live | SHIP 1–10 | all steps pass; exact commit receipt visible without reload; external MCP + isolation reproved | 2026-07-11T05:48:00+02:00 | package delivered |
| [#854](https://github.com/zenod-ai/zenod/issues/854) | Ticket worker | R-S5a-worker | Surface downstream Zenod commit receipt in Council chat | done (code) | #840 | [#856](https://github.com/zenod-ai/zenod/pull/856) / `codex/r-s5a-zenod-receipt` | `527023c` | SHIP 7 receipt within 180s | CI + review pass; live still times out | 2026-07-11T04:31:00+02:00 | epic blocker remains |
| [#855](https://github.com/zenod-ai/zenod/issues/855) | Ticket worker | R-S5b-worker | Make `chat_with_ring` satisfy conduct-kit receipt gate | done | #840 | [#857](https://github.com/zenod-ai/zenod/pull/857) / `codex/r-s5b-mcp-receipt` | `527023c` | SHIP 8 external chat reply | live HTTP 200 + Council reply + `chat_audit` evidence | 2026-07-11T04:31:00+02:00 | integrated |
| [#858](https://github.com/zenod-ai/zenod/issues/858) | Ticket worker | R-S5d-worker | Diagnose and close live Zenod receipt timeout | done (code) | #840, #854 | [#869](https://github.com/zenod-ai/zenod/pull/869) / `codex/r-s5d-generic-receipt-gate` | `0e06e6b` | exact SHIP 7 receipt within 180s; generic Calli-style peer receipt regression | CI + independent review pass; merged `cc47b3a`; live gate intercept confirmed | 2026-07-11T05:22:00+02:00 | integrated; UI stream seam moved to #879 |
| [#879](https://github.com/zenod-ai/zenod/issues/879) | Ticket worker | R-S5e-worker | Make streamed Council reply authoritative after receipt gate | done | #858 | [#882](https://github.com/zenod-ai/zenod/pull/882) / `codex/r-s5e-authoritative-stream` | `b7c0ca5` | stream `done` carries final text; UI replaces draft; exact live commit receipt | CI + independent review pass; final browser commit `45e22e2` visible without reload | 2026-07-11T05:48:00+02:00 | integrated |
| [#863](https://github.com/zenod-ai/zenod/issues/863) | Ticket worker | R-H1-worker | Generic MCP discovery + dynamic Council tools | done | - | [#886](https://github.com/zenod-ai/zenod/pull/886) / `codex/r-h1-generic-mcp-discovery` | `af1cfdf` | arbitrary peers expose real schemas/tools; auto-refresh; tools-ready state | CI + independent review pass; merged `ddab094` with H2 reconciliation | 2026-07-11T06:30:00+02:00 | integrated |
| [#860](https://github.com/zenod-ai/zenod/issues/860) | Ticket worker | R-H2-worker | Tenant skill artifact store + attachment API | done | - | [#885](https://github.com/zenod-ai/zenod/pull/885) / `codex/r-h2-peer-skill-artifacts` | `af1cfdf` | immutable/versioned/path-safe/tenant-isolated bundles + APIs | CI + independent security review pass; merged `19c45fa` | 2026-07-11T06:30:00+02:00 | integrated |
| [#862](https://github.com/zenod-ai/zenod/issues/862) | Ticket worker | R-H3-worker | My Units discovery + skill attachment UI | done | #863, #860 done | [#888](https://github.com/zenod-ai/zenod/pull/888) / `codex/r-h3-peer-skill-ui` | `ddab094` | transport vs tools-ready; attach/replace/download/detach | CI + independent review pass; 23 web tests; merged `062e91e` | 2026-07-11T06:53:42+02:00 | integrated |
| [#865](https://github.com/zenod-ai/zenod/issues/865) | Ticket worker | R-H4-worker | Progressive `load_peer_skill` runtime + safety | done | #863, #860 done | [#887](https://github.com/zenod-ai/zenod/pull/887) / `codex/r-h4-peer-skill-runtime` | `ddab094` | metadata-only baseline; on-demand skill; no authority escalation/scripts | CI + independent security review pass; merged `e1c257b` | 2026-07-11T06:53:42+02:00 | integrated |
| [#864](https://github.com/zenod-ai/zenod/issues/864) | Epic worker / tester | Ring delivery manager | Generic MCP + skills integration and live Calli validation | done | #862, #865, #866, #861 done | `main`; live fixes [#889](https://github.com/zenod-ai/zenod/pull/889), [#890](https://github.com/zenod-ai/zenod/pull/890) | `e6b0a2b` live | existing Calli auto-refresh, held draft only, two-tenant isolation | Calli 18 real tools; skill v1.0.0; held receipt; external MCP + isolation pass | 2026-07-11T13:19:05+02:00 | package delivered |
| [#892](https://github.com/zenod-ai/zenod/issues/892) | Ticket worker | Zenod skill steward | Advertised peer skill import + canonical Zenod bundle | done | #860, #862, #865 | [#893](https://github.com/zenod-ai/zenod/pull/893) / `codex/zenod-advertised-skill` | `e5387eb` | same-origin bounded import; tenant override; live progressive load | deployed `e7dc215`; existing Zenod peer auto-attached v1.0.0; loader audit pass | 2026-07-11T14:35:28+02:00 | closed |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker; shared clone read-only on main.
- Manager integrates passing PRs; deploy = rebuild the ONE ring app. Targeted tests + journey only.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| GitHub OAuth callback addition | Jordi | Only if manager can't edit the app | Paste the exact URL | Everything else |
| Anything touching live Zenod/Callisthenes/paying tenants | Jordi | Should not occur | BLOCKED ON JORDI | All else |

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- Sequence approved R-H1/R-H2 around the active #858 receipt lap; no shared-file overlap may be silently accepted.

## Worker Queue

- Wave 1: R-S1, R-S2. Wave 2: R-S3, R-S4. Then R-S5.
- Approved HARDEN: R-H1 ∥ R-H2, then R-H3 ∥ R-H4, then R-H5. Calli-side prerequisites are #866/#861.

## Tester Queue

- R-S5 includes SHIP 8 (MCP face) — the contract Phylax consumes next.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-11 | SHIP live gate | `fde458f` | ring.zenod.dev live | real Chrome walk, external MCP client, two bearer-authenticated tenants | BLOCKED: SHIP 7 receipt missing after 180s; SHIP 8 mutating call `silent_ack`; all other gates pass | `docs/evidence/ring-ship-2026-07-11/TEST-PACKAGE.md` |
| 2026-07-11 | Authorized receipt fix lap | `a729d08` | ring.zenod.dev live | real Chrome SHIP 7–9, external MCP chat, two bearer-authenticated tenants | BLOCKED: SHIP 7 still lacks commit receipt; SHIP 8–9 pass | `docs/evidence/ring-ship-2026-07-11/11`–`14`; `TEST-PACKAGE.md` |
| 2026-07-11 | Focused poll-path diagnosis lap | `fae4f33` | ring.zenod.dev live | real Chrome exact SHIP 7 phrase + Zenod durable task audit | PARTIAL: poll fixed and commit succeeds; visible reply omits SHA/URL | `docs/evidence/ring-ship-2026-07-11/15-path-fixed-commit-omitted.png`; `TEST-PACKAGE.md` |
| 2026-07-11 | Generic receipt gate live reprove | `b7c0ca5` | ring.zenod.dev live | real Chrome exact SHIP 7 phrase + Ring runtime logs | PARTIAL: gate intercepted `add_memory` and selected the verified receipt; stream UI retained the discarded model delta because `done` omitted final text | `docs/evidence/ring-ship-2026-07-11/17-gate-intercept-stream-draft-visible.png`; issue #879 |
| 2026-07-11 | Final SHIP journey | `5ac9f37` | ring.zenod.dev live | real browser exact SHIP 7; external MCP SDK client; bearer-isolated beta tenant | PASS: commit `45e22e2` + GitHub links visible without reload; `ring-face-ok`; alpha peers/key hidden from beta; beta cleaned up | `docs/evidence/ring-ship-2026-07-11/19-ship7-live-authoritative-receipt.png`; `TEST-PACKAGE.md` |
| 2026-07-11 | Generic MCP + skills hardening | `e6b0a2b` | ring.zenod.dev live | saved Calli refresh; real browser skill/draft; external MCP SDK; bearer-isolated beta tenant | PASS: Calli tools ready 18; canonical skill loaded; `[draft_not_approved]` held; MCP status ok; beta sees no peers/key/skill; cleaned up | `docs/evidence/ring-ship-2026-07-11/20`–`25`; `TEST-PACKAGE.md` |
| 2026-07-11 | Advertised Zenod skill import | `e7dc215` | ring.zenod.dev + cloud.zenod.dev live | existing peer boot refresh; signed-in Chrome; external Ring MCP chat; service correlation audit | PASS: Zenod v1.0.0 auto-attached, 3 inert files; `load_peer_skill` ran and reported scripts non-executable | `docs/evidence/ring-zenod-skill-2026-07-11/zenod-auto-attached.png`; correlation `test_abdfd93795ad4ff1a6fac8ebc8c16ca6` |
| 2026-07-12 | Post-HARDEN catalog/receipt/approval truthfulness | `4e09029` | ring.zenod.dev live | exact health SHA; source and focused regression evidence in `a730417`, `1b72a7c`, `bf366b5`, `eb0f095`, `4e09029` | DEPLOYED: host-evidenced catalog, same-turn receipt provenance, schema warnings, natural intent, truthful approval holds | Live health returned `4e09029ac7634a818cadf3ecb285a32581d47eeb`; no new full browser journey was claimed in this reconciliation |

## Handoff Journal

### 2026-07-12T01:58:31+02:00 - Spine steward - Latest live state and reasoning reconciled

Context: Ring is shipped, not active; all ten SHIP checks were already proved by the existing live package and are now marked complete. Production has advanced from the advertised-skill build to exact SHA `4e09029`, adding host-evidenced catalogs, same-turn mutation receipt provenance, visible output-schema warnings, natural-language mutation intent bound to exact operation families, and generic approval-hold rendering with sensitive arguments removed. Zenod remains healthy on exact SHA `e7dc215`, which is still the validated skill publisher. The spines now distinguish those two live artifacts instead of implying one shared current SHA.
Reasoning: catalog, skill, and receipt are deliberately separate authorities. Catalog truth prevents invented capability; skill guidance improves routing without granting power; receipt provenance prevents fabricated outcomes. The later Ring changes tighten those boundaries rather than expanding product scope.
Next: none. A future behavioral change must name which authority layer it changes and provide new live evidence; this reconciliation does not claim a new full browser journey.

### 2026-07-11T14:35:28+02:00 - Ring delivery manager - Advertised Zenod skill live

Context: [#893](https://github.com/zenod-ai/zenod/pull/893) added the generic D16 advertised-bundle import and Zenod's canonical bundle. Published image `sha-e7dc215` is live on both Ring and Zenod with exact health SHA. The existing saved Zenod wallet peer auto-imported `zenod@1.0.0` on boot refresh without reconnecting; the browser shows three inert files and manual replace/download/detach controls. External Ring MCP conversation `mcp:zenod-skill-live-proof-e7dc215` caused the Council to call host-owned `load_peer_skill`; correlation `test_abdfd93795ad4ff1a6fac8ebc8c16ca6` records start, end, and success. The reply `zenod 1.0.0 false` confirms scripts are not executable.
Next: none; advertised import is additive, peers without an advertisement remain manually attachable, and explicit detach prevents silent re-import.

### 2026-07-11T13:19:05+02:00 - Ring delivery manager - HARDEN complete

Context: Exact live release `e6b0a2b` passes R-H1–R-H5. The already-saved Calli peer refreshed without reconnecting and exposes 18 real namespaced tools. The canonical `callisthenes@1.0.0` three-file skill is attached; scripts remain inert. Council loaded the skill and executed `createPosts` once with no approval, receiving `[draft_not_approved]`, held handle `dr_7281ac3`, and no publication. An external MCP SDK client listed and called Ring successfully. A temporary beta tenant saw zero peers, no OpenRouter key, and no Calli skill despite an alpha-facing query, then deleted cleanly.
Next: none. Test package and screenshots are authoritative under `docs/evidence/ring-ship-2026-07-11/`.

### 2026-07-11T06:53:42+02:00 - Ring delivery manager - HARDEN wave 2 merged; R-H5 active

Context: R-H4 merged as `e1c257b` after CI and independent security review. R-H3 then merged as `062e91e` after CI, independent review, and 23 web interaction/model regressions. The wallet and Ring product surface now share one truthful readiness predicate: transport connected, discovery ready, and at least one usable tool. The host-owned `load_peer_skill` exposes only tenant-attached, integrity-checked advisory skill content and never inlines or executes scripts.
Next: publish and deploy exact `062e91e`, refresh the existing Calli peer without reconnecting, attach/load the canonical Calli skill, create one held draft only, and reprove tenant isolation.

### 2026-07-11T06:30:00+02:00 - Ring delivery manager - HARDEN wave 1 merged; wave 2 dispatched

Context: R-H2 merged first as `19c45fa` after CI and independent quota/security review. R-H1 then reconciled onto that exact main, preserving skill attachments and concurrency, and merged as `ddab094` after CI and independent review. Ring now has authenticated generic discovery, truthful transport/tools state, collision-safe names, bounded schemas/catalogs, annotation-aware guards, rich result preservation, refresh without reconnect, and tenant-isolated skill artifacts. R-H3 and R-H4 start in parallel from `ddab094` with disjoint UI vs runtime write scopes.
Next: integrate R-H3/R-H4, publish/deploy one exact SHA, and execute R-H5 with the already-saved Calli peer, canonical skill, held draft only, and second-tenant isolation.

### 2026-07-11T06:10:00+02:00 - Ring delivery manager - HARDEN wave 1 dispatched

Context: Jordi's live screenshots proved the shipped wallet only reports transport connectivity: Zenod receives a product-specific curated catalog while arbitrary peers fall back to `ask_<name>`. Jordi directed the manager to finish the already-approved generic MCP + peer-skills hardening. R-H1 and R-H2 start in parallel from fresh pinned main `af1cfdf`; the prior SHIP package remains valid but does not satisfy generic discovery acceptance.
Next: merge reviewed R-H1/R-H2, dispatch dependent R-H3/R-H4, then run R-H5 against live Calli with discovered tools and two-tenant isolation.

### 2026-07-11T05:48:00+02:00 - Ring delivery manager - SHIP journey complete

Context: PR #882 merged after full CI and independent review, published, and deployed only to the Ring application as immutable SHA `5ac9f37`. The fully initialized dashboard then completed the exact phrase `remember this: the ring is alive` without reload and visibly rendered commit `45e22e251391b5233a5987fd3ae0a06a93d1347c` plus both GitHub links. An external MCP SDK client received exact `ring-face-ok` with correlation-backed `chat_audit` evidence. A fresh beta bearer could not see alpha's Zenod/Calli wallet or OpenRouter setting even when it supplied alpha's id; the beta tenant was deleted after proof.
Next: package delivered in `docs/evidence/ring-ship-2026-07-11/TEST-PACKAGE.md`.

### 2026-07-11T05:22:00+02:00 - Ring delivery manager - Generic gate passes; stream finalization is the exact blocker

Context: PR #869 merged after CI and independent review, and Ring deployed exact pinned main `b7c0ca5`. On the exact browser phrase, runtime logs show `[reply-gate] intercepted on action turn (add_memory)` and state that the verified receipt replaced the model draft. However `/api/chat/stream` emits model deltas and a `done` event without `reply.text`; `ChatTab` only clears activity on `done`, so the discarded draft remains visible. This is a generic streaming contract seam, not a wallet or product-profile gap.
Next: #879 carries the smallest generic fix from `b7c0ca5`: include final authoritative text in `done`, replace the transient draft in the UI, test normal and intercepted replies, review, deploy, and rerun exact SHIP 7.

### 2026-07-11T04:52:00+02:00 - Ring delivery manager - Generic receipt lap authorized after Calli handoff

Context: Jordi authorized continuation and directed the manager to the completed Calli integration notes. Those notes prohibit product-specific Ring profiles: Calli supplies a portable skill plus truthful generic MCP annotations, while Ring owns generic discovery and receipt behavior. #858 therefore continues on fresh base `0e06e6b` in `codex/r-s5d-generic-receipt-gate` / `../wt-r-s5d` with a generic mutating-wallet-receipt gate, not an `add_memory` name exception.
Next: prove both Zenod commit receipt and a Calli-style verified mutation receipt render verbatim, then exact-SHA deploy and SHIP 7 browser rerun.

### 2026-07-11T04:45:00+02:00 - Ring delivery manager - Poll fixed; reply gate now the sole blocker

Context: Live evidence proved that Zenod had completed the prior store in ~8s while Ring polled a malformed `/mcp/<credential>/api/tasks/...` route. PR #859 normalized hosted MCP paths, passed CI and independent security review, and deployed as `fae4f33`. The exact browser phrase then returned in ~25s; Zenod task `18cfa656-798d-4215-9976-e8c83be3e688` completed in ~14s with commit `43ab417da540cae5b6b18ae4de9b2e52810ce38a` and GitHub URLs.
Blocker: Council chat displayed a model paraphrase naming the filed Inbox page but omitted the commit SHA/URL. `add_memory` is mutate-classified but absent from `replyGate.ts`'s verified-receipt action set, so the tool receipt was not rendered verbatim. The authorized live reprove lap is consumed.
Evidence: `docs/evidence/ring-ship-2026-07-11/15-path-fixed-commit-omitted.png`, Zenod durable task above, and issue #858.
Next: BLOCKED ON JORDI — authorize one final reply-gate-only lap for `add_memory`, or stop Ring SHIP.

### 2026-07-11T04:34:35+02:00 - Generic MCP Skills delivery manager - Generic peers + attached skills added to Ring backlog

Context: Jordi rejected a Calli-specific Ring profile and approved the generic contract: MCP tools are discovered from every connected peer; the tenant attaches a separate Agent Skills artifact in My Units; full instructions load progressively. Issues #863/#860/#862/#865/#864 own the Ring side. Because #858 is already active on Ring files, the Ring steward must sequence wave 1 rather than accept hidden overlap. Calli readiness is independently dispatched under #866/#861.
Next: Calli manager delivers the attachable skill and MCP contract; Ring steward dispatches R-H1/R-H2 from a fresh post-#858 base.

### 2026-07-11T04:38:00+02:00 - Ring delivery manager - Focused SHIP 7 diagnosis lap authorized

Context: Jordi authorized continuation after the `a729d08` live receipt timeout. #858 is pinned to `de327ac` in `codex/r-s5c-live-receipt` / `../wt-r-s5c`. This lap begins from the live Ring/Zenod durable audit and job records; code changes are limited to the smallest proven receipt-contract correction.
Next: reproduce the precise live failure, merge only reviewed passing code, deploy one exact SHA, and rerun the exact SHIP 7 browser phrase.

### 2026-07-11T04:31:00+02:00 - Ring delivery manager - Authorized lap consumed; SHIP 7 remains blocked

Context: PRs #856/#857 passed CI and independent review, including per-poll wallet SSRF revalidation, then merged into frozen build `a729d08`. The isolated Ring app was guardedly deployed and exact-SHA health passed. On that same live build, external MCP initialize + `chat_with_ring` returned HTTP 200, a non-error Council reply, and durable `chat_audit` evidence; logout/login retained chat, wallet, and masked OpenRouter settings; a newly provisioned second bearer tenant could not read the first tenant's peers or key settings.
Blocker: the exact SHIP 7 phrase routed to connected Zenod and held the UI for the complete polling window, then returned only “queued … I'll confirm once it's filed,” with no commit SHA/URL. The one additional lap Jordi authorized is exhausted.
Evidence: `docs/evidence/ring-ship-2026-07-11/11-authorized-lap-receipt-timeout.png` through `14-authorized-lap-isolation-alpha.png` and updated `TEST-PACKAGE.md`.
Next: BLOCKED ON JORDI — authorize another focused diagnosis/fix lap for SHIP 7, or stop Ring SHIP.

### 2026-07-11T04:10:00+02:00 - Ring delivery manager - One additional receipt fix lap authorized

Context: Jordi answered “go for it,” authorizing exactly the requested additional lap without changing acceptance or broader scope. The manager split the two independent receipt seams into #854 (`codex/r-s5a-zenod-receipt`, `../wt-r-s5a`) and #855 (`codex/r-s5b-mcp-receipt`, `../wt-r-s5b`), both pinned to `527023c` and dispatched in parallel.
Next: merge only targeted passing fixes, deploy one frozen exact SHA, and rerun SHIP 7–10 on `ring.zenod.dev`.

### 2026-07-11T04:01:00+02:00 - Ring delivery manager - Live gate frozen; final fix budget exhausted

Context: Final live image `fde458f` passed CI, published, and was guardedly deployed to the isolated Ring application. The manager completed GitHub OAuth, Stripe TEST checkout, dashboard, a $1-capped OpenRouter key entered and tested through the UI, Zenod wallet connection, external MCP initialize/read, logout/login persistence, and live bearer-scoped two-tenant isolation. The dashboard and tenant state persist on Ring's `/data`; existing Zenod and Callisthenes services were not redeployed.
Blocker: `remember this: the ring is alive` routed to Zenod and stayed at “Saving to Zenod’s memory” without a commit receipt after 180 seconds. External `chat_with_ring` reached Ring but the receipt middleware returned `silent_ack` because its successful mutating result had no `evidence[]`; initialize and `read_llm_timeline` passed. D19's final allowed fix lap is exhausted.
Evidence: `docs/evidence/ring-ship-2026-07-11/TEST-PACKAGE.md` and screenshots `01`–`10`.
Next: BLOCKED ON JORDI — authorize exactly one additional fix lap for these two receipt-path seams, then rerun only SHIP 7–10 and freeze a new exact SHA.

### 2026-07-11T02:46:31+02:00 - Ring delivery manager - Wave 2 integrated; R-S5 frozen

Context: R-S4 passed CI and merged as `6352ee1`; R-S3 stayed within its hard budget, passed CI after scoping terminal receipt polling to Ring wallet peers, and merged as `9e5862c`. The live baseline still serves only the old Ring static root; `/app`, `/healthz`, and `/mcp` are 404, so no prior deployment is being mistaken for SHIP.
Frozen test commit: `9e5862ced52d5b7dd7abcde69f51ee4003d8cdb7`. One full live gate will run on its immutable image per D19c/D21.
Next: create the empty Ring Dokploy application, execute the guarded cutover without mutating existing units, then run the browser/MCP/two-tenant journey and package screenshots.

### 2026-07-11T02:33:31+02:00 - Ring delivery manager - Wave 1 integrated; wave 2 dispatched

Context: R-S1 passed CI and merged as `0bbd045`; R-S2 passed CI and merged as `4ed9440` after manager review caught and closed a customer-layer namespace seam so Ring accounts, checkout URLs, OAuth callback, and storage use `ring` / `ring.zenod.dev`. Wave 2 is pinned to integrated commit `4ed94400f1bbdd9cb8252def2b72b2614ee3a354` without rebasing wave 1.
Assignments: R-S3-worker / `codex/r-s3-wallet` / `../wt-r-s3` with the hard 90-minute escalate-not-invent budget; R-S4-worker / `codex/r-s4-billing-domain` / `../wt-r-s4`.
Next: integrate R-S3/R-S4, publish and deploy the one Ring unit without touching live Zenod/Callisthenes services, then start the R-S5 live journey at `https://ring.zenod.dev/`.

### 2026-07-11T02:20:29+02:00 - Ring delivery manager - Steward bound and wave 1 dispatched

Context: stewardship transferred from the planner to the Ring delivery manager before concurrent ticket work. `main` and `origin/main` are aligned at pinned base `fcac83ff27e04b60b19a3cfae0ff62bf8f0f5a92`; the shared checkout's unrelated pre-existing edits to `docs/EPIC-4.0-HERALD.md` and `docs/EPIC-4.2-POC-LOOP-CORE.md` remain untouched. R-S1..R-S5 were minted as issues #837, #836, #838, #839, and #840.
Assignments: R-S1-worker / `codex/r-s1-front-duplicate` / `../wt-r-s1`; R-S2-worker / `codex/r-s2-council-middle` / `../wt-r-s2`.
Next: monitor the 90-minute budgets, integrate passing PRs, dispatch R-S3/R-S4 from the integrated wave-2 base, deploy the one Ring app, then walk R-S5 from `https://ring.zenod.dev/`.

### 2026-07-11 - Planner - Ring sprint spine created

Context: Third unit on the duplicate-and-adapt recipe. The one new-ish seam is the wallet (R-S3, evolving the existing peers surface) — flagged with a hard budget and escalation rule. SHIP 8 (MCP face) deliberately included because EPIC-P (Phylax) forwards inbound WhatsApp to exactly that contract.
Next: dispatch the manager.
Risks: wallet seam; per-tenant chat-history storage paths.
Links: `docs/EPIC-Z-NIGHT-SPRINT.md`, `docs/EPIC-C-CALLISTHENES-SPRINT.md`, `docs/EPIC-P-PHYLAX-SPRINT.md`.

## Open Questions

- None permitted. Decisions table or simplest option + journal.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Mark superseded by this spine. | this spine | manager on bind | proposed |
| 2026-07-11 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Notify on SHIP approval — unblocks Phylax dispatch. | this spine | manager | proposed |

## Appendix

Inputs from Jordi: none required. OAuth/Stripe creds read from existing Dokploy envs; the manager's journey uses the capped TEST OpenRouter key via the Keys UI.
