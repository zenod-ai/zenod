"""units/callisthenes/auth — per-tenant chat-auth for Callisthenes (EPIC-2.4 C-2R).

The console-less auth surface. A tenant connects their X account entirely via chat,
now via **OAuth 2.0 Authorization-Code + PKCE** ("just click Authorize"):

    connect(service="x")            -> canonical x.com authorize URL + state (PKCE)
    complete_connect(code, state)   -> exchanges the code, stores the tenant's
                                       REFRESH token keyed by the request bearer
    connections()                   -> per-service status for THIS tenant (no secrets)
    revoke(service|token)           -> drops this tenant's tokens (next send fails loudly)
    usage()                         -> calls / sends / cost for this tenant (ledger)

SHARED CONTRACT with C-1's wrapper:

    from auth import register as register_auth
    register_auth(mcp)

`register(mcp)` registers the five tools on `mcp`, supporting both a FastMCP-style
`@mcp.tool()` decorator and an `mcp.add_tool(fn, name=...)` API. If `mcp` is None or
neither API is present, tools register into a plain in-process registry (exposed as
the returned engine's `.registry`) so tests can still drive them.

Per-tenant identity (#645, CLOSED here): the tenant is derived from the AUTHENTICATED
MCP request on the server (the `Authorization: Bearer` header), NOT from a
client-supplied argument. The PUBLIC tool schema therefore does NOT contain
`mcp_token` — a client cannot assert someone else's identity. The `ChatAuth` engine
methods still take the resolved tenant as their first argument so the package stays
unit-testable without a live server; `register()` wraps each tool so its PUBLIC
signature drops that first parameter and the tenant is injected from the request.

Seam (documented, exact): the default resolver reads the request via FastMCP's
`fastmcp.server.dependencies.get_http_headers()`. If that API is unavailable it
falls back to a self-host single-owner env token (CALLISTHENES_OWNER_TENANT /
MCP_BEARER_TOKEN); if neither yields a token the call fails loudly with
`unauthorized`. A custom `tenant_resolver` may be injected (tests do this).

Security (BINDING): tool results return CANONICAL x.com URLs ONLY. Secrets never
appear in any result and are never logged.
"""

from __future__ import annotations

import functools
import inspect
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from .oauth2_pkce import (
    CANONICAL_AUTHORIZE_HOSTS,
    DEFAULT_SCOPES,
    OAuth2Error,
    OAuth2PkceFlow,
    TokenSet,
)
from .token_store import (
    StoredConnection,
    TokenStore,
    default_store,
)

SUPPORTED_SERVICES = ("x",)


