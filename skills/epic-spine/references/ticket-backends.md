# Ticket backends

The step row is the ticket (`spine-model.md`); a backend record is optional, linked only when one step needs its own discussion. The optional header `Ticket backend: github|local` selects the kind (omission means GitHub, with all existing URL/status checks). Choosing a backend never migrates records or performs a remote fetch.

## GitHub

Keep the Issue Ledger with concrete HTTPS GitHub/Enterprise issue URLs. Its status, assignment and evidence cells are declared snapshots; the issue stays authoritative, and snapshots change only from reconciliation evidence.

Validation is offline: a valid URL does not prove the issue exists, credentials work or a status is current. Normalized records expose `verification: unverified`, `freshness: unknown` and the ledger's date as `declared_verified_at`; a date never makes a snapshot verified. No live fetch exists; a later adapter needs explicit opt-in, must report unavailable apart from verified, and keep provenance. Example: `examples/EPIC-GITHUB-TICKETS.md` (its URL is format evidence only).

## Local files

Declare an explicit root:

```markdown
Ticket backend: local
Ticket root: tickets
```

The local Issue Ledger contains only references and dependencies:

```markdown
| Ticket | Depends On |
|---|---|
| [R-001](tickets/R-001.md) | none |
| [R-002](tickets/R-002.md) | R-001 |
```

Each referenced Markdown file owns its mutable facts in preamble fields before its first `##` section:

```markdown
# R-001: Specify a reproducible comparison

Ticket ID: R-001
Status: ready
Owner: example-researcher
Evidence: [Protocol draft](../protocol.md#draft)

## Acceptance

- [ ] AC-1 State the observable acceptance here.
```

Ticket ID is stable and case-sensitive, starts with a letter, and otherwise contains letters, digits, underscore, hyphen or dot. IDs must be unique across the board's referenced files. Aggregate consumers scope local IDs by owning spine/board; a file rename does not change its identity. The reader checks referenced records, not an unrestricted folder inventory.

Status uses the existing vocabulary: draft, ready, active, blocked, review, testing, done, superseded, deferred. Case is normalized; unknown terms such as `closed` are rejected rather than silently mapped. Owner and Evidence must be resolved. `Owner: unassigned` can truthfully describe a draft. Optional `Waiting on` and `Verified at` values are retained; absent waiting data is unknown, not inferred to mean no blocker. Evidence is preserved verbatim and relative references are interpreted from the authoritative ticket file, not from the spine. Reading a ticket does not prove its acceptance evidence or resolve every evidence link.

Do not repeat local Status, Owner or Evidence in the spine ledger: those extra columns are rejected. The ledger owns only membership and comma-separated dependency IDs. Each dependency must refer to a valid ticket in the same board; use explicit `none` when there are no dependencies. Missing files, invalid metadata, duplicate IDs and unresolved dependencies are errors. Duplicate identities are omitted from normalized results, not arbitrarily selected.

### Path boundary

`Ticket root` resolves relative to the spine directory (absolute roots are allowed only inside the boundary below). Ticket references are relative to the spine directory, use `.md` or `.markdown`, and may be bare paths or Markdown links. Percent-encoded filenames are supported. Queries/fragments, remote URLs and absolute ticket references are rejected. After resolving traversal and symlinks, every referenced file must remain inside Ticket root.

By default Ticket root must remain within the nearest checkout/repository ancestor marked by `.git`; outside a checkout, the spine directory is the boundary. A root such as `../../` cannot authorize arbitrary filesystem access. To use already authorized external files, explicitly declare a bounded absolute `Ticket permitted root` and place Ticket root inside it. Filesystem root `/` is rejected. This declaration records scope; it does not grant an agent new user authorization to read or publish outside its task.

Example: `examples/local-research/EPIC-LOCAL-RESEARCH.md` (synthetic board, two tickets, a protocol record).

## Normalized reader API

`validate_local(path).tickets` is a list of dictionaries. `read_tickets(path, fields, sections)` returns `(tickets, errors)` for reference/record adapters. Use `validate_local` when full spine and ledger-shape validation is required. Consumers must inspect all validation errors before using any records. Migration previews preserve the original ticket path context while validating their temporary candidate; changing document profile does not relocate or migrate ticket authority.

| Key | Meaning |
|---|---|
| identity | `github:CANONICAL_URL` or board-scoped `local:TICKET_ID` |
| location | Authoritative GitHub issue URL or resolved local ticket path |
| status | Declared status from the selected authoritative source/snapshot |
| owner | Declared assignment owner |
| evidence | Evidence text/reference with the source location as its relative base |
| waiting_on | Optional declared wait; absent is unknown |
| backend | github or local |
| verification | unverified (offline GitHub snapshot) or local-read (file bytes read) |
| freshness | unknown until a consumer applies an explicit revision/time policy |
| source_revision | SHA256 of exact local bytes; empty for unfetched GitHub state |
| declared_verified_at | Optional declared timestamp; not a fetch attestation |

Verification and freshness are separate: unverified is not stale, and reading current file bytes does not prove execution is fresh. Rollups keep the distinction and never turn local-read or an old declared date into verified delivery. The reader adds no cache or mutable board; editing a ticket changes the next read.
