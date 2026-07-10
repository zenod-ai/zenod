# Epic 3.2 Joint Proof Harness

Issue: <https://github.com/zenod-ai/zenod/issues/736>

This is the test-only joint proof for Epic 3.1 chassis behavior exercised through the Epic 3.2 Zenod pilot. It does not modify or import `packages/mcp-chassis/**`. Chassis contract failures must be reported in issue #736 as Proposed Cross-Spine Updates for the Epic 3.1 steward.

## Integration Prerequisite

Run only from the integrated Epic 3.2 product branch based on the latest accepted
Epic 3.1 chassis main SHA. The `2d8509e` checkpoint used chassis `ba533b3` and
found encrypted-vault blocker #789. The next definitive acceptance must name the
exact post-#789 main parent and resulting product commit.

Never repair a chassis defect from the 3.2 branch. File a Proposed Cross-Spine
Update anchored to #780 and wait for the 3.1 steward's merged SHA.

## What It Proves

The black-box runner covers:

- control-token-gated provisioning of T1, T2, and T3;
- anonymous SPA root and one built JS/CSS asset, while product APIs stay protected;
- registry redaction and unknown-token rejection;
- ZD-8 `/mcp/<token>` initialization, tools listing, and a real declared read-tool call for each tenant;
- proof that the control-plane token cannot read `/api/settings`;
- separate T1/T2/T3 bearer reads with each tenant's own repo settings;
- tenant-scoped settings, repo, ingest, and usage API reads;
- `/api/auth/login` followed by cookie-only API reads that stay on the owning tenant;
- direct cross-tenant URL rejection and a tenant-id-tampered session-cookie rejection;
- T2 token rotation, retired-token rejection, active-token MCP/API continuity, and a new signed session;
- full-mode store receipts and unique marker-string negatives;
- optional host-visible `/data/<tenant>/` layout, media path, and byte scans for every issued bearer token, including the retired token;
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

Run the in-process PRAGMA proof on the integrated branch:

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

## Current Release Blocker

Checkpoint `2d8509e` passes this harness but fails the separate Law 5 custody
scan because the chassis generic vault writes world credentials verbatim to
SQLite/WAL. #789 owns the chassis fix. Harness success alone is therefore not
Epic 3.2 readiness; the fresh post-#789 run must also prove zero raw world-key
matches in DB, WAL, and SHM files.
