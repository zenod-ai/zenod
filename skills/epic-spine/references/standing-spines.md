# Standing spines

A **standing spine** is ongoing work that never closes (a watch, a cadence of posts, a weekly review). It has targets per period instead of a Done means, and never an `## Outcome`.

Declare it in the header: `Spine kind: standing`. Everything else stays a normal spine (profile, parent, Spine Map, Decisions, Issue Ledger).

## Targets

```markdown
## Targets

| Target | Per | Measure |
|---|---|---|
| 3 posts published | week | count of posts in the publishing log |
```

`Target`, `Per`, `Measure` are required (a trailing `(…)` in a header is ignored), at least one row, no empty cell.

## Scoreboard

Current State carries one extra line, target vs actual for the period now running, rewritten each wake:

```
Scoreboard: 2026-W43: 2/3 posts published (on pace)
```

## Misses and closing

A missed target becomes an Issue Ledger row (what slipped, why, the fix, an assignee), like any defect. A standing spine is never `Status: done` (rejected): it stays `active`, or `deferred` while paused. If the work really ends, replace it with `Superseded by:`, or start an ordinary spine with a Done means.

## Tools

`validate_spine.py` skips the Definition Of Done and `## Outcome` demands for a standing spine, and rejects a missing `## Targets` or `Scoreboard:`, or a done Status. `spines.py --json` adds `standing` to each node (`targets`, `scoreboard`; null on other spines). Logic: `scripts/standing.py`.
