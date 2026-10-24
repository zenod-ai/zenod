# Personas and teams

A **persona** is a reusable worker identity. It says who, never what for: no goal, cadence or write scope. What a persona does for a goal is its **assignment**, written in that epic's `## Team` table. A persona is not an epic; several personas work one epic, and one persona may work several.

## Persona file: `personas/<name>.md`

One file per persona at the repo root (`<name>` lowercase, hyphens; the stem and `name:` must agree). `personas/README.md` is ignored.

```markdown
---
name: watcher
template: worker      # role template it starts from
model: sonnet         # model alias or id
host: vps1            # machine or runner it wakes on
---

## Remit
What the persona is for, in a sentence or two (any goal-independent standing duty).

## Reads
What it reads by default (files, pages, services).

## Writes
What kinds of thing it writes (never a path list: scope is per epic).
```

All four keys and all three sections are required. A `goal`, `cadence` or `write scope` key (or a section of those names) is rejected: it belongs in the Team table.

## Team table: `## Team` in each epic

```markdown
| Persona | Cadence | Write scope | Notes |
|---|---|---|---|
| Watcher | every 12 h | this spine only | goal-specific instructions |
```

`Persona`, `Cadence`, `Write scope` are required and non-empty; extra columns are allowed; `Notes` holds the goal-specific instructions. Names compare case-insensitively with spaces as hyphens (`Delivery Manager` = `delivery-manager`); a trailing `(…)` is ignored.

## Assignees

A ledger row's `Owner / Assignment` is its assignee: a persona on the repo's team, or `Jordi` (an ask to Jordi is a row assigned to him). The team is the persona files when the repo has any, else the epic's Team table; with files, every Team persona must have one.

The check is opt-in per epic: it runs only when the epic has a `## Team` section, and then rejects every non-draft row whose assignee is not on the team or `Jordi`. Epics without `## Team` keep validating with any value (`unassigned`, `worker (…)`, paths).

## Tools

- `validate_spine.py personas/<name>.md` checks a persona file; `validate_spine.py <epic>` checks its Team table and assignees. `personas.py FILE...` checks files alone.
- `spines.py --json` adds each node's `team` and a top-level `personas`: every persona (file or Team row) with `epics` and `queue` (its rows in `ready`, `active`, `blocked`, `review` or `testing`, across the tree); `Jordi` appears when he has open rows.
