# Callisthenes — the outbound-to-X unit

Callisthenes is the one unit that **sends** to X (Twitter). Your agents (Claude, Cursor,
scripts) draft anywhere; exactly one unit posts, and two guardrails ship **ON**:

- **Drafts never send (C-22):** a post/delete/media-upload call is **refused** unless it
  carries an explicit approval flag. A raw draft call never reaches X.
- **Throttle:** at most `CALLISTHENES_THROTTLE_PER_HOUR` approved sends per rolling hour
  (default **10**), enforced in the container.

It is [`xdevplatform/xmcp`](https://github.com/xdevplatform/xmcp) pinned by commit and
patched to run headless, wrapped by `callisthenes_server.py` which installs the two
guardrail middlewares before serving. One MCP server over Streamable HTTP at
`$MCP_HOST:$MCP_PORT/mcp`. Conformant to [`../../docs/SEAM-SPEC.md`](../../docs/SEAM-SPEC.md)
(see [`SEAM-SURFACE.md`](SEAM-SURFACE.md)).

---

## Stranger-grade: from zero to your first post

A person with only an X account and an MCP client (e.g. Claude) can go start → first post
using nothing but this section.

### 1 · Get X credentials (one time)

In the [X developer portal](https://developer.x.com), create/select an app with **Read and
Write** permissions. From **Keys and tokens**, collect:

| Portal field | Env var |
|---|---|
| API Key | `X_OAUTH_CONSUMER_KEY` |
| API Key Secret | `X_OAUTH_CONSUMER_SECRET` |
| Bearer Token | `X_BEARER_TOKEN` |
| Access Token (for your account) | `X_OAUTH_ACCESS_TOKEN` |
| Access Token Secret | `X_OAUTH_ACCESS_TOKEN_SECRET` |

> Hosted multi-tenant instances instead connect each account by chat — "visit x.com, enter
> this PIN" (OAuth 1.0a, provided by the C-2 auth package). The token table above is the
> single-owner / dogfood path.

### 2 · Bring the unit up

```sh
# from units/callisthenes/  (compose auto-loads .env for the X_* + CALLISTHENES_* values)
cp .env.example .env      # then fill in the five X_* values from step 1
docker compose -f docker-compose.callisthenes.yml up -d --build
```

Confirm it loaded the post tools:

```sh
docker logs callisthenes | sed -n '/Loaded .* tools/,/^$/p'
# expect createPosts, deletePosts, mediaUpload among the loaded tools, plus the
# "[callisthenes] installed middleware: draft-guard (C-22) + throttle" line.
```

### 3 · Point your MCP client at it

The endpoint is Streamable HTTP at `http://<host>:8000/mcp` (per-unit bearer auth once the
keyring/auth package is enabled). For Claude CLI:

```sh
claude mcp add --transport http callisthenes http://localhost:8000/mcp
claude mcp list   # callisthenes should list read + post tools
```

### 4 · Draft → approve → post

`createPosts` is the send. Because **drafts never send**, a plain call is refused:

```jsonc
// tools/call createPosts  { "text": "hello from Callisthenes" }
// -> ERROR  [draft_not_approved]
//    "callisthenes draft-guard: 'createPosts' is a send and was not approved.
//     Drafts never send: re-issue with 'callisthenes_approve' set to approve the send."
```

That refusal **is** the draft step: review the text, then approve by re-issuing with the
approval flag:

```jsonc
// tools/call createPosts
{ "text": "hello from Callisthenes", "callisthenes_approve": true }
// -> the post goes to X. The approval flag is stripped before the X request.
```

(If you set `CALLISTHENES_APPROVE_TOKEN`, the flag must EQUAL that token, not just be truthy —
a shared secret so only an approver who knows it can release a send.)

### 5 · The receipt (a permalink)

A successful `createPosts` returns the created post's **id** (and, from X, the data needed to
form its permalink `https://x.com/i/web/status/<id>`). That id/URL is your receipt — per
SEAM-SPEC every mutating tool returns a concrete handle, never a bare "ok". Open the permalink
to see your post live. Done: start → first post, from this README alone.

---

## Guardrails (what's enforced, and how to tune)

| Knob | Default | Effect |
|---|---|---|
| `CALLISTHENES_THROTTLE_PER_HOUR` | `10` | Max approved sends per rolling hour. `0` = block all sends. |
| `CALLISTHENES_APPROVE_ARG` | `callisthenes_approve` | The argument a send must carry to be approved. |
| `CALLISTHENES_APPROVE_TOKEN` | *(empty)* | If set, the approval arg must equal it exactly (shared-secret mode). |
| `CALLISTHENES_GUARDED_TOOLS` | `createPosts,deletePosts,mediaUpload` | Which tools require approval. |
| `CALLISTHENES_SEND_TOOLS` | `createPosts,deletePosts,mediaUpload` | Which tools count against the throttle. |

Both guardrails are enforced **in the unit** (`throttle.py`, `draft_guard.py`), not in a
prompt and not in the runner. Read tools (`searchPostsRecent`, `getUsersMe`, …) pass straight
through — no approval, no throttle.

## Test the guardrails (no network, no X creds)

```sh
cd units/callisthenes && python -m pytest -q
# proves: throttle blocks the (N+1)th send in a window; an unapproved send is blocked
# and an approved one is allowed (with the approval flag stripped).
```

## Upgrading the pin

Bump `XMCP_REF` in `Dockerfile` and `docker-compose.callisthenes.yml` to the new commit, then
re-validate the patches apply (`git apply --check headless-oauth1.patch relax-response-required.patch`)
against that commit. The wrapper only relies on upstream's `create_mcp()` factory; if upstream
renames it, update `callisthenes_server.py`.
