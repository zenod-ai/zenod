"""C-22 "drafts never send" guard for the Callisthenes unit.

Invariant enforced IN the unit: a raw post/create/delete operation must NOT
reach the X API unless it carries an explicit approval token. The intended flow
is draft -> human/operator approves -> approved send. A bare (unapproved) send
call is refused; nothing is emitted to the network.

How approval is expressed on the wire: the tool arguments must contain an
approval flag/token whose name is CALLISTHENES_APPROVE_ARG (default
"callisthenes_approve") set to a truthy value, OR — when a shared secret is
configured via CALLISTHENES_APPROVE_TOKEN — a matching token value. Absent that,
the guard blocks the send. The approval arg is stripped before the call is
forwarded so it never leaks to the upstream X request.

`DraftGuard` is pure-Python and unit-testable with NO network / NO fastmcp.
`build_draft_guard_middleware` is the thin FastMCP wrapper.
"""

from __future__ import annotations

import os
from typing import Iterable

DEFAULT_GUARDED_TOOLS = ("createPosts", "deletePosts", "mediaUpload")
DEFAULT_APPROVE_ARG = "callisthenes_approve"

_TRUTHY = {"1", "true", "yes", "on", "approve", "approved"}


class SendNotApproved(Exception):
    """Raised when a guarded send is attempted without valid approval."""


class DraftGuard:
    """Decides whether a guarded send may proceed.

    - If a shared `approve_token` is configured, the call is approved only when
      the approval arg equals that token exactly.
    - Otherwise the call is approved when the approval arg is truthy.
    An unguarded tool name is always allowed (returns cleaned args unchanged).
    """

    def __init__(
        self,
        guarded_tools: Iterable[str] = DEFAULT_GUARDED_TOOLS,
        approve_arg: str = DEFAULT_APPROVE_ARG,
        approve_token: str | None = None,
    ) -> None:
        self.guarded_tools = frozenset(guarded_tools)
        self.approve_arg = approve_arg
        self.approve_token = approve_token or None

    def is_guarded(self, tool_name: str) -> bool:
        return tool_name in self.guarded_tools

    def _approved(self, value) -> bool:
        if value is None:
            return False
        if self.approve_token is not None:
            return str(value) == self.approve_token
        return str(value).strip().lower() in _TRUTHY

    def check(self, tool_name: str, arguments: dict | None) -> dict:
        """Return the arguments to forward (approval arg stripped) if allowed.

        Raises SendNotApproved for a guarded tool without valid approval. For a
        non-guarded tool, returns the arguments unchanged.
        """
        args = dict(arguments or {})
        if not self.is_guarded(tool_name):
            return args
        value = args.pop(self.approve_arg, None)
        if not self._approved(value):
            raise SendNotApproved(
                f"callisthenes draft-guard: '{tool_name}' is a send and was not "
                f"approved. Drafts never send: re-issue with '{self.approve_arg}' "
                f"set to approve the send."
            )
        return args


def _env_token(env: dict | None) -> str | None:
    env = os.environ if env is None else env
    token = env.get("CALLISTHENES_APPROVE_TOKEN", "").strip()
    return token or None


def _env_guarded(env: dict | None) -> frozenset[str]:
    env = os.environ if env is None else env
    raw = env.get("CALLISTHENES_GUARDED_TOOLS", "").strip()
    if not raw:
        return frozenset(DEFAULT_GUARDED_TOOLS)
    return frozenset(t.strip() for t in raw.split(",") if t.strip())


def _env_approve_arg(env: dict | None) -> str:
    env = os.environ if env is None else env
    return env.get("CALLISTHENES_APPROVE_ARG", "").strip() or DEFAULT_APPROVE_ARG


def guard_from_env(env: dict | None = None) -> DraftGuard:
    return DraftGuard(
        guarded_tools=_env_guarded(env),
        approve_arg=_env_approve_arg(env),
        approve_token=_env_token(env),
    )


def build_draft_guard_middleware(guard: DraftGuard | None = None):
    """Construct the FastMCP draft-guard middleware. fastmcp imported lazily."""
    from fastmcp.server.middleware import Middleware  # noqa: WPS433
    from fastmcp.exceptions import ToolError  # noqa: WPS433

    guard = guard or guard_from_env()

    class DraftGuardMiddleware(Middleware):
        async def on_call_tool(self, context, call_next):
            name = getattr(context.message, "name", None)
            if name is not None and guard.is_guarded(name):
                args = getattr(context.message, "arguments", None)
                try:
                    cleaned = guard.check(name, args)
                except SendNotApproved as exc:
                    # Stable machine-checkable code prefix (SEAM-SPEC §5, item 15).
                    raise ToolError(f"[draft_not_approved] {exc}")
                # Forward with the approval arg stripped so it never leaks to X.
                context = context.copy(
                    message=context.message.model_copy(update={"arguments": cleaned})
                )
            return await call_next(context)

    return DraftGuardMiddleware()
