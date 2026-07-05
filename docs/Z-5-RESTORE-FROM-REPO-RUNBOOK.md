# Z-5 · Restore-from-repo runbook + watchdog registration (Epic 2.3 · Move-0)

Owner: Epic 2.3 ([EPIC-2.3-ZENOD-MOVE-0.md](./EPIC-2.3-ZENOD-MOVE-0.md), Z-5).
Folds watchdog law `3b4da80` (fleet-watchdog registration at provision) + the restore-from-repo
drill. Status: v1, 2026-07-05.

**Core promise being proven:** a tenant's memory is NOT in the container or the Docker volume — it
is the tenant's own **vault git repo**. So a total-loss container can be rebuilt from nothing but
`(image tag + VAULT_REPO + GITHUB_TOKEN + LLM key)`, and `store/search/get` return the pre-crash
memories at the **same commit SHAs**. The vault IS the backup.

> **[BLOCKED-needs-infra: operator runs this on the VPS]** — Every step that touches a live
> container, Dokploy, or the public seam is marked so. This author has **no VPS / Docker access**;
> the drill below is written for a human operator to EXECUTE and paste receipts into. No result here
> is fabricated — empty `Receipt:` slots are for the operator to fill.

---

## Part A — Watchdog registration (the law `3b4da80`)

### A.0 Findings (why this section exists)

The fleet watchdog (`scripts/watchdog/zenod-watchdog.sh`) watches a **static** set:

- Containers: `WATCH_CONTAINERS` — default `zenod-console zenod-z2 zenod-phylax …`
  (`zenod-watchdog.sh:33`), overridable via `ZENOD_WATCHDOG_CONTAINERS` in
  `/etc/zenod-watchdog.env` (`zenod-watchdog.sh:24-26`).
- Endpoints: `HEALTH_URLS` — default `c1/z2` health (`zenod-watchdog.sh:32`), overridable via
  `ZENOD_WATCHDOG_HEALTH_URLS`.

It is **not** discovery-based — it never enumerates `docker ps` or Traefik routes; it only checks
the names/URLs it is handed. The provisioning runbook (`units/PROVISIONING-RUNBOOK.md`) has **no**
watchdog step, and teardown (lines 86-89) only deletes the Dokploy project. **Gap:** a newly
provisioned tenant's containers + `z-<name>.zenod.dev` health endpoint are NEVER added to the watched
set, so a new tenant crash-looping or going dark pages **no one**. Deregistration is likewise absent.

**Smallest safe fix (config-list append, no code change):** provisioning must APPEND the tenant's
container names + health URL to `ZENOD_WATCHDOG_CONTAINERS` / `ZENOD_WATCHDOG_HEALTH_URLS` in
`/etc/zenod-watchdog.env`; teardown must REMOVE them. The watchdog already honours both env vars and
skips any container not present on the host (`zenod-watchdog.sh:129` — `[ -z "$rc" ] && continue`), so
a stale-but-not-yet-removed entry cannot false-page. Steps A.1 / A.2 below are the exact wiring; they
are the new provisioning/teardown sub-steps to be back-ported into `units/PROVISIONING-RUNBOOK.md`
(after its step 4 and in its Teardown, respectively).

### A.1 Register at provision  [BLOCKED-needs-infra: operator runs this on the VPS]

Run on the host, after the tenant stack is deployed (runbook step 4). Tenant container names are
`tenant-<name>_zenod-console_1 … zenod-outbound_1` (Compose namespaces by project); confirm the exact
names with `docker ps --format '{{.Names}}' | grep tenant-<name>`.

1. Append the tenant's containers + health URL to the watchdog env file:
   - add the 6 container names to `ZENOD_WATCHDOG_CONTAINERS`
   - add `https://z-<name>.zenod.dev/api/health` to `ZENOD_WATCHDOG_HEALTH_URLS`
   in `/etc/zenod-watchdog.env` (create the keys if absent — defaults are in
   `zenod-watchdog.sh:32-33`).
   Receipt: the diff of `/etc/zenod-watchdog.env` (before/after the two lines).
