# MCP Chassis — write the server art once, reuse it per unit

Status: HISTORICAL — the chassis as a separate project was dissolved into Zenod (2026-07-11, Jordi). Do not build from this document. Active work: `docs/EPIC-Z-NIGHT-SPRINT.md`.
Created: 2026-07-09
Author: Claude (Cowork session with Jordi)
Bound spine for routing: `docs/EPIC-0-FOUNDATION-SPINE.md` (this doc is a proposed decision + cross-spine update source; child spines adopt via their own stewards)

## Why this document exists

Decision context (2026-07-09 session): Option B was chosen — one container per **unit**, multi-tenant within, replacing Law 7's instance-per-user. Jordi's requirement: *"can we have code written once, used multiply? …strong robust baseline, each guy re-uses scaffolding to bring up a function, but devops-wise same flow. I want to standardize, not do the same thing 5 times."*

Key finding from the code survey: **the chassis mostly already exists.** Zenod, Epaminon, Phylax, and Ring are one Node 22/TypeScript image (`packages/server`, `@modelcontextprotocol/sdk` + Hono) selected by `AGENT=` env, with stateless Streamable HTTP at `/mcp` on 8080, shared `requireMcpAuth` bearer/OAuth middleware, and SQLite files on `/data`. Only Callisthenes is a separate stack (Python 3.12 / FastMCP wrapping upstream `xmcp`).

So the work is: **extract and name the shared layer, add tenancy to it once, and pin the contract** — not build a framework from scratch.

## The two-layer standard

### Layer 1 — `@zenod/mcp-chassis` (code, Node units)

A new workspace package in the existing monorepo (fits RD-4: split later with `git filter-repo` once stable). Extracted from what `packages/server` already does, plus the multi-tenant upgrade. The chassis owns:

