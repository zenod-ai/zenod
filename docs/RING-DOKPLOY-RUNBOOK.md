# Ring Dokploy runbook

This is the guarded zero-state recipe for the one new Ring application. It is
plan-first and must not be applied until R-S4 is integrated into `main`, the
immutable `sha-*` image exists, and the Ring delivery manager supplies the
exact target and approval reference.

## Create the empty target

In Dokploy, create one **application** with:

- name: `ring`
- image source: `ghcr.io/zenod-ai/zenod:sha-<integrated-main-sha>`
- container port: `8080`
- persistent volume mounted at `/data`
- network: `dokploy-network`
- target-only bootstrap values: `ACCOUNT_STATE_SECRET`,
  `CHASSIS_VAULT_MASTER_KEY`, and `CONTROL_PLANE_TOKEN`

Do not attach a domain yet. Do not select, edit, restart, stop, or deploy the
Zenod or Callisthenes applications. Record the new Ring `applicationId`.

The script reads OAuth and Stripe TEST values from the deployed Zenod
application through the Dokploy API, keeps them in memory, and sends only the
allowlisted Ring environment to the new target. It never prints values or
writes them to the repository or rollback receipt.

## Read-only plan

```sh
eval "$(dokploy-env)"
TARGET_APP_ID=<new-ring-application-id> \
EXPECTED_SHA=<integrated-main-sha> \
STATE_DIR=/var/tmp/r-s4-cutover-$(date -u +%Y%m%dT%H%M%SZ) \
scripts/r-s4-dokploy-cutover.sh
```

Plan mode is the default and issues no POST requests. It checks the target
name, exactly one `/data` mount, source TEST mode, required allowlisted keys,
and the exact immutable image tag.

## Manager-authorized apply

Only after the delivery manager approves the exact integrated commit and
target:

```sh
eval "$(dokploy-env)"
MODE=apply DRY_RUN=0 CUTOVER_APPROVED=1 \
APPROVAL_REF=issue-839-manager-cutover \
TARGET_APP_ID=<new-ring-application-id> \
EXPECTED_SHA=<integrated-main-sha> \
STATE_DIR=/var/tmp/r-s4-cutover-<same-recorded-timestamp> \
scripts/r-s4-dokploy-cutover.sh
```

Apply updates and deploys only the new Ring target, attaches only
`ring.zenod.dev`, and requires a receipt for `/`, `/app`, `/mcp`, `/healthz`,
the exact SHA, and the GitHub callback
`https://ring.zenod.dev/auth/github/callback`.

If that callback is not registered and cannot be edited, stop with the exact
status:

`BLOCKED ON JORDI: add https://ring.zenod.dev/auth/github/callback to the shared GitHub OAuth app.`

## Rollback

```sh
eval "$(dokploy-env)"
MODE=rollback DRY_RUN=0 CUTOVER_APPROVED=1 \
APPROVAL_REF=issue-839-manager-rollback \
TARGET_APP_ID=<new-ring-application-id> \
EXPECTED_SHA=<integrated-main-sha> \
STATE_DIR=/var/tmp/r-s4-cutover-<same-recorded-timestamp> \
scripts/r-s4-dokploy-cutover.sh
```

Rollback removes only the new Ring domain. The new target and its volume stay
intact for inspection. Existing units were never mutated.
