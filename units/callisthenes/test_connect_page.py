"""C-7 tests — the minimal hosted connect-UI.

Two layers:
  1. Controller layer (no server): ConnectPage renders the connector list, Connect X
     yields a CANONICAL x.com authorize URL, the callback exchanges a (mocked) code
     into the shared store, a token connector stores its value, and the connector
     list is extensible (add a row -> it renders + routes).
  2. Live HTTP layer (real FastMCP + Starlette TestClient): GET /connect renders,
     GET /connect/x/start 302-redirects to a canonical x.com authorize URL, the
     /oauth/callback route exchanges a mocked code and reports connected, and the
     POST token route stores a Reddit token.

All network (X's token endpoint) is mocked via an injected HttpClient — NO real X
creds, NO real Composio token, NO outbound HTTP.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from auth import ChatAuth  # noqa: E402
from auth.oauth2_pkce import HttpClient, HttpResponse, OAuth2PkceFlow  # noqa: E402
from auth.token_store import InMemoryTokenStore  # noqa: E402
import connect_page as cp  # noqa: E402

OWNER = "mcp-tenant-owner-token"


class _FakeTokenHttp(HttpClient):
    """Mock X's /2/oauth2/token: return a valid token set with a refresh token."""

    def post_form(self, url, data, headers):  # noqa: ANN001
        body = {
            "access_token": "at-live",
            "refresh_token": "rt-durable",
            "expires_in": 7200,
            "scope": "tweet.read tweet.write users.read offline.access",
            "token_type": "bearer",
        }
        return HttpResponse(status_code=200, text=json.dumps(body))


def _engine() -> ChatAuth:
    """A ChatAuth whose OAuth2 flow uses the mocked HTTP client + an in-memory store."""
    store = InMemoryTokenStore()

    def flow_factory() -> OAuth2PkceFlow:
        return OAuth2PkceFlow(
            client_id="cid",
            redirect_uri="https://calli.example/oauth/callback",
            http=_FakeTokenHttp(),
        )

    return ChatAuth(store=store, flow_factory=flow_factory)


def _page(**cfg) -> cp.ConnectPage:
    config = cp.ConnectPageConfig(
        mcp_url=cfg.get("mcp_url", "https://calli.example/mcp"),
        mcp_token=cfg.get("mcp_token", "MCP-ACCESS-TOKEN-xyz"),
        owner_tenant=cfg.get("owner_tenant", OWNER),
    )
    return cp.ConnectPage(engine=_engine(), config=config)


# --------------------------------------------------------------------------- #
# Controller layer
# --------------------------------------------------------------------------- #

def test_page_renders_connector_list_and_mcp_block():
    html = _page().render_page()
    assert "Connect your X account" in html
    assert "Connect X (Twitter)" not in html
    assert "Reddit" in html
    # MCP URL + token both shown with copy affordance.
    assert "https://calli.example/mcp" in html
    assert "MCP-ACCESS-TOKEN-xyz" in html
    assert "copyNear" in html  # copy button JS present


def test_connect_x_yields_canonical_x_com_authorize_url():
    result = _page().start_oauth("x")
    assert result["ok"] is True
    url = result["authorize_url"]
    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(url)
    assert parsed.hostname == "x.com", f"authorize URL not canonical x.com: {url}"
    assert parsed.path == "/i/oauth2/authorize"
    q = parse_qs(parsed.query)
    assert q["response_type"] == ["code"]
    assert q["code_challenge_method"] == ["S256"]
    assert "offline.access" in q["scope"][0]


def test_callback_exchanges_code_and_stores_connection():
    page = _page()
    started = page.start_oauth("x")
    state = started["state"]
    # A forged/absent state is rejected (CSRF guard in the engine).
    completed = page.complete_oauth(code="auth-code-123", state=state, service="x")
    assert completed.get("ok") is True and completed.get("connected") is True
    # The refresh token landed in the SHARED store, keyed to the owner tenant.
    conn = page.engine.store.get(OWNER, "x")
    assert conn is not None and conn.refresh_token == "rt-durable"
    # The callback HTML says connected.
    assert "Connected" in page.render_callback(completed)


def test_callback_failure_is_loud_not_faked():
    page = _page()
    # No connect() first => no pending flow => loud error, never a fake success.
    res = page.complete_oauth(code="x", state="nope", service="x")
    assert res.get("ok") is not True
    html = page.render_callback(res)
    assert "failed" in html.lower()
    assert "Nothing was connected" in html