1. **HTTP + MCP transport.** Hono app, stateless `StreamableHTTPServerTransport` per request at `/mcp`, health endpoint, port from `PORT` (default 8080). (Exists — extract from `app.ts`.)
2. **Auth + tenancy.** `requireMcpAuth` upgraded: resolve `tenant_id` from `sha256(bearer)` against the tenants table (the #645 pattern), or from tokened URL `/mcp/<token>` (ZD-8), or OAuth token → tenant. Attach `tenant` to request context. Constant-time compare, `WWW-Authenticate` on 401. (Exists minus the tenants-table lookup.)
3. **Tenants table + provisioning API.** `tenants(token_hash, tenant_id, plan, quota, status, created_at)` in a chassis-owned SQLite/Postgres. Endpoints: `POST /api/tenants` (control-plane only — Stripe webhook inserts here), `DELETE`/suspend, token rotate. Replaces the Dokploy provisioner and `ZENOD_AWAIT_PROVISION` push flow.
4. **Tenant-scoped storage handles.** The unit never touches paths or connections directly; it asks the chassis for `storage.db(tenant)` and `storage.dir(tenant)` → `/data/<tenant_id>/…`. Single-tenant self-host = same API with one implicit tenant (from `ZENOD_API_TOKEN` env). **This one API is what makes hosted and self-hosted the same product.**
5. **Vault.** Per-tenant authenticated encrypted world-key custody (Law 6), keyed by `tenant_id`. The stable master key is injected from outside `/data`; it is never generated or persisted beside ciphertext. Missing, wrong, or changed keys fail closed before mutation. Only the unit that owns a key class may read it.
6. **Metering + throttle.** Per-tenant usage ledger (`usage.sqlite` pattern, tenant-keyed), quota check middleware, warn/block-at-zero.
7. **Observability.** Pino logging with `tenant_id` on every line; `/healthz`; per-tenant request counters.

A unit then is only:

```ts
import { createUnit } from "@zenod/mcp-chassis";

createUnit({
  name: "epaminon",
  tools: (server, ctx) => { /* register MCP tools; ctx.tenant, ctx.storage, ctx.vault */ },
});
```

The existing `AGENTS` map already proves this shape works — `createUnit` is `resolveAgent` formalized, with tenancy injected.

### Layer 2 — SEAM-SPEC vNext (contract, ALL units including Python)

Callisthenes stays Python (it wraps upstream `xmcp`; rewriting it buys nothing). Standardization across stacks is by **contract**, not shared code. Every unit — any language — MUST expose:

| Contract item | Requirement |
|---|---|
| Transport | Streamable HTTP at `/mcp`, stateless per request |
| Auth | `Authorization: Bearer` (or `/mcp/<token>` URL form); tenant = `sha256(bearer)` lookup; 401 + `WWW-Authenticate` otherwise |
| Tenancy | Every read/write scoped by `tenant_id`; no client-supplied tenant arguments (the #645 rule) |
| Provisioning | `POST /api/tenants` guarded by a control-plane token; new customer = insert, never a deploy |
| Storage | All state under `/data/<tenant_id>/` or tenant-keyed rows; one volume per unit |
| Health | `GET /healthz` → 200 + version. One watchdog per **unit** (5 checks total, static list — the watchdog registration problem dissolves) |
| Config env | `PORT`, `<UNIT>_DATA_DIR=/data`, `CONTROL_PLANE_TOKEN`, single-tenant seed token var, stable unique-per-unit 32-byte `CHASSIS_VAULT_MASTER_KEY` or equivalent external key |
| Container | One Dockerfile per unit, `EXPOSE <port>`, `VOLUME /data`, `restart: unless-stopped` |
| DNS | One hostname per unit (`<unit>.zenod.dev`); no per-tenant records |
| Deploy | One Dokploy application per unit; deploy = rebuild that one app |

Callisthenes already satisfies more of this than the Node units (its bearer-header-is-tenant design is the model); it needs the tenants-table lookup and `/api/tenants` added to its `auth/token_store.py`, which is a small patch, not a rewrite.

### DevOps flow (identical for every unit)

1. Merge to `main` → Dokploy rebuilds the unit's single application (5 apps total).
2. Stripe webhook → control plane calls `POST /api/tenants` on each unit the customer bought → mints token → emails `https://<unit>.zenod.dev/mcp/<token>`.
3. Watchdog: 5 static `/healthz` checks. No registration API needed.
4. Self-host: `docker run -e <UNIT>_API_TOKEN=… -v data:/data <unit-image>` — same image, tenant count of 1.

## Isolation exceptions (amended Law 7)

> One container per unit, multi-tenant within. Exceptions: **Epaminon job sandboxes** (ephemeral container per task, destroyed after evidence is persisted — the API front stays multi-tenant on the chassis) and **Phylax** (one container per phone number operated; users are whitelist rows, never containers).

## Migration order

1. **Chassis extraction** (`packages/mcp-chassis`): lift transport/auth/settings from `packages/server`; add tenants table, tenant-scoped storage, `/api/tenants`. The `AGENT` map keeps working during the transition.
2. **Callisthenes conformance** (first proof, easiest): tenant lookup in `token_store.py`, `/api/tenants`, tenant-keyed throttle + ledger. It is stateless key-custody — the cleanest multi-tenant case.
3. **Zenod on chassis**: tenant-prefix the SQLite set and vault clone (`/data/<tenant>/vault`); the media/ingest paths follow the storage handle.
4. **Epaminon**: API on chassis; execution moves to per-job spawned containers (compose service template or `docker run` from the API), transcript/evidence persisted to tenant storage before teardown.
5. **Control plane simplification** (`zenod-ai/cloud`): Stripe webhook → `/api/tenants` calls. Delete the Dokploy provisioner, per-tenant DNS minting, watchdog registration (ZD-10), and `ZENOD_AWAIT_PROVISION` push flow.
6. **Ring/Phylax**: near-no-op; Ring adopts chassis when its real agent lands; Phylax stays as-is minus per-user framing.

## Proposed cross-spine updates (for stewards to adopt)

| Target spine | Proposed change |
|---|---|
| `EPIC-2.5-ATOMIC-UNITS.md` | Amend Law 7 as above. Add chassis + SEAM-SPEC vNext as the unit standard: "one unit = one multi-tenant container = one repo = one hostname." Record that the Law-7 exception fired at Move-0, pre-scale, deliberately. |
| `EPIC-2.3-ZENOD-MOVE-0.md` | Replace Z-1 Dokploy-per-tenant provisioning with `/api/tenants`. Retire ZD-6's ~100-user ceiling and ZD-10 watchdog registration. Keep ZD-8 tokened URL (unchanged for clients). Add tenant-prefixed `/data` task. |
| `EPIC-2.4-CALLISTHENES-MOVE-0.md` | Add conformance ticket: tenants table + `/api/tenants` + tenant-keyed throttle/ledger. Its bearer-is-tenant design is adopted as the suite-wide pattern. |
| `EPIC-2.9-EPAMINON-MOVE-0.md` | Split into multi-tenant API (chassis) + per-job sandbox executor. Remove `ZENOD_AWAIT_PROVISION` idle-until-provisioned model. |
| `EPIC-0-FOUNDATION-SPINE.md` | Record the Option-B decision, this spec as evidence, and the migration order as the dispatch sequence. |

## What this kills (stop building)

- Per-tenant Dokploy provisioning + its failure recovery (the "compose record but no container" class of bug)
- Per-tenant subdomains, DNS minting, TLS sprawl
- Watchdog registration API and per-instance watchdog fleet
- The hosted/self-hosted divergence
- M-redeploys per code change

## Open questions for Jordi

1. Chassis DB: stay SQLite-per-unit on `/data` (zero new infra) or one shared Postgres now? SQLite is fine to hundreds of tenants; Postgres earns its keep when you want row-level security and one place to look.
2. Control-plane token custody: keep in `zenod-ai/cloud` env, or move into the keyring vault?
3. Epaminon sandbox spawner: Docker socket from the API container (simple, powerful — guard it) vs a tiny host-side runner service?
