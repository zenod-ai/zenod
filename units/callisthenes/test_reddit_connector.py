"""Unit tests for the C-8 Reddit send connector. NO network / fastmcp / creds.

Covers: guarded-refuse (via the shared draft-guard on `post_reddit`), the receipt
shape (real permalink or loud FAILED, never a fabricated success), and per-tenant
token custody (read-only lookup of service="reddit" in the shared store).
"""

import pytest

from draft_guard import DEFAULT_GUARDED_TOOLS, DraftGuard, SendNotApproved
from throttle import DEFAULT_SEND_TOOLS
from reddit_connector import (
    RedditConnector,
    RedditSendError,
    build_reddit_tool,
    parse_reddit_receipt,
    register,
    scrub_vendor_noise,
    normalize_composio_value,
)


# --- a fake executor: records the call, returns a canned Composio body ---------
class FakeExecutor:
    def __init__(self, response: str):
        self.response = response
        self.calls = []

    def __call__(self, slug, arguments, user_id):
        self.calls.append({"slug": slug, "arguments": arguments, "user_id": user_id})
        return self.response


def make_connector(response, *, store=None, default_user_id="u_owner", api_key="ak_test"):
    ex = FakeExecutor(response)
    conn = RedditConnector(
        api_key=api_key,
        default_user_id=default_user_id,
        executor=ex,
        store=store,
        env={},  # isolate from the ambient environment
    )
    return conn, ex


# --------------------------------------------------------------------------- #
# 1. post_reddit is guarded by the SAME draft-guard as X
# --------------------------------------------------------------------------- #

def test_post_reddit_is_in_default_send_and_guarded_sets():
    assert "post_reddit" in DEFAULT_GUARDED_TOOLS
    assert "post_reddit" in DEFAULT_SEND_TOOLS


def test_unapproved_reddit_send_is_blocked_by_draft_guard():
    g = DraftGuard()
    assert g.is_guarded("post_reddit")
    with pytest.raises(SendNotApproved):
        g.check("post_reddit", {"subreddit": "test", "title": "hi", "content": "x"})


def test_approved_reddit_send_strips_the_approval_arg():
    g = DraftGuard()
    forwarded = g.check(
        "post_reddit",
        {"subreddit": "test", "title": "hi", "content": "x", "callisthenes_approve": True},
    )
    assert "callisthenes_approve" not in forwarded
    assert forwarded == {"subreddit": "test", "title": "hi", "content": "x"}


# --------------------------------------------------------------------------- #
# 2. Receipt shape — real permalink on success, loud FAILED otherwise
# --------------------------------------------------------------------------- #

def test_success_returns_real_permalink_receipt():
    body = '{"successful": true, "data": {"url": "https://www.reddit.com/r/test/comments/abc123/hi/", "id": "t3_abc123"}}'
    conn, ex = make_connector(body)
    res = conn.submit_post(subreddit="r/test", title="hi", content="hello")
    assert res["ok"] is True
    assert res["verified"] is True
    assert res["url"] == "https://www.reddit.com/r/test/comments/abc123/hi/"
    assert "Live URL: https://www.reddit.com/r/test/comments/abc123/hi/" in res["message"]
    # r/ prefix stripped, self kind + text mapped, flair defaulted to "".
    sent = ex.calls[0]
    assert sent["slug"] == "REDDIT_CREATE_REDDIT_POST"
    assert sent["arguments"]["subreddit"] == "test"
    assert sent["arguments"]["kind"] == "self"
    assert sent["arguments"]["text"] == "hello"
    assert sent["arguments"]["flair_id"] == ""


def test_permalink_recovered_by_deep_scan_when_not_a_top_level_field():
    body = '{"data": {"nested": {"link": "https://reddit.com/r/test/comments/z9/hey/"}}}'
    conn, _ = make_connector(body)
    res = conn.submit_post(subreddit="test", title="hey", content="body")
    assert res["ok"] is True
    assert res["url"] == "https://reddit.com/r/test/comments/z9/hey/"


def test_id_only_response_is_verified_without_permalink():
    body = '{"data": {"id": "t3_xyz"}}'
    receipt = parse_reddit_receipt(body)
    assert receipt.verified is True
    assert receipt.id == "t3_xyz"
    assert receipt.url is None


def test_no_url_or_id_is_a_loud_failure_never_fabricated():
    body = '{"successful": true, "data": {"nothing": "useful"}}'
    conn, _ = make_connector(body)
    res = conn.submit_post(subreddit="test", title="hi", content="x")
    assert res["ok"] is False
    assert res["verified"] is False
    assert res["message"].startswith("FAILED to send to Reddit")
    assert res.get("url") is None


def test_composio_unsuccessful_payload_is_a_failure():
    body = '{"successful": false, "error": "subreddit does not exist"}'
    receipt = parse_reddit_receipt(body)
    assert receipt.verified is False
    assert "subreddit does not exist" in receipt.reason