def test_token_connector_stores_value_in_shared_store():
    page = _page()
    res = page.save_token("reddit", "  COMPOSIO_USER_ID=usr_abc123  ")
    assert res["ok"] is True and res["service"] == "reddit"
    # Stored under service="reddit" with the env-line prefix + whitespace scrubbed,
    # exactly where the C-8 connector reads the Composio user id (access_token).
    conn = page.engine.store.get(OWNER, "reddit")
    assert conn is not None and conn.access_token == "usr_abc123"
    # And the row now renders as connected.
    assert "token stored" in page.render_page()


def test_connector_list_is_extensible():
    extra = cp.Connector(
        id="instagram", label="Instagram", kind=cp.KIND_TOKEN, token_hint="IG token"
    )
    page = cp.ConnectPage(
        engine=_engine(),
        connectors=cp.default_connectors() + [extra],
        config=cp.ConnectPageConfig(owner_tenant=OWNER),
    )
    html = page.render_page()
    assert "Instagram" in html and "IG token" in html
    # A new token connector is drivable with no code change beyond the row.
    assert page.save_token("instagram", "ig-tok")["ok"] is True


def test_no_owner_tenant_fails_loudly_never_silent():
    page = cp.ConnectPage(engine=_engine(), config=cp.ConnectPageConfig(owner_tenant=None))
    # Guard env fallbacks so the test is deterministic.
    old = {k: os.environ.pop(k, None) for k in ("CALLISTHENES_OWNER_TENANT", "MCP_BEARER_TOKEN")}
    try:
        assert page.start_oauth("x")["ok"] is False
        assert page.save_token("reddit", "v")["ok"] is False
    finally:
        for k, v in old.items():
            if v is not None:
                os.environ[k] = v


def test_mcp_block_flags_missing_provisioner_values():
    page = cp.ConnectPage(
        engine=_engine(),
        config=cp.ConnectPageConfig(mcp_url=None, mcp_token=None, owner_tenant=OWNER),
    )
    html = page.render_page()
    # Honest seam, not a faked URL/token.
    assert "CALLISTHENES_MCP_URL" in html
    assert "CALLISTHENES_MCP_TOKEN" in html


def test_missing_x_oauth_config_is_page_error_not_exception(monkeypatch, tmp_path):
    for key in cp.X_CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CALLISTHENES_X_CONFIG_PATH", str(tmp_path / "x-config.json"))
    page = cp.ConnectPage(
        engine=ChatAuth(store=InMemoryTokenStore()),
        config=cp.ConnectPageConfig(owner_tenant=OWNER),
    )
    res = page.start_oauth("x")
    assert res["ok"] is False
    assert "Missing X_OAUTH2_CLIENT_ID" in res["error"]["message"]


def test_x_config_form_saves_redacted_values_and_updates_engine(monkeypatch, tmp_path):
    for key in cp.X_CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CALLISTHENES_X_CONFIG_PATH", str(tmp_path / "x-config.json"))
    engine = ChatAuth(store=InMemoryTokenStore())
    page = cp.ConnectPage(engine=engine, config=cp.ConnectPageConfig(owner_tenant=OWNER))
    res = page.save_x_config(
        """
        X_OAUTH2_CLIENT_ID=cid-live
        X_OAUTH2_CLIENT_SECRET=super-secret
        X_OAUTH2_REDIRECT_URI=https://c.example/oauth/callback
        X_OAUTH_CONSUMER_KEY=consumer-key
        X_OAUTH_CONSUMER_SECRET=consumer-secret
        X_BEARER_TOKEN=bearer-token
        X_OAUTH_ACCESS_TOKEN=access-token
        X_OAUTH_ACCESS_TOKEN_SECRET=access-secret
        """
    )
    assert res["ok"] is True
    assert res["sender_ready"] is True
    assert engine._client_id == "cid-live"  # noqa: SLF001
    assert engine._redirect_uri == "https://c.example/oauth/callback"  # noqa: SLF001
    rendered = page.render_page()
    assert "API Key" in rendered
    assert "Credentials saved, verification needed" in rendered
    assert "super-secret" not in rendered
    assert "access-secret" not in rendered


