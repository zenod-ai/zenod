"""C-8 — Reddit send connector for the Callisthenes unit, backed by Composio.

WHY COMPOSIO (not a self-hosted reddit-mcp): Reddit's developer-app creation is
gated, so — exactly like the suite already does for the Outbound agent (see
packages/server/src/outboundTools.ts, issue #420) — we reach Reddit through
Composio's hosted toolkit. Composio holds the per-tenant OAuth connection to the
user's Reddit account (a Composio "user id") and executes tools on their behalf.
This module is the Python port of that proven plumbing, wired INTO this unit so
the send passes through the SAME in-unit guardrails as X:

    draft_guard (C-22)  -> refuse an unapproved send before it reaches the network
    throttle            -> cap approved sends per rolling hour
    receipt profile     -> the tool result carries the submitted post's PERMALINK,
                           or fails loudly. Never a silent / fabricated success.

The guardrails are enforced by the unit's existing FastMCP middleware, which match
on the tool NAME. So `post_reddit` only has to be listed in CALLISTHENES_SEND_TOOLS
+ CALLISTHENES_GUARDED_TOOLS (defaulted in for you) and it is guarded automatically,
identically to createPosts/deletePosts. The middleware strips the approval arg before
the tool runs, so this tool never sees `callisthenes_approve`.

SEAMS (so tests have NO network):
  - The Composio HTTP call is behind an injectable `executor(slug, args) -> str`.
    The default executor uses `requests`; tests inject a fake and assert on the
    receipt shape, the guarded-refuse, and token custody with zero I/O.
  - The per-tenant Reddit token is READ (read-only) from the same custody store as
    X (auth/token_store.py, sha256-keyed unit-local SQLite) under service="reddit".
    See ## OPEN SEAM below: writing that token needs an auth/ change (auth/ is the
    parallel worker's lane), so single-owner env (COMPOSIO_USER_ID) is the live
    path today and the store read is wired-and-ready for when the writer lands.

Secrets (the Composio API key, the tenant's Composio user id) are NEVER logged and
never appear in a tool result.
"""

from __future__ import annotations

import inspect
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

REDDIT_SERVICE = "reddit"
REDDIT_CREATE_SLUG = "REDDIT_CREATE_REDDIT_POST"
COMPOSIO_BASE_DEFAULT = "https://backend.composio.dev"
RESULT_CAP = 6000

# Env knobs (mirror the X_* / COMPOSIO_* conventions used elsewhere in the repo).
COMPOSIO_API_KEY_ENV = "COMPOSIO_API_KEY"
COMPOSIO_USER_ID_ENV = "COMPOSIO_USER_ID"
COMPOSIO_BASE_ENV = "COMPOSIO_BASE_URL"


