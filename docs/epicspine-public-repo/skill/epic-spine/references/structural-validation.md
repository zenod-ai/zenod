# Structural validation and prose advice

Run `python3 skill/epic-spine/scripts/validate_spine.py --strict PATH` from the package root. Use `--graph` with the affected active spine family to check hierarchy as well. Validation establishes a document contract, not successful execution, evidence authenticity, user approval, remote ticket existence, or current delivery freshness.

## Diagnostic categories and exit codes

Every diagnostic has a stable `rule_id`, `category`, `severity`, `message` and `fails_strict` boolean. IDs identify rule families; messages add the affected field, row or path. Consumers should use IDs/categories, not parse human prose.

| Category | Meaning | Default | Strict |
|---|---|---|---|
| structural | Invalid tables, identifiers, references, hierarchy, declarations or conflicting authoritative state | Fails | Fails |
| required-data | Missing/unresolved required fields, acceptance, evidence or selected-dialect data | Existing errors fail; unresolved warnings remain visible | Fails |
| advisory | Preferred wording, reuse labels, staffing prose, heartbeat descriptions and other workflow presentation advice | Visible | Visible; does not fail |

Exit 0 means no failing diagnostics under the selected mode; 1 means a validation failure; argparse returns 2 for invalid CLI usage. Existing error severity is never demoted by `--strict`. A warning is no longer automatically a strict failure. Missing required columns, unresolved full-v2 discovery/dispatch metadata, invalid tickets, done-without-evidence, rejected decisions without evidence, state conflicts and graph errors retain their gates. `Health / Blocker: none`, `no blocker`, `no blockers`, `nothing`, `n/a` or `-` in a Spine Map row means an explicit clear condition; a blank or placeholder remains unresolved.

| Stable rule family | Subject |
|---|---|
| ES-S-TABLE | Table syntax and required table structure |
| ES-S-TICKET | Invalid ticket/backend/ledger identity or reference |
| ES-S-DIALECT | Unsupported profile, dialect or surface |
| ES-S-STATE | Competing, duplicate or conflicting current state |
| ES-S-GRAPH | Hierarchy, roots, parents and stable spine identities |
| ES-S-CONTRACT | Other objective document structure |
| ES-D-REQUIRED | Missing/unresolved required contract data |
| ES-D-ACCEPTANCE | Missing/unresolved observable v2 acceptance |
| ES-D-EVIDENCE | Missing/unresolved surface-specific v2 evidence method |
| ES-A-PROSE | Advisory workflow wording and presentation |

Classification is additive. `validate_local(path)` still returns a `SpineDocument` with the existing `errors`, `warnings`, `state`, `state_sources` and `tickets`. Its `diagnostics` property reflects graph errors added after local validation. `document.fails(strict=True)` applies the same exit policy as the CLI. `validate()` and JSON retain `path`, `errors` and `warnings`, adding `diagnostics`; consumers that treated every warning as fatal should use the new policy. Plain output includes rule IDs and categories. No persistent diagnostic cache or alternate state record is created.

## Observable acceptance without prescribed sentences

V2 keeps a declared Acceptance surface and SHIP/HARDEN separation. SHIP needs a resolved observable outcome or acceptance checkbox and a resolved evidence method appropriate to that surface. There is no minimum or maximum step count. Personal observation, role authority and safe handoffs remain operating obligations; finding or omitting a phrase does not prove whether they happened.

A one-step CLI journey can use:

```markdown
Acceptance surface: cli

## Definition Of Done

SHIP

Acceptance outcome: The greeting contains the supplied name.
Evidence method: cli: Invoke the executable with a sample name; retain its returned text and process status.

- [ ] Run the sample and compare the greeting with the expected value.

HARDEN

- [ ] Later: measure performance with large inputs.
```

`Acceptance outcome` accepts free prose. If explicitly declared, it must be resolved; other checkboxes cannot conceal its placeholder. `Evidence method` uses `<declared surface>: <free description>` so the validator can associate the method with browser, cli, library, infrastructure or documentation without demanding a prescribed sentence. An empty, placeholder or differently qualified method fails strict validation. These fields are declarations of a plan, not execution evidence.

Existing valid v2 documents need no mandatory rewrite. The compatibility adapter accepts existing `Evidence:` declarations or evidence-producing acceptance steps: browser/screenshot methods; CLI commands, terminal streams or exit status; library consumers, imports or behavior/unit tests; infrastructure probes or health/service checks; documentation rendering, walkthroughs, links or examples. The old conjunction of exact phrases, numbered-step padding and PORT/DUPLICATE/BUILD markings no longer decides acceptance. A generic test-package handoff does not substitute for an evidence method. If a free-form legacy description is outside the adapter's vocabulary, the explicit surface-qualified method avoids guessing its meaning. A human still assesses whether the specified observation actually proves the desired outcome.

The full template and CLI example demonstrate the explicit form; `tests/fixtures/sprint-v2.md` remains a legacy compatibility fixture. Blank Mission/Definition Of Done bodies (and the full profile's Validation Evidence body) remain unresolved required data. V1 is not silently upgraded to the v2 evidence schema. Full/compact selection and dialect selection remain independent: absent profile is full, absent dialect is v1, a supported CLI dialect override wins over a supported declaration, and unsupported declarations cannot be hidden by overrides. Local-ticket authority/path checks and offline GitHub uncertainty are unchanged.
