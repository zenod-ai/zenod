# EPIC 0 · Foundation Spine — operating behavior and document-centered delivery

Status: active
Created: 2026-07-09
Updated: 2026-07-09
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-0-FOUNDATION-SPINE.md`
Integration branch: `main`
Active spine steward: Epic 0 Foundation planner (`Jordi + current bound Codex task`)
Steward since: 2026-07-09 19:55 CEST
Last reconciled commit: `8658d72` plus current Foundation working tree
Planner: Jordi + Codex
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Foundation/root scope | Steward this root spine, maintain project operating decisions, child-spine map, rollups, and public package state. | Root state reconciled, child work routed, next human decision explicit. |
| Planner | Epic 0 Foundation planner | Foundation rollout | Shape acceptance, backlog, authority rules, and initial dispatch; no implementation by default. | Executable ledger, decisions, and dispatch state. |
| Epic worker | unassigned | Future child-spine retrofit | Act as delivery lead inside accepted child scope and steward that child spine. | Child spine, issue board, integration state, and test handoff current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one dedicated issue branch and write a structured issue handoff. | PR, latest commit, evidence, blocker, and next action in the issue. |
| Tester | unassigned | Future cold-start validation issue | Validate exact commit and bootstrap behavior; write issue evidence. | Commit, environment, pass/fail, residual risk, and steward notification. |

## Write Scope

Bound spine: `docs/EPIC-0-FOUNDATION-SPINE.md`
Active steward: Epic 0 Foundation planner (`Jordi + current bound Codex task`)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detailed execution and validation state to their assigned GitHub issue, then notify the steward.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-0-STORY.md` — public story and launch materials.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — Zenod product execution.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — Callisthenes execution.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` — Ring / atomic units execution.
- `docs/EPIC-2.6-HERALD-MOVE-0.md` — Herald execution.
- `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — Epaminon executor-unit execution.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record the outgoing steward, incoming steward, absolute time, current commit, and next action before another agent begins writing this spine.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This Foundation spine | EpicSpine intent, operating decisions, rollout acceptance, and project-level state |
| GitHub issue | Detailed execution state for one rollout ticket |
| Branch / PR / code | The implementation and public skill package that actually exist |
| Validation evidence | What passed or failed for an exact version in a named environment |
| Child spine | Its own implementation state, ticket ledger, local decisions, and acceptance evidence |

## Mission

Set the foundational operating behavior for Zenod's AI-assisted development system: every major body of work has an EpicSpine; agents bootstrap from the document first; GitHub issues are the execution board; workers and testers write back narrowly; parent spines coordinate without mutating child spines by default.

## Definition Of Done

- [x] EpicSpine skill is installed, valid, and documented as the default operating pattern.
- [x] EpicSpine deck exists for onboarding humans and agents to the pattern.
- [x] Write-scope rules are captured: read broadly, write narrowly; cross-spine changes are proposed, not silently applied.
- [x] Planner backlog and parallel dispatch flow is captured in the skill.
- [x] Goal-seeking persistence is captured: workers continue until ready for testing or blocked; testers continue through bounded fix loops or escalate major decisions.
- [x] Public-repo Milestone 0 exists: README lands EpicSpine and a standalone HTML deck explains the root concept.
- [x] Branch/worktree integration discipline is captured: ticket workers isolate work, merge ready-for-test changes to the integration branch frequently, and keep new-agent bases fresh.
- [x] Authority, single-steward, protected integration gates, human gates, and recovery/takeover rules are encoded in the skill and reusable templates.
- [x] A deterministic local spine validator checks the required operating structure.
- [ ] At least one real epic uses the EpicSpine pattern with a bound spine, issue ledger, and handoff journal.
- [ ] GitHub issues exist for any remaining rollout work needed to make this behavior standard.

## Non-Goals

- Rewriting child epic docs directly from this spine.
- Owning public positioning copy; that remains `docs/EPIC-0-STORY.md`.
- Replacing GitHub issues; issues remain the execution board.
- Defining every future agent role in full detail.

## Current State

