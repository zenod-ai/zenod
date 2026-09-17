# Compact active state

Choose `Spine profile: compact` for a small active epic. Absent profile or explicit `full` retains the legacy required fields/sections. Profile controls document size; `Spine dialect: v1|v2` separately controls the acceptance workflow. Compact v1 requires no sprint boilerplate. Compact v2 retains its surface declaration and SHIP/HARDEN acceptance; full-profile staffing/discovery/heartbeat prose is not mandatory compact content.

The compact active document contains Mission, Non-Goals, Current State, Definition Of Done, Issue Ledger (active work and dependencies), and Decisions. Retain rejected/superseded decisions and evidence. Add Human Gates, Write Scope, recovery, hierarchy and Book details only when applicable. Ticket references follow the explicitly selected [backend contract](ticket-backends.md); GitHub remains the default. Local mode uses a reference/dependency-only ledger with mutable facts in authoritative ticket files. Use the [compact template](../assets/compact-spine-template.md).

## One authoritative state

`## Current State` contains these single-line labels. Link longer evidence rather than pasting it into a field.

| Label | Normalized key | Meaning |
|---|---|---|
| Owner | owner | One current spine steward |
| Status | status | draft, ready, active, blocked, review, testing, done, superseded or deferred |
| Last attempted | last_attempted | Last concrete action |
| Result | result | Actual result of that attempt |
| Evidence | evidence | Link or source that supports the result |
| Waiting on | waiting_on | One current wait/blocker condition, or explicit `none` |
| Approved work | approved_work | Authorized work that remains allowed |
| Next action | next_action | One exact resumable action |
| Source revision | source_revision | Revision/content hash of the source verified, not an inferred branch head |
| Verified at | verified_at | Absolute verification time, preferably ISO 8601 with timezone |
| Phase (optional) | phase | Context such as implementation; does not duplicate Status |

Do not author competing preamble status/steward fields or another live Execution Cursor in compact documents. Role queues and displayed summaries link to this state or are explicitly generated projections with their source revision. A completed handoff is historical evidence, not another source of current status.

`validate_local(path).state` exposes the normalized string dictionary. `state_sources` maps each key to a list of opaque provenance strings with source section, label and line. `read_state(text, compact=False)` returns `(state, state_sources, errors)` for tools; `compact=True` additionally checks required state. Consumers must inspect all document errors before using normalized facts. A conflicting key is omitted from `state`, never selected by precedence. The legacy `validate()`/CLI result shape remains unchanged.

Legacy aliases include Active spine steward→owner, Execution status→status, Blocker/Blockers→waiting_on, Latest Evidence→evidence, Last reconciled commit→source_revision and Last verified→verified_at. Values are compared after whitespace normalization; statuses are case-insensitive and none/nothing/n/a/no blockers normalize to `none`. The tool does not infer semantic equivalence between different prose. Phase remains separate from Status. Updated is a document-edit date, and Fresh base commit is an execution base; neither is silently substituted for verification metadata.

Legacy fields can remain in both Current State and Execution Cursor only when explicit overlapping facts agree. Conflicts identify both source locations and require the steward to reconcile them. Placeholders do not establish verified facts. Required compact values must be resolved; `Waiting on: none` and `Approved work: none` are valid explicit facts.

## Optional hierarchy

Standalone compact documents may omit all lineage fields. They still require Repository, Primary document, Spine ID and Integration branch. Once lineage is declared, include Spine Type, Root spine, Parent spine and Additional root rationale; direct children remain in Spine Map. `--graph` fails for compact input with undeclared lineage rather than claiming that its ownership hierarchy was checked. Pass only active documents to graph validation, never historical snapshots with preserved IDs. `is_history_snapshot(path)` identifies package migration archives by the `.history-<12-hex-SHA256>.md` (or `.markdown`) suffix plus a matching content hash. Inventory tools must exclude those paths; explicit validator input returns a historical-snapshot diagnostic before reading active IDs, so archived declarations cannot become a second active spine. Keep archive names stable with their links; do not rename them into an active discovery pattern.

## Reviewable migration

The helper migrates only reconciled full/legacy input. It never guesses which conflicting Next action, owner or status is newer. Missing verification metadata or Non-Goals must be authored in the source by its steward first. Evidence may link directly to the preserved Validation Evidence section. No ticket state, decision meaning, authorization or source revision is inferred.

From the repository root, preview the synthetic migration:

```sh
python3 skill/epic-spine/scripts/migrate_spine.py tests/fixtures/legacy-migration.md
```

The default prints a source SHA256, archive target and unified diff. It does not write the source or archive. Review the proposed active state, moved content and links. For a source you own and are authorized to migrate, use the exact preview hash:

```sh
python3 skill/epic-spine/scripts/migrate_spine.py PATH --apply --expect-sha256 REVIEWED_HASH
python3 skill/epic-spine/scripts/validate_spine.py --strict PATH
```

Apply rejects a changed source/hash, mismatched existing archive or ambiguous duplicate headings/anchors. A byte-identical existing archive can be reused after an interrupted attempt; it is never rewritten. It writes a byte-exact `NAME.history-HASH.md` snapshot beside the source, then atomically replaces the source. Keeping both files in the same directory preserves archived relative links. The active path keeps original section fragments as explicit anchor links for moved handoffs/subheadings/explicit anchor IDs, so old fragments continue to navigate to the historical evidence. Rejected decisions, identifiers, active acceptance, recovery, Book-specific sections and permission/authority sections stay visible. Other legacy bulk becomes links to history. Historical snapshots retain their original text and must never be interpreted as current assignments. Commit both files together; inspect the diff before accepting migration.

This is a conservative Markdown helper, not an arbitrary renderer migration engine. Duplicate heading fragments, heading link/reference markup, and Markdown reference definitions require manual migration rather than guessed renderer fragments or detached retained reference links. These unsupported forms are refused before source/archive writes, including reference definitions placed in a section that would otherwise be archived. The source hash prevents stale reviewed content from being applied; normal single-steward/write-scope rules still apply. No private repository migration, external issue update or installed-skill rollout is implied.

## Size of the synthetic examples

The hand-authored active example is 49 lines. The conservative legacy fixture migration is 110→90 lines: it retains acceptance, rejected decisions and permission context, while old headings become compact anchor links. Migration prioritizes lossless navigation over producing the smallest possible file; the steward can review a later cleanup of no-longer-needed compatibility links.
