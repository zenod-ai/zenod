# Callisthenes interaction examples

Tool names below are illustrative terminal names. A host may namespace them.

## Draft then publish

User: `Post that Ring is live.`

Agent prepares a restrained draft, then calls:

```json
{ "tool": "createPosts", "arguments": { "text": "Ring is live." } }
```

Expected guarded result begins with `[draft_not_approved]`. The agent then says:

> Draft for @account: “Ring is live.” Publish this exact text?

User: `Yes.`

Agent calls exactly once:

```json
{
  "tool": "approve_send",
  "arguments": { "channel": "x", "text": "Ring is live." }
}
```

If Callisthenes returns `https://x.com/i/web/status/123456789`, relay that permalink as the receipt. Do not add an unsupported success claim.

## Changed text requires new confirmation

User approves `Ring is live.` and then says `Add “for everyone”.`

Do not send. Draft `Ring is live for everyone.`, call `createPosts` without approval, show the new exact text, and ask again.

## Ambiguous approval

User: `Send it.`

If two drafts are visible or the target is unclear, ask which exact draft and account. Do not select one by recency.

## Timeout

`approve_send` times out after dispatch.

Say publication is unverified. Do not retry. Offer to check the target account first.

## Delete

User: `Delete https://x.com/i/web/status/123456789.`

Confirm deletion of that exact permalink. Only after confirmation invoke `deletePosts` once through the host's protected approval path. Report only the concrete deletion receipt.

