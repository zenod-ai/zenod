# Production check — 4c6ca14

Public Zenod source 4c6ca14aaf2d83ef0330e894627d44cba320fec3 was verified live at 2026-09-06 23:31:49.556 UTC by the sole production operator. Immutable image: ghcr.io/zenod-ai/zenod@sha256:589b51d86b9e3cc4cd1e23392d99fc493615dc18118198cd62045bd441d66885. Actual container 121fca02b010, OCI revision and health match; one running task and completed update. Mount and 52 other environment entries unchanged; private Phylax unchanged. Queue empty and four sibling automatic deployment flags disabled. Backup and original rollback receipt retained. No migration or cleanup; 3.6 GB disk space remains.

PR #1225 independently reviewed; 95 core tests, 20 server tests and workspace typecheck passed. CI 34066033963 passed on rerun after an unrelated short-lease recovery test failed; unchanged isolated test passed five times. Publication 34066775731 succeeded.

## Live acceptance: 2 of 3 pass, NOT finalized

Three fresh conversations asked the exact same read-only deployment-boundary question. Runs 1 and 3 read Projects/Zenod.md and returned all five current saved facts with exact evidence citations. Run 2 skipped that page, read older architecture/hosting pages, and asserted Zenod-only scope without the default Phylax allowance. Source selection remains inconsistent. Audits are adjacent JSON files; no new capture was made.

Filing previously passed on c5da66f and is included in this image. This is deployment success, not full memory-release acceptance. The worker is investigating the remaining source-selection failure under #1196. No additional deployment has been requested.
