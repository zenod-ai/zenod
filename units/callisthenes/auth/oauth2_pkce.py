"""OAuth 2.0 Authorization-Code + PKCE flow for X (Twitter).

EPIC-2.4 C-2R (supersedes CD-3's OAuth1-PIN oob). Direction settled 2026-07-08
(Jordi): auth moves to OAuth 2.0 PKCE — "just click Authorize" — server-side, NOT
the localhost xurl bridge. X does NOT support device-code (RFC 8628); Auth-Code +
PKCE with a pre-registered `redirect_uri` is the only OAuth2 path X offers.

This module owns:
  1. `authorize()`       — mint a code_verifier/code_challenge (S256) + state, build
                           the CANONICAL x.com authorize URL the tenant visits.
  2. `exchange_code(...)`— POST https://api.x.com/2/oauth2/token (grant_type=
                           authorization_code) → access + refresh token set.
  3. `refresh(...)`      — POST the same endpoint (grant_type=refresh_token); X's
                           access tokens expire ~2h, `offline.access` yields a refresh.

Scopes requested: `tweet.read tweet.write users.read offline.access`
(offline.access = the refresh token that keeps agents posting without re-auth).

All HTTP is isolated behind an injectable `HttpClient` (mirrors oauth1_pin.py's
seam) so tests mock it — NO network, NO real credentials required.

Security (BINDING, EPIC-2.4 §chat-auth): the authorize URL we emit MUST be a
canonical x.com origin. `AUTHORIZE_BASE` below is that single canonical origin and
its host is in `CANONICAL_AUTHORIZE_HOSTS` (reused from oauth1_pin, the anti-phishing
allow-list). Nothing non-canonical is ever returned to a caller.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass, field
from typing import Dict, Optional
from urllib.parse import urlencode

# Reuse the single anti-phishing allow-list so both flows agree on "canonical".
# Import works whether this module is loaded as a package submodule
# (`auth.oauth2_pkce`) or top-level (`oauth2_pkce`, as the tests do via conftest).
try:
    from .oauth1_pin import CANONICAL_AUTHORIZE_HOSTS  # noqa: F401
except ImportError:  # pragma: no cover - top-level import path
    from oauth1_pin import CANONICAL_AUTHORIZE_HOSTS  # type: ignore  # noqa: F401

# --- Canonical X OAuth2 endpoints (anti-phishing: the ONLY origins we emit) ----
# X's user-facing authorize page for OAuth2 lives on the canonical web host.
AUTHORIZE_BASE = "https://x.com/i/oauth2/authorize"
# Token endpoint (code exchange + refresh). api.x.com is canonical.
TOKEN_URL = "https://api.x.com/2/oauth2/token"

# offline.access is what makes the refresh token appear — without it the ~2h access
# token cannot be renewed and agents would silently stop posting.
DEFAULT_SCOPES = "tweet.read tweet.write users.read offline.access"


class OAuth2Error(Exception):
    """Loud failure in the OAuth2 dance. Carries a stable `code` (SEAM-SPEC §5)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --- HTTP seam: injectable so tests mock it (no network in unit tests) ---------
@dataclass
class HttpResponse:
    status_code: int
    text: str


class HttpClient:
    """Minimal form-POST client. Real impl uses `requests`; tests inject a fake.

    Unlike oauth1_pin's client, OAuth2 needs a form BODY (grant params), so the
    seam takes `data` as well as `headers`.
    """

    def post_form(
        self, url: str, data: Dict[str, str], headers: Dict[str, str]
    ) -> HttpResponse:
        raise NotImplementedError


class RequestsHttpClient(HttpClient):
    """Production client. Imports `requests` lazily so importing this module (and
    running the mocked tests) never requires the dependency."""

    def post_form(
        self, url: str, data: Dict[str, str], headers: Dict[str, str]
    ) -> HttpResponse:
        import requests  # lazy: only needed for real network calls

        resp = requests.post(url, data=data, headers=headers, timeout=30)
        return HttpResponse(status_code=resp.status_code, text=resp.text)


# --- PKCE primitives (RFC 7636, S256) ------------------------------------------
def generate_code_verifier() -> str:
    """A high-entropy PKCE code_verifier: 43-128 chars from the unreserved set.
    32 random bytes → 43 base64url chars (no padding)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()


def code_challenge_s256(verifier: str) -> str:
    """S256 transform: base64url(sha256(verifier)) with padding stripped."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


# --- Data carriers -------------------------------------------------------------
@dataclass
class AuthorizeChallenge:
    """What `authorize()` hands back: the URL the tenant visits, plus the `state`
    and `code_verifier` the unit must hold until the callback returns the code."""

    authorize_url: str
    state: str
    code_verifier: str


