<!-- epicspine:begin repo-1 -->
## EpicSpine — always on, every task, every agent
Root spine: {root_spine}. Read {read} before acting.
Shared EpicSpine rules (bind, dispatch, integrate, links) come from the epic-spine skill's always-on block, injected each session; if it was not, read `assets/global-block.md` in the skill dir (usually `~/.agents/skills/epic-spine`).
Repo values (`Dispatch profile:`, `Integration policy:`, `Skill updates:`) in the root spine or AGENTS.md override skill defaults.
Precedence: user per-task instruction > repo values > skill block.
<!-- epicspine:end -->
