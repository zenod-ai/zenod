"""Boot-level registration test (EPIC-2.4 #636 + #645 regression guard).

The rest of the auth suite drives the plain-registry / direct-engine path, which
is exactly why #636 shipped: `register()._wrap` returned `inner(*args, **kwargs)`,
FastMCP's `mcp.tool()` REJECTS a VAR_POSITIONAL parameter, the whole registration
threw, and the wrapper swallowed it into single-owner-headless — so a live
`tools/list` exposed ZERO chat-auth tools while every unit test stayed green.

This test registers against a REAL FastMCP instance (the thing the unit actually
boots) and asserts all five chat-auth tools appear with explicit parameters AND
that the public schema does NOT contain `mcp_token` (#645 — identity comes from the
authenticated request, never a client argument). If `_wrap` regresses to `*args`,
FastMCP raises at registration and this test fails loudly; if it re-introduces
`mcp_token`/`tenant` in the public schema, the schema assertions fail.
"""

from __future__ import annotations

import asyncio

import pytest

fastmcp = pytest.importorskip("fastmcp")
from fastmcp import FastMCP  # noqa: E402

from auth import ChatAuth, register  # noqa: E402
from auth.token_store import InMemoryTokenStore  # noqa: E402

FIVE = {"connect", "complete_connect", "connections", "revoke", "usage"}


def _fresh_mcp() -> FastMCP:
    mcp = FastMCP("callisthenes-test")
    engine = ChatAuth(
        store=InMemoryTokenStore(),
        client_id="cid",
        client_secret="csec",
        redirect_uri="https://callisthenes.example/oauth/callback",
    )
    # Fixed resolver so the tools are drivable without a live request context.
    register(mcp, engine=engine, tenant_resolver=lambda: "mcp-tenant-A")
    return mcp


def test_all_five_chat_auth_tools_register_on_real_fastmcp():
    mcp = _fresh_mcp()
    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    missing = FIVE - names
    assert not missing, f"chat-auth tools failed to register on FastMCP: {missing}"


def test_registered_tools_have_explicit_params_not_varargs():
    """The #636 fix: FastMCP must see explicit params, never *args."""
    mcp = _fresh_mcp()
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    # connect(service='x') — service must surface as a declared input.
    props = tools["connect"].parameters.get("properties", {})
    assert "service" in props, f"connect lost its explicit params: {list(props)}"
    # complete_connect(code, state, service) — code/state surface.
    cc_props = tools["complete_connect"].parameters.get("properties", {})
    assert "code" in cc_props and "state" in cc_props, list(cc_props)


def test_public_schema_never_exposes_tenant_identity():
    """#645: the tenant is derived from the authenticated request, so NO tool may
    expose `mcp_token` (or `tenant`) as a client-supplied argument."""
    mcp = _fresh_mcp()
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    for name in FIVE:
        props = tools[name].parameters.get("properties", {})
        assert "mcp_token" not in props, f"{name} leaks mcp_token into its schema: {list(props)}"
        assert "tenant" not in props, f"{name} leaks tenant into its schema: {list(props)}"
