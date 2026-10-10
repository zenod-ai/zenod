# EPIC: Zenod MCP static token (dual auth on /mcp)

Spine profile: compact
Ticket backend: github
Spine dialect: v2
Acceptance surface: cli
Repository: zenod-ai/zenod
Primary document: docs/EPIC-ZENOD-MCP-STATIC-TOKEN.md
Spine ID: ZMT
Spine Type: branch
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
Integration branch: main
Integration policy: pr-approval

## Current State

Owner: delivery manager
Status: ready
Last attempted: Authored this spine and ran the bounded code-location search (2026-10-10).
Result: Spine drafted; code location resolved to zenod-ai/zenod (public repo, hosted customer layer), not the private zenod-ai/cloud repo. Issues are not minted yet (all ledger rows are `draft`).
Evidence: Bootstrap Map below; read-only search of this repo at `6f2a048`, `gh api repos/zenod-ai/cloud`, and local `cloud` checkout.
Waiting on: none
Approved work: Manager review of this spine, minting issues ZMT-1..ZMT-4, dispatching ZMT-1. No production deploy.
Next action: Delivery manager reviews this spine, resolves Open Questions Q1 and Q2, mints issues, and dispatches ZMT-1.
Source revision: `6f2a0484d890e0f4587073c25a33698fc1824192` (origin/main)
Verified at: 2026-10-10 Europe/Paris

## Mission

`/mcp` on `cloud.zenod.dev` accepts EITHER the existing OAuth access token (path unchanged) OR a user-created static MCP token tied to the same account, presented as `Authorization: Bearer <token>`. Reason: several Claude Code logins on one machine fight over one OAuth session, and headless clients cannot run a browser OAuth flow.

## Non-Goals

- Changes to the OAuth flow (authorize, token, DCR, refresh, PKCE) or its metadata documents.
- Tenant provisioning, billing, managed-AI metering, or entitlement rules.
- The old tenant host `z-jordi-f2c7a6.zenod.dev` (404s; ignored).
- Production deploy, live tenant data, or any real token in a PR, log or chat.

## Operating Learnings

- L-1 | writing or logging anything near a bearer credential | Redact `zmt_` and Bearer values in logs, errors and telemetry | leaked tokens are unrecoverable | confirmed 2026-10-10

## Definition Of Done

SHIP: the epic worker personally executes one journey on the `cli` surface against a local or staging instance and a synthetic account only. On the first failure, dispatch a scoped fix, rebuild, and restart from step 1, until one uninterrupted clean pass.

Evidence method: cli: exact commands (curl and MCP JSON-RPC), inputs, exit codes, status lines, headers and outputs recorded as a transcript in the PR, with tokens redacted.

- [ ] 1. `curl -i -X POST $BASE/mcp` with no Authorization returns 401, body `{"error":"unauthorized"}`, and `www-authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource", scope="mcp"` byte-identical to the pre-change transcript. (BUILD: regression baseline captured before the change)
- [ ] 2. Create an MCP token for the test account with label `ci-headless`; plaintext `zmt_...` is shown once; the list shows label, created date, last-used date and masked preview only. (BUILD)
- [ ] 3. MCP JSON-RPC `initialize` with `Authorization: Bearer zmt_...` returns 200 with server info. (BUILD)
- [ ] 4. `tools/list` with the same token returns 200 and the same tool set an OAuth session sees for that account. (BUILD)
- [ ] 5. `initialize` + `tools/list` with a valid OAuth access token for the same account returns 200 with the same identity and permissions; OAuth path unchanged. (BUILD)
- [ ] 6. Create a second token; both work; revoke the first; the revoked token returns 401 with the unchanged header and the second still returns 200. (BUILD)
- [ ] 7. Unknown token, malformed header (`Bearer` with no value, `Basic ...`) and missing header each return 401 with the unchanged header; repeated failures trip the rate limit (status recorded) without echoing the token. (BUILD)
- [ ] 8. Grep the instance log for the full plaintext token and for `zmt_` followed by a token body: zero matches. (BUILD)
- [ ] 9. Run the repo typecheck and test suite and record real exit codes and any failures. (BUILD)
- [ ] Test package: exact commit, environment (local or staging), commands and results, and remaining limits, so the human can reproduce the same journey.

HARDEN: deferred until the human approves SHIP.

- [ ] Optional token expiry and per-token scopes.
- [ ] Audit trail of token create/revoke events and per-token usage counters.
- [ ] Migrate the single tenant bearer flow to the same store.
- [ ] Production deploy and live smoke (human gate G2).

## Bootstrap Map

Search (2026-10-10, budget 15 minutes, about 10 minutes used). Scope: this repository at `6f2a048`; sibling checkout `/Users/jordi/Documents/GitHub/cloud` (stale: last commit 2026-07-09 / origin 6bdb318); `gh repo view zenod-ai/cloud` and `gh api repos/zenod-ai/cloud/contents` (read-only). Queries: `oauth-protected-resource`, `oauth/token`, `oauth/register`, `cloud.zenod.dev`, `requireMcpAuth`, `mcp_token`, `www-authenticate`.