Phase: planning
Last verified: 2026-07-09 19:55 CEST
Integration target: `main`
Fresh base commit: `8658d72` for Zenod; `3ab84fa` for the merged public package
Next action: create GitHub issues for the remaining rollout tickets and link them into the Issue Ledger.
Blockers: GitHub issue URLs not yet created for this foundation track.

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `skills/epic-spine/SKILL.md` | Canonical agent instructions for EpicSpine behavior. | Always |
| 2 | `skills/epic-spine/references/operating-model.md` | Detailed write-scope, GitHub issue board, and dispatch model. | Planner |
| 3 | `skills/epic-spine/assets/epic-spine-template.md` | Template for new spine documents. | Planner |
| 4 | `skills/epic-spine/assets/github-issue-template.md` | Template for GitHub execution tickets. | Planner |
| 5 | `docs/epic-spine-deck.html` | Human onboarding deck for the pattern. | Always |
| 6 | `docs/EPIC-0-STORY.md` | Existing Epic 0 story spine; read-only from this track. | When routing story/launch consequences |

## Architecture And Context

EpicSpine is the document-centered operating model for the repo. It combines:

- A living epic document as the bootstrap artifact and durable memory.
- GitHub issues as bounded planner, worker, and tester tickets.
- A write-scope boundary so agents edit only the spine they are bound to.
- A backlog/dispatch loop so planners can create issues and launch parallel workers safely.
- Handoff and validation evidence so future agents can resume without relying on chat history.
- One active steward per spine so parallel agents cannot race on mission, acceptance, state, or the issue ledger.
- Dedicated ticket branches plus separate worktrees for concurrent filesystem isolation.
- Explicit review, testing, and done gates tied to exact commits and environments.
- Resumable assignments with stable identities, latest verified state, and takeover records.

