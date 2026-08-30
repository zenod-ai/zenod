# Epic GDV · Google identity and Google Drive-only vaults

Status: ready for credential-backed human acceptance
Created: 2026-08-29
Updated: 2026-08-30
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md`
Integration branch: `main`
Planning branch: `codex/google-drive-vault-epic` merged by PR #1155
Planning base: `bcd64987f061a9e622cb88796f1d52781a006109` (`origin/main`)
Last reconciled commit: `0ca15e8a6c4e853896a5854dbbfa5e3fe5861a6e` on `main`
Active spine steward: Google Drive Vault delivery manager (`Jordi + current bound Codex task`)
Planner: Jordi + Codex
Epic worker: `/root` Google Drive Vault delivery manager
Tester: `/root/gdv_10_acceptance_worker`

## Role Bindings

| Identity | Assignment Identity | Bound Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Project/root coordination | Read this spine and roll up its relationship to the active production-gate child; do not rewrite this child by default. | Root child map and cross-epic dependencies current. |
| Planner | Google Drive Vault planner | This spine and its issue board | Own target, scope, acceptance, dependency order, issue materialization and initial dispatch. | Coherent spine, linked issues and first ready batch. |
| Epic worker | `/root` | This entire epic | Steward this spine, dispatch one worker per issue, reconcile PRs and exact-main evidence, and deliver epic acceptance. | Google-only stranger journey ready for Jordi's test or precisely blocked. |
| Ticket worker | one stable identity per GDV issue | One linked GitHub issue | Work only the bound issue in a dedicated branch/worktree; write implementation detail and handoff to GitHub. | PR, latest commit, validation, blocker and next action recorded in the issue. |
| Tester | unassigned | GDV-10 release acceptance | Validate exact integrated commit and named environment; do not broaden product scope. | Reproducible pass/fail packet and residual risks. |

## Write Scope

Bound spine: `docs/EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md`

Writable by default:

- The active Google Drive Vault delivery manager reconciles and commits this spine.
- Ticket workers and testers write detailed execution state to their bound GitHub issues and notify the steward.
- No ticket worker may independently change mission, Drive-only authority, receipt semantics, migration policy or epic acceptance.

Read-only linked spines unless separately delegated:

- `docs/EPIC-0-FOUNDATION-SPINE.md` — project direction and child-spine rollup.
- `docs/EPIC-P-PHYLAX-SPRINT.md` — active production/configuration gate and channel-service boundary.
- `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` — deployed Hosted baseline, billing/onboarding history and existing tenant-owned Drive authority.
- `docs/EPIC-MECHANICAL-CAPTURE.md` — evidence immutability, capture and retrieval behavior.

Cross-spine rule: record proposed rollups here and ask the appropriate steward to apply them. This epic must not silently change production configuration, deploy, open signup, rotate tokens, alter live Google grants or disturb the current Phylax release gate.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This spine | Product target, Drive-only meaning, epic acceptance, dependencies, decisions and rollup state |
| Linked GitHub issue | Detailed implementation state for one GDV ticket |
| Branch / PR / code | Behavior actually implemented |
| Validation evidence | Behavior proved against an exact commit and environment |
| Existing production spines | Current deployed behavior, gates and rollback truth |

## Mission

Allow a person with no GitHub account to sign in with Google, subscribe, create a user-owned Zenod Markdown vault in ordinary Google Drive, and use the complete Zenod memory loop through web, MCP and supported phone channels. For a Drive-only tenant, Google Drive is the sole durable authority for vault files and their Git history: Zenod translates its existing local filing transaction into recoverable Drive file saves plus a bundled real Git repository, without creating a GitHub repository or remote.

## Target Experience

The required uninterrupted Hosted journey is:

1. Visit `zenod.dev` without a GitHub account.
2. Choose **Continue with Google** and authenticate with `openid email profile` only.
3. Subscribe to the existing Zenod Hosted offer.
4. Choose **Google Drive** as the authoritative vault provider.
5. Grant separate offline `drive.file` authorization.
6. Zenod creates or recovers one visible, private, user-owned `Zenod Vault` folder in My Drive.
7. Zenod seeds the normal Markdown schema and exposes a working web/MCP/channel memory tenant.
8. A stored memory creates/updates ordinary Markdown files in Drive, records a real Git commit in an app-created `.git/repository.bundle`, and returns a Drive revision/save receipt with Drive links plus the real commit SHA.
9. A restart reconstructs the working cache and local `.git` entirely from Drive and preserves history, diff, rollback, search, get, ask, store and evidence immutability.
10. The user can continue forever without GitHub. GitHub remains an optional identity, vault and code-tasking integration.

## Definition Of Done

- [x] Google OIDC identity works without requesting Drive access during sign-in.
- [x] Accounts, sessions, checkout, Stripe reconciliation, tenant binding, usage, Channels and admin lookup use an internal provider-neutral user/account identity.
- [x] Every existing GitHub customer retains the same account ID, tenant ID, subscription binding, MCP token, GitHub App installation and vault behavior.
- [x] The core engine depends on a repository-shaped provider-neutral vault contract while the filing, Markdown, lint, search, evidence and work flows remain shared.
- [x] The GitHub adapter preserves current clone/pull/diff/commit/push behavior and current receipts.
- [x] The Google Drive adapter maintains an app-created ordinary Markdown tree and recoverable `.git/repository.bundle` using `drive.file`, with Drive as the only durable vault/history authority.
- [x] Drive publication has optimistic concurrency, a durable transaction journal, idempotent recovery and no false-success path for partial multi-file saves.
- [x] Store/search/get/ask, attachments, ingestion, MCP, web and supported phone paths return provider-neutral citations and revision receipts.
- [x] GitHub-only issue/code/tasking capabilities are gated without disabling memory for Drive-only users.
- [x] The public site, Hosted onboarding, account/vault UI, legal/privacy disclosures, readiness checks and operator runbook describe both supported providers truthfully.
- [x] Exact integrated commit `0ca15e8` passes the deterministic local/fake-provider Google-only, restart, conflict, interrupted-save, revocation and two-tenant-isolation matrix; the uninterrupted credential-backed browser journey remains a named human gate.
- [x] Existing GitHub and self-host acceptance suites regress green.
- [x] No production deploy, live OAuth mutation, real-card billing, existing-tenant migration or public-signup change occurred; each remains separately gated.

## Non-Goals

- Scanning or indexing the user's whole Drive.
- Requesting restricted `drive` or `drive.readonly` scopes for Hosted v1.
- Treating native Google Docs as canonical Markdown files.
- Supporting concurrent dual-write to GitHub and Drive.
- Automatically switching an existing tenant's authoritative vault provider.
- Silently linking accounts by matching email addresses.
- Fabricating a 40-character commit hash from a Drive revision or transaction ID. Drive may report only a real Git commit that exists in its durable bundle.
- Making every GitHub issue, PR or code-execution feature work without a separately connected GitHub identity.
- Moving billing records, OAuth refresh tokens, channel journals, usage ledgers or other operational state into Drive.
- Claiming that all user message content exists only in Drive; this epic makes the **vault files** Drive-authoritative. A stricter operational-data-retention contract would be a separate privacy epic.
- Changing the existing €9 Hosted offer, managed-usage contract, Zenod/Phylax service boundary or production topology.

## Current State

Phase: Deterministic local release acceptance complete; credential-backed staging requires human approval
Last verified: 2026-08-30 CEST
Integration target: `main`
Fresh base commit: `0ca15e8a6c4e853896a5854dbbfa5e3fe5861a6e` on `main`
Control-plane merge: [PR #1155](https://github.com/zenod-ai/zenod/pull/1155), merged as `a4c4826f80ed0acda93d304f21cb50129d7fb2dd`
Current production relationship: additive sibling epic. The active Phylax/configuration gate remains authoritative for production and is not modified here.
Next action: Jordi/operator approves the exact Google Cloud project, OIDC/Drive clients, callbacks, branding/scopes and a disposable credential-backed staging environment; then execute the uninterrupted Google-only browser/Drive/phone acceptance against one pinned image. Deployment, billing and public signup remain separate later approvals.
Blockers: deterministic source/local acceptance has no blocker and is complete. Credential-backed staging is blocked on the named Google Cloud configuration and test-environment approval; production deployment, billing and public signup remain separate human gates.

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md` | Binding target, decisions, issue ledger, acceptance and next action. | Always |
| 2 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Project direction, child-spine coordination and current production relationship. | Planner / epic worker |
| 3 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Current production gates and the independent channel boundary that must not be disturbed. | Runtime, rollout or phone acceptance work |
| 4 | `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Existing customer journey, billing/account code, tenant-owned Drive and release evidence. | Identity, onboarding, migration or acceptance work |
| 5 | `packages/core/src/git/vaultRepo.ts` | Current repository-shaped git transaction and local workspace behavior. | GDV-4, GDV-5, GDV-6 |
| 6 | `packages/core/src/engine/engine.ts` and `packages/core/src/types.ts` | Direct vault dependency and git-shaped receipt/citation contracts. | GDV-4, GDV-5 |
| 7 | `packages/server/src/drive.ts`, `driveTools.ts`, `ingestQueue.ts` | Existing Drive OAuth/client, archive and source behavior to reuse without conflating archive and vault folders. | GDV-3, GDV-6, GDV-7 |
| 8 | `packages/server/src/customerIdentity.ts`, `customerSession.ts`, `customerAccounts.ts`, `customerLayer.ts` | Current GitHub-specific identity, session, account and customer routing. | GDV-2, GDV-3, GDV-8 |
| 9 | `packages/server/src/customerBilling.ts`, `customerTenantBinding.ts`, `productionReadiness.ts` | GitHub-derived checkout/tenant binding and rollout gates. | GDV-2, GDV-7, GDV-10 |
| 10 | `packages/server/src/peerClient.ts`, `mcp.ts`, `storageReceipt.ts`, `filingReceipt.ts` | Consumers that currently require git hashes or GitHub URLs. | GDV-5, GDV-9 |
| 11 | `apps/web/src/views/HostedLogin.tsx`, `HostedAccount.tsx`, settings vault/connection views | Google sign-in, provider selection and truthful customer presentation. | GDV-3, GDV-8 |
| 12 | Google OAuth/OpenID and Drive `drive.file` documentation | Stable identity subject, separate consent and least-privilege file authority. | Identity/Drive design and security review |

## Architecture And Context

### Preserve the filing flow

The current engine edits a local Markdown workspace, inspects pending changes, enforces evidence immutability, and ends with `commitAndPush`. The target retains that entire flow behind a repository-shaped interface. The only generalization is the final publication result:

```ts
interface VaultRepository {
  readonly path: string
  readonly provider: "github" | "google_drive"

