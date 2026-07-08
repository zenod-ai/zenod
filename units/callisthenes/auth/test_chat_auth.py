"""Chat-auth flow tests with all X HTTP calls MOCKED (no network, no real creds).

Verifies the C-2 acceptance shape:
  - connect() returns a CANONICAL x.com authorize URL + PIN instructions
  - complete_connect(pin) stores a per-tenant token
  - two different MCP tokens get isolated token sets
  - revoke() removes them (post-revoke lookup returns none) and a send would fail loudly
  - connections() reflects state
  - the shared contract `from auth import register` works with a fake MCP + plain registry
"""

from urllib.parse import parse_qs, urlparse

import pytest

import auth as auth_pkg
from auth import ChatAuth, register
from oauth1_pin import HttpClient, HttpResponse, OAuth1PinFlow
from token_store import InMemoryTokenStore


# --- Mock HTTP client: returns canned form-encoded X responses -----------------
class FakeX(HttpClient):
    def __init__(self):
        self.calls = []

    def post_form(self, url, headers):
        self.calls.append(url)
        if url.endswith("/oauth/request_token"):
            return HttpResponse(
                200,
                "oauth_token=REQ_TOKEN&oauth_token_secret=REQ_SECRET&oauth_callback_confirmed=true",
            )
        if url.endswith("/oauth/access_token"):
            return HttpResponse(
                200,
                "oauth_token=ACCESS_TOKEN&oauth_token_secret=ACCESS_SECRET&user_id=42&screen_name=tester",
            )
        raise AssertionError(f"unexpected URL {url}")


def make_engine():
    store = InMemoryTokenStore()
    fake = FakeX()

    def flow_factory():
        return OAuth1PinFlow("CONSUMER_KEY", "CONSUMER_SECRET", http=fake)

    engine = ChatAuth(store=store, flow_factory=flow_factory)
    return engine, fake


# --- connect ------------------------------------------------------------------
def test_connect_returns_canonical_url_and_pin_instructions():
    engine, _ = make_engine()
    res = engine.connect("mcp-tenant-A", service="x")
    assert res["ok"] is True
    assert res["flow"] == "oauth1_pin_oob"

    host = urlparse(res["authorize_url"]).hostname
    assert host in ("api.x.com", "x.com", "api.twitter.com", "twitter.com"), host
    # carries the request token
    q = parse_qs(urlparse(res["authorize_url"]).query)
    assert q["oauth_token"] == ["REQ_TOKEN"]
    # PIN instructions present
    assert "PIN" in res["instructions"]
    assert "complete_connect" in res["instructions"]


def test_connect_rejects_unknown_service():
    engine, _ = make_engine()
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.connect("mcp-tenant-A", service="myspace")
    assert ei.value.code == "invalid_input"


def test_connect_requires_tenant():
    engine, _ = make_engine()
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.connect("", service="x")
    assert ei.value.code == "unauthorized"


# --- complete_connect ---------------------------------------------------------
def test_complete_connect_stores_per_tenant_token():
    engine, _ = make_engine()
    engine.connect("mcp-tenant-A", service="x")
    res = engine.complete_connect("mcp-tenant-A", pin="1234567", service="x")
    assert res["ok"] is True
    assert res["connected"] is True
    assert res["screen_name"] == "tester"
    # secret never leaks into the result
    assert "ACCESS_SECRET" not in str(res)
    assert "ACCESS_TOKEN" not in str(res)

    stored = engine.store.get("mcp-tenant-A", "x")
    assert stored.access_token == "ACCESS_TOKEN"
    assert stored.access_token_secret == "ACCESS_SECRET"


def test_complete_connect_without_connect_is_not_found():
    engine, _ = make_engine()
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.complete_connect("mcp-tenant-A", pin="1234567", service="x")
    assert ei.value.code == "not_found"


def test_complete_connect_requires_pin():
    engine, _ = make_engine()
    engine.connect("mcp-tenant-A", service="x")
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.complete_connect("mcp-tenant-A", pin="  ", service="x")
    assert ei.value.code == "invalid_input"


# --- tenant isolation (the core requirement) ----------------------------------
def test_two_tenants_get_isolated_token_sets():
    engine, _ = make_engine()
    for t in ("mcp-tenant-A", "mcp-tenant-B"):
        engine.connect(t, service="x")
        engine.complete_connect(t, pin="1234567", service="x")

    # Both stored, independently.
    assert engine.store.get("mcp-tenant-A", "x") is not None
    assert engine.store.get("mcp-tenant-B", "x") is not None

    # Revoking A must not affect B.
    engine.revoke("mcp-tenant-A", service="x")
    assert engine.store.get("mcp-tenant-A", "x") is None
    assert engine.store.get("mcp-tenant-B", "x") is not None

    # A tenant that never connected sees nothing.
    conns = engine.connections("mcp-tenant-C")
    x = [c for c in conns["connections"] if c["service"] == "x"][0]
    assert x["connected"] is False


