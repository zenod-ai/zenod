"""units/callisthenes/auth — per-tenant chat-auth for Callisthenes (EPIC-2.4 C-2).

The console-less auth surface. A tenant connects their X account entirely via chat:

    connect(service="x")            -> canonical x.com authorize URL + PIN instructions
    complete_connect(pin, "x")      -> exchanges the PIN, stores tokens keyed by MCP token
    connections()                   -> per-service status for THIS tenant (no secrets)
    revoke(service|token)           -> drops this tenant's tokens (next send fails loudly)
    usage()                         -> calls / sends / cost for this tenant (ledger; see OPEN SEAM)

SHARED CONTRACT with C-1's wrapper:

    from auth import register as register_auth
    register_auth(mcp)

`register(mcp)` registers the five tools on `mcp`, supporting both a FastMCP-style
`@mcp.tool()` decorator and an `mcp.add_tool(fn, name=...)` API. If `mcp` is None or
neither API is present, tools register into a plain in-process registry (exposed as
`register_auth(...)`'s return value) so tests can still drive them.

Per-tenant identity is the caller's MCP access token (SEAM-SPEC §4). The wrapper is
responsible for extracting the bearer from the request and passing it as `mcp_token`.
Tools accept `mcp_token` explicitly so the package is testable without a live server.

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

from .oauth1_pin import (
    CANONICAL_AUTHORIZE_HOSTS,
    OAuth1Error,
    OAuth1PinFlow,
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
class _PendingRequest:
    """A request-token awaiting its PIN, held between connect() and complete_connect()."""

    oauth_token: str
    oauth_token_secret: str
    service: str
    created_at: float


class ChatAuth:
    """The chat-auth engine. Holds the token store + pending request-tokens and
    builds the OAuth1 flow from consumer creds. One instance per unit process."""

    def __init__(
        self,
        store: Optional[TokenStore] = None,
        consumer_key: Optional[str] = None,
        consumer_secret: Optional[str] = None,
        flow_factory: Optional[Callable[[], OAuth1PinFlow]] = None,
        usage_reader: Optional[Callable[[str], Dict[str, Any]]] = None,
    ):
        self.store = store or default_store()
        self._consumer_key = consumer_key or os.getenv("X_OAUTH_CONSUMER_KEY", "")
        self._consumer_secret = consumer_secret or os.getenv(
            "X_OAUTH_CONSUMER_SECRET", ""
        )
        # flow_factory lets tests inject a mocked-HTTP OAuth1PinFlow.
        self._flow_factory = flow_factory
        self._usage_reader = usage_reader
        # { (tenant, service): _PendingRequest } — request-token secret handoff.
        self._pending: Dict[str, _PendingRequest] = {}

    # -- helpers ----------------------------------------------------------------
    def _flow(self) -> OAuth1PinFlow:
        if self._flow_factory:
            return self._flow_factory()
        return OAuth1PinFlow(self._consumer_key, self._consumer_secret)

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
    def _require_tenant(mcp_token: Optional[str]) -> str:
        if not mcp_token:
            raise AuthError(
                "unauthorized",
                "No MCP access token on the call; cannot identify the tenant.",
            )
        return mcp_token

    def _pending_key(self, tenant: str, service: str) -> str:
        # tenant is the raw MCP token; never logged. Key is process-local only.
        return f"{tenant}\x00{service}"

    # -- tool 1: connect --------------------------------------------------------
    def connect(self, mcp_token: str, service: str = "x") -> Dict[str, Any]:
        tenant = self._require_tenant(mcp_token)
        service = self._check_service(service)
        flow = self._flow()
        rt = flow.request_token()
        self._pending[self._pending_key(tenant, service)] = _PendingRequest(
            oauth_token=rt.oauth_token,
            oauth_token_secret=rt.oauth_token_secret,
            service=service,
            created_at=time.time(),
        )
        url = flow.authorize_url(rt.oauth_token)
        _assert_canonical(url)
        return {
            "ok": True,
            "service": service,
            "authorize_url": url,
            "instructions": (
                f"Visit {url} , approve access to your X account, then copy the "
                f"7-digit PIN shown and send it back with "
                f"complete_connect(pin=\"<PIN>\", service=\"{service}\")."
            ),
            "flow": "oauth1_pin_oob",
        }

    # -- tool 2: complete_connect ----------------------------------------------
    def complete_connect(
        self, mcp_token: str, pin: str, service: str = "x"
    ) -> Dict[str, Any]:
        tenant = self._require_tenant(mcp_token)
        service = self._check_service(service)
        pending = self._pending.get(self._pending_key(tenant, service))
        if not pending:
            raise AuthError(
                "not_found",
                f"No pending {service} connection for this tenant. Call connect() first.",
            )
        if not (pin or "").strip():
            raise AuthError("invalid_input", "A PIN is required to complete the connection.")
        flow = self._flow()
        at = flow.access_token(
            pending.oauth_token, pending.oauth_token_secret, pin
        )
        conn = StoredConnection(
            service=service,
            access_token=at.oauth_token,
            access_token_secret=at.oauth_token_secret,
            connected_at=time.time(),
            user_id=at.user_id,
            screen_name=at.screen_name,
            scope="read,write",
        )
        self.store.put(tenant, conn)
        self._pending.pop(self._pending_key(tenant, service), None)
        # Receipt (SEAM-SPEC §2): a mutating tool returns a concrete handle. The
        # handle here is the connected X identity (screen_name / user_id) — the
        # thing that was created — never the secret token.
        return {
            "ok": True,
            "service": service,
            "connected": True,
            "screen_name": at.screen_name,
            "user_id": at.user_id,
            "message": (
                f"Connected X account "
                + (f"@{at.screen_name}" if at.screen_name else "(id " + str(at.user_id) + ")")
                + " for this tenant."
            ),
        }

    # -- tool 3: connections ----------------------------------------------------
    def connections(self, mcp_token: str) -> Dict[str, Any]:
        tenant = self._require_tenant(mcp_token)
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
        mcp_token: str,
        service: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Dict[str, Any]:
        tenant = self._require_tenant(mcp_token)
        # `token` param (SEAM allows revoke(service|token)): if a service string was
        # passed positionally as `token`, treat it as the service selector.
        if service is None and token is not None:
            service = token
        if service is not None:
            service = self._check_service(service)
        removed = self.store.revoke(tenant, service)
        # Also clear any half-finished pending request for this tenant.
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
    def usage(self, mcp_token: str) -> Dict[str, Any]:
        tenant = self._require_tenant(mcp_token)
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
) -> Any:
    """Register the five chat-auth tools on `mcp`.

    Returns the `ChatAuth` engine (so a caller/test can reach it), and — when
    `mcp` is None/unknown — a `_PlainRegistry` is attached at `engine.registry`.

    The registered tool callables take `mcp_token` as their first argument; the
    wrapper (C-1) is responsible for injecting the caller's bearer token. This
    keeps tenant identity explicit and the package server-agnostic.

    C-4a: when no `engine` is supplied, `usage()` is wired to the live
    `/data/usage.sqlite` ledger if one is present. An explicit `usage_reader`
    overrides; otherwise `sqlite_usage_reader()` auto-detects and returns None
    when no ledger exists — leaving `usage()` in its honest `unavailable` stub.
    """
    if engine is None:
        reader = usage_reader
        if reader is None:
            from .usage_reader import sqlite_usage_reader

            reader = sqlite_usage_reader()
        engine = ChatAuth(usage_reader=reader)

    def _wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        # Uniform loud-error envelope (SEAM-SPEC §5): AuthError/OAuth1Error -> {error}.
        #
        # #636: the inner function still uses (*args, **kwargs) to forward the
        # call, but FastMCP's mcp.tool() introspects the signature and REFUSES a
        # VAR_POSITIONAL (*args) parameter — which silently killed the entire auth
        # registration. We pin `inner.__signature__` to the wrapped method's real
        # signature (e.g. connect(mcp_token, service='x')), so FastMCP sees an
        # explicit parameter list, builds the correct tool schema, and calls
        # inner(mcp_token=..., service=...) — which *args forwards verbatim.
        @functools.wraps(fn)
        def inner(*args: Any, **kwargs: Any) -> Any:
            try:
                return fn(*args, **kwargs)
            except (AuthError, OAuth1Error) as e:
                return {"ok": False, "error": {"code": e.code, "message": e.message}}

        inner.__signature__ = inspect.signature(fn)  # type: ignore[attr-defined]
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
