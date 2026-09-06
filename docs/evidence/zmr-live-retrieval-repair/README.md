# Live customer retrieval repair

Bound issue #1196; worker `/root/zmr_8_chat_review`, parent sole delivery manager. Base: deployed `392d058a599bdf5fc69d17157282b8f9154dcf28`; isolated worktree `wt-zmr-live-fix`, branch `codex/zmr-live-fix`.

The authorized production MCP test saved immutable evidence successfully, but unanchored daily-log retrieval returned a heading-only first section and the answer declared no matching source. Exact anchored retrieval succeeded. This is a reader/model continuation integration defect, not missing data.

The AiSdk answer tool now batches unanchored initial daily-log reads through at most eight passages and 8,000 body characters (or the caller's lower limit). Each actual read passes through the existing host tracker and emits its own read action; exact anchored reads, literal seeks and explicit cursor reads remain single passages. The model receives every passage identity/body and any remaining continuation. No immutable evidence or public get-memory representation changes.

Coverage now retains whole-file continuation when a section is complete but later sections remain unread. For the observed negative-answer wording, incomplete evidence forces a partial-coverage response instead of a false absence claim. This is a bounded English wording guard, not universal semantic entailment or autonomous recall proof.

Validation:

- Core AiSdk answer-tool regression uses the real passage reader against a small two-entry daily log; the later saved preference reaches the model, source identities remain distinct, exact reads exclude neighboring entries. A larger log verifies the character/page bounds and retained continuation.
- Authenticated customer HTTP regression reproduces the original heading-only read with a negative draft and verifies the host replaces it with partial coverage and a usable cursor.
- 32 focused core checks PASS (AiSdk retrieval, coverage, passage, action receipt gates).
- 19 public ZMR checks PASS (customer chat, ask, facts, passages).
- All-workspace typecheck PASS. Fresh-worktree server tests initially could not resolve the unbuilt chassis package; normal typecheck/build resolved the dependency, and all selected suites then passed.

Classification is separate: production recorded two `structured_output_invalid` failures for the existing OpenRouter `minimax/minimax-m3` classifier. No transport/authentication error is established; exact invalid field diagnostics remain pending. This repair does not guess at schema defaults or change provider/model configuration. Raw evidence was saved despite failed filing. Production testing/rollout remains owned by the sole deployment operator; this worker performed no live mutations or credential access.

Independent-review correction: the first guard replaced an entire answer when any negative phrase appeared. It now removes only unquoted negative clauses when evidence is incomplete, runs the retained text through normal grounding, and adds an explicit coverage caveat. Quoted historical reports and independently grounded positive clauses remain. Added quoted-report/helper and authenticated mixed-answer regressions; 33 core checks and 20 selected public checks pass across affected runs. The initial mixed fixture wording also triggered the existing action-claim gate on “saved”; the positive fixture now uses a read-only access-word statement without implying a same-turn mutation. That unrelated action-gate policy was not changed.

The isolated classification probe using the exact provider/model/schema timed out after three minutes without validation paths. It was stopped without touching production application state. This does not establish an incompatible field or reproduce the original fast invalid outputs; no schema default or model change is justified by that probe.
