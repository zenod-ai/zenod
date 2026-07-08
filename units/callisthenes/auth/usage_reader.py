"""C-4a · live usage reader wired to the durable LLM-usage ledger.

Implements the fixed interface C-2 left as an OPEN SEAM:

    usage_reader(tenant: str) -> {"calls": int|None, "sends": int|None, "cost_usd": float|None}

Source of truth is `/data/usage.sqlite`, table `llm_usage`, written by
packages/server/src/usageStore.ts. Schema (authoritative, mirrored here):

    CREATE TABLE llm_usage (
      id, ts, operation, provider, model,
      input_tokens, output_tokens, cached_input_tokens,
      cache_creation_input_tokens, cost_usd
    )

Honest mapping (zero faked values — SEAM-SPEC §2, reads return real data or
explicit null, never invented numbers):
  - calls    = COUNT(*)            -> REAL (one row per billed LLM call)
  - cost_usd = SUM(cost_usd)       -> REAL
  - sends    = None                -> the ledger GENUINELY LACKS a send/post
                                      record. `llm_usage` logs LLM calls, not
                                      outbound X sends; there is no durable
                                      send-log yet. Null means "not measured",
                                      never "measured zero". Wiring a real send
                                      count is a future lane (a Callisthenes
                                      send-ledger written by the draft-guard/
                                      throttle path), not this table.

Tenancy: `llm_usage` has no tenant/mcp_token column. Zenod's topology is
instance-per-user (one container == one tenant), so the container-local ledger
IS this tenant's ledger. The `tenant` argument is accepted (fixed interface)
but not used as a DB filter; documented rather than silently ignored.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any, Callable, Dict, Optional

DEFAULT_DB_PATH = "/data/usage.sqlite"


def _resolve_db_path(db_path: Optional[str]) -> str:
    if db_path:
        return db_path
    return os.getenv("CALLISTHENES_USAGE_DB", DEFAULT_DB_PATH)


def sqlite_usage_reader(
    db_path: Optional[str] = None,
    *,
    require_exists: bool = True,
) -> Optional[Callable[[str], Dict[str, Any]]]:
    """Build a usage_reader over the `llm_usage` ledger, or None if unavailable.

    Returns None when `require_exists` and the DB file is absent, so callers
    (e.g. `register`) leave `usage()` in its explicit `source: "unavailable"`
    stub state rather than pretending a ledger exists. This keeps the unwired
    path honest and preserves C-2's default behaviour where there is no ledger.
    """
    path = _resolve_db_path(db_path)
    if require_exists and not os.path.exists(path):
        return None

    def _read(tenant: str) -> Dict[str, Any]:  # noqa: ARG001 - see Tenancy note
        try:
            # Read-only open: never create the file, never write.
            uri = f"file:{path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
        except sqlite3.Error:
            # DB genuinely unreadable -> null, not zero.
            return {"calls": None, "sends": None, "cost_usd": None}
        try:
            row = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(cost_usd), 0.0) FROM llm_usage"
            ).fetchone()
        except sqlite3.OperationalError:
            # Table not present (fresh/empty ledger file) -> null, not zero.
            return {"calls": None, "sends": None, "cost_usd": None}
        finally:
            conn.close()
        calls = int(row[0]) if row and row[0] is not None else None
        cost_usd = float(row[1]) if row and row[1] is not None else None
        return {
            "calls": calls,
            # The ledger has no send/post column; null is the honest answer.
            "sends": None,
            "cost_usd": cost_usd,
        }

    return _read