class RedditSendError(Exception):
    """Loud, structured Reddit-send error (mirrors auth's {code, message} envelope)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def as_result(self) -> Dict[str, Any]:
        return {"ok": False, "channel": REDDIT_SERVICE, "error": {"code": self.code, "message": self.message}}


# --------------------------------------------------------------------------- #
# Value hygiene + receipt parsing — ported from outboundReceipt.ts (reddit path)
# --------------------------------------------------------------------------- #

_NOISE_PATTERNS = [
    re.compile(r"upgrade to (?:plus|premium|pro)\b[^.\n]*\.?", re.I),
    re.compile(r"\byou(?:'ve| have) reached your (?:monthly )?(?:usage )?(?:cap|limit|quota)\b[^.\n]*\.?", re.I),
    re.compile(r"\bcomposio\b", re.I),
    re.compile(r"\bopenrouter\b", re.I),
    re.compile(r"\bplease upgrade\b[^.\n]*\.?", re.I),
]


def scrub_vendor_noise(text: str) -> str:
    """Strip engine/vendor noise (incl. the word 'Composio') from user-facing text."""
    out = text or ""
    for pat in _NOISE_PATTERNS:
        out = pat.sub("", out)
    return re.sub(r"\s{2,}", " ", out).strip()


def normalize_composio_value(value: Optional[str], env_name: str) -> Optional[str]:
    """Forgive a value pasted as a whole env line: strip a `NAME=` prefix + quotes."""
    if not value:
        return None
    cleaned = value.strip()
    cleaned = re.sub(rf"^{re.escape(env_name)}\s*=\s*", "", cleaned, flags=re.I)
    cleaned = cleaned.strip().strip("\"'").strip()
    return cleaned or None


def _first_str(*vals: Any) -> Optional[str]:
    for v in vals:
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
    return None


def _deep_find_url(value: Any, matcher: re.Pattern) -> Optional[str]:
    if isinstance(value, str):
        return value.strip() if matcher.search(value) else None
    if isinstance(value, list):
        for item in value:
            hit = _deep_find_url(item, matcher)
            if hit:
                return hit
        return None
    if isinstance(value, dict):
        for v in value.values():
            hit = _deep_find_url(v, matcher)
            if hit:
                return hit
    return None


_FAILURE_STEMS = (
    "could not reach",
    "reported an error",
    "did not complete",
    "is not connected",
    "not connected yet",
)

_REDDIT_URL_RE = re.compile(r"reddit\.com/[^\s\"']+", re.I)


def _looks_like_failure(text: str) -> bool:
    t = text.lower()
    return any(stem in t for stem in _FAILURE_STEMS)


@dataclass
class RedditReceipt:
    """Verified Reddit send receipt (mirrors outboundReceipt.ts OutboundReceipt)."""

    verified: bool
    url: Optional[str] = None
    id: Optional[str] = None
    reason: Optional[str] = None

    def as_result(self) -> Dict[str, Any]:
        if self.verified:
            if self.url:
                message = f"Posted to Reddit. Live URL: {self.url}"
            elif self.id:
                message = f"Posted to Reddit. Confirmed id: {self.id}"
            else:  # pragma: no cover — verified always carries url or id
                message = "Posted to Reddit. The connector confirmed the send."
            return {
                "ok": True,
                "channel": REDDIT_SERVICE,
                "verified": True,
                "url": self.url,
                "id": self.id,
                "message": message,
            }
        reason = self.reason or "the send could not be verified"
        return {
            "ok": False,
            "channel": REDDIT_SERVICE,
            "verified": False,
            "message": f"FAILED to send to Reddit: {reason}. Do NOT tell the user it was sent.",
            "error": {"code": "send_unverified", "message": reason},
        }


def parse_reddit_receipt(raw: str) -> RedditReceipt:
    """Reduce a Composio response to a verified receipt: a real permalink/id, or FAILED.

    A receipt is `verified` ONLY when a real reddit.com permalink (or a post id) is
    recovered from the connector's OWN response — never guessed. This is the
    structural honesty guard: no permalink, no success.
    """
    text = (raw or "").strip()
    if not text or _looks_like_failure(text):
        return RedditReceipt(False, reason=scrub_vendor_noise(text) or "the connector returned no detail")

    parsed: Optional[dict] = None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            parsed = obj
    except (ValueError, TypeError):
        parsed = None

    # A `successful: false` / error payload is a failure even with HTTP 200.
    if parsed is not None and (parsed.get("successful") is False or parsed.get("error")):
        detail = parsed.get("error") or parsed.get("data") or parsed
        reason = detail if isinstance(detail, str) else json.dumps(detail)
        return RedditReceipt(False, reason=scrub_vendor_noise(reason) or "the Reddit connector did not complete")

    data = parsed.get("data") if isinstance(parsed, dict) and isinstance(parsed.get("data"), dict) else parsed
    data = data or {}

    url = _first_str(data.get("url"), data.get("permalink"), data.get("post_url"))
    if not url:
        url = _deep_find_url(parsed if parsed is not None else text, _REDDIT_URL_RE)
    post_id = _first_str(data.get("id"), data.get("name"), data.get("post_id"))

    if url:
        return RedditReceipt(True, url=url, id=post_id)
    if post_id:  # a real id is proof enough even without a permalink
        return RedditReceipt(True, id=post_id)
    return RedditReceipt(False, reason=scrub_vendor_noise(text) or "the Reddit connector did not return a post url or id")


# --------------------------------------------------------------------------- #
# The connector
# --------------------------------------------------------------------------- #

# Executor seam: (slug, arguments, user_id) -> raw response text. Tests inject a fake.
Executor = Callable[[str, Dict[str, Any], str], str]


def _requests_executor(api_key: str, base_url: str) -> Executor:
    """Default executor: POST to Composio's tool-execute endpoint. `requests` is
    imported lazily so the pure receipt logic + tests need no network deps."""

    def execute(slug: str, arguments: Dict[str, Any], user_id: str) -> str:
        import requests  # noqa: WPS433 — lazy so tests importing this module need no network

        url = f"{base_url.rstrip('/')}/api/v3/tools/execute/{slug}"
        try:
            res = requests.post(
                url,
                headers={"x-api-key": api_key, "Content-Type": "application/json"},
                data=json.dumps({"user_id": user_id, "arguments": arguments}),
                timeout=30,
            )
        except Exception as e:  # noqa: BLE001 — never throw; a failure is a FAILED receipt
            return f"Could not reach the Reddit connector: {e}"
        body = res.text or ""
        if not res.ok:
            return f"The Reddit connector reported an error (HTTP {res.status_code}): {body[:500] or '(no detail)'}"
        return body[:RESULT_CAP]

    return execute


class RedditConnector:
    """Submits a Reddit post via Composio using a per-tenant Composio user id.

    All network I/O is behind `executor` so the connector is fully unit-testable.
    Token resolution order for the Composio user id (the tenant's connected Reddit
    account): explicit `user_id` arg -> per-tenant custody store (service="reddit")
    -> env COMPOSIO_USER_ID (single-owner dogfood). The Composio API key comes from
    env COMPOSIO_API_KEY (account-wide, never per-tenant).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_user_id: Optional[str] = None,
        base_url: Optional[str] = None,
        executor: Optional[Executor] = None,
        store: Any = None,
        env: Optional[Dict[str, str]] = None,
    ):
        env = os.environ if env is None else env
        self.api_key = normalize_composio_value(api_key or env.get(COMPOSIO_API_KEY_ENV), COMPOSIO_API_KEY_ENV)
        self.default_user_id = normalize_composio_value(
            default_user_id or env.get(COMPOSIO_USER_ID_ENV), COMPOSIO_USER_ID_ENV
        )
        self.base_url = base_url or env.get(COMPOSIO_BASE_ENV) or COMPOSIO_BASE_DEFAULT
        self._store = store  # optional TokenStore; read-only lookup of service="reddit"
        if executor is not None:
            self._executor = executor
        elif self.api_key:
            self._executor = _requests_executor(self.api_key, self.base_url)
        else:
            self._executor = None  # unconfigured; resolve_user_id / submit fail loudly

    # -- token custody (READ-ONLY) --------------------------------------------
    def resolve_user_id(self, mcp_token: Optional[str] = None, user_id: Optional[str] = None) -> Optional[str]:
        """Resolve the tenant's Composio user id from (in order): explicit arg, the
        per-tenant custody store (service='reddit'), then the single-owner env default.
        NB: this only READS the store — it never writes (see ## OPEN SEAM in module docs)."""
        if user_id:
            return user_id
        if mcp_token and self._store is not None:
            try:
                conn = self._store.get(mcp_token, REDDIT_SERVICE)
            except Exception:  # noqa: BLE001 — a store hiccup falls back to env, never crashes a send
                conn = None
            if conn is not None and getattr(conn, "access_token", None):
                return conn.access_token
        return self.default_user_id

    def is_configured(self) -> bool:
        return bool(self._executor is not None and (self.api_key or self._store is not None))

    # -- the send -------------------------------------------------------------
    def submit_post(
        self,
        subreddit: str,
        title: str,
        content: str = "",
        is_self: bool = True,
        flair_id: str = "",
        mcp_token: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Submit a Reddit post and return a verified receipt dict (permalink or FAILED).

        Raises RedditSendError only for caller/config errors (missing fields, no
        Composio user id / executor). A reachable-but-failed send returns a FAILED
        receipt dict, never a throw and never a fabricated permalink.
        """
        sub = re.sub(r"^/?r/", "", (subreddit or "").strip(), flags=re.I)
        title = (title or "").strip()
        if not sub or not title:
            raise RedditSendError("invalid_input", "Provide the target subreddit and the post title.")
        if self._executor is None:
            raise RedditSendError(
                "not_connected",
                f"Reddit is not connected: set {COMPOSIO_API_KEY_ENV} (and a Composio Reddit connection). "
                "Do NOT claim anything was sent.",
            )
        resolved_user = self.resolve_user_id(mcp_token=mcp_token, user_id=user_id)
        if not resolved_user:
            raise RedditSendError(
                "not_connected",
                f"No Reddit account connected for this tenant: set {COMPOSIO_USER_ID_ENV} "
                "or connect Reddit. Do NOT claim anything was sent.",
            )

        # Composio's REDDIT_CREATE_REDDIT_POST marks flair_id REQUIRED even where a
        # subreddit has no flair — send "" when none is given (verified on r/test).
        args: Dict[str, Any] = {
            "subreddit": sub,
            "title": title,
            "kind": "self" if is_self else "link",
            "flair_id": str(flair_id) if flair_id else "",
        }
        if is_self:
            args["text"] = content or ""
        else:
            args["url"] = content or ""

        raw = self._executor(REDDIT_CREATE_SLUG, args, resolved_user)
        return parse_reddit_receipt(raw).as_result()


# --------------------------------------------------------------------------- #
# MCP registration — expose post_reddit on the same endpoint via the wrapper.
# --------------------------------------------------------------------------- #

def build_reddit_tool(connector: RedditConnector) -> Callable[..., Dict[str, Any]]:
    """Build the `post_reddit` tool callable. Its args carry NO approval flag — the
    draft-guard middleware strips `callisthenes_approve` before this runs, exactly as
    it does for createPosts. The tool returns a verified receipt (permalink) or a loud
    FAILED result."""

    def post_reddit(
        subreddit: str,
        title: str,
        content: str = "",
        is_self: bool = True,
        flair_id: str = "",
    ) -> Dict[str, Any]:
        """Submit a post to Reddit (as the connected account). Pass the target
        subreddit (no r/ prefix), the title, and the content (body text for a self
        post, or the URL for a link post; set is_self=false for a link). This is a
        guarded SEND: it only fires with an approval flag and under the hourly cap.
        Returns the submitted post's live permalink on success, or a FAILED receipt."""
        try:
            return connector.submit_post(
                subreddit=subreddit,
                title=title,
                content=content,
                is_self=is_self,
                flair_id=flair_id,
            )
        except RedditSendError as e:
            return e.as_result()

    return post_reddit


def register(mcp: Any = None, connector: Optional[RedditConnector] = None, store: Any = None) -> RedditConnector:
    """Register the `post_reddit` send tool on `mcp`.

    Mirrors auth.register: supports FastMCP's `mcp.tool(name=...)` decorator and the
    `add_tool(fn, name=...)` shape, and falls back to a plain registry (attached at
    `connector.registry`) when `mcp` is None/unknown so tests can drive the tool.

    The tool is NAMED `post_reddit`; the unit's draft-guard + throttle middleware
    guard it by that name (defaulted into CALLISTHENES_SEND_TOOLS /
    CALLISTHENES_GUARDED_TOOLS), so the send passes the same gate as X.
    """
    if connector is None:
        if store is None:
            try:
                from auth.token_store import default_store  # read-only custody store

                store = default_store()
            except Exception:  # noqa: BLE001 — store optional; env single-owner path still works
                store = None
        connector = RedditConnector(store=store)

    tool = build_reddit_tool(connector)
    tool.__signature__ = inspect.signature(tool)  # type: ignore[attr-defined]
    tools = {"post_reddit": tool}

    if _register_on_mcp(mcp, tools) is None:
        reg = _PlainRegistry()
        for name, fn in tools.items():
            reg.add(name, fn)
        connector.registry = reg  # type: ignore[attr-defined]
    return connector


class _PlainRegistry:
    """Fallback registry when `mcp` is None/unknown: name -> callable (test seam)."""

    def __init__(self) -> None:
        self.tools: Dict[str, Callable[..., Any]] = {}

    def add(self, name: str, fn: Callable[..., Any]) -> None:
        self.tools[name] = fn


def _register_on_mcp(mcp: Any, tools: Dict[str, Callable[..., Any]]) -> Optional[str]:
    """Register defensively across MCP API shapes. Returns the API used, or None."""
    if mcp is None:
        return None
    tool_deco = getattr(mcp, "tool", None)
    if callable(tool_deco):
        for name, fn in tools.items():
            try:
                deco = tool_deco(name=name)
            except TypeError:
                deco = tool_deco()
            deco(fn)
        return "tool_decorator"
    add_tool = getattr(mcp, "add_tool", None)
    if callable(add_tool):
        for name, fn in tools.items():
            try:
                add_tool(fn, name=name)
            except TypeError:
                add_tool(fn)
        return "add_tool"
    return None