def test_connector_error_string_is_a_failure_not_a_success():
    receipt = parse_reddit_receipt("Could not reach the Reddit connector: timeout")
    assert receipt.verified is False


def test_vendor_noise_is_scrubbed_from_reasons():
    assert "composio" not in scrub_vendor_noise("Composio quota hit").lower()


def test_link_post_maps_url_not_text():
    conn, ex = make_connector('{"data":{"url":"https://reddit.com/r/test/comments/l1/x/"}}')
    conn.submit_post(subreddit="test", title="a link", content="https://example.com", is_self=False)
    args = ex.calls[0]["arguments"]
    assert args["kind"] == "link"
    assert args["url"] == "https://example.com"
    assert "text" not in args


# --------------------------------------------------------------------------- #
# 3. Loud caller/config errors (missing fields, unconnected)
# --------------------------------------------------------------------------- #

def test_missing_subreddit_or_title_raises():
    conn, _ = make_connector('{"data":{"url":"x"}}')
    with pytest.raises(RedditSendError):
        conn.submit_post(subreddit="", title="hi")
    with pytest.raises(RedditSendError):
        conn.submit_post(subreddit="test", title="")


def test_unconfigured_connector_refuses_loudly():
    # No api_key AND no executor AND no store => cannot send, must refuse.
    conn = RedditConnector(api_key=None, default_user_id=None, executor=None, store=None, env={})
    with pytest.raises(RedditSendError) as e:
        conn.submit_post(subreddit="test", title="hi", content="x")
    assert e.value.code == "not_connected"


def test_no_user_id_refuses_even_with_api_key():
    conn, _ = make_connector('{"data":{"url":"x"}}', default_user_id=None)
    with pytest.raises(RedditSendError) as e:
        conn.submit_post(subreddit="test", title="hi", content="x")
    assert e.value.code == "not_connected"


# --------------------------------------------------------------------------- #
# 4. Per-tenant token custody — read-only lookup of service="reddit"
# --------------------------------------------------------------------------- #

def test_per_tenant_user_id_read_from_custody_store():
    from auth.token_store import InMemoryTokenStore, StoredConnection

    store = InMemoryTokenStore()
    store.put(
        "tenant-A-mcp-token",
        StoredConnection(
            service="reddit",
            access_token="composio_user_for_A",
            access_token_secret="",
            connected_at=0.0,
        ),
    )
    conn, ex = make_connector('{"data":{"url":"https://reddit.com/r/test/comments/a/x/"}}', store=store, default_user_id="env_owner")

    # Tenant A's stored reddit user id is used, NOT the env default.
    conn.submit_post(subreddit="test", title="hi", content="x", mcp_token="tenant-A-mcp-token")
    assert ex.calls[-1]["user_id"] == "composio_user_for_A"

    # A tenant with nothing stored falls back to the single-owner env default.
    conn.submit_post(subreddit="test", title="hi", content="x", mcp_token="tenant-B-unknown")
    assert ex.calls[-1]["user_id"] == "env_owner"

    # No mcp_token at all => env default (single-owner dogfood path).
    conn.submit_post(subreddit="test", title="hi", content="x")
    assert ex.calls[-1]["user_id"] == "env_owner"


def test_resolve_user_id_precedence_explicit_wins():
    conn, _ = make_connector("{}", default_user_id="env_owner")
    assert conn.resolve_user_id(user_id="explicit") == "explicit"


def test_normalize_composio_value_strips_pasted_env_line():
    assert normalize_composio_value("COMPOSIO_API_KEY=ak_123", "COMPOSIO_API_KEY") == "ak_123"
    assert normalize_composio_value('"ak_123"', "COMPOSIO_API_KEY") == "ak_123"
    assert normalize_composio_value(None, "COMPOSIO_API_KEY") is None


# --------------------------------------------------------------------------- #
# 5. MCP registration + the tool callable
# --------------------------------------------------------------------------- #

def test_register_falls_back_to_plain_registry_and_tool_runs():
    conn, ex = make_connector('{"data":{"url":"https://reddit.com/r/test/comments/q/x/"}}')
    returned = register(mcp=None, connector=conn)
    assert returned is conn
    tool = conn.registry.tools["post_reddit"]
    res = tool(subreddit="test", title="hi", content="x")
    assert res["ok"] is True
    assert res["url"].endswith("/q/x/")


def test_registers_on_fastmcp_style_mcp():
    recorded = {}

    class FakeMcp:
        def tool(self, name=None):
            def deco(fn):
                recorded[name] = fn
                return fn
            return deco

    conn, _ = make_connector("{}")
    register(mcp=FakeMcp(), connector=conn)
    assert "post_reddit" in recorded


def test_build_reddit_tool_returns_failed_result_on_send_error():
    conn = RedditConnector(api_key=None, default_user_id=None, executor=None, store=None, env={})
    tool = build_reddit_tool(conn)
    res = tool(subreddit="test", title="hi", content="x")
    assert res["ok"] is False
    assert res["error"]["code"] == "not_connected"
