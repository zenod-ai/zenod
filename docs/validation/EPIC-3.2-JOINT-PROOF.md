# Epic 3.2 Joint Proof Harness

Issue: <https://github.com/zenod-ai/zenod/issues/736>

This is the test-only joint proof for Epic 3.1 chassis behavior exercised through the Epic 3.2 Zenod pilot. It does not modify or import `packages/mcp-chassis/**`. Chassis contract failures must be reported in issue #736 as Proposed Cross-Spine Updates for the Epic 3.1 steward.

## Integration Prerequisite

This tester branch was created from `8e12ebab64140f227f9c19d5a72e5d191de8d251`. Before scoring the joint proof, integrate this harness commit onto `codex/epic-3.2-zenod-multitenant` at or after `699a4ed4738ce4d0c8ec0b930e49642cb8a99b28`. That integration point contains the tenant runtime/server work from #734 at `cacf3cb` plus the subsequent web/cutover commits through `699a4ed`.

Do not run the final acceptance from this branch's base and do not describe a base-branch prerequisite failure as a product regression. The final evidence must name the resulting integrated SHA after the harness commit is cherry-picked or merged.

## What It Proves

The black-box runner covers:

- control-token-gated provisioning of T1, T2, and T3;
- registry redaction and unknown-token rejection;
- ZD-8 `/mcp/<token>` initialization and tools listing for each tenant;
- proof that the control-plane token cannot read `/api/settings`;
- separate T1/T2/T3 bearer reads with each tenant's own repo settings;
- tenant-scoped settings, repo, ingest, and usage API reads;
- `/api/auth/tenant-login` followed by cookie-only API reads that stay on the owning tenant;
- direct cross-tenant URL rejection and a tenant-id-tampered session-cookie rejection;
- full-mode store receipts and unique marker-string negatives;
- optional host-visible `/data/<tenant>/` layout, media path, and raw-token-at-rest checks;
- persistent `journal_mode=wal` on the chassis DB and every tenant file DB;
- in-process `busy_timeout=30000` on every live Zenod store and the chassis registry;
- optional single-tenant self-host parity;
- optional same-token migration verification.

The runner exits `0` only when every required check passes. Exit `2` means a required implementation or environment prerequisite is absent. Exit `1` means an implemented surface violated the contract. Evidence is JSON with credentials redacted.

## Contract Run

Start the exact Zenod integration commit with multi-tenant mode enabled and a fresh data directory. Then run:

```sh
EPIC32_COMMIT="$(git rev-parse HEAD)" \
CONTROL_PLANE_TOKEN="<control-plane-token>" \
EPIC32_BASE_URL="http://127.0.0.1:8080" \
EPIC32_DATA_ROOT="<host-visible-data-root>" \
node scripts/epic32-joint-proof.mjs --mode contract
```

Contract mode requires no GitHub or LLM credentials. It proves the control plane, tokened MCP initialization, control-token non-escalation, tenant bearer/session binding, tampered-cookie rejection, storage layout, and persistent WAL mode. It intentionally cannot prove durable commit receipts or marker search.

Run the in-process PRAGMA proof after the parent implementation is integrated into this branch:

```sh
npm run test -w @zenod/server -- epic32SqlitePragmas.test.ts
```

`busy_timeout` is connection-local and cannot be proved by reopening a SQLite file from the black-box process. The focused test reads each live store connection directly and requires `journal_mode=wal` plus `busy_timeout=30000`; it also checks the chassis registry when `TenantRuntimeManager` is present.

## Full Run

Use three disposable repositories and a test-only LLM key:

```sh
EPIC32_COMMIT="$(git rev-parse HEAD)" \
CONTROL_PLANE_TOKEN="<control-plane-token>" \
EPIC32_BASE_URL="http://127.0.0.1:8080" \
EPIC32_DATA_ROOT="<host-visible-data-root>" \
EPIC32_T1_REPO="owner/epic32-proof-t1" \
EPIC32_T2_REPO="owner/epic32-proof-t2" \
EPIC32_T3_REPO="owner/epic32-proof-t3" \
EPIC32_GITHUB_TOKEN="<test-repo-token>" \
EPIC32_LLM_API_KEY="<test-llm-key>" \
node scripts/epic32-joint-proof.mjs --mode full
```

Each repository must be empty or disposable and writable by the supplied credential. The runner creates a unique marker per tenant, records a commit receipt, checks the receipt names the correct repository, finds the marker with the owning token, and proves the other two tokens cannot return it.

## Self-Host And Migration

Add these variables to the contract or full run after the corresponding surfaces exist:

```sh
EPIC32_SELF_HOST_URL="http://127.0.0.1:8081" \
EPIC32_SELF_HOST_TOKEN="<standalone-env-token>" \
EPIC32_MIGRATED_URL="http://127.0.0.1:8080" \
EPIC32_MIGRATED_TOKEN="<unchanged-legacy-token>"
```

The migration worker's dry-run/apply/verify/rollback receipts remain authoritative for copy safety. This harness independently checks that the unchanged legacy token still initializes MCP and reaches the migrated tenant API.

## Browser Evidence

After the API/session checks are green, use the same three provisioned tenants in a real browser. Retain one screenshot per tenant for Repo, Ingest, and Usage, plus the failed direct-URL attempt. Record browser version, viewport, base URL, exact commit, and screenshot paths in issue #736. A browser screenshot is supplementary evidence; the cookie-only API and tampered-cookie assertions are the deterministic isolation checks beneath it.

## Current Expected Gap At Base Commit

At `8e12ebab64140f227f9c19d5a72e5d191de8d251`, `POST /api/tenants` is not implemented. A run against that commit must stop with exit `2` at provisioning. The post-dispatch parent branch has the tenant manager, tenant-login, signed sessions, fail-closed API dispatch, tenant media configuration, and SQLite PRAGMAs, but those edits are not present on this tester branch until the steward integrates or cherry-picks them. That is a truthful prerequisite failure, not a test pass.
