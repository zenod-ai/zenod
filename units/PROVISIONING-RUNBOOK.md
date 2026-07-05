# Fresh-user provisioning runbook (Epic 2.5 · W-E)

Owner: Epic 2.5 ([../docs/EPIC-2.5-ATOMIC-UNITS.md](../docs/EPIC-2.5-ATOMIC-UNITS.md), ticket W-E).
Status: v1, 2026-07-05. Target: a brand-new user provisioned from scratch in **< 30 min, no code
edits**, every step emitting a receipt (container ID / token ID / repo URL).

## What this runbook provisions

The Epic-2.5 exit criterion needs a fresh user standing up **ring + council guy + Zenod**, wired via
the keyring, callable over the public seam. Two topologies exist:

- **CURRENT (works today, this runbook's live path):** the suite ships as one `AGENT`-switched
  image; a fresh user is one isolated Docker Compose stack — `docker-compose.tenant.yml` — that
  boots `console + zenod + archus + epaminon + phylax + outbound` on a private per-tenant network
  (the network IS the tenant boundary). This is the Epic-2 H-1 concierge path (I1-4 PASS,
  fresh tenant end-to-end < 30 min). The "console" here is the fused ring+council.
- **TARGET (Epic-2.5, staged behind the RD-4 split trigger):** ring-core, Phylax, the council guy,
  and Zenod become separate compose units (`units/ring/`, `units/council/`, `units/zenod/`). When
  the physical carve lands, the ONLY change to this runbook is swapping the single `console` service
  for `ring` + `council`, each with its keyring-issued token. The provisioning shape — one isolated
  stack per user, tokens minted by the Console/keyring, agents idle until enabled — is unchanged.
  Forward-deltas are marked **[TARGET]** below.

Follow the CURRENT path top-to-bottom; it is self-contained.

---

## Preconditions (one-time, not per-user)

- Dokploy reachable; `dokploy-network` exists (the shared attachable overlay for Traefik ingress).
- Published image `ghcr.io/zenod-ai/zenod:latest` exists (CI `publish.yml` produces it on merge to
  main). Pin an immutable `sha-<tag>` for reproducibility.
- DNS wildcard `*.zenod.dev` → the Dokploy host (so `z-<name>.zenod.dev` resolves).
- Templates in this repo: [../docker-compose.tenant.yml](../docker-compose.tenant.yml) and
  [../.env.tenant.example](../.env.tenant.example).

## Steps (per new user — target < 30 min)

**1 · Name the tenant.** Pick `<name>` (e.g. `acme`). Everything namespaces off it.
Receipt: the chosen `<name>`.

**2 · Create the Dokploy Compose service.** New Compose service from
`docker-compose.tenant.yml`; project name `tenant-<name>` (this namespaces volumes + service DNS,
so the stable service names never collide across tenants).
Receipt: Dokploy service ID/URL.

**3 · Set env.** Copy `.env.tenant.example` into the service's env box and fill:
- `ZENOD_IMAGE_TAG` — `latest` or a pinned `sha-…`.
- `TENANT_NAME=<name>` (cosmetic label only).
- `PHYLAX_CONSOLE_TOKEN` — leave BLANK on first boot (filled in step 6).
- Zero-touch model (optional, recommended): `ZENOD_PROVIDER=openrouter` +
  `OPENROUTER_API_KEY=<tier-capped per-tenant key>` so the council responds with no manual Model
  step. Unset → self-host default (enter an LLM key in the UI at step 5).
Receipt: the env keys set (values redacted).

**4 · Add the domain + deploy.** Domain `z-<name>.zenod.dev` → service `zenod-console`, port `8080`;
Dokploy wires Traefik + TLS. Deploy.
Receipt: the 6 container IDs (`zenod-console/-zenod/-archus/-epaminon/-phylax/-outbound`) + the
live `https://z-<name>.zenod.dev` responding over TLS.

**5 · First-run Console setup (in the UI).** Set an admin password; if you did not pre-provision the
model key, enter the LLM key now. Then **enable** each agent — they idle un-provisioned until the
Console mints + pushes their per-unit tokens (this IS the keyring issuing agent→unit tokens, law 6c).
Receipt: the minted token IDs (one per enabled agent) + the Console `api_token`.

**6 · Wire the Phylax delivery bridge.** Set `PHYLAX_CONSOLE_TOKEN` to the Console's own `api_token`
(from step 5) and redeploy the Phylax service (T8/#456 automates this; until then it is manual).
Receipt: Phylax redeploy ID; a `send_to_user` test delivery.

**7 · Pair the channel + name the memory repo.** In the keyring UI: pair WhatsApp (Phylax QR) and/or
Telegram; set the Zenod vault repo (`vault_repo` + a repo `github_token` scoped to it — only Zenod
holds this, law 6b).
Receipt: the paired channel handle + the vault repo URL.

**4b · Register with the fleet watchdog (law `3b4da80`).** The host watchdog watches a STATIC list
(`scripts/watchdog/zenod-watchdog.sh:32-33`), not by discovery — a new tenant is invisible to it until
added. On the VPS host, APPEND this tenant's containers to `ZENOD_WATCHDOG_CONTAINERS` and
`https://z-<name>.zenod.dev/api/health` to `ZENOD_WATCHDOG_HEALTH_URLS` in `/etc/zenod-watchdog.env`,
then force one pass (`sudo systemctl start zenod-watchdog.service`). Stale entries can't false-page
(watchdog skips absent containers, `zenod-watchdog.sh:129`). Full drill + receipts:
[../docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md](../docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md) Part A.
Receipt: the `/etc/zenod-watchdog.env` diff + a watchdog journal line showing the new health URL at 200.

**[TARGET] delta once extraction lands:** step 4's `zenod-console` becomes two services `ring`
(serves the web UI + keyring, port 8080) and `council` (headless, seam-only); step 5 enables
`ring → {council}` and `council → {zenod, archus, epaminon}` token sets; everything else identical.

## Acceptance (what "provisioned" means)

- `https://z-<name>.zenod.dev` loads over TLS; the council answers in web chat.
- All 6 (TARGET: 7) containers healthy on the private `tenant-net`; only the Console/ring joins
  `dokploy-network`.
- Every step above produced its receipt. Total wall-clock < 30 min.

## Teardown

**Deregister from the watchdog FIRST** (law `3b4da80`): remove this tenant's containers + health URL
from `/etc/zenod-watchdog.env` and clear its alert state (`sudo rm -f
/var/lib/zenod-watchdog/alert.*z-<name>* /var/lib/zenod-watchdog/restarts.*<name>*`) so the watchdog
does not page on the intentional teardown. See
[../docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md](../docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md) Part A.2.
Receipt: the `/etc/zenod-watchdog.env` diff showing the tenant's entries removed.

Then delete the Dokploy Compose project `tenant-<name>` (removes containers + namespaced volumes). The
user's memory survives independently — it lives in their own vault git repo, not a volume.

---

## Dry-run receipt (worker, 2026-07-05) — NOT the verdict

The worker delivers this runbook + ONE dry run; the timed fresh-user verdict + E2E (voice note →
transcript → filed via council → cited answer, one Epaminon round-trip) belong to the **tester**
(W-E test criteria).

- **Dry run performed:** `docker compose -f docker-compose.tenant.yml config --services` with
  `ZENOD_IMAGE_TAG=latest TENANT_NAME=dryrun PHYLAX_CONSOLE_TOKEN=` → **exit 0**, resolves the 6
  services `zenod-console, zenod-zenod, zenod-archus, zenod-epaminon, zenod-phylax, zenod-outbound`.
  This validates the runbook's central mechanical step (the stack parses + env interpolates cleanly)
  without any outward/VPS action.
- **Explicitly NOT done by the worker** (out of the worker's authority — reserved for the tester,
  and gated on Dokploy access + Jordi's no-manual-deploy rule): the live Dokploy provision, the
  < 30 min timing, and the E2E smoke. Those are the tester's verdict run per Dispatch block B.
- **Honest status:** runbook is CURRENT-topology-complete and self-contained; the [TARGET] atomic
  topology deltas are marked but not yet live (physical extraction staged behind the RD-4 split
  trigger).
