# Spine Model

Conceptual model: hierarchy, artifact authority, profiles, and write scope.

## Connected Spine Model

Treat every EpicSpine as a node in a canonical ownership hierarchy:

- Prefer one canonical root spine per repository or coherent project. Multiple roots are allowed only when they represent intentionally independent ambitions; record why each additional root cannot be a branch of the canonical root.
- Every non-root spine has exactly one canonical parent and inherits exactly one root. Parentage may nest to any depth.
- The canonical hierarchy is a rooted tree, or an explicitly justified forest when multiple roots exist. Cross-links may form a wider knowledge graph, but they do not change canonical parentage or rollup ownership.
- Every spine declares a stable Spine ID. Connected spines additionally declare Spine Type, Root Spine, and Parent Spine. A parent lists each direct child in its Spine Map; a child links back to its parent and root.
- A child owns its local mission, acceptance, execution state, backlog, decisions, and evidence. Its parent owns only the compact rollup, dependencies, health, and cross-child decisions.
- Roll up direct children one level at a time. Do not copy descendant issue ledgers or deep history into ancestors.

`AGENTS.md`, repository instructions, and launch prompts may route a cold start to the root spine. They must not duplicate live project state. The root spine is the canonical starting point; agents follow its active-branch links until reaching the spine bound to their work.

## Spine Versus Issues

Declare `Ticket backend: github|local` (omission defaults to github). GitHub mode retains the existing offline URL/status checks and clearly unverified ledger snapshots. Local mode declares `Ticket root`, uses a reference/dependency-only Issue Ledger, and puts Ticket ID, Status, Owner and Evidence in each authoritative ticket file. Never maintain both a mutable local ticket and copied status cells in its spine. Read `references/ticket-backends.md` for path boundaries, normalized records and verification semantics. No backend choice implies remote access, record migration or new read authority.

- The spine explains why the work exists, what outcome is desired, how the pieces fit together, what the current state is, and where a new agent should go next.
- GitHub issues explain the detailed work for one concrete step: code paths, blockers, implementation notes, logs, review comments, and ticket-level validation.
- Keep the spine clean. Prefer compact state, decisions, links, and evidence over long debugging transcripts or code-level detail.
- Put deep ticket discussion in the GitHub issue or PR, then summarize only the durable consequence back into the spine.
- If an issue discussion changes intent, scope, acceptance, dependency, or current state, write that change back into the bound spine.

## Authority By Artifact

Do not treat one artifact as authoritative for every kind of truth:

- The EpicSpine is authoritative for intent, scope, epic acceptance, dependencies, decisions, and rollup state.
- The declared backend record (GitHub issue or local ticket file) is authoritative for detailed execution state of one ticket; offline GitHub ledger values remain unverified snapshots.
- The branch, pull request, and code are authoritative for the implementation that actually exists.
- Validation evidence is authoritative for what has been proved in a named environment against a named commit.
- The Epic 0 spine is authoritative for project direction, child-spine relationships, and cross-epic health.

When a repository declares an active Book companion:

- The Book is authoritative for the navigable, user-facing body of accumulated knowledge and synthesis.
- When present, its canonical registry is authoritative for the current structured collection or shortlist rendered by the Book.
- Chapters organize domains and index their leaves; leaves own the substantive explanation, research, comparison, or conclusion for one bounded question.
- Evidence remains authoritative for the underlying claims. A polished Book leaf does not outrank current code, data, source documents, or validation.

The active spine steward reconciles contradictions. Never overwrite observable code or test evidence merely because the spine says something older.

## Write Scope

Default rule: **read broadly, write narrowly.**

- The agent's **bound spine** is the primary spine named by the user, issue, branch, or explicit task context. It is the only spine the agent may edit by default.
- Each spine must name one **active steward**. The Epic 0 worker normally stewards the root spine; the epic worker normally stewards a child spine; a planner may steward a spine during planning when explicitly bound.
- The steward reconciles and commits spine updates. Other agents write detailed state to their bound issue and submit a structured handoff unless explicitly delegated a narrow spine section.
- Do not let multiple agents concurrently rewrite mission, acceptance, current state, or the issue ledger. Transfer stewardship explicitly when the active writer changes.
- Referenced parent, child, sibling, portfolio, roadmap, or meta-spines are read-only context unless the user explicitly says the agent may edit that spine.
- If the agent notices drift in a read-only spine, record a proposed cross-spine update in the bound spine's Open Questions, Planner Queue, or Handoff Journal. Include the target spine, proposed change, evidence, and suggested owner.
- Do not update another spine just because the current work affects it. Create a GitHub issue, handoff note, or proposed update for that spine's planner.
- If a task genuinely requires editing multiple spines, state the requested write set before editing and keep each edit scoped to that spine's authority.

Use parent or portfolio spines for rollups, dependencies, health, and cross-epic decisions. Keep child spines authoritative for their own implementation state, validation evidence, and ticket ledger.

Normal rollup does not grant a parent steward authority to rewrite child detail. The child steward publishes the rollup or sends a structured proposal; the parent steward reconciles the parent row.

## Active Profile And State

Use `assets/compact-spine-template.md` for a small active epic. Declare `Spine profile: compact`; keep one authoritative `Current State` with owner, status, last action/result/evidence, one waiting/blocker condition, approved work, exact next action, and verified source revision/time. Phase is optional context. Do not author another cursor, role queue or handoff summary containing competing current facts; use links or explicitly generated projections.

The compact profile requires Mission, Non-Goals, Current State, Definition Of Done, Issue Ledger and Decisions. Add hierarchy, recovery, write-scope gates and Book details when applicable. Stable ID, repository, document path and integration branch remain required. A standalone compact spine makes no hierarchy claim; `--graph` requires explicit lineage fields before it can validate connection.

Absent `Spine profile` or `Spine profile: full` retains legacy requirements. Legacy Current State/Execution Cursor documents remain readable; contradictory aliases produce source-located conflicts, never an inferred winner. Reconcile meaning as the steward before migration. Keep completed handoffs in linked history while preserving rejected decisions, evidence, IDs and old fragments. See `references/compact-state.md` for the normalized state API, conservative migration preview and history rules.

Profile and dialect are separate: compact v1 is a small structural contract; opt into v2 for its SHIP/HARDEN acceptance. The full template remains available for existing v1/v2 workflows and explicit legacy compatibility.

## Name

Call the pattern **EpicSpine** in conversation. Use `epic-spine` for files, labels, branches, and skill references when a machine-friendly name is needed.

