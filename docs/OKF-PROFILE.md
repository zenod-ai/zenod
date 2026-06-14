# Zenod OKF Profile

Zenod vaults are a strict profile of Open Knowledge Format (OKF) v0.1.

OKF provides the interoperability floor: markdown concept documents with YAML
frontmatter, optional `index.md` files for progressive disclosure, markdown
links between concepts, citations, and git-friendly distribution. Zenod keeps
that shape but adds stronger memory guarantees for personal and agent-operated
vaults.

## Compatibility Contract

A Zenod vault SHOULD be consumable as an OKF bundle:

- `index.md` at the vault root declares `okf_version: "0.1"` and points to the
  main concept/evidence areas.
- Meaning pages in `Projects/`, `Areas/`, and `Notes/` are OKF concept
  documents.
- Every meaning page has OKF's required `type` field.
- New meaning pages include OKF-friendly aliases:
  - `description`: same meaning as Zenod `summary`.
  - `timestamp`: ISO 8601 datetime for the last meaningful update.
  - `resource`: optional canonical URI when the page describes an external
    asset, API, repository, document, table, or other resource.
- Standard markdown links to local `.md` files are accepted as concept links.
  Obsidian wikilinks remain supported.

## Zenod Guarantees Above OKF

OKF consumers are intentionally permissive. Zenod is stricter:

- Tags are controlled by `.brain/config.yml`.
- Meaning-page `type` must match its folder: `project`, `area`, or `note`.
- Meaning pages must link to at least one other meaning page or index.
- Evidence in `Log/` and `_attachments/` is append-only/write-once.
- Claims derived from evidence cite a stable evidence anchor.
- Writes land as valid commits, land as Inbox questions, or fail cleanly.

Do not weaken Zenod lint to match OKF's permissive consumption model. The
implementation should expose OKF compatibility while preserving Zenod's higher
bar for agent-authored memory.
