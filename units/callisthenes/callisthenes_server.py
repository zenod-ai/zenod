"""Callisthenes unit entrypoint — a thin wrapper around upstream xmcp's FastMCP.

WHY A WRAPPER (not a patch): upstream server.py cleanly exposes `create_mcp()`,
which builds and returns the FastMCP app WITHOUT running it (only `main()` calls
`mcp.run()`). So we can `import server`, call `create_mcp()`, install the unit's
own middleware, register the optional auth package, and then run it ourselves.
No `git apply` against upstream's `main()` is required; the existing headless +
relax patches are applied at build time (see Dockerfile) and are untouched here.

The throttle + drafts-never-send controls are enforced IN THIS UNIT via FastMCP
middleware (throttle.py / draft_guard.py), not delegated to the runner or prompt.

SHARED AUTH CONTRACT (identical wording in the C-2 unit): after building the
`mcp` object we import `auth.register(mcp)`. The auth package (units/callisthenes/
auth/, owned by C-2) is OPTIONAL at this stage — if it is absent or raises, we
log and still boot, so the unit is usable for single-owner headless dogfood
before per-tenant PIN chat-auth lands.
"""

from __future__ import annotations

import os
import sys

# Upstream xmcp's server.py is on the path (same WORKDIR in the image). Import it
# for its create_mcp() factory. Both this module and server.py live at /opt/xmcp.
import server as xmcp_server  # upstream xdevplatform/xmcp, pinned + patched

from throttle import build_throttle_middleware
from draft_guard import build_draft_guard_middleware
from tenant_context import build_tenant_context_middleware, current_tenant


def log(msg: str) -> None:
    print(f"[callisthenes] {msg}", file=sys.stderr, flush=True)


def build_app():
    """Build the upstream FastMCP app and install unit middleware + auth hook."""
    mcp = xmcp_server.create_mcp()

    # Order matters: draft-guard first (refuse unapproved sends before we spend a
    # throttle token), then throttle (cap approved sends per hour). Both are on by
    # default and configured from env inside their builders.
    mcp.add_middleware(build_tenant_context_middleware())
    mcp.add_middleware(build_draft_guard_middleware())
    # Resolve from the request-local binding installed immediately above. Calling
    # the auth package's transport resolver from inside tool middleware can wait
    # on the same in-flight request; the ContextVar is already the authoritative
    # bearer identity at this point.
    mcp.add_middleware(build_throttle_middleware(tenant_resolver=current_tenant))
    log("installed middleware: tenant-context + draft-guard (C-22) + throttle")

    # SHARED CONTRACT with C-2 — auth package is optional at this stage.
    # We build ONE ChatAuth engine here and hand the SAME instance to both the MCP
    # auth tools (auth.register) and the C-7 hosted connect page (connect_page.register)
    # so they share the pending-PKCE state + the per-tenant token store: a Connect X
    # started from the page completes at the page's /oauth/callback, and a connection
    # made either way is visible to the other.
    auth_engine = None
    try:
        from auth import register as register_auth, ChatAuth  # type: ignore

        try:
            from auth.usage_reader import sqlite_usage_reader  # C-4a live ledger seam

            auth_engine = ChatAuth(usage_reader=sqlite_usage_reader())
        except Exception:  # noqa: BLE001 — usage reader optional; engine still valid
            auth_engine = ChatAuth()
        register_auth(mcp, engine=auth_engine)
        log("auth package registered")
    except Exception as e:  # noqa: BLE001 — optional; unit must still boot
        log(f"auth package not registered ({e!r}); booting single-owner headless")

    # C-7 — minimal hosted connect-UI. Mounts a one-screen connect page + the OAuth2
    # callback route on the SAME FastMCP http app (Starlette custom routes; no sidecar).
    # Optional at boot: absent/failed => the MCP tools + self-host CLI still work.
    try:
        from connect_page import register as register_connect_page  # type: ignore

        register_connect_page(mcp, engine=auth_engine)
        log("connect page mounted (/connect, /oauth/callback)")
    except Exception as e:  # noqa: BLE001 — optional; unit must still boot
        log(f"connect page not mounted ({e!r}); hosted connect-UI unavailable")

    # C-8 — Reddit send connector (Composio). Registers the `post_reddit` send tool
    # on the SAME endpoint; the draft-guard + throttle middleware guard it by name
    # (post_reddit is defaulted into CALLISTHENES_SEND_TOOLS/CALLISTHENES_GUARDED_TOOLS).
    # Optional at boot: if it can't register (missing deps), the unit still serves X.
    try:
        from reddit_connector import register as register_reddit  # type: ignore

        register_reddit(mcp)
        log("reddit connector registered (post_reddit)")
    except Exception as e:  # noqa: BLE001 — optional; unit must still boot
        log(f"reddit connector not registered ({e!r}); Reddit send unavailable")

    return mcp


def main() -> None:
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8000"))
    mcp = build_app()
    log(f"serving Streamable HTTP on {host}:{port}/mcp")
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