@dataclass
class TokenSet:
    """The token material from a code exchange or refresh. `refresh_token` is the
    durable per-tenant credential we persist; `access_token` is short-lived (~2h)."""

    access_token: str
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None
    scope: Optional[str] = None
    token_type: Optional[str] = None
    obtained_at: float = field(default_factory=time.time)

    @property
    def expires_at(self) -> Optional[float]:
        if self.expires_in is None:
            return None
        return self.obtained_at + float(self.expires_in)


class OAuth2PkceFlow:
    """Per-tenant OAuth 2.0 Auth-Code + PKCE flow for X.

    Public clients (no secret) and confidential clients (client_id + client_secret)
    are both supported — X issues both. A client_secret, when present, is sent as
    HTTP Basic auth on the token endpoint per RFC 6749 §2.3.1.
    """

    def __init__(
        self,
        client_id: str,
        redirect_uri: str,
        client_secret: Optional[str] = None,
        scopes: str = DEFAULT_SCOPES,
        http: Optional[HttpClient] = None,
    ):
        if not client_id:
            raise OAuth2Error(
                "invalid_input",
                "Missing X_OAUTH2_CLIENT_ID for OAuth2 PKCE authorize/exchange.",
            )
        if not redirect_uri:
            raise OAuth2Error(
                "invalid_input",
                "Missing X_OAUTH2_REDIRECT_URI (X mandates a pre-registered callback).",
            )
        self.client_id = client_id
        self.client_secret = client_secret or None
        self.redirect_uri = redirect_uri
        self.scopes = scopes or DEFAULT_SCOPES
        self.http = http or RequestsHttpClient()

    # -- Leg 1: build the authorize URL ----------------------------------------
    def authorize(self, state: Optional[str] = None) -> AuthorizeChallenge:
        """Mint PKCE material + the CANONICAL authorize URL. The caller persists
        (state, code_verifier) until the callback delivers the code."""
        verifier = generate_code_verifier()
        challenge = code_challenge_s256(verifier)
        st = state or secrets.token_urlsafe(24)
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": self.scopes,
            "state": st,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        url = f"{AUTHORIZE_BASE}?{urlencode(params)}"
        return AuthorizeChallenge(authorize_url=url, state=st, code_verifier=verifier)

    # -- Leg 2: exchange the authorization code --------------------------------
    def exchange_code(self, code: str, code_verifier: str) -> TokenSet:
        """POST /2/oauth2/token grant_type=authorization_code → token set."""
        code = (code or "").strip()
        if not code:
            raise OAuth2Error("invalid_input", "An authorization code is required.")
        if not code_verifier:
            raise OAuth2Error(
                "invalid_input", "The PKCE code_verifier for this flow is missing."
            )
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
            "code_verifier": code_verifier,
            "client_id": self.client_id,
        }
        return self._token_request(data, leg="code exchange")

    # -- Leg 3: refresh a stale access token -----------------------------------
    def refresh(self, refresh_token: str) -> TokenSet:
        """POST /2/oauth2/token grant_type=refresh_token → fresh token set. X may
        rotate the refresh token, so callers must persist the returned one."""
        refresh_token = (refresh_token or "").strip()
        if not refresh_token:
            raise OAuth2Error("invalid_input", "A refresh_token is required to refresh.")
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.client_id,
        }
        return self._token_request(data, leg="refresh")

    # -- shared token-endpoint call --------------------------------------------
    def _token_request(self, data: Dict[str, str], *, leg: str) -> TokenSet:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        if self.client_secret:
            basic = base64.b64encode(
                f"{self.client_id}:{self.client_secret}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {basic}"
        resp = self.http.post_form(TOKEN_URL, data, headers)
        if resp.status_code != 200:
            # 400/401 from X on a bad/expired code or refresh → unauthorized.
            code = "unauthorized" if resp.status_code in (400, 401) else "unavailable"
            raise OAuth2Error(
                code, f"OAuth2 {leg} failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        try:
            payload = json.loads(resp.text)
        except (ValueError, TypeError):
            raise OAuth2Error(
                "unavailable", f"OAuth2 {leg} returned non-JSON: {resp.text[:200]}"
            )
        access_token = payload.get("access_token")
        if not access_token:
            raise OAuth2Error(
                "unavailable",
                f"OAuth2 {leg} response missing access_token: {resp.text[:200]}",
            )
        return TokenSet(
            access_token=access_token,
            refresh_token=payload.get("refresh_token"),
            expires_in=payload.get("expires_in"),
            scope=payload.get("scope"),
            token_type=payload.get("token_type"),
        )