Findings: cloud.zenod.dev is served by the Zenod hosted customer layer in THIS repo (`zenod-ai/zenod`, packages/server). `zenod-ai/cloud` is the private control plane (Stripe webhook, provisioner, metering; `services/webhook`, `services/console`); it holds the older account store and dashboard (`services/webhook/src/accounts.ts`, `server.ts`) that Epic 2.3 Z-2b used, and was transplanted into this repo (`customerAccounts.ts` header says "Transplanted from zenod-ai/cloud services/webhook/src/accounts.ts @ 6bdb318").

| Concern | Location |
|---|---|
| Hosted front door, `/mcp` bearer resolution, `/oauth/*` and `.well-known` mounting | `packages/server/src/zenodUnit.ts` (about lines 1280-1440: `app.all("*")` resolves a direct bearer via `tenantStore.resolveTokenHash(hashToken(...))`, falls back to `oauthStore.resolveOAuthAccessToken`, then applies hosted entitlement) |
| OAuth resource server (metadata, `wwwAuthenticate`, authorize, token, register) | `packages/server/src/oauth.ts` (lines 40-54 metadata and challenge; self-host) and `packages/mcp-chassis/src/oauth.ts` (lines 245-287 routes, used by the hosted unit) |
| Self-host `/mcp` middleware | `packages/server/src/auth.ts` `requireMcpAuth` (lines 109-124), mounted at `packages/server/src/app.ts:2941` |
| Chassis tenant auth, hash-only token store, `hashToken` | `packages/mcp-chassis/src/index.ts` (`TenantTokenStore`, `hashToken` line 394, `requireTenantAuth`), `packages/mcp-chassis/src/sqliteTenantStore.ts` |
| Account store (`mcp_token` field) | `packages/server/src/customerAccounts.ts` (`mcp_token: string \| null`, line 37); plaintext per-account token lives in `packages/server/src/customerTokenVault.ts` (encrypted envelope); `customerTenantBinding.ts` sets `mcp_token: null` |
| Dashboard (account page) | `apps/web/src/views/HostedAccount.tsx`, `apps/web/src/views/DashboardOverview.tsx`; customer API in `packages/server/src/customerLayer.ts` (mcp_url at lines 1336 and 1389) |

Important mismatch with the owner's brief: in this repo `/mcp` on the hosted host is not gated by `requireMcpAuth`; that middleware is the self-host path (static `ZENOD_API_TOKEN`, OAuth, admin cookie). The hosted path already accepts one tenant-scoped bearer per tenant through `tenantStore`, and `mcp_token` is nulled in the account row (the token is in the vault). ZMT must therefore add the user-created multi-token store to the hosted resolution path in `zenodUnit.ts` and keep `requireMcpAuth` behavior unchanged for self-host unless D3 says otherwise.

Unsearched: production deployment config and image build (which entrypoint runs on cloud.zenod.dev), live HTTP probes of the production host (not performed; no live data), the private `zenod-ai/cloud` repo contents beyond the top-level listing and the stale local checkout, `services/console` internals, and the Phylax/other unit modes.

Required reads for workers: `docs/EPIC-2.3-ZENOD-MOVE-0.md` (Z-2b: `account.mcp_token` set at provision, `GET /api/token`, `requireMcpAuth` 401 `{"error":"unauthorized"}`), `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md` (deployment boundary), the files in the table above.

Verified facts (owner brief, 2026-10-10): protected-resource metadata is `{"resource":"https://cloud.zenod.dev/mcp","authorization_servers":["https://cloud.zenod.dev"],"scopes_supported":["mcp"],"bearer_methods_supported":["header"]}`. Authorization-server metadata advertises `/oauth/authorize`, `/oauth/token`, `/oauth/register` (DCR), authorization_code + refresh_token, PKCE S256, public clients. Unauthenticated `POST /mcp` returns 401 with `www-authenticate: Bearer resource_metadata="https://cloud.zenod.dev/.well-known/oauth-protected-resource", scope="mcp"`.

## Acceptance Criteria (epic level)

1. Middleware tries OAuth first, then the MCP token store; both resolve to the same account identity and permissions; invalid or revoked tokens get 401; the `www-authenticate` header is unchanged.
2. Hash-only storage (SHA-256 or stronger), constant-time compare, plaintext shown once, `zmt_` prefix.
3. Dashboard create, label, list and revoke; several tokens per account; each row shows label, created date, last-used date and a masked preview.
4. Tokens are never logged (redacted in logs, errors and telemetry); failed attempts are rate-limited.
5. No regression in OAuth login, DCR, refresh, or tenant `requireMcpAuth`.
6. Tests: unit tests for valid OAuth, valid MCP token, revoked, unknown, malformed header and missing header; integration on a local or staging instance (initialize + tools/list succeed with an MCP token and return 401 without one); a transcript of the 401 `www-authenticate` header unchanged; repo typecheck and tests reported honestly. Stop at a PR with test evidence.

## Issue Ledger

