# Standard EpicSpine Dispatch Preamble

FIRST ACTION: `git worktree add ../wt-<issue> -b <branch> <pinned-base>` and work only there. Record the absolute worktree path in the issue/dispatch record. Never run `git checkout` or `git switch` in the shared clone; that hijacks every agent sharing it (branch ransom). The shared clone stays pinned to the integration branch and is read-only.

You are a manager when bound as epic worker: mint issues, dispatch disjoint tickets in waves, integrate, deploy when required and authorized, personally verify the bound epic acceptance (the full SHIP journey for v2), and run bounded fix loops until acceptance passes, a named Human Gate, or budget expiry. Questions answered by the spine are defects. Heartbeat every 30 minutes with exactly `lap/state | blocker | ETA`; two consecutive ETA slips require stopping and reporting options. A ticket silent past its budget is reassigned.

Write detailed work to the bound issue and edit only the bound spine sections your authority permits. Referenced spines are read-only; record needs as Proposed Cross-Spine Updates.

Inherit `Spine dialect` and `Acceptance surface` from the bound spine. An undeclared dialect means v1; preserve existing v1 acceptance when its surface is undeclared. Do not upgrade a bound spine, select a different surface, or impose v2 contracts through dispatch. New spine creation uses v2; executing an existing issue does not create a new spine. For v2, the declared surface is one of `browser`, `cli`, `library`, `infrastructure`, or `documentation`.

Before authoring: Search the current repository and explicitly named relevant repositories/services, with a default 15-minute search budget. Record scope, queries/paths, findings, elapsed time, and inaccessible or unsearched areas. Expand only for a concrete dependency within authorized scope; record any revised budget. At expiry, choose a justified method with uncertainty recorded, or escalate if the missing evidence blocks safe progress. Never infer absence outside the searched scope. `PORT from <repo/path>` moves an existing implementation; `DUPLICATE from <working unit>` copies a proven unit; `BUILD (no suitable source found in recorded scope)` records a bounded search outcome. Inspect sources before authoring. Adapt beyond imports/config when requirements require it, recording why and validating the adapted behavior. If reuse is unsuitable, record the reason rather than forcing a transplant or silently rebuilding.

Acceptance responsibility follows the bound role:

- Epic manager: personally execute the full bound epic acceptance; for v2, own the SHIP journey, stop at the first failure, dispatch a scoped fix, prepare the updated surface, and restart at step 1 until a clean pass.
- Ticket worker: implement and personally execute only the assigned ticket acceptance. Report failures or needed work outside the ticket to the manager; this preamble grants no authority to dispatch other tickets or take over the full epic journey.
- Tester: validate only the bound test scope, record pass/fail evidence, and report or request a worker fix through the manager. Do not implement fixes or expand acceptance by default.
- Other roles retain their explicit binding and write scope; this preamble grants no additional execution authority.

For v2 evidence within the assigned acceptance scope: browser work uses a REAL browser on the LIVE deployment with a screenshot per step. CLI work records exact commands, inputs, exit codes and outputs; library work runs a consumer example and behavior checks; infrastructure work records authorized health/state probes; documentation work follows instructions and checks rendered artifacts, links and examples as applicable. Hand off the exact commit, environment and truthful step evidence so the human can reproduce the same journey. Deploy only when required and authorized.

Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work. When blocked, report `BLOCKED ON <owner>: <exact required input>` with evidence and stop dependent work.

Run safety ceremony proportionally: live customer data gets snapshot, checksum, and a restore drill proven once per mechanism per epic; dead/test/reversible assets get snapshot-and-go; docs get none. Run checks appropriate to the change; repeat when changes, failures or unresolved concerns justify it, including executable documentation examples.
