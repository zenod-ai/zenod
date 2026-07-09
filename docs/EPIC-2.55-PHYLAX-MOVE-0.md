# EPIC 2.55 - PHYLAX MOVE 0 - hosted channel gateway

Status: active
Created: 2026-07-09
Updated: 2026-07-09
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-2.55-PHYLAX-MOVE-0.md`
GitHub issues: `https://github.com/zenod-ai/zenod/issues?q=is%3Aissue%20label%3Aepic%3A2.55`
Integration branch: `main`
Active spine steward: Epic 2.55 Phylax steward (`current Codex task`)
Steward since: 2026-07-09 23:55 CEST
Last reconciled commit: `c8fdb5b57d28a9701918b4ff01981e3e4aec0731`
Planner: Jordi + Epic 2.55 Phylax steward
Worker: Epic 2.55 Phylax steward and dispatched ticket workers
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | `docs/EPIC-0-FOUNDATION-SPINE.md` | Read-only from this epic. Owns root operating model and cross-epic rollups. | Proposed updates recorded here, not silently applied. |
| Planner | Epic 2.55 Phylax steward | Phylax 2.55 accepted scope | Maintain this spine, issue board, dependencies, boundaries, and human gates. | Backlog executable, issue ledger current, next test/decision explicit. |
| Epic worker | Epic 2.55 Phylax steward | This epic | Deliver hosted Phylax through GitHub issue/subagent loop; coordinate Ring and cloud dependencies. | Spine ledger, dispatch state, blockers, validation evidence, and handoff current. |
| Ticket worker | Per issue row | One GitHub issue | Execute assigned branch/worktree; write detailed progress and handoff to the issue. | PR/branch, latest commit, validation notes, blocker, and next action in the issue. |
| Tester | unassigned | #713 or later test issue | Validate exact commit/environment; do not broaden scope or self-certify implementation. | Fresh browser evidence, pass/fail, residual risk, follow-up issues. |
| Reviewer | unassigned | PR or milestone | Review for bugs, boundary drift, and missing tests; no mutation unless promoted. | Findings and proposed next action. |

## Write Scope

Bound spine: `docs/EPIC-2.55-PHYLAX-MOVE-0.md`
Active steward: Epic 2.55 Phylax steward (`current Codex task`)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers write detailed execution, logs, and handoffs to their assigned GitHub issue.
- Explicit narrow delegation: none yet.

Read-only linked spines:

