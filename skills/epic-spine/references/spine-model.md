# Spine Model

What every epic says, hierarchy, artifact authority, profiles, and write scope.

## What Every Epic Says

A spine is a snapshot of intent, facts and learnings, plus behaviours for maintenance and for dispatching workers. A cold agent given only the spine knows how to keep going, what the state is and where the issues are, then builds its own context as it needs it. A spine holds only what is specific to it; defaults live at repo or machine level.

- **Tree:** objectives and facts hanging from EPIC-0, the root: the purpose, always EPIC-0. The root is the epic with no parent. Status rolls up to the nearest epic ancestor.
- **Leaf:** anything linked into the tree: an epic or a page. Any leaf may have children (pages under pages, epics under pages, any depth) and may be linked from anywhere as a reference.
- **Epic** (= spine; "milestone" = epic): a leaf stamped `EPIC-<n>`. A goal we seek to accomplish, so it carries the sections below. It has exactly one parent, the goal it serves, so rollup, the why-chain and ownership stay single. Only epics have required structure.
- **Page:** an unstamped leaf (facts, notes). No required structure; it has one or more parents (any inbound link from the tree places it), and nothing rolls up from a page.
- **Guard:** anything that states an intent or goal is an epic, never just a page.
- **Learning:** a distinct asset, `L-<n>`, scoped to the epic it sits in.
- **Step:** an independently testable mid-outcome its epic's measurable outcome needs, closed only with evidence (the ledger's Latest Evidence column is its test). The step row is the ticket; a GitHub issue or ticket file is optional, linked only when one step needs its own discussion.
- **Orphan:** a doc no tree leaf links to. Discovery follows epic parent links and page inbound links.

| Section | What it says | Why |
|---|---|---|
| `## Goal` (`## Mission` counts) | what the work achieves and why, in plain words | anyone can tell what the work means |
| `## Serves` | how it serves its parent, with a link (the root has no parent) | the tree reads as one story |
| Spine Map | one "contributes" sentence per child | a parent shows what each child adds |
| `## Done means` | 2-5 measurable outcomes, above the steps; counts as the DoD heading | "complete" is visible without opening steps |
| Title, status | `EPIC-<n>: <name>`; one status word | a goal is named and read the same by every tool |
| Non-Goals, Current State, Issue Ledger, Decisions | as below | state and history stay in one place |

**The why rule.** If a goal's why is not written anywhere in the repo, ask the spine's owner. Never invent one.

**What goes where.** Why the work exists and what done means stay in the spine; "3. Tools: write the new format by default, owner, status, next action" is one step row; a long debate on how to treat legacy docs gets issue #12, linked from that row, and only its outcome is written back. In a compact or Doctrine 2 epic the row itself is the ticket: `Issue` may stay `draft`.

**Maintenance** (the agent bound to an epic):
- **Tidy and informed.** Keep the epic tidy and fully informed: after each step, update state, steps and evidence.
- **Propagate findings.** Record a major finding where it changes the picture, up to the parent (or higher) if it changes the parent's goal, state or plan.
- **Minimal epics.** An epic holds only the context needed at its level: goal, done means, state, steps, decisions, learnings. Each Decisions row is ONE line, linking to a page for the detail; detail and facts live in linked pages, opened only when needed: context at the level of the epic, depth by link.
- When an epic closes, each of its learnings is promoted to the parent or retired.
- The checker gives an advisory size budget per epic.

**Enforcement.** The commit check blocks only newly added epics that lack these sections; existing epics keep passing and `spines --json` reports `missing_sections` per epic. Whatever this page requires is enforced there or dropped; `--strict` stays advisory. Page and orphan checks are advisory. A `Spine Type:` line is ignored.

**Header details** (optional, one line each): `Spine profile:` compact|full (size), `Spine dialect:` v1|v2 (v2 adds SHIP/HARDEN), `Ticket backend:` github|local. <!-- open: header details -->

