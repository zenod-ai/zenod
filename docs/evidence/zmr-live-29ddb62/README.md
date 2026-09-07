# Final bounded production repair — 29ddb62

Public Zenod runs source `29ddb62d349d9f3bd9c5b471848a4ef775155827`, immutable image `ghcr.io/zenod-ai/zenod@sha256:fab0414121a6912ace825f3cdf07fc5f508944afc3cafec7352660db32a83042`. Swarm update completed at 2026-09-07 00:17:23.835 UTC. Sole operator verified actual container `572e253d41a8`, image ID `b8ec5979fcbca2f72e41140be66969cac0d0315357734268ae8608bc1778995f`, matching OCI revision and public health SHA. Private Phylax image is unchanged.

PR #1226 exact reviewed head `c3b2612a63f73d5b2d79810fc465493e9150902f` passed independent review, 95 core tests, 20 server tests, workspace typecheck and CI 34067932729. Publication 34068891159 succeeded. Deployment used the existing helper once and retained the recovery receipt.

## Live result: three of three pass

The same previously failing read-only deployment-boundary question was asked in three fresh conversations on the actual production candidate. All three returned the five current saved facts, including the appropriate default Phylax allowance, separation of other agents, disabled automatic deployments during transition, preservation of services/data and incremental undo discipline.

Each answer cites `Log/2026-09-06.md#^e-7c5eb9` at revision `c906053fe23f8fb34d2c7ef154cf3ce6c9cdb5ba`. These were read-only tests, with no duplicate capture or vault rewrite.

| Run | Audit | Result |
|---|---|---|
| 1 | test_1ae0e06fd5e84639a22e132354ded23e | PASS |
| 2 | test_8234d54aa3534041a58f6e503e375037 | PASS |
| 3 | test_bec9eb86f5c7468794baf7451d1d284b | PASS |

Full named audits are the adjacent JSON files. Filing previously passed on c5da66f; its repair is included here. Historical failed attempts remain recorded rather than overwritten.

## Limits and follow-up

The bounded production upgrade and observed filing/recall repair loop passed. This does not certify every original seven-step memory-release journey, held-out retrieval benchmark, latency/cost target or universal temporal interpretation. Historical detection remains conservative and primarily English; partial-coverage behavior and answer presentation remain follow-up concerns. ZMR-8 retains broader acceptance work, and ZMR-9/10 await human SHIP acceptance.

Use the [deployment leaf](../../EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md) for supported upgrade/rollback commands and verified recovery. Code rollback retains current data; no live data restoration or rollback was performed.

Final operator preservation receipt: all 52 non-GIT_SHA environment entries and mounts match the baseline; private Phylax remains on sha256:1ae6607fb5cabf059a7058ae0b80abc2a492dab32d034b903dc920b73759b53e. Queue has zero active/waiting/delayed/prioritized jobs. Fresh API reads confirm epaminon, outbound, callisthenes and x-mcp automatic deployment disabled. No additional backup pause, cleanup or unrelated restart. Protected runtime receipt: `/Users/jordi/.local/state/zenod-zmr-production-20260906/public-service.29ddb62.json`.
