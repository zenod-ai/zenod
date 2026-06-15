# Hosted / Multi-Tenant Zenod Spike

Status: target design, 2026-06-15. Source issue: [zenod-ai/zenod#122](https://github.com/zenod-ai/zenod/issues/122).

## Executive Decision

The early hosted product should be a managed provisioning wrapper around the existing self-hosted Zenod image, not a rewrite of the engine into a shared SaaS runtime. The first paid-customer milestone is:

> A production-ready early-pass Zenod container image can be spun up for a paying customer in under 5 minutes.

The hosted control plane may live in a separate private repo, as the roadmap already says, but this repo owns the reusable image contract and the runtime seams that make hosted provisioning possible. The control plane should start by provisioning one isolated runtime per tenant. Shared multi-tenant engine processes can remain a later optimization.

## Source Provenance

Vault sources used through read-only Zenod memory tools:

| Source | Evidence used | URL |
|---|---|---|
| `Projects/Zenod/Zenod Agent Handoff.md` | Older hosted architecture option: one multi-tenant container on Dokploy/VPS, Postgres state, per-user workdirs, serialized queues, platform Anthropic key with per-user metering. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/Zenod%20Agent%20Handoff.md |
| `Projects/Zenod/Market Landscape.md` | Hosted offering is an M3 differentiator; Basic Memory cloud pricing anchors the expected hosted market; Zenod differentiates through server-enforced librarianship, git provenance, and agent-mode answers. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/Market%20Landscape.md |
| `Projects/Zenod/Story & Slides.md` | Story constraints: self-host is one Docker container; hosted is managed/provisioned with the same engine and same owned repo; writes are gatekept and reads remain open. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/Story%20%26%20Slides.md |
| `Areas/Positioning & Story.md` | Hosted UX should be no-terminal: connect WhatsApp, connect or create a vault, start talking; avoid overclaiming hosted readiness before it exists. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Areas/Positioning%20%26%20Story.md |
| `Log/2026-06-14.md` | Exact discussion receipts for direct/via-agent entry, Zenod stopping at backlog creation, hosted/self-host slide 11a, and deployed-state facts. Key refs: `^e-128b9b`, `^e-843083`, `^e-ce1046`, `^e-17300f`. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-14.md |
| `Notes/Memory Mining and Queue Drainage.md` | Boundary: Zenod preserves state and context; queue drainage, orchestration, verification, and incentive routing belong to Nectary/Executor-side systems. | https://github.com/AlfaBlok/obsidian-brain/blob/main/Notes/Memory%20Mining%20and%20Queue%20Drainage.md |

Repo sources used:

- [README.md](../README.md): this repo is open-source self-hosted Zenod; hosted is a separate product/repo that wraps this engine.
- [ROADMAP.md](ROADMAP.md): M3 is hosted Zenod with multi-tenant shell, GitHub App, Stripe, provisioning, and platform-key metering.
- [M0-PLAN.md](M0-PLAN.md): current image is one container plus one volume with SQLite; Postgres is a future hosted implementation behind `StateStore`.
- [M0-SPEC.md](M0-SPEC.md): `BrainRuntime`, `StateStore`, and per-user write queues are the engine seams hosted must preserve.

## Architecture Options Observed

### Option A: Shared Multi-Tenant Container

Run one Zenod server process for many tenants. Store settings, conversations, usage, job state, and leases in Postgres. Keep one vault workdir per tenant, serialize writes per tenant, and meter all platform-key LLM calls per user.

Pros:

- Lowest operations overhead for an early private alpha.
- Closest to the 2026-06-10 handoff note.
- Lets hosted add Postgres `StateStore` without changing the engine API.

Cons:

- Strong isolation depends on application-layer tenancy in every route, queue, filesystem path, and tool call.
- Noisy-neighbor and runaway-job failures are harder to contain.
- Secret, OAuth, and token mistakes can cross tenants if any code path misses tenant scoping.

Use only for internal or extremely small invite alpha if deployment speed matters more than isolation.

### Option B: Single Image Per Customer Runtime

Use the same production Zenod image, but provision one runtime per paying customer. Each tenant gets isolated environment variables/secrets, one persistent data volume or bucket namespace, one vault workdir, one MCP/API endpoint, and independent restart/delete lifecycle. The control plane owns routing, billing state, GitHub App installation mapping, usage collection, and runtime lifecycle.

Pros:

- Best early-pass isolation with minimal engine changes.
- Aligns with the current self-host product: one Docker image, one tenant, one vault, one write queue.
- Easy customer-level lifecycle: create, suspend, restart, destroy, snapshot.
- Easier to hit the first paid-customer acceptance target: spin up an image in under 5 minutes.

Cons:

- Higher baseline infra cost per tenant.
- Requires a real control plane earlier.
- Requires standardized runtime contract for health, setup status, secrets, usage export, and tenant metadata.

Recommended early target.

### Option C: Cloudflare Container / Actor-Style Runtime

Provision each tenant as an isolated Cloudflare container, Durable Object, or similar per-customer actor. Use external durable state for vault clone/storage, settings, and usage if the runtime filesystem is not enough. Keep the `BrainRuntime` seam clean so this can replace a Docker/VPS runtime later.

Pros:

- Strong conceptual fit for per-tenant actors.
- Potentially clean lifecycle and network isolation.
- May reduce custom orchestration if platform primitives fit.

Cons:

- Platform constraints and maturity need a separate proof.
- Git workdirs, long LLM calls, ripgrep, and persistent volumes may not map cleanly.
- Risky for the first paid customer if the main unknown is platform behavior, not Zenod.

Treat as a proving track, not the first target.

### Option D: Nectary-Backed Metering and Provisioning

Use Nectary as the incentive/billing/orchestration shell around Zenod: mined backlog items become issue-bound work; service usage becomes metered credit or repayment flow; execution receipts return to memory.

Pros:

- Fits the broader Zenod/Nearchus/Epaminon/Nectary loop.
- Makes contribution, verification, and repayment auditable through issues and receipts.

Cons:

- Too broad for hosted Zenod provisioning.
- Financing/accounting/legal decisions are still unsettled.
- Does not replace basic tenant lifecycle, isolation, or billing hooks.

Keep Nectary as an integration boundary for later. Hosted Zenod M3 should expose usage and lifecycle events that Nectary can consume, but must not depend on Nectary to provision the first paying customer.

## Target Early-Pass Architecture

```text
Customer signup / checkout
        |
        v
Hosted control plane
  - tenant record
  - Stripe customer/subscription
  - GitHub App installation
  - WhatsApp/Drive connector settings
  - platform LLM usage budget
  - runtime lifecycle state
        |
        v
Tenant runtime manager
  - create isolated Zenod runtime from production image
  - mount/create tenant data volume
  - inject tenant secrets
  - route https://<tenant>.zenod.dev
  - poll health and setup status
        |
        v
Per-tenant Zenod runtime
  - same engine and MCP/API surface
  - one vault repo/workdir
  - one serialized write queue
  - one settings/state database or hosted StateStore adapter
  - usage event export
        |
        v
Customer-owned GitHub vault repo
```

The control plane is not the memory engine. It should not write vault files directly. It creates and supervises tenant runtimes, manages payments/secrets/installations, and consumes runtime telemetry.

## Minimal Viable Control Plane

Required for the first paid customer:

1. Tenant registry: tenant id, owner email, plan, lifecycle status, runtime id, base URL, vault repo, GitHub installation id, created/suspended/deleted timestamps.
2. Runtime lifecycle: provision, health check, restart, suspend, destroy, and snapshot/export tenant state.
3. Image contract: a versioned Zenod image tag plus required env vars, writable data mount, health endpoint, setup status endpoint, MCP/API endpoint, and usage event sink.
4. Secret management: platform Anthropic key or per-tenant key mode, GitHub App credentials, per-tenant OAuth tokens, MCP token rotation, webhook secrets.
5. GitHub App onboarding: install app, create or select vault repo, grant repo-scoped access, seed vault schema if empty.
6. Per-tenant vault isolation: one vault repo and one runtime data namespace per tenant; no shared workdirs; no cross-tenant filesystem access.
7. Billing hooks: Stripe customer/subscription state, trial/free quota, payment success/failure webhooks, suspend-on-nonpayment path.
8. Usage metering: record LLM provider/model/tokens/cost/operation/tenant id; expose tenant-visible usage; enforce hard monthly spend ceiling before provider calls.
9. Connector lifecycle: WhatsApp, Drive, MCP, and future connectors must bind to one tenant id and be revocable without touching other tenants.
10. Audit trail: provisioning events, secret rotations, billing state changes, runtime restarts, vault setup commits, and usage summaries.

Deferred from the first paid customer:

- Shared multi-tenant engine process.
- Cloudflare actor migration.
- Cost optimization beyond basic suspend/delete.
- Enterprise org/team accounts.
- Cross-tenant analytics beyond aggregate operational metrics.
- Nectary financing/repayment flows.

## Runtime Contract This Repo Should Preserve

The self-hosted image should remain directly runnable, but hosted needs a stricter contract:

| Area | Required hosted contract |
|---|---|
| Configuration | All runtime configuration can be supplied from env vars or mounted secret files on first boot. |
| State | `StateStore` stays abstract so hosted can swap SQLite for Postgres without engine changes. |
| Vault workdir | Every runtime can be pointed at one tenant-scoped data dir; no global workdir assumptions. |
| Queueing | Writes remain serialized per tenant/vault. Reads do not require global locking. |
| Health | `/health` distinguishes process up, setup complete, vault reachable, and provider reachable. |
| Usage | LLM calls emit tenant, operation, provider, model, input/output/cache tokens, cost estimate, and request correlation id. |
| Setup | First-run setup can be driven non-interactively by the control plane after GitHub App install. |
| Auth | MCP/API bearer tokens can be generated/rotated by control-plane input, not only clicked in the UI. |

## Blocked Engineering Work and Dependencies

Ready to execute in this repo:

- Add/verify non-interactive setup bootstrap for hosted provisioning.
- Add/verify health/setup endpoints that expose enough state for a runtime manager.
- Harden usage-event schema so every LLM call can be attributed to a tenant/runtime.
- Keep `StateStore` and `BrainRuntime` boundaries clean while adding hosted-specific adapters later.
- Add image smoke tests that boot a fresh container, configure a scratch vault, and assert MCP health.

Needs human/product decision before implementation:

- Hosting substrate for the first paying customer: Dokploy/Fly/Render/Railway/Cloudflare Containers/other.
- Whether early hosted uses platform Anthropic key only, BYO key only, or both.
- Whether tenant identity is individual-only at launch or supports organizations.
- Whether hosted creates vault repos for customers or only connects existing repos.
- Whether the first hosted alpha must include WhatsApp onboarding, or MCP/web setup is enough.
- Billing provider assumptions: Stripe is named in the roadmap, but exact plan/free-trial/quota policy is not specified.

Blocked until separate system exists:

- Nectary-backed metering, credits, repayment, and issue-bound financing.
- Executor-side fan-out/fan-in beyond demo loops.
- Production-scale cost optimization, autoscaling, and shared runtime packing.

## Follow-Up Ticket

Implementation ticket to reference from this spike: [zenod-ai/zenod#122](https://github.com/zenod-ai/zenod/issues/122) until the controller creates a narrower provisioning issue. The concrete acceptance criterion for that implementation ticket should be:

> A production-ready early-pass container image can be spun up for a paying customer in under 5 minutes.

Suggested title for the narrowed implementation issue:

> Hosted provisioning: spin up isolated paying-customer Zenod runtime in under 5 minutes

Suggested body:

```markdown
## Objective
Build the first hosted provisioning path around the existing Zenod image.

## Acceptance criteria
- A production-ready early-pass Zenod container image can be spun up for a paying customer in <5 min.
- The provisioned runtime is isolated to one tenant data namespace and one vault repo.
- The control-plane path can inject first-run settings non-interactively.
- Health/setup endpoints report process, setup, vault, and provider readiness.
- LLM usage events include tenant/runtime id, operation, model, tokens, cost estimate, and correlation id.
- Suspend/restart/destroy lifecycle actions are documented or wired in the chosen runtime manager.

## Out of scope
- Shared multi-tenant engine process.
- Cloudflare migration unless chosen as the first runtime substrate.
- Nectary financing/repayment flows.
- Production-scale cost optimization.

## Source
Derived from docs/HOSTED-MULTI-TENANT-SPIKE.md and zenod-ai/zenod#122.
```

## Ticket State Recommendation

This spike is ready-to-execute for the next implementation ticket only after the human chooses the first hosted substrate and key policy. Until then, the design is complete but provisioning implementation is blocked on those product/platform decisions.
