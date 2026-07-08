"""Chat-auth flow tests with all X HTTP calls MOCKED (no network, no real creds).

Verifies the C-2R acceptance shape (OAuth 2.0 PKCE):
  - connect() returns a CANONICAL x.com authorize URL (PKCE challenge) + state
  - complete_connect(code, state) exchanges the code and stores a per-tenant
    REFRESH token
  - two different tenants get isolated token sets
  - revoke() removes them (post-revoke lookup returns none) and a send would fail loudly
  - connections() reflects state
  - the shared contract `from auth import register` works with a fake MCP + plain
    registry, and the public tools DERIVE the tenant from an injected resolver
    (no client-supplied mcp_token — #645)
"""

from urllib.parse import parse_qs, urlparse

import pytest

import auth as auth_pkg
from auth import ChatAuth, register
from oauth2_pkce import HttpClient, HttpResponse, OAuth2PkceFlow
from token_store import InMemoryTokenStore


# --- Mock HTTP client: returns canned JSON X token responses --------------------
class FakeX(HttpClient):
    def __init__(self):
        self.calls = []

    def post_form(self, url, data, headers):
        self.calls.append((url, dict(data)))
        if url.endswith("/2/oauth2/token"):
            grant = data.get("grant_type")
            if grant == "authorization_code":
                return HttpResponse(
                    200,
                    '{"access_token":"ACCESS_TOKEN","refresh_token":"REFRESH_TOKEN",'
                    '"expires_in":7200,"scope":"tweet.read tweet.write users.read offline.access",'
                    '"token_type":"bearer"}',
                )
            if grant == "refresh_token":
                return HttpResponse(
                    200,
                    '{"access_token":"ACCESS_TOKEN_2","refresh_token":"REFRESH_TOKEN_2",'
                    '"expires_in":7200,"token_type":"bearer"}',
                )
        raise AssertionError(f"unexpected URL/grant {url} {data}")


def make_engine():
    store = InMemoryTokenStore()
    fake = FakeX()

    def flow_factory():
        return OAuth2PkceFlow(
            client_id="CID",
            redirect_uri="https://calli.example/oauth/callback",
            http=fake,
        )

    engine = ChatAuth(store=store, flow_factory=flow_factory)
    return engine, fake


# --- connect ------------------------------------------------------------------
def test_connect_returns_canonical_url_and_state():
    engine, _ = make_engine()
    res = engine.connect("mcp-tenant-A", service="x")
    assert res["ok"] is True
    assert res["flow"] == "oauth2_pkce"
    assert res["state"]

    parsed = urlparse(res["authorize_url"])
    assert parsed.hostname in ("api.x.com", "x.com", "api.twitter.com", "twitter.com")
    q = parse_qs(parsed.query)
    # PKCE + canonical OAuth2 params present.
    assert q["response_type"] == ["code"]
    assert q["code_challenge_method"] == ["S256"]
    assert q["code_challenge"]  # non-empty S256 challenge
    assert q["scope"] == ["tweet.read tweet.write users.read offline.access"]
    assert q["state"] == [res["state"]]
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
def test_complete_connect_stores_per_tenant_refresh_token():
    engine, _ = make_engine()
    res0 = engine.connect("mcp-tenant-A", service="x")
    res = engine.complete_connect(
        "mcp-tenant-A", code="AUTH_CODE", state=res0["state"], service="x"
    )
    assert res["ok"] is True
    assert res["connected"] is True
    assert "offline.access" in res["scope"]
    # secrets never leak into the result
    assert "REFRESH_TOKEN" not in str(res)
    assert "ACCESS_TOKEN" not in str(res)

    stored = engine.store.get("mcp-tenant-A", "x")
    assert stored.access_token == "ACCESS_TOKEN"
    assert stored.refresh_token == "REFRESH_TOKEN"
    assert stored.auth_flow == "oauth2_pkce"
    assert stored.expires_at is not None  # ~2h from now


def test_complete_connect_without_connect_is_not_found():
    engine, _ = make_engine()
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.complete_connect("mcp-tenant-A", code="AUTH_CODE", service="x")
    assert ei.value.code == "not_found"


def test_complete_connect_requires_code():
    engine, _ = make_engine()
    engine.connect("mcp-tenant-A", service="x")
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.complete_connect("mcp-tenant-A", code="  ", service="x")
    assert ei.value.code == "invalid_input"


def test_complete_connect_rejects_state_mismatch():
    engine, _ = make_engine()
    engine.connect("mcp-tenant-A", service="x")
    with pytest.raises(auth_pkg.AuthError) as ei:
        engine.complete_connect(
            "mcp-tenant-A", code="AUTH_CODE", state="WRONG_STATE", service="x"
        )
    assert ei.value.code == "invalid_input"


