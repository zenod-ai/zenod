# Callisthenes — SEAM-SURFACE (the MCP tools + receipt shapes)

Callisthenes' public surface, conformant to [`../../docs/SEAM-SPEC.md`](../../docs/SEAM-SPEC.md).
One MCP server over Streamable HTTP at `https://<host>/mcp` (locally `http://localhost:8000/mcp`).
Callers reach X only through these tools; the send guardrails (throttle + drafts-never-send) are
enforced in-unit and cannot be bypassed by a caller. The tool set is upstream
[`xdevplatform/xmcp`](https://github.com/xdevplatform/xmcp), gated by `X_API_TOOL_ALLOWLIST`;
this unit adds the two send-guard middlewares and (via C-2's `auth/`) per-unit bearer auth.

**Auth (SEAM-SPEC §4):** per-unit bearer token in `Authorization: Bearer <token>`, validated by
the C-2 auth package (`units/callisthenes/auth/`). The unit holds no agent→agent world keys on its
own surface; the X OAuth1 world credentials are the single-owner dogfood exception (env), which the
per-tenant PIN chat-auth path supersedes for hosted. A disabled tenant's token is revoked and the
endpoint refuses calls loudly (`unauthorized`).

Tool names are the X OpenAPI **operationIds** (confirm against the "Loaded N tools" boot log).

---

## Read tools — FAST (read). No approval, no throttle.

Pass straight through the guardrail middleware.

| Tool | Input (X operationId) | Receipt |
|---|---|---|
| `searchPostsRecent` | `{ query, ... }` | data: matching posts, or an explicit empty result — never a bare "ok" (SEAM-SPEC item 5). |
| `getPostsById` / `getPostsByIds` | `{ id }` / `{ ids }` | post object(s); unknown id → loud error, not empty-success. |
| `getUsersMe` | `{}` | the authed user object. |
| `getUsersById` / `getUsersByUsername` / `getUsersPosts` / `getUsersMentions` | `{ id | username }` | user/post data or explicit empty. |

## Send tools — FAST (mutating). Draft-guard + throttle enforced.

Every send passes through, in order: **draft-guard** (must carry the approval arg) → **throttle**
(under the hourly cap). Only then does the call reach X.

### `createPosts` — mutating (the post)
- **Input:** `{ text: string, callisthenes_approve: <approval>, ... }`. `callisthenes_approve` must
  be truthy, or — if `CALLISTHENES_APPROVE_TOKEN` is set — equal that token. It is **stripped**
  before the X request (never leaks upstream).
- **Receipt (SEAM-SPEC items 3/4):** the created post's **id** (and the data to form its permalink
  `https://x.com/i/web/status/<id>`) — a concrete handle, never a bare ack.
- **Draft step:** a call WITHOUT valid approval returns a loud error (see below); nothing is sent.

### `deletePosts` — mutating (operator undo)
- **Input:** `{ id, callisthenes_approve: <approval> }`. Same approval requirement.
- **Receipt:** the deleted post id / `{ deleted: true }` handle from X.

### `mediaUpload` — mutating (attach media to a subsequent post)
- **Input:** media payload + `callisthenes_approve`. Same approval requirement.
- **Receipt:** the returned **media id** (attached to a post via `media.media_ids`).

## Errors (loud, structured — SEAM-SPEC §5)

Failures surface as MCP tool errors whose message begins with a **stable, machine-checkable code**
in brackets (FastMCP's `ToolError` carries a message; the bracket prefix is the `code`):

| code | when |
|---|---|
| `[draft_not_approved]` | a send tool was called without valid approval (drafts never send). |
| `[throttle_exceeded]` | an approved send would exceed `CALLISTHENES_THROTTLE_PER_HOUR`. |
| `unauthorized` | missing/invalid bearer token, or a revoked (disabled) tenant (from the auth package). |
| `not_found` | unknown post/user id on a read. |
| `invalid_input` / `unavailable` | malformed args / X API unreachable. |

No success-shaped failures: a blocked send returns an error, never a cheerful 200 (item 15).

## Conformance notes (per SEAM-SPEC checklist)

- **1–2 [transport]:** single MCP-over-Streamable-HTTP endpoint at `/mcp`; vanilla `tools/list` /
  `tools/call`, only `Authorization` beyond standard MCP.
- **3–5 [receipt]:** send tools return an id/URL/media-id handle; reads return data or explicit
  empty; failures are loud coded errors.
- **6–11 [ticket/dispatch]:** **N/A** — all tools here are FAST (single-call); Callisthenes emits
  no dispatch tickets (it is a leaf unit, dispatch depth 0).
- **12–14 [auth]:** per-unit bearer (C-2 auth package); revoked token refused loudly; no
  agent→agent world keys on the surface (X OAuth1 is the documented single-owner exception).
- **15 [error]:** structured coded errors as tabulated above.
- **16 [stranger]:** surface references zero suite-internal types; a plain MCP client drives it from
  `tools/list` alone (see README's start→first-post walkthrough).

## OPEN SEAM (auth)

Per-unit bearer validation (items 12–14) and per-tenant PIN chat-auth live in
`units/callisthenes/auth/` (owned by C-2), loaded at boot via the shared `auth.register(mcp)`
contract in `callisthenes_server.py`. Until that package lands, the unit boots **single-owner
headless** (env OAuth1 token) with the throttle + draft-guard active but no per-tenant bearer gate.
This is the intended C-1∥C-2 seam, not a defect.
