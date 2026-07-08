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

The tenant is derived from the **authenticated MCP request** (the
`Authorization: Bearer` header), NOT from a client argument — so the PUBLIC tool
schema does **not** contain `mcp_token` (#645, C-2R). `register()` wraps each tool
so its public signature drops the tenant parameter and injects the resolved bearer
from the request. Seam: the default resolver reads
`fastmcp.server.dependencies.get_http_headers(include={"authorization"})` (FastMCP
strips `authorization` by default, so it is opted back in). Self-host single-owner
falls back to `CALLISTHENES_OWNER_TENANT` / `MCP_BEARER_TOKEN`; if neither yields a
token the call fails loudly with `unauthorized` — never a silent default tenant.
The `ChatAuth` engine methods still take the resolved tenant as their first argument
so the package stays unit-testable (`tenant_resolver` is injectable).

## The five tools

| Tool | Kind | Result |
|---|---|---|
| `connect(service="x")` | mutating (starts flow) | canonical x.com **OAuth 2.0 PKCE** authorize URL + `state` |
| `complete_connect(code, state, service="x")` | mutating | exchanges the code, stores tenant's **refresh** + access token; receipt = granted `scope` |
| `connections()` | read | per-service status for this tenant (no secrets) |
| `revoke(service\|token)` | mutating | drops this tenant's tokens; loud `not_found` if nothing to revoke |
| `usage()` | read | calls · cost for this tenant from the live ledger (C-4a); `sends` null pending a send-ledger |

## Flow: OAuth 2.0 Authorization-Code + PKCE — C-2R DECIDED (2026-07-08, Jordi)

Supersedes the OAuth1-PIN oob flow (`oauth1_pin.py` remains only as a self-host
fallback). X does **not** support device-code (RFC 8628); Auth-Code + PKCE with a
pre-registered `redirect_uri` is the OAuth2 path X offers — "just click Authorize".

1. `connect()` → mints a PKCE `code_verifier`/`code_challenge` (S256) + `state`,
   returns the **canonical** `https://x.com/i/oauth2/authorize?...` URL. The
   `code_verifier` + `state` are held process-local, keyed by `(tenant, service)`.
2. Tenant clicks Authorize; X redirects to the registered callback with `code` +
   `state`; the tenant/callback calls `complete_connect(code, state)`.
3. `complete_connect()` → POST `https://api.x.com/2/oauth2/token`
   (`grant_type=authorization_code`, `code_verifier`) → stores the tenant's
   **refresh token** (durable) + short-lived (~2h) access token via `TokenStore`.
   `OAuth2PkceFlow.refresh()` renews the access token from the refresh token.

Scopes: `tweet.read tweet.write users.read offline.access` (`offline.access` is what
yields the refresh token). HTTP is isolated behind `oauth2_pkce.HttpClient` so tests
mock it — **no network, no real creds** in tests.

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

- `__init__.py` — `ChatAuth` engine + `register(mcp)` (the shared contract) + the
  request-bearer tenant resolver (#645).
- `oauth2_pkce.py` — OAuth 2.0 Auth-Code + PKCE (S256): authorize-URL builder,
  `/2/oauth2/token` code exchange + refresh, with an injectable `HttpClient` seam.
  **This is the default/hosted flow (C-2R).**
- `oauth1_pin.py` — legacy OAuth1.0a oob PIN flow, retained only as a **self-host
  fallback**; no longer the default surface.
- `token_store.py` — per-tenant storage keyed by MCP token; `SqliteTokenStore`
  (default, under `CALLISTHENES_DATA_DIR`, default `/data`) + `InMemoryTokenStore`.
- `test_chat_auth.py`, `test_token_store.py` — pytest, X HTTP mocked. `python -m pytest`.

## `usage()` ledger — WIRED (C-4a, 2026-07-08)

`usage()` returns **calls · sends · cost** for the calling tenant. It is now
wired to the live ledger `/data/usage.sqlite` (table `llm_usage`, written by
`packages/server/src/usageStore.ts`) via `usage_reader.py`:

```python
from usage_reader import sqlite_usage_reader
ChatAuth(..., usage_reader=sqlite_usage_reader())   # auto-wired by register() too
```

Honest mapping (**zero faked values**, SEAM-SPEC §2):
- `calls`    = `COUNT(*)`         → **real**
- `cost_usd` = `SUM(cost_usd)`    → **real**
- `sends`    = **`null`** → the `llm_usage` ledger *genuinely lacks* a send/post
  column; it logs LLM calls, not outbound X sends. `null` means "not measured",
  never "measured zero". A real send count needs a dedicated Callisthenes
  send-ledger (written by the draft-guard/throttle send path) — a **future lane**,
  not this table. See ↓ REMAINING SEAM.

Behaviour:
- Ledger present → `{source: "ledger", usage: {calls, sends: null, cost_usd}}`.
- `register()` auto-detects the ledger; if the DB file is absent
  `sqlite_usage_reader()` returns `None` and `usage()` stays in its explicit
  `{source: "unavailable", usage: {calls: null, sends: null, cost_usd: null}}`
  stub — `null` (not `0`) = "not measured".
- Empty-but-present ledger → `calls: 0, cost_usd: 0.0` (measured zero is real);
  table-missing DB → all-`null`.

Tenancy: `llm_usage` has no tenant column. Zenod topology is instance-per-user
(one container == one tenant), so the container-local ledger IS the tenant's;
the `tenant` arg is accepted but not used as a DB filter (documented in
`usage_reader.py`). If a multi-tenant-per-container topology ever lands, add a
tenant column upstream and filter here — the interface does not change.

Config knobs: `CALLISTHENES_USAGE_DB` (ledger path, default `/data/usage.sqlite`).

### REMAINING SEAM (honest)
`sends` stays `null` until a durable Callisthenes send-ledger exists. That is a
separate lane, not C-4a. C-3/C-5 remain blocked on `zenod-ai/cloud` access +
LIVE Stripe secrets (Jordi's grant).
