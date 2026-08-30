# GDV-10 Google Drive vault release-acceptance packet

Status: **PASS for deterministic local/fake-provider acceptance; live and production gates remain closed**

Prepared: 2026-08-30 CEST

Issue: [GDV-10 #1154](https://github.com/zenod-ai/zenod/issues/1154)

Integrated implementation base: `3802672df535461a28853c8d363f205f6278e262`

Exact acceptance-runner candidate: `a0e2bad2350992bed89b891a1f05a4aedc288260`

Integration target: `main`

## Verdict and claim boundary

The complete deterministic local acceptance matrix passes. It proves the Google-only identity, customer ownership, separate Drive-consent runtime, Drive-authoritative Markdown and bundled Git repository, memory surfaces, recovery/fault behavior, isolation, default-closed public signup, and existing GitHub/self-host compatibility against fake provider boundaries.

This is a layered integration journey, not a claim that one live browser session crossed Google, Stripe, Drive, MCP and WhatsApp. The same production boundaries are composed under test, but Google identity/OAuth/Drive HTTP, channel delivery and billing are deterministic fakes. No Google credential, OAuth grant, real Drive folder or file, GitHub account/repository/App installation, Git remote, payment card, Stripe object, deployment, production configuration, tenant, or public-signup state was created or changed.

No screenshot is included. The UI evidence is deterministic component and route integration, while a screenshot of mocked presentation would add no operational proof. Credential-backed browser evidence is a later named gate.

## Environment

| Item | Value |
|---|---|
| Worktree | `/Users/jordi/Documents/GitHub/zenod-gdv-10-release-acceptance` |
| Branch | `codex/gdv-10-release-acceptance` |
| Base | `3802672df535461a28853c8d363f205f6278e262` |
| Runner commit | `a0e2bad2350992bed89b891a1f05a4aedc288260` |
| OS | macOS 26.5.1 (25F80), local developer workstation |
| Node | `v22.22.3` |
| npm | `10.9.8` |
| Git | `2.50.1 (Apple Git-155)` |
| Provider boundary | in-memory/fake Google OIDC, OAuth, Drive, Stripe and channel transports |
| Secrets/live state | none used |

Dependencies were installed from the checked-in lockfile with `npm ci`; npm reported 804 packages added and zero vulnerabilities.

## Reproducible acceptance receipt

Run:

```sh
npm ci
npm run acceptance:gdv10
```

The checked-in runner builds the core and MCP chassis dependencies, then executes the exact focused matrix and emits `GDV10_RELEASE_ACCEPTANCE_RECEIPT` as one JSON line. The preserved result is in [`receipt.json`](./receipt.json).

Result at `a0e2bad2350992bed89b891a1f05a4aedc288260`:

| Step | Files | Tests | Result |
|---|---:|---:|---|
| Core Drive authority and memory loop | 2 | 56 | PASS |
| Hosted runtime, MCP, receipts, phone/channel, self-host and GitHub regressions | 14 | 272 | PASS |
| Google-first and legacy GitHub account/vault UI | 5 | 36 | PASS |
| Core and MCP-chassis prerequisite builds | - | - | PASS |
| Total focused assertions | 21 | 364 | PASS |

The run started `2026-08-30T09:54:57.385Z` and completed `2026-08-30T09:57:26.828Z`.

## Acceptance matrix

| Contract | Deterministic evidence | Result |
|---|---|---|
| Google identity with no GitHub identity | `customerLayer.test.ts` creates a new and returning Google user, asserts `/api/me` has `provider: google` and `providers: [google]`, and proves sign-in requests only `openid email profile`, never Drive. Default-closed acquisition rejects an unknown user without creating an identity. | PASS |
| Provider-neutral checkout and account ownership | `customerLayer.test.ts` and `customerAccounts.test.ts` bind checkout, Stripe metadata, subscription and tenant to the stable internal account/user, including a non-GitHub owner, retry and collision cases. | PASS |
| Separate Drive consent, provision and recovery | `gdv7DriveTenantRuntime.test.ts` requires an authenticated same-origin POST intent, one-time account/session/tenant-bound PKCE state, `drive.file` plus email only, encrypted vault-scoped refresh-token custody, one immutable Drive authority and recovery from an empty cache. Callback failures are scrubbed, no-store and actionable. | PASS |
| Web memory surface | `zenodUnit.test.ts` exercises the authenticated customer browser route into its bound tenant; the web suites prove Google-first login, paid-user vault selection, verified-runtime readiness, callback recovery and provider-aware GitHub/Drive states. The actual provider write/read semantics are proved by the shared engine/Drive tests below. | PASS, layered local integration |
| MCP store/search/get/ask | `mcp.test.ts` proves authenticated `store_memory`, structural `search_memory`, exact `get_memory`, `ask_brain`, idempotent replay and typed terminal evidence. `driveRepository.test.ts` runs the real shared engine store/search/get/ask loop with `provider: google_drive`. | PASS, layered local integration |
| Supported phone storage and receipt | `whatsapp.test.ts`, `hostedChannels.test.ts` and `zenodUnit.test.ts` prove tenant-bound Hosted channel admission, explicit memory capture, idempotent delayed storage receipts, restart behavior and suspension projection. The shared engine/Drive tests prove the resulting vault mutation. Voice notes are not silently auto-filed: storage follows the supported explicit capture/tasking path. | PASS, layered local integration |
| Exact Markdown and attachment bytes | `driveRepository.test.ts` publishes ordinary `Log` and meaning-page Markdown plus `_attachments/source.bin`, verifies Drive URLs and exact attachment bytes, clears the local cache, reconstructs, and re-verifies bytes and Git HEAD. | PASS |
| Search/get/ask before and after reconstruction | The real engine loop proves store/search/get/ask. Cold-start tests reconstruct ordinary files and `.git` from Drive and preserve the finalized revision/HEAD; the same repository contract is then available to the shared reads. | PASS |
| External edit and rename | Drive tests import external Markdown edits as explicit Git commits, preserve stable file IDs across moves/renames, recover renamed marked authority nodes, and reject missing/tampered authority rather than reprovisioning. | PASS |
| Concurrent conflict | Local-versus-external file races, before/after patch races, manifest/journal races and delete races return typed conflict, materialize recoverable conflict bytes and do not advance the authoritative revision. | PASS |
| Failure before, between and at finalization | The publication matrix injects failures before and after every remote mutation across the multi-file transaction. Restart recovery is idempotent; Log and meaning files appear at most once; a failed-before-first-write remains absent; no partial transaction reports success. Bootstrap has a corresponding every-mutation fault matrix. | PASS |
| Revocation, reconnect, suspension and resume | Drive repository revocation fails closed without deleting files. Runtime disconnect reports `filesDeleted: false`, preserves folder/manifest authority, increments the authorization epoch, rejects stale clients/late requests, reconnects the same binding, and blocks suspended entitlement before reopening; active state resumes the path. | PASS |
| Two-tenant isolation | Core rejects cross-vault manifest, bundle and executable-journal targets without mutating the victim. Runtime keeps token material, cache/state directory, account/binding and receipts tenant-bound; one tenant cannot decrypt another tenant's refresh token. | PASS |
| No GitHub dependency or publication for Google-only | Google identity snapshot contains only Google. Drive results omit `githubUrls`; Drive URLs reject GitHub host families; the reconstructed Git repository has `getRemotes() === []`; Drive-only tasking exposes no PAT fallback and returns typed `github_connection_required` without mutation or credential leakage. | PASS |
| Real bundled Git commit independent of Drive revision | Drive publication returns a 40-character real SHA, asserts `revision.id !== commitSha`, verifies the full `repository.bundle`, reconstructs an empty local `.git`, and asserts reconstructed `HEAD === commitSha`. Corrupt, missing, thin or authority-mismatched bundles fail closed. | PASS |
| GDV-8 callback and readiness behavior | `gdv7DriveTenantRuntime.test.ts`, `App.hosted-onboarding.test.tsx` and `VaultTab.hosted.test.tsx` prove scrubbed denied/expired/error callbacks, actionable recovery, no false Ready before repository verification, and provider-specific GitHub/Drive copy/actions. | PASS |
| GDV-9 capability and signup behavior | `mcpGithubCapability.test.ts`, `runtime.test.ts`, `githubApp.test.ts` and `productionReadiness.test.ts` prove Drive memory remains available while GitHub mutations are absent/typed, revoked App capability cannot fall through to PAT, and public Google signup stays closed unless exact OAuth/legal/current-SHA acceptance evidence is present. GitHub signup readiness remains independent. | PASS |
| Existing Hosted GitHub | Customer, runtime, MCP, GitHub App, receipt and web suites retain the GitHub identity/vault/tasking and legacy result path. | PASS |
| Existing self-host | `drive.test.ts`, `zenodUnit.test.ts`, runtime/core tests and edition UI retain self-host BYO Drive/GitHub settings and behavior without Hosted-only assumptions. | PASS |

## Drive artifact invariants proved

The fake Drive provider stores the same artifact shapes as the real adapter boundary:

```text
Zenod Vault/
├── Log/<date>.md
├── Areas/<meaning-page>.md
├── _attachments/<original bytes>
├── .git/repository.bundle
└── .zenod/manifest.json + transactions/<journal>.json
```

The proof specifically distinguishes:

- the Drive transaction/revision ID, which is the remote durability authority;
- the Git commit SHA, which must be reachable in the verified full bundle;
- the ephemeral local working tree and `.git`, which are reconstructable cache;
- GitHub URLs/remotes/publication, which are absent for a Drive-only vault.

## Exact focused files

The runner executes:

```text
packages/core/test/driveRepository.test.ts
packages/core/test/vaultRepositoryContract.test.ts
packages/server/test/customerLayer.test.ts
packages/server/test/customerAccounts.test.ts
packages/server/test/gdv7DriveTenantRuntime.test.ts
packages/server/test/zenodUnit.test.ts
packages/server/test/mcp.test.ts
packages/server/test/mcpGithubCapability.test.ts
packages/server/test/runtime.test.ts
packages/server/test/githubApp.test.ts
packages/server/test/storageReceipt.test.ts
packages/server/test/filingReceipt.test.ts
packages/server/test/hostedChannels.test.ts
packages/server/test/whatsapp.test.ts
packages/server/test/drive.test.ts
packages/server/test/productionReadiness.test.ts
apps/web/src/App.hosted-onboarding.test.tsx
apps/web/src/views/HostedLogin.test.tsx
apps/web/src/views/HostedAccount.test.tsx
apps/web/src/views/ZenodPortalPanels.overview.test.tsx
apps/web/src/views/settings/VaultTab.hosted.test.tsx
```

## Full repository validation

The evidence snapshot `c04bdd0095c73c7468d5a4db7df877b7bf8db17b` passed the normal proportional repository checks:

```sh
npm run typecheck
npm run build
npm test
npm run schemas:check
git diff --check origin/main...HEAD
```

Results:

- all-workspace typecheck: PASS;
- production core, chassis, server, customer web and public-site builds: PASS;
- configured workspace tests: PASS, 2,080 assertions plus six explicitly skipped core cases;
- repository Node script tests: PASS, 194 assertions;
- complete local test total: PASS, 2,274 assertions plus six skips;
- generated schemas: PASS, 27 self-contained tool schemas;
- diff/whitespace check: PASS;
- dependency audit after lockfile install: zero vulnerabilities;
- build observation: the existing Vite customer-web chunk-size warning remains non-blocking; no new warning or failure was introduced.

Exact PR CI and independent review remain required before merge. Passing local acceptance is not by itself merge authorization.

## Human gates and residual risk

These are deliberately **not proved** and remain closed:

1. **Google Cloud/OAuth configuration:** operator approval of the exact project, OIDC and Drive clients, redirect URIs, branding, `openid email profile` versus `drive.file` consent separation, and OAuth verification status. No secret values belong in this packet.
2. **Credential-backed staging journey:** an approved disposable Google-only user must complete the uninterrupted browser login, Stripe test checkout if separately approved, Drive consent, folder creation, Markdown/attachment inspection, empty-cache restart, external edit/conflict, revocation/reconnect and tenant-isolation journey against one pinned image. Fake Drive cannot prove real API quota, latency, eventual-consistency or consent-screen behavior.
3. **Production deployment:** exact immutable image/digest, target, environment delta, backup and rollback require Jordi's separate approval. This branch changes no deployment or configuration.
4. **Billing:** no real card or billing object was used. Any Stripe test/live exercise requires its own approved gate and refund/cancel procedure.
5. **Public Google signup:** remains default-closed. Enabling it requires this merged acceptance SHA, live OAuth/config/legal evidence and explicit approval.
6. **Real phone transport:** local fake transport proves routing, receipts and isolation, not WhatsApp/Telegram provider delivery or session continuity. A credential-backed staging send is separate.
7. **GitHub tasking on Drive:** the supported v1 path is a verified personal GitHub App installation. Organization installations intentionally fail closed; adding them is outside this epic.

## Rollback

This ticket adds only a test runner and evidence. Reverting its commits removes the runner and packet; it does not migrate or delete data. The integrated implementation base remains separately revertible by its reviewed GDV commits. Never delete a Drive vault, credential, transaction journal, customer row, channel session or Git bundle as part of source rollback.

## Release recommendation

If full repository validation, exact PR CI and independent review pass, merge this evidence packet and mark deterministic local GDV acceptance complete. Advance only to an explicitly approved credential-backed staging exercise. Do not call Google Drive vaults deployed, publicly available or live-proved from this packet.
