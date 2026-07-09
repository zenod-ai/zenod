"""C-7 — the minimal hosted connect-UI for a provisioned Callisthenes instance.

EPIC-2.4 D-C (settled 2026-07-08, Jordi): hosted instances get ONE connect screen —
the distinction of the hosted tier (self-host stays CLI/headless). This is NOT a
dashboard. It is the smallest surface that:

    1. Connect X   -> accepts the three credentials from X's app-creation screen,
                      starts OAuth1 user authorization at a canonical X URL, and
                      exchanges the callback verifier for the hidden posting tokens.
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

Security (BINDING, EPIC-2.4 §chat-auth): authorization redirects to a canonical X
URL only. App credentials and generated posting tokens remain tenant-local and no
secret material is written to logs or rendered back into the page.
"""

from __future__ import annotations

import html
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional


# --------------------------------------------------------------------------- #
# Connector abstraction — connectors are DATA, not hardcoded branches. Adding
# Instagram/email later is one row in default_connectors() (or a `connectors=`
# arg to register()); the routes + rendering are generic over `kind`.
# --------------------------------------------------------------------------- #

KIND_OAUTH2 = "oauth2"   # click Authorize -> redirect -> callback exchanges the code
KIND_TOKEN = "token"     # paste a token/id -> stored under `service` in the token store

X_CONFIG_KEYS = (
    "X_OAUTH2_CLIENT_ID",
    "X_OAUTH2_CLIENT_SECRET",
    "X_OAUTH2_REDIRECT_URI",
    "X_OAUTH2_SCOPES",
    "X_OAUTH_CONSUMER_KEY",
    "X_OAUTH_CONSUMER_SECRET",
    "X_BEARER_TOKEN",
    "X_OAUTH_ACCESS_TOKEN",
    "X_OAUTH_ACCESS_TOKEN_SECRET",
)

X_OAUTH2_REQUIRED = ("X_OAUTH2_CLIENT_ID", "X_OAUTH2_REDIRECT_URI")
X_APP_REQUIRED = (
    "X_OAUTH_CONSUMER_KEY",
    "X_OAUTH_CONSUMER_SECRET",
    "X_BEARER_TOKEN",
)
X_SENDER_REQUIRED = (
    "X_OAUTH_CONSUMER_KEY",
    "X_OAUTH_CONSUMER_SECRET",
    "X_OAUTH_ACCESS_TOKEN",
    "X_OAUTH_ACCESS_TOKEN_SECRET",
)
X_CONFIG_METADATA_KEYS = ("X_VERIFIED_USER_ID", "X_VERIFIED_USERNAME")
X_CONFIG_INTERNAL_KEYS = ("X_PENDING_OAUTH_TOKEN", "X_PENDING_OAUTH_TOKEN_SECRET")
X_DEVELOPER_CONSOLE_URL = "https://console.x.com/"
X_CREDENTIALS_GUIDE_URL = "https://docs.x.com/x-api/getting-started/getting-access"

