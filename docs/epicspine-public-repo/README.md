# EpicSpine

EpicSpine is a document-centered operating system for AI-assisted software delivery.

The core idea is simple: every serious body of work gets a living epic document that preserves the intent, context, current state, acceptance target, issue ledger, decisions, and handoffs. GitHub issues remain the execution board, while the spine remains authoritative for intent and coordination.

This repository is the single development home for the skill. Any other copy of `skill/epic-spine/` is a snapshot; read [SYNC.md](SYNC.md) before editing one.

## Get Started

From this checkout's root, use Python 3.10+; no Python packages are required. Copy the **complete** skill into your user skills directory. This refuses an existing destination rather than overwriting it:

```sh
python3 - <<'PYTHON'
from pathlib import Path
import shutil

source = Path("skill/epic-spine")
destination = Path.home() / ".agents/skills/epic-spine"
try:
    shutil.copytree(source, destination)
except FileExistsError:
    raise SystemExit(f"Already exists; left unchanged: {destination}")
print(f"Installed: {destination}")
PYTHON
```

The user skills directory and explicit invocation follow [OpenAI's skill documentation](https://developers.openai.com/codex/skills/). If the skill does not appear, restart Codex. To try this checkout without installing, ask Codex to read `skill/epic-spine/SKILL.md` directly.

Open the [populated CLI example](examples/EPIC-0-CLI-EXAMPLE.md), then invoke the skill with this read-only orientation prompt in Codex:

```text
Use $epic-spine.
Identity: observer
Bound spine: examples/EPIC-0-CLI-EXAMPLE.md
Goal: explain the next action and acceptance journey. This is an illustrative example; do not dispatch or edit.
```

Validate the example and run the regression suite:

```sh
python3 skill/epic-spine/scripts/validate_spine.py --strict --graph examples/EPIC-0-CLI-EXAMPLE.md
python3 -B -m unittest discover -s tests -v
```

Expect `OK` for the example and a passing suite. The example is fully populated but its sample delivery remains unaccepted; validation proves document structure, not that a product shipped. For actual work in this repository, start at the [audit delivery spine](docs/EPIC-0-AUDIT-REMEDIATION.md).

Open the deck: [index.html](index.html)

When published with GitHub Pages, the deck lives at:

https://alfablok.github.io/epicspine-skill/

## Why This Exists

AI agents are powerful, but they lose the plot easily:

- chat history disappears or becomes too long to trust;
- GitHub issues are good for local tasks but weak at holding the whole story;
- new agents arrive cold and need to reconstruct intent from scattered comments, branches, PRs, and memory;
- workers can accidentally rewrite scope, mutate the wrong document, or bury important state in chat.

EpicSpine gives agents a stable operating surface.

The spine answers:

- Why does this epic exist?
- What outcome do we want?
- How do the pieces fit together?
- What is the current state?
- Which GitHub issues are active?
- What changed that future agents must know?
- What should the next agent do?

## The Epic 0 Idea

Each project can have an **Epic 0 spine**.

Epic 0 is the root concept and barebones operating context for the project. It holds the full thrust: why the project exists, what the system is trying to become, which child epics exist, how they depend on each other, what state they are in, and where human judgment is needed.

An **Epic 0 worker** is bound to that root spine. Their job is to read the child spines, keep the whole picture coherent, spin out new child EpicSpines, and bind other agents to those child spines.

```mermaid
flowchart LR
    subgraph Docs["EpicSpine documents<br/>durable project memory"]
        direction TB
        E0["Epic 0 spine<br/>root intent, thrust, project state"]
        E23["Child EpicSpine<br/>Epic 2.3"]
        E24["Child EpicSpine<br/>Epic 2.4"]
        E25["Child EpicSpine<br/>Epic 2.5"]

        E0 -->|defines child scope| E23
        E0 -->|defines child scope| E24
        E0 -->|defines child scope| E25
    end

    subgraph Workers["Workers<br/>temporary agents bound to documents"]
        direction TB
        EW0["Epic 0 worker<br/>keeps full picture"]
        W23["Epic worker<br/>delivers 2.3"]
        W24["Epic worker<br/>delivers 2.4"]
        W25["Epic worker<br/>delivers 2.5"]

        EW0 -->|binds worker| W23
        EW0 -->|binds worker| W24
        EW0 -->|binds worker| W25
    end

    EW0 -.->|stewards| E0
    W23 -.->|works from / updates| E23
    W24 -.->|works from / updates| E24
    W25 -.->|works from / updates| E25
```

## Spine Versus GitHub Issues

The spine is the clean thread of intent, desire, context, fit, and state.

GitHub issues are the deep working surface for specific steps.

Use the spine for:

- mission and desired outcome;
- current state and next action;
- child-spine map and dependencies;
- decisions and rationale;
- issue ledger and PR links;
- validation evidence and residual risk;
- clean handoffs.

Use GitHub issues for:

- code paths and implementation notes;
- blocker investigation;
- logs, screenshots, stack traces, and command output;
- ticket-level review discussion;
- detailed validation notes.

The compression rule: if a detail helps only the current ticket worker, keep it in the issue; if it changes how future agents understand the epic, summarize it in the spine.

## The Book Companion

Some projects also declare a **Book**: a durable, navigable HTML tree for the knowledge produced by the work.

- The spine owns development: objectives, state, backlog, decisions, gates, and acceptance.
- The Book owns understanding: insights, explanations, research, comparisons, conclusions, and—when useful—one canonical structured collection or shortlist.
- The Book root stays shallow, chapters index durable domains, and leaves carry the substantive argument or result.
- Every leaf links back to its chapter and root, and its chapter links down to it.

The Book is opt-in per repository. Once its local contract is active, binding an agent to an EpicSpine also binds it as a Book author. Material research or user-facing synthesis then lands in an existing or new leaf by default; the user does not have to ask for the artifact separately. Quick answers, ticket logs, and transient status remain in chat or issues.

The two systems run side by side:

```mermaid
flowchart LR
    O["Objective"] --> I["Issue"] --> C["Code / data"] --> V["Validation"] --> S["Spine state"]
    E["Evidence"] --> R["Registry delta<br/>when applicable"] --> L["Book leaf"] --> H["Chapter index"] --> B["Book root"]
    S -.->|produces user knowledge| L
    L -.->|reveals needed work| I
```

```mermaid
flowchart LR
    S["EpicSpine<br/>intent, context, state, decisions"]
    I["GitHub issue<br/>deep detail for one step"]
    P["Pull request<br/>implementation evidence"]
    T["Tests<br/>validation evidence"]

    S -->|"creates / tracks"| I
    I -->|"drives"| P
    P -->|"verified by"| T
    T -->|"durable result only"| S
    I -->|"scope or state changed"| S
```

## Authority By Artifact

EpicSpine does not call every surface a source of truth. Each artifact has a specific authority:

| Artifact | Authoritative for |
|---|---|
| EpicSpine | Intent, scope, epic acceptance, dependencies, decisions, rollup state |
| GitHub issue | Detailed execution state for one ticket |
| Branch, PR, and code | The implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Epic 0 spine | Project direction, child-spine relationships, cross-epic health |

One active **spine steward** reconciles these surfaces. The Epic 0 worker normally stewards the root spine; the epic worker normally stewards one child spine. Ticket workers and testers write structured handoffs to their issue unless a narrow spine section is explicitly delegated.

## Role Binding

Agents are bound to identities before they act:

- **Epic 0 worker** keeps the full project picture and spins out child spines.
- **Planner** shapes scope, backlog, acceptance, and dispatch.
- **Epic worker** is the delivery lead and active steward for one child spine, managing GitHub issues, subagents, and integration inside accepted scope.
- **Ticket worker** executes one assigned GitHub issue.
- **Tester** proves pass/fail and may run bounded fix loops.
- **Reviewer / observer** reads and reports unless promoted.

```mermaid
flowchart TD
    Prompt["Bootstrap prompt<br/>identity + bound spine + goal"]
    E0W["Epic 0 worker"]
    EW["Epic worker"]
    TW["Ticket worker"]
    TS["Tester"]
    Root["Root spine"]
    Child["Child spine"]
    Issue["Assigned GitHub issue"]
    Evidence["Validation evidence"]

    Prompt --> E0W
    Prompt --> EW
    Prompt --> TW
    Prompt --> TS
    E0W --> Root
    EW --> Child
    EW --> Issue
    TW --> Issue
    TS --> Evidence
    Evidence --> Child
```

Every binding names the role, bound spine, bound issue when applicable, active steward, stable assignment identity, authority, and expected handoff. This makes the work resumable when an agent stalls or is replaced.

Canonical prompt:

```text
Use $epic-spine.
Identity: Epic 0 worker
Bound spine: docs/EPIC-0-FOUNDATION-SPINE.md
Goal: keep the full project picture and state, create or update child EpicSpines, bind child workers, and loop until the project has clear next actions or needs human input.
```

## Goal-Seeking Discipline

EpicSpine agents work toward terminal states:

- an Epic 0 worker loops until the project state is coherent or human judgment is needed;
- an epic worker loops until the epic is ready for human test, tester handoff, or blocked by required input;
- a ticket worker loops until the issue is ready for testing or precisely blocked;
- a tester loops until acceptance passes, failure is evidenced, or a larger planner decision is required.

## Branch And Integration Discipline

Dispatched workers and testers need isolated execution and a fresh shared base.

- Every dispatched worker/tester uses a dedicated branch and worktree, for serial as well as parallel execution.
- Create the worktree from the pinned base before editing; never switch the shared checkout.
- Every dispatch records branch, base commit, integration target, owner, and latest verified time.
- Protected `main` is the default integration and deployment base unless the spine declares another branch.
- Merge small changes after review and required checks pass, and integrate frequently.
- If work cannot merge, the issue and spine show branch, PR, blocker, owner, latest commit, and next action.
- New agents bootstrap from the freshest validated integration base, not stale long-lived branches.

```mermaid
flowchart LR
    Main["main<br/>fresh integration base"]
    W1["worker branch + worktree<br/>issue 1"]
    W2["worker branch + worktree<br/>issue 2"]
    W3["worker branch + worktree<br/>issue 3"]
    Test["human/tester validates<br/>exact commit on named surface"]

    Main --> W1
    Main --> W2
    Main --> W3
    W1 -->|"review + checks pass"| Main
    W2 -->|"review + checks pass"| Main
    W3 -->|"review + checks pass"| Main
    Main --> Test
```

The integration gates are precise:

- `review`: implementation complete, PR open, required automated checks passing;
- `testing`: the exact commit is available in a named test surface and acceptance validation is in progress;
- `done`: acceptance passed, evidence linked, residual risk recorded, and the spine reconciled.

## Human Gates And Recovery

The spine names the actions that require human approval: product or acceptance changes, production deployment, destructive migrations, credentials, irreversible external actions, and any experiential acceptance automation cannot prove.

A blocker names the decision, human owner, evidence, exact input required, and what may continue independently. `Human required` is not a complete blocker.

Every assignment records a stable identity, issue, branch, base and latest commit, last verified time, blocker, and next action. If an agent disappears, the epic worker preserves the old history, marks the assignment superseded, records the takeover identity and starting commit, and dispatches from the freshest safe base.

## Milestone 0 And Current Package

Milestone 0 for this public repo is intentionally small:

- a README that lands the concept;
- one standalone HTML deck;
- enough vocabulary to explain Epic 0, child spines, role binding, GitHub issue discipline, and goal-seeking agents.

Milestone 0 is complete. The repository now also includes the installable skill, reusable spine and issue templates, the detailed operating model, and a local structural validator.

## Skill Layout

This repo includes the installable Codex skill under `skill/epic-spine/`:

```text
skill/
  epic-spine/
    SKILL.md
    agents/openai.yaml
    assets/
      book-companion-contract.md
      dispatch-prompt-preamble.md
      epic-spine-template.md
      github-issue-template.md
    references/
      book-companion.md
      operating-model.md
    scripts/
      validate_spine.py
```

To use it manually in an existing Codex session:

```text
Read skill/epic-spine/SKILL.md and apply its workflow.
Identity: Epic 0 worker
Bound spine: <path to root spine>
```

Validate a project spine after creating or materially restructuring it:

```sh
python3 skill/epic-spine/scripts/validate_spine.py --strict path/to/EPIC.md
```

The validator checks local document structure and recorded evidence. It does not verify remote GitHub state, execute acceptance steps, or prove that recorded evidence is true.

- `--dialect auto` (default) uses `Spine dialect: v1` or `v2`; an undeclared dialect defaults to v1.
- `--dialect v1` or `--dialect v2` overrides a supported declaration for that run without editing the document. An unsupported or empty declared dialect remains an error, even with an override.
- `--strict` makes unresolved fields and selected-dialect warnings fail validation. It does not upgrade v1 to v2. Without it, warnings are printed but only errors cause failure.
- `--graph` additionally checks local root/parent links, reciprocal registration, IDs, cycles and multiple-root rationale across the supplied files. Pass every local spine in the family; it does not fetch remote spines.

New sprint spines declare v2 and one acceptance surface: `browser`, `cli`, `library`, `infrastructure`, or `documentation`. Issues and dispatches inherit the bound spine's dialect and surface. Browser work retains a personally executed live-browser journey and per-step screenshots; other surfaces use appropriate observable commands or artifact checks. Discovery defaults to 15 minutes in the current and named relevant repositories/services, recording evidence and uncertainty.

See all options with:

```sh
python3 skill/epic-spine/scripts/validate_spine.py --help
```
