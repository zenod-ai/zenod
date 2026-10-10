# Sprint Dialect v2

Use v2 when authoring a sprint with the SHIP/HARDEN workflow; a small compact epic may choose v1 explicitly. Declare `Spine dialect: v2` and `Acceptance surface: browser|cli|library|infrastructure|documentation` (choose one value). Use the primary surface and explicitly list any additional surfaces required by acceptance. Existing v1 spines remain readable and executable. Undeclared spines default to v1; strict validation enforces the selected dialect, not an implicit upgrade. A v2 spine is a budget for one observable increment, not a wish list for a perfect end state.

### Journey-First SHIP And HARDEN

- Definition Of Done has exactly two tiers. **SHIP** is one numbered observable journey of 5–12 steps on the declared acceptance surface. **HARDEN** lists work deferred until the human approves SHIP.
- The epic worker personally executes SHIP: run the journey → first failure → dispatch a scoped fix → prepare the updated surface → restart from step 1. Continue to one uninterrupted clean pass. Deploy only when the surface requires it and authorization covers it.
- For `browser`, use a REAL browser on the LIVE deployment with one screenshot per step. For `cli`, record exact commands, inputs, exit codes and outputs. For `library`, execute a consumer example and relevant behavior checks. For `infrastructure`, record authorized health/state probes and results in the named environment. For `documentation`, follow the instructions and inspect rendered artifacts, links and examples as applicable. No browser deployment or screenshots are required solely for non-browser work.
- Hand off a truthful test package: personally verified steps, exact commit, environment, commands/results or artifact checks, and remaining limits. Browser handoffs include the live URL and per-step screenshots. The human can reproduce the same journey against the same build or artifact. Never claim a step was exercised without doing it.
- Run checks appropriate to the change; automated checks support observable acceptance. Repeat them when new changes, failures or unresolved concerns justify it. Documentation examples and validation instructions may need execution even when only documentation changed.

### Port-First Authoring

- Search the current repository and explicitly named relevant repositories/services, with a default 15-minute search budget. Record scope, queries/paths, findings, elapsed time, and inaccessible or unsearched areas. Expand only for a concrete dependency within authorized scope; record any revised budget. At expiry, choose a justified method with uncertainty recorded, or escalate if the missing evidence blocks safe progress. Never infer absence outside the searched scope.
- Mark every SHIP deliverable and ledger row PORT, DUPLICATE, or BUILD with the source or recorded search evidence. Unmarked v2 work is invalid.
- `PORT from <repo/path>` moves an existing implementation; `DUPLICATE from <working unit>` copies a proven unit; `BUILD (no suitable source found in recorded scope)` records a bounded search outcome. Inspect sources before authoring. Adapt beyond imports/config when requirements require it, recording why and validating the adapted behavior. If reuse is unsuitable, record the reason rather than forcing a transplant or silently rebuilding.

### Pre-Answered Decisions And Traps

- Decisions is a required, stable-ID table (`D1`…`Dn`) that pre-answers domains, sequencing, pricing, credentials, and likely manager choices. Credential rules name existing authorized locations to read; reuse accessible credentials within existing authority and record any required access gate.
- Pre-answer routine choices with safe defaults and journal the decision. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.
- Carry newly discovered bug classes into the next sprint's Decisions table as a known-trap rule. Parent spines may declare a CANONICAL artifact with an owner and change rule.

### Bounded Observable Autonomy

- Every ticket has a budget (90 minutes by default). At expiry, report state/blocker/options; the manager reassigns any ticket silent past budget.
- Heartbeat every 30 minutes with exactly `lap/state | blocker | ETA`. Two consecutive ETA slips stop the thread and surface options.
- The first ledger ticket delivers the earliest observable increment on the declared acceptance surface. Hardening runs behind the demo. The phrase `no human in the loop` is banned.
- Human Gates name owner, trigger, exact input, and what may continue. When blocked, report `BLOCKED ON <owner>: <exact required input>` with evidence and stop dependent work. Continue only independent authorized work; do not treat elapsed time as approval.

### Pins, Waves, And Ceremony

- Pin the base commit at dispatch in Current State: `pinned; no rebases until the journey passes`. Each integrated wave explicitly re-pins. Full gates run once per pinned base; after two rebase-and-reprove laps, escalate rather than starting a third. Providers quiesce overlapping merges during a consumer's pinned proof.
- Group tickets into disjoint waves by file surface. Record wave membership. The journey loop is last and belongs to the epic worker personally.
- Scale ceremony by risk: live customer data gets snapshot, checksum, and one restore drill per mechanism per epic; dead/test/reversible assets get snapshot-and-go; docs get none.

### Status, Gates, And Supersession

- A gated spine begins `Status: pending — DISPATCH ONLY AFTER <condition>` and repeats the dispatch condition, blocker, and pin-at-dispatch rule in Current State. Do not mint, dispatch, or execute tickets before the condition passes.
- When superseding a spine, rewrite the old document's Status line in place to `SUPERSEDED by <path> — do not execute from this document`; use equally explicit `CLOSED` or `ON HOLD` redirects.
- Store worker dispatch prompts in the spine appendix. Each prompt includes the mission and standard operational preamble, complete bindings and Human Gates, and ends `Go.`