Epic 0 Foundation is a meta-spine. It coordinates operating behavior across child epics, but it should not edit child epic implementation details unless explicitly delegated.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-09 | Name the pattern EpicSpine. | Short conversational name; machine skill remains `epic-spine`. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Install the skill from the repo copy via symlink. | Keeps the local install and source-controlled skill in sync. | `/Users/jordi/.codex/skills/epic-spine` |
| 2026-07-09 | Use read broadly, write narrowly as the default write-scope rule. | Prevents parent, sibling, or worker agents from racing on each other's spines. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Use GitHub issues as the execution board, not the source of truth. | Issues are good tickets; the spine carries the full epic memory and acceptance target. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Bind agents to goal-seeking role identities. | Workers should keep implementing until ready for testing or precisely blocked; testers should keep validating through bounded fix loops unless a larger planner decision is needed. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Split worker into epic worker and ticket worker. | An epic worker owns delivery through GitHub issue/subagent loops and writes clean state to the bound spine; ticket workers own assigned issues and write deep detail there. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Define Epic 0 worker as project/root spine owner. | Each project can have an Epic 0 spine that keeps the full picture, reads all child spines, spins out child EpicSpines, and binds child workers while preserving project thrust. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Public-repo Milestone 0 is README plus HTML deck. | Before packaging or registering the skill, EpicSpine needs a small public landing repo that explains why it exists, Epic 0, role binding, clean spines, GitHub issue discipline, and goal-seeking agents. | `docs/epicspine-public-repo/README.md` |
| 2026-07-09 | Use isolated worker branches/worktrees and frequent integration. | Parallel ticket workers need isolated execution, but `main` should stay the fresh ready-for-test base for deployment, human testing, and future agents. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Use artifact-specific authority and one active steward per spine. | The spine owns intent and coordination, issues own ticket detail, code owns implementation facts, and tests own proof; one steward reconciles them without concurrent document races. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Treat an epic worker as the delivery lead inside accepted scope. | The epic worker may create and dispatch tickets, reconcile integration, and steward the child spine without silently becoming the product planner. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Use dedicated branches, optional per-agent worktrees, protected integration gates, and recorded test commits. | Worktrees isolate files but do not replace branches; frequent integration must still require review/checks and reproducible validation. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Make assignments resumable and human gates precise. | A stalled agent can be replaced safely only when owner, commits, evidence, blocker, next action, and required human decision are explicit. | `skills/epic-spine/assets/epic-spine-template.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | Epic 0 Foundation planner | Create Foundation Epic GitHub issues | ready | - | - | `8658d72` | Issues exist for rollout work and link back to this spine. | This spine created 2026-07-09. | 2026-07-09 19:55 CEST | Create GitHub issues and update this row. |
| draft | Epic worker | unassigned | Apply EpicSpine to one real child epic | ready | Foundation issues created | - | `8658d72` | One child epic has explicit authority, stewardship, issue ledger, and handoff journal aligned to the skill. | Candidate child spines listed above. | 2026-07-09 19:55 CEST | Choose child epic and dispatch worker. |
| draft | Tester | unassigned | Validate bootstrap from a cold start | ready | Child epic applied | - | `8658d72` | Fresh agent can read the target spine and report authority, current state, active issues, blockers, and next action without chat history. | Skill validator passes. | 2026-07-09 19:55 CEST | Run cold-start test after child epic update. |
| draft | Planner | Epic 0 Foundation planner | Decide relationship between Foundation and Story Epic 0 | done | - | - | `8658d72` | `EPIC-0-STORY.md` remains story-owned, or is explicitly nested under this foundation spine. | 2026-07-09 decision: Foundation is the meta Epic 0; Story is a child/sibling story spine. | 2026-07-09 19:55 CEST | None. |
| `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Planner | Epic 0 Foundation planner | Spin out Epaminon executor-unit spine | draft | Foundation routing decision | - | `8658d72` | Non-ambiguous child spine exists and states current Epaminon facts, gaps, issue ledger, and next planner action. | Draft spine created 2026-07-09. | 2026-07-09 19:55 CEST | Review scope, then create GitHub issues if accepted. |
| [#1](https://github.com/AlfaBlok/epicspine-skill/issues/1) | Epic 0 worker | Epic 0 Foundation planner | Public EpicSpine authority and recovery protocol | done | - | [PR #2](https://github.com/AlfaBlok/epicspine-skill/pull/2) / `main` | `d72279f` | Public skill, templates, README, deck, and validator encode authority, stewardship, integration gates, human gates, and takeover behavior. | PR #2 merged as `3ab84fa`; issue #1 closed; Pages build completed; validation passed. | 2026-07-09 20:05 CEST | None. |

## Branch And Integration

- Default integration branch: protected `main`.
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees.
- Dispatch records include branch, base commit, integration target, owner, and latest verified time.
- `review` means implementation complete, PR open, and required automated checks passing.
- `testing` means the exact commit is available on a named test surface and acceptance validation is in progress.
- `done` means acceptance passed, evidence linked, residual risk recorded, and the spine reconciled.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Product intent or acceptance change | Jordi | Proposed behavior changes the EpicSpine contract or rollout acceptance | Approve the revised intent or criteria | Documentation and validation inside existing scope |
| Public release or registry submission | Jordi | Publishing beyond the existing AlfaBlok GitHub repository and Pages site | Approve target registry and release posture | Local package, README, deck, and repository updates |
| Destructive, privileged, or irreversible action | Jordi | Credentials, deletion, production mutation, or irreversible external action is required | Approve the exact action and target | Read-only investigation and reversible preparation |

## Recovery And Takeover

Stale assignment policy: no automatic timeout. Before takeover, verify the issue, branch, PR, latest commit, evidence, blocker, and next action; mark the previous assignment superseded and record the new starting commit.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-09 19:55 CEST |

## Planner Queue

- Create GitHub issues for the draft ledger rows.
- Treat `EPIC-0-FOUNDATION-SPINE.md` as the meta Epic 0 spine; `EPIC-0-STORY.md` is story-owned and read-only unless explicitly delegated.
- Identify the first child epic to retrofit with explicit Write Scope.
- Add a short reference from relevant handover docs to EpicSpine once the pattern is proven.
- Review the Epaminon 2.9 draft spine and decide whether to dispatch planner tickets.
- Review `docs/epicspine-public-repo/` as the seed for the future public EpicSpine repo.

## Worker Queue

- Add explicit Write Scope to the chosen child epic spine.
- Ensure its Issue Ledger links to GitHub issues or marks drafts clearly.
- Add Handoff Journal and Proposed Cross-Spine Updates sections if missing.

## Tester Queue

- Cold-start an agent with only the chosen spine and ask it to orient.
- Verify it does not edit read-only linked spines.
- Verify it proposes cross-spine changes in the bound spine instead.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-09 | EpicSpine skill validation | working tree from `8658d72` | local canonical skill | `/tmp/codex-epic-spine-validate/bin/python /Users/jordi/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/jordi/Documents/GitHub/zenod/skills/epic-spine` | pass | `Skill is valid!` |
| 2026-07-09 | EpicSpine deck compatibility check | working tree from `8658d72` | local file | HTML parser verified `docs/epic-spine-deck.html` title and redirect wrapper. | pass | `docs/epic-spine-deck.html` |
| 2026-07-09 | Public-repo deck structural check | `d72279f` | GitHub Pages | HTML parser verified `docs/epicspine-public-repo/index.html` title, twelve slides, progress, counter, and controls; compatibility redirect checked. | pass | `docs/epicspine-public-repo/index.html` |
| 2026-07-09 | Authority protocol skill validation | working tree from `8658d72` | canonical and public skill copies | Official `quick_validate.py` run against both packages. | pass | `Skill is valid!` for both copies. |
| 2026-07-09 | Foundation spine structural contract | working tree from `8658d72` | local Foundation spine | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-0-FOUNDATION-SPINE.md` | pass | `OK` |
| 2026-07-09 | EpicSpine validator executable | `3ab84fa` | public package | Python compilation and template validation; template emitted only expected unresolved-placeholder warnings. | pass | `skill/epic-spine/scripts/validate_spine.py` |
| 2026-07-09 | Updated public deck structure | `3ab84fa` | public package | HTML parser verified title, fourteen slides, progress, counter, and previous/next controls. | pass | `docs/epicspine-public-repo/index.html` |
| 2026-07-09 | Public integration | `3ab84fa` | GitHub `main` | Issue #1, dedicated branch, PR #2, mergeability check, and merge to `main`. | pass | https://github.com/AlfaBlok/epicspine-skill/pull/2 |
| 2026-07-09 | Public Pages deployment and visual QA | `3ab84fa` | GitHub Pages | Pages build returned `built`; live deck rendered 14 slides with working navigation, no console warnings/errors, no desktop overflow at 1280x720, and no horizontal mobile overflow at 390x844. | pass | https://alfablok.github.io/epicspine-skill/ |

## Handoff Journal

### 2026-07-09 - Planner - Foundation spine created

Context: This conversation produced the EpicSpine skill, local installation, onboarding deck, write-scope rule, and GitHub issue board / parallel dispatch flow.

Next: Create GitHub issues for the draft ledger and use this spine as the bound document for Foundation rollout.

Risks: Existing `docs/EPIC-0-STORY.md` already uses the Epic 0 number for public story work. Avoid silently merging scopes; record an explicit parent/child or sibling relationship.

Links:

- `skills/epic-spine/SKILL.md`
- `docs/epic-spine-deck.html`
- `docs/EPIC-0-STORY.md`

### 2026-07-09 - Planner - Goal-seeking posture added

Context: Jordi clarified that role-bound agents should work toward completion, not one-shot responses. Workers should keep pushing until their issue is ready for testing or blocked by a precise required input. Testers should continue until acceptance passes, an evidenced failure requires planner judgment, or a bounded fix loop succeeds.

Next: Future worker/tester dispatch prompts should include role, bound spine, bound issue, and terminal state.

Risks: Tester self-fix must stay bounded. Product, architecture, acceptance, cross-spine, or broad refactor changes still return to the planner.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Planner - Epic worker role clarified

Context: Jordi clarified that a worker bound to an epic can also be a manager of execution: own the delivery goal, create GitHub issues, dispatch subagents, and loop until the epic is ready for human testing or blocked.

Next: Use "epic worker" for this coordinator role and "ticket worker" for a subagent assigned to one GitHub issue.

Risks: Epic workers must not become planners by stealth. They may execute within existing scope, but product intent, acceptance changes, cross-spine authority, and major decisions still return to planner/user.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Planner - Epic 0 worker role added

Context: Jordi clarified that each project can have an Epic 0 spine that holds the whole context together. An Epic 0 worker reads all child spines, keeps the full picture and state, expands the project thrust into child EpicSpines, and binds other workers to those child spines.

Next: Treat `docs/EPIC-0-FOUNDATION-SPINE.md` as the root spine for this operating-system track unless Jordi chooses a different project root.

Risks: The Epic 0 worker should not mutate child implementation detail by default. It writes rollups, dependencies, child-spine map, decisions needed, and next actions into the root spine.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Epic 0 worker - Public-repo Milestone 0 seed created

Context: Jordi clarified that EpicSpine should become a public repo and eventually be registered/distributed. Milestone 0 is intentionally barebones: a README that lands the concept and an HTML page/deck inside the repo.

Next: Public repo is created. Next milestone is to package/register the skill and add examples.

Risks: Do not overpackage before the core language lands. The next milestone can add installable skill packaging, examples, and registry work.

Links:

- `docs/epicspine-public-repo/README.md`
- `docs/epicspine-public-repo/index.html`
- `docs/epic-spine-deck.html`
- https://github.com/AlfaBlok/epicspine-skill
- https://alfablok.github.io/epicspine-skill/

### 2026-07-09 - Epic 0 worker - Branch/worktree integration discipline added

Context: Jordi clarified that ticket workers should use separate branches or worktrees, while completed ready-for-test work should merge back to `main` frequently. This keeps deployment/testing and future agent bootstraps on the freshest integrated base.

Next: Child spines should declare their integration branch, and GitHub issue templates should name the branch/worktree and merge/PR status.

Risks: Long-lived unmerged branches become hidden project state. If work cannot merge, the issue and spine must state branch, PR, blocker, owner, and next action.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`
- https://github.com/AlfaBlok/epicspine-skill/commit/d72279f

### 2026-07-09 - Planner - Epic 0 meta binding clarified; Epaminon child spine spun out

Context: Jordi clarified that Epic 0, for EpicSpine purposes, is the meta epic that holds the
other epics together. The existing `EPIC-0-STORY.md` remains the public story/launch spine, but
Foundation is the coordinating spine agents should mean when they say "Epic 0 meta."

Next: Review the new Epaminon 2.9 spine, then create GitHub issue rows if its scope is accepted.

Risks: Avoid using 2.7 because existing docs use 2.7 for full Ring scope. Avoid 2.8 until its
meaning is deliberately assigned. Epaminon is therefore numbered 2.9 for now.

Links:

- `docs/EPIC-2.9-EPAMINON-MOVE-0.md`
- `docs/EPAMINON-ARCHUS-PROTOCOL.md`
- `docker-compose.epaminon.yml`

### 2026-07-09 - Epic 0 worker - Authority and recovery protocol published

Context: The skill now assigns authority by artifact, names one active steward per spine, treats the epic worker as the delivery lead inside accepted scope, requires one dedicated branch per ticket plus separate worktrees for concurrent agents, and defines review/testing/done gates tied to exact commits and environments. Human gates and assignment takeover are now explicit and a local validator checks the document contract.

Next: Use the revised template and validator when retrofitting the first real child epic, then create the remaining Foundation rollout issues.

Risks: The validator checks local Markdown structure and recorded evidence; it does not verify remote GitHub issue state. Mobile slides intentionally scroll vertically when their content exceeds the viewport.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/authority-contracts` merged through PR #2 as `3ab84fa`

Last verified: 2026-07-09 20:05 CEST

Links:

- https://github.com/AlfaBlok/epicspine-skill/issues/1
- https://github.com/AlfaBlok/epicspine-skill/pull/2
- `skills/epic-spine/scripts/validate_spine.py`

## Open Questions

- Should `docs/EPIC-2.9-EPAMINON-MOVE-0.md` remain 2.9 permanently, or be renumbered after the Ring numbering settles?
- Which child epic should be the first real retrofit target?
- Should future agents treat "epicspine Epic 0" as Foundation by default, Story by default, or require disambiguation? Current answer: Foundation by default for meta/coordination; Story only when explicitly about public positioning or launch copy.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-09 | `docs/EPIC-0-STORY.md` | Add a read-only link to Foundation if Jordi confirms Story is a child/sibling of Foundation. | This spine and existing story scope differ. | Epic 0 Story planner | proposed |
| 2026-07-09 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Review and accept/adjust the new Epaminon executor-unit spine; then mint GitHub execution issues. | Epaminon exists as a headless internal MCP/server but lacks unit product spine. | Epic 0 Foundation planner | proposed |

## Appendix

Related artifacts:

- `skills/epic-spine/`
- `docs/epic-spine-deck.html`
- `/Users/jordi/.codex/skills/epic-spine`