def test_x_setup_guides_user_to_official_console_and_has_one_field_per_sender_credential(
    monkeypatch, tmp_path
):
    for key in cp.X_CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CALLISTHENES_X_CONFIG_PATH", str(tmp_path / "x-config.json"))
    rendered = _page().render_page()
    assert 'href="https://console.x.com/"' in rendered
    assert 'href="https://docs.x.com/x-api/getting-started/getting-access"' in rendered
    assert "There is no user-ID field" in rendered
    assert "Read and write" in rendered
    assert "Application Created Successfully" in rendered
    assert "The three values X showed you" in rendered
    assert "Consumer Key / API Key field" in rendered
    assert "Secret Key / API Key Secret field" in rendered
    assert "Do not enter it here" in rendered
    assert "Credentials shown in screenshots or chat are exposed" in rendered
    for key in cp.X_SENDER_REQUIRED:
        assert f'name="{key}"' in rendered
    assert 'name="x_config"' not in rendered


# --------------------------------------------------------------------------- #
# Live HTTP layer — real FastMCP + Starlette TestClient
# --------------------------------------------------------------------------- #

def _live_client(x_verifier=None):
    pytest.importorskip("fastmcp")
    from fastmcp import FastMCP
    from starlette.testclient import TestClient

    mcp = FastMCP("calli-c7-test")
    engine = _engine()
    cp.register(
        mcp,
        engine=engine,
        config=cp.ConnectPageConfig(
            mcp_url="https://calli.example/mcp",
            mcp_token="MCP-ACCESS-TOKEN-xyz",
            owner_tenant=OWNER,
        ),
        x_verifier=x_verifier,
    )
    app = mcp.http_app()
    return TestClient(app), engine


def test_live_get_connect_renders():
    client, _ = _live_client()
    r = client.get("/connect")
    assert r.status_code == 200
    assert "Connect your X account" in r.text and "Reddit" in r.text
    assert "Connect X (Twitter)" not in r.text
    assert "MCP-ACCESS-TOKEN-xyz" in r.text


def test_live_connect_x_redirects_to_canonical_x_com():
    client, _ = _live_client()
    r = client.get("/connect/x/start", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    from urllib.parse import urlparse

    assert urlparse(loc).hostname == "x.com", f"redirect not canonical x.com: {loc}"


def test_live_oauth_callback_exchanges_and_reports_connected():
    client, engine = _live_client()
    # Start the flow so a pending PKCE state exists (shared engine).
    start = client.get("/connect/x/start", follow_redirects=False)
    from urllib.parse import urlparse, parse_qs

    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    r = client.get(f"/oauth/callback?code=live-code&state={state}")
    assert r.status_code == 200
    assert "Connected" in r.text
    assert engine.store.get(OWNER, "x").refresh_token == "rt-durable"


def test_live_oauth_callback_provider_error_is_loud():
    client, _ = _live_client()
    r = client.get("/oauth/callback?error=access_denied&error_description=user+said+no")
    assert r.status_code == 400
    assert "failed" in r.text.lower()


def test_live_post_reddit_token_stores_it():
    client, engine = _live_client()
    r = client.post("/connect/reddit/token", data={"token": "usr_live_reddit"}, follow_redirects=False)
    assert r.status_code == 303
    assert engine.store.get(OWNER, "reddit").access_token == "usr_live_reddit"


def test_live_post_x_config_saves_without_redirecting_secrets(monkeypatch, tmp_path):
    for key in cp.X_CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CALLISTHENES_X_CONFIG_PATH", str(tmp_path / "x-config.json"))
    client, _engine = _live_client(
        x_verifier=lambda _cfg: {
            "ok": True,
            "user_id": "12345",
            "username": "calli_test",
            "name": "Calli Test",
        }
    )
    r = client.post(
        "/connect/x/config",
        data={
            "X_OAUTH_CONSUMER_KEY": "consumer-key",
            "X_OAUTH_CONSUMER_SECRET": "consumer-secret",
            "X_OAUTH_ACCESS_TOKEN": "access-token",
            "X_OAUTH_ACCESS_TOKEN_SECRET": "access-secret",
        },
    )
    assert r.status_code == 200
    assert "X connected and verified as @calli_test" in r.text
    assert "Connected as @calli_test" in r.text
    assert "consumer-secret" not in r.text
    assert "access-secret" not in r.text