X_SETUP_FIELDS = (
    (
        "X_OAUTH_CONSUMER_KEY",
        "Consumer Key / API Key",
        "From the Application Created screen: Consumer Key.",
    ),
    (
        "X_OAUTH_CONSUMER_SECRET",
        "Secret Key / API Key Secret",
        "From the Application Created screen: Secret Key.",
    ),
    (
        "X_BEARER_TOKEN",
        "Bearer Token",
        "From the Application Created screen: Bearer Token.",
    ),
)


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
        x_verifier: Optional[Callable[[Dict[str, str]], Dict[str, Any]]] = None,
        x_oauth1_flow_factory: Optional[Callable[[str, str], Any]] = None,
    ):
        self.engine = engine
        self.connectors = connectors if connectors is not None else default_connectors()
        self.config = config or ConnectPageConfig.from_env()
        self.x_verifier = x_verifier or _verify_x_account
        self.x_oauth1_flow_factory = x_oauth1_flow_factory
        self.apply_x_runtime_config()

    # -- tenant identity (single-owner hosted instance) ------------------------
    def tenant(self) -> Optional[str]:
        """The owner tenant this instance serves. Injected by the provisioner; falls
        back to the auth env keys so the page and the MCP tools agree on identity."""
        return self.config.owner_tenant or (
            os.getenv("CALLISTHENES_OWNER_TENANT") or os.getenv("MCP_BEARER_TOKEN")
        )

    # -- tenant-local X app/runtime config ------------------------------------
    def apply_x_runtime_config(self) -> Dict[str, str]:
        """Load tenant-local X config from /data and apply it to this process.

        The connect page displays only set/missing status, but the shared ChatAuth
        engine needs the OAuth2 values in memory to build the authorize/exchange
        flow. Env stays the bootstrap source; the saved /data file lets a hosted
        tenant paste credentials after provisioning without rebuilding the image.
        """
        cfg = self.x_config()
        for key, value in cfg.items():
            if value:
                os.environ[key] = value
        if self.engine is not None:
            if "X_OAUTH2_CLIENT_ID" in cfg and hasattr(self.engine, "_client_id"):
                self.engine._client_id = cfg.get("X_OAUTH2_CLIENT_ID", "")  # noqa: SLF001
            if "X_OAUTH2_CLIENT_SECRET" in cfg and hasattr(self.engine, "_client_secret"):
                self.engine._client_secret = cfg.get("X_OAUTH2_CLIENT_SECRET", "")  # noqa: SLF001
            if "X_OAUTH2_REDIRECT_URI" in cfg and hasattr(self.engine, "_redirect_uri"):
                self.engine._redirect_uri = cfg.get("X_OAUTH2_REDIRECT_URI", "")  # noqa: SLF001
            if "X_OAUTH2_SCOPES" in cfg and hasattr(self.engine, "_scopes"):
                self.engine._scopes = cfg.get("X_OAUTH2_SCOPES", "")  # noqa: SLF001
        return cfg

    def x_config(self) -> Dict[str, str]:
        """Effective X config. Env provides defaults; /data overrides non-empty keys."""
        cfg = {key: os.getenv(key, "").strip() for key in X_CONFIG_KEYS if os.getenv(key, "").strip()}
        cfg.update(_read_x_config_file())
        return cfg

    def x_config_status(self) -> Dict[str, Any]:
        cfg = self.x_config()
        present = {key: bool(cfg.get(key)) for key in X_CONFIG_KEYS}
        missing_oauth2 = [key for key in X_OAUTH2_REQUIRED if not present.get(key)]
        missing_app = [key for key in X_APP_REQUIRED if not present.get(key)]
        missing_sender = [key for key in X_SENDER_REQUIRED if not present.get(key)]
        saved = _read_x_config_file(include_metadata=True, include_internal=True)
        return {
            "present": present,
            "oauth2_ready": not missing_oauth2,
            "missing_oauth2": missing_oauth2,
            "app_ready": not missing_app,
            "missing_app": missing_app,
            "sender_ready": not missing_sender,
            "missing_sender": missing_sender,
            "verified_user_id": saved.get("X_VERIFIED_USER_ID", ""),
            "verified_username": saved.get("X_VERIFIED_USERNAME", ""),
            "oauth1_pending": bool(saved.get("X_PENDING_OAUTH_TOKEN")),
            "callback_url": self.x_callback_url(),
            "redirect_uri": cfg.get("X_OAUTH2_REDIRECT_URI", ""),
            "config_path": str(_x_config_path()),
        }

    def x_callback_url(self) -> str:
        explicit = os.getenv("X_OAUTH1_CALLBACK_URL", "").strip()
        if explicit:
            return explicit
        mcp_url = str(self.config.mcp_url or "").rstrip("/")
        if mcp_url.endswith("/mcp"):
            return mcp_url[:-4] + "/oauth/callback"
        return (mcp_url + "/oauth/callback") if mcp_url else ""

    def save_x_config(self, values: Any) -> Dict[str, Any]:
        if isinstance(values, str):
            parsed = _parse_env_config(values)
        elif isinstance(values, Mapping):
            parsed = {
                key: str(values.get(key, "")).strip().strip("\"'").strip()
                for key in X_SENDER_REQUIRED
                if str(values.get(key, "")).strip().strip("\"'").strip()
            }
        else:
            parsed = {}
        if not parsed:
            return {
                "ok": False,
                "error": "Enter at least one X credential to save.",
            }
        existing = _read_x_config_file()
        existing.update(parsed)
        for key in X_CONFIG_METADATA_KEYS:
            existing.pop(key, None)
        _write_x_config_file(existing)
        cfg = self.apply_x_runtime_config()
        missing = [key for key in X_SENDER_REQUIRED if not cfg.get(key)]
        return {
            "ok": True,
            "saved_keys": sorted(parsed),
            "sender_ready": not missing,
            "missing_sender": missing,
        }

    def save_x_app_config(self, values: Mapping[str, Any]) -> Dict[str, Any]:
        parsed = {
            key: str(values.get(key, "")).strip().strip("\"'").strip()
            for key in X_APP_REQUIRED
            if str(values.get(key, "")).strip().strip("\"'").strip()
        }
        existing = _read_x_config_file(include_metadata=True, include_internal=True)
        effective = self.x_config()
        effective.update(parsed)
        missing = [key for key in X_APP_REQUIRED if not effective.get(key)]
        if missing:
            return {
                "ok": False,
                "error": "Enter the three credentials shown by X before continuing.",
                "missing_app": missing,
            }
        if parsed:
            existing.update(parsed)
            for key in (
                "X_OAUTH_ACCESS_TOKEN",
                "X_OAUTH_ACCESS_TOKEN_SECRET",
                *X_CONFIG_METADATA_KEYS,
                *X_CONFIG_INTERNAL_KEYS,
            ):
                existing.pop(key, None)
            _write_x_config_file(existing)
            self.apply_x_runtime_config()
        return {"ok": True, "app_ready": True}

    def _x_oauth1_flow(self, cfg: Dict[str, str]) -> Any:
        if self.x_oauth1_flow_factory is not None:
            return self.x_oauth1_flow_factory(
                cfg.get("X_OAUTH_CONSUMER_KEY", ""),
                cfg.get("X_OAUTH_CONSUMER_SECRET", ""),
            )
        from auth.oauth1_pin import OAuth1PinFlow

        return OAuth1PinFlow(
            cfg.get("X_OAUTH_CONSUMER_KEY", ""),
            cfg.get("X_OAUTH_CONSUMER_SECRET", ""),
        )

    def start_x_oauth1(self) -> Dict[str, Any]:
        cfg = self.apply_x_runtime_config()
        missing = [key for key in X_APP_REQUIRED if not cfg.get(key)]
        callback_url = self.x_callback_url()
        if missing:
            return {"ok": False, "error": "Enter the three X app credentials first."}
        if not callback_url:
            return {"ok": False, "error": "The hosted X callback URL is not configured."}
        try:
            flow = self._x_oauth1_flow(cfg)
            request_token = flow.request_token(callback_url)
            authorize_url = flow.authorize_url(request_token.oauth_token)
        except Exception as exc:  # noqa: BLE001 - provider failures render on the page
            return {"ok": False, "error": getattr(exc, "message", str(exc))}
        saved = _read_x_config_file(include_metadata=True, include_internal=True)
        saved["X_PENDING_OAUTH_TOKEN"] = request_token.oauth_token
        saved["X_PENDING_OAUTH_TOKEN_SECRET"] = request_token.oauth_token_secret
        _write_x_config_file(saved)
        return {"ok": True, "authorize_url": authorize_url}

    def complete_x_oauth1(self, oauth_token: str, verifier: str) -> Dict[str, Any]:
        saved = _read_x_config_file(include_metadata=True, include_internal=True)
        pending_token = saved.get("X_PENDING_OAUTH_TOKEN", "")
        pending_secret = saved.get("X_PENDING_OAUTH_TOKEN_SECRET", "")
        if not pending_token or not pending_secret or oauth_token != pending_token:
            return {"ok": False, "error": "This X authorization is missing or no longer current."}
        cfg = self.apply_x_runtime_config()
        try:
            access = self._x_oauth1_flow(cfg).access_token(
                pending_token,
                pending_secret,
                verifier,
            )
        except Exception as exc:  # noqa: BLE001 - provider failures render on the callback
            return {"ok": False, "error": getattr(exc, "message", str(exc))}
        saved["X_OAUTH_ACCESS_TOKEN"] = access.oauth_token
        saved["X_OAUTH_ACCESS_TOKEN_SECRET"] = access.oauth_token_secret
        saved["X_VERIFIED_USER_ID"] = str(access.user_id or "")
        saved["X_VERIFIED_USERNAME"] = str(access.screen_name or "")
        for key in X_CONFIG_INTERNAL_KEYS:
            saved.pop(key, None)
        _write_x_config_file(saved)
        self.apply_x_runtime_config()
        return {
            "ok": True,
            "service": "x",
            "connected": True,
            "user_id": access.user_id,
            "screen_name": access.screen_name,
        }

    def verify_x_connection(self) -> Dict[str, Any]:
        cfg = self.apply_x_runtime_config()
        missing = [key for key in X_SENDER_REQUIRED if not cfg.get(key)]
        if missing:
            return {
                "ok": False,
                "error": "Complete all four X credential fields before verification.",
                "missing_sender": missing,
            }
        result = self.x_verifier(cfg)
        if not result.get("ok"):
            return result
        saved = _read_x_config_file(include_metadata=True)
        saved["X_VERIFIED_USER_ID"] = str(result.get("user_id", "")).strip()
        saved["X_VERIFIED_USERNAME"] = str(result.get("username", "")).strip()
        _write_x_config_file(saved)
        return result

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
        self.apply_x_runtime_config()
        # engine.connect returns {ok, authorize_url, ...} or an error envelope.
        try:
            return self.engine.connect(tenant, c.service)
        except Exception as e:  # noqa: BLE001 — setup errors belong on the page, not as 500s
            code_attr = getattr(e, "code", "unavailable")
            msg = getattr(e, "message", str(e))
            return {"ok": False, "error": {"code": code_attr, "message": msg}}

    # -- action: OAuth2 callback (exchange the code) ---------------------------
    def complete_oauth(self, code: str, state: str, service: str = "x") -> Dict[str, Any]:
        tenant = self.tenant()
        if not tenant:
            return {"ok": False, "error": "no owner tenant configured (provisioner seam)."}
        self.apply_x_runtime_config()
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
            if c.id == "x":
                continue
            status = self._status_for(c, tenant) if tenant else {"connected": False}
            rows.append(_render_connector_row(c, status))
        return _PAGE_TEMPLATE.format(
            rows="\n".join(rows),
            x_config_block=_render_x_config_block(self.x_config_status()),
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


def _x_config_path() -> Path:
    explicit = os.getenv("CALLISTHENES_X_CONFIG_PATH", "").strip()
    if explicit:
        return Path(explicit)
    data_dir = os.getenv("CALLISTHENES_DATA_DIR", "/data")
    return Path(data_dir) / "x-config.json"


def _read_x_config_file(
    *, include_metadata: bool = False, include_internal: bool = False
) -> Dict[str, str]:
    path = _x_config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    allowed = X_CONFIG_KEYS
    if include_metadata:
        allowed += X_CONFIG_METADATA_KEYS
    if include_internal:
        allowed += X_CONFIG_INTERNAL_KEYS
    return {
        key: str(data.get(key, "")).strip()
        for key in allowed
        if str(data.get(key, "")).strip()
    }


def _read_x_config_metadata() -> Dict[str, str]:
    saved = _read_x_config_file(include_metadata=True)
    return {key: saved.get(key, "") for key in X_CONFIG_METADATA_KEYS if saved.get(key)}


def _write_x_config_file(config: Dict[str, str]) -> None:
    path = _x_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    allowed = X_CONFIG_KEYS + X_CONFIG_METADATA_KEYS + X_CONFIG_INTERNAL_KEYS
    safe = {
        key: str(config.get(key, "")).strip()
        for key in allowed
        if str(config.get(key, "")).strip()
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(safe, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)


def _parse_env_config(raw: str) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in X_CONFIG_KEYS:
            continue
        value = value.strip().strip("\"'").strip()
        if value:
            parsed[key] = value
    return parsed


def _verify_x_account(config: Dict[str, str]) -> Dict[str, Any]:
    """Verify the saved OAuth1 credentials and return the bound X account."""
    try:
        import httpx
        from oauthlib.oauth1 import Client as OAuth1Client

        client = OAuth1Client(
            client_key=config["X_OAUTH_CONSUMER_KEY"],
            client_secret=config["X_OAUTH_CONSUMER_SECRET"],
            resource_owner_key=config["X_OAUTH_ACCESS_TOKEN"],
            resource_owner_secret=config["X_OAUTH_ACCESS_TOKEN_SECRET"],
            signature_type="AUTH_HEADER",
        )
        url, headers, _ = client.sign(
            "https://api.x.com/2/users/me",
            http_method="GET",
            headers={},
        )
        response = httpx.get(url, headers=headers, timeout=15.0)
    except Exception:
        return {
            "ok": False,
            "error": "Could not reach X to verify these credentials. Nothing was marked connected.",
        }
    if response.status_code != 200:
        return {
            "ok": False,
            "error": (
                f"X rejected these credentials (HTTP {response.status_code}). Check all four "
                "values and regenerate the Access Token after enabling Read and write."
            ),
        }
    try:
        account = response.json().get("data") or {}
    except Exception:
        account = {}
    if not account.get("id") or not account.get("username"):
        return {
            "ok": False,
            "error": "X accepted the request but did not return an account identity.",
        }
    return {
        "ok": True,
        "user_id": str(account["id"]),
        "username": str(account["username"]),
        "name": str(account.get("name") or ""),
    }


def _render_x_config_block(status: Dict[str, Any]) -> str:
    present = status.get("present") or {}
    sender_ready = bool(status.get("sender_ready"))
    app_ready = bool(status.get("app_ready"))
    username = str(status.get("verified_username") or "")
    if username:
        badge = f'<span class="badge on">Connected as @{html.escape(username)}</span>'
    elif sender_ready:
        badge = '<span class="badge on">X account connected</span>'
    else:
        badge = '<span class="badge off">Not connected</span>'
    if sender_ready:
        return (
            '<section class="xsetup" aria-labelledby="x-setup-title">'
            f'<div class="setup-title"><div><h2 id="x-setup-title">X account</h2>'
            '<p class="hint">Callisthenes is authorized to post for this account.</p></div>'
            f'{badge}</div>'
            '<form method="post" action="/connect/x/authorize" class="xform compact-action">'
            '<button class="btn" type="submit">Reconnect X</button>'
            '</form></section>'
        )
    fields = []
    for key, label, help_text in X_SETUP_FIELDS:
        is_set = bool(present.get(key))
        required = "" if is_set else " required"
        placeholder = "Saved - paste a new value to replace" if is_set else f"Paste {label}"
        state = "Saved" if is_set else "Required"
        fields.append(
            '<div class="credential-field">'
            f'<div class="field-head"><label for="{html.escape(key)}">{html.escape(label)}</label>'
            f'<span class="field-state {("set" if is_set else "missing")}">{state}</span></div>'
            f'<input id="{html.escape(key)}" name="{html.escape(key)}" type="password" '
            f'autocomplete="new-password" spellcheck="false" placeholder="{html.escape(placeholder)}"{required} />'
            f'<p>{html.escape(help_text)}</p></div>'
        )
    callback_url = html.escape(str(status.get("callback_url") or ""))
    return (
        '<section class="xsetup" aria-labelledby="x-setup-title">'
        f'<div class="setup-title"><div><h2 id="x-setup-title">Connect your X account</h2>'
        '<p class="hint">Paste the three values X gave you. Callisthenes creates the '
        'posting-account tokens during authorization.</p></div>'
        f'{badge}</div>'
        '<ol class="setup-steps">'
        f'<li><a href="{X_DEVELOPER_CONSOLE_URL}" target="_blank" rel="noreferrer">Open your app in X</a> '
        'and enable <strong>OAuth 1.0a</strong> with <strong>Read and write</strong>.</li>'
        '<li>Add this exact callback URL to the app:</li>'
        '</ol>'
        f'<div class="copyrow callback-row"><input class="mono" type="text" readonly value="{callback_url}" />'
        '<button class="btn copy" type="button" onclick="copyNear(this)">Copy</button></div>'
        f'<p class="official-guide"><a href="{X_CREDENTIALS_GUIDE_URL}" target="_blank" rel="noreferrer">'
        'Read X\'s official credential guide</a></p>'
        '<form method="post" action="/connect/x/app" class="xform">'
        f'<div class="credential-grid">{"".join(fields)}</div>'
        f'<button class="btn primary full" type="submit">{"Continue to X" if app_ready else "Save and continue to X"}</button>'
        '<p class="security-note">The posting-account tokens are created automatically after you authorize in X.</p>'
        '</form></section>'
    )


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
.badge.warn{{background:#3a2a12;color:#fbbf24}}
.btn{{display:inline-block;background:#262b35;color:#e8e8ea;border:1px solid #333a46;border-radius:8px;
padding:8px 14px;font-size:14px;cursor:pointer;text-decoration:none}}
.btn.primary{{background:#1d9bf0;border-color:#1d9bf0;color:#fff}}
.tokform{{display:flex;gap:8px}} .tokform input{{flex:1;min-width:160px;background:#0f1115;border:1px solid #333a46;
border-radius:8px;color:#e8e8ea;padding:8px 10px}}
.xsetup{{margin-top:14px;background:#12151b;border:1px solid #262b35;border-radius:12px;padding:18px}}
.xsetup h2{{font-size:17px;margin:0 0 4px}} .small{{color:#9aa0a6;font-size:12px;margin:6px 0}}
.small code{{color:#dbeafe}} .warntext{{color:#fbbf24}}
.setup-title{{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}}
.setup-title .badge{{margin:2px 0 0}} .setup-title .hint{{max-width:470px}}
.setup-steps{{color:#c4c8ce;font-size:13px;margin:16px 0;padding-left:22px}}
.setup-steps li{{margin:8px 0;padding-left:3px}} a{{color:#7dd3fc}}
.callback-row{{margin:-4px 0 12px}} .official-guide{{font-size:13px;margin:0 0 16px}}
.xform{{display:grid;gap:12px}} .credential-grid{{display:grid;grid-template-columns:1fr;gap:12px}}
.credential-field{{min-width:0}} .field-head{{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:5px}}
.credential-field label{{font-size:12px;font-weight:600}} .credential-field input{{width:100%;background:#0f1115;
border:1px solid #333a46;border-radius:8px;color:#e8e8ea;padding:9px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}}
.credential-field p{{color:#8f96a1;font-size:11px;line-height:1.4;margin:5px 0 0}}
.field-state{{font-size:10px;font-weight:600}} .field-state.set{{color:#4ade80}} .field-state.missing{{color:#fbbf24}}
.btn.full{{display:block;width:100%;text-align:center;margin-top:2px}} .security-note{{color:#7f8792;font-size:11px;text-align:center;margin:0}}
.compact-action{{margin-top:12px}}
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
@media(max-width:560px){{.credential-grid{{grid-template-columns:1fr}}}}
</style></head>
<body><div class="wrap">
<h1 class="title">Callisthenes</h1>
<p class="sub">One mouth for all your agents. Authorize each platform once — every agent sends through here.</p>
{flash}
{x_config_block}
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
    x_verifier: Optional[Callable[[Dict[str, str]], Dict[str, Any]]] = None,
    x_oauth1_flow_factory: Optional[Callable[[str, str], Any]] = None,
) -> ConnectPage:
    """Mount the connect page on the FastMCP app.

    `engine` MUST be the SAME ChatAuth instance passed to auth.register(engine=...)
    so the page shares the pending PKCE state + token store with the MCP tools. If
    None, a fresh ChatAuth is built (routes still work, but the MCP `connect` tool
    and the page would then not share pending state — callisthenes_server wires the
    shared engine, so this fallback is for tests only).

    Routes (all on the unit's single port):
        GET  /connect                         -> the one connect screen
        POST /connect/x/app                   -> save the three app values, start OAuth1
        POST /connect/x/authorize             -> reconnect using saved app values
        GET  /oauth/callback?oauth_token&...  -> exchange verifier, show "connected"
        GET  /connect/<id>/start              -> legacy OAuth2 connector start
        POST /connect/<id>/token              -> store a token-kind connector's value
    """
    if engine is None:
        try:
            from auth import ChatAuth  # type: ignore
        except Exception:  # pragma: no cover
            from __init__ import ChatAuth  # type: ignore
        engine = ChatAuth()

    page = ConnectPage(
        engine=engine,
        connectors=connectors,
        config=config,
        x_verifier=x_verifier,
        x_oauth1_flow_factory=x_oauth1_flow_factory,
    )

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
        if qp.get("denied"):
            return HTMLResponse(
                page.render_callback(
                    {
                        "ok": False,
                        "error": {
                            "code": "access_denied",
                            "message": "X authorization was cancelled. No posting account was connected.",
                        },
                    }
                ),
                status_code=400,
            )
        if qp.get("oauth_token") and qp.get("oauth_verifier"):
            result = page.complete_x_oauth1(qp.get("oauth_token", ""), qp.get("oauth_verifier", ""))
            status = 200 if result.get("ok") else 400
            return HTMLResponse(page.render_callback(result), status_code=status)
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

    @custom_route("/connect/x/config", methods=["POST"])
    async def _connect_x_config(request: "Request") -> Any:  # noqa: ANN001
        form = await request.form()
        values = {key: str(form.get(key, "")) for key in X_SENDER_REQUIRED}
        result = page.save_x_config(values)
        if result.get("ok"):
            if result.get("sender_ready"):
                verified = page.verify_x_connection()
                if verified.get("ok"):
                    username = str(verified.get("username") or "")
                    msg = f"X connected and verified as @{username}."
                    return HTMLResponse(page.render_page(flash=msg, flash_kind="ok"), status_code=200)
                return HTMLResponse(
                    page.render_page(flash=str(verified.get("error")), flash_kind="err"),
                    status_code=400,
                )
            missing = ", ".join(result.get("missing_sender") or [])
            msg = f"Saved. Complete the remaining X fields: {missing}."
            return HTMLResponse(page.render_page(flash=msg, flash_kind="info"), status_code=200)
        err = result.get("error") or "could not save X config"
        return HTMLResponse(page.render_page(flash=str(err), flash_kind="err"), status_code=400)

    @custom_route("/connect/x/app", methods=["POST"])
    async def _connect_x_app(request: "Request") -> Any:  # noqa: ANN001
        form = await request.form()
        values = {key: str(form.get(key, "")) for key in X_APP_REQUIRED}
        saved = page.save_x_app_config(values)
        if not saved.get("ok"):
            return HTMLResponse(
                page.render_page(flash=str(saved.get("error")), flash_kind="err"),
                status_code=400,
            )
        started = page.start_x_oauth1()
        if started.get("ok") and started.get("authorize_url"):
            return RedirectResponse(started["authorize_url"], status_code=303)
        return HTMLResponse(
            page.render_page(flash=str(started.get("error")), flash_kind="err"),
            status_code=400,
        )

    @custom_route("/connect/x/authorize", methods=["POST"])
    async def _connect_x_authorize(request: "Request") -> Any:  # noqa: ANN001
        started = page.start_x_oauth1()
        if started.get("ok") and started.get("authorize_url"):
            return RedirectResponse(started["authorize_url"], status_code=303)
        return HTMLResponse(
            page.render_page(flash=str(started.get("error")), flash_kind="err"),
            status_code=400,
        )

    setattr(mcp, "_connect_page", page)
    return page
