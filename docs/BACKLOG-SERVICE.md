# Backlog Service Contract

Zenod's backlog service is scoped and label-driven. It never means "run every open issue."

## Selection

The canonical selector is:

```ts
selectBacklog(repo: string): Promise<{ ready: BacklogItem[] }>

type BacklogItem = {
  number: number;
  title: string;
  labels: string[];
  url: string;
};
```

`ready` is the only set eligible to run now:

- included: open GitHub issues with both `owner:agent` and `status:queued`
- excluded: `archived`
- excluded: pull requests
- ordered: issue number ascending by default; callers can pass a priority ranker to `orderBacklogItems` when a priority-label policy is adopted

The selector is pure and read-only. It reads GitHub and returns the selected issues; it does not launch agents, mutate labels, or close issues.

## Lifecycle

Backlog service gateways must call `selectBacklog(repo)` immediately before launching work. Re-running after labels change therefore picks up the current ready set instead of stale or unflagged backlog items.

The lifecycle vocabulary is:

- `owner:agent` + `status:queued`: ready for an agent; the only issues service touches
- `status:running`: work has started
- `status:blocked`: an agent found a blocker that needs a human/product decision
- `status:needs-review`: implementation is done and awaits testing or human sign-off
- `status:complete`: verified complete
- `owner:human`: not agent-runnable until a human changes ownership
- `archived`: excluded from service even if other labels are present

## Queueing and Testing Gate

Issues become queued only through an explicit readiness signal: a human applies `owner:agent` + `status:queued`, or a digester proposes the labels and a human or trusted promotion policy applies them. Mining backlog records alone does not make work runnable.

Use `status:needs-review` as the testing and verification gate. Do not add `status:needs-testing` unless review and test sign-off become separate workflow states. Agents may move from `running` to `needs-review` after local tests pass and a draft-ready branch exists; `complete` is reserved for human or controller verification.
