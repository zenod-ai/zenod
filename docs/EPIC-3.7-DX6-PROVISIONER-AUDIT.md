# Epic 3.7 DX-6 Provisioner Artifact Audit

Date: 2026-07-10
Worker: Epic 3.7 DX-6 artifact cleanup worker
Bound spine: `docs/EPIC-3.7-DECOMMISSION-2X.md`
Bound issue: https://github.com/zenod-ai/zenod/issues/731
Branch: `codex/epic37-dx6-provisioner-artifacts`
Base commit: `8e12ebab64140f227f9c19d5a72e5d191de8d251`
Integration target: `main`

## Summary

DX-6 removal is not safe yet. The public repo still has a live, tested 2.x
headless provisioning path:

- `ZENOD_AWAIT_PROVISION=1` makes a Node unit boot without minting its own token.
- `POST /api/provision` accepts a Console/cloud-originated token and config.
- `/api/team/enable` still provisions suite agents by calling peer
  `/api/provision`.

The replacement path is also present:

- `ZENOD_MULTITENANT=1` enables `TenantRuntimeManager`.
- `POST /api/tenants` provisions tenant rows under a single unit container.
- `/mcp/:token` resolves the tenant token and dispatches to the tenant runtime.

Because DX-3, DX-4, and DX-5 are still blocked on their unit cutovers, this audit
does not delete the old path. The recommended next patch set is to gate and then
remove these artifacts only after the retirement waves prove no production caller
uses them.

## Audit Commands

```sh
rg -l --hidden --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!coverage' -i "ZENOD_AWAIT_PROVISION|AWAIT_PROVISION" .
rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!coverage' "ZENOD_AWAIT_PROVISION|AWAIT_PROVISION|awaitProvision|await_provision|/api/provision|provision" packages apps units scripts docker-compose*.yml docs/EPIC-2.9-EPAMINON-MOVE-0.md docs/EPIC-2.4-CALLISTHENES-MOVE-0.md
rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!coverage' -i "watchdog|healthz|health check|register.*watch|watch.*register|systemd|timer" packages apps units scripts docs docker-compose*.yml
rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!dist' --glob '!build' --glob '!coverage' -i "cloudflare|dns|subdomain|domain|c-<slug>|e-<slug>|z-<name>|customDomain|traefik|tls|hostnames?" packages apps units scripts docker-compose*.yml docs/EPIC-2.3-ZENOD-MOVE-0.md docs/EPIC-2.4-CALLISTHENES-MOVE-0.md docs/EPIC-2.9-EPAMINON-MOVE-0.md docs/MCP-CHASSIS-SPEC.md docs/final-container-map-deck.html
rg -n "createApp\\(|tenantManager|TenantRuntimeManager|CONTROL_PLANE_TOKEN|/api/tenants" packages/server/src packages/server/test packages/mcp-chassis
```

## Current Callable Artifacts

| Artifact | Path | Status | Recommendation |
|---|---|---|---|
| Headless provisioning env flag | `packages/server/src/settings.ts` | Live. `awaitingProvision()` is keyed by `ZENOD_AWAIT_PROVISION=1`; `seedFromEnv()` suppresses self-minting while awaiting provision. | Keep until DX-3..DX-5 prove all unit tenants are migrated. Then remove `awaitingProvision`, `applyProvision`, and the env flag. |
| Open `/api/provision` route | `packages/server/src/app.ts` | Live. Auth middleware deliberately allows this route while awaiting provision. | Do not remove yet. Later replace with `/api/tenants` only, guarded by `CONTROL_PLANE_TOKEN`. |
| Suite-agent provisioning call site | `packages/server/src/app.ts` | Live. `/api/team/enable` mints a token and calls `${sa.internalBaseUrl}/api/provision`. | Requires chassis/suite redesign before removal. This is not only cloud provisioner residue. |
| Headless provisioning tests | `packages/server/test/provision.test.ts`, `packages/server/test/settingsZd9.test.ts` | Live tests describe and enforce 2.x behavior. | Replace with `/api/tenants` tests after cutover; keep as regression coverage until then. |
| Multi-tenant replacement | `packages/server/src/tenantRuntime.ts`, `packages/server/src/main.ts`, `packages/server/src/app.ts` | Present. `ZENOD_MULTITENANT=1` creates a tenant registry and `/api/tenants`. | Expand tests and make this the only hosted provision path before deleting `/api/provision`. |

## Deployable 2.x Templates

These files are not merely historical docs; they are runnable compose templates or
unit deployment templates with per-user/per-unit assumptions.

