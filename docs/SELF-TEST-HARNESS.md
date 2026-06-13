# Zenod self-test chat harness

Codex and other agents can test Zenod without opening the web UI or WhatsApp by
sending a synthetic chat turn through the same `engine.chat` path used by user
surfaces. The harness records a durable SQLite audit row for each turn.

## HTTP

Call the authenticated endpoint with the existing API bearer token:

```sh
curl -sS "$ZENOD_URL/api/test/chat" \
  -H "Authorization: Bearer $ZENOD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "do you have a digest backlog tool?",
    "conversationKey": "codex-issue-37",
    "testRunId": "issue-37"
  }'
```

The response includes:

- `text`: Zenod's natural-language reply.
- `sources`: vault sources returned by the chat loop.
- `toolEvents`: tool start/end/error events observed during the turn.
- `correlationId`: log/audit id for the run.
- `conversationId`: the exact engine conversation id, such as
  `mcp:codex-issue-37`.
- `audit`: the persisted audit record.

Read recent or specific audit rows:

```sh
curl -sS "$ZENOD_URL/api/test/chat?limit=10" -H "Authorization: Bearer $ZENOD_API_TOKEN"
curl -sS "$ZENOD_URL/api/test/chat/$CORRELATION_ID" -H "Authorization: Bearer $ZENOD_API_TOKEN"
```

## MCP

Use the `chat_with_zenod` tool:

```json
{
  "message": "negative control: answer from memory only",
  "conversationKey": "codex-issue-37",
  "testRunId": "issue-37"
}
```

It returns the same structured fields as the HTTP endpoint. The default surface
for both harnesses is `mcp`; callers may pass `surface` when they intentionally
need to exercise another surface label.

## Conversation context

- Web chat uses `web:default` through `/api/chat`.
- The test harness uses `surface:conversationKey`, defaulting to an isolated
  generated key when neither `conversationKey` nor `testRunId` is provided.
- WhatsApp uses `whatsapp:<normalized sender>` so each sender has separate
  context.
- Normal MCP tools are stateless per request, but `chat_with_zenod` opts into
  chat context through `conversationKey`.

Use a stable `conversationKey` for multi-turn tests. Use a unique key per test
run when isolation matters.

## Suggested smoke prompts

- `do you have a digest backlog tool?`
- `create an issue for X` once the issue-creation tool exposure is available.
- `negative control: answer from memory only`
