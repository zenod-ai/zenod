"""C-4a tests: live usage_reader over a seeded llm_usage ledger fixture.

No network, no real X creds, no /data mount — a temp SQLite file mirrors the
authoritative schema from packages/server/src/usageStore.ts.
"""

import sqlite3

import pytest

from auth import ChatAuth, register
from token_store import InMemoryTokenStore
from usage_reader import sqlite_usage_reader

# Authoritative schema, mirrored verbatim from usageStore.ts.
_SCHEMA = """
CREATE TABLE llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0
);
"""


def _seed(path, rows):
    conn = sqlite3.connect(str(path))
    conn.executescript(_SCHEMA)
    conn.executemany(
        "INSERT INTO llm_usage (ts, operation, provider, model, cost_usd) "
        "VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    conn.close()


def test_reader_returns_real_calls_and_cost(tmp_path):
    db = tmp_path / "usage.sqlite"
    _seed(
        db,
        [
            (1, "ask_brain", "anthropic", "claude-opus-4-8", 0.0125),
            (2, "connect", "anthropic", "claude-opus-4-8", 0.0075),
            (3, "compose", "openrouter", "deepseek", 0.0100),
        ],
    )
    reader = sqlite_usage_reader(str(db))
    assert reader is not None
    out = reader("tenant-abc")
    assert out["calls"] == 3
    assert out["cost_usd"] == pytest.approx(0.03)
    # The ledger genuinely lacks a send column -> null, never a faked zero.
    assert out["sends"] is None


def test_sends_is_null_not_zero(tmp_path):
    db = tmp_path / "usage.sqlite"
    _seed(db, [(1, "op", "p", "m", 0.01)])
    out = sqlite_usage_reader(str(db))("t")
    assert out["sends"] is None
    assert out["sends"] != 0  # explicit: not measured, not "measured zero"


def test_empty_ledger_measures_zero_calls_but_null_sends(tmp_path):
    db = tmp_path / "usage.sqlite"
    _seed(db, [])  # table exists, no rows
    out = sqlite_usage_reader(str(db))("t")
    assert out["calls"] == 0  # measured zero calls is real
    assert out["cost_usd"] == pytest.approx(0.0)
    assert out["sends"] is None


def test_missing_db_file_factory_returns_none(tmp_path):
    # No ledger present -> factory declines to wire, so usage() stays 'unavailable'.
    assert sqlite_usage_reader(str(tmp_path / "nope.sqlite")) is None


def test_present_but_tableless_db_yields_nulls(tmp_path):
    # A file exists but has no llm_usage table -> null, not zero.
    db = tmp_path / "empty.sqlite"
    sqlite3.connect(str(db)).close()
    reader = sqlite_usage_reader(str(db))
    assert reader is not None
    out = reader("t")
    assert out == {"calls": None, "sends": None, "cost_usd": None}


def test_env_var_resolves_default_path(tmp_path, monkeypatch):
    db = tmp_path / "env.sqlite"
    _seed(db, [(1, "op", "p", "m", 0.02)])
    monkeypatch.setenv("CALLISTHENES_USAGE_DB", str(db))
    reader = sqlite_usage_reader()  # no explicit path -> env
    assert reader is not None
    assert reader("t")["cost_usd"] == pytest.approx(0.02)


def test_usage_tool_end_to_end_reports_ledger_source(tmp_path):
    db = tmp_path / "usage.sqlite"
    _seed(db, [(1, "op", "p", "m", 0.04), (2, "op", "p", "m", 0.06)])
    engine = ChatAuth(
        store=InMemoryTokenStore(),
        usage_reader=sqlite_usage_reader(str(db)),
    )
    result = engine.usage("mcp-token")
    assert result["ok"] is True
    assert result["source"] == "ledger"
    assert result["usage"]["calls"] == 2
    assert result["usage"]["cost_usd"] == pytest.approx(0.10)
    assert result["usage"]["sends"] is None


def test_register_autowires_when_ledger_present(tmp_path, monkeypatch):
    db = tmp_path / "usage.sqlite"
    _seed(db, [(1, "op", "p", "m", 0.05)])
    monkeypatch.setenv("CALLISTHENES_USAGE_DB", str(db))
    monkeypatch.setenv("CALLISTHENES_DATA_DIR", str(tmp_path))
    engine = register(mcp=None)
    result = engine.usage("mcp-token")
    assert result["source"] == "ledger"
    assert result["usage"]["cost_usd"] == pytest.approx(0.05)


def test_register_stays_unavailable_without_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLISTHENES_USAGE_DB", str(tmp_path / "absent.sqlite"))
    monkeypatch.setenv("CALLISTHENES_DATA_DIR", str(tmp_path))
    engine = register(mcp=None)
    result = engine.usage("mcp-token")
    assert result["source"] == "unavailable"
    assert result["usage"] == {"calls": None, "sends": None, "cost_usd": None}