  pull(): Promise<void>
  trackedFiles(): Promise<string[]>
  contentAtHead(path: string): Promise<string | null>
  pendingChanges(): Promise<FileChange[]>
  discardChanges(): Promise<void>
  commitAndPublish(message: string): Promise<VaultRevision>
  urlFor(path: string, anchor?: string): string | null
}

interface VaultRevision {
  provider: "github" | "google_drive"
  id: string
  committedAt: string
  urls: string[]
  commitSha?: string
  githubUrls?: string[]
}
```

The GitHub adapter wraps the current `VaultRepo` and populates legacy fields. The Drive adapter may use an ephemeral local git repository or equivalent snapshots to preserve diff/reset behavior, but that local mechanism is rebuildable cache only. It is never a durable remote or customer-facing source of truth.

### Drive vault shape

```text
Zenod Vault/
├── Log/
├── Areas/
├── Projects/
├── Resources/
├── Inbox/
├── _attachments/
└── .zenod/
    ├── manifest.json
    └── transactions/
```

- Every canonical note is an ordinary `.md` file, not a native Google Doc.
- Attachments retain their original bytes and names under `_attachments/`.
- The Google user owns all files and pays their Drive quota.
- Zenod records stable Drive file IDs separately from display paths so renames can be reconciled.
- The app-created folder and files use non-sensitive `drive.file` access.
- A user may edit existing app-created Markdown files through Drive sync. Arbitrary pre-existing or newly external files require explicit Picker/import authorization unless Google documents inherited app authorization for that exact case.
- The existing archive/export folder remains distinct from the authoritative vault folder and cannot be silently repurposed.

### Drive transaction boundary

Drive has no multi-file commit, so `commitAndPublish` owns the translation:

1. Synchronize the manifest and authorized file revisions into the local workspace.
2. Capture the base Drive version/modified-time/checksum for every affected file.
3. Validate the same pending changes and evidence immutability rules used by git.
4. Write a durable pending transaction record before the first remote mutation.
5. Create, update, move or delete authorized Drive files with optimistic concurrency checks.
6. Persist per-file completion so retries are idempotent.
7. Finalize the manifest and transaction only after all required files reconcile.
8. Return one `VaultRevision` only after finalization; otherwise throw a typed unknown/failed outcome.
9. On restart, reconcile every non-terminal transaction before accepting another write.

The transaction layer must distinguish failed-before-write, partially-applied/recovering, committed and conflict states. It must never call a partial upload a successful store.

### Provider-neutral identity

Accounts gain an internal stable user ID and linked identities:

```text
users(id, display_name, avatar_url, created_at)
identities(user_id, provider, provider_subject, email, email_verified)
```

- Google uses the verified OIDC `sub`; GitHub uses the numeric GitHub user ID.
- Email is display/contact metadata, never the account key or an automatic linking authority.
- Sessions contain the internal user/account ID, not `github_id`.
- Existing `github-*` account IDs, tenant IDs, Stripe metadata, subscriptions and MCP tokens remain stable and are mapped into the new identity table.
- Linking Google and GitHub requires a current authenticated session plus proof of control of the second identity.

### Separate consent

- **Continue with Google:** `openid email profile`; creates/authenticates the customer identity only.
- **Create or connect Zenod Vault in Drive:** offline `drive.file`; creates or recovers the tenant-bound Drive vault.

The login button must not request file access. Drive disconnection revokes Zenod's ability to operate but never deletes the user's files. The runtime fails closed with a reconnect state.

### One authoritative backend

Each tenant has one active `vault_provider` and corresponding provider binding. GitHub and Drive are both supported, but v1 does not dual-write. Connecting a second provider never silently migrates or forks memory. Import/export/provider switching is separately gated future work.

### Capability boundary

Memory operations are provider-neutral. GitHub issue, PR and code-repository operations require a separately connected GitHub capability and are hidden or return a typed `github_connection_required` result for Drive-only users. A missing GitHub connection must never make store/search/get/ask unavailable.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-08-29 | Support both Google sign-in and a complete Google Drive-only Zenod journey. | Many prospective users do not have GitHub accounts; Google sign-in that still requires GitHub storage does not solve onboarding. | Jordi's direction in the planning conversation |
| 2026-08-29 | Make Drive the sole durable vault authority for Drive-only tenants. | The product must be capable of operating forever without creating or maintaining a GitHub repository. | Jordi's clarification that Zenod may maintain only on Drive |
| 2026-08-29 | Preserve the existing local Markdown filing flow behind a repository-shaped adapter. | Classification, evidence, lint, search and filing logic already work; Drive should translate the final publication boundary instead of causing an engine rewrite. | Accepted adapter design in the planning conversation |
| 2026-08-29 | Return a provider-neutral revision/save result; never fake a git commit. | A Drive transaction ID is valid provenance, but representing it as a Git SHA would corrupt API and user truth. | Existing `commitSha`/GitHub coupling audit |
| 2026-08-29 | Use separate Google identity and Drive authorization flows. | Login does not require file access, and Drive needs offline tenant-scoped authorization only after storage selection. | Google OIDC and Drive least-privilege model |
| 2026-08-29 | Use `drive.file` and an app-created user-owned vault for Hosted v1. | It supports the required owned Markdown tree without granting Zenod access to the user's entire Drive. | Existing least-privilege Hosted Drive implementation and Google guidance |
| 2026-08-29 | Preserve existing external IDs during migration. | Renaming GitHub-derived account/tenant/Stripe bindings creates unnecessary billing, entitlement and credential risk. | Current customer-account and billing implementation |
| 2026-08-29 | Keep one authoritative backend and no automatic provider migration in v1. | Dual-write and silent switching create split-brain and conflict semantics beyond the required Google-only journey. | Planner risk review |
| 2026-08-29 | Add `currentRevision(): Promise<VaultRevision>` and stage GDV-4 foundation → GDV-5 receipts/citations → remaining GDV-4 engine conversion. | The engine needs truthful current durable provenance, while legacy mandatory `commitSha`/GitHub URL results cannot represent Drive. Staging removes the circular dependency without fabricating git semantics. | Jordi's explicit “yes continue” approval after the named GDV-4 gate |
| 2026-08-29 | Keep real Git history inside Drive authority as one recoverable bundle, not as loose synchronized `.git` internals. | Git needs filesystem locking and atomic object/ref updates that Drive's independent file API does not provide. An app-created `.git/repository.bundle` is one verifiable blob that can reconstruct local `.git`, while ordinary Markdown stays visible and Drive remains the only remote authority. | Jordi's direction to add `.git` inside Drive for a near-GitHub history experience; safe bundle form follows the existing final-publication adapter |
| 2026-08-29 | Drive receipts may carry dual provenance: authoritative Drive revision/transaction `id` plus optional real bundled Git `commitSha`; never derive one from the other. | The Drive transaction proves remote durability, while the commit identifies the exact Git tree/history. Keeping both prevents false Git semantics and supports diff/rollback. `githubUrls` remain absent for Drive. | Updated Git-bundle storage decision |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [GDV-1 #1145](https://github.com/zenod-ai/zenod/issues/1145) | Planner / architect | `/root/gdv_1_contract_worker` | Freeze provider-neutral identity, vault and compatibility contract | complete | - | [PR #1158](https://github.com/zenod-ai/zenod/pull/1158) / `codex/gdv-1-contract` | `d48e48d` on `main` | Executable interfaces, migrations, failure algebra and compatibility fixtures are accepted before implementation. | Exact head `970d931` independently reviewed clean; full CI passed; squash merged as `0b5aa62`. | 2026-08-29 | Preserve contract during dependent work. |
| [GDV-2 #1146](https://github.com/zenod-ai/zenod/issues/1146) | Ticket worker | `/root/gdv_2_identity_worker` | Generalize customer identity and account ownership | complete | #1145 | [PR #1161](https://github.com/zenod-ai/zenod/pull/1161) / `codex/gdv-2-provider-neutral-identity` | `0b5aa62` on `main` | Existing GitHub accounts preserve IDs while sessions/account/billing/tenant/Channels resolve through internal identity. | Two P1 lifecycle/security findings fixed; exact head `9b528e7` re-reviewed clean and full CI passed; merged as `45c9722`. | 2026-08-29 | Preserve stable owner mappings and provider-scoped login metadata in GDV-3. |
| [GDV-3 #1147](https://github.com/zenod-ai/zenod/issues/1147) | Ticket worker | `/root/gdv_3_google_signin_worker` | Add Google OIDC sign-in and secure account linking | complete | #1145, #1146 | [PR #1163](https://github.com/zenod-ai/zenod/pull/1163) / `codex/gdv-3-google-signin` | `45c9722` on `main` | Google login uses verified OIDC subject, requests no Drive scope, and safely creates/links sessions. | Four adversarial review findings fixed; exact head `20d3f49` re-reviewed clean and full CI passed; merged as `fe057ad`. | 2026-08-29 | Live credentials/browser-provider smoke remain later human gates; preserve identity contract in GDV-7/8. |
| [GDV-4 #1148](https://github.com/zenod-ai/zenod/issues/1148) | Ticket worker | `/root/gdv_4_repository_worker` | Extract repository-shaped provider-neutral vault interface | complete | #1145; approved staged sequence; #1149 | [completion PR #1171](https://github.com/zenod-ai/zenod/pull/1171); [foundation PR #1166](https://github.com/zenod-ai/zenod/pull/1166) | `f988dac` on `main` | Existing GitHub behavior runs through `VaultRepository` with no acceptance regression; a fake non-Git backend runs the complete core memory loop without GitHub semantics. | Exact head `edcf1f4` passed full CI and independent adversarial review after Drive URL/backlog provenance fixes; merged as `d77ea43`. | 2026-08-29 | Preserve the interface/fail-closed URL boundary in GDV-6. |
| [GDV-5 #1149](https://github.com/zenod-ai/zenod/issues/1149) | Ticket worker | `/root/gdv_5_receipts_worker` | Generalize revisions, citations and receipts | complete | #1145, GDV-4 foundation slice | [PR #1168](https://github.com/zenod-ai/zenod/pull/1168) / `codex/gdv-5-provider-neutral-receipts` | `8ab04a6` on `main` | Core/MCP/jobs/peers/UI accept Drive revisions and generic URLs while GitHub legacy fields remain compatible; Drive may include only a real bundled Git SHA and never GitHub URLs. | Exact head `7b8aded` passed full CI and independent adversarial review after async, peer, backlog, placeholder and dual-provenance fixes; merged as `b136556`. | 2026-08-29 | Preserve truthful dual provenance during GDV-4/GDV-6. |
| [GDV-6 #1150](https://github.com/zenod-ai/zenod/issues/1150) | Ticket worker | `/root/gdv_6_drive_backend_worker` | Implement recoverable Google Drive vault repository and bundled Git history | complete | #1145, #1148, #1149 | [PR #1173](https://github.com/zenod-ai/zenod/pull/1173) / `codex/gdv-6-drive-vault-backend` | `8f597f3` on `main` | Drive sync/save/restart/conflict/recovery operates on app-created Markdown plus `.git/repository.bundle`, with no GitHub remote and no false success. | Exact head `9f66c37` passed full CI and independent review after authority-isolation, cold-bundle, external-race, bootstrap and replay-state fixes; merged as `16605cf`. | 2026-08-29 | Preserve the fail-closed authority and bootstrap state/tree invariants in GDV-7. |
| [GDV-7 #1151](https://github.com/zenod-ai/zenod/issues/1151) | Ticket worker | `/root/gdv_7_runtime_worker` | Bind Drive credentials, backend selection and tenant runtime | complete | #1146, #1147, #1150 | [PR #1175](https://github.com/zenod-ai/zenod/pull/1175) / `codex/gdv-7-drive-tenant-runtime` | `4d34d4a` on `main` | Paid Drive-only tenant provisions, reconstructs and fails closed on revoked consent without GitHub. | Exact head `6232b18` passed full CI and clean independent review after OAuth, authority, epoch, credential-isolation, entitlement and Phylax-boundary fixes; merged as `2d8c28c`. | 2026-08-29 | Preserve tenant/account authority separation and authorization-epoch fencing in GDV-8/9. |
| [GDV-8 #1152](https://github.com/zenod-ai/zenod/issues/1152) | Ticket worker | `/root/gdv_8_onboarding_worker` | Deliver Google-first onboarding and provider-aware account UI | complete | #1146, #1147, #1149, #1151 | [PR #1177](https://github.com/zenod-ai/zenod/pull/1177) / `codex/gdv-8-google-onboarding` | `3dd2763` on `main` | Public/login/checkout/vault/account flow is truthful and complete at supported responsive sizes. | Exact head `e461938` passed full CI and independent review after callback-query, authority-fallback, no-false-ready and provider-copy fixes; merged as `1cf01a3`. | 2026-08-30 | Preserve scrubbed callback and verified-runtime readiness behavior in GDV-10. |
| [GDV-9 #1153](https://github.com/zenod-ai/zenod/issues/1153) | Ticket worker | `/root/gdv_9_capabilities_worker` | Capability-gate GitHub-only operations and update public/operator contracts | complete | #1148, #1149, #1151 | [PR #1178](https://github.com/zenod-ai/zenod/pull/1178) / `codex/gdv-9-capabilities-and-contracts` | `3dd2763` on `main`; final head includes `1cf01a3` | Drive-only memory is complete; GitHub issue/code tools fail typed and copy/legal/readiness/runbooks match reality. | Exact head `663ed7e` passed full CI and independent review after public-gate, build-evidence, tenant-installation, token-cache, remote-revocation and PAT-fallback fixes; merged as `536a85c`. | 2026-08-30 | Preserve App-only Drive tasking and default-closed public Google signup in GDV-10. |
| [GDV-10 #1154](https://github.com/zenod-ai/zenod/issues/1154) | Tester / integrator | `/root/gdv_10_acceptance_worker` | Prove Google-only release acceptance and GitHub regression | complete / local | #1146 through #1153 | [PR #1180](https://github.com/zenod-ai/zenod/pull/1180) / `codex/gdv-10-release-acceptance` | `3802672` on `main` | Full no-GitHub journey, restart, conflict, partial failure, revocation, isolation and GitHub regression pass with durable evidence. | Exact head `4783239` passed the clean-head 364-test acceptance runner, 2,274 full-suite assertions plus 6 skips, full CI and independent review; merged as `0ca15e8`. | 2026-08-30 | Await approval for the separately named credential-backed staging gate; do not deploy or open signup. |

## Ticket Contracts

### GDV-1 · Freeze provider-neutral identity, vault and compatibility contract

Objective: turn this target into exact TypeScript, persistence and failure contracts before broad implementation.

Scope:

- Define `VaultRepository`, `VaultRevision`, generic source/citation types and typed publication outcomes.
- Define the user/identity/account/provider-binding schema and migration invariants.
- Define one-authoritative-backend rules and backend readiness/capability projection.
- Specify Drive transaction states, idempotency keys, optimistic concurrency and recovery behavior.
- Produce compatibility fixtures for current GitHub store/search/get/ask, MCP structured results and peer receipts.

Acceptance:

- Contract tests compile both GitHub and stub Drive adapters.
- No current GitHub field is removed before a tested compatibility path exists.
- Existing account, tenant, Stripe and MCP identifiers are explicitly frozen.
- Failure outcomes distinguish conflict, revoked authorization, partial/recovering and terminal failure.

### GDV-2 · Generalize customer identity and account ownership

Objective: remove GitHub ID as the universal customer primary key without changing existing customer identity.

Scope:

- Add internal user identity and provider link persistence using the repository's established durable-store pattern.
- Migrate signed sessions and all customer/account lookups to internal identity.
- Generalize checkout owner, Stripe metadata resolution, tenant binding, usage, Channels, admin and tester allowlist seams.
- Lazily or explicitly map legacy GitHub accounts without renaming external identifiers.

Acceptance:

- Existing signed GitHub account journey and webhook fixtures remain green.
- A non-GitHub identity fixture can own checkout/account/tenant records.
- Cross-provider subject collisions and email matches cannot merge accounts.
- Rollback reads legacy account data safely.

### GDV-3 · Add Google OIDC sign-in and secure account linking

Objective: make Google a first-class identity provider independent of Drive storage consent.

Scope:

- Implement authorization-code OIDC with state, nonce, exact redirect URI and ID-token signature/issuer/audience/expiry validation.
- Use verified `sub` as provider subject; store verified email and profile metadata only as attributes.
- Add provider-specific start/callback routes and provider-neutral `/api/me`/auth status.
- Add explicit proof-of-control linking for already-authenticated users; never auto-link by email.
- Add readiness/config checks without touching live credentials.

Acceptance:

- Google sign-in requests only `openid email profile`.
- New, returning, linked and collision/error cases are covered.
- GitHub login remains available and unchanged in behavior.
- Login never stores a Drive refresh token or grants file access.

### GDV-4 · Extract repository-shaped provider-neutral vault interface

Objective: preserve the current local Markdown pipeline while removing direct engine dependence on GitHub/git result shapes.

Scope:

- Introduce `VaultRepository` around pull/sync, local path, tracked files, baseline content, pending changes, discard, publish and URL generation.
- Adapt current `VaultRepo` as the GitHub implementation.
- Make engine construction and core vault operations depend on the interface.
- Keep evidence immutability, schema bootstrap, reads, writes and work plan behavior unchanged.

Acceptance:

- Current GitHub core and server suites pass unchanged or with compatibility-only fixture updates.
- A fake non-git backend can execute the complete core store/search/get/ask loop.
- Provider code does not leak into classification/composition/lint logic.

### GDV-5 · Generalize revisions, citations and receipts

Objective: make all public/internal memory results truthful for either backend.

Scope:

- Add generic revision and URL fields to store/work/search/get/ask/backlog/ingest results.
- Update MCP schemas, generated schemas, task journals, peer receipt verification, notifications, WhatsApp receipts and web presentation.
- Preserve optional `commitSha`/`githubUrl(s)` fields for GitHub compatibility during migration; allow Drive `commitSha` only when it is a real commit in the durable Drive bundle, while Drive never emits `githubUrl(s)`.
- Remove validation that equates successful durable storage with a 40-character SHA.

Acceptance:

- GitHub results remain byte/shape compatible where promised.
- Drive fixtures return revision/save language and Drive links; any `commitSha` is independently verified real Git provenance and is never derived from the Drive revision ID.
- Async job and peer paths accept and verify provider-specific durable receipts.
- No customer-facing Drive path says “committed to GitHub.”

### GDV-6 · Implement recoverable Google Drive vault repository

Objective: translate the repository-shaped publish boundary into ordinary Google Drive file saves plus recoverable real Git history while Drive remains the sole durable authority.

Scope:

- Create/recover a separately marked `Zenod Vault` folder and seed the Markdown schema.
- Map paths to stable Drive IDs; download authorized files to a rebuildable tenant-local workspace.
- Implement create/update/move/delete and attachment upload using `drive.file`.
- Create an app-owned `.git` folder containing one full, verifiable `repository.bundle`; never synchronize live loose Git internals file-by-file through Drive.
- Reconstruct the ephemeral local `.git` from the bundle on cold start, import external Markdown edits as explicit commits, and expose real history/diff/rollback without configuring a GitHub or network Git remote.
- Implement manifest, base revisions/checksums, optimistic conflict checks, durable transaction journal, idempotent retry and restart reconciliation.
- Publish Markdown mutations, bundle and manifest as one recoverable transaction; the manifest finalizes both the Drive revision identity and exact bundled Git commit.
- Separate vault folder state from the existing archive/export folder.

Acceptance:

- Store touches Log plus meaning page and returns success only after both reconcile.
- Injected failure after each remote mutation recovers deterministically after restart.
- Concurrent external edits are detected and never silently overwritten.
- Rebuild from empty local cache yields the same searchable Markdown vault.
- Rebuild from empty local cache verifies the bundle and yields the same Git HEAD/history as the finalized manifest; corruption or mismatch fails closed and recovers from the transaction journal.
- Disconnect/revocation fails closed and never deletes Drive files.

### GDV-7 · Bind Drive credentials, backend selection and tenant runtime

Objective: provision and operate a paid tenant whose memory engine requires no GitHub configuration.

Scope:

- Add one authoritative `vault_provider` and provider-binding state to the account/tenant runtime.
- Store Drive refresh tokens only in the existing encrypted tenant credential authority.
- Add separate vault OAuth start/callback/recovery/disconnect behavior using tenant-bound signed state.
- Select GitHub or Drive repository adapter at runtime; remove GitHub from generic memory readiness.
- Exclude rebuildable Drive cache from authoritative backup/restore claims and document cache cleanup.

Acceptance:

- Google identity + Drive consent provisions a working store/search/get/ask tenant.
- Restart with an empty cache reconstructs from Drive.
- Entitlement suspension and OAuth revocation fail closed without changing external files.
- One tenant cannot resolve another tenant's token, folder, transaction or cache.

### GDV-8 · Deliver Google-first onboarding and provider-aware account UI

Objective: make the no-GitHub journey understandable and complete without exposing internal provider machinery.

Scope:

- Add Google and GitHub login choices with accurate consent copy.
- Add authoritative vault selection and a Drive create/recover flow.
- Project provider, readiness, reconnect/conflict/recovery and external-link states in Hosted Account/Vault surfaces.
- Remove GitHub-only assumptions from checkout, avatar, account and setup copy.
- Preserve existing Hosted/self-host capability profiles and responsive design.

Acceptance:

- A clean Google user can reach a working tenant without seeing a GitHub requirement.
- Checkout cannot strand a paid user behind an impossible backend state.
- Loading, denied consent, expired state, revoked token, recovering transaction and conflict states are actionable.
- GitHub users retain the current path.

### GDV-9 · Capability-gate GitHub-only operations and update contracts

Objective: make Drive-only memory complete while keeping optional GitHub tasking honest and safe.

Scope:

- Gate GitHub issue/backlog/code-repository tools behind an explicit GitHub capability.
- Return typed `github_connection_required` behavior where an invoked operation genuinely needs GitHub.
- Keep Markdown-local backlog digestion/writes provider-neutral.
- Update site metadata/copy, Terms/privacy/data-location disclosures, readiness checks, support docs and operator runbooks.
- Document Drive cache, token, transaction and external-file preservation behavior.

Acceptance:

- Missing GitHub never blocks memory readiness.
- GitHub-specific tools are absent or fail typed without leaking credentials or corrupting state.
- Public and authenticated copy consistently describes user-owned GitHub **or** Drive storage.
- Legal/readiness/runbook checks prevent public Google signup when required OAuth/config/acceptance evidence is absent.

### GDV-10 · Prove Google-only release acceptance and GitHub regression

Objective: produce named evidence for the exact integrated candidate before any production or signup gate.

Scope and acceptance matrix:

- Incognito Google sign-in with no GitHub account.
- Existing offer checkout and tenant provisioning using provider-neutral ownership.
- Separate Drive consent and user-owned vault creation/recovery.
- Store via web, MCP and one supported phone channel; verify exact Markdown and attachments in Drive.
- Search/get/ask and evidence references before and after empty-cache restart reconstruction.
- External edit ingestion, concurrent conflict refusal/reconciliation and rename behavior.
- Fault injection before write, between multi-file writes and before transaction finalization; no false success or duplicate evidence.
- OAuth revocation/reconnect and entitlement suspension/resume.
- Two-tenant file/token/cache/receipt isolation.
- Existing GitHub Hosted journey and self-host regression.
- Proof that the Google-only journey created no GitHub account, repository, App installation or Git remote, while the reported real Git commit exists in the Drive bundle and the Drive revision remains authoritative.

Terminal state: exact commit, environment, commands, fixtures/screenshots, pass/fail, residual risks and separately named production/credential/signup gates are recorded in a durable evidence packet.

## Dependency And Dispatch Plan

```text
control-plane spine merge
          │
        GDV-1
       /     \
    GDV-2   GDV-4
      │       │
    GDV-3   GDV-5
       \      /
         GDV-6
           │
         GDV-7
        /     \
     GDV-8   GDV-9
        \     /
         GDV-10
