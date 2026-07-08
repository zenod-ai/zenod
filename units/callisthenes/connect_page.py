"""C-7 — the minimal hosted connect-UI for a provisioned Callisthenes instance.

EPIC-2.4 D-C (settled 2026-07-08, Jordi): hosted instances get ONE connect screen —
the distinction of the hosted tier (self-host stays CLI/headless). This is NOT a
dashboard. It is the smallest surface that:

    1. Connect X   -> starts C-2R's OAuth 2.0 PKCE authorize flow (canonical x.com
                      authorize URL) and IS the /oauth/callback landing that
                      exchanges the returned code via the C-2R contract.
    2. Connect each outbound platform -> Reddit today (paste the Composio token,
                      stored under service="reddit" for the C-8 connector to read),
                      Instagram/email later as data-driven connector rows.
    3. Show the MCP URL + access token -> with copy buttons + a one-line "paste this
                      into your MCP client".

WHY MOUNT ON THE EXISTING SERVER (not a sidecar): FastMCP's `mcp.run(transport=
"http")` serves a Starlette app, and FastMCP exposes `@mcp.custom_route(path,
methods)` to add plain Starlette routes to that same app. So the connect page is a
handful of routes on the ONE container/port the unit already exposes — no second
process, no second port, no reverse-proxy wiring. Least-invasive by construction.

TENANT IDENTITY (single-owner hosted instance): a hosted Callisthenes is provisioned
per user (instance-per-user — the container-local token store IS that user's), so
the browser page acts as that one owner. The owner tenant key is injected by the
cloud provisioner via env (CALLISTHENES_OWNER_TENANT / MCP_BEARER_TOKEN), the SAME
value auth._default_tenant_resolver falls back to. The page therefore shares the
per-tenant PKCE pending-state and token store with the MCP `connect`/`complete_connect`
tools (same ChatAuth engine instance, injected by callisthenes_server).

CLOUD SEAM (documented, exact — see ## CLOUD SEAM in README): the provisioner injects
    CALLISTHENES_MCP_URL     -> the instance's public MCP endpoint (shown on the page)
    CALLISTHENES_MCP_TOKEN   -> the access token the user pastes into their MCP client
    CALLISTHENES_OWNER_TENANT-> the tenant key the page/tools key off (usually == token)
When these are absent (bare unit / self-host), the page still renders and clearly
flags what the provisioner would supply — nothing is faked.

Security (BINDING, EPIC-2.4 §chat-auth): the Connect-X button redirects to a CANONICAL
x.com authorize URL only (the URL is produced by C-2R's `authorize()`, which is
anti-phishing guarded). No secret material is ever written to logs.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


# --------------------------------------------------------------------------- #
# Connector abstraction — connectors are DATA, not hardcoded branches. Adding
# Instagram/email later is one row in default_connectors() (or a `connectors=`
# arg to register()); the routes + rendering are generic over `kind`.
# --------------------------------------------------------------------------- #

KIND_OAUTH2 = "oauth2"   # click Authorize -> redirect -> callback exchanges the code
KIND_TOKEN = "token"     # paste a token/id -> stored under `service` in the token store


@dataclass
class Connector:
    """One outbound platform the user can connect from the page.

    `kind` drives the UI + wiring:
      - oauth2: a "Connect" button -> /connect/<id>/start -> engine.connect(service)
                -> redirect to the canonical authorize URL; the /oauth/callback route
                completes it. (`service` must be in the auth engine's SUPPORTED_SERVICES.)
      - token:  a text field + "Save" -> /connect/<id>/token -> stores the pasted value
                as StoredConnection(service=<service>, access_token=<value>) for the
                connector (e.g. C-8 Reddit reads the Composio user id from there).
    """

    id: str
    label: str
    kind: str
    tagline: str = ""
    token_hint: str = ""          # placeholder text for a token-kind field
    token_env_name: str = ""      # forgive a pasted `NAME=value` env line for this field
    service: str = ""             # token-store service key; defaults to `id`

    def __post_init__(self) -> None:
        if not self.service:
            self.service = self.id


def default_connectors() -> List[Connector]:
    """The default set: X (OAuth2) + Reddit (Composio token). Order = display order."""
    return [
        Connector(
            id="x",
            label="X (Twitter)",
            kind=KIND_OAUTH2,
            tagline="Post, delete, media — the full self-hosted toolkit.",
            service="x",
        ),
        Connector(
            id="reddit",
            label="Reddit",
            kind=KIND_TOKEN,
            tagline="Submit posts via Composio.",
            token_hint="Composio user id / connection token",
            token_env_name="COMPOSIO_USER_ID",
            service="reddit",
        ),
        # Add later, no code change beyond the row, e.g.:
        # Connector("instagram", "Instagram", KIND_TOKEN, token_hint="Access token"),
        # Connector("email", "Email", KIND_TOKEN, token_hint="SMTP token"),
    ]


# --------------------------------------------------------------------------- #
# Config injected by the cloud provisioner (env), with honest fallbacks.
# --------------------------------------------------------------------------- #

@dataclass
class ConnectPageConfig:
    mcp_url: Optional[str] = None
    mcp_token: Optional[str] = None
    owner_tenant: Optional[str] = None

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "ConnectPageConfig":
        env = os.environ if env is None else env
        token = (
            env.get("CALLISTHENES_MCP_TOKEN")
            or env.get("CALLISTHENES_OWNER_TENANT")
            or env.get("MCP_BEARER_TOKEN")
        )
        owner = (
            env.get("CALLISTHENES_OWNER_TENANT")
            or env.get("MCP_BEARER_TOKEN")
            or token
        )
        return cls(
            mcp_url=env.get("CALLISTHENES_MCP_URL"),
            mcp_token=token or None,
            owner_tenant=owner or None,
        )


# --------------------------------------------------------------------------- #
# The page controller — pure(ish) logic, HTTP-framework-agnostic so it is unit
# testable without booting a server. The Starlette wiring lives in register().
# --------------------------------------------------------------------------- #

class ConnectPage:
    """Holds the connector list + the shared ChatAuth engine + config. Renders the
    page and drives the connect actions. `engine` is the SAME ChatAuth instance the
    MCP auth tools use, so pending PKCE state + the token store are shared."""

    def __init__(
        self,
        engine: Any,
        connectors: Optional[List[Connector]] = None,
        config: Optional[ConnectPageConfig] = None,
    ):
        self.engine = engine
        self.connectors = connectors if connectors is not None else default_connectors()
        self.config = config or ConnectPageConfig.from_env()

    # -- tenant identity (single-owner hosted instance) ------------------------
    def tenant(self) -> Optional[str]:
        """The owner tenant this instance serves. Injected by the provisioner; falls
        back to the auth env keys so the page and the MCP tools agree on identity."""
        return self.config.owner_tenant or (
            os.getenv("CALLISTHENES_OWNER_TENANT") or os.getenv("MCP_BEARER_TOKEN")
        )

    # -- connection status (generic over connector kind) -----------------------
    def _status_for(self, c: Connector, tenant: str) -> Dict[str, Any]:
        try:
            conn = self.engine.store.get(tenant, c.service)
        except Exception:  # noqa: BLE001 — a store hiccup shows "unknown", never crashes the page
            return {"connected": False, "detail": "status unavailable"}
        if conn is None:
            return {"connected": False}
        screen = getattr(conn, "screen_name", None)
        if c.kind == KIND_OAUTH2 and screen:
            detail = f"@{screen}"
        elif c.kind == KIND_OAUTH2:
            detail = "authorized"
        else:
            detail = "token stored"
        return {"connected": True, "detail": detail}

    # -- action: start an OAuth2 connect (returns the authorize URL) -----------
    def start_oauth(self, connector_id: str) -> Dict[str, Any]:
        c = self._connector(connector_id)
        if c is None or c.kind != KIND_OAUTH2:
            return {"ok": False, "error": f"'{connector_id}' is not an OAuth connector."}
        tenant = self.tenant()
        if not tenant:
            return {"ok": False, "error": "no owner tenant configured (provisioner seam)."}
        # engine.connect returns {ok, authorize_url, ...} or an error envelope.
        return self.engine.connect(tenant, c.service)

    # -- action: OAuth2 callback (exchange the code) ---------------------------
    def complete_oauth(self, code: str, state: str, service: str = "x") -> Dict[str, Any]:
        tenant = self.tenant()
        if not tenant:
            return {"ok": False, "error": "no owner tenant configured (provisioner seam)."}
        try:
            return self.engine.complete_connect(tenant, code, state, service)
        except Exception as e:  # noqa: BLE001 — surface loudly on the page, never fake success
            code_attr = getattr(e, "code", "unavailable")
            msg = getattr(e, "message", str(e))
            return {"ok": False, "error": {"code": code_attr, "message": msg}}

    # -- action: save a token-kind connector's value ---------------------------
    def save_token(self, connector_id: str, value: str) -> Dict[str, Any]:
        c = self._connector(connector_id)
        if c is None or c.kind != KIND_TOKEN:
            return {"ok": False, "error": f"'{connector_id}' is not a token connector."}
        tenant = self.tenant()
        if not tenant:
            return {"ok": False, "error": "no owner tenant configured (provisioner seam)."}
        # Forgive a value pasted as a whole `NAME=value` env line (mirrors C-8).
        cleaned = self._normalize(value, c.token_env_name)
        if not cleaned:
            return {"ok": False, "error": "empty value — nothing to save."}
        conn = self._make_stored_connection(c.service, cleaned)
        self.engine.store.put(tenant, conn)
        return {"ok": True, "service": c.service, "connected": True}

    # -- helpers ---------------------------------------------------------------
    def _connector(self, connector_id: str) -> Optional[Connector]:
        for c in self.connectors:
            if c.id == connector_id:
                return c
        return None

    @staticmethod
    def _normalize(value: str, env_name: str) -> str:
        try:
            from reddit_connector import normalize_composio_value  # reuse the C-8 hygiene
        except Exception:  # noqa: BLE001 — connect page must not hard-depend on C-8
            return (value or "").strip().strip("\"'").strip()
        return normalize_composio_value(value, env_name or "TOKEN") or ""

    @staticmethod
    def _make_stored_connection(service: str, value: str) -> Any:
        import time

        try:
            from auth.token_store import StoredConnection
        except Exception:  # pragma: no cover - top-level import path (tests)
            from token_store import StoredConnection  # type: ignore
        # The C-8 connector reads the Composio user id from `access_token`.
        return StoredConnection(
            service=service,
            access_token=value,
            connected_at=time.time(),
            auth_flow="composio_token",
        )

    # -- rendering -------------------------------------------------------------
    def render_page(self, flash: Optional[str] = None, flash_kind: str = "info") -> str:
        tenant = self.tenant()
        rows = []
        for c in self.connectors:
            status = self._status_for(c, tenant) if tenant else {"connected": False}
            rows.append(_render_connector_row(c, status))
        return _PAGE_TEMPLATE.format(
            rows="\n".join(rows),
            mcp_block=_render_mcp_block(self.config),
            flash=_render_flash(flash, flash_kind),
        )

    def render_callback(self, result: Dict[str, Any]) -> str:
        ok = bool(result.get("ok"))
        if ok:
            svc = html.escape(str(result.get("service", "the platform")))
            handle = result.get("screen_name") or result.get("handle")
            who = f" as @{html.escape(str(handle))}" if handle else ""
            body = (
                f'<div class="result ok"><h1>Connected ✓</h1>'
                f"<p>{svc.upper()} connected{who}. Your agents can now send through this instance.</p>"
                f'<a class="btn" href="/connect">Back to connect</a></div>'
            )
        else:
            err = result.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("code") or "connection failed"
            else:
                msg = err or "connection failed"
            body = (
                f'<div class="result err"><h1>Connection failed</h1>'
                f"<p>{html.escape(str(msg))}</p>"
                f"<p>Nothing was connected. Try Connect again from the start.</p>"
                f'<a class="btn" href="/connect">Back to connect</a></div>'
            )
        return _CALLBACK_TEMPLATE.format(body=body)


# --------------------------------------------------------------------------- #
# HTML rendering (tiny, inline CSS/JS — self-contained, no external assets).
# --------------------------------------------------------------------------- #

def _render_flash(flash: Optional[str], kind: str) -> str:
    if not flash:
        return ""
    return f'<div class="flash {html.escape(kind)}">{html.escape(flash)}</div>'


def _render_connector_row(c: Connector, status: Dict[str, Any]) -> str:
    connected = status.get("connected")
    detail = status.get("detail")
    badge = (
        f'<span class="badge on">connected{(" · " + html.escape(str(detail))) if detail else ""}</span>'
        if connected
        else '<span class="badge off">not connected</span>'
    )
    if c.kind == KIND_OAUTH2:
        action = (
            f'<a class="btn primary" href="/connect/{html.escape(c.id)}/start">'
            f'{"Reconnect" if connected else "Connect"} {html.escape(c.label)}</a>'
        )
    else:  # token
        action = (
            f'<form method="post" action="/connect/{html.escape(c.id)}/token" class="tokform">'
            f'<input type="text" name="token" placeholder="{html.escape(c.token_hint or "token")}" autocomplete="off" spellcheck="false" />'
            f'<button class="btn" type="submit">{"Update" if connected else "Save"}</button>'
            f"</form>"
        )
    return (
        f'<div class="connector" data-id="{html.escape(c.id)}">'
        f'<div class="crow"><div class="cmeta"><div class="clabel">{html.escape(c.label)} {badge}</div>'
        f'<div class="ctag">{html.escape(c.tagline)}</div></div>'
        f'<div class="cact">{action}</div></div></div>'
    )


def _render_mcp_block(cfg: ConnectPageConfig) -> str:
    url_field = (
        _copy_field("MCP URL", cfg.mcp_url)
        if cfg.mcp_url
        else '<div class="seam">MCP URL not injected yet — the provisioner sets '
        "<code>CALLISTHENES_MCP_URL</code>.</div>"
    )
    token_field = (
        _copy_field("Access token", cfg.mcp_token, secret=True)
        if cfg.mcp_token
        else '<div class="seam">Access token not injected yet — the provisioner sets '
        "<code>CALLISTHENES_MCP_TOKEN</code>.</div>"
    )
    return (
        '<div class="mcp">'
        "<h2>Point your agents here</h2>"
        '<p class="hint">Paste this into your MCP client (Claude, Cursor, the ring) '
        "— one always-on mouth for every agent.</p>"
        f"{url_field}{token_field}"
        "</div>"
    )


def _copy_field(label: str, value: str, secret: bool = False) -> str:
    v = html.escape(value)
    return (
        f'<div class="field"><label>{html.escape(label)}</label>'
        f'<div class="copyrow"><input class="mono" type="text" readonly '
        f'value="{v}" data-secret="{"1" if secret else "0"}" />'
        f'<button class="btn copy" type="button" onclick="copyNear(this)">Copy</button></div></div>'
    )


_PAGE_TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect · Callisthenes</title>
<style>
:root{{color-scheme:light dark}}
*{{box-sizing:border-box}}
body{{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
margin:0;background:#0f1115;color:#e8e8ea;display:flex;justify-content:center}}
.wrap{{width:100%;max-width:640px;padding:32px 20px 64px}}
h1.title{{font-size:22px;margin:0 0 2px}} .sub{{color:#9aa0a6;margin:0 0 24px;font-size:13px}}
.connector{{background:#171a21;border:1px solid #262b35;border-radius:12px;padding:14px 16px;margin:10px 0}}
.crow{{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}}
.clabel{{font-weight:600}} .ctag{{color:#9aa0a6;font-size:13px;margin-top:2px}}
.badge{{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}}
.badge.on{{background:#123524;color:#4ade80}} .badge.off{{background:#2a2140;color:#c4b5fd}}
.btn{{display:inline-block;background:#262b35;color:#e8e8ea;border:1px solid #333a46;border-radius:8px;
padding:8px 14px;font-size:14px;cursor:pointer;text-decoration:none}}
.btn.primary{{background:#1d9bf0;border-color:#1d9bf0;color:#fff}}
.tokform{{display:flex;gap:8px}} .tokform input{{flex:1;min-width:160px;background:#0f1115;border:1px solid #333a46;
border-radius:8px;color:#e8e8ea;padding:8px 10px}}
.mcp{{margin-top:28px;background:#12151b;border:1px solid #262b35;border-radius:12px;padding:16px}}
.mcp h2{{font-size:16px;margin:0 0 4px}} .hint{{color:#9aa0a6;font-size:13px;margin:0 0 12px}}
.field{{margin:10px 0}} .field label{{display:block;font-size:12px;color:#9aa0a6;margin-bottom:4px}}
.copyrow{{display:flex;gap:8px}} .copyrow input{{flex:1;background:#0f1115;border:1px solid #333a46;
border-radius:8px;color:#e8e8ea;padding:8px 10px}}
.mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}}
.seam{{background:#1a1526;border:1px dashed #4c3f6b;border-radius:8px;padding:10px 12px;color:#c4b5fd;font-size:13px;margin:8px 0}}
.seam code{{color:#e9d5ff}}
.flash{{border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:14px}}
.flash.info{{background:#12233a;color:#93c5fd}} .flash.ok{{background:#123524;color:#4ade80}}
.flash.err{{background:#3a1220;color:#fca5a5}}
</style></head>
<body><div class="wrap">
<h1 class="title">Callisthenes</h1>
<p class="sub">One mouth for all your agents. Authorize each platform once — every agent sends through here.</p>
{flash}
{rows}
{mcp_block}
</div>
<script>
function copyNear(btn){{
  var inp=btn.parentElement.querySelector('input');
  if(!inp) return;
  inp.select(); inp.setSelectionRange(0,99999);
  navigator.clipboard.writeText(inp.value).then(function(){{
    var t=btn.textContent; btn.textContent='Copied'; setTimeout(function(){{btn.textContent=t;}},1200);
  }});
}}
</script>
</body></html>"""


_CALLBACK_TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect · Callisthenes</title>
<style>
body{{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;
background:#0f1115;color:#e8e8ea;display:flex;justify-content:center;align-items:center;min-height:100vh}}
.result{{max-width:440px;padding:28px;text-align:center;background:#171a21;border:1px solid #262b35;border-radius:14px;margin:20px}}
.result h1{{font-size:20px;margin:0 0 8px}} .result.ok h1{{color:#4ade80}} .result.err h1{{color:#fca5a5}}
.result p{{color:#c4c8ce;font-size:14px}}
.btn{{display:inline-block;margin-top:12px;background:#1d9bf0;color:#fff;border-radius:8px;padding:8px 16px;text-decoration:none}}
</style></head><body>{body}</body></html>"""


# --------------------------------------------------------------------------- #
# Starlette wiring — mount the routes on the FastMCP http app via custom_route.
# --------------------------------------------------------------------------- #

def register(
    mcp: Any,
    engine: Any = None,
    connectors: Optional[List[Connector]] = None,
    config: Optional[ConnectPageConfig] = None,
) -> ConnectPage:
    """Mount the connect page on the FastMCP app.

    `engine` MUST be the SAME ChatAuth instance passed to auth.register(engine=...)
    so the page shares the pending PKCE state + token store with the MCP tools. If
    None, a fresh ChatAuth is built (routes still work, but the MCP `connect` tool
    and the page would then not share pending state — callisthenes_server wires the
    shared engine, so this fallback is for tests only).

    Routes (all on the unit's single port):
        GET  /connect                      -> the one connect screen
        GET  /connect/<id>/start           -> begin OAuth2 -> 302 to canonical authorize URL
        GET  /oauth/callback?code&state    -> exchange the code, show "connected"
        POST /connect/<id>/token           -> store a token-kind connector's value
    """
    if engine is None:
        try:
            from auth import ChatAuth  # type: ignore
        except Exception:  # pragma: no cover
            from __init__ import ChatAuth  # type: ignore
        engine = ChatAuth()

    page = ConnectPage(engine=engine, connectors=connectors, config=config)

    custom_route = getattr(mcp, "custom_route", None)
    if not callable(custom_route):
        # No Starlette surface (e.g. a plain-registry test double). Attach the page
        # so tests can still drive its methods; routes simply aren't mounted.
        setattr(mcp, "_connect_page", page)
        return page

    from starlette.requests import Request
    from starlette.responses import HTMLResponse, RedirectResponse

    @custom_route("/connect", methods=["GET"])
    async def _connect_index(request: "Request") -> HTMLResponse:  # noqa: ANN001
        return HTMLResponse(page.render_page())

    @custom_route("/connect/{connector_id}/start", methods=["GET"])
    async def _connect_start(request: "Request") -> Any:  # noqa: ANN001
        cid = request.path_params["connector_id"]
        result = page.start_oauth(cid)
        if result.get("ok") and result.get("authorize_url"):
            return RedirectResponse(result["authorize_url"], status_code=302)
        err = result.get("error")
        msg = err.get("message") if isinstance(err, dict) else (err or "could not start")
        return HTMLResponse(page.render_page(flash=str(msg), flash_kind="err"), status_code=400)

    @custom_route("/oauth/callback", methods=["GET"])
    async def _oauth_callback(request: "Request") -> HTMLResponse:  # noqa: ANN001
        qp = request.query_params
        error = qp.get("error")
        if error:
            desc = qp.get("error_description") or error
            return HTMLResponse(
                page.render_callback({"ok": False, "error": {"code": error, "message": desc}}),
                status_code=400,
            )
        result = page.complete_oauth(qp.get("code", ""), qp.get("state", ""), qp.get("service", "x"))
        status = 200 if result.get("ok") else 400
        return HTMLResponse(page.render_callback(result), status_code=status)

    @custom_route("/connect/{connector_id}/token", methods=["POST"])
    async def _connect_token(request: "Request") -> Any:  # noqa: ANN001
        cid = request.path_params["connector_id"]
        form = await request.form()
        result = page.save_token(cid, str(form.get("token", "")))
        if result.get("ok"):
            return RedirectResponse("/connect", status_code=303)
        err = result.get("error")
        msg = err.get("message") if isinstance(err, dict) else (err or "could not save")
        return HTMLResponse(page.render_page(flash=str(msg), flash_kind="err"), status_code=400)

    setattr(mcp, "_connect_page", page)
    return page
