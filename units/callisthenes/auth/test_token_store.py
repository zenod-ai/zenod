"""Per-tenant token store isolation tests (no network, no real creds)."""

import time

import pytest

from token_store import (
    InMemoryTokenStore,
    SqliteTokenStore,
    StoredConnection,
    _hash_tenant,
)


def _conn(service="x", tok="AT", sec="ATS", screen="alice"):
    return StoredConnection(
        service=service,
        access_token=tok,
        access_token_secret=sec,
        connected_at=time.time(),
        user_id="123",
        screen_name=screen,
        scope="read,write",
    )


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path):
    if request.param == "memory":
        return InMemoryTokenStore()
    return SqliteTokenStore(db_path=str(tmp_path / "auth.sqlite"))


def test_put_and_get_roundtrip(store):
    store.put("tenant-A", _conn(screen="alice"))
    got = store.get("tenant-A", "x")
    assert got is not None
    assert got.screen_name == "alice"
    assert got.access_token == "AT"
    assert got.access_token_secret == "ATS"


def test_tenants_are_isolated(store):
    store.put("tenant-A", _conn(tok="A-token", screen="alice"))
    store.put("tenant-B", _conn(tok="B-token", screen="bob"))

    a = store.get("tenant-A", "x")
    b = store.get("tenant-B", "x")
    assert a.access_token == "A-token"
    assert b.access_token == "B-token"
    # Neither tenant can see the other's token.
    assert a.access_token != b.access_token
    # A different, unknown tenant sees nothing.
    assert store.get("tenant-C", "x") is None


def test_revoke_removes_only_that_tenant(store):
    store.put("tenant-A", _conn(screen="alice"))
    store.put("tenant-B", _conn(screen="bob"))

    removed = store.revoke("tenant-A")
    assert removed == 1
    assert store.get("tenant-A", "x") is None
    # tenant-B untouched.
    assert store.get("tenant-B", "x") is not None


def test_revoke_specific_service(store):
    store.put("tenant-A", _conn(service="x"))
    n = store.revoke("tenant-A", service="x")
    assert n == 1
    assert store.get("tenant-A", "x") is None


def test_revoke_nonexistent_returns_zero(store):
    assert store.revoke("ghost") == 0


def test_public_view_leaks_no_secret(store):
    store.put("tenant-A", _conn(tok="SECRET_TOK", sec="SECRET_SEC"))
    pub = store.get("tenant-A", "x").public()
    flat = str(pub)
    assert "SECRET_TOK" not in flat
    assert "SECRET_SEC" not in flat
    assert pub["connected"] is True
    assert pub["service"] == "x"


def test_tenant_hash_is_deterministic_and_not_raw(store):
    h1 = _hash_tenant("mcp-abc")
    h2 = _hash_tenant("mcp-abc")
    assert h1 == h2
    assert "mcp-abc" not in h1  # raw token never appears in the key
    assert len(h1) == 64  # sha256 hex


def test_empty_tenant_rejected():
    with pytest.raises(ValueError):
        _hash_tenant("")