class AuthError(Exception):
    """Loud, structured chat-auth error (SEAM-SPEC §5: {code, message})."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_result(self) -> Dict[str, Any]:
        return {"ok": False, "error": {"code": self.code, "message": self.message}}


@dataclass
class _PendingAuth:
    """A PKCE flow in flight, held between connect() and complete_connect(), keyed
    by (tenant, service). `state` guards against CSRF; `code_verifier` completes PKCE."""

    state: str
    code_verifier: str
    service: str
    created_at: float


class ChatAuth:
    """The chat-auth engine. Holds the token store + pending PKCE flows and builds
    the OAuth2 flow from client creds. One instance per unit process."""

    def __init__(
        self,
        store: Optional[TokenStore] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        redirect_uri: Optional[str] = None,
        scopes: Optional[str] = None,
        flow_factory: Optional[Callable[[], OAuth2PkceFlow]] = None,
        usage_reader: Optional[Callable[[str], Dict[str, Any]]] = None,
    ):
        self.store = store or default_store()
        self._client_id = client_id or os.getenv("X_OAUTH2_CLIENT_ID", "")
        self._client_secret = client_secret or os.getenv("X_OAUTH2_CLIENT_SECRET", "")
        self._redirect_uri = redirect_uri or os.getenv("X_OAUTH2_REDIRECT_URI", "")
        self._scopes = scopes or os.getenv("X_OAUTH2_SCOPES", DEFAULT_SCOPES)
        # flow_factory lets tests inject a mocked-HTTP OAuth2PkceFlow.
        self._flow_factory = flow_factory
        self._usage_reader = usage_reader
        # { (tenant, service): _PendingAuth } — state + code_verifier handoff.
        self._pending: Dict[str, _PendingAuth] = {}

    # -- helpers ----------------------------------------------------------------
    def _flow(self) -> OAuth2PkceFlow:
        if self._flow_factory:
            return self._flow_factory()
        return OAuth2PkceFlow(
            client_id=self._client_id,
            client_secret=self._client_secret,
            redirect_uri=self._redirect_uri,
            scopes=self._scopes,
        )

    @staticmethod
    def _check_service(service: str) -> str:
        service = (service or "x").strip().lower()
        if service not in SUPPORTED_SERVICES:
            raise AuthError(
                "invalid_input",
                f"Unsupported service '{service}'. Supported: {', '.join(SUPPORTED_SERVICES)}.",
            )
        return service

    @staticmethod
    def _require_tenant(tenant: Optional[str]) -> str:
        if not tenant:
            raise AuthError(
                "unauthorized",
                "No authenticated MCP bearer on the request; cannot identify the tenant.",
            )
        return tenant

    def _pending_key(self, tenant: str, service: str) -> str:
        # tenant is the raw MCP bearer; never logged. Key is process-local only.
        return f"{tenant}\x00{service}"

    # -- tool 1: connect --------------------------------------------------------
    def connect(self, tenant: str, service: str = "x") -> Dict[str, Any]:
        tenant = self._require_tenant(tenant)
        service = self._check_service(service)
        flow = self._flow()
        challenge = flow.authorize()
        _assert_canonical(challenge.authorize_url)
        self._pending[self._pending_key(tenant, service)] = _PendingAuth(
            state=challenge.state,
            code_verifier=challenge.code_verifier,
            service=service,
            created_at=time.time(),
        )
        return {
            "ok": True,
            "service": service,
            "authorize_url": challenge.authorize_url,
            "state": challenge.state,
            "instructions": (
                f"Open {challenge.authorize_url} , click Authorize to grant this app "
                f"access to your X account. You'll be redirected to the registered "
                f"callback with a `code` and `state`; complete the connection with "
                f"complete_connect(code=\"<code>\", state=\"{challenge.state}\", "
                f"service=\"{service}\")."
            ),
            "flow": "oauth2_pkce",
        }

    # -- tool 2: complete_connect ----------------------------------------------
    def complete_connect(
        self, tenant: str, code: str, state: str = "", service: str = "x"
    ) -> Dict[str, Any]:
        tenant = self._require_tenant(tenant)
        service = self._check_service(service)
        pending = self._pending.get(self._pending_key(tenant, service))
        if not pending:
            raise AuthError(
                "not_found",
                f"No pending {service} connection for this tenant. Call connect() first.",
            )
        if not (code or "").strip():
            raise AuthError("invalid_input", "An authorization code is required.")
        # CSRF: the state echoed back by X must match the one we minted.
        if state and state != pending.state:
            raise AuthError(
                "invalid_input",
                "State mismatch — the callback state does not match the pending flow.",
            )
        flow = self._flow()
        tokens: TokenSet = flow.exchange_code(code, pending.code_verifier)
        if not tokens.refresh_token:
            # offline.access should always yield a refresh token; its absence means
            # agents could not post past the ~2h access-token lifetime. Fail loud.
            raise AuthError(
                "unavailable",
                "X returned no refresh_token (offline.access scope missing?); "
                "the connection would expire in ~2h and cannot be stored durably.",
            )
        conn = StoredConnection(
            service=service,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=tokens.expires_at,
            token_type=tokens.token_type,
            connected_at=time.time(),
            scope=tokens.scope or self._scopes,
            auth_flow="oauth2_pkce",
        )
        self.store.put(tenant, conn)
        self._pending.pop(self._pending_key(tenant, service), None)
        # Receipt (SEAM-SPEC §2): a mutating tool returns a concrete handle. The
        # handle here is the connected service + granted scope — never a secret.
        return {
            "ok": True,
            "service": service,
            "connected": True,
            "scope": conn.scope,
            "message": (
                f"Connected your X account for this tenant via OAuth 2.0. "
                f"Agents can now post through the always-on unit."
            ),
        }

    # -- tool 3: connections ----------------------------------------------------
    def connections(self, tenant: str) -> Dict[str, Any]:
        tenant = self._require_tenant(tenant)
        connected = {c.service: c for c in self.store.list_services(tenant)}
        services: List[Dict[str, Any]] = []
        for svc in SUPPORTED_SERVICES:
            c = connected.get(svc)
            if c:
                services.append(c.public())
            else:
                services.append({"service": svc, "connected": False})
        return {"ok": True, "connections": services}

    # -- tool 4: revoke ---------------------------------------------------------
    def revoke(
        self,
        tenant: str,
        service: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Dict[str, Any]:
        tenant = self._require_tenant(tenant)
        # `token` param (SEAM allows revoke(service|token)): if a service string was
        # passed positionally as `token`, treat it as the service selector.
        if service is None and token is not None:
            service = token
        if service is not None:
            service = self._check_service(service)
        removed = self.store.revoke(tenant, service)
        # Also clear any half-finished pending flow for this tenant.
        for key in list(self._pending):
            if key.startswith(tenant + "\x00") and (
                service is None or key.endswith("\x00" + service)
            ):
                self._pending.pop(key, None)
        if removed == 0:
            raise AuthError(
                "not_found",
                f"No {service or 'stored'} connection to revoke for this tenant.",
            )
        return {
            "ok": True,
            "revoked": removed,
            "service": service or "all",
            "message": f"Revoked {removed} connection(s). Subsequent sends will fail until you reconnect.",
        }

    # -- tool 5: usage ----------------------------------------------------------
    def usage(self, tenant: str) -> Dict[str, Any]:
        tenant = self._require_tenant(tenant)
        if self._usage_reader is not None:
            data = self._usage_reader(tenant)
            return {"ok": True, "usage": data, "source": "ledger"}
        # OPEN SEAM: the live per-tenant ledger (/data/usage.sqlite via
        # packages/server/src/sessionLog.ts) is not reachable from inside this
        # unit at build time. We return an explicit, clearly-marked stub shape
        # (SEAM-SPEC §2: read tools return explicit-empty, never fake data) and
        # document the interface in README.md ## OPEN SEAM. We do NOT invent numbers.
        return {
            "ok": True,
            "usage": {"calls": None, "sends": None, "cost_usd": None},
            "source": "unavailable",
            "note": (
                "Live per-tenant ledger not wired in-unit (C-4 seam). "
                "Shape is fixed: {calls, sends, cost_usd}. Values are null, not zero, "
                "to signal 'not measured' rather than 'measured zero'."
            ),
        }


# --- Tenant resolution from the authenticated request --------------------------
def _default_tenant_resolver() -> str:
    """Derive the tenant from the AUTHENTICATED MCP request (#645).

    Seam (exact): FastMCP exposes the live HTTP headers of the in-flight request
    via `fastmcp.server.dependencies.get_http_headers()`. We read the
    `Authorization: Bearer <token>` value — that bearer IS the tenant identity
    (SEAM-SPEC §4). It is NEVER accepted as a tool argument, so a client cannot
    assert another tenant's identity.

    Fallbacks, in order:
      1. `Authorization: Bearer` on the request (hosted, multi-tenant).
      2. `CALLISTHENES_OWNER_TENANT` / `MCP_BEARER_TOKEN` env (self-host single-owner).
      3. Loud `unauthorized` — never a silent default tenant.
    """
    token: Optional[str] = None
    try:  # FastMCP request-scoped dependency; absent outside a live request.
        from fastmcp.server.dependencies import get_http_headers  # type: ignore

        # NB: FastMCP strips `authorization` by default (it excludes headers that
        # are risky to forward downstream); we must opt it back IN. Newer FastMCP
        # takes `include={...}`; older only `include_all=True`.
        try:
            headers = get_http_headers(include={"authorization"}) or {}
        except TypeError:  # older FastMCP without the `include` param
            headers = get_http_headers(include_all=True) or {}
        auth = headers.get("authorization") or headers.get("Authorization")
        if auth and auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    except Exception:  # noqa: BLE001 — no request context / API absent
        token = None
    if not token:
        token = os.getenv("CALLISTHENES_OWNER_TENANT") or os.getenv("MCP_BEARER_TOKEN")
    if not token:
        raise AuthError(
            "unauthorized",
            "No authenticated MCP bearer on the request; cannot identify the tenant.",
        )
    return token


# --- MCP registration ----------------------------------------------------------
class _PlainRegistry:
    """Fallback registry when `mcp` is None/unknown: name -> callable. Lets tests
    drive the tools without a real MCP server."""

    def __init__(self) -> None:
        self.tools: Dict[str, Callable[..., Any]] = {}

    def add(self, name: str, fn: Callable[..., Any]) -> None:
        self.tools[name] = fn


def register(
    mcp: Any = None,
    engine: Optional[ChatAuth] = None,
    usage_reader: Optional[Callable[[str], Dict[str, Any]]] = None,
    tenant_resolver: Optional[Callable[[], str]] = None,
) -> Any:
    """Register the five chat-auth tools on `mcp`.

    Returns the `ChatAuth` engine (so a caller/test can reach it), and — when
    `mcp` is None/unknown — a `_PlainRegistry` is attached at `engine.registry`.

    The registered tools DO NOT expose `mcp_token` in their schema (#645). The
    tenant is injected from the authenticated request via `tenant_resolver`
    (default: `_default_tenant_resolver`, which reads the request bearer). Tests
    inject a fixed resolver.

    C-4a: when no `engine` is supplied, `usage()` is wired to the live
    `/data/usage.sqlite` ledger if one is present.
    """
    if engine is None:
        reader = usage_reader
        if reader is None:
            from .usage_reader import sqlite_usage_reader

            reader = sqlite_usage_reader()
        engine = ChatAuth(usage_reader=reader)

    resolver = tenant_resolver or _default_tenant_resolver

    def _wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        # The engine method's real signature is e.g. connect(tenant, service='x').
        # The PUBLIC tool must (a) NOT expose `tenant`/`mcp_token` (#645 — identity
        # comes from the request, not the client) and (b) NEVER use *args, because
        # FastMCP's mcp.tool() REJECTS a VAR_POSITIONAL parameter (#636 regression
        # class). So we build an explicit public signature = the method's signature
        # MINUS its first (tenant) parameter, pin it on `inner`, resolve the tenant
        # from the request inside, and forward.
        sig = inspect.signature(fn)
        params = list(sig.parameters.values())
        public_params = params[1:]  # drop `tenant`
        public_sig = sig.replace(parameters=public_params)

        @functools.wraps(fn)
        def inner(*args: Any, **kwargs: Any) -> Any:
            try:
                tenant = resolver()
                return fn(tenant, *args, **kwargs)
            except (AuthError, OAuth2Error) as e:
                return {"ok": False, "error": {"code": e.code, "message": e.message}}

        inner.__signature__ = public_sig  # type: ignore[attr-defined]
        # Drop the wrapped `tenant` param from any copied annotations too.
        inner.__wrapped__ = fn  # type: ignore[attr-defined]
        return inner

    tools: Dict[str, Callable[..., Any]] = {
        "connect": _wrap(engine.connect),
        "complete_connect": _wrap(engine.complete_connect),
        "connections": _wrap(engine.connections),
        "revoke": _wrap(engine.revoke),
        "usage": _wrap(engine.usage),
    }

    registered_via = _register_on_mcp(mcp, tools)
    if registered_via is None:
        reg = _PlainRegistry()
        for name, fn in tools.items():
            reg.add(name, fn)
        engine.registry = reg  # type: ignore[attr-defined]

    return engine


def _register_on_mcp(mcp: Any, tools: Dict[str, Callable[..., Any]]) -> Optional[str]:
    """Register defensively across MCP API shapes. Returns the API used, or None."""
    if mcp is None:
        return None
    # FastMCP-style: mcp.tool()(fn) decorator factory.
    tool_deco = getattr(mcp, "tool", None)
    if callable(tool_deco):
        for name, fn in tools.items():
            try:
                deco = tool_deco(name=name)  # FastMCP accepts name=
            except TypeError:
                deco = tool_deco()
            deco(fn)
        return "tool_decorator"
    # add_tool(fn, name=...) style.
    add_tool = getattr(mcp, "add_tool", None)
    if callable(add_tool):
        for name, fn in tools.items():
            try:
                add_tool(fn, name=name)
            except TypeError:
                add_tool(fn)
        return "add_tool"
    return None


def _assert_canonical(url: str) -> None:
    """BINDING anti-phishing guard: every URL we emit must be an x.com/twitter.com
    origin. A non-canonical URL is a bug, not a caller error — fail loud."""
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    if host not in CANONICAL_AUTHORIZE_HOSTS:
        raise AuthError(
            "unavailable",
            f"Refusing to emit non-canonical authorize URL (host={host!r}).",
        )
