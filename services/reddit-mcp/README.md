# Reddit MCP service

Vendored [`jordanburke/reddit-mcp-server`](https://github.com/jordanburke/reddit-mcp-server) —
a FastMCP server exposing the Reddit API as MCP tools — pinned by commit and run in HTTP
mode so Callistheness (the outbound agent) can submit posts on your behalf.

- **Transport:** FastMCP `httpStream` = Streamable HTTP at `$HOST:$PORT/mcp`. Callistheness
  connects directly; no SSE bridge needed.
- **Pin:** `REDDIT_MCP_REF` in `Dockerfile` / `docker-compose.reddit-mcp.yml` (a commit SHA,
  currently `v1.5.1` = `53cca07…`, never a branch).
- **Auth:** non-interactive from env. `REDDIT_CLIENT_ID/SECRET` authenticate the app;
  `REDDIT_USERNAME/PASSWORD` are **required** for the write tools (`create_post`, …).

## Why one instance (no read/write split)

`services/x-mcp` runs two instances because autonomous Codex fan-out workers reach x-mcp and
must be denied write tools by **topology** (they run with approvals bypassed). Nothing
autonomous reaches reddit-mcp — only the attended, confirm-first Callistheness brain does — so
a single write-capable instance on a private network is the whole surface. The `/mcp` endpoint
is additionally gated by a bearer token (`OAUTH_ENABLED` + `OAUTH_TOKEN`).

## The tool contract Callistheness uses

`post_reddit` (in `packages/server/src/outboundTools.ts`) calls this server's **`create_post`**
tool. Unlike X's single-`text` post, `create_post` takes structured fields, so the outbound
connector advertises a structured input schema and forwards these keys:

| arg | required | meaning |
|---|---|---|
| `subreddit` | yes | target subreddit, **without** the `r/` prefix |
| `title` | yes | the post title |
| `content` | yes | self-post body text, or the URL for a link post |
| `is_self` | no (default `true`) | `true` = text/self post, `false` = link post |

If you bump the pin and upstream renames the tool or its args, update the defaults (or set the
`OUTBOUND_REDDIT_MCP_TOOL` override) in `outboundTools.ts` to match. Confirm the exact names
against a `tools/list` call (see Verify).

## One-time setup

1. **Reddit app.** At <https://www.reddit.com/prefs/apps> create an app of type **script**.
   The client id is shown under the app name; the secret is the "secret" field. Add the posting
   account as a developer of the app.
2. **Secrets.** Copy `.env.example` → `.env` and fill it in (local), or set the same keys as
   Dokploy app secrets (production). Never commit a filled-in `.env`. Set `REDDIT_MCP_OAUTH_TOKEN`
   to a long random string and mirror it into `OUTBOUND_REDDIT_MCP_TOKEN` on the outbound service.
3. **Network.** The compose creates the `zenod-reddit-net` network itself (exact name, no project
   prefix). The outbound container joins it afterwards — see `docker-compose.outbound.yml`.

## Run

```sh
# from services/reddit-mcp/ (compose auto-loads .env for the REDDIT_* values)
docker compose -f docker-compose.reddit-mcp.yml up -d --build
```

In Dokploy this is a single **Compose** service (project `zenod`) built from
`docker-compose.reddit-mcp.yml`: the `REDDIT_*` secrets go in the compose's Environment and
`autoDeploy` rebuilds on push like the rest of the stack.

## Verify

```sh
# Streamable-HTTP tools/list from a container on the network (bearer required):
docker run --rm --network zenod-reddit-net curlimages/curl -s -X POST \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $REDDIT_MCP_OAUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://reddit-mcp:3000/mcp
```

`create_post` should appear in the tool list. Then drive it end-to-end from the Callistheness
chat: ask it to post to a test subreddit, confirm the draft, and check it returns the post URL.

## Upgrading the pin

Bump `REDDIT_MCP_REF` in both `Dockerfile` and `docker-compose.reddit-mcp.yml` to the new
commit, rebuild, and re-run the `tools/list` verify to confirm `create_post`'s name and args
are unchanged (update `outboundTools.ts` defaults/overrides if upstream renamed them).
