# Callisthenes workflow contract

This reference describes the public hosted Callisthenes MCP workflow. Always prefer the live `tools/list` JSON Schema for field details.

## Capability check

Required for guarded X publishing:

| Terminal tool name | Purpose | Mutation |
|---|---|---|
| `getUsersMe` | Resolve the connected X identity | No |
| `draft_post` | Create or reuse Callisthenes-owned held state without calling X | Safe tenant-local state only |
| `createPosts` | Present a proposed post to Callisthenes' draft guard | Yes, but intentionally refused without approval |
| `approve_send` | Commit the exact standing draft once and return a canonical receipt | Yes |
| `deletePosts` | Delete a named post after separate confirmation | Yes |

The host may namespace terminal names. Resolve `draft_post` on the attached peer when present, otherwise its `createPosts` compatibility path; do not search unrelated peers.

## Publish state machine

```text
proposed text
  -> draft_post({ text })
  -> [draft_not_approved] + opaque action_id
  -> show exact text + target
  -> explicit confirmation of that exact content
  -> approve_send({ channel: "x", action_id, text: exactText }) ONCE
  -> https://x.com/i/web/status/<id>
```

Prefer `draft_post` when the live catalog advertises it. Older Callisthenes deployments use `createPosts({ text })` without approval for the same held-state transition; clients must retain that fallback until the compatibility path is retired explicitly.

Only the final canonical permalink proves publication. An MCP HTTP success, a tool-start event, model narration, or an X post id embedded in an error is not sufficient.

For backward compatibility, a client may omit `action_id` only when exactly one unexpired pending action has the exact text. If the action is missing, expired, consumed, belongs to another tenant, or the text differs by even one character, nothing is sent.

If the text changes after confirmation, the confirmation is stale. Start again at the discovered draft step with the new exact text.

## Approval outcomes

`approve_send` may return:

- a canonical X permalink: verified success; relay it;
- `[publication_in_progress]`: another caller owns the same action's dispatch; do not retry or use another send tool;
- `[publication_unknown]`: the dispatch may have succeeded; do not retry. A specific candidate post may be checked with `reconcile_send`, which must prove the exact id, text, and action dispatch window through the provider read;
- an affordance asking for concrete text: nothing was sent; collect or recover the exact standing draft;
- `Nothing pending to approve.`: nothing was sent; create and show a draft first;
- a loud failure: nothing is proven; follow the failure rules in `SKILL.md`.

An identical confirmed text can resolve to a prior receipt because Callisthenes maintains a tenant-scoped exactly-once ledger. This is still a valid receipt. Do not use that property as permission to retry after uncertain outcomes.

## Deletion

Deletion does not share the publish confirmation. Obtain a new confirmation for a specific id or permalink. Invoke `deletePosts` once using its discovered schema and the host-provided approval path. A deleted id or `deleted: true` is the receipt.

## Throttle

The unit enforces a tenant-scoped rolling mutation limit. The default is conservative but deployment configuration is authoritative. A throttle rejection means the mutation did not run. Waiting is the safe response; using another peer or repeatedly calling the tool is not.