Waves (disjoint write surfaces): W1 = ZMT-1; W2 = ZMT-2 and ZMT-3 in parallel after ZMT-1 merges; W3 = ZMT-4. Per-ticket budget 90 minutes.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | ZMT-1 · BUILD (no suitable source found in recorded scope; reuse `hashToken` and sqlite store patterns from `packages/mcp-chassis/src/sqliteTenantStore.ts`): MCP token store (multi-token table per account, `zmt_` mint, SHA-256 hash-only, label, created/last-used, revoke, constant-time verify). Write surface: new `packages/server/src/mcpTokenStore.ts` + tests. | draft | none | `zmt-1-token-store` | origin/main | none | 2026-10-10 | Manager mints issue and dispatches after Q1/Q2 are answered. |
| draft | Ticket worker | unassigned | ZMT-2 · BUILD (extends existing dual-resolution in `zenodUnit.ts`): `/mcp` dual auth (OAuth first, then MCP token store, same account identity), 401 with unchanged `www-authenticate`, log/error redaction, failed-attempt rate limit, unit tests (valid OAuth, valid token, revoked, unknown, malformed, missing). Write surface: `packages/server/src/zenodUnit.ts`, new redaction/rate-limit helper and tests. | draft | ZMT-1 | `zmt-2-dual-auth` | origin/main after ZMT-1 | none | 2026-10-10 | Wait for ZMT-1 merge. |
| draft | Ticket worker | unassigned | ZMT-3 · BUILD (follows existing `HostedAccount.tsx` patterns): dashboard create/label/list/revoke, once-only plaintext display, masked preview, plus customer API routes. Write surface: `apps/web/src/views/HostedAccount.tsx` (or a new component) and new routes in `packages/server/src/customerLayer.ts`. | draft | ZMT-1 | `zmt-3-dashboard` | origin/main after ZMT-1 | none | 2026-10-10 | Wait for ZMT-1 merge. |
| draft | Tester | unassigned | ZMT-4 · BUILD (no suitable source found in recorded scope): integration verification on a local/staging instance, 401 header transcript, regression run (OAuth login, DCR, refresh, tenant `requireMcpAuth`), PR evidence. Write surface: test scripts under `packages/server/test/` and the issue/PR evidence only. | draft | ZMT-2, ZMT-3 | `zmt-4-verify` | origin/main after ZMT-2 and ZMT-3 | none | 2026-10-10 | Wait for ZMT-2 and ZMT-3. |

## Decisions

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| 2026-10-10 | accepted | D1 · Token format and storage | `zmt_` prefix plus at least 32 random bytes (base64url); only a SHA-256 (or stronger) hash is stored; plaintext returned once at creation; constant-time compare. | Owner brief | Never without security review |
| 2026-10-10 | accepted | D2 · Auth order | OAuth access token first (path unchanged), then MCP token store; a failed OAuth lookup must not weaken or alter the OAuth path. | Owner brief | none |
| 2026-10-10 | accepted | D3 · Challenge unchanged | The 401 body and `www-authenticate` header stay byte-identical to the current output for every failure case. | Owner brief | none |
| 2026-10-10 | accepted | D4 · Trap: no tokens in logs | Redact tokens in logs, errors and telemetry; never put a real token in a PR, log or chat; use synthetic accounts for tests. | Owner brief | none |
| 2026-10-10 | accepted | D5 · Scope boundary | Only the Zenod production image deploys from this repo; ZMT stops at a PR with test evidence. No live tenant data. | `AGENTS.md` production boundary | Human gate G2 passes |
| 2026-10-10 | accepted | D6 · Code location | Work happens in `zenod-ai/zenod` (hosted customer layer), not `zenod-ai/cloud`. | Bootstrap Map search | Evidence of another serving repo |

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| G1 · Open questions Q1 and Q2 | Jordi | Before ZMT-1 dispatch | Answer Q1 (reuse vs replace `mcp_token`) and Q2 (hosted vs self-host scope) | Spine edits, issue minting |
| G2 · Production deploy | Jordi | PR merged and ready to go live | Approve deploying the Zenod production image at a named SHA | Local/staging verification, PR evidence |
| G3 · Live tenant data and real tokens | Jordi | Any step needing real account data or a real token | Explicit approval of the exact action | Synthetic-account work only |

## Open Questions

- Q1 (blocks ZMT-1): Is the existing single per-account `mcp_token` (tenant bearer in the vault, `mcp_token: null` in the account row today) kept as is and a new multi-token table added beside it, or replaced by the new table? Recommendation: add a new table; leave the tenant bearer untouched (non-goal: tenant provisioning).
- Q2 (blocks ZMT-2 scope): Should the MCP token also be accepted by self-host `requireMcpAuth` in `packages/server/src/auth.ts`, or only the hosted `cloud.zenod.dev` path in `zenodUnit.ts`? Recommendation: hosted path only; self-host already has a static `ZENOD_API_TOKEN`.
- Q3: The brief says "Tenants already do static bearer auth (`requireMcpAuth`)"; the hosted path actually uses `tenantStore`. Confirm the brief's intent is "same permissions as the tenant bearer," which D2 assumes.
- Q4: Rate-limit convention (429 plus `Retry-After`, per IP or per token prefix) and limits are unspecified; the worker proposes defaults in ZMT-2 for manager approval.