# --- revoke -> send would fail loudly -----------------------------------------
def test_revoke_removes_token_and_post_revoke_lookup_is_none():
    engine, _ = make_engine()
    engine.connect("mcp-tenant-A", service="x")
    engine.complete_connect("mcp-tenant-A", pin="1234567", service="x")
    assert engine.store.get("mcp-tenant-A", "x") is not None

    res = engine.revoke("mcp-tenant-A", service="x")
    assert res["ok"] is True
    assert res["revoked"] == 1
    # The seam a sender checks: no token means the send path has nothing to sign.
    assert engine.store.get("mcp-tenant-A", "x") is None


def test_revoke_nonexistent_is_loud_not_found():
    engine, _ = make_engine()
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.revoke("mcp-tenant-A", service="x")
    assert ei.value.code == "not_found"


# --- connections reflects state -----------------------------------------------
def test_connections_reflects_connected_then_disconnected():
    engine, _ = make_engine()
    before = engine.connections("mcp-tenant-A")
    x_before = [c for c in before["connections"] if c["service"] == "x"][0]
    assert x_before["connected"] is False

    engine.connect("mcp-tenant-A", service="x")
    engine.complete_connect("mcp-tenant-A", pin="1234567", service="x")

    after = engine.connections("mcp-tenant-A")
    x_after = [c for c in after["connections"] if c["service"] == "x"][0]
    assert x_after["connected"] is True
    assert x_after["screen_name"] == "tester"
    assert "access_token" not in x_after  # no secret leak


# --- usage (OPEN SEAM: explicit stub, never faked) ----------------------------
def test_usage_returns_explicit_unavailable_stub():
    engine, _ = make_engine()
    res = engine.usage("mcp-tenant-A")
    assert res["ok"] is True
    assert res["source"] == "unavailable"
    # null (not zero) signals "not measured".
    assert res["usage"] == {"calls": None, "sends": None, "cost_usd": None}


def test_usage_uses_injected_reader_when_present():
    store = InMemoryTokenStore()
    engine = ChatAuth(
        store=store,
        flow_factory=lambda: OAuth1PinFlow("k", "s", http=FakeX()),
        usage_reader=lambda tenant: {"calls": 10, "sends": 3, "cost_usd": 0.12},
    )
    res = engine.usage("mcp-tenant-A")
    assert res["source"] == "ledger"
    assert res["usage"]["sends"] == 3


# --- shared contract: register(mcp) -------------------------------------------
class FakeFastMCP:
    """Mimics FastMCP's @mcp.tool(name=...) decorator factory."""

    def __init__(self):
        self.registered = {}

    def tool(self, name=None):
        def deco(fn):
            self.registered[name or fn.__name__] = fn
            return fn

        return deco


def test_register_on_fastmcp_style_server():
    engine, _ = make_engine()
    mcp = FakeFastMCP()
    register(mcp, engine=engine)
    assert set(mcp.registered) == {
        "connect",
        "complete_connect",
        "connections",
        "revoke",
        "usage",
    }


class FakeAddToolMCP:
    def __init__(self):
        self.registered = {}

    def add_tool(self, fn, name=None):
        self.registered[name or fn.__name__] = fn


def test_register_on_add_tool_style_server():
    engine, _ = make_engine()
    mcp = FakeAddToolMCP()
    register(mcp, engine=engine)
    assert set(mcp.registered) == {
        "connect",
        "complete_connect",
        "connections",
        "revoke",
        "usage",
    }


def test_register_with_none_falls_back_to_plain_registry():
    engine, _ = make_engine()
    returned = register(None, engine=engine)
    assert hasattr(returned, "registry")
    assert set(returned.registry.tools) == {
        "connect",
        "complete_connect",
        "connections",
        "revoke",
        "usage",
    }
    # tools are callable through the registry and wrap errors loudly
    err = returned.registry.tools["revoke"]("mcp-x", service="x")
    assert err["ok"] is False
    assert err["error"]["code"] == "not_found"


def test_registered_tool_wraps_errors_loudly():
    engine, _ = make_engine()
    reg = register(None, engine=engine).registry
    # unknown service -> structured error, not an exception
    res = reg.tools["connect"]("mcp-A", service="nope")
    assert res["ok"] is False
    assert res["error"]["code"] == "invalid_input"