| Path | Evidence | Risk |
|---|---|---|
| `docker-compose.tenant.yml` | Full per-paying-tenant stack, per-stack network, `z-<name>.zenod.dev`, sibling agents with `ZENOD_AWAIT_PROVISION=1`. | Must stay until DX-1/DX-2 identify dead/test tenants and DX waves retire live stacks. |
| `docker-compose.zenod-standalone.yml` | Thin standalone per-user Zenod; default `ZENOD_AWAIT_PROVISION=1`; domain added by API. | Directly tied to Z-2/ZD-8 provisioner. Remove or move to archived runbook after Z-MT-6. |
| `units/callisthenes/docker-compose.callisthenes.yml` | Hosted provisioner handoff env; `c-<slug>.zenod.dev` OAuth callback. | Blocked by CA-MT-6. |
| `units/epaminon/docker-compose.hosted.yml` | Hosted Epaminon unit template for cloud provisioner; unique container/domain per customer. | Blocked by E-MT-7/DX-5. |
| `docker-compose.epaminon.yml`, `docker-compose.phylax.yml`, `docker-compose.outbound.yml`, `docker-compose.archus-agent.yml`, `docker-compose.zenod-z2.yml`, `units/zenod/docker-compose.zenod.yml`, `units/herald/docker-compose.herald.yml` | Use `ZENOD_AWAIT_PROVISION=1` for headless unit boot. | Some are suite-internal, not strictly per-customer SaaS instances. Audit with the relevant unit steward before deletion. |

## DNS And Dokploy Minting

No public-repo script was found that directly calls Cloudflare or a DNS provider
to mint per-tenant records. The concrete Dokploy/domain automation is referenced
as private `zenod-ai/cloud` code:

- `docs/EPIC-2.3-ZENOD-MOVE-0.md`: `provision-standalone.mjs`,
  `domain.create`, `z-<name>.zenod.dev`.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md`: `scripts/provision-callisthenes.mjs`,
  `domain.create`, `c-<slug>.zenod.dev`.
- `docs/EPIC-2.9-EPAMINON-MOVE-0.md`: `scripts/provision-epaminon.mjs`,
  `e-<slug>.zenod.dev`.

Public-repo cleanup can tombstone templates and docs, but actual DX-6 deletion
must include the private cloud provisioner scripts and any Dokploy `domain.create`
call sites.

## Watchdog Artifacts

| Artifact | Path | Status | Recommendation |
|---|---|---|---|
| Host watchdog | `scripts/watchdog/zenod-watchdog.sh`, `.service`, `.timer`, `install.sh` | Still needed. It is the host-level outage reporter. Defaults currently watch `c1`, `z2`, and a static container list. | Do not delete. After DX-7, update defaults to the canonical static unit fleet only. |
| Per-tenant registration docs | `units/PROVISIONING-RUNBOOK.md`, `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md`, `docs/HERALD-BUY-BUTTON-PLAN.md` | Historical/2.x operational instructions still mention appending tenant containers and URLs. | Tombstone as legacy once DX-1/DX-2 inventory is complete; replace with static `/healthz` list runbook. |
| Chassis target | `docs/MCP-CHASSIS-SPEC.md`, `docs/final-container-map-deck.html` | Defines replacement: one hostname per unit, static watchdog checks, no registration API. | Keep as target authority. |

## Safe Patch Assessment

No production-code removal is safe in this ticket.

Reasons:

- `/api/provision` is still reachable by design while `ZENOD_AWAIT_PROVISION=1`.
- `/api/team/enable` still depends on `/api/provision` for suite peer agents.
- Multiple runnable compose templates still boot in await-provision mode.
- DX-3..DX-5 retirement waves have not completed, so live per-user deployments may
  still depend on the old control-plane and watchdog assumptions.
- The Dokploy/DNS removal work is partly outside this repo in `zenod-ai/cloud`.

The safe output of this pass is this audit artifact plus a follow-up patch plan.

## Recommended Follow-Up Patches

1. After Z-MT-6, CA-MT-6, and E-MT-7 pass, add a failing grep test that rejects
   `ZENOD_AWAIT_PROVISION`, `/api/provision`, `provision-standalone.mjs`,
   `provision-callisthenes.mjs`, `provision-epaminon.mjs`, `domain.create`, and
   per-tenant hostname patterns outside archived docs.
2. Replace `packages/server/test/provision.test.ts` with `/api/tenants` coverage:
   control-plane auth, token hash lookup, tenant data dir creation, duplicate
   token rejection, and `/mcp/:token` tenant routing.
3. Remove `Settings.awaitingProvision()` and `Settings.applyProvision()` after all
   callers move to tenant-row provisioning or explicit self-host env seeding.
4. Replace `/api/team/enable` peer-agent provisioning with the 3.x suite/wallet
   model, or explicitly scope it as local self-host mesh behavior if it survives.
5. Archive or delete per-user compose templates after DX inventory confirms no
   active Dokploy app is created from them.
6. In `zenod-ai/cloud`, delete per-customer Dokploy app creation, `domain.create`,
   watchdog-target receipt emission, and per-unit provisioner scripts; replace
   Stripe webhook handling with `POST /api/tenants` calls to each unit.
7. Update `scripts/watchdog/zenod-watchdog.sh` defaults and operational docs to
   the canonical static fleet from `docs/final-container-map-deck.html`.

## Residual Risk

The public repo alone cannot prove whether private cloud provisioners are still
called in production. DX-6 needs a companion audit in `/Users/jordi/Documents/GitHub/cloud`
or the active `zenod-ai/cloud` checkout before any destructive deletion is merged.
