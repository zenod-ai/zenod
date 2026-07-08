# units/callisthenes/auth — per-tenant chat-auth (EPIC-2.4 C-2)

The console-less auth surface for Callisthenes. A tenant connects their X account
**entirely via chat** — no admin UI exists. Five MCP tools implement the pattern
from [EPIC-2.4-CALLISTHENES-MOVE-0.md](../../../docs/EPIC-2.4-CALLISTHENES-MOVE-0.md)
§"The chat-auth pattern".

## Shared contract (with C-1's wrapper)

```python
from auth import register as register_auth
register_auth(mcp)   # registers connect/complete_connect/connections/revoke/usage on `mcp`
```

`register(mcp)` supports a FastMCP-style `@mcp.tool(name=...)` decorator **and** an
`mcp.add_tool(fn, name=...)` API, chosen defensively at runtime. If `mcp` is
`None`/unknown, tools register into a plain in-process registry (returned at
`engine.registry`) so the package is drivable without a live server.

Each registered tool takes the caller's **MCP access token** as its first argument
(`mcp_token`). The wrapper is responsible for extracting the `Authorization: Bearer`
value from the request and passing it — that token **is** the tenant identity
(SEAM-SPEC §4). Keeping it explicit makes the package server-agnostic and testable.

## The five tools

| Tool | Kind | Result |
|---|---|---|
| `connect(service="x")` | mutating (starts flow) | canonical x.com authorize URL + 7-digit-PIN instructions |
| `complete_connect(pin, service="x")` | mutating | stores tenant's OAuth1 access token+secret; receipt = connected `@screen_name`/`user_id` |
| `connections()` | read | per-service status for this tenant (no secrets) |
| `revoke(service\|token)` | mutating | drops this tenant's tokens; loud `not_found` if nothing to revoke |
| `usage()` | read | calls · sends · cost for this tenant (see **OPEN SEAM**) |

## Flow: OAuth 1.0a PIN (`oauth_callback=oob`) — CD-3 DECIDED

X does **not** support device-code (RFC 8628); OAuth1.0a PIN is the only path that
delivers the literal "visit x.com, approve, paste the PIN" console-less story
(gating finding, epic APPEND ZONE 2026-07-08).

1. `connect()` → POST `oauth/request_token` (`oauth_callback=oob`) → returns the
   **canonical** `https://api.x.com/oauth/authorize?oauth_token=…` URL. The
   request-token secret is held process-local, keyed by `(tenant, service)`, for
   the handoff to step 2.
2. Tenant approves on x.com, copies the 7-digit PIN, calls `complete_connect(pin)`.
3. `complete_connect()` → POST `oauth/access_token` (`oauth_verifier=<PIN>`) →
   stores the tenant's long-lived access token+secret via `TokenStore`.

Signing is HMAC-SHA1 over the RFC 5849 base string (stdlib only — mirrors upstream
`xdevplatform/xmcp`'s OAuth1.0a client). HTTP is isolated behind
`oauth1_pin.HttpClient` so tests mock it — **no network, no real creds** in tests.

## Security invariants (BINDING)

- **Canonical x.com URLs only.** `_assert_canonical()` refuses to emit any URL whose
  host is not in `{api.x.com, x.com, api.twitter.com, twitter.com}` (anti-phishing).
- **Per-tenant isolation.** Tokens are keyed by `sha256(mcp_token)`; one tenant can
  never reach another's tokens. Proven in `test_token_store.py` +
  `test_chat_auth.py::test_two_tenants_get_isolated_token_sets`.
- **No secret ever leaves the box.** `StoredConnection.public()` and every tool
  result omit token material; the package contains **zero** log/print statements.
- **Loud errors.** Every failure is a structured `{code, message}` with SEAM-SPEC
  canonical codes (`unauthorized`, `not_found`, `invalid_input`, `unavailable`).

## Files

- `__init__.py` — `ChatAuth` engine + `register(mcp)` (the shared contract).
- `oauth1_pin.py` — OAuth1.0a oob request_token / authorize-URL / access_token, with
  an injectable `HttpClient` seam.
- `token_store.py` — per-tenant storage keyed by MCP token; `SqliteTokenStore`
  (default, under `CALLISTHENES_DATA_DIR`, default `/data`) + `InMemoryTokenStore`.
- `test_chat_auth.py`, `test_token_store.py` — pytest, X HTTP mocked. `python -m pytest`.

## OPEN SEAM

### Live per-tenant usage ledger (`usage()`)

`usage()` must return **calls · sends · cost** for the calling tenant. The live
ledger is `/data/usage.sqlite`, written by `packages/server/src/sessionLog.ts` and
surfaced via `read_llm_timeline` (epic APPEND ZONE §3, "Meter"). That ledger is
**not reachable from inside this unit** at build time, and its per-tenant keying
(gateway-key = source of truth, D-5) is owned by lane **C-4**.

**We do not fake numbers.** The interface is fixed and pluggable:

```python
ChatAuth(..., usage_reader=lambda mcp_token -> {"calls": int, "sends": int, "cost_usd": float})
```

- When a `usage_reader` is injected, `usage()` returns `{source: "ledger", usage: <reader output>}`.
- With no reader wired, `usage()` returns the explicit stub
  `{source: "unavailable", usage: {calls: null, sends: null, cost_usd: null}}` —
  `null` (not `0`) signals "not measured" vs "measured zero" (SEAM-SPEC §2:
  read tools return an explicit-empty marker, never fake data).

**Hand-back to C-4:** implement `usage_reader(mcp_token)` against
`/data/usage.sqlite` (filter by the tenant's gateway key), then pass it into
`ChatAuth(...)` at wrapper construction. No change to this package's surface is
required.
