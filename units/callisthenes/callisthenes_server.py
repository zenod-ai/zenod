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


def log(msg: str) -> None:
    print(f"[callisthenes] {msg}", file=sys.stderr, flush=True)


def build_app():
    """Build the upstream FastMCP app and install unit middleware + auth hook."""
    mcp = xmcp_server.create_mcp()

    # Order matters: draft-guard first (refuse unapproved sends before we spend a
    # throttle token), then throttle (cap approved sends per hour). Both are on by
    # default and configured from env inside their builders.
    mcp.add_middleware(build_draft_guard_middleware())
    mcp.add_middleware(build_throttle_middleware())
    log("installed middleware: draft-guard (C-22) + throttle")

    # SHARED CONTRACT with C-2 — auth package is optional at this stage.
    try:
        from auth import register as register_auth  # type: ignore

        register_auth(mcp)
        log("auth package registered")
    except Exception as e:  # noqa: BLE001 — optional; unit must still boot
        log(f"auth package not registered ({e!r}); booting single-owner headless")

    return mcp


def main() -> None:
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8000"))
    mcp = build_app()
    log(f"serving Streamable HTTP on {host}:{port}/mcp")
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
