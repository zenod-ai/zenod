"""OAuth 1.0a PIN-based (`oauth_callback=oob`) flow for X (Twitter).

CD-3 (EPIC-2.4): PIN-first via OAuth 1.0a `oob`. X does NOT support device-code
(RFC 8628); OAuth1.0a PIN is the only path that yields the literal "visit x.com,
approve, paste the 7-digit PIN" console-less chat story.

This module owns:
  1. `request_token()`    — POST oauth/request_token with oauth_callback=oob
  2. `authorize_url(...)` — the CANONICAL x.com URL the tenant visits (anti-phishing: BINDING)
  3. `access_token(...)`  — POST oauth/access_token exchanging the PIN (oauth_verifier)

Signing mirrors upstream xdevplatform/xmcp's OAuth1.0a client (HMAC-SHA1 over the
canonical base string). All HTTP is isolated behind an injectable `HttpClient` so
tests mock it — NO network, NO real credentials required.

Security (BINDING, EPIC-2.4 §chat-auth): tool results built on top of this module
must surface CANONICAL x.com URLs only. `AUTHORIZE_BASE` below is that single
canonical origin; nothing else is ever returned to a caller.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from typing import Callable, Dict, Optional
from urllib.parse import parse_qs, quote, urlencode

# --- Canonical X endpoints (anti-phishing: the ONLY origin we ever emit) -------
REQUEST_TOKEN_URL = "https://api.x.com/oauth/request_token"
ACCESS_TOKEN_URL = "https://api.x.com/oauth/access_token"
# The user-facing authorize page. `authenticate` is the standard 3-legged endpoint.
AUTHORIZE_BASE = "https://api.x.com/oauth/authorize"
CANONICAL_AUTHORIZE_HOSTS = ("api.x.com", "x.com", "api.twitter.com", "twitter.com")


class OAuth1Error(Exception):
    """Loud failure in the OAuth1 dance. Carries a stable `code` (SEAM-SPEC §5)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --- HTTP seam: injectable so tests mock it (no network in unit tests) ---------
class HttpClient:
    """Minimal POST-form client. Real impl uses `requests`; tests inject a fake."""

    def post_form(self, url: str, headers: Dict[str, str]) -> "HttpResponse":
        raise NotImplementedError


@dataclass
class HttpResponse:
    status_code: int
    text: str


class RequestsHttpClient(HttpClient):
    """Production client. Imports `requests` lazily so importing this module
    (and running the mocked tests) never requires the dependency."""

    def post_form(self, url: str, headers: Dict[str, str]) -> HttpResponse:
        import requests  # lazy: only needed for real network calls

        resp = requests.post(url, headers=headers, timeout=30)
        return HttpResponse(status_code=resp.status_code, text=resp.text)


# --- OAuth1.0a signing (HMAC-SHA1, RFC 5849) -----------------------------------
def _rfc3986(value: str) -> str:
    # OAuth1 percent-encoding: unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
    return quote(str(value), safe="~-._")


def _signature_base_string(method: str, url: str, params: Dict[str, str]) -> str:
    encoded = sorted((_rfc3986(k), _rfc3986(v)) for k, v in params.items())
    param_str = "&".join(f"{k}={v}" for k, v in encoded)
    return "&".join([method.upper(), _rfc3986(url), _rfc3986(param_str)])