2. Force one watchdog pass to confirm the new endpoint is now checked (and healthy):
   `sudo systemctl start zenod-watchdog.service && journalctl -u zenod-watchdog.service -n 20 --no-pager`.
   Receipt: the journal line showing `health…z-<name>-zenod-dev…` evaluated to 200 (or "all healthy").

### A.2 Deregister at teardown  [BLOCKED-needs-infra: operator runs this on the VPS]

Run on the host as part of runbook Teardown, BEFORE deleting the Dokploy project (so the watchdog
never pages on the intentional disappearance).

1. Remove the tenant's 6 container names from `ZENOD_WATCHDOG_CONTAINERS` and its health URL from
   `ZENOD_WATCHDOG_HEALTH_URLS` in `/etc/zenod-watchdog.env`.
   Receipt: the diff of `/etc/zenod-watchdog.env` showing the tenant's entries removed.
2. Clear any lingering alert state for the torn-down tenant:
   `sudo rm -f /var/lib/zenod-watchdog/alert.*z-<name>* /var/lib/zenod-watchdog/restarts.*<name>*`.
   Receipt: `ls /var/lib/zenod-watchdog/ | grep <name>` returns nothing.

### A.3 Crash-loop alert drill  [BLOCKED-needs-infra: operator runs this on the VPS]

Proves a registered tenant crash-looping actually pages the operator (watchdog check 3,
`zenod-watchdog.sh:126-139`; threshold `RESTART_MAX=5`, `zenod-watchdog.sh:37`).

1. Pick a NON-load-bearing tenant container (e.g. `tenant-<name>_zenod-outbound_1`). Force a
   crash-loop: set a bad command / failing env so it restarts >5 times within one 2-min timer window
   (`zenod-watchdog.timer`). Example: `docker update --restart=always` then repeatedly
   `docker kill` it, or deploy a deliberately-broken env.
   Receipt: `docker inspect -f '{{.RestartCount}}' <container>` showing the count climb past 5.
2. Wait for the next watchdog pass (≤2 min). Confirm the page fired.
   Receipt (alert): the Phylax/WhatsApp (or fallback ntfy/Telegram) message text
   `🚨 zenod-watchdog: Container … is CRASH-LOOPING …`.
   Receipt (timestamp): the UTC time the alert was received + the matching
   `journalctl -u zenod-watchdog.service` `ALERT[page/crashloop-…]` line.
3. Stop the induced fault; confirm the alert self-clears on the next healthy pass
   (`clear_alert`, `zenod-watchdog.sh:136`).
   Receipt: a later journal line with no crash-loop alert for that container (`all healthy`).

---

## Part B — Restore a tenant from ONLY its vault repo

### Preconditions

- The tenant's **vault git repo URL** is known and reachable (it is the ONLY thing that survives a
  container/volume loss — see `units/zenod/README.md:121` "Your memory is just a git repo" and
  `units/PROVISIONING-RUNBOOK.md:88-89` "memory survives … it lives in their own vault git repo").
- A **GitHub token** that can push to that repo (the repo `github_token`, law 6b — only Zenod holds
  it; `units/PROVISIONING-RUNBOOK.md:72`).
- An **LLM key** (Anthropic/OpenAI, or the tier-capped OpenRouter key) for the rebuilt instance.
- The published image tag `ghcr.io/zenod-ai/zenod:<tag>` (pin the same `sha-…` the tenant ran, for
  reproducibility — `units/PROVISIONING-RUNBOOK.md:31-32`).
- Host + Dokploy access (operator).
  Receipt (preconditions captured): a one-line manifest listing `{ vault_repo_url, image_tag }`
  (token + LLM key redacted).

### B.0 Baseline — capture a pre-crash SHA to prove the round-trip later

