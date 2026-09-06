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

Deployment evidence and exact rollback command will be linked here after verified rollout. No production or live acceptance claim is made by this draft.
