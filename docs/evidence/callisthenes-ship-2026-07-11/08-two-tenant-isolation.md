# SHIP 8 — live two-tenant isolation receipt

Date: 2026-07-11  
Target: `https://calli.zenod.dev`  
Build under test: the deployed Callisthenes compose

No bearer token, OAuth credential, cookie, or stored X payload is included in this receipt.

## Provisioning

A second tenant was provisioned directly through the same durable
`createSqliteTenantStore({ dataDir: "/data" })` used by `calli-front`:

```text
tenant.id: calli-ship-isolation-b
tenant.name: Callisthenes SHIP Isolation B
tenant.plan: test
tenant.status: active
token persistence: SHA-256 hash only in chassis-tenants.sqlite
```

The generated bearer was kept in a mode-0600 temporary file and never printed.

## Public MCP boundary

Both tenants independently initialized MCP sessions at the public endpoint and
called `createPosts` without approval, using unique markers:

```json
{"tenant":"A","initialized":true,"draftHeld":true,"hasError":false}
{"tenant":"B","initialized":true,"draftHeld":true,"hasError":false}
```

Both replies contained `[draft_not_approved]`; neither call sent a post.

The front observation ledger was then inspected by tenant key, reporting only
presence booleans (not record payloads):

```json
{"tenant":"github-63050995","hasA":true,"hasB":false,"draftCount":2,"receiptCount":0}
{"tenant":"calli-ship-isolation-b","hasA":false,"hasB":true,"draftCount":1,"receiptCount":0}
```

This proves each tenant can see its own draft marker and cannot see the other
tenant's draft marker. Receipt arrays are independently scoped as well.

## X custody

The engine derives each X configuration filename from the SHA-256 hash of that
tenant's bearer. Comparing the two locally computed hashes to the live engine
directory showed:

```text
tenant A: matching x-config-<tenant-hash>.json exists
tenant B: matching x-config-<tenant-hash>.json does not exist
```

The stored file was not opened. This proves tenant B cannot see or inherit
tenant A's X connection; custody is namespaced by tenant bearer hash.

## Negative boundary checks

Supplying tenant B's bearer while addressing tenant A's token-qualified MCP path
was rejected by the live front:

```json
{"conflictingCredentialsStatus":401,"conflictingCredentialsError":"conflicting tenant credentials","missingCredentialsStatus":401}
```

## Reproduction shape (secrets omitted)

```sh
# Provision inside calli-front using @zenod/mcp-chassis; save returned token to
# a mode-0600 temporary file, never stdout.

# For each tenant:
curl -X POST https://calli.zenod.dev/mcp \
  -H "Authorization: Bearer $(<TENANT_TOKEN_FILE)" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data @initialize.json

curl -X POST https://calli.zenod.dev/mcp \
  -H "Authorization: Bearer $(<TENANT_TOKEN_FILE)" \
  -H "Mcp-Session-Id: SESSION_FROM_INITIALIZE" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data @held-create-post.json
```

Result: PASS — the second tenant cannot see the first tenant's connection,
drafts, or receipts.
