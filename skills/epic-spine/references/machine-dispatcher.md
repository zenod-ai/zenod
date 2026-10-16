# Machine Dispatcher

Env `EPICSPINE_DISPATCHER` is a command line (shlex-split). The manager runs it directly and reads its JSON; each call prints one object and exits 0. Adapters live outside the skill (`examples/dispatchers/`).

| Call | Output |
|---|---|
| `status` | `{"name": "seat pool", "capacity": 2, "available": 1}` |
| `pick [--task TEXT]` | `{"id": "seat1", "via": "t3_delegate_task", "providerInstanceId": "...", "model"?: "..."}` |
| `pick`, none free | `{"id": null, "reason": "..."}` |
| `done <id> [--fail] [--signal TEXT]` | `{"ok": true}` |

The only `via` is `t3_delegate_task`: call T3 MCP `delegate_task` with `target.providerInstanceId` (and `model`). Unknown `via`, missing field, non-zero exit, or non-JSON is a failure.

Flow: check the env and run `status` at thread start, every thread, greetings included (never assume unset or recall a value); name = `status.name` verbatim; per worker `pick`, dispatch (the worker still makes its own worktree), `done <id>` when finished, `done <id> --fail --signal "<error text>"` so the dispatcher can mark a limit. `id: null`: queue or wait, retry; never implement the work yourself.

Failure: say so in the reply and use a native subagent.

Precedence: per-task user instruction > repo `Dispatch profile: local-only` (machine dispatcher ignored) > machine dispatcher (where) > repo `Dispatch profile:` > `~/.agents/epicspine-profile.md` > lower-cost native subagent.

Bind suffix: `Delivery manager · EpicSpine · Learnings in force: <ids> · dispatch: <status.name> (<status.available>/<status.capacity> seats)`; on failure `· dispatch: unavailable → native subagent`.
