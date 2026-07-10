# Epic 3.2 Joint Proof Harness

Issue: <https://github.com/zenod-ai/zenod/issues/736>

This is the test-only joint proof for Epic 3.1 chassis behavior exercised through the Epic 3.2 Zenod pilot. It does not modify or import `packages/mcp-chassis/**`. Chassis contract failures must be reported in issue #736 as Proposed Cross-Spine Updates for the Epic 3.1 steward.

## Integration Prerequisite

Run only from the integrated Epic 3.2 product branch based on the latest accepted
Epic 3.1 chassis main SHA. The `2d8509e` checkpoint used chassis `ba533b3` and
found encrypted-vault blocker #789. #789 merged at `3062022`; the definitive
candidate is based on reconciled main `90fa371`. Every acceptance run must name
that main parent, the exact product commit, and the immutable image digest.

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
- full-mode store and provided-transcript ingest receipts, GitHub commit existence, durable repo markers, and unique marker-string negatives;
- optional host-visible `/data/<tenant>/` layout, media path, and byte scans for every issued bearer token, including the retired token;
- full-mode recursive scans for raw GitHub, OpenRouter, and chassis master-key values across DB, WAL, SHM, and all other tenant files;
- persistent `journal_mode=wal` on the chassis DB and every tenant file DB;
- in-process `busy_timeout=30000` on every live Zenod store and the chassis registry;
- required full-mode single-tenant self-host mutation/ingest/usage parity;
- required full-mode same-token migrated mutation/ingest/usage parity.

The runner exits `0` only when every required check passes. Exit `2` means a required implementation or environment prerequisite is absent. Exit `1` means an implemented surface violated the contract. Evidence is JSON with credentials redacted. Full custody receipts enumerate every required SQLite database, WAL, and SHM path with a per-path zero-match result, plus recursive path and secret totals.

## Contract Run

Start the exact Zenod integration commit with multi-tenant mode enabled and a fresh data directory. Then run:

```sh
EPIC32_COMMIT="$(git rev-parse HEAD)" \
EPIC32_IMAGE_DIGEST="sha256:<64-hex-index-digest>" \
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
EPIC32_IMAGE_DIGEST="sha256:<64-hex-index-digest>" \
CONTROL_PLANE_TOKEN="<control-plane-token>" \
EPIC32_BASE_URL="http://127.0.0.1:8080" \
EPIC32_DATA_ROOT="<host-visible-data-root>" \
EPIC32_T1_REPO="AlfaBlok/test_evals" \
EPIC32_T2_REPO="AlfaBlok/react_test1" \
EPIC32_T3_REPO="AlfaBlok/zenod-cloud-test-vault-4ptjqj" \
EPIC32_GITHUB_TOKEN="<test-repo-token>" \
EPIC32_LLM_API_KEY="<test-llm-key>" \
CHASSIS_VAULT_MASTER_KEY="<stable-32-byte-key>" \
EPIC32_SELF_HOST_URL="http://self-host:8080" \
EPIC32_SELF_HOST_TOKEN="<standalone-env-token>" \
EPIC32_SELF_HOST_REPO="AlfaBlok/zenod-cloud-test-vault-4ptjqj" \
EPIC32_MIGRATED_URL="http://migrated:8080" \
EPIC32_MIGRATED_TOKEN="<unchanged-legacy-token>" \
EPIC32_MIGRATED_EXPECTED_TOKEN_SHA256="<pre-migration-token-sha256>" \
EPIC32_MIGRATED_REPO="AlfaBlok/react_test1" \
node scripts/epic32-joint-proof.mjs --mode full
```

These are the only repositories approved for marker writes. Full mode refuses an unknown or malformed commit and any mutable image reference; its summary records both values and verifies the hosted, self-host, and migrated product-health SHA against `EPIC32_COMMIT`. The runner creates store and ingest markers per tenant, requires structured commit receipts and GitHub URLs, resolves the receipt commit through the GitHub API, finds both markers in that immutable tree, and proves all foreign markers are absent through MCP and repo reads. The ingest call supplies an authenticated transcript and requires `transcription: provided`, proving the zero-double-STT path.

## Self-Host And Migration

These variables are optional in contract mode and mandatory in full mode:

```sh
EPIC32_SELF_HOST_URL="http://127.0.0.1:8081" \
EPIC32_SELF_HOST_TOKEN="<standalone-env-token>" \
EPIC32_SELF_HOST_REPO="AlfaBlok/zenod-cloud-test-vault-4ptjqj" \
EPIC32_MIGRATED_URL="http://127.0.0.1:8080" \
EPIC32_MIGRATED_TOKEN="<unchanged-legacy-token>" \
EPIC32_MIGRATED_EXPECTED_TOKEN_SHA256="<pre-migration-token-sha256>" \
EPIC32_MIGRATED_REPO="AlfaBlok/react_test1"
```

The hosted, self-host, and migrated URLs must be distinct. The expected migrated token hash comes from the pre-migration receipt; full mode refuses a different token. The migration worker's dry-run/apply/verify/idempotent-apply/rollback/idempotent-rollback receipts remain authoritative for copy safety. This harness independently checks that self-host and migrated surfaces can store, ingest, search, expose nonempty Usage, and resolve both commits as ancestors of repository `main`. Restart continuity and Z-5 restore are lifecycle-driver evidence around the harness, not inferred from one process run.

## Browser Evidence

After the API/session checks are green, use the same three provisioned tenants in a real browser. Retain one `.jpg` screenshot per tenant for Repo, Ingest, and Usage, plus the failed direct-URL attempt. Record browser version, viewport, base URL, exact commit, immutable image digest, and screenshot paths in issue #736. A browser screenshot is supplementary evidence; the cookie-only API and tampered-cookie assertions are the deterministic isolation checks beneath it.

## Current Release Blocker

Checkpoint `2d8509e` is retained contract-only evidence and is not acceptance.
The fresh run must use exact main `90fa371`, the #792 credential conversion,
one immutable image digest, full repository/LLM credentials under Jordi's two
narrow approvals, full self-host/migration/restore parity, and zero raw
world-key matches before #736 can pass or #738 Gate 2 input can be released.