```

- First batch after the control-plane merge: GDV-1 only, because it freezes shared interfaces and migration invariants.
- Second batch: GDV-2 and GDV-4 in separate worktrees after GDV-1 integrates.
- Later workers always start from fresh `main`; do not stack long-lived branches across both identity and vault seams.
- GDV-10 tests only an integrated main/candidate, never a collection of unmerged branches.

## Branch And Integration

- Protected integration target: `main`.
- Planning/control branch: `codex/google-drive-vault-epic`, based on exact `origin/main` commit `bcd64987f061a9e622cb88796f1d52781a006109`.
- Every GDV ticket uses the dedicated branch recorded in the Issue Ledger and a separate worktree when another assignment is active.
- Every worker records its exact base and latest commit in the GitHub issue. Branches start from fresh `main` after dependencies merge; they do not stack on unmerged sibling branches.
- Integration requires focused tests, repository typecheck/build as relevant, `git diff --check`, no leaked secrets, a linked PR and independent review proportional to identity/storage risk.
- GitHub behavior remains the compatibility baseline. Small reviewed seams merge frequently so Drive work does not become a hidden long-lived fork.
- Human or credential-backed testing uses an exact integrated commit, image or named staging environment. A branch result is never called deployed proof.
- Production deploy, OAuth credentials, migration of existing tenants, billing and signup remain separate human gates even after source integration.

## Recovery And Takeover

- The active spine steward is the only default writer of this document. Ticket workers write detailed progress and terminal handoffs to their linked issue.
- A stale assignment may be superseded by the epic worker only after recording the prior owner, branch, latest commit, evidence, blocker and takeover base in the issue and this spine's Handoff Journal.
- Never delete or rewrite an abandoned branch to simplify the board; preserve it for comparison and create a fresh replacement branch from current `main`.
- If identity or receipt migrations diverge from this target, stop broad integration, keep Google signup disabled, and return the decision to Jordi/planner.
- If a Drive transaction test exposes possible silent overwrite, false success or cross-tenant access, mark the issue blocked, preserve the exact fixture/state and do not advance dependent work.
- If production state differs from this spine, the deployed image/config/evidence wins for operational truth. This spine must be reconciled before any production action.

## Human Gates

| Gate | Owner | Required Before | Evidence Required | Fallback |
|---|---|---|---|---|
| Product/target | Jordi | Control-plane merge | This mission, Drive-only authority, adapter approach and non-goals accepted. | Revise spine before dispatch. |
| Google Cloud OAuth configuration | Jordi/operator | Credential-backed staging | Exact project/client/redirects/branding/scopes; no secret values in repo or issue. | Use deterministic fake provider locally. |
| Existing-account migration | Jordi + reviewer | Applying migration to production data | Backup, dry-run inventory, reversible mapping and exact rollback. | Keep Google feature disabled. |
| Production deployment | Jordi | Any Dokploy/image/config mutation | Exact image digest, target, env-key delta, backups and rollback. | Remain local/staging. |
| Live billing journey | Jordi | Real card charge | Exact €9 journey and refund/cancel plan. | Test mode only. |
| Public Google signup | Jordi | Enabling the Google button for strangers | GDV-10 pass, OAuth verification, legal/readiness pass and explicit approval. | Keep feature flag/allowlist closed. |

## Validation Evidence

| Date | Scope | Commit | Environment | Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-08-29 | Planning/source audit | `bcd6498` | clean worktree from `origin/main` | Inspected identity, account, billing, runtime, Drive, core repository, receipt, MCP, peer and UI seams | target/backlog ready; no implementation proof | This spine |
| 2026-08-29 | Control-plane integration | `a4c4826` | GitHub `main` | Strict spine validation, diff/secret checks and complete repository CI | pass; target and issues #1145–#1154 integrated as delivery control plane | [PR #1155](https://github.com/zenod-ai/zenod/pull/1155) |
| 2026-08-29 | GDV-1 contract integration | `0b5aa62` | GitHub `main` | Focused core/server tests, all-workspace typecheck, builds, schema checks, full CI and independent exact-head review | pass; four review findings fixed before merge; provider-neutral contracts frozen | [PR #1158](https://github.com/zenod-ai/zenod/pull/1158), [terminal handoff](https://github.com/zenod-ai/zenod/issues/1145#issuecomment-5461631822) |
| 2026-08-29 | GDV-2 identity integration | `45c9722` | GitHub `main` | 1,147 server tests, monorepo typecheck/build/tests, full CI and independent exact-head security/lifecycle review | pass; stable account ownership, provider-scoped GitHub login and legacy identifiers preserved | [PR #1161](https://github.com/zenod-ai/zenod/pull/1161), [review-fix handoff](https://github.com/zenod-ai/zenod/issues/1146#issuecomment-5461766856) |
| 2026-08-29 | GDV-3 Google OIDC integration | `fe057ad` | GitHub `main` | 1,169 server tests, focused adversarial identity/link tests, all-workspace typecheck, full CI and independent exact-head security review | pass; no Drive scopes or live config; duplicate-provider, cross-site link, unlink-lockout and unsafe-subject findings fixed | [PR #1163](https://github.com/zenod-ai/zenod/pull/1163), [review-fix evidence](https://github.com/zenod-ai/zenod/issues/1147#issuecomment-5461955646) |
| 2026-08-29 | GDV-4 safe adapter slice | `c192314` | draft branch / PR CI | 14 focused tests, core typecheck, diff check and full PR CI | pass for adapter slice only; not GDV-4 acceptance | [draft PR #1160](https://github.com/zenod-ai/zenod/pull/1160), [architecture gate](https://github.com/zenod-ai/zenod/issues/1148#issuecomment-5461674225) |
| 2026-08-29 | GDV-4 repository foundation integration | `20853d9` | GitHub `main` | 14 focused adapter/contract tests, 538 core tests, core build/typecheck, all-workspace typecheck, full CI and independent exact-head review | pass; real GitHub adapter implements `VaultRepository` and resolves durable current/publication revision metadata consistently; GDV-4 remains open | [PR #1166](https://github.com/zenod-ai/zenod/pull/1166), [terminal handoff](https://github.com/zenod-ai/zenod/issues/1148#issuecomment-5462262836) |
| 2026-08-29 | GDV-5 provider-neutral receipt integration | `b136556` | GitHub `main` | core/server/web focused suites, 1,195 server tests, full repository tests/build, all-workspace typecheck, 27 generated schema checks, exact-head CI and independent adversarial review | pass; result/citation/async/peer surfaces accept truthful GitHub or Drive dual provenance, fail closed on contradictions and never synthesize Drive IDs into SHAs | [PR #1168](https://github.com/zenod-ai/zenod/pull/1168), [terminal handoff](https://github.com/zenod-ai/zenod/issues/1149#issuecomment-5462699161) |
| 2026-08-29 | GDV-4 provider-neutral engine integration | `d77ea43` | GitHub `main` | 78 focused core tests, 543 core tests plus 6 skipped, proportional server tests, all-workspace typecheck/build, schema checks, exact-head CI and independent adversarial review | pass; complete fake non-Git loop, GitHub compatibility, provider URL fail-closed boundary and backlog provenance verified | [PR #1171](https://github.com/zenod-ai/zenod/pull/1171), [terminal evidence](https://github.com/zenod-ai/zenod/issues/1148#issuecomment-5462988341) |
| 2026-08-29 | GDV-6 Drive authority integration | `16605cf` | GitHub `main` | 49 focused core Drive tests, 32 DriveClient tests, 592 core tests plus 6 skipped, full workspace tests/typecheck/build/schema checks, exact-head CI and repeated independent adversarial review | pass; ordinary Markdown plus a self-contained full Git bundle are Drive-authoritative; transaction/bootstrap recovery, external-edit preservation, tombstones, stable IDs, exact path/root isolation and replay state/tree integrity fail closed | [PR #1173](https://github.com/zenod-ai/zenod/pull/1173), [terminal evidence](https://github.com/zenod-ai/zenod/issues/1150#issuecomment-5464016397) |
| 2026-08-29 | GDV-7 Drive tenant runtime integration | `2d8c28c` | GitHub `main` | 164 focused tests, 1,214 server tests, full workspace tests/typecheck/build/schema checks, Phylax bundle boundary, exact-head CI and independent adversarial review | pass; one authoritative provider/binding, one-time account/session-bound PKCE consent, encrypted vault-scoped credentials, authorization-epoch fencing, canonical billing plus strict vault authority and tenant-isolated rebuildable cache | [PR #1175](https://github.com/zenod-ai/zenod/pull/1175), [terminal evidence](https://github.com/zenod-ai/zenod/issues/1151#issuecomment-5464462768) |
| 2026-08-30 | GDV-8 Google-first onboarding integration | `1cf01a3` | GitHub `main` | 117 web tests, focused callback/runtime and 49 Drive repository tests, all-workspace typecheck/build, changed-file lint, responsive browser checks, exact-head CI and independent review | pass; provider-aware onboarding/account UI, scrubbed fail-closed Drive callback failures, authoritative readiness and GitHub legacy behavior verified | [PR #1177](https://github.com/zenod-ai/zenod/pull/1177), [integration evidence](https://github.com/zenod-ai/zenod/issues/1152#issuecomment-5467829117) |
| 2026-08-30 | GDV-9 capability and contract integration | `536a85c` | GitHub `main` | 104 focused server, 66 core, 117 web and 12 site tests, all-workspace typecheck/build, 27 schemas, Phylax bundle/image checks, exact-head CI and independent review | pass; Google signup defaults closed and build-bound, Drive memory remains provider-neutral, Drive tasking is tenant-installation/App-only, revoked capability fails typed without PAT fallback, and public/operator contracts match authority | [PR #1178](https://github.com/zenod-ai/zenod/pull/1178), [integration evidence](https://github.com/zenod-ai/zenod/issues/1153#issuecomment-5467930930) |
| 2026-08-30 | GDV-10 deterministic release acceptance | `0ca15e8` | GitHub `main`; local fake-provider acceptance | Exact clean-head runner: 21 files/364 assertions; full repository 2,274 assertions plus 6 skips; typecheck/build, 27 schemas, exact-head CI and independent claim/evidence review | pass for deterministic local acceptance; fresh-engine search/get/ask after empty-cache bundle reconstruction, fault/conflict/revocation/isolation, layered web/MCP/phone, GitHub/self-host regression and no-GitHub-publication proof verified; live gates remain closed | [PR #1180](https://github.com/zenod-ai/zenod/pull/1180), [evidence packet](docs/evidence/zenod-google-drive-vault-release-acceptance-2026-08-30/README.md), [exact receipt](https://github.com/zenod-ai/zenod/issues/1154#issuecomment-5468103555), [terminal handoff](https://github.com/zenod-ai/zenod/issues/1154#issuecomment-5468131045) |

## Handoff Journal

### 2026-08-30 - Epic worker - Deterministic acceptance complete; human staging gate reached

Context: GDV-10 assembled a reproducible local/fake-provider acceptance runner and durable packet across Drive authority, identity/account/checkout, web, MCP, Hosted phone paths, fault recovery, external edits, revocation, entitlement, isolation and GitHub/self-host compatibility. Independent review rejected a stale checked receipt and an unproved post-reconstruction read claim; the worker removed the self-referential artifact, made the runner clean-tree/head/base/count validating and added a fresh-engine search/get/ask test after empty-cache bundle reconstruction.

Action: merged [PR #1180](https://github.com/zenod-ai/zenod/pull/1180) as `0ca15e8a6c4e853896a5854dbbfa5e3fe5861a6e` after exact head `4783239c0671eac543a4e8cbd8dd65d28b682be1` emitted the reproduced 364-assertion machine receipt, passed the complete repository/CI gates and received a clean independent exact-head review. Issue #1154 is complete for deterministic local acceptance. All implementation issues #1145–#1154 are closed.

Next: stop autonomous source work at the human gate. Jordi/operator must approve the exact Google Cloud OAuth configuration and disposable credential-backed staging environment before the uninterrupted live browser/Drive/phone acceptance. That approval does not authorize production deploy, a real card, existing-tenant migration or public signup; each remains separate.

Risks: the evidence is layered local integration, not one live Google→Stripe→Drive→MCP→phone session. Real API quota, latency, eventual consistency, consent-screen behavior, provider delivery/session continuity and production configuration remain unproved. Public Google signup stays default-closed and build/evidence-bound. Drive tasking supports a verified personal GitHub App installation only; organization installation proof remains outside this epic.

### 2026-08-30 - Epic worker - All implementation integrated; GDV-10 ready

Context: GDV-8 completed the Google-first customer journey and provider-aware account/vault presentation. GDV-9 then capability-gated GitHub-only operations, added default-closed build-bound Google release readiness and reconciled public/operator contracts. Independent review found and fixed sensitive callback URL retention, stale commercial fallback, false runtime readiness, reporting-only signup gates, unbound GitHub App installations, cross-tenant token caches, remote-revocation gaps and a Drive-to-PAT fallback around the verified App boundary.

Action: merged [PR #1177](https://github.com/zenod-ai/zenod/pull/1177) as `1cf01a339d5f9ff09935bf3e222efe4748d9f739` after exact head `e461938051a8d32424e4d09a1715fb50aa8d2f69` passed full CI and clean independent review. Then merged [PR #1178](https://github.com/zenod-ai/zenod/pull/1178) as `536a85c47b4df34930f57687b65988621d489398` after exact head `663ed7e3888419db76f4fe5fb520cd986bc5a0fa` included GDV-8, passed full CI and clean independent review. Issues #1152 and #1153 are complete.

Next: integrate this reconciliation and dispatch GDV-10 from exact fresh main. GDV-10 produces the durable local/fake-provider acceptance packet, exercises the complete no-GitHub and legacy GitHub matrices, and explicitly separates proved source behavior from credential-backed/browser/deployment/signup gates.

Risks: no live Google project, credentials, Drive folder, browser consent, production image, real card or public signup has been exercised. Organization GitHub App installations for Drive tasking intentionally fail closed; the reviewed v1 tasking path supports only a linked user's verified personal installation. These are explicit acceptance/gate facts, not permission to broaden GDV-10.

### 2026-08-29 - Epic worker - GDV-7 integrated; onboarding and capability contracts ready

Context: GDV-7 connected the reviewed Drive repository to existing tenant credentials and runtime selection. Independent review found and fixed ambient/replayable consent, archive/vault credential confusion, stale cached-client revival, mutable authority fields, duplicate-row/canonical-billing regressions, owner/account collisions, stale-session callback binding, over-broad 403 revocation and a Phylax bundle-boundary leak.

Action: merged [PR #1175](https://github.com/zenod-ai/zenod/pull/1175) as `2d8c28c7fd805104060be1fd4b8856e303a30150` after exact head `6232b1808974b794a830cc95c57432530c60d6cc` passed full CI and clean immutable-head review. Issue #1151 is complete. Drive consent is an explicit same-origin one-time PKCE flow bound to the exact account/session/tenant/binding/authorization epoch; vault tokens remain in the existing encrypted credential authority and are isolated from archive OAuth.

Next: dispatch GDV-8 and GDV-9 in parallel from exact fresh main. GDV-8 owns the user-visible no-GitHub journey; GDV-9 owns typed capability denial and contract/runbook truth. Neither may alter runtime authority, credentials, deployment, billing or public signup.

Risks: UI and copy must never project a binding as ready before the runtime does. GitHub-only operations must deny by capability without weakening existing GitHub tenants. Live browser/provider validation remains a later human gate.

### 2026-08-29 - Epic worker - GDV-6 integrated; tenant runtime ready

Context: GDV-6 implemented the Drive-only vault authority as visible ordinary files plus one self-contained `.git/repository.bundle`. Repeated independent review found and fixed cross-vault executable-journal redirection, same-vault path redirection, silent authority reprovision, thin-bundle warm-cache acceptance, stale external-import/tombstone finalization, unstable IDs for equal-content moves, unbounded discovery, early bootstrap lost acknowledgements, nested authority remnants and inconsistent bootstrap replay state.

Action: merged [PR #1173](https://github.com/zenod-ai/zenod/pull/1173) as `16605cf455f760b5e0f0e453a663e05e979b52d5` after exact head `9f66c37ccf6ad9d6ba61a9217352c14a22edc7d9` passed full CI and clean immutable-head review. Issue #1150 is complete. Drive remains the sole remote authority, Drive transaction IDs remain independent from real bundled Git SHAs, and no Git remote or GitHub URL is emitted.

Next: dispatch GDV-7 from exact fresh main to connect existing tenant credential/backend-selection/runtime seams to `DriveVaultRepository`. Do not add UI, live OAuth credentials, production configuration or deployment in GDV-7.

Risks: runtime selection must not allow a Drive tenant to fall back silently to GitHub, share another tenant's root/state/cache, or report readiness before folder, manifest, bundle and consent authority are verified. Revocation and incomplete bindings must fail closed.

### 2026-08-29 - Epic worker - GDV-4 complete; Drive backend ready

Context: after GDV-5 integrated, the same GDV-4 worker converted all remaining engine store/search/get/ask/work/backlog/capture/replay/enrich/lint paths from concrete `VaultRepo`/Git methods to `VaultRepository`. Independent review found and fixed hostile Drive URL leakage and backlog legacy-provenance bypasses, including fail-before-write guarantees.

Action: merged [PR #1171](https://github.com/zenod-ai/zenod/pull/1171) as `d77ea431d7328ce187d1a4d3b59403327cb0731b` after exact-head `edcf1f4` passed full CI and clean review. Issue #1148 is complete. A fake Drive-shaped repository now proves the complete core memory loop without GitHub fields or fabricated provenance.

Next: dispatch GDV-6 from exact fresh main to implement the app-created Drive Markdown tree, durable manifest/transaction recovery and `.git/repository.bundle`. Keep credential binding/runtime selection in GDV-7.

Risks: GDV-6 is the first real multi-file remote mutation boundary. It must prove optimistic concurrency, bundle/manifest integrity, idempotent recovery and no false terminal success under fault injection before it can integrate.

### 2026-08-29 - Epic worker - GDV-5 integrated; remaining GDV-4 ready

Context: GDV-5 generalized public and internal memory results across core, MCP/generated schemas, async journals, peer validation, notifications, WhatsApp and web. Repeated adversarial review found and fixed false terminal async success, contradictory peer receipts, discarded backlog provenance, Git placeholders, committed WorkResult gaps, GitHub-host bypasses and incomplete/equal Drive dual provenance.

Action: merged [PR #1168](https://github.com/zenod-ai/zenod/pull/1168) as `b136556bbc22b1e667f7b1dc9950f48a31dfbc10` after exact-head `7b8aded` passed full CI and clean independent review. Drive revision IDs remain authoritative; optional real bundled Git SHAs are paired and independent; Drive never emits GitHub URLs.

Next: resume the same stable GDV-4 worker in a fresh worktree from exact main to finish interface-only engine conversion. Do not implement the Drive backend in GDV-4; GDV-6 follows only after #1148 closes.

Risks: the remaining engine conversion must not regress capture/enrich/work/backlog queue semantics or narrow the interface back to `VaultRepo`. A fake non-Git repository must prove the full core loop without inventing provider-specific fields.

### 2026-08-29 - Epic worker - Real Git history added to Drive-only target

Context: during GDV-5 review, Jordi clarified that Drive-only vaults should retain a near-GitHub history experience by keeping `.git` material in Google Drive. A literal loose `.git` tree cannot be safely synchronized through independent Drive file mutations because Git relies on atomic ref/object updates and locks.

Action: accepted the intent in a recoverable form: the app-created Drive vault contains visible ordinary Markdown plus `.git/repository.bundle`, a single verifiable full Git bundle. Drive remains the only remote authority. Cold start reconstructs local `.git` from the bundle; no GitHub repository or Git remote exists. Receipt contracts carry the independent authoritative Drive revision ID and may additionally carry only the real bundled Git commit SHA; they never derive one from the other and never emit Drive `githubUrls`.

Next: finish GDV-5 validation/schema changes for this dual provenance, merge after clean exact-head review, then resume GDV-4 engine conversion. GDV-6 implements the bundle and recoverable Drive transaction only after those seams integrate.

Risks: the bundle must be published and finalized with the Markdown transaction, not treated as a separately successful backup. A bundle/manifest mismatch, partial upload or invalid Git object graph must fail closed and recover through the existing transaction journal design.

### 2026-08-29 - Epic worker - GDV-4 foundation integrated; GDV-5 ready

Context: the resumed GDV-4 slice reproduced the reviewed GitHub adapter on fresh main and added the approved `currentRevision()` contract. Independent review found publication timestamps came from wall-clock time while current revisions used commit time; the worker unified both paths on the explicit durable Git SHA and added race/consistency coverage.

Action: merged [PR #1166](https://github.com/zenod-ai/zenod/pull/1166) as `20853d9c702a171f7d2bcca72491f61f3873a247` after exact-head full CI and clean re-review. The slice contains only the contract, real GitHub adapter and focused tests. Issue #1148 stays open and queued behind GDV-5.

Next: dispatch GDV-5 from exact fresh main to generalize revision, receipt and citation surfaces while preserving optional GitHub compatibility fields. Resume the remaining GDV-4 engine conversion only after GDV-5 integrates.

Risks: GDV-5 crosses public schemas and multiple consumers. It must preserve promised GitHub shapes, remove false mandatory-SHA assumptions, and distinguish an optional real bundled Git commit from GitHub-only URL fields in Drive fixtures.

### 2026-08-29 - Epic worker - GDV-4 architecture and sequencing approved

Context: Jordi explicitly approved continuing with the recommended provider-neutral `currentRevision(): Promise<VaultRevision>` contract and staged GDV-4/GDV-5 sequence. The no-fake-SHA decision remains binding; Drive revision IDs never populate `commitSha`.

Action: cleared the GDV-4 source blocker and superseded the stale implementation branch as the active work surface while preserving draft PR #1160 and commit `c192314` for comparison. The resumed worker starts from exact current `main` `3745aa9537378ccdf10e8cfc5dd8444e96f0d302` on `codex/gdv-4-vault-repository-resume`, transplants only the reviewed adapter behavior, and adds the approved current-revision foundation.

Next: independently review and merge the foundation slice without closing #1148; dispatch GDV-5 from that merged main; then resume the remaining GDV-4 engine conversion from the receipt-generalized main.

Risks: staging must not turn a partial PR into a false GDV-4 completion claim. Legacy GitHub compatibility stays additive, and no Drive/backend/runtime/configuration work is authorized in the foundation slice.

### 2026-08-29 - Epic worker - Google identity path integrated; Drive path awaits architecture permission

Context: GDV-3 added Google OIDC through the existing provider-neutral identity seam with identity-only scopes. Independent adversarial review found duplicate-provider persistence, cross-site ambient linking, configured-provider unlink lockout and unsafe GitHub numeric-subject normalization. The worker fixed all four without adding a service or touching production configuration; exact-head re-review and full CI passed.

Action: merged [PR #1163](https://github.com/zenod-ai/zenod/pull/1163) as `fe057ad796f4d71f4c57aae4886fd6fea432c1b0` and marked GDV-3 complete. GDV-1 through GDV-3 are now integrated. No later ticket is dependency-ready because GDV-4/GDV-5 remain at the named provider-neutral revision/receipt sequencing gate.

Next: ask Jordi to approve the minimal `currentRevision()` contract and staged GDV-4 foundation → relevant GDV-5 receipts → remaining GDV-4 engine conversion. Keep draft PR #1160 and all Drive/runtime/UI tickets unmerged meanwhile.

Risks: real Google credentials and browser-provider behavior are still unproved human gates. The Drive path must preserve truthful provider-neutral revisions and must never place a Drive transaction ID into `commitSha`.

### 2026-08-29 - Epic worker - GDV-2 integrated; GDV-3 ready and GDV-4 architecture-gated

Context: GDV-2 generalized customer identity and ownership through the existing atomic-JSON persistence pattern. Independent review caught account-ID drift after provider linking and an admin spoof path through shared display text. The worker anchored ownership in durable account mappings, moved GitHub login to provider-scoped metadata, added lifecycle/security regressions, and passed exact-head re-review and full CI.

Action: merged [PR #1161](https://github.com/zenod-ai/zenod/pull/1161) as `45c9722a48200390f1d0921d3af569717f87a5bc` and marked GDV-2 complete, making GDV-3 dependency-ready. In parallel, GDV-4 stopped before false semantics: its safe GitHub adapter slice is isolated in draft PR #1160, while the remaining engine conversion needs explicit approval for `currentRevision(): Promise<VaultRevision>` and for relevant GDV-5 receipt/citation work to precede completion.

Next: dispatch GDV-3 from `45c9722`; keep GDV-4/GDV-5 held until Jordi resolves the named architecture/sequencing gate.

Risks: Google sign-in must not request Drive scope, auto-link by email, or destabilize legacy sessions. GDV-4 must never place a Drive revision or transaction ID in `commitSha`.

### 2026-08-29 - Epic worker - GDV-1 integrated; first implementation batch ready

Context: GDV-1 delivered the accepted provider-neutral identity, vault, transaction, readiness and compatibility contracts. Independent review found four fail-closed/coverage defects; the same worker corrected them without architecture expansion, and re-review plus full CI passed at exact head `970d931a7bd2b3976ad6f0287e5e87a6bb01a6da`.

Action: merged [PR #1158](https://github.com/zenod-ai/zenod/pull/1158) to `main` as `0b5aa6243333d05c5ad25f80160586a6e3545ba9` and marked GDV-1 complete. GDV-2 and GDV-4 are the only newly dependency-ready tickets and may run in parallel from that exact base.

Next: dispatch one stable worker per ticket in dedicated worktrees, monitor for contract or architecture divergence, and independently review each terminal PR before integration.

Risks: identity and engine seams are broad. Workers must preserve existing GitHub identifiers and behavior, keep provider code out of filing logic, and return any architecture/new-system decision to Jordi rather than inventing it.

### 2026-08-29 - Epic worker - Bound as delivery manager and dispatched GDV-1

Context: Jordi bound `/root` as the Google Drive Vault delivery manager with the standing goal of tracking and unblocking the accepted backlog through completion. Architectural changes and new systems require permission; ordinary work inside the accepted provider-neutral identity plus repository-shaped Drive adapter contract is authorized.

Action: preserved the unrelated dirty repository checkout, created isolated manager worktree `/Users/jordi/Documents/GitHub/zenod-gdv-spine` on `codex/gdv-spine-steward`, and dispatched `/root/gdv_1_contract_worker` into `/Users/jordi/Documents/GitHub/zenod-google-drive-vault` on `codex/gdv-1-contract` from exact `main` `d48e48da11837632ac95f6786710e0bc9c76c36b`. Issue #1145 is the only running ticket; all dependents remain gated.

Next: monitor and unblock GDV-1, review its exact PR head and validation, integrate it to `main`, then dispatch GDV-2 and GDV-4 from the resulting fresh base if the contract remains within the accepted architecture.

Risks: contract work can accidentally become architecture invention. The worker must stop on divergence rather than adding a second account store, sync service, durable git remote for Drive, or new production component.

### 2026-08-29 - Planner - Google Drive-only target accepted and isolated from dirty work

Context: Jordi required Google sign-in and complete Drive-only vault operation. The accepted design preserves Zenod's existing local Markdown filing flow behind a repository-shaped adapter; the Drive adapter translates final publication into recoverable ordinary Drive saves and returns a provider-neutral revision rather than a fake commit. The original checkout was on `codex/whatsapp-concurrent-voice-recovery` with unrelated modified/untracked work, so it was not switched or stashed.

Action: fetched `origin/main` and created clean planning worktree `/Users/jordi/Documents/GitHub/zenod-google-drive-vault` on `codex/google-drive-vault-epic` from exact base `bcd64987f061a9e622cb88796f1d52781a006109`.

Next: dispatch [GDV-1 #1145](https://github.com/zenod-ai/zenod/issues/1145) from exact merged-main base `a4c4826f80ed0acda93d304f21cb50129d7fb2dd`.

Risks: existing production/signup work remains separately gated. Drive multi-file publication is not atomic; GDV-1 and GDV-6 must make recovery/failure truth explicit before the UI can offer Google Drive as an authoritative vault.

## Planner Queue

1. Dispatch GDV-8 on `codex/gdv-8-google-onboarding` and GDV-9 on `codex/gdv-9-capabilities-and-contracts` from exact `main` `2d8c28c`.
2. Independently review the complete responsive Google-first journey and typed GitHub-only capability denial without live provider credentials or deployment.
3. Integrate both clean heads, reconcile the spine, then dispatch GDV-10 release acceptance from the exact combined `main`.

## Open Questions

- Should manual external creation of new Markdown files inside the Drive vault be supported in v1 through Picker/import, or only edits to files Zenod created? Default: explicit import only; never broaden scopes silently.
- Should an existing user be offered a separately approved GitHub↔Drive migration tool in a later epic? Default: no switching or dual-write in this epic.
- Does “only on Drive” later need to extend beyond vault files to channel transcripts, task journals and operational logs? Default: this epic changes vault authority only and documents remaining operational data explicitly.

## Proposed Cross-Spine Updates

| Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|
| `docs/EPIC-0-FOUNDATION-SPINE.md` | Add this child as the Google-access/storage expansion track while preserving `docs/EPIC-P-PHYLAX-SPRINT.md` as the active production gate. | Merged spine [PR #1155](https://github.com/zenod-ai/zenod/pull/1155) and issues #1145–#1154. | Epic 0 Foundation planner | ready for root-steward reconciliation |
| `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Record that GitHub-only onboarding is superseded only after GDV-10 and a separately approved rollout; do not change current production truth beforehand. | Future GDV-10 evidence. | Zenod Alpha steward | waiting |

## Resume Contract

- “Continue the Google Drive vault epic” means: open this spine, assume epic-worker/steward role, reconcile linked issues/PRs/current `main`, and execute the single `Next action` without touching production gates.
- “Work on GDV-N” means: bind one ticket worker to that linked issue, use its recorded dedicated branch from fresh `main`, follow its acceptance, and write the terminal handoff to GitHub.
- “What are we working on?” means: report this spine's Current State, active/ready issues, owners, blockers, human gates and one recommended next action.