## Connected Spine Model

Treat every EpicSpine as a node in a canonical ownership hierarchy:

- Prefer one canonical root spine per repository or coherent project. Multiple roots are allowed only when they represent intentionally independent ambitions; record why each additional root cannot be a child of the canonical root.
- Every non-root spine has exactly one canonical parent and inherits exactly one root; parentage may nest to any depth. The hierarchy is a rooted tree (or a justified forest); cross-links may form a wider knowledge graph but never change parentage or rollup ownership.
- Every spine declares a stable Spine ID. Connected spines additionally declare Root Spine and Parent Spine. A parent lists each direct child in its Spine Map; a child links back to its parent and root.
- A child owns its local mission, acceptance, execution state, backlog, decisions, and evidence. Its parent owns only the compact rollup, dependencies, health, and cross-child decisions. Roll up direct children one level at a time; never copy descendant ledgers or deep history into ancestors.

`AGENTS.md`, repository instructions, and launch prompts may route a cold start to the root spine. They must not duplicate live project state. The root spine is the canonical starting point; agents follow its active child links until reaching the spine bound to their work.

## Epic Log

Wording: the root spine is the trunk; a goal (epic) is a node; the **epic log** is the one tree per repo. Files and header fields keep their names.

- A goal hangs from the root spine (which states the repo's purpose) or from another goal. Spines are nested markdowns: progress within a goal is written in that goal's spine. A new measurable objective worked over iterative pushes (a sprint or plan, each push unblocking the next) gets a new leaf markdown linked from its parent; a small one-push item stays a `- [ ] <ID> text` line in its parent's Definition Of Done. Judgment, not a hard rule.
- Every goal is named `EPIC-<n>: <short name>` (file title `# EPIC-<n>: <name>`), states its goal in one line and lists measurable success criteria; without a code it cannot be discussed.
- The child's `Parent spine:` header is the structural authority; the parent's Spine Map must list it with the same Spine ID. A disagreement (either way, or a row pointing at a missing file) is a mismatch. Parent state rolls up from children (blocked wins; all children and criteria done = done; any progress = active).
- Epic = a file titled `# EPIC-<n>:` (colon; `# EPIC-4 decisions` is a page) or with a `Spine ID:` line, never by name alone (not under `archive/`, `node_modules`, dot-dirs, `handoffs/`, `examples/`, `fixtures/`, `test/`, `tests/`, or a vendored skill); any other .md is a page (`doctrine.py`). An epic not in the tree is an orphan. Header and Spine Map links resolve against the file's own folder, else the repo root (`Parent spine: docs/spines/root.md` works from any folder).
- Create with `spine_new.py` (`references/spine-creation.md`); `pre_commit.py` blocks a newly added/renamed goal doc, or a modified one whose HEAD version already had `Spine ID:`, that has no valid header, is not reachable from the root, or disagrees with its parent's map, and blocks a newly added epic missing title, Goal, Serves (not the root), Done means or Status (`--trackable` + tree + these only; `--strict` stays advisory). Existing epics only warn: the same gaps, over 150 lines or a cell over 200 characters, a page that looks like an epic, an orphan page. It only warns for a modified legacy doc (no `Spine ID:` at HEAD: migrate it with `spines.py`/`spine_new.py`), a root spine with no `Spine ID:` header (migrate the root first), and `Root spine: none`.
- `spines.py --json --repo DIR` is the discovery contract (console pickers consume it; always exit 0):

```
{"root": "<path>" | null,
 "nodes": [{"id", "path", "title", "type", "parent": "<path>" | null, "status", "rollup_status",
            "dod": [{"id", "text", "done"}], "outcome": {...} | null, "current_state": {...} | null, "children": ["<path>", ...],   # depth-first from the root; paths are repo-relative
            "goal", "serves", "done_means": [{id, text, done}], "contributes": {"<child path>": "<sentence>"}, "pages": [{"path", "title", "via"}], "missing_sections": [...], "size": {"lines", "long_cells"}}],
 "orphans": [{"path", "title", "reason"}],      # epics outside the tree
 "orphan_pages": ["<path>"], "looks_like_epic": ["<path>"],   # pages no epic links; pages with Goal / Done means / checkboxes / Next action / Status
 "mismatches": [{"path", "parent", "problem"}],  # header/map disagreement, missing map target
 "next_code": <int>}                              # the code `spine_new.py` gives a new spine; `--active` prints it as `next: EPIC-<n>`
```

## Running

Which epics a wake (a manager run, a scheduled or woken persona) may work is read from the epic's own `Status:`, no other flag. `spines.py --json` carries per node `run_state`, `runnable` and `has_children` (`scripts/run_state.py`; `--active` appends them).

| Status | run_state | runnable |
|---|---|---|
| draft | planning | no |
| ready | ready | yes (defined, not started; launching a persona is the start order and makes it `active`) |
| active, blocked | running | yes (`blocked`: a wake still works unblocked rows and checks the unblock) |
| deferred | parked | no |
| review, done, superseded | finished | no |

- A wake works only runnable epics; it never starts work in a planning, parked or finished one. Any other or missing Status counts as `draft`.
- **Draft until stamped ready.** Every new epic and row enters as `draft` (planning; `spine_new.py` scaffolds `Status: draft`). Only the user promotes `draft` to `ready` ("ready for delivery"): that stamp is the start order. No agent self-readies: a persona or manager that scaffolds or edits an epic leaves it `draft`, and never writes `ready` on its own epic or a row's. The next standing wake picks up each `ready` child, starts its rows and sets it `active`; `Last attempted` records who was started. So a manager can stay on at the root and the repo delivers itself: the user writes into the spine and stamps what is ready.
- `has_children`: the Spine Map (or a `Parent spine:` header) names at least one child that is not finished. A spine with children steers (reads the children, nudges, records) and does not start rows that belong to a child spine.
- Advisories only (`validate_spine.py`, `run-state:`; never a block, not promoted by `--strict`): `Status: active` with `Last attempted` empty or `scaffolded...`; `draft` with ledger rows `active`.

## Spine Versus Issues

Declare `Ticket backend: github|local` (omission defaults to github). GitHub mode retains the existing offline URL/status checks and clearly unverified ledger snapshots. Local mode declares `Ticket root`, uses a reference/dependency-only Issue Ledger, and puts Ticket ID, Status, Owner and Evidence in each authoritative ticket file. Never maintain both a mutable local ticket and copied status cells in its spine. Read `references/ticket-backends.md` for path boundaries, normalized records and verification semantics. No backend choice implies remote access, record migration or new read authority.

- The spine says why the work exists, the outcome, how the pieces fit, the state and where to go next; keep it compact (state, decisions, links, evidence). A step row is the ticket (see above); detailed work for one step (code paths, blockers, logs, review comments) lives in its optional issue or PR.
- Write back only the durable consequence: an issue discussion that changes intent, scope, acceptance, dependency or state is recorded in the bound spine.

## Machine-Read Contract

Dashboards and tools read only these; keep them exact, and write everything else for humans:

- `## Definition Of Done` (tickets: `## Acceptance`/`## Acceptance Criteria`): every criterion is `- [ ] <ID> <criterion>` or `- [x] <ID> ...` plus an optional short evidence note. ID `[A-Z][A-Z0-9]*-\d+` (M4-1, X-1), unique in the file, never renumbered; indented lines continue an item, prose and tier labels (`SHIP —`) are not criteria. Say how a measurable criterion is measured (metric, threshold, window, command).
- `## Current State`: `Status:` is the only status source; `Waiting on:` is context and never implies blocked. Consumers (console badges) read `Status:` only; `spines.py --json` also carries its labels as `current_state`. The manager refreshes Last attempted, Result, Waiting on, Next action and Verified at at the end of every working session or wake, not only at milestones.
- `## Waiting on`: the fewest human asks (≤3, only what blocks the NEXT step), one line each: `- [ask <epic>-A<n>: decide|approve|provide|do @<who> since <date> row <id>] <question> — context: <why it comes up> — impact: <what it unblocks, cost of waiting> — risk: <what could go wrong, rollback> — recommend: X, because … — why <who>: <why not an agent> — steps: … (do) — options: A | B (decide) — unblocks: <rows> — effort: ~5 min` (plain words first, ids and commands in `steps:`; fields in any order; impact/risk/recommend advised from 2026-10-24); the blocked row gets Status `blocked`; Current State's `Waiting on:` names codes (`Jordi: E4-A3`, read as references) or `nobody`. An answer citing a code: rewrite the tag to `[answered <code> <date> @<who>]`, append ` — answer: X`, add a Decisions row, unblock, then append ` · done <date> <sha> [note]`. Replaced ask: `[superseded <code> <date> by <code>]`. Ask exists (any repo, `<repo>/<code>`)? write `- [waits on <code> row <id>] <gloss>` (not counted; search first). `spines.py --json`: `waiting_on`, `waits_on`; contract <https://github.com/AlfaBlok/epicspine-skill/blob/main/docs/doctrine/human-asks.md>; bad asks only warn.
- Status-true (`validate_spine.py` advisories, promoted by `--strict`; `scripts/status_true.py`): a human named in `## Waiting on`, in `Waiting on:` or as owner of an open ledger row needs a coded ask line above, never free text; `Status: done` (spine, or a row citing a criterion ID) needs every Done-means box ticked; `Waiting on: nobody` never sits beside an open coded ask. Also advisory, never promoted: `closed-rows:` a finished epic with open ledger rows.
- `## Standing approvals` (after Waiting on): grants the human gave up front, one line each: `- [grant <epic>-G<n> @<who> since <date>] <scope> — limits: … — expires: <date|never> — context: <link>`; they hold for this spine and every descendant (a child narrows, never widens); revoke as `[revoked <code> <date> @<who>] … — why: …`; codes never reused. An action inside an active grant is not an ask: do it and cite `under <code>` in its Decisions row; outside every grant the ask tier applies. Kickoff: propose the bundle as ONE `approve` ask, write the lines on yes. `spines.py --json`: `grants` (own + inherited, `source`, `uses`); contract <https://github.com/AlfaBlok/epicspine-skill/blob/main/docs/doctrine/standing-approvals.md>; bad lines only warn.
- `## Issue Ledger`: the table with columns Issue, Title, Owner (`Owner / Assignment` is fine) and Status; Status is one of draft / ready / active / blocked / done / superseded / deferred (an epic's own Status also says whether a wake may run it, see Running): `superseded` = closed, not done (`spine_fix` maps dropped/obsolete/wontfix/cancelled to it; counts as closed everywhere); when an epic closes (done/superseded, or `Superseded by:`) no row stays open: `spine_fix.py --close` rewrites them to `superseded` (references/tree-cleanse.md); `ready` = defined, not started (launching a persona on the spine, e.g. from the agent_team console, is the start order and makes it `active`; the persona carries the goal to completion); `deferred` = paused by the user (`spine_fix` maps on hold/paused/parked to it); `blocked` = waiting on a named external dependency. A local-backend ledger is reference-only and carries no Status.

Enforcement is `validate_spine.py --trackable` (valid Status, criteria as above, a ledger Status column — or valid ticket-file Status for local), run by the repo's pre-commit hook, which the SessionStart hook installs in EpicSpine repos. The commit fixes what it can without guessing (`validate_spine.py --fix`: criteria to `- [ ] <ID> ...`, alias headings such as `## Exit Test` to `## Definition Of Done`, status synonyms such as in progress to active) and blocks only on a missing Status, Status column or criterion; `--strict` stays advisory there. `validate_spine.py` also warns when Definition Of Done has no checkbox; a github ledger without Status already fails (`references/structural-validation.md`).

## Outcome

Every spine gets `## Outcome` written when its goal closes (done, abandoned or superseded). It holds the verdict, one sentence, each Done means item mapped to evidence links, residual risk/follow-ups, and date plus closing agent/run. `Status: done` (or a `Superseded by:` close) is invalid without a filled Outcome; `--trackable` blocks it, and `--fix` never invents one. The parent's rollup cites the child's outcome sentence. `spines.py --json` carries it per node as `outcome` (`null` when absent; shape in `docs/doctrine/console-contract.md`).

```
## Outcome
Verdict: accomplished | partially accomplished | not accomplished | superseded
Outcome: <one sentence>
Closed: <YYYY-MM-DD> by <agent / run>
Risk: <text or none>
| Done means | Evidence |
|---|---|
| <ID and text> | [PR #31](https://github.com/o/r/pull/31), 0891cbb |
```

## Authority By Artifact

No artifact is authoritative for every kind of truth:

- The spine: intent, scope, epic acceptance, dependencies, decisions, rollup state. The Epic 0 spine: project direction, child relationships, cross-epic health.
- The declared backend record (GitHub issue or local ticket file): detailed execution state of one ticket; offline GitHub ledger values stay unverified snapshots.
- The branch, pull request and code: the implementation that exists. Validation evidence: what was proved in a named environment against a named commit.
- An active Book companion: the navigable user-facing knowledge and synthesis; its registry, the current structured collection; chapters organize domains, leaves own one bounded question. Evidence still outranks a polished leaf.

The active spine steward reconciles contradictions. Never overwrite observable code or test evidence merely because the spine says something older.

## Write Scope

Default rule: **read broadly, write narrowly.**

- The **bound spine** (named by the user, issue, branch or task) is the only spine an agent may edit by default. Each spine names one **active steward** (Epic 0 worker: root; epic worker: child spine; a bound planner while planning), who reconciles and commits spine updates and transfers stewardship explicitly. Never let several agents rewrite goal, acceptance, current state or the ledger at once. Other agents write detail to their bound issue and submit a structured handoff, unless delegated a narrow spine section.
- Parent, child, sibling, portfolio and meta-spines are read-only unless the user says otherwise. On drift there, record a proposed update (target spine, change, evidence, suggested owner) in the bound spine's Open Questions, Planner Queue or Handoff Journal, or hand it to that spine's planner as an issue or note; never edit it just because your work affects it. A task that needs several spines states its write set first and scopes each edit to that spine's authority.
- Parents hold rollups, dependencies, health and cross-child decisions; children stay authoritative for their own state, evidence and ledger. The child steward publishes the rollup (or a proposal); the parent steward reconciles the parent row.

## Active Profile And State

Use `assets/compact-spine-template.md` for a small active epic (`Spine profile: compact`): one authoritative `Current State` (owner, status, last action/result/evidence, one waiting/blocker condition, approved work, exact next action, verified source revision/time; phase optional). Never author a competing cursor, role queue or handoff summary; link or generate projections. Compact requires Mission (or Goal), Non-Goals, Current State, Definition Of Done, Issue Ledger and Decisions; add hierarchy, recovery, write-scope gates and Book details when applicable. Stable ID, repository, document path and integration branch stay required. A standalone compact spine makes no hierarchy claim; `--graph` needs explicit lineage fields. Profile (size) and dialect (v1/v2; v2 adds SHIP/HARDEN) are separate.

Absent `Spine profile` or `full` keeps legacy requirements; legacy Current State/Execution Cursor documents stay readable, contradictory aliases give source-located conflicts, never an inferred winner. Reconcile as the steward before migration; keep completed handoffs in linked history. See `references/compact-state.md`.