# --- tenant isolation (the core requirement) ----------------------------------
def test_two_tenants_get_isolated_token_sets():
    engine, _ = make_engine()
    for t in ("mcp-tenant-A", "mcp-tenant-B"):
        r = engine.connect(t, service="x")
        engine.complete_connect(t, code="AUTH_CODE", state=r["state"], service="x")

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
    r = engine.connect("mcp-tenant-A", service="x")
    engine.complete_connect("mcp-tenant-A", code="AUTH_CODE", state=r["state"], service="x")
    assert engine.store.get("mcp-tenant-A", "x") is not None

    res = engine.revoke("mcp-tenant-A", service="x")
    assert res["ok"] is True
    assert res["revoked"] == 1
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

    r = engine.connect("mcp-tenant-A", service="x")
    engine.complete_connect("mcp-tenant-A", code="AUTH_CODE", state=r["state"], service="x")

    after = engine.connections("mcp-tenant-A")
    x_after = [c for c in after["connections"] if c["service"] == "x"][0]
    assert x_after["connected"] is True
    assert "access_token" not in x_after  # no secret leak
    assert "refresh_token" not in x_after


# --- refresh (access tokens expire ~2h) ---------------------------------------
def test_refresh_returns_new_token_set():
    _, fake = make_engine()
    flow = OAuth2PkceFlow(client_id="CID", redirect_uri="https://x/cb", http=fake)
    fresh = flow.refresh("REFRESH_TOKEN")
    assert fresh.access_token == "ACCESS_TOKEN_2"
    assert fresh.refresh_token == "REFRESH_TOKEN_2"  # X may rotate; caller re-stores


# --- usage (OPEN SEAM: explicit stub, never faked) ----------------------------
def test_usage_returns_explicit_unavailable_stub():
    engine, _ = make_engine()
    res = engine.usage("mcp-tenant-A")
    assert res["ok"] is True
    assert res["source"] == "unavailable"
    assert res["usage"] == {"calls": None, "sends": None, "cost_usd": None}


def test_usage_uses_injected_reader_when_present():
    store = InMemoryTokenStore()
    engine = ChatAuth(
        store=store,
        flow_factory=lambda: OAuth2PkceFlow(
            client_id="k", redirect_uri="https://x/cb", http=FakeX()
        ),
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
    register(mcp, engine=engine, tenant_resolver=lambda: "mcp-x")
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
    register(mcp, engine=engine, tenant_resolver=lambda: "mcp-x")
    assert set(mcp.registered) == {
        "connect",
        "complete_connect",
        "connections",
        "revoke",
        "usage",
    }


def test_register_with_none_falls_back_to_plain_registry():
    engine, _ = make_engine()
    returned = register(None, engine=engine, tenant_resolver=lambda: "mcp-x")
    assert hasattr(returned, "registry")
    assert set(returned.registry.tools) == {
        "connect",
        "complete_connect",
        "connections",
        "revoke",
        "usage",
    }
    # tools are callable through the registry, derive tenant from the resolver
    # (NOT a client arg), and wrap errors loudly.
    err = returned.registry.tools["revoke"](service="x")
    assert err["ok"] is False
    assert err["error"]["code"] == "not_found"


def test_registered_tool_derives_tenant_and_wraps_errors_loudly():
    engine, _ = make_engine()
    reg = register(None, engine=engine, tenant_resolver=lambda: "mcp-A").registry
    # unknown service -> structured error, not an exception. No mcp_token passed.
    res = reg.tools["connect"](service="nope")
    assert res["ok"] is False
    assert res["error"]["code"] == "invalid_input"


def test_registered_connect_isolates_by_resolved_tenant():
    """The resolver — not a client argument — determines the tenant, so two
    different resolved identities cannot see each other's connection."""
    engine, _ = make_engine()
    reg_a = register(None, engine=engine, tenant_resolver=lambda: "tenant-A").registry
    r = reg_a.tools["connect"](service="x")
    assert r["ok"] is True
    reg_a.tools["complete_connect"](code="AUTH_CODE", state=r["state"], service="x")
    # A second registration bound to tenant-B shares the engine/store but resolves
    # a different identity → sees no connection.
    reg_b = register(None, engine=engine, tenant_resolver=lambda: "tenant-B").registry
    conns_b = reg_b.tools["connections"]()
    x = [c for c in conns_b["connections"] if c["service"] == "x"][0]
    assert x["connected"] is False
