"""Per-tenant token storage, keyed by the caller's MCP access token.

The MCP access token IS the tenant identity (EPIC-2.4 §2, SEAM-SPEC §4 per-unit
bearer). Tenant A's stored X tokens must never be reachable via tenant B's MCP
token — that isolation is the core requirement of C-2.

Backends are pluggable behind `TokenStore`. Default = SQLite under a data dir.
An in-memory backend is provided for tests. Secrets are NEVER logged; the store
never emits token material anywhere except via explicit `get()`.

Tenant keys are stored HASHED (sha256) so a leaked DB does not reveal live MCP
bearer tokens. Secret *values* are stored as-is (they must round-trip to sign X
requests) — protecting them is the deployment's disk-encryption concern, out of
scope here; we simply never log them.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional


@dataclass
class StoredConnection:
    """One service connection for one tenant. Token fields are sensitive.

    C-2R: OAuth 2.0 PKCE stores `access_token` (short-lived, ~2h) + `refresh_token`
    (the durable per-tenant credential). `access_token_secret` is retained (default
    None) only for the self-host OAuth1-PIN fallback, where it holds the OAuth1
    token secret. `expires_at` is the epoch when the access token goes stale;
    `token_type` is X's ("bearer"). `auth_flow` records which flow minted this.
    """

    service: str
    access_token: str
    connected_at: float
    access_token_secret: Optional[str] = None
    refresh_token: Optional[str] = None
    expires_at: Optional[float] = None
    token_type: Optional[str] = None
    user_id: Optional[str] = None
    screen_name: Optional[str] = None
    scope: Optional[str] = None  # e.g. "tweet.read tweet.write users.read offline.access"
    auth_flow: Optional[str] = None  # "oauth2_pkce" (default) | "oauth1_pin"

    def public(self) -> Dict[str, object]:
        """Status view — NO secrets. Safe to return in a tool result."""
        return {
            "service": self.service,
            "connected": True,
            "connected_at": self.connected_at,
            "screen_name": self.screen_name,
            "user_id": self.user_id,
            "scope": self.scope,
        }


def _hash_tenant(mcp_token: str) -> str:
    if not mcp_token:
        raise ValueError("mcp_token (tenant identity) is required and must be non-empty")
    return hashlib.sha256(mcp_token.encode()).hexdigest()


class TokenStore:
    """Abstract per-tenant store. Methods take the RAW mcp_token; the backend
    hashes it internally so callers never manage the hashing."""

    def put(self, mcp_token: str, conn: StoredConnection) -> None:
        raise NotImplementedError

    def get(self, mcp_token: str, service: str) -> Optional[StoredConnection]:
        raise NotImplementedError

    def list_services(self, mcp_token: str) -> List[StoredConnection]:
        raise NotImplementedError

    def revoke(self, mcp_token: str, service: Optional[str] = None) -> int:
        """Drop the tenant's tokens for one service (or all). Returns count removed."""
        raise NotImplementedError


class InMemoryTokenStore(TokenStore):
    def __init__(self) -> None:
        # { tenant_hash: { service: StoredConnection } }
        self._data: Dict[str, Dict[str, StoredConnection]] = {}
        self._lock = threading.Lock()

    def put(self, mcp_token: str, conn: StoredConnection) -> None:
        h = _hash_tenant(mcp_token)
        with self._lock:
            self._data.setdefault(h, {})[conn.service] = conn

    def get(self, mcp_token: str, service: str) -> Optional[StoredConnection]:
        h = _hash_tenant(mcp_token)
        with self._lock:
            return self._data.get(h, {}).get(service)

    def list_services(self, mcp_token: str) -> List[StoredConnection]:
        h = _hash_tenant(mcp_token)
        with self._lock:
            return list(self._data.get(h, {}).values())

    def revoke(self, mcp_token: str, service: Optional[str] = None) -> int:
        h = _hash_tenant(mcp_token)
        with self._lock:
            bucket = self._data.get(h)
            if not bucket:
                return 0
            if service is None:
                n = len(bucket)
                self._data.pop(h, None)
                return n
            if service in bucket:
                del bucket[service]
                return 1
            return 0


class SqliteTokenStore(TokenStore):
    """Default backend: file-backed SQLite under a data dir. Tenant column is the
    sha256 of the MCP token; token material is never logged."""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            data_dir = os.getenv("CALLISTHENES_DATA_DIR", "/data")
            db_path = os.path.join(data_dir, "callisthenes-auth.sqlite")
        self.db_path = db_path
        if db_path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self._lock = threading.Lock()
        # check_same_thread=False + our own lock: single-writer discipline.
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS connections (
                tenant_hash TEXT NOT NULL,
                service     TEXT NOT NULL,
                payload     TEXT NOT NULL,
                PRIMARY KEY (tenant_hash, service)
            )
            """
        )
        self._conn.commit()

    def put(self, mcp_token: str, conn: StoredConnection) -> None:
        h = _hash_tenant(mcp_token)
        payload = json.dumps(asdict(conn))
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO connections (tenant_hash, service, payload) VALUES (?,?,?)",
                (h, conn.service, payload),
            )
            self._conn.commit()

    def get(self, mcp_token: str, service: str) -> Optional[StoredConnection]:
        h = _hash_tenant(mcp_token)
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM connections WHERE tenant_hash=? AND service=?",
                (h, service),
            ).fetchone()
        if not row:
            return None
        return StoredConnection(**json.loads(row[0]))

    def list_services(self, mcp_token: str) -> List[StoredConnection]:
        h = _hash_tenant(mcp_token)
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM connections WHERE tenant_hash=?", (h,)
            ).fetchall()
        return [StoredConnection(**json.loads(r[0])) for r in rows]

    def revoke(self, mcp_token: str, service: Optional[str] = None) -> int:
        h = _hash_tenant(mcp_token)
        with self._lock:
            if service is None:
                cur = self._conn.execute(
                    "DELETE FROM connections WHERE tenant_hash=?", (h,)
                )
            else:
                cur = self._conn.execute(
                    "DELETE FROM connections WHERE tenant_hash=? AND service=?",
                    (h, service),
                )
            self._conn.commit()
            return cur.rowcount


def default_store() -> TokenStore:
    """Pick a backend from env. In-memory when explicitly requested (tests/CI)."""
    if os.getenv("CALLISTHENES_TOKEN_STORE", "").lower() in ("memory", "inmemory"):
        return InMemoryTokenStore()
    return SqliteTokenStore()