[BLOCKED-needs-infra: operator runs this on the VPS] — do this on the LIVE tenant before simulating
loss (or read it from the vault repo's git log if the tenant is already gone).

1. Against the live Zenod MCP endpoint, `store_memory` a marker note
   (e.g. `"Z-5 restore drill marker <timestamp>"`), poll `get_task_result`, and record the returned
   `commitSha` + `githubUrl` (`units/zenod/README.md:70-84`).
   Receipt (baseline SHA): the pre-crash `commitSha` (call it `SHA_pre`) + its GitHub URL.
2. Confirm that commit exists in the vault repo (`git log` on the pushed repo shows `SHA_pre`).
   Receipt: the `git log --oneline -1 <SHA_pre>` line from the vault repo.

### B.1 Simulate total loss  [BLOCKED-needs-infra: operator runs this on the VPS]

Destroy the container **and** its Docker volume — proving nothing local is load-bearing.

1. Stop + remove the tenant's `zenod-zenod` container and delete its `zenod-data` volume
   (`docker-compose.tenant.yml:95-101` — the memory agent's volume).
   Receipt: `docker volume ls | grep <name>.*zenod-data` returns nothing (volume gone).

### B.2 Rebuild a fresh instance pointing at the SAME repo  [BLOCKED-needs-infra: operator runs this on the VPS]

New container, existing repo — no volume restore, no backup file. The clone of the vault repo IS the
restore (`units/zenod/README.md:29-42`).

1. Start a fresh `zenod` instance on the same image tag with the SAME `VAULT_REPO` + `GITHUB_TOKEN` +
   LLM key (via the tenant compose redeploy, or the standalone `docker run` in
   `units/zenod/README.md:29-37`). Do NOT restore any volume.
   Receipt (container ID): the new container's `docker inspect -f '{{.Id}}'` (12-char short ID).
   Receipt (repo URL): the `VAULT_REPO` the new instance was handed (must equal B.0's repo).
2. Health-check the rebuilt instance: `curl -s http://<host>:8080/api/health`
   (`units/zenod/README.md:44-48`).
   Receipt (health 200): the HTTP 200 body/line from `/api/health`.

### B.3 Prove memory came back at the SAME SHAs (the acceptance)

[BLOCKED-needs-infra: operator runs this on the VPS]

1. `search_memory` for the marker text from B.0. It must return a hit whose `githubUrl`/path resolves
   to the note stored pre-crash (`units/zenod/README.md:88-95`).
   Receipt (search hit): the search result JSON showing the marker note found.
2. `get_memory` on that path — confirm the body matches the pre-crash content.
   Receipt (get): the returned `{ path, body, githubUrl }` matching B.0.
3. Verify SHA continuity: the vault repo `git log` on the rebuilt instance still contains `SHA_pre`
   from B.0 (the restore did not rewrite history — same commit SHAs).
   Receipt (SHA match): `SHA_pre` present in the rebuilt instance's `git log` — identical to B.0.

### B.4 Round-trip proof — new write lands on top of the restored history

[BLOCKED-needs-infra: operator runs this on the VPS]

1. `store_memory` a fresh post-restore note; poll `get_task_result`; record the new `commitSha`
   (`SHA_post`). It must be a NEW commit whose parent chain includes `SHA_pre`.
   Receipt (store→search round-trip SHA): `SHA_post` + a `search_memory` that finds the new note,
   confirming write+read work on the restored instance and `SHA_post != SHA_pre` but built on it.

---

## Acceptance mapping (Z-5's two boxes)

| Box | What proves it | Status |
|---|---|---|
| (a) auto-register at provision + deregister at teardown | Part A.1/A.2 wiring exists in this doc + must be back-ported to `PROVISIONING-RUNBOOK.md`; live register/deregister + crash-loop page (A.3) captured by operator | **spec GREEN / live BLOCKED-needs-infra** |
| (b) restore-from-repo runbook, receipt per step | Part B, every step has a `Receipt:` line; live run captured by operator | **doc GREEN / drill BLOCKED-needs-infra** |

Every step in Parts A and B carries an explicit `Receipt:` line. The live-execution receipts are for
the operator to fill on the VPS; none are fabricated here.
