# Tree cleanse: make a stale epic tree tell the truth

Use when a repo's tree reads as live work that is not: closed epics whose ledger rows still say ready/active/blocked, Status words no tool reads, epics nobody has touched in weeks. Fix at the source; never hide rows in a viewer. The doctrine is here; each repo applies it to its own spines in its own thread.

## Vocabulary

- A ledger row is open unless its Status is `done`, `deferred` or `superseded`. `superseded` = closed, not done (the work stopped or moved elsewhere); `spine_fix` maps dropped, obsolete, wontfix, cancelled and abandoned to it. Done-like words (integrated, merged, live, verified...) are not open.
- A finished epic (Status done/superseded, or a `Superseded by:` header) has no open rows. `validate_spine.py` flags one that does (`closed-rows:`, advisory, never a block).

## Steps

1. **Audit** (report only): `python3 <skill>/scripts/tree_audit.py --repo <repo>` (`--json` for tools). It lists finished epics with open rows, missing or non-standard epic Status words (root included; "conflicting state lines" means two state lines disagree and the reader drops both), non-standard row words, stale goals (active/blocked, 14+ days untouched), epics over the 150-line budget, undecided epics (draft/deferred/no Status, 14+ days untouched) and the root's Status and age. Nothing is written.
2. **One verdict ask per repo.** Put the open questions (stale and undecided epics: keep, close or supersede) to the owner as ONE coded `decide` ask in the root spine, in plain words (what each epic was for, what is left, the recommendation and why), ids after. Never close a goal silently.
3. **Apply the verdicts.** Each closing epic gets its `## Outcome` (verdict, one sentence, evidence) and `Status: done`, or `Superseded by:` the successor; kept ones get an exact Status and a fresh Next action.
4. **Sweep.** `python3 <skill>/scripts/spine_fix.py --close <epics>` previews (the audit prints the exact command); add `--write` to apply. Each open row becomes `superseded` and its Next Action gets `closed with epic <date>; successor: <link or none>` (a ledger without a Next Action column, or a row short of cells: once on the epic's `Next action:`). Done/deferred/superseded rows are never touched; re-running changes nothing. Commit the sweep on its own.
5. **Root check.** Re-run the audit: the first group is empty; fix the root's Status if it is missing or conflicting; the remaining groups are the owner's decisions or the next slimming work (detail to linked pages, epic under 150 lines).
