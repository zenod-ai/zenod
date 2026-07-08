"""Boot-level registration test (EPIC-2.4 #636 regression guard).

The rest of the auth suite drives the plain-registry / direct-engine path, which
is exactly why #636 shipped: `register()._wrap` returned `inner(*args, **kwargs)`,
FastMCP's `mcp.tool()` REJECTS a VAR_POSITIONAL parameter, the whole registration
threw, and the wrapper swallowed it into single-owner-headless — so a live
`tools/list` exposed ZERO chat-auth tools while every unit test stayed green.

This test registers against a REAL FastMCP instance (the thing the unit actually
boots) and asserts all five chat-auth tools appear with explicit parameters. If
`_wrap` ever regresses to a `*args` signature, FastMCP raises at registration and
this test fails loudly.
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
        store=InMemoryTokenStore(), consumer_key="ck", consumer_secret="cs"
    )
    register(mcp, engine=engine)
    return mcp


def test_all_five_chat_auth_tools_register_on_real_fastmcp():
    mcp = _fresh_mcp()
    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    missing = FIVE - names
    assert not missing, f"chat-auth tools failed to register on FastMCP: {missing}"


def test_registered_tools_have_explicit_params_not_varargs():
    """The #636 fix: FastMCP must see explicit params (mcp_token, ...), never *args."""
    mcp = _fresh_mcp()
    tools = {t.name: t for t in asyncio.run(mcp.list_tools())}
    # connect(mcp_token, service='x') — both must surface as declared inputs.
    props = tools["connect"].parameters.get("properties", {})
    assert "mcp_token" in props, f"connect lost its explicit params: {list(props)}"
    assert "service" in props
    # A *args signature would have thrown at register() above; reaching here proves
    # the explicit __signature__ pin held.
