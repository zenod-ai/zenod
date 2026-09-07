# Memory Reliability delivery learnings

## Delivery policy clarified by Jordi

Zenod currently serves one user. For this release Jordi explicitly prefers deploying reviewed changes to the existing production environment, testing there and repairing issues, with an easy rollback. Do not assume a staging environment exists or impose new provider configuration as a prerequisite when the existing live configuration can support authorized tests. Future deployment authorization is still scoped to the relevant request.

## What the release exposed

- Merged source and published images are not deployed behavior. Always answer production status with the exact observed runtime SHA.
- MCP test success did not establish customer chat safety: chat and tasking bypassed retrieval/coverage finalization. Reuse one shared finalizer across customer entry points and test streamed output and persisted conversation history.
- Model citation claims are not successful evidence reads. Explicit personal-memory questions need host grounding even if the model skips tools.
- Quoted text alone does not prove a correction relation or verification scope. Validate old-to-new direction and bind verification to its statement; leave unsupported language unresolved.
- Independent reviews caught meaningful bugs after focused tests and CI passed. Retain those adversarial regressions.
- Agent notification does not restart a completed agent. Use explicit follow-up dispatch and inspect actual agent status; never report CI as an active subagent.
- Avoid duplicating delivery status across cursor, recovery and ledger without reconciling all three.

## Reversibility

Candidate392d058 has no startup/storage migration. Raw capture evidence stays immutable; meaning changes are additive metadata and bounded section updates on subsequent captures. This is not a promise of zero risk: older code may not preserve new temporal semantics during future composition. Code rollback keeps existing volumes; data restore is a separate recovery operation into a new volume, never an overwrite of the live one.

Deployment, backup and undo are recorded in [Deployments and upgrades](../EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md). The final source-selection retest is recorded in [29ddb62 evidence](../evidence/zmr-live-29ddb62/README.md). This proves the bounded production repair, not every original release benchmark.

## Production repair lessons — 2026-09-07

- Our own main merges triggered four legacy sibling builds because their automatic deployment bindings had no path filters. The queue was real, not stale deployment history. Pause those unrelated triggers and remove verified waiting jobs through the supported queue API; retain live services and data. The permanent scope is Zenod plus appropriate default Phylax only.
- A successful first classification must survive failure of optional wider-catalog refinement. Initial classification failure still uses the existing retry/Inbox path.
- Search ranking, page selection and current-fact projection are separate failure points. A correct highest-ranked hit can still be skipped by the model; verified relevant facts now use the same bounded projection from structured search hits and ordinary page reads. Search snippets remain untrusted, and snapshot/source verification remains required.
- Repeat an observed failing question in independent fresh conversations. The first retrieval fix passed two of three and was not called complete. The next repair passed all three; those observations do not prove universal recall or all-language temporal interpretation.
- Completed workers require explicit follow-up dispatch for the next task. The manager must advance review, integration and deployment after handoffs, rather than waiting for another user status request.
- Keep deployment upgrades simple: publish the reviewed image, use the existing helper once, verify actual runtime and affected live behavior, retain the recovery receipt. Reuse backup proof within the same code-only repair rollout; do not repeatedly pause production or mix in unrelated cleanup.
