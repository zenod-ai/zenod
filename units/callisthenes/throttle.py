"""Conservative send-rate limiter for the Callisthenes unit.

Enforced IN the unit (not delegated): a sliding-window limiter that caps how
many *send* (mutating post) operations happen per rolling hour. Default ON.

Design:
- `RateLimiter` is pure-Python and unit-testable with NO network and NO fastmcp
  import. It takes an injectable clock so tests are deterministic.
- `ThrottleMiddleware` is the thin FastMCP wrapper that maps a tool call onto
  the limiter. Importing it requires fastmcp; importing `RateLimiter` does not.

Config: env CALLISTHENES_THROTTLE_PER_HOUR (int, default 10). Set to 0 to make
every send blocked (fully closed); negative/unset falls back to the default.
The set of tool names treated as "sends" is CALLISTHENES_SEND_TOOLS
(comma-separated operationIds), default "createPosts,deletePosts,mediaUpload".
"""

from __future__ import annotations

import os
import time
from collections import deque
from threading import Lock
from typing import Callable, Deque, Dict, Iterable

DEFAULT_PER_HOUR = 10
DEFAULT_SEND_TOOLS = ("createPosts", "deletePosts", "mediaUpload", "post_reddit")
WINDOW_SECONDS = 3600.0


class ThrottleExceeded(Exception):
    """Raised (by the middleware) when a send would exceed the hourly cap."""


class RateLimiter:
    """Sliding-window rate limiter over a rolling `window_seconds` window.

    Pure logic, no I/O. `clock` defaults to time.monotonic but is injectable
    for deterministic tests.
    """

    def __init__(
        self,
        per_hour: int = DEFAULT_PER_HOUR,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.per_hour = int(per_hour)
        self.window_seconds = float(window_seconds)
        self._clock = clock
        self._events: Deque[float] = deque()
        self._lock = Lock()

    def _evict(self, now: float) -> None:
        horizon = now - self.window_seconds
        while self._events and self._events[0] <= horizon:
            self._events.popleft()

    def allow(self) -> bool:
        """Return True and record a send if under the cap; False otherwise.

        A cap of <= 0 blocks everything. This is atomic under a lock so the
        (N+1)th concurrent send cannot slip through.
        """
        with self._lock:
            now = self._clock()
            self._evict(now)
            if self.per_hour <= 0:
                return False
            if len(self._events) >= self.per_hour:
                return False
            self._events.append(now)
            return True

    def remaining(self) -> int:
        with self._lock:
            self._evict(self._clock())
            return max(0, self.per_hour - len(self._events))


class TenantRateLimiters:
    """One unchanged sliding-window limiter per authenticated tenant."""

    def __init__(
        self,
        per_hour: int = DEFAULT_PER_HOUR,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.per_hour = per_hour
        self.window_seconds = window_seconds
        self.clock = clock
        self._limiters: Dict[str, RateLimiter] = {}
        self._lock = Lock()

    def for_tenant(self, tenant: str) -> RateLimiter:
        if not tenant:
            raise ValueError("authenticated tenant is required for throttling")
        with self._lock:
            limiter = self._limiters.get(tenant)
            if limiter is None:
                limiter = RateLimiter(self.per_hour, self.window_seconds, self.clock)
                self._limiters[tenant] = limiter
            return limiter


def _parse_per_hour(raw: str | None) -> int:
    if raw is None or raw.strip() == "":
        return DEFAULT_PER_HOUR
    try:
        value = int(raw.strip())
    except ValueError:
        return DEFAULT_PER_HOUR
    return value if value >= 0 else DEFAULT_PER_HOUR


def _parse_send_tools(raw: str | None) -> frozenset[str]:
    if raw is None or raw.strip() == "":
        return frozenset(DEFAULT_SEND_TOOLS)
    return frozenset(t.strip() for t in raw.split(",") if t.strip())


def limiter_from_env(env: dict | None = None) -> RateLimiter:
    env = os.environ if env is None else env
    return RateLimiter(per_hour=_parse_per_hour(env.get("CALLISTHENES_THROTTLE_PER_HOUR")))


def send_tools_from_env(env: dict | None = None) -> frozenset[str]:
    env = os.environ if env is None else env
    return _parse_send_tools(env.get("CALLISTHENES_SEND_TOOLS"))


def build_throttle_middleware(
    limiter: RateLimiter | None = None,
    send_tools: Iterable[str] | None = None,
    tenant_resolver: Callable[[], str] | None = None,
):
    """Construct the FastMCP throttle middleware. Imports fastmcp lazily so the
    pure `RateLimiter` above stays importable in a network/fastmcp-free test.
    """
    from fastmcp.server.middleware import Middleware  # noqa: WPS433
    from fastmcp.exceptions import ToolError  # noqa: WPS433

    configured = limiter or limiter_from_env()
    tenant_limiters = TenantRateLimiters(per_hour=configured.per_hour)
    tools = frozenset(send_tools) if send_tools is not None else send_tools_from_env()

    if tenant_resolver is None:
        from auth import _default_tenant_resolver  # type: ignore

        tenant_resolver = _default_tenant_resolver

    class ThrottleMiddleware(Middleware):
        async def on_call_tool(self, context, call_next):
            name = getattr(context.message, "name", None)
            if name in tools:
                tenant_limiter = tenant_limiters.for_tenant(tenant_resolver())
                if not tenant_limiter.allow():
                    # Stable machine-checkable code prefix (SEAM-SPEC §5, item 15):
                    # ToolError carries only a message, so we prefix "[code] ".
                    raise ToolError(
                        f"[throttle_exceeded] callisthenes throttle: send rate "
                        f"limit reached ({tenant_limiter.per_hour}/hour). Refusing '{name}'. "
                        f"Try again later or raise CALLISTHENES_THROTTLE_PER_HOUR."
                    )
            return await call_next(context)

    return ThrottleMiddleware()
