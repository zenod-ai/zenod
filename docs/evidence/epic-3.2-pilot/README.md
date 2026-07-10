# Epic 3.2 Pilot Evidence

Issue: #736

## Definitive checkpoint: 2d8509e

Product commit: `2d8509e973f10698b01f9922e6ddfdf3cbc4bc67`

Main parent: `476e02629136e83f124c0dd3a997f9c723631550`

Chassis implementation: `ba533b3987c13a6e1c3a136bc7bab08beb00abf9`

Environment: macOS, Node 22, fresh local hosted, self-hosted, and migrated
data roots; production web build; in-app Chromium browser at 1280x720.

Status: **acceptance failed / blocked**. This is contract-mode checkpoint
evidence, not the Epic 3.2 acceptance set. The final custody scan found a raw
synthetic GitHub credential in the chassis-owned tenant `vault.sqlite-wal`.
That cross-spine defect is tracked by #789, anchored to #780. Epic 3.2 did not
edit `packages/mcp-chassis/**`.

### Automated gates

- `npm run build`: pass.
- `npm run typecheck`: pass.
- `npm test -w @zenod/mcp-chassis`: 8 files, 71 tests passed.
- `npm test -w @zenod/server`: 63 files, 576 tests passed.
- `npm test -w zenod`: 21 files, 304 passed, 6 intentional skips.
- `node --test scripts/*.test.mjs && npm run schemas:check`: 184 tests passed;
  27 schemas valid.
- `npm test -w web`: 1 test passed.
- Focused D18: server media/MCP 29 tests passed; chassis transcription 9 tests
  passed. A supplied transcript made zero STT calls and returned `provided`; an
  absent transcript made one call and returned `performed`.

### Black-box contract

`2d8509e-contract/summary.json` records a passing contract run for anonymous
root/assets, protected product APIs, three-tenant bearer/session isolation,
real MCP read-tool calls under C-16, T2 token rotation, WAL/storage layout,
raw bearer-token scanning, and self-host parity. The migration surface was run
separately after that summary was written.

Hosted and self-host processes were then stopped and restarted on the same data
roots. The same credentials returned HTTP 200 for settings and MCP initialize.
Raw bearer-token byte scans returned zero matches.

### Migration

`2d8509e-migration/` contains the apply receipt for the synthetic legacy volume.
Dry-run, accepted-plan apply, and verify all passed checksum, SQLite integrity,
registry, and git checks. The unchanged credential hash was
`238c45f19ae1c966bc1315b744722f9970714ae79f050e999501a85552edd064`.
The migrated API and MCP returned HTTP 200 before and after process restart, and
the raw bearer-token scan returned zero matches.

### Browser

`2d8509e-browser/` contains T1/T2/T3 Vault, Transcription, and Costs panels.
Each tenant was logged in and browser-reloaded. The T3 URL containing T2's
`tenantId` still rendered T3 and T3's repository. Self-host and migrated browser
reloads are also recorded.

The fake repositories intentionally fail clone authentication; the screenshots
make the owning tenant path and repository visible without using a real world
credential. No raw credentials occur in the evidence tree.

These captures do not satisfy final acceptance: all three vault clones failed,
Transcription was captured instead of tenant-specific Ingest history, Costs was
empty, and no durable commit or marker receipt exists. The files are `.jpg`
because the browser emitted JPEG bitstreams.

### Release blocker

The synthetic world credential with SHA-256
`7bd8123aa2d91adb20869e5a3be632b32d7d0aa9129125f0a27b9c4cb0ded31a`
was found verbatim in
`hosted/epic32-browser-t1/vault.sqlite-wal`. The corresponding bearer token was
not found. #789 requires chassis-owned encrypted vault storage plus DB/WAL/SHM
regression scans and a plaintext compatibility decision.

### Independent acceptance audit

Epic 3.7 independently audited branch `3688410` / product `2d8509e` and rejected
#736 readiness. In addition to #789, the final rerun must provide:

- exact merged main SHA and immutable image digest;
- fresh `--mode full` using `AlfaBlok/test_evals`, `AlfaBlok/react_test1`, and
  `AlfaBlok/zenod-cloud-test-vault-4ptjqj`;
- durable per-tenant commit receipts, planted marker searches, and foreign-marker
  negatives;
- browser Repo, Ingest history, and non-empty Usage captures for T1/T2/T3;
- self-host ingest and commit-receipt parity;
- migration plan/apply/verify/idempotency/rollback receipts, full-prefix state,
  and Z-5 restore evidence;
- zero raw world-key matches in DB, WAL, and SHM files.

The repository writes and a capped non-production OpenRouter key require two
separate explicit Jordi approvals. No production key may be reused, and neither
approval authorizes production migration, DNS, Dokploy, archive, or retirement.
