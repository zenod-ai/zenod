# Zenod alpha readiness audit

Observation window: **2026-08-17 00:01–00:08 CEST**

Repository: `zenod-ai/zenod`

Audit branch/base: `codex/zal-1-readiness-audit` at `7454715a299b97ea410269b14586ac79c14334c9`

Integration target: `main`

Production surface: Dokploy `zenod-mt` / `https://cloud.zenod.dev`

Method: read-only repository, GitHub, public-HTTP, Docker service metadata, and backup-file metadata checks. No deploy, configuration change, authenticated customer-memory read, Stripe session, charge, signup, secret readout, or destructive action occurred.

## Status rubric

- **GREEN** — directly observed on 2026-08-17, or a current-base automated check passed and no live proof is required for the claim.
- **YELLOW** — implementation or earlier proof exists, but current operational or stranger-journey proof is incomplete.
- **RED** — a known acceptance failure or launch-blocking gate is currently unsatisfied. A red signup row can still mean the fail-closed safeguard is behaving correctly.
- **UNKNOWN** — the fact could not be verified safely from the available read-only surfaces.

Merged code, deployed code, and operational proof are separate facts throughout this report.

## Readiness matrix

| Surface | Status | Direct evidence | Observed | Next action |
|---|---|---|---|---|
| Current `main` | **GREEN** | `git fetch origin main` and `git rev-parse origin/main` both resolved to [`7454715`](https://github.com/zenod-ai/zenod/commit/7454715a299b97ea410269b14586ac79c14334c9); the audit worktree was clean at the same SHA. | 2026-08-17 | Treat this exact commit as the audit's integration truth; refresh before merge. |
| Deployed Zenod SHA/image | **YELLOW** | Public [`/api/health`](https://cloud.zenod.dev/api/health) returned 200 and full SHA [`7365dbc`](https://github.com/zenod-ai/zenod/commit/7365dbc1c7d869f6c78ee010e47e998f87091c4d). Docker service metadata showed `ghcr.io/zenod-ai/zenod:sha-7365dbc@sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d`, 1/1 replica, update completed. `git diff 7365dbc..7454715` contains only `AGENTS.md` and alpha/readiness documentation, so runtime code is aligned but the deployed SHA is not current `main`. | 2026-08-17 | In ZAL-4, name the exact target image and deployed SHA; do not describe `7454715` as live before deployment evidence says so. |
| Rollback image | **UNKNOWN** | Docker task history names prior tag `ghcr.io/zenod-ai/zenod:sha-6d0d2b6`, but `docker image inspect` reported it absent from the VPS and no immutable registry digest/availability was verified. The [runbook](../../PRODUCTION-READINESS.md#open-and-rollback) requires the prior immutable image and captured environment. | 2026-08-17 | Before any deploy, resolve and record an available immutable rollback digest plus a redacted environment-key snapshot; stop if the image cannot be pulled by an approved operator. |
| Landing and price truth | **GREEN** | [`https://zenod.dev/`](https://zenod.dev/) returned 200. The deployed-code source offers self-hosted free, hosted €5/month and €50/year, and disables paid buttons as “Hosted beta opening soon” unless both readiness and the public-signup flag are true ([pricing source](https://github.com/zenod-ai/zenod/blob/7365dbc1c7d869f6c78ee010e47e998f87091c4d/apps/site/src/App.tsx#L284-L342), [price source](https://github.com/zenod-ai/zenod/blob/7365dbc1c7d869f6c78ee010e47e998f87091c4d/apps/site/src/lib/customer.ts#L7-L35)). The live readiness response is false/closed. | 2026-08-17 | Keep hosted CTAs closed until ZAL-3 fixes the offer and ZAL-4 passes; change copy only if Jordi chooses a different package. |
| Terms, Privacy, and Data Handling | **GREEN** | Public [Terms](https://zenod.dev/legal/terms.html), [Privacy](https://zenod.dev/legal/privacy.html), and [Data Handling](https://zenod.dev/legal/data-handling.html) each returned 200 and display version `2026-08-13`, operator identity/contact, hosted tenant/data disclosures, billing/cancellation terms, and backup language. | 2026-08-17 | Jordi must review and explicitly acknowledge the served version in production configuration during ZAL-4; serving the files is not that acknowledgement. |
| Support surface | **YELLOW** | The public Terms and Privacy pages expose `jordi@alpha9.io`; readiness reports `support_contact: ok`. Terms also say beta/no SLA and name refund/support handling ([source](https://github.com/zenod-ai/zenod/blob/7365dbc1c7d869f6c78ee010e47e998f87091c4d/apps/site/public/legal/terms.html#L49-L64)). No stranger support request, response time, escalation path, or approved alpha support expectation was tested. | 2026-08-17 | ZAL-3 must name the support promise; ZAL-5 should test that a stranger can find the contact and understand the expectation. |
| Self-hosted onboarding | **YELLOW** | The [README quick start](https://github.com/zenod-ai/zenod/blob/7454715a299b97ea410269b14586ac79c14334c9/README.md#L43-L56) gives build/run, setup-wizard, vault PAT, model key, and MCP steps; the landing links to the install guide. No clean-machine 15-minute stranger installation was run in this audit. | 2026-08-17 | If ZAL-3 includes self-host in the alpha offer, add one clean-host install/MCP acceptance lap to ZAL-5; otherwise label it documentation-supported but outside hosted stranger acceptance. |
| Hosted onboarding | **YELLOW** | Live `/auth/signin` returned 302 to GitHub OAuth (query redacted), `/api/auth/status` returned 200 with GitHub customer auth configured, unauthenticated `/api/me` returned 401, and `/app` returned 200. The customer layer implements account-bound GitHub App/vault setup and MCP URL issuance ([source](https://github.com/zenod-ai/zenod/blob/7365dbc1c7d869f6c78ee010e47e998f87091c4d/packages/server/src/customerLayer.ts#L118-L283)). No full GitHub sign-in → repository → MCP journey was executed. | 2026-08-17 | Run the uninterrupted stranger journey only in ZAL-5 after ZAL-4 and the approved offer. |
| Stripe, portal, and subscription lifecycle | **RED** | Live [readiness](https://cloud.zenod.dev/api/public/production-readiness) reports live mode, live key, signed webhook, prices, automatic tax, and a portal verification as green, but `stripe_profile` and `live_billing_journey` are false. Current-base focused tests cover account binding, idempotent tenant provisioning, portal creation, recurring state, and signature/mode rejection: 63/63 server/customer/MCP/readiness tests passed locally after prerequisite builds. | 2026-08-17 | Under ZAL-4 and explicit approval, verify the Stripe business/support/legal profile, then perform exactly one controlled €5 real-card journey with the intended refund/cancel handling and retain only redacted evidence. |
| Public paid signup gate | **RED** | Live readiness returned HTTP 503 with `ready:false`, `publicPaidSignup:false`, and exactly 10/13 checks green. Failures are `legal_version`, `stripe_profile`, and `live_billing_journey`. The server starts fail-closed and checkout requires both flag and all checks ([gate source](https://github.com/zenod-ai/zenod/blob/7365dbc1c7d869f6c78ee010e47e998f87091c4d/packages/server/src/productionReadiness.ts#L123-L155)); the landing disables paid CTAs. | 2026-08-17 | Do not open signup. Clear all three gates with ZAL-4 evidence, then request Jordi's separate approval for `ZENOD_PUBLIC_PAID_SIGNUP=1` on the named image/environment. |
| MCP authentication boundary | **GREEN** | An unauthenticated POST to [`https://cloud.zenod.dev/mcp`](https://cloud.zenod.dev/mcp) returned 401 `{"error":"unauthorized"}`. Current-base MCP/tenant tests also passed, including rejected unauthenticated access and token-path routing. | 2026-08-17 | Recheck unauthorized rejection and authenticated initialization/tool listing on the exact ZAL-4 candidate without printing credentials. |
| Authenticated memory loop | **YELLOW** | Earlier live evidence proves authenticated tenant-scoped `tools/list`, newest-first `search_memory`, and exact `get_memory` on deployed `d4eaac4` ([2026-08-01 proof](../generic-entry-retrieval-2026-08-01/README.md)). Current-base focused MCP/customer/Zenod tests passed 63/63, but this audit intentionally did not use a production tenant credential and therefore did not prove a current live store/search/get/ask journey. | 2026-08-17 | ZAL-2 must close the known recap defect; ZAL-5 must execute the approved live tenant's store/search/get/ask journey on one exact deployed SHA. |
| Tenant isolation | **YELLOW** | Current-base chassis storage/tenant tests passed 11/11 and server/customer/Zenod/MCP tests passed 63/63, including distinct tenant settings/storage/token and browser-session boundaries. Public [Data Handling](https://zenod.dev/legal/data-handling.html) describes the same boundary. No controlled two-tenant live cross-access probe was run. | 2026-08-17 | Add explicit token A/B negative reads and suspended-tenant denial to ZAL-5, using disposable tenant data and redacted receipts. |
| WhatsApp status versus promise | **YELLOW** | Live [`phylax /api/health`](https://phylax.zenod.dev/api/health) returned 200 at SHA `399b3a8`, worker healthy, WhatsApp `connected`, receive path `ready`; earlier founder evidence proves voice capture and grounded follow-up ([2026-07-30 proof](../mechanical-capture-conversation-repair-2026-07-30/README.md)). The Zenod landing source contains no WhatsApp claim, while the [roadmap](../../ROADMAP.md#M1--whatsapp-gateway) describes it as a product milestone. Current Phylax/Ring/Zenod SHAs differ and no stranger WhatsApp onboarding is proved. | 2026-08-17 | ZAL-3 must explicitly include or exclude WhatsApp. If included, ZAL-5 must cover pairing/allowlist, voice capture, exact retrieval, support, and version-coherent evidence; otherwise keep it out of launch copy. |
| Backup and restore | **YELLOW** | Readiness reports `backup_restore: ok`. VPS metadata shows a 2026-08-14 archive plus mode-0600 checksum in root-owned `/var/backups/zenod` mode 0700; the mounted source is `zenod-mt-data:/data`. The current backup harness test passed. However, the public check exposes no exact restore timestamp, archive checksum, isolated verifier output, or proof of the required independent backup copy. | 2026-08-17 | ZAL-4 should attach a redacted drill receipt with timestamp, checksum, JSON/SQLite/health results, source image/SHA, and independent-retention confirmation; rerun if evidence cannot be reconciled. |
| Health | **GREEN** | Live [`/healthz`](https://cloud.zenod.dev/healthz) returned 200 `status:ok`; live [`/api/health`](https://cloud.zenod.dev/api/health) returned 200 and full deployed SHA. Docker reported the Zenod service at 1/1 replicas. | 2026-08-17 | Repeat after any approved configuration/deploy and record the exact SHA before progressing. |
| Recent-conversation recap trust | **RED** | The active child spine records the 2026-08-15 incorrect “what have we been talking about recently?” answer as the first alpha regression; [ZAL-2 #1059](https://github.com/zenod-ai/zenod/issues/1059) is the only linked repair ticket. Primitive July/August retrieval proof does not close this broader synthesis failure. | 2026-08-17 | Finish ZAL-2 with exact replay/trace and either a pinned fix or current-pass proof before production acceptance. |
| Required human gates | **RED** | The [active child spine](../../EPIC-ZENOD-ALPHA-LAUNCH.md#human-gates) requires separate Jordi approval for the offer/WhatsApp promise, production image/config/rollback, real-card drill, opening signup, and final external promotion. None is granted by this audit. | 2026-08-17 | Request each approval only when its exact decision packet is ready; one approval does not imply the others. |

## Operational observations

These are the redacted results used above. They are observations, not mutations or prospective verification values.

```text
origin/main = 7454715a299b97ea410269b14586ac79c14334c9
deployed health SHA = 7365dbc1c7d869f6c78ee010e47e998f87091c4d
service image = ghcr.io/zenod-ai/zenod:sha-7365dbc
service digest = sha256:33320f2435d98f2c02014f9486999b526440899226e4322bc508fd2c647dcf5d
service replicas = 1/1
prior task image tag = ghcr.io/zenod-ai/zenod:sha-6d0d2b6
prior image locally available = no
healthz = 200
api/health = 200
unauthenticated mcp POST = 401
production readiness = 503; ready=false; publicPaidSignup=false; green=10/13
failed checks = legal_version, stripe_profile, live_billing_journey
landing / terms / privacy / data handling = 200 / 200 / 200 / 200
GitHub signin / auth status / app = 302 / 200 / 200
Phylax health / WhatsApp = 200 / connected+ready
```

The laptop-side direct HTTP probes timed out during this window while the same public URLs succeeded from the VPS and the web index could open the landing page. This report therefore proves service reachability from the VPS/public edge, not from every client network.

## Smallest dependency-ordered next batch

Only the issues linked by the [Zenod Alpha Issue Ledger](../../EPIC-ZENOD-ALPHA-LAUNCH.md#issue-ledger) are used here; the repository-wide issue list is intentionally not a backlog source.

1. **Close the current truth batch:** review/merge this ZAL-1 artifact and finish [ZAL-2 #1059](https://github.com/zenod-ai/zenod/issues/1059) with the exact recent-recap replay, diagnosis, regression, and read-side immutability evidence.
2. **Make the package decision:** run [ZAL-3 #1060](https://github.com/zenod-ai/zenod/issues/1060) from this matrix. Jordi must approve the hosted/self-hosted boundary, €5/€50 or replacement price, WhatsApp inclusion/exclusion, onboarding path, and support promise.
3. **Prepare, approve, then execute the fail-closed gate:** [ZAL-4 #1061](https://github.com/zenod-ai/zenod/issues/1061) depends on ZAL-1, ZAL-2, ZAL-3, and exact production approval. Its preflight must pin the target and rollback digests, redacted environment-key delta, backup receipt, and three missing readiness gates. The real-card drill and opening signup remain separate approvals.
4. **In parallel only after ZAL-3:** [ZAL-6 #1063](https://github.com/zenod-ai/zenod/issues/1063) may draft proof-led invitation options while ZAL-4 runs. It may not publish or finalize unproved journey claims.
5. **Prove the accepted stranger journey:** after ZAL-4, [ZAL-5 #1062](https://github.com/zenod-ai/zenod/issues/1062) must prove public page → approved onboarding → tenant-bound MCP store/search/get/ask, portal where applicable, isolation negatives, support discovery, and WhatsApp only if included. Reconcile its proof into the ZAL-6 draft before requesting exact-content promotion approval.

## Validation run for this audit

```text
npx vitest run apps/site/src/lib/customer.test.ts
  1 file, 6 tests passed

bash scripts/zenod-volume-backup.test.sh
  passed

npx vitest run packages/mcp-chassis/src/sqliteTenantStore.test.ts packages/mcp-chassis/src/storage.test.ts
  2 files, 11 tests passed

npm run build -w zenod
npm run build -w @zenod/mcp-chassis
npx vitest run packages/server/test/productionReadiness.test.ts packages/server/test/customerLayer.test.ts packages/server/test/zenodUnit.test.ts packages/server/test/mcp.test.ts
  4 files, 63 tests passed
```

The first server/tenant test attempt exposed missing worktree dependencies; `npm ci` restored the locked dependency set. Server package entrypoints then required the normal prerequisite core/chassis builds, after which the focused suites passed. The worktree remained clean until this artifact was added.
