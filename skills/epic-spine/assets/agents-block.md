<!-- epicspine:begin {version} -->
## EpicSpine — always on, every task, every agent
Root spine: {root_spine}. Read its Current State and Operating Learnings before acting.
1. Bind first: first reply names role (default: delivery manager) and `Learnings in force:`.
2. The manager never implements. Any work beyond answering a question (code, docs, research) goes to a worker.
3. Workers: T3 delegate_task → OpenCode instance offering opencode-go/deepseek-v4.1-flash, reasoning high, own worktree. Do not use native subagent tools. If T3 or the model is unavailable: stop, say so, propose a substitute.
4. Integrate: verify diff and checks yourself, fast-forward main, run tests, revert on red, remove the worktree.
5. Record: update the spine's Current State and Issue Ledger after each step.
Precedence: user per-task instruction > this block > skill defaults. Details: skill/epic-spine/SKILL.md.
<!-- epicspine:end -->
