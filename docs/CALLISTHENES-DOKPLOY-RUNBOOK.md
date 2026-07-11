# Callisthenes Dokploy bootstrap and guarded cutover

This is the C-S4 duplicate of the Z-N5 deployment recipe. It creates a **new**
compose record and never repurposes or mutates the existing Callisthenes 2.x,
x-mcp, or Zenod services.

## 1. Bootstrap the new compose record

In Dokploy, project `zenod`, environment `production`, create a Compose service
with these exact inputs:

| Field | Value |
|---|---|
| Name | `callisthenes` |
| Source | GitHub repository |
| Repository | `https://github.com/zenod-ai/zenod` |
| Branch | `main` |
| Compose path | `units/callisthenes/docker-compose.callisthenes.yml` |

Do not select, rename, stop, or edit the existing compose whose current route is
`callisthenes.zenod.dev`. Record the newly created compose id as
`TARGET_COMPOSE_ID`. Before the guarded plan, add only two new-target bootstrap
secrets in Dokploy: `CHASSIS_VAULT_MASTER_KEY` and `CONTROL_PLANE_TOKEN`. The
cutover script transplants the remaining allowlisted GitHub OAuth, Stripe TEST,
price, and X application values in memory from the working services without
printing them.

Creation receipt (record in issue #824 before apply): new compose id, name,
repository, branch, compose path, and current status. Do not record env values.

## 2. Read-only plan

Use the integrated commit SHA, not a ticket-branch SHA:

```sh
eval "$(dokploy-env)"
TARGET_COMPOSE_ID=<new-id> EXPECTED_SHA=<integrated-main-sha> \
  scripts/c-s4-dokploy-cutover.sh
```

The plan is read-only. It must show only target-compose update/deploy operations,
one `calli.zenod.dev` domain creation on `calli-front:8080`, and the health checks.

## 3. Manager-authorized apply

Only the Callisthenes delivery manager runs this after the integrated root image
contains both Callisthenes web builds:

```sh
eval "$(dokploy-env)"
MODE=apply DRY_RUN=0 CUTOVER_APPROVED=1 \
  APPROVAL_REF='issue-824-manager-approval-<timestamp>' \
  TARGET_COMPOSE_ID=<new-id> EXPECTED_SHA=<integrated-main-sha> \
  STATE_DIR=/var/tmp/c-s4-cutover-<timestamp> \
  scripts/c-s4-dokploy-cutover.sh
```

Success creates `$STATE_DIR/health-receipt.json` proving the exact SHA and the
public `/`, `/app`, `/mcp`, and `/healthz` contract. The file is mode 0600.

## 4. Rollback

Rollback removes only the new `calli.zenod.dev` domain from the new target:

```sh
eval "$(dokploy-env)"
MODE=rollback DRY_RUN=0 CUTOVER_APPROVED=1 \
  APPROVAL_REF='issue-824-rollback-<timestamp>' \
  TARGET_COMPOSE_ID=<new-id> EXPECTED_SHA=<integrated-main-sha> \
  STATE_DIR=/var/tmp/c-s4-cutover-<timestamp> \
  scripts/c-s4-dokploy-cutover.sh
```

The old Callisthenes 2.x and x-mcp deployments remain running throughout.
