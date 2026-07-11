---
name: callisthenes
description: Safely use a connected Callisthenes MCP peer to draft, explicitly confirm, publish, verify, and delete X posts. Use when a user asks to draft, post, tweet, publish, approve, send, or remove X content through Callisthenes, or asks about its connection, receipts, or throttle. Do not use for general conversation, memory, backlog work, or social-feed research that does not involve the attached Callisthenes peer.
license: MIT
compatibility: Requires an attached Callisthenes MCP peer whose tools have been discovered by the host. Tool names may be host-namespaced.
metadata:
  author: zenod-ai
  version: "1.0.0"
---

# Callisthenes

Callisthenes is the outbound custodian. It holds the connected account's X access, refuses unapproved sends, throttles mutations, and returns concrete receipts. Treat its tool results as authoritative; never narrate a success that the tool did not prove.

## Resolve the connected tools

Use only tools discovered from the peer to which this skill is attached. Hosts may namespace names, so match the terminal operation name and advertised schema rather than assuming an unqualified global name.

Before the first operation in a session:

1. Confirm discovery completed and the peer reports tools ready.
2. Confirm `createPosts` and `approve_send` are present for the safe publish workflow.
3. Use `getUsersMe` when the target X identity is unknown or material to the request.
4. If a required tool is absent, say which capability is unavailable. Do not substitute another peer or invent arguments.

Do not request, display, store, or infer MCP bearer tokens, X credentials, approval secrets, or tenant URLs. The host owns connection and authentication.

## Draft, confirm, publish

Follow this sequence exactly:

1. Prepare one final post for one X account. Preserve the user's voice; do not add hype, emojis, hashtags, links, or claims they did not request.
2. Call `createPosts` with the final `text` and **without** an approval argument. Callisthenes should refuse it with `[draft_not_approved]`; that refusal is the guarded draft step and must not be described as a failure to save the draft.
3. Show the user the exact final text and target account. Ask for explicit confirmation to publish that exact content.
4. If the user edits any character or changes the target, repeat the draft step and obtain confirmation again.
5. After confirmation, call `approve_send` **once** with `channel: "x"` and the byte-for-byte final `text` shown to the user. Do not call approved `createPosts` directly.
6. Relay the returned result faithfully. Success requires a canonical `https://x.com/i/web/status/<id>` permalink. The permalink is the receipt.

A bare “approve”, “yes”, “post now”, “send it”, or “go” is sufficient only when this conversation already contains one unambiguous standing draft with its exact text and target. Otherwise ask one short clarifying question.

## Exactly-once boundary

`approve_send` deduplicates an identical approved draft for a tenant, but the host must still issue one approval call only.

- Never retry automatically after a timeout, disconnect, malformed response, or unknown outcome.
- Never call a second send tool as a fallback.
- On an uncertain outcome, state that publication is unverified and ask the user whether to check X before any retry.
- Never claim “posted”, “sent”, or “live” without the canonical permalink returned by Callisthenes.

## Delete

Deletion is a separate mutation and needs separate, explicit confirmation naming the post or canonical permalink.

1. Extract or resolve the post id.
2. Show the exact post/permalink to be deleted and ask for confirmation.
3. Call the discovered `deletePosts` tool once, following its advertised schema and the host's protected approval mechanism.
4. Report success only when Callisthenes returns the deleted id or `{ "deleted": true }` evidence.

Never delete merely because a publish failed, a user disliked a draft, or a receipt is missing. Never guess an approval token or expose one in conversation.

## Failure handling

- `[draft_not_approved]`: expected during the draft step; show the draft and request confirmation.
- `[throttle_exceeded]`: nothing was sent. Report the limit and suggest waiting; do not loop, retry, or route around Callisthenes.
- `unauthorized`: connection or tenant access is invalid/revoked. Ask the user to repair the peer connection; do not request credentials in chat.
- `not_found`: the target does not exist or is inaccessible. Ask the user to verify the id/permalink.
- `invalid_input`: correct only from known schema and user-provided facts; do not guess missing content or targets.
- `unavailable`, timeout, or ambiguous transport failure: outcome is unverified. Do not retry a mutation automatically.
- Any success response without a canonical permalink for publish is unverified and must not be presented as posted.

Read [the workflow contract](references/WORKFLOW.md) when you need exact call/result shapes or edge-case guidance. Read [the examples](references/EXAMPLES.md) when composing a host interaction or testing this skill. These references contain no executable instructions or credentials.

