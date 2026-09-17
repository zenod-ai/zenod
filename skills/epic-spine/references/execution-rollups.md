# Execution rollups

`rollup_spine.py` projects direct-child execution facts into the target parent's existing Spine Map. It preserves child membership, links, Purpose and unknown semantic columns. Only Owner, Status, Health / Blocker, Latest Evidence, Next Action, Source revision and receipt/coverage columns are generated. Mission, Current State, acceptance, priority, Human Gates, decisions and research verdicts remain steward-owned. Inline relative links in projected evidence/actions are rebased to their authoritative child source. Reference-style/shortcut links that depend on child-only definitions require explicit reconciliation to inline source links; the tool refuses them rather than emitting broken parent links.

The tool consumes normalized `document.state` and `document.tickets`. Full legacy children without sufficient normalized state are explicitly unmanaged; conflicting facts never get a guessed winner. A child `done` status remains a source claim, not independently accepted delivery.

## Receipt meaning

A trailing `epicspine-rollup:v1` comment stores direct-child source hashes, effective subtree fingerprints and ticket verification metadata. It does not store a second mutable status ledger. Freshness is about observed inputs, not truth:

- `current-inputs`: the projection covers the observed source inputs; it does not prove execution or evidence claims.
- `stale`: a descendant receipt no longer matches its current inputs.
- `missing`: an input is absent, unreadable, outside scope or beyond the coverage limit.
- `conflicting`: duplicate/contradictory state, identity, lineage or receipts need reconciliation.
- `unmanaged`: required authoritative state/structure or a descendant receipt is absent.
- `incomplete`: reachable descendants have one of the above defects.

Coverage and Verification remain separate. `source-read` means source bytes were read; `github-unverified` preserves the offline backend's uncertainty; `unavailable` marks an unreadable source. Receipt JSON retains each ticket's verification/freshness provenance. Neither an old declared date nor `local-read` is promoted to verified current execution.

The legacy Last Rolled Up cell becomes `receipt:HASH_PREFIX`, a deterministic reference rather than a fabricated wall-clock timestamp. Source revision is the child's declared verified source revision; Input fingerprint additionally reflects actual source bytes, local ticket content and descendant inputs. These are different facts. Source fingerprints are not research verdicts, approvals or evidence attestations.

Only the reachable subtree is read, within an explicit scope root and a default 256-input cap. Readable/source counts and per-input diagnostics expose coverage; unregistered files are not discovered or claimed covered. History snapshots cannot become active inputs. Local ticket roots are checked against the rollup scope before the backend reader opens their files, even when the child declares a broader permitted root.

## One-level ownership and invalidation

Preview recursively fingerprints descendants to detect upstream staleness, but projects only direct children. It never writes children or ancestors. If a grandchild changes, an ancestor check becomes stale/incomplete even before the intermediate child is reconciled. Applying the ancestor first records that incomplete state; it cannot make the child receipt current. Reconcile bottom-up, with each target steward's existing authority. Every changed intermediate input invalidates its parent receipt again.

## Read-only check and preview

From the repository root:

```sh
python3 skill/epic-spine/scripts/rollup_spine.py check examples/rollups/root.md --scope-root examples/rollups
python3 skill/epic-spine/scripts/rollup_spine.py preview examples/rollups/root.md --scope-root examples/rollups
```

The supplied synthetic graph intentionally starts unmanaged, so check exits 1. Preview prints deterministic diagnostics, a proposal SHA256 and a unified diff without changing any source. Add `--proposal PATH.json` to save the reviewed proposal by exclusive creation inside the scope root; existing files are never overwritten. A saved proposal is a proposal artifact, not authorization.

## Applying an already authorized proposal

Apply requires an explicit bound target, matching existing target owner, bounded read and write roots, and the exact hash from the reviewed proposal:

```sh
python3 skill/epic-spine/scripts/rollup_spine.py preview TARGET.md --scope-root ROOT --proposal ROOT/rollup-proposal.json
python3 skill/epic-spine/scripts/rollup_spine.py apply TARGET.md --scope-root ROOT --proposal ROOT/rollup-proposal.json --steward EXISTING_OWNER --write-root ROOT --expect-proposal-sha256 REVIEWED_HASH
```

These flags check a role/path binding; they do not grant authority or authenticate a person. Use apply only inside an existing user-authorized steward assignment. An observer or child worker without target write authority stops at the precise proposal. The tool rejects a different target/owner/read scope, expanded write target, edited proposal, changed target, changed child/ticket inputs or malformed receipt. It regenerates the candidate from current inputs rather than trusting arbitrary replacement text in JSON.

Apply replaces only the target file atomically after freshness checks. Interruption before replacement leaves the original intact. If replacement succeeded but acknowledgement was lost, repeating the exact reviewed proposal returns `already-applied` when inputs still match. Unchanged runs are no-ops. Normal single-steward discipline still applies: hash checks do not provide distributed transactions against unrelated processes ignoring ownership.

Malformed, multiple or nontrailing receipt blocks require explicit reconciliation; the tool does not guess how to repair them. Projections with incomplete children may be recorded honestly, but check stays failing until their inputs are reconciled. Parent semantic consequences always require the steward's own decision.

## Synthetic walkthrough

Copy `examples/rollups/root.md`, `child.md` and `leaf.md` to a temporary directory before experimenting. Their synthetic owners are steward-root, steward-child and steward-leaf. Preview/apply child first, then root, using reviewed hashes and that temporary directory as both roots. A subsequent root check exits 0. Change leaf's declared Status and check root again: it becomes stale/incomplete without modifying root or child. Repeat the child→root sequence to reconcile each level. The synthetic GitHub reference remains unverified throughout.

## Python API

- `plan_rollup(target, scope_root, max_inputs=256)` returns a deterministic proposal with original target hash, exact input hashes, candidate text, receipt, coverage and diagnostics. It is read-only.
- `proposal_hash(proposal)` hashes its canonical JSON representation.
- `apply_rollup(proposal, bound_target=..., steward=..., scope_root=..., write_root=..., expected_proposal_hash=...)` rechecks the binding, proposal and inputs, then returns `applied` or `already-applied`.

The helper reads the existing validator/reader APIs without changing their semantics. It adds no live GitHub fetch, task backend cache, scheduler or automatic semantic decision engine.

Compatibility note: canonical `Waiting on: none` is projected literally. The validator baseline used by this helper can warn that `none` is unresolved in a legacy Spine Map blocker cell under `--strict`; the separate diagnostics follow-up handles explicit no-blocker values. The helper does not invent a blocker to suppress that warning.