- `docs/EPIC-0-FOUNDATION-SPINE.md` - EpicSpine operating model and root rollup.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` - Ring / atomic units execution. Ring routing behavior and Ring docs remain Ring-owned.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` - Zenod memory/media ownership, if present in the checkout.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` - hosted cloud/product pattern, if present in the checkout.
- `zenod-ai/cloud` hosted control plane - read broadly, write through dedicated ticket branches/worktrees because the local cloud checkout is currently dirty.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Epic 2.55 intent, product boundary, acceptance, issue ledger, decisions, recovery, and validation rollup |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Epic 2.5 spine | Ring routing/control-surface intent and Ring worker state |
| Epic 2.3 spine | Zenod memory/media ingestion ownership |
| `zenod-ai/cloud` code | Actual hosted checkout, account, provisioning, status, and signed-entry behavior |

## Mission

Deliver Phylax as an independently purchasable, deployable, configurable hosted channel gateway while the Ring worker continues Epic 2.5. Phylax owns transport, provider credentials, sender policy, channel health, delivery receipts, retries, and provider/session state. It normalizes inbound channel messages into Ring and delivers outbound Ring responses through the originating channel. Phylax must not absorb Ring routing, product selection, mailbox provenance, relay policy, connected-product links, or Zenod media processing.

## Definition Of Done

- [ ] Public Phylax product site has a hosted purchase CTA to `cloud-test.zenod.dev`.
- [ ] Stripe TEST checkout for unit `phylax` completes through `cloud-test.zenod.dev` and queues/provisions a Phylax tenant automatically.
- [ ] Paid checkout lands the buyer in Phylax settings through a signed hosted-entry link without creating or revealing an admin password.
- [ ] Hosted Phylax settings UI configures Ring endpoint/write-only token, managed WhatsApp/provider credentials, Telegram bot settings, sender policy, channel health, test controls, receipts, retry/error state, MCP/API endpoint/token where applicable, and link back to owning Ring settings.
- [ ] Hosted UI does not expose QR pairing; self-host/dev Phylax may still support QR pairing.
- [ ] Self-host Phylax unit README, seam contract, compose, and runbook are complete.
- [ ] Ring/Phylax inbound and outbound integration tests prove same-channel provenance and explicit receipts.
- [ ] Fresh browser E2E evidence proves public site -> Stripe TEST payment -> provisioning -> signed entry -> channel config -> Ring connection -> inbound test -> outbound delivery -> health/receipt display.
- [ ] No Phylax work silently broadens Ring routing or Zenod media scope.

## Non-Goals

- Rewriting Ring routing, product selection, mailbox provenance, relay policy, or connected-product settings outside explicit Phylax seam needs.
- Moving Zenod media ingestion, raw archive, transcription, OCR/extraction, digest, filing, or citation receipts into Phylax.
- Creating a new checkout/provisioning pattern separate from the proven Epic 2.3 / Epic 2.4 / Ring cloud-test pattern.
- Exposing QR pairing in the hosted Phylax UI.
- Touching live Stripe or production `cloud.zenod.dev` without Jordi's explicit approval.

## Current State

Phase: planning / dispatch
Last verified: 2026-07-09 23:55 CEST
Integration target: `main`
Fresh base commit: `c8fdb5b57d28a9701918b4ff01981e3e4aec0731` in `zenod-ai/zenod`; cloud audit commit `5474802c17665a962714434b18e6286ae46dde2c` on local branch `codex/epic25-ring-cloud` with existing dirty Ring changes.
Next action: resume or re-dispatch #705, #703, and #704 when ready; the first worker batch was paused before integration after Jordi asked the steward to return to `main`.
Blockers: live managed WhatsApp/provider credentials and any production deployment require human approval; cloud checkout implementation must use a clean dedicated worktree because the local cloud checkout is dirty.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Planner | Keep scope executable, dependencies clear, and issues aligned to the product boundary. | Board ready/dispatched or named blocker. |
| Epic worker | Deliver the Phylax hosted gateway through issue/worker loop. | Ready for human testing, tester handoff, or blocked with required input. |
| Ticket worker | Complete one issue on a dedicated branch/worktree. | Ready for testing or blocked with precise input. |
| Tester | Prove the purchase-to-message-delivery path. | Acceptance passed, evidenced failure, or planner decision required. |

## Bootstrap Map

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `skills/epic-spine/SKILL.md` | Canonical EpicSpine behavior. | Always |
| 2 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Root write-scope, stewardship, issue-board operating model. | Always |
| 3 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Ring boundary and active Ring worker context. | Always |
| 4 | `packages/server/src/phylaxGateway.ts` | Current Phylax seam implementation. | Runtime worker |
| 5 | `packages/server/test/phylaxGateway.test.ts` | Current Phylax seam/API tests. | Runtime worker/tester |
| 6 | `packages/server/src/ringRouter.ts` | Ring provenance/outbound behavior; read-only unless seam issue says otherwise. | Runtime worker/tester |
| 7 | `apps/web/src/components/ring-control-surface.tsx` | Ring-owned UI boundary and links into Phylax. | UI worker |
| 8 | `apps/web/src/views/settings/ConnectionsTab.tsx` | Hosted Ring currently hides QR and shows managed Phylax placeholder. | UI worker |
| 9 | `apps/web/src/components/whatsapp-connect.tsx` | Self-host/dev WhatsApp UI and QR behavior. | UI/runtime worker |
| 10 | `apps/web/src/components/telegram-connect.tsx` | Self-host Telegram UI and settings shape. | UI/runtime worker |
| 11 | `/Users/jordi/Documents/GitHub/cloud/services/webhook/src/server.ts` | Current buy/status/success/account routes for hosted units. | Cloud worker |
| 12 | `/Users/jordi/Documents/GitHub/cloud/services/webhook/src/autoProvision.ts` | Shared auto-provision dispatch pattern. | Cloud worker |
| 13 | `/Users/jordi/Documents/GitHub/cloud/scripts/provision-ring.mjs` | Latest Ring hosted provisioner bridge pattern. | Cloud worker |
| 14 | `/Users/jordi/Documents/GitHub/cloud/services/console/src/App.tsx` | Hosted console Ring/Phylax placeholder UI. | Cloud UI worker |

## Architecture And Context

Product boundary:

- Phylax owns channel transport, managed/self-host provider configuration, sender/user allowlists, channel health, provider/session state, delivery receipts, retry/error state, inbound normalization, outbound delivery, and temporary media handles.
- Ring owns routing, product selection, mailbox provenance, relay policy, connected-product links, default route, route logs, and same-channel outbound envelope generation.
- Zenod owns memory and media ingestion: raw archive, transcription, OCR/extraction, digest, filing, citations, and media receipts.

Hosted versus self-hosted:

- Self-hosted/dev Phylax may support Baileys/device QR flows.
- Hosted Phylax must use managed provider configuration and must not expose QR pairing in hosted UI.
- Hosted settings live in `zenod-ai/cloud` or the hosted tenant UI and call self-hosted runtime APIs.
- Runtime remains usable headlessly through configuration/API.

Audit findings on 2026-07-09:

- `packages/server/src/phylaxGateway.ts` already models inbound normalization, outbound send receipt requirements, media handles, delivery status, and cloud-vs-self-host QR status.
- `packages/server/test/phylaxGateway.test.ts` already covers seam basics, allowlists, cloud mode QR absence, `/api/phylax/config`, `/api/phylax/status`, test-send failure for unmanaged cloud sender, and delivery-status lookup.
- `packages/server/src/app.ts` already exposes `/api/phylax/status`, `/api/phylax/config`, `/api/phylax/test-send`, and `/api/phylax/delivery-status`; managed cloud WhatsApp delivery is explicitly not connected yet.
- `apps/web/src/views/settings/ConnectionsTab.tsx` hides self-host WhatsApp/Telegram controls when `hostedMode === "ring"` but currently shows only a placeholder `Managed Phylax channels` card.
- `zenod-ai/cloud` currently supports hosted units `zenod`, `callisthenes`, `ring`, and `epaminon`; Phylax is not first-class yet.
- `scripts/provision-ring.mjs` deploys the fused tenant stack as hosted Ring v0 and emits forward-compatible Phylax tokens. This is a bridge, not an independent hosted Phylax product.
- The cloud success flow redirects unit checkouts to unit-specific status pages; Zenod/Ring account claim uses GitHub OAuth. Phylax requires a signed hosted-entry link without admin-password creation/reveal.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-09 | Epic 2.55 is a new child spine for Phylax as an independently purchasable hosted gateway. | Epic 2.5 is Ring-owned and active; Phylax now has distinct product/provisioning acceptance. | Jordi prompt; `docs/EPIC-2.5-ATOMIC-UNITS.md` boundary note. |
| 2026-07-09 | Hosted Phylax uses managed provider configuration; QR pairing is self-host/dev only. | Hosted buyers should not see Baileys/device QR pairing in the hosted UI. | `PhylaxGatewaySeam.pairingStatus()` and required hosted-vs-self-host boundary. |
| 2026-07-09 | Reuse the existing `zenod-ai/cloud` checkout/status/provisioning pattern. | Avoid another custom checkout/deployment path; Epic 2.3/2.4/Ring pattern already exists. | `services/webhook/src/server.ts`, `autoProvision.ts`, `scripts/provision-ring.mjs`. |
| 2026-07-09 | Treat Ring routing as read-only unless a ticket explicitly scopes a Phylax seam change. | Ring worker owns Epic 2.5; Phylax should not silently absorb Ring decisions. | `docs/EPIC-2.5-ATOMIC-UNITS.md`, #711. |
| 2026-07-09 | Treat the local cloud checkout as read-only until workers create clean worktrees. | The local `/Users/jordi/Documents/GitHub/cloud` repo has existing dirty Epic 2.5 Ring changes. | `git status --short` in cloud on 2026-07-09. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#702](https://github.com/zenod-ai/zenod/issues/702) | Epic worker | Epic 2.55 Phylax steward | P-0 spine and execution board | review | - | `main` / `7c8dfd4` then follow-up reconciliation | `c8fdb5b` | Spine exists, issue board created, validator passes. | Merged locally to `main`; #702 marked needs-review. | 2026-07-09 23:55 CEST | Review or push from `main` if desired. |
| [#705](https://github.com/zenod-ai/zenod/issues/705) | Ticket worker | Laplace / phylax-product-page-worker | P-1 public Phylax product page and hosted CTA | paused | #702 | `codex/epic-2.55-phylax-site` | `c8fdb5b` | Public page with cloud-test hosted CTA and correct boundaries. | Partial site work exists in `/Users/jordi/Documents/GitHub/zenod-epic255-phylax-site`; not integrated. | 2026-07-09 23:55 CEST | Resume validation before integration. |
| [#703](https://github.com/zenod-ai/zenod/issues/703) | Ticket worker | James / phylax-selfhost-unit-worker | P-2 self-host Phylax unit README, seam, compose, runbook | paused | #702 | `codex/epic-2.55-phylax-selfhost-unit` | `c8fdb5b` | Self-host unit docs/compose/runbook complete and legacy wording retired. | Worker was shut down before handoff; no integrated changes. | 2026-07-09 23:55 CEST | Re-dispatch or resume issue. |
| [#704](https://github.com/zenod-ai/zenod/issues/704) | Ticket worker | Gibbs / phylax-runtime-api-worker | P-3 runtime APIs for hosted config, health, receipts, Ring seam | paused | #702 | `codex/epic-2.55-phylax-runtime-api` | `c8fdb5b` | Runtime API supports hosted Phylax settings, write-only tokens, health, receipts, Ring endpoint. | Partial `packages/server/src/settings.ts` scaffolding exists in `/Users/jordi/Documents/GitHub/zenod-epic255-phylax-runtime-api`; not integrated. | 2026-07-09 23:55 CEST | Resume API/routes/tests before integration. |
| [#707](https://github.com/zenod-ai/zenod/issues/707) | Ticket worker | phylax-hosted-settings-ui-worker | P-4 hosted Phylax settings UI in cloud console | ready | #704 | `codex/epic-2.55-phylax-hosted-ui` | cloud `5474802` | Hosted settings UI covers required controls and hides QR. | Issue created. | 2026-07-09 23:55 CEST | Dispatch after or alongside API contract with mocks. |
| [#709](https://github.com/zenod-ai/zenod/issues/709) | Ticket worker | phylax-checkout-provisioning-worker | P-5 Stripe TEST checkout and automatic provisioning | ready | #703, #704, #705 | `codex/epic-2.55-phylax-checkout-provision` | cloud `5474802` | unit=phylax checkout, status, queue, provisioner, watchdog. | Issue created. | 2026-07-09 23:55 CEST | Dispatch in clean cloud worktree. |
| [#706](https://github.com/zenod-ai/zenod/issues/706) | Ticket worker | phylax-signed-entry-worker | P-6 signed checkout-to-settings handoff | ready | #707, #709 | `codex/epic-2.55-phylax-signed-entry` | cloud `5474802` | Paid buyer enters Phylax settings via signed link without admin password. | Issue created. | 2026-07-09 23:55 CEST | Dispatch after status/settings route exists. |
| [#708](https://github.com/zenod-ai/zenod/issues/708) | Ticket worker | phylax-managed-whatsapp-worker | P-7 managed WhatsApp provider adapter, retries, receipts | ready | #704 | `codex/epic-2.55-phylax-managed-whatsapp` | `c8fdb5b` | Managed provider inbound/outbound, receipts, retry/error, sender policy. | Issue created. | 2026-07-09 23:55 CEST | Dispatch with mocked provider first. |
| [#712](https://github.com/zenod-ai/zenod/issues/712) | Ticket worker | phylax-telegram-worker | P-8 hosted Telegram config, health, outbound receipts | ready | #704 | `codex/epic-2.55-phylax-telegram` | `c8fdb5b` | Hosted Telegram config/inbound/outbound/health/receipt support. | Issue created. | 2026-07-09 23:55 CEST | Dispatch with mocked bot/provider tests. |
| [#710](https://github.com/zenod-ai/zenod/issues/710) | Ticket worker / tester | phylax-seam-test-worker | P-9 Ring/Phylax inbound and outbound integration tests | ready | #704, #708, #712 | `codex/epic-2.55-phylax-seam-tests` | `c8fdb5b` | Tests prove inbound to Ring and outbound through originating channel. | Issue created. | 2026-07-09 23:55 CEST | Dispatch after API/provider seams. |
| [#713](https://github.com/zenod-ai/zenod/issues/713) | Tester | phylax-browser-e2e-tester | P-10 fresh browser E2E evidence | blocked | #705, #707, #709, #706, #708, #712, #710 | `codex/epic-2.55-phylax-e2e-evidence` | `c8fdb5b` plus cloud deploy commit | Fresh browser evidence for full required journey. | Issue created. | 2026-07-09 23:55 CEST | Wait for implementation issues; clarify live provider credential/mocked-provider gate. |
| [#711](https://github.com/zenod-ai/zenod/issues/711) | Planner / integration steward | phylax-ring-coordination-steward | P-11 coordinate Ring-owned seam changes | ready | #702 | `codex/epic-2.55-phylax-ring-coordination` | `c8fdb5b` | Ring changes filed/coordinated, not silently broadened. | Issue created. | 2026-07-09 23:55 CEST | Comment on Ring issues if worker discovers required Ring-owned changes. |

## Branch And Integration

- Default integration branch: `main`.
- Steward branch: `codex/epic-2.55-phylax-spine`.
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees.
- Cloud worktree rule: do not edit `/Users/jordi/Documents/GitHub/cloud` directly for Phylax tickets because it has existing dirty Ring work. Create `cloud-epic255-*` worktrees from the correct base branch and preserve existing changes.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available in named local/staging/cloud-test surface; acceptance validation in progress.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and this spine reconciled.
- Integration rule: do not leave completed work isolated on long-lived branches. Merge small reviewed PRs to `main` when checks pass.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Live Stripe or production cloud | Jordi | Any change to `cloud.zenod.dev`, `STRIPE_MODE=live`, live prices, or live webhook | Approve exact live action, key/price IDs, and environment | Local/cloud-test implementation |
| Managed WhatsApp/provider credentials | Jordi | Real provider credential, business number, webhook verification, or paid provider setup is needed | Provide TEST credential or approve mocked-provider acceptance for the pass | Mocked adapter, UI/API, contract tests |
| Product boundary change | Jordi / Ring planner | Work would move Ring routing or Zenod media ownership into Phylax | Approve revised scope or route to Ring/Zenod issue | Existing Phylax transport work |
| Production deployment / destructive action | Jordi | Dokploy production mutation, tenant deletion, volume teardown, secret rotation | Approve exact target and command | Read-only checks and dry runs |
| Experiential acceptance | Jordi | Full E2E is ready for human test | Confirm test account/provider details and perform/approve the walkthrough | Automated/browser prep |

## Recovery And Takeover

Stale assignment policy: no automatic timeout. Before takeover, verify issue state, branch, PR, latest commit, evidence, blocker, and next action; mark the previous assignment superseded in the issue and this table.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-09 23:55 CEST |

Recovery instructions:

- Start from this spine, then the assigned GitHub issue, then the branch/worktree named in the ledger.
- If the branch exists but no PR exists, inspect `git status`, `git log main..HEAD`, and issue comments before editing.
- If cloud work is needed, create a clean worktree; do not overwrite the dirty `/Users/jordi/Documents/GitHub/cloud` checkout.
- If implementation reveals a Ring-owned change, update #711 or the relevant Ring issue and record a proposed cross-spine update here.
- If implementation reveals a Zenod media boundary change, record it here and route to Epic 2.3 instead of implementing it in Phylax.

## Planner Queue

- Reconcile worker handoffs into this spine as issues move from ready to review/testing/done.
- Decide whether Phylax will deploy as its own runtime image immediately or as a bridge mode inside current fused runtime until unit extraction is complete.
- Decide what level of mocked-provider evidence is acceptable before real managed WhatsApp credentials exist.
- Coordinate with the Ring worker before changing any Ring routing/control-surface behavior.

## Worker Queue

- #705 public product page - paused with partial isolated work; validate before integration.
- #703 self-host unit docs/compose/runbook - paused before handoff.
- #704 runtime hosted Phylax APIs - paused with partial isolated settings scaffolding; complete routes/tests before integration.
- #707 hosted settings UI.
- #709 Stripe TEST checkout/provisioning.
- #706 signed hosted-entry.
- #708 managed WhatsApp provider adapter.
- #712 hosted Telegram channel.
- #710 Ring/Phylax seam tests.
- #711 Ring coordination.

## Tester Queue

- #710 local integration test validation once runtime seams land.
- #713 browser E2E on cloud-test once checkout/provision/settings/message path is deployed.
- Verify hosted UI contains no QR pairing affordance.
- Verify Phylax does not process/own Zenod media ingestion and does not route product decisions.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-09 | Initial audit | `c8fdb5b` | local zenod repo | Read required files and cloud hosted provisioning sources. | pass | Audit findings in Architecture section. |
| 2026-07-09 | GitHub board creation | `c8fdb5b` | GitHub `zenod-ai/zenod` | Created labels `epic:2.55`, `phylax` and issues #702-#713. | pass | Issue Ledger links. |
| 2026-07-09 | Spine structural validation | working tree from `c8fdb5b` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-2.55-PHYLAX-MOVE-0.md` | pass | `OK` |
| 2026-07-09 | Parallel dispatch batch 1 | `c8fdb5b` | multi-agent | Spawned workers Laplace (#705), James (#703), and Gibbs (#704). | running | Issue labels updated to `status:running`. |
| 2026-07-09 | Spine merged locally to main | `7c8dfd4` | local `main` | `git switch main && git merge --ff-only codex/epic-2.55-phylax-spine`; validator rerun. | pass | `docs/EPIC-2.55-PHYLAX-MOVE-0.md OK` |

## Handoff Journal

### 2026-07-09 - Epic worker - Phylax 2.55 spine created

Context: Jordi split Phylax into an independently purchasable hosted gateway while Ring work continues in Epic 2.5. The initial audit found useful runtime seams but no first-class Phylax hosted product in cloud.

Next: Validate this spine, update #702, and dispatch independent ticket workers from the ledger. Cloud workers must use clean worktrees because the local cloud checkout has existing dirty Ring changes.

Risks: Managed WhatsApp credentials may gate live provider proof; signed-entry must avoid accidentally reviving admin-password reveal; Ring routing scope must stay with Epic 2.5.

Assignment identity: Epic 2.55 Phylax steward

Branch / latest commit: `codex/epic-2.55-phylax-spine` at `c8fdb5b` plus working tree spine draft.

Last verified: 2026-07-09 23:55 CEST

Links:

- #702
- #705
- #703
- #704
- #707
- #709
- #706
- #708
- #712
- #710
- #713
- #711

### 2026-07-09 - Epic worker - First parallel worker batch dispatched

Context: The initial issue board was created and validated. Three non-overlapping workers were launched: Laplace owns public site files for #705, James owns self-host docs/compose/runbook for #703, and Gibbs owns runtime Phylax API/tests for #704.

Next: Monitor those issue handoffs before dispatching the next dependent batch: hosted settings UI (#707), cloud checkout/provisioning (#709), signed entry (#706), provider adapters (#708/#712), seam tests (#710), and E2E (#713).

Risks: #707 and #709 depend on the API shape from #704; cloud workers must use clean worktrees because the local cloud checkout has dirty Ring work.

Assignment identity: Epic 2.55 Phylax steward

Branch / latest commit: `codex/epic-2.55-phylax-spine` at `c8fdb5b` plus working tree spine draft.

Last verified: 2026-07-09 23:55 CEST

Links:

- #705
- #703
- #704

### 2026-07-09 - Epic worker - Steward work brought to main and workers paused

Context: Jordi asked to bring all steward work to `main` and stay there. The new Phylax spine was committed as `7c8dfd4` and fast-forwarded into local `main`. The first worker batch was interrupted and closed before integration.

Next: Stay on `main`. Resume #705 only after browser/mobile validation; resume #704 only after completing runtime routes/tests; re-dispatch #703 if self-host unit docs are still needed.

Risks: #705 and #704 have useful partial work in isolated worktrees, but neither is ready to merge. #703 closed before a useful handoff.

Assignment identity: Epic 2.55 Phylax steward

Branch / latest commit: `main` at `7c8dfd4` plus this reconciliation edit.

Last verified: 2026-07-09 23:55 CEST

Links:

- #702
- #705
- #703
- #704

## Open Questions

- Should hosted Phylax deploy a new minimal runtime image immediately, or initially bridge through the current fused runtime while exposing Phylax as a first-class cloud unit? Owner: Jordi / Phylax steward. Needed by: #709.
- Which managed WhatsApp/provider should be used for first real hosted testing, and are TEST credentials available? Owner: Jordi. Needed by: #708 and #713.
- Is mocked-provider E2E acceptable for first human testing before real provider credentials exist? Owner: Jordi. Needed by: #713.
- Should signed hosted-entry be cloud-console-only, tenant-UI-only, or support both? Owner: Phylax steward / cloud worker. Needed by: #706 and #707.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-09 | `docs/EPIC-2.5-ATOMIC-UNITS.md` | Note that Phylax now has child spine Epic 2.55 for independent hosted gateway purchasing/provisioning while Ring retains routing/control-surface scope. | This spine and #711. | Ring worker / Epic 2.5 steward | proposed |
| 2026-07-09 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Add Epic 2.55 as a real child epic using EpicSpine issue ledger. | This spine and #702. | Epic 0 Foundation planner | proposed |
| 2026-07-09 | Epic 2.3 Zenod spine | Reaffirm media ingestion remains Zenod-owned for Phylax media handles. | `packages/server/src/app.ts` mediaHandoff contract; this spine. | Epic 2.3 steward | proposed |

## Appendix

Relevant current implementation:

- `packages/server/src/phylaxGateway.ts`
- `packages/server/test/phylaxGateway.test.ts`
- `packages/server/src/app.ts`
- `packages/server/src/ringRouter.ts`
- `apps/web/src/components/ring-control-surface.tsx`
- `apps/web/src/views/settings/ConnectionsTab.tsx`
- `apps/web/src/components/whatsapp-connect.tsx`
- `apps/web/src/components/telegram-connect.tsx`
- `/Users/jordi/Documents/GitHub/cloud/services/webhook/src/server.ts`
- `/Users/jordi/Documents/GitHub/cloud/services/webhook/src/autoProvision.ts`
- `/Users/jordi/Documents/GitHub/cloud/services/webhook/src/accounts.ts`
- `/Users/jordi/Documents/GitHub/cloud/scripts/provision-ring.mjs`