def _sign(base_string: str, consumer_secret: str, token_secret: str = "") -> str:
    key = f"{_rfc3986(consumer_secret)}&{_rfc3986(token_secret)}"
    digest = hmac.new(key.encode(), base_string.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _auth_header(
    method: str,
    url: str,
    consumer_key: str,
    consumer_secret: str,
    *,
    token: str = "",
    token_secret: str = "",
    extra_oauth: Optional[Dict[str, str]] = None,
    nonce: Optional[str] = None,
    timestamp: Optional[str] = None,
) -> str:
    oauth_params: Dict[str, str] = {
        "oauth_consumer_key": consumer_key,
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": timestamp or str(int(time.time())),
        "oauth_version": "1.0",
    }
    if token:
        oauth_params["oauth_token"] = token
    if extra_oauth:
        oauth_params.update(extra_oauth)

    base = _signature_base_string(method, url, oauth_params)
    oauth_params["oauth_signature"] = _sign(base, consumer_secret, token_secret)

    header = ", ".join(
        f'{_rfc3986(k)}="{_rfc3986(v)}"' for k, v in sorted(oauth_params.items())
    )
    return "OAuth " + header


# --- The three legs ------------------------------------------------------------
@dataclass
class RequestToken:
    oauth_token: str
    oauth_token_secret: str
    callback_confirmed: bool


@dataclass
class AccessToken:
    oauth_token: str
    oauth_token_secret: str
    user_id: Optional[str] = None
    screen_name: Optional[str] = None


class OAuth1PinFlow:
    """Per-tenant OAuth1.0a PIN (oob) flow. Stateless across instances except the
    request-token secret, which the caller must persist between connect() and
    complete_connect() (keyed by MCP token in the token store)."""

    def __init__(
        self,
        consumer_key: str,
        consumer_secret: str,
        http: Optional[HttpClient] = None,
    ):
        if not consumer_key or not consumer_secret:
            raise OAuth1Error(
                "invalid_input",
                "Missing X_OAUTH_CONSUMER_KEY / X_OAUTH_CONSUMER_SECRET for OAuth1 signing.",
            )
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.http = http or RequestsHttpClient()

    # Leg 1 -------------------------------------------------------------------
    def request_token(self) -> RequestToken:
        """POST oauth/request_token with oauth_callback=oob (PIN flow)."""
        header = _auth_header(
            "POST",
            REQUEST_TOKEN_URL,
            self.consumer_key,
            self.consumer_secret,
            extra_oauth={"oauth_callback": "oob"},
        )
        resp = self.http.post_form(REQUEST_TOKEN_URL, {"Authorization": header})
        if resp.status_code != 200:
            raise OAuth1Error(
                "unavailable",
                f"request_token failed (HTTP {resp.status_code}): {resp.text[:200]}",
            )
        data = _parse_form(resp.text)
        if "oauth_token" not in data or "oauth_token_secret" not in data:
            raise OAuth1Error(
                "unavailable", f"request_token response missing tokens: {resp.text[:200]}"
            )
        return RequestToken(
            oauth_token=data["oauth_token"],
            oauth_token_secret=data["oauth_token_secret"],
            callback_confirmed=data.get("oauth_callback_confirmed") == "true",
        )

    # Leg 2 -------------------------------------------------------------------
    @staticmethod
    def authorize_url(oauth_token: str) -> str:
        """The CANONICAL x.com URL the tenant visits to approve + get their PIN.
        BINDING: this is the only URL ever returned to a caller."""
        if not oauth_token:
            raise OAuth1Error("invalid_input", "authorize_url requires an oauth_token")
        return f"{AUTHORIZE_BASE}?{urlencode({'oauth_token': oauth_token})}"

    # Leg 3 -------------------------------------------------------------------
    def access_token(
        self, oauth_token: str, oauth_token_secret: str, pin: str
    ) -> AccessToken:
        """Exchange the PIN (oauth_verifier) for the tenant's long-lived
        access token + secret."""
        pin = (pin or "").strip()
        if not pin:
            raise OAuth1Error("invalid_input", "A PIN (oauth_verifier) is required.")
        header = _auth_header(
            "POST",
            ACCESS_TOKEN_URL,
            self.consumer_key,
            self.consumer_secret,
            token=oauth_token,
            token_secret=oauth_token_secret,
            extra_oauth={"oauth_verifier": pin},
        )
        resp = self.http.post_form(ACCESS_TOKEN_URL, {"Authorization": header})
        if resp.status_code != 200:
            raise OAuth1Error(
                "unauthorized",
                f"access_token exchange failed (HTTP {resp.status_code}): {resp.text[:200]}",
            )
        data = _parse_form(resp.text)
        if "oauth_token" not in data or "oauth_token_secret" not in data:
            raise OAuth1Error(
                "unavailable", f"access_token response missing tokens: {resp.text[:200]}"
            )
        return AccessToken(
            oauth_token=data["oauth_token"],
            oauth_token_secret=data["oauth_token_secret"],
            user_id=data.get("user_id"),
            screen_name=data.get("screen_name"),
        )


def _parse_form(text: str) -> Dict[str, str]:
    return {k: v[0] for k, v in parse_qs(text, keep_blank_values=True).items()}
